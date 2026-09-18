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
import { parseResourceAmount } from "../../../economy/math/minor-units.js";
import type { ViewerIdentity } from "../../../projection/viewer-identity.js";
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
  renderTransferModalHtml
} from "./economy-view.js";

function makeCommand<T>(type: string, payload: T): DomainCommand<T> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
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
  readonly domains: DomainReadRepository;
  readonly viewer?: Partial<ViewerIdentity>;
}

export type EconomyModalType = "transfer" | "adjust" | "createAccount" | null;

export class EconomyApplicationController {
  readonly #domainUuid: string;
  readonly #commandBus: CommandBus;
  readonly #resourceRegistry?: ResourceDefinitionRegistry;
  readonly #ledgerStore?: LedgerStore;
  readonly #reservationStore?: ReservationStore;
  readonly #providerRegistry?: ProviderRegistry;
  readonly #domains: DomainReadRepository;
  readonly #viewer?: Partial<ViewerIdentity>;

  #activeModal: EconomyModalType = null;
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
    this.#domains = options.domains;
    this.#viewer = options.viewer;
  }

  get domainUuid(): string {
    return this.#domainUuid;
  }

  get activeModal(): EconomyModalType {
    return this.#activeModal;
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

    const isGm = Boolean(
      this.#viewer?.isGm ??
        (globalThis as any).game?.user?.isGM ??
        true
    );

    const presenterOptions: EconomyPresenterOptions = {
      viewerIsGm: isGm,
      resourceRegistry: this.#resourceRegistry ?? ({ get: () => undefined, list: () => [] } as any),
      ledgerStore: this.#ledgerStore,
      reservationStore: this.#reservationStore,
      providerRegistry: this.#providerRegistry
    };

    const vm = buildEconomyViewModel(docRes.value, presenterOptions);
    this.#lastViewModel = vm;
    return ok(vm);
  }

  openModal(modalType: "transfer" | "adjust" | "createAccount"): void {
    this.#activeModal = modalType;
  }

  closeModal(): void {
    this.#activeModal = null;
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
    readonly initialBalanceMinor?: number;
    readonly baseCapacityMinor?: number | null;
    readonly visibility?: "public" | "restricted" | "secret";
    readonly reason?: string;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("economy:create-account", {
      domainUuid: this.#domainUuid,
      resourceId: payload.resourceId,
      initialBalanceMinor: payload.initialBalanceMinor,
      baseCapacityMinor: payload.baseCapacityMinor,
      visibility: payload.visibility,
      reason: payload.reason
    });
    return this.#executeCommand(cmd);
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

  async render(force?: boolean, options?: any): Promise<this> {
    if (!this.element) {
      const classes = ((this.constructor as any).DEFAULT_OPTIONS?.classes ?? ["domain-manager", "dm-economy-app-v2"]).join(" ");
      if (typeof (globalThis as any).document?.createElement === "function") {
        const el = (globalThis as any).document.createElement("div");
        el.className = classes;
        this.element = el;
      } else {
        this.element = {
          className: classes,
          innerHTML: "",
          children: [] as any[],
          querySelectorAll: () => [],
          querySelector: () => null,
          addEventListener: () => {}
        };
      }
    }
    const context = await this._prepareContext(options);
    const result = await this._renderHTML(context, options);
    this._replaceHTML(result, this.element, options);
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
    const forms = element.querySelectorAll?.("form[data-form-type]") ?? [];
    forms.forEach((form: any) => {
      if (form._dmSubmitBound) return;
      form._dmSubmitBound = true;

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
          let initialBalanceMinor: number | undefined = undefined;
          if (data.initialBalance) {
            const parsedInit = parseResourceAmount(data.initialBalance, precision);
            if (parsedInit.ok) initialBalanceMinor = parsedInit.value;
          }

          let baseCapacityMinor: number | null | undefined = undefined;
          if (data.baseCapacity) {
            const parsedCap = parseResourceAmount(data.baseCapacity, precision);
            if (parsedCap.ok) baseCapacityMinor = parsedCap.value;
          }

          await this.#controller.dispatchCreateAccount({
            resourceId: data.resourceId,
            initialBalanceMinor,
            baseCapacityMinor,
            visibility: (data.visibility as any) || "public",
            reason: data.reason || undefined
          });
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

  static #onCloseModal(this: EconomyApplication): void {
    this.#controller.closeModal();
    this.render();
  }
}
