import type { CommandBus } from "../../../commands/command-bus.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../../commands/command-envelope.js";
import { createPublicError } from "../../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../../core/contracts/result.js";
import type { DomainReadRepository } from "../../../storage/repositories/domain-repository.js";
import type { EconomyService } from "../../../economy/services/economy-service.js";
import type { PublicEconomyApi } from "../../../economy/services/public-economy-api.js";
import type { ResourceDefinitionRegistry } from "../../../economy/definitions/resource-registry.js";
import type { LedgerStore } from "../../../economy/ledger/ledger-store.js";
import type { ReservationStore } from "../../../economy/reservations/reservation-store.js";
import type { ProviderRegistry } from "../../../economy/providers/provider-registry.js";
import type { ProviderHealth } from "../../../economy/providers/provider-types.js";
import type { TransactionStore } from "../../../mutations/transaction-store.js";
import { parseResourceAmount } from "../../../economy/math/minor-units.js";
import { resolveCurrentViewer, type ViewerIdentity } from "../../../projection/viewer-identity.js";
import {
  buildEconomyViewModel,
  type EconomyPresenterOptions,
  type EconomySubsystemViewModel
} from "./economy-presenter.js";
import {
  escapeAttribute,
  escapeHtml,
  renderAdjustModalHtml,
  renderCreateAccountModalHtml,
  renderEconomySubsystemHtml,
  renderResourceDetailModalHtml,
  renderTransactionHistoryModalHtml,
  renderTransferModalHtml
} from "./economy-view.js";

function cleanPayload<T>(payload: T): T {
  if (payload === null || typeof payload !== "object") {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map(cleanPayload) as unknown as T;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value !== undefined) {
      cleaned[key] = typeof value === "object" && value !== null ? cleanPayload(value) : value;
    }
  }
  return cleaned as T;
}

function makeCommand<T>(type: string, payload: T): DomainCommand<T> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload: cleanPayload(payload),
    issuedAtReal: Date.now()
  };
}

export interface EconomyAppOptions {
  readonly domainUuid: string;
  readonly commandBus: CommandBus;
  readonly economyService?: EconomyService | PublicEconomyApi;
  readonly resourceRegistry?: ResourceDefinitionRegistry;
  readonly ledgerStore?: LedgerStore;
  readonly reservationStore?: ReservationStore;
  readonly providerRegistry?: ProviderRegistry;
  readonly transactionStore?: TransactionStore;
  readonly domains: DomainReadRepository;
  readonly viewer?: Partial<ViewerIdentity>;
}

export type EconomyModalType =
  | "transfer"
  | "adjust"
  | "createAccount"
  | "resourceDetail"
  | "transactionHistory"
  | null;

export class EconomyApplicationController {
  readonly #domainUuid: string;
  readonly #commandBus: CommandBus;
  readonly #resourceRegistry?: ResourceDefinitionRegistry;
  readonly #ledgerStore?: LedgerStore;
  readonly #reservationStore?: ReservationStore;
  readonly #providerRegistry?: ProviderRegistry;
  readonly #transactionStore?: TransactionStore;
  readonly #domains: DomainReadRepository;
  readonly #viewer?: Partial<ViewerIdentity>;

  #activeModal: EconomyModalType = null;
  #selectedResourceId: string | null = null;
  #ledgerPage: number = 0;
  #lastViewModel: EconomySubsystemViewModel | null = null;

  constructor(options: EconomyAppOptions) {
    this.#domainUuid = options.domainUuid;
    this.#commandBus = options.commandBus;
    this.#resourceRegistry =
      options.resourceRegistry ?? (options.economyService as any)?.registry;
    this.#ledgerStore =
      options.ledgerStore ?? (options.economyService as any)?.ledgerStore;
    this.#reservationStore =
      options.reservationStore ?? (options.economyService as any)?.reservationStore;
    this.#providerRegistry =
      options.providerRegistry ?? (options.economyService as any)?.providerRegistry;
    this.#transactionStore =
      options.transactionStore ?? (options.economyService as any)?.transactionStore;
    this.#domains = options.domains;
    this.#viewer = options.viewer;
  }

  get domainUuid(): string {
    return this.#domainUuid;
  }

  get activeModal(): EconomyModalType {
    return this.#activeModal;
  }

  get selectedResourceId(): string | null {
    return this.#selectedResourceId;
  }

  get ledgerPage(): number {
    return this.#ledgerPage;
  }

  get viewModel(): EconomySubsystemViewModel | null {
    return this.#lastViewModel;
  }

  async loadViewModel(): Promise<Result<EconomySubsystemViewModel>> {
    const cleanId = this.#domainUuid.startsWith("JournalEntry.")
      ? this.#domainUuid.slice("JournalEntry.".length)
      : this.#domainUuid;

    const docRes = await this.#domains.read(cleanId);
    if (!docRes.ok) {
      return docRes;
    }

    const viewer = resolveCurrentViewer(this.#viewer);
    const isGm = viewer.isGm;

    const providerHealthMap = new Map<string, ProviderHealth>();
    if (this.#providerRegistry) {
      for (const p of this.#providerRegistry.list()) {
        try {
          const health = await p.getHealth();
          providerHealthMap.set(p.providerId, health);
        } catch {
          providerHealthMap.set(p.providerId, {
            status: "unavailable",
            lastCheckedAt: Date.now(),
            message: "Provider health check failed"
          });
        }
      }
    }

    const presenterOptions: EconomyPresenterOptions = {
      viewerIsGm: isGm,
      viewer,
      resourceRegistry: this.#resourceRegistry ?? ({ get: () => undefined, list: () => [] } as any),
      ledgerStore: this.#ledgerStore,
      reservationStore: this.#reservationStore,
      providerRegistry: this.#providerRegistry,
      providerHealthMap,
      transactionStore: this.#transactionStore,
      ledgerPage: this.#ledgerPage,
      ledgerPageSize: 20
    };

    const vm = buildEconomyViewModel(docRes.value, presenterOptions);
    this.#lastViewModel = vm;
    return ok(vm);
  }

  openModal(modalType: EconomyModalType, resourceId?: string): void {
    this.#activeModal = modalType;
    if (resourceId !== undefined) {
      this.#selectedResourceId = resourceId;
    }
  }

  openResourceDetail(resourceId: string): void {
    this.#selectedResourceId = resourceId;
    this.#activeModal = "resourceDetail";
  }

  closeModal(): void {
    this.#activeModal = null;
    this.#selectedResourceId = null;
  }

  nextLedgerPage(): void {
    this.#ledgerPage++;
  }

  prevLedgerPage(): void {
    if (this.#ledgerPage > 0) {
      this.#ledgerPage--;
    }
  }

  async dispatchReleaseReservation(payload: {
    readonly reservationId: string;
    readonly amountMinor?: number;
    readonly reason?: string;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("economy:release-reservation", {
      domainUuid: this.#domainUuid,
      reservationId: payload.reservationId,
      amountMinor: payload.amountMinor,
      reason: payload.reason
    });
    return this.#executeCommand(cmd);
  }

  async dispatchTransfer(payload: {
    readonly targetDomainUuid: string;
    readonly resourceId: string;
    readonly amountMinor: number;
    readonly reason?: string;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("economy:transfer", {
      sourceDomainUuid: this.#domainUuid,
      targetDomainUuid: payload.targetDomainUuid,
      resourceId: payload.resourceId,
      amountMinor: payload.amountMinor,
      reason: payload.reason
    });
    return this.#executeCommand(cmd);
  }

  async dispatchAdjust(payload: {
    readonly resourceId: string;
    readonly deltaMinor?: number;
    readonly targetBalanceMinor?: number;
    readonly reason: string;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("economy:adjust", {
      domainUuid: this.#domainUuid,
      resourceId: payload.resourceId,
      deltaMinor: payload.deltaMinor,
      targetBalanceMinor: payload.targetBalanceMinor,
      reason: payload.reason
    });
    return this.#executeCommand(cmd);
  }

  async dispatchCreateAccount(payload: {
    readonly resourceId: string;
    readonly mode?: "native" | "provider" | "derived";
    readonly initialBalanceMinor?: number;
    readonly baseCapacityMinor?: number | null;
    readonly visibility?: "public" | "restricted" | "secret";
    readonly reason?: string;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("economy:create-account", {
      domainUuid: this.#domainUuid,
      resourceId: payload.resourceId,
      mode: payload.mode ?? "native",
      initialBalanceMinor: payload.initialBalanceMinor,
      baseCapacityMinor: payload.baseCapacityMinor,
      visibility: payload.visibility,
      reason: payload.reason
    });
    return this.#executeCommand(cmd);
  }

  async dispatchQuickResourceCreateAndAccount(payload: {
    readonly definition: {
      readonly id: string;
      readonly label: string;
      readonly precision?: number;
      readonly unit?: string;
      readonly description?: string;
    };
    readonly account: {
      readonly mode?: "native" | "provider" | "derived";
      readonly initialBalanceMinor?: number;
      readonly baseCapacityMinor?: number | null;
      readonly visibility?: "public" | "restricted" | "secret";
      readonly reason?: string;
    };
  }): Promise<Result<unknown>> {
    const regCmd = makeCommand("economy:register-custom-resource", {
      definition: {
        id: payload.definition.id,
        version: 1,
        label: payload.definition.label,
        precision: payload.definition.precision ?? 0,
        displayUnit: {
          singular: payload.definition.unit ?? "",
          plural: payload.definition.unit ?? ""
        },
        description: payload.definition.description ?? "",
        icon: "fas fa-box",
        categoryId: "custom",
        tags: ["custom"],
        minimumMinor: 0,
        maximumMinor: null,
        allowNegative: false,
        defaultCapacityPolicy: "block",
        lifecycle: "active"
      }
    });

    const regRes = await this.#executeCommand(regCmd);
    if (!regRes.ok) {
      return regRes;
    }

    return this.dispatchCreateAccount({
      resourceId: payload.definition.id,
      mode: payload.account.mode ?? "native",
      initialBalanceMinor: payload.account.initialBalanceMinor,
      baseCapacityMinor: payload.account.baseCapacityMinor,
      visibility: payload.account.visibility,
      reason: payload.account.reason ?? `Initial allocation for ${payload.definition.label}`
    });
  }

  async #executeCommand(cmd: DomainCommand<any>): Promise<Result<unknown>> {
    const receiptRes = await this.#commandBus.execute(cmd);
    if (!receiptRes.ok) {
      return receiptRes;
    }
    const receipt = receiptRes.value;
    if (receipt.status === "rejected") {
      return err(
        receipt.error ??
          createPublicError({
            code: "DM_COMMAND_REJECTED",
            category: "internal",
            message: "Economy command rejected"
          })
      );
    }
    return ok(receipt.result);
  }

  render(vm: EconomySubsystemViewModel | null): string {
    if (!vm) {
      return `<div class="dm-loading">Loading Economy Subsystem...</div>`;
    }

    const mainHtml = renderEconomySubsystemHtml(vm);

    let modalHtml = "";
    if (this.#activeModal === "transfer") {
      modalHtml = renderTransferModalHtml(this.#domainUuid, vm.accounts);
    } else if (this.#activeModal === "adjust") {
      modalHtml = renderAdjustModalHtml(this.#domainUuid, vm.accounts);
    } else if (this.#activeModal === "createAccount") {
      const defs = this.#resourceRegistry ? this.#resourceRegistry.list() : [];
      modalHtml = renderCreateAccountModalHtml(this.#domainUuid, defs);
    } else if (this.#activeModal === "transactionHistory") {
      modalHtml = renderTransactionHistoryModalHtml(this.#domainUuid, vm.transactions);
    } else if (this.#activeModal === "resourceDetail" && this.#selectedResourceId) {
      const acc = vm.accounts.find((a) => a.resourceId === this.#selectedResourceId);
      if (acc) {
        modalHtml = renderResourceDetailModalHtml(acc);
      }
    }

    return `
      <div class="dm-economy-app-v2" data-domain-uuid="${escapeAttribute(this.#domainUuid)}">
        ${mainHtml}
        ${modalHtml ? `<div class="dm-modal-backdrop">${modalHtml}</div>` : ""}
      </div>
    `;
  }
}

// Fallback MockApplicationV2 for testing outside Foundry
class MockApplicationV2 {
  element: any = null;
  options: any;

  constructor(options: any = {}) {
    this.options = options;
  }

  async _prepareContext(options?: any): Promise<any> {
    return {};
  }

  _renderHTML(context: any, options?: any): any {
    return "";
  }

  _replaceHTML(result: any, content: any, options?: any): void {
    if (typeof result === "string") {
      content.innerHTML = result;
    }
  }

  _setupActions(element: any): void {
    if (!element || element._dmActionsConfigured) return;
    element._dmActionsConfigured = true;
    const actions = (this.constructor as any).DEFAULT_OPTIONS?.actions ?? {};
    element.addEventListener?.("click", async (event: any) => {
      let target = event?.target;
      while (target) {
        const action = target.getAttribute?.("data-action") ?? target.dataset?.action;
        if (action && typeof actions[action] === "function") {
          await actions[action].call(this, event, target);
          return;
        }
        if (target === element) break;
        target = target.parentElement;
      }
    });
  }

  async render(force?: boolean, options?: any): Promise<this> {
    if (!this.element) {
      const classes = ((this.constructor as any).DEFAULT_OPTIONS?.classes ?? ["domain-manager", "dm-economy-app-v2"]).join(" ");
      if (typeof (globalThis as any).document?.createElement === "function") {
        const el = (globalThis as any).document.createElement("div");
        el.className = classes;
        this.element = el;
      } else {
        const listeners: Record<string, ((...args: any[]) => any)[]> = {};
        this.element = {
          className: classes,
          innerHTML: "",
          children: [] as any[],
          querySelectorAll: () => [],
          querySelector: () => null,
          addEventListener: (evt: string, cb: any) => {
            listeners[evt] = listeners[evt] || [];
            listeners[evt].push(cb);
          },
          _listeners: listeners
        };
      }
    }
    const context = await this._prepareContext(options);
    const result = await this._renderHTML(context, options);
    this._replaceHTML(result, this.element, options);
    this._setupActions(this.element);
    this._onRender(context, options);
    return this;
  }

  _onRender(context: any, options?: any): void {}

  async close(options?: any): Promise<void> {
    this.element = null;
  }
}

const BaseApp =
  (globalThis as any).foundry?.applications?.api?.ApplicationV2 ?? MockApplicationV2;

export class EconomyApplication extends BaseApp {
  static DEFAULT_OPTIONS = {
    id: "domain-manager-economy-{id}",
    classes: ["domain-manager", "dm-economy-app-v2"],
    tag: "div",
    window: {
      title: "Economy & Resources",
      icon: "fas fa-coins",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 780,
      height: 600
    },
    actions: {
      openTransferModal: EconomyApplication.#onOpenTransferModal,
      openAdjustModal: EconomyApplication.#onOpenAdjustModal,
      openCreateAccountModal: EconomyApplication.#onOpenCreateAccountModal,
      openTransactionHistoryModal: EconomyApplication.#onOpenTransactionHistoryModal,
      openResourceDetail: EconomyApplication.#onOpenResourceDetail,
      releaseReservation: EconomyApplication.#onReleaseReservation,
      nextLedgerPage: EconomyApplication.#onNextLedgerPage,
      prevLedgerPage: EconomyApplication.#onPrevLedgerPage,
      closeModal: EconomyApplication.#onCloseModal
    }
  };

  readonly #controller: EconomyApplicationController;

  constructor(options: EconomyAppOptions) {
    super(options);
    this.#controller = new EconomyApplicationController(options);
  }

  get controller(): EconomyApplicationController {
    return this.#controller;
  }

  async _prepareContext(options?: any): Promise<{ viewModel: EconomySubsystemViewModel | null; error: any }> {
    const vmRes = await this.#controller.loadViewModel();
    return {
      viewModel: vmRes.ok ? vmRes.value : null,
      error: !vmRes.ok ? vmRes.error : null
    };
  }

  _renderHTML(context: any, options?: any): string {
    if (context.error) {
      return `<div class="dm-error-state">${escapeHtml(context.error.message)}</div>`;
    }
    return this.#controller.render(context.viewModel);
  }

  _replaceHTML(result: any, content: HTMLElement, options?: any): void {
    if (typeof result === "string") {
      content.innerHTML = result;
    } else if (result && typeof (content as any).replaceChildren === "function") {
      (content as any).replaceChildren(result);
    } else if (result) {
      content.innerHTML = String(result);
    }
  }

  _onRender(context: any, options?: any): void {
    const el = this.element;
    if (el) {
      this.attachEventListeners(el);
    }
  }

  attachEventListeners(element: HTMLElement): void {
    // Transfer live impact preview
    const transferForm = element.querySelector?.('form[data-form-type="transfer"]');
    if (transferForm && !(transferForm as any)._dmPreviewBound) {
      (transferForm as any)._dmPreviewBound = true;
      const amountInput = transferForm.querySelector?.('input[name="amount"]') as HTMLInputElement | null;
      const resSelect = transferForm.querySelector?.('select[name="resourceId"]') as HTMLSelectElement | null;
      const previewVal = transferForm.querySelector?.("#dm-transfer-preview .dm-preview-val") as HTMLElement | null;

      const updateTransferPreview = () => {
        if (!previewVal) return;
        const opt = resSelect?.selectedOptions?.[0] as HTMLOptionElement | undefined;
        const precision = opt?.dataset?.precision ? parseInt(opt.dataset.precision, 10) : 0;
        const availableMinor = opt?.dataset?.available ? parseInt(opt.dataset.available, 10) : 0;
        const unit = opt?.dataset?.unit ?? "";
        const valStr = (amountInput?.value ?? "").trim();
        if (!valStr) {
          previewVal.textContent = "—";
          return;
        }
        const parsed = parseResourceAmount(valStr, precision);
        if (!parsed.ok || parsed.value <= 0) {
          previewVal.textContent = "Invalid amount";
          return;
        }
        const remainingMinor = availableMinor - parsed.value;
        const formatted = (remainingMinor / Math.pow(10, precision)).toFixed(precision);
        previewVal.textContent = `${formatted} ${unit} (remaining)`;
        if (remainingMinor < 0) {
          previewVal.style.color = "var(--dm-color-danger, #d9534f)";
        } else {
          previewVal.style.color = "inherit";
        }
      };

      amountInput?.addEventListener("input", updateTransferPreview);
      resSelect?.addEventListener("change", updateTransferPreview);
    }

    // Adjust live impact preview
    const adjustForm = element.querySelector?.('form[data-form-type="adjust"]');
    if (adjustForm && !(adjustForm as any)._dmPreviewBound) {
      (adjustForm as any)._dmPreviewBound = true;
      const deltaInput = adjustForm.querySelector?.('input[name="delta"]') as HTMLInputElement | null;
      const resSelect = adjustForm.querySelector?.('select[name="resourceId"]') as HTMLSelectElement | null;
      const previewVal = adjustForm.querySelector?.("#dm-adjust-preview .dm-preview-val") as HTMLElement | null;

      const updateAdjustPreview = () => {
        if (!previewVal) return;
        const opt = resSelect?.selectedOptions?.[0] as HTMLOptionElement | undefined;
        const precision = opt?.dataset?.precision ? parseInt(opt.dataset.precision, 10) : 0;
        const balanceMinor = opt?.dataset?.balance ? parseInt(opt.dataset.balance, 10) : 0;
        const unit = opt?.dataset?.unit ?? "";
        const valStr = (deltaInput?.value ?? "").trim();
        if (!valStr) {
          previewVal.textContent = "—";
          return;
        }
        const parsed = parseResourceAmount(valStr, precision);
        if (!parsed.ok) {
          previewVal.textContent = "Invalid delta";
          return;
        }
        const newBalanceMinor = balanceMinor + parsed.value;
        const formatted = (newBalanceMinor / Math.pow(10, precision)).toFixed(precision);
        previewVal.textContent = `${formatted} ${unit} (new balance)`;
        if (newBalanceMinor < 0) {
          previewVal.style.color = "var(--dm-color-danger, #d9534f)";
        } else {
          previewVal.style.color = "inherit";
        }
      };

      deltaInput?.addEventListener("input", updateAdjustPreview);
      resSelect?.addEventListener("change", updateAdjustPreview);
    }

    const forms = element.querySelectorAll?.("form[data-form-type]") ?? [];
    forms.forEach((form: any) => {
      if (form._dmSubmitBound) return;
      form._dmSubmitBound = true;

      const modeRadios = form.querySelectorAll?.('input[name="creationMode"]') ?? [];
      modeRadios.forEach((radio: any) => {
        radio.addEventListener?.("change", () => {
          const isQuick = radio.value === "quickCreate";
          const existingGroup = form.querySelector?.("#dm-existing-group");
          const quickGroup = form.querySelector?.("#dm-quick-group");
          if (existingGroup) existingGroup.style.display = isQuick ? "none" : "";
          if (quickGroup) quickGroup.style.display = isQuick ? "" : "none";
        });
      });

      form.addEventListener("submit", async (e: any) => {
        e.preventDefault();
        const formType = form.getAttribute?.("data-form-type");
        const formData = new FormData(form);
        const data: Record<string, string> = {};
        formData.forEach((val, key) => {
          data[key] = String(val).trim();
        });

        const resSelect = form.querySelector?.('select[name="resourceId"]');
        const opt = resSelect?.selectedOptions?.[0];
        const precision = opt?.dataset?.precision ? parseInt(opt.dataset.precision, 10) : 0;

        if (formType === "transfer") {
          const parsedAmount = parseResourceAmount(data.amount, precision);
          if (!parsedAmount.ok) {
            console.error(parsedAmount.error.message);
            return;
          }
          if (parsedAmount.value > 0) {
            await this.#controller.dispatchTransfer({
              targetDomainUuid: data.targetDomainUuid,
              resourceId: data.resourceId,
              amountMinor: parsedAmount.value,
              reason: data.reason || undefined
            });
            this.#controller.closeModal();
            this.render();
          }
        } else if (formType === "adjust") {
          const parsedDelta = parseResourceAmount(data.delta, precision);
          if (!parsedDelta.ok) {
            console.error(parsedDelta.error.message);
            return;
          }
          if (data.reason) {
            await this.#controller.dispatchAdjust({
              resourceId: data.resourceId,
              deltaMinor: parsedDelta.value,
              reason: data.reason
            });
            this.#controller.closeModal();
            this.render();
          }
        } else if (formType === "createAccount") {
          const isQuick = data.creationMode === "quickCreate";
          let accountPrecision = 0;
          let resourceId = data.resourceId;

          if (isQuick) {
            resourceId = data.quickResourceId;
            accountPrecision = data.quickResourcePrecision ? parseInt(data.quickResourcePrecision, 10) : 0;
          } else {
            accountPrecision = precision;
          }

          let initialBalanceMinor: number | undefined = undefined;
          if (data.initialBalance) {
            const parsedInit = parseResourceAmount(data.initialBalance, accountPrecision);
            if (parsedInit.ok) initialBalanceMinor = parsedInit.value;
          }

          let baseCapacityMinor: number | null | undefined = undefined;
          if (data.baseCapacity) {
            const parsedCap = parseResourceAmount(data.baseCapacity, accountPrecision);
            if (parsedCap.ok) baseCapacityMinor = parsedCap.value;
          }

          if (isQuick) {
            const quickRes = await this.#controller.dispatchQuickResourceCreateAndAccount({
              definition: {
                id: resourceId,
                label: data.quickResourceLabel || resourceId,
                precision: accountPrecision,
                unit: data.quickResourceUnit || undefined,
                description: data.quickResourceDescription || undefined
              },
              account: {
                initialBalanceMinor,
                baseCapacityMinor,
                visibility: (data.visibility as any) || "public",
                reason: data.reason || undefined
              }
            });
            if (!quickRes.ok) {
              console.error("Quick resource create failed:", quickRes.error.message);
              return;
            }
          } else {
            await this.#controller.dispatchCreateAccount({
              resourceId,
              initialBalanceMinor,
              baseCapacityMinor,
              visibility: (data.visibility as any) || "public",
              reason: data.reason || undefined
            });
          }
          this.#controller.closeModal();
          this.render();
        }
      });
    });
  }

  static #onOpenTransferModal(this: EconomyApplication): void {
    this.#controller.openModal("transfer");
    this.render();
  }

  static #onOpenAdjustModal(this: EconomyApplication): void {
    this.#controller.openModal("adjust");
    this.render();
  }

  static #onOpenCreateAccountModal(this: EconomyApplication): void {
    this.#controller.openModal("createAccount");
    this.render();
  }

  static #onOpenTransactionHistoryModal(this: EconomyApplication): void {
    this.#controller.openModal("transactionHistory");
    this.render();
  }

  static #onOpenResourceDetail(this: EconomyApplication, event: any, target: any): void {
    const resId =
      target?.dataset?.resourceId ??
      target?.getAttribute?.("data-resource-id") ??
      event?.currentTarget?.dataset?.resourceId ??
      event?.currentTarget?.getAttribute?.("data-resource-id");
    if (resId) {
      this.#controller.openResourceDetail(resId);
      this.render();
    }
  }

  static async #onReleaseReservation(this: EconomyApplication, event: any, target: any): Promise<void> {
    const resId =
      target?.dataset?.reservationId ??
      target?.getAttribute?.("data-reservation-id") ??
      event?.currentTarget?.dataset?.reservationId ??
      event?.currentTarget?.getAttribute?.("data-reservation-id");
    if (!resId) return;

    let confirmed = true;
    let releaseReason: string | undefined = undefined;

    const foundryDialog = (globalThis as any).foundry?.applications?.api?.DialogV2;
    if (foundryDialog?.confirm) {
      confirmed = await foundryDialog.confirm({
        window: { title: "Release Reservation" },
        content: "<p>Are you sure you want to release this reservation? This will restore domain availability.</p>",
        yes: { label: "Release" },
        no: { label: "Cancel" }
      });
    } else if (typeof (globalThis as any).confirm === "function") {
      try {
        confirmed = (globalThis as any).confirm("Are you sure you want to release this reservation?");
      } catch {
        confirmed = true;
      }
    }

    if (!confirmed) return;

    if (typeof (globalThis as any).prompt === "function") {
      try {
        const inputReason = (globalThis as any).prompt("Optional release reason:");
        if (inputReason && inputReason.trim()) {
          releaseReason = inputReason.trim();
        }
      } catch {}
    }

    await this.#controller.dispatchReleaseReservation({
      reservationId: resId,
      reason: releaseReason
    });
    this.render();
  }

  static #onNextLedgerPage(this: EconomyApplication): void {
    this.#controller.nextLedgerPage();
    this.render();
  }

  static #onPrevLedgerPage(this: EconomyApplication): void {
    this.#controller.prevLedgerPage();
    this.render();
  }

  static #onCloseModal(this: EconomyApplication): void {
    this.#controller.closeModal();
    this.render();
  }
}
