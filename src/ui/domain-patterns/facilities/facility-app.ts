import type { CommandBus } from "../../../commands/command-bus.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../../commands/command-envelope.js";
import { createPublicError } from "../../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../../core/contracts/result.js";
import type { DomainReadRepository } from "../../../storage/repositories/domain-repository.js";
import type { ViewerIdentity } from "../../../projection/viewer-identity.js";
import {
  FacilityDefinitionRegistry,
  createDefaultFacilityRegistry
} from "../../../facilities/definitions/facility-registry.js";
import type {
  FacilityInstance,
  FacilityLifecycle,
  FacilityReadiness
} from "../../../facilities/types/facility-types.js";
import type { FacilityCondition } from "../../../facilities/types/facility-maintenance-types.js";
import {
  buildFacilitiesViewModel,
  type FacilitiesPresenterOptions,
  type FacilitiesSubsystemViewModel,
  type FacilityViewModel
} from "./facility-presenter.js";
import {
  escapeAttribute,
  escapeHtml,
  renderFacilitiesSubsystemHtml,
  renderFacilityCreateModalHtml,
  renderFacilityDetailModalHtml,
  renderFacilityMaintenanceModalHtml,
  renderFacilityRepairModalHtml
} from "./facility-view.js";

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

export interface FacilitiesAppOptions {
  readonly domainUuid: string;
  readonly commandBus?: CommandBus;
  readonly domains: DomainReadRepository;
  readonly facilityRegistry?: FacilityDefinitionRegistry;
  readonly viewer?: Partial<ViewerIdentity>;
}

export type FacilitiesModalType = "create" | "detail" | "maintenance" | "repair" | null;

export class FacilitiesApplicationController {
  readonly #domainUuid: string;
  readonly #commandBus?: CommandBus;
  readonly #domains: DomainReadRepository;
  readonly #facilityRegistry: FacilityDefinitionRegistry;
  readonly #viewer?: Partial<ViewerIdentity>;

  #activeModal: FacilitiesModalType = null;
  #selectedFacilityId: string | null = null;
  #filterReadiness: FacilityReadiness | "all" = "all";
  #searchTerm: string = "";
  #lastViewModel: FacilitiesSubsystemViewModel | null = null;

  constructor(options: FacilitiesAppOptions) {
    this.#domainUuid = options.domainUuid;
    this.#commandBus = options.commandBus;
    this.#domains = options.domains;
    this.#facilityRegistry = options.facilityRegistry ?? createDefaultFacilityRegistry();
    this.#viewer = options.viewer;
  }

  get domainUuid(): string {
    return this.#domainUuid;
  }

  get activeModal(): FacilitiesModalType {
    return this.#activeModal;
  }

  get selectedFacilityId(): string | null {
    return this.#selectedFacilityId;
  }

  get filterReadiness(): FacilityReadiness | "all" {
    return this.#filterReadiness;
  }

  get searchTerm(): string {
    return this.#searchTerm;
  }

  get viewModel(): FacilitiesSubsystemViewModel | null {
    return this.#lastViewModel;
  }

  setFilterReadiness(filter: FacilityReadiness | "all"): void {
    this.#filterReadiness = filter;
  }

  setSearchTerm(term: string): void {
    this.#searchTerm = term;
  }

  openCreateModal(): void {
    this.#activeModal = "create";
  }

  openFacilityDetail(facilityId: string): void {
    this.#selectedFacilityId = facilityId;
    this.#activeModal = "detail";
  }

  openMaintenanceModal(facilityId: string): void {
    this.#selectedFacilityId = facilityId;
    this.#activeModal = "maintenance";
  }

  openRepairModal(facilityId: string): void {
    this.#selectedFacilityId = facilityId;
    this.#activeModal = "repair";
  }

  closeModal(): void {
    this.#activeModal = null;
    this.#selectedFacilityId = null;
  }

  async loadViewModel(): Promise<Result<FacilitiesSubsystemViewModel>> {
    const id = this.#domainUuid.startsWith("JournalEntry.")
      ? this.#domainUuid.slice("JournalEntry.".length)
      : this.#domainUuid;

    const docRes = await this.#domains.read(id);
    if (!docRes.ok) return docRes;

    const isGm = this.#viewer?.isGm ?? false;
    const vm = buildFacilitiesViewModel(docRes.value, {
      viewerIsGm: isGm,
      facilityRegistry: this.#facilityRegistry,
      filterReadiness: this.#filterReadiness,
      searchTerm: this.#searchTerm
    });

    this.#lastViewModel = vm;
    return ok(vm);
  }

  render(viewModel: FacilitiesSubsystemViewModel | null): string {
    const vm = viewModel ?? this.#lastViewModel;
    if (!vm) {
      return `<div class="dm-loading">Loading Facilities Subsystem...</div>`;
    }

    const mainHtml = renderFacilitiesSubsystemHtml(vm);

    let modalHtml = "";
    if (this.#activeModal === "create") {
      const defs = this.#facilityRegistry.list();
      modalHtml = renderFacilityCreateModalHtml(this.#domainUuid, defs);
    } else if (this.#activeModal === "detail" && this.#selectedFacilityId) {
      const f = vm.facilities.find((item) => item.id === this.#selectedFacilityId);
      if (f) {
        modalHtml = renderFacilityDetailModalHtml(f, vm.viewerIsGm);
      }
    } else if (this.#activeModal === "maintenance" && this.#selectedFacilityId) {
      const f = vm.facilities.find((item) => item.id === this.#selectedFacilityId);
      if (f) {
        modalHtml = renderFacilityMaintenanceModalHtml(f);
      }
    } else if (this.#activeModal === "repair" && this.#selectedFacilityId) {
      const f = vm.facilities.find((item) => item.id === this.#selectedFacilityId);
      if (f) {
        modalHtml = renderFacilityRepairModalHtml(f);
      }
    }

    return `
      <div class="dm-facilities-app-v2" data-domain-uuid="${escapeAttribute(this.#domainUuid)}">
        ${mainHtml}
        ${modalHtml ? `<div class="dm-modal-backdrop">${modalHtml}</div>` : ""}
      </div>
    `;
  }

  async #executeCommand(cmd: DomainCommand<any>): Promise<Result<unknown>> {
    if (!this.#commandBus) {
      return err(
        createPublicError({
          code: "DM_COMMAND_BUS_NOT_AVAILABLE",
          category: "internal",
          message: "CommandBus is required for dispatching facility mutations"
        })
      );
    }
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
            message: "Facility command rejected"
          })
      );
    }
    return ok(receipt.result);
  }

  async dispatchCreateFacility(payload: {
    readonly definitionId: string;
    readonly name?: string;
    readonly level: number;
    readonly initialLifecycle?: FacilityLifecycle;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("facilities:create-facility", {
      domainUuid: this.#domainUuid,
      definitionId: payload.definitionId,
      name: payload.name,
      level: payload.level,
      initialLifecycle: payload.initialLifecycle
    });
    const res = await this.#executeCommand(cmd);
    if (!res.ok) return res;
    const facility = (res.value as any)?.facility;
    return ok({
      facility,
      facilityId: facility?.id
    });
  }

  async dispatchMaintainFacility(payload: {
    readonly facilityId: string;
    readonly notes?: string;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("facilities:maintain-facility", {
      domainUuid: this.#domainUuid,
      facilityId: payload.facilityId,
      notes: payload.notes
    });
    return this.#executeCommand(cmd);
  }

  async dispatchRepairFacility(payload: {
    readonly facilityId: string;
    readonly restoreIntegrity?: number;
    readonly removeConditionIds?: readonly string[];
    readonly notes?: string;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("facilities:repair-facility", {
      domainUuid: this.#domainUuid,
      facilityId: payload.facilityId,
      restoreIntegrity: payload.restoreIntegrity,
      removeConditionIds: payload.removeConditionIds,
      notes: payload.notes
    });
    return this.#executeCommand(cmd);
  }

  async dispatchDamageFacility(payload: {
    readonly facilityId: string;
    readonly damageAmount: number;
    readonly condition?: FacilityCondition;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("facilities:apply-damage", {
      domainUuid: this.#domainUuid,
      facilityId: payload.facilityId,
      damage: payload.damageAmount,
      condition: payload.condition,
      conditionId: payload.condition?.id
    });
    return this.#executeCommand(cmd);
  }

  async dispatchDecommissionFacility(payload: {
    readonly facilityId: string;
    readonly reason?: string;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("facilities:decommission-facility", {
      domainUuid: this.#domainUuid,
      facilityId: payload.facilityId,
      reason: payload.reason
    });
    return this.#executeCommand(cmd);
  }
}

// Fallback MockApplicationV2 for isomorphic headless test environments
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
      const classes = ((this.constructor as any).DEFAULT_OPTIONS?.classes ?? ["domain-manager", "dm-facilities-app-v2"]).join(" ");
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

export class FacilitiesApplication extends BaseApp {
  static DEFAULT_OPTIONS = {
    id: "domain-manager-facilities-{id}",
    classes: ["domain-manager", "dm-facilities-app-v2"],
    tag: "div",
    window: {
      title: "Facilities & Infrastructure",
      icon: "fas fa-building",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 860,
      height: 640
    },
    actions: {
      openCreateModal: FacilitiesApplication.#onOpenCreateModal,
      openFacilityDetail: FacilitiesApplication.#onOpenFacilityDetail,
      openMaintenanceModal: FacilitiesApplication.#onOpenMaintenanceModal,
      openRepairModal: FacilitiesApplication.#onOpenRepairModal,
      closeModal: FacilitiesApplication.#onCloseModal
    }
  };

  readonly #controller: FacilitiesApplicationController;

  constructor(options: FacilitiesAppOptions) {
    super(options);
    this.#controller = new FacilitiesApplicationController(options);
  }

  get controller(): FacilitiesApplicationController {
    return this.#controller;
  }

  async _prepareContext(options?: any): Promise<{ viewModel: FacilitiesSubsystemViewModel | null; error: any }> {
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

        if (formType === "createFacility") {
          const level = parseInt(data.level || "1", 10);
          await this.#controller.dispatchCreateFacility({
            definitionId: data.definitionId,
            name: data.name || undefined,
            level: isNaN(level) ? 1 : level,
            initialLifecycle: (data.initialLifecycle as any) || "operational"
          });
          this.#controller.closeModal();
          this.render();
        } else if (formType === "maintainFacility") {
          const facilityId = form.getAttribute?.("data-facility-id");
          if (facilityId) {
            await this.#controller.dispatchMaintainFacility({
              facilityId,
              notes: data.notes || undefined
            });
            this.#controller.closeModal();
            this.render();
          }
        } else if (formType === "repairFacility") {
          const facilityId = form.getAttribute?.("data-facility-id");
          const restoreIntegrity = parseInt(data.restoreIntegrity || "0", 10);
          const clearConditionsCheckboxes = form.querySelectorAll?.('input[name="clearConditions"]:checked') ?? [];
          const conditionIds: string[] = [];
          clearConditionsCheckboxes.forEach((cb: any) => {
            if (cb.value) conditionIds.push(cb.value);
          });

          if (facilityId) {
            await this.#controller.dispatchRepairFacility({
              facilityId,
              restoreIntegrity: isNaN(restoreIntegrity) ? undefined : restoreIntegrity,
              removeConditionIds: conditionIds.length > 0 ? conditionIds : undefined
            });
            this.#controller.closeModal();
            this.render();
          }
        }
      });
    });

    const readinessSelect = element.querySelector?.('select[data-action="filterReadiness"]') as HTMLSelectElement | null;
    if (readinessSelect && !(readinessSelect as any)._dmChangeBound) {
      (readinessSelect as any)._dmChangeBound = true;
      readinessSelect.addEventListener("change", () => {
        this.#controller.setFilterReadiness(readinessSelect.value as any);
        this.render();
      });
    }

    const searchInput = element.querySelector?.('input[data-action="searchFacilities"]') as HTMLInputElement | null;
    if (searchInput && !(searchInput as any)._dmInputBound) {
      (searchInput as any)._dmInputBound = true;
      searchInput.addEventListener("input", () => {
        this.#controller.setSearchTerm(searchInput.value);
        this.render();
      });
    }
  }

  static #onOpenCreateModal(this: FacilitiesApplication): void {
    this.#controller.openCreateModal();
    this.render();
  }

  static #onOpenFacilityDetail(this: FacilitiesApplication, event: any, target: any): void {
    const id = target?.dataset?.facilityId ?? target?.getAttribute?.("data-facility-id");
    if (id) {
      this.#controller.openFacilityDetail(id);
      this.render();
    }
  }

  static #onOpenMaintenanceModal(this: FacilitiesApplication, event: any, target: any): void {
    const id = target?.dataset?.facilityId ?? target?.getAttribute?.("data-facility-id");
    if (id) {
      this.#controller.openMaintenanceModal(id);
      this.render();
    }
  }

  static #onOpenRepairModal(this: FacilitiesApplication, event: any, target: any): void {
    const id = target?.dataset?.facilityId ?? target?.getAttribute?.("data-facility-id");
    if (id) {
      this.#controller.openRepairModal(id);
      this.render();
    }
  }

  static #onCloseModal(this: FacilitiesApplication): void {
    this.#controller.closeModal();
    this.render();
  }
}
