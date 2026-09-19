import type { CommandBus } from "../../../commands/command-bus.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../../commands/command-envelope.js";
import { createPublicError } from "../../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../../core/contracts/result.js";
import type { DomainReadRepository, DomainRepositoryContract } from "../../../storage/repositories/domain-repository.js";
import type { ViewerIdentity } from "../../../projection/viewer-identity.js";
import {
  DowntimeDefinitionRegistry,
  createDefaultDowntimeRegistry
} from "../../../downtime/definitions/downtime-registry.js";
import {
  withDomainDowntimeData,
  getDomainDowntimeData,
  type DomainDowntimeData
} from "../../../downtime/downtime-data.js";
import type {
  DowntimeInstance,
  DowntimeLifecycle,
  DowntimeScope,
  DowntimeParticipant
} from "../../../downtime/types/downtime-types.js";
import {
  buildDowntimeViewModel,
  type DowntimePresenterOptions,
  type DowntimeSubsystemViewModel,
  type DowntimeViewModel
} from "./downtime-presenter.js";
import {
  escapeAttribute,
  escapeHtml,
  renderDowntimeDetailModalHtml,
  renderDowntimeStartModalHtml,
  renderDowntimeSubsystemHtml
} from "./downtime-view.js";

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

export interface DowntimeAppOptions {
  readonly domainUuid: string;
  readonly commandBus?: CommandBus;
  readonly domains: DomainReadRepository | DomainRepositoryContract;
  readonly downtimeRegistry?: DowntimeDefinitionRegistry;
  readonly viewer?: Partial<ViewerIdentity>;
}

export type DowntimeModalType = "start" | "detail" | null;

export class DowntimeApplicationController {
  readonly #domainUuid: string;
  readonly #commandBus?: CommandBus;
  readonly #domains: DomainReadRepository | DomainRepositoryContract;
  readonly #downtimeRegistry: DowntimeDefinitionRegistry;
  readonly #viewer?: Partial<ViewerIdentity>;

  #activeModal: DowntimeModalType = null;
  #selectedDowntimeId: string | null = null;
  #filterLifecycle: DowntimeLifecycle | "all" = "all";
  #searchTerm: string = "";
  #lastViewModel: DowntimeSubsystemViewModel | null = null;

  constructor(options: DowntimeAppOptions) {
    this.#domainUuid = options.domainUuid;
    this.#commandBus = options.commandBus;
    this.#domains = options.domains;
    this.#downtimeRegistry = options.downtimeRegistry ?? createDefaultDowntimeRegistry();
    this.#viewer = options.viewer;
  }

  get domainUuid(): string {
    return this.#domainUuid;
  }

  get activeModal(): DowntimeModalType {
    return this.#activeModal;
  }

  get selectedDowntimeId(): string | null {
    return this.#selectedDowntimeId;
  }

  get filterLifecycle(): DowntimeLifecycle | "all" {
    return this.#filterLifecycle;
  }

  get searchTerm(): string {
    return this.#searchTerm;
  }

  get viewModel(): DowntimeSubsystemViewModel | null {
    return this.#lastViewModel;
  }

  setFilterLifecycle(filter: DowntimeLifecycle | "all"): void {
    this.#filterLifecycle = filter;
  }

  setSearchTerm(term: string): void {
    this.#searchTerm = term;
  }

  openStartModal(): void {
    this.#activeModal = "start";
  }

  openDowntimeDetail(downtimeId: string): void {
    this.#selectedDowntimeId = downtimeId;
    this.#activeModal = "detail";
  }

  closeModal(): void {
    this.#activeModal = null;
    this.#selectedDowntimeId = null;
  }

  async loadViewModel(): Promise<Result<DowntimeSubsystemViewModel>> {
    const id = this.#domainUuid.startsWith("JournalEntry.")
      ? this.#domainUuid.slice("JournalEntry.".length)
      : this.#domainUuid;

    const docRes = await this.#domains.read(id);
    if (!docRes.ok) return docRes;

    const isGm = this.#viewer?.isGm ?? true;
    const vm = buildDowntimeViewModel(docRes.value, {
      viewerIsGm: isGm,
      downtimeRegistry: this.#downtimeRegistry,
      filterLifecycle: this.#filterLifecycle,
      searchTerm: this.#searchTerm
    });

    this.#lastViewModel = vm;
    return ok(vm);
  }

  render(viewModel: DowntimeSubsystemViewModel | null): string {
    const vm = viewModel ?? this.#lastViewModel;
    if (!vm) {
      return `<div class="dm-loading">Loading Downtime Subsystem...</div>`;
    }

    const mainHtml = renderDowntimeSubsystemHtml(vm);

    let modalHtml = "";
    if (this.#activeModal === "start") {
      const defs = this.#downtimeRegistry.list();
      modalHtml = renderDowntimeStartModalHtml(this.#domainUuid, defs);
    } else if (this.#activeModal === "detail" && this.#selectedDowntimeId) {
      const a = vm.activities.find((item) => item.id === this.#selectedDowntimeId);
      if (a) {
        modalHtml = renderDowntimeDetailModalHtml(a, vm.viewerIsGm);
      }
    }

    return `
      <div class="dm-downtime-app-v2" data-domain-uuid="${escapeAttribute(this.#domainUuid)}">
        ${mainHtml}
        ${modalHtml ? `<div class="dm-modal-backdrop">${modalHtml}</div>` : ""}
      </div>
    `;
  }

  async dispatchStartDowntime(payload: {
    readonly definitionId: string;
    readonly label?: string;
    readonly scope?: DowntimeScope;
    readonly durationTicks?: number | null;
    readonly participantRef?: string;
  }): Promise<Result<unknown>> {
    const id = this.#domainUuid.startsWith("JournalEntry.")
      ? this.#domainUuid.slice("JournalEntry.".length)
      : this.#domainUuid;

    const docRes = await this.#domains.read(id);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentDowntimeData = getDomainDowntimeData(record);

    const activityId = `dt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const participants: DowntimeParticipant[] = [];
    if (payload.participantRef) {
      participants.push({
        participantRef: payload.participantRef,
        participantType: "notable",
        role: "lead",
        capacityConsumed: 1
      });
    }

    const now = Date.now();
    const newActivity: DowntimeInstance = {
      id: activityId,
      domainUuid: this.#domainUuid,
      definitionId: payload.definitionId,
      name: payload.label ?? payload.definitionId,
      schemaVersion: 1,
      revision: 0,
      scope: payload.scope ?? "domain",
      lifecycle: "inProgress",
      elapsedTicks: 0,
      durationTicks: payload.durationTicks ?? null,
      participants: Object.freeze(participants),
      tags: Object.freeze([]),
      createdAt: now,
      updatedAt: now
    };

    const updatedActivities = [...currentDowntimeData.activities, newActivity];
    const updatedRecord = withDomainDowntimeData(record, {
      ...currentDowntimeData,
      activities: updatedActivities
    });

    if ("save" in this.#domains && typeof this.#domains.save === "function") {
      const saveRes = await this.#domains.save({
        ...docRes.value,
        record: updatedRecord
      });
      if (!saveRes.ok) return saveRes;
    }

    if (this.#commandBus) {
      const cmd = makeCommand("downtime:start-activity", {
        domainUuid: this.#domainUuid,
        activity: newActivity
      });
      await this.#commandBus.execute(cmd);
    }

    return ok({ activityId });
  }

  async dispatchAdvanceDowntime(payload: {
    readonly activityId: string;
    readonly ticks: number;
  }): Promise<Result<unknown>> {
    const id = this.#domainUuid.startsWith("JournalEntry.")
      ? this.#domainUuid.slice("JournalEntry.".length)
      : this.#domainUuid;

    const docRes = await this.#domains.read(id);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentDowntimeData = getDomainDowntimeData(record);
    const activity = currentDowntimeData.activities.find((a) => a.id === payload.activityId);
    if (!activity) {
      return err(createPublicError({
        code: "DM_DOWNTIME_NOT_FOUND",
        category: "not-found",
        message: `Downtime activity ${payload.activityId} not found`
      }));
    }

    const newProgress = activity.elapsedTicks + Math.max(0, payload.ticks);
    let newLifecycle = activity.lifecycle;
    if (activity.durationTicks !== null && activity.durationTicks !== undefined) {
      if (newProgress >= activity.durationTicks && newLifecycle === "inProgress") {
        newLifecycle = "completed";
      }
    }

    const now = Date.now();
    const updatedActivity: DowntimeInstance = {
      ...activity,
      elapsedTicks: newProgress,
      lifecycle: newLifecycle,
      revision: activity.revision + 1,
      updatedAt: now,
      completedAt: newLifecycle === "completed" ? now : activity.completedAt
    };

    const updatedActivities = currentDowntimeData.activities.map((a) =>
      a.id === payload.activityId ? updatedActivity : a
    );

    const updatedRecord = withDomainDowntimeData(record, {
      ...currentDowntimeData,
      activities: updatedActivities
    });

    if ("save" in this.#domains && typeof this.#domains.save === "function") {
      const saveRes = await this.#domains.save({
        ...docRes.value,
        record: updatedRecord
      });
      if (!saveRes.ok) return saveRes;
    }

    return ok({ activity: updatedActivity });
  }

  async dispatchCompleteDowntime(activityId: string): Promise<Result<unknown>> {
    const id = this.#domainUuid.startsWith("JournalEntry.")
      ? this.#domainUuid.slice("JournalEntry.".length)
      : this.#domainUuid;

    const docRes = await this.#domains.read(id);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentDowntimeData = getDomainDowntimeData(record);
    const activity = currentDowntimeData.activities.find((a) => a.id === activityId);
    if (!activity) {
      return err(createPublicError({
        code: "DM_DOWNTIME_NOT_FOUND",
        category: "not-found",
        message: `Downtime activity ${activityId} not found`
      }));
    }

    const now = Date.now();
    const updatedActivity: DowntimeInstance = {
      ...activity,
      lifecycle: "completed",
      revision: activity.revision + 1,
      updatedAt: now,
      completedAt: now
    };

    const updatedActivities = currentDowntimeData.activities.map((a) =>
      a.id === activityId ? updatedActivity : a
    );

    const updatedRecord = withDomainDowntimeData(record, {
      ...currentDowntimeData,
      activities: updatedActivities
    });

    if ("save" in this.#domains && typeof this.#domains.save === "function") {
      const saveRes = await this.#domains.save({
        ...docRes.value,
        record: updatedRecord
      });
      if (!saveRes.ok) return saveRes;
    }

    return ok({ activity: updatedActivity });
  }

  async dispatchCancelDowntime(activityId: string, reason?: string): Promise<Result<unknown>> {
    const id = this.#domainUuid.startsWith("JournalEntry.")
      ? this.#domainUuid.slice("JournalEntry.".length)
      : this.#domainUuid;

    const docRes = await this.#domains.read(id);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentDowntimeData = getDomainDowntimeData(record);
    const activity = currentDowntimeData.activities.find((a) => a.id === activityId);
    if (!activity) {
      return err(createPublicError({
        code: "DM_DOWNTIME_NOT_FOUND",
        category: "not-found",
        message: `Downtime activity ${activityId} not found`
      }));
    }

    const now = Date.now();
    const updatedActivity: DowntimeInstance = {
      ...activity,
      lifecycle: "cancelled",
      revision: activity.revision + 1,
      updatedAt: now,
      cancelledAt: now,
      metadata: {
        ...activity.metadata,
        cancellationReason: reason
      }
    };

    const updatedActivities = currentDowntimeData.activities.map((a) =>
      a.id === activityId ? updatedActivity : a
    );

    const updatedRecord = withDomainDowntimeData(record, {
      ...currentDowntimeData,
      activities: updatedActivities
    });

    if ("save" in this.#domains && typeof this.#domains.save === "function") {
      const saveRes = await this.#domains.save({
        ...docRes.value,
        record: updatedRecord
      });
      if (!saveRes.ok) return saveRes;
    }

    return ok({ activity: updatedActivity });
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
      const classes = ((this.constructor as any).DEFAULT_OPTIONS?.classes ?? ["domain-manager", "dm-downtime-app-v2"]).join(" ");
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

export class DowntimeApplication extends BaseApp {
  static DEFAULT_OPTIONS = {
    id: "domain-manager-downtime-{id}",
    classes: ["domain-manager", "dm-downtime-app-v2"],
    tag: "div",
    window: {
      title: "Downtime & Endeavors",
      icon: "fas fa-hourglass-half",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 840,
      height: 600
    },
    actions: {
      openStartModal: DowntimeApplication.#onOpenStartModal,
      openDowntimeDetail: DowntimeApplication.#onOpenDowntimeDetail,
      advanceDowntime: DowntimeApplication.#onAdvanceDowntime,
      completeDowntime: DowntimeApplication.#onCompleteDowntime,
      cancelDowntime: DowntimeApplication.#onCancelDowntime,
      closeModal: DowntimeApplication.#onCloseModal
    }
  };

  readonly #controller: DowntimeApplicationController;

  constructor(options: DowntimeAppOptions) {
    super(options);
    this.#controller = new DowntimeApplicationController(options);
  }

  get controller(): DowntimeApplicationController {
    return this.#controller;
  }

  async _prepareContext(options?: any): Promise<{ viewModel: DowntimeSubsystemViewModel | null; error: any }> {
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

        if (formType === "startDowntime") {
          const durationTicks = data.durationTicks ? parseInt(data.durationTicks, 10) : null;
          await this.#controller.dispatchStartDowntime({
            definitionId: data.definitionId,
            label: data.label || undefined,
            scope: (data.scope as any) || "domain",
            durationTicks: durationTicks && !isNaN(durationTicks) ? durationTicks : null,
            participantRef: data.participantRef || undefined
          });
          this.#controller.closeModal();
          this.render();
        } else if (formType === "advanceDowntime") {
          const activityId = form.getAttribute?.("data-downtime-id");
          const ticks = parseInt(data.ticks || "1", 10);
          if (activityId) {
            await this.#controller.dispatchAdvanceDowntime({
              activityId,
              ticks: isNaN(ticks) ? 1 : ticks
            });
            this.render();
          }
        }
      });
    });

    const filterSelect = element.querySelector?.('select[data-action="filterDowntimeLifecycle"]') as HTMLSelectElement | null;
    if (filterSelect && !(filterSelect as any)._dmChangeBound) {
      (filterSelect as any)._dmChangeBound = true;
      filterSelect.addEventListener("change", () => {
        this.#controller.setFilterLifecycle(filterSelect.value as any);
        this.render();
      });
    }

    const searchInput = element.querySelector?.('input[data-action="searchDowntime"]') as HTMLInputElement | null;
    if (searchInput && !(searchInput as any)._dmInputBound) {
      (searchInput as any)._dmInputBound = true;
      searchInput.addEventListener("input", () => {
        this.#controller.setSearchTerm(searchInput.value);
        this.render();
      });
    }
  }

  static #onOpenStartModal(this: DowntimeApplication): void {
    this.#controller.openStartModal();
    this.render();
  }

  static #onOpenDowntimeDetail(this: DowntimeApplication, event: any, target: any): void {
    const id = target?.dataset?.downtimeId ?? target?.getAttribute?.("data-downtime-id");
    if (id) {
      this.#controller.openDowntimeDetail(id);
      this.render();
    }
  }

  static async #onAdvanceDowntime(this: DowntimeApplication, event: any, target: any): Promise<void> {
    const id = target?.dataset?.downtimeId ?? target?.getAttribute?.("data-downtime-id");
    if (id) {
      await this.#controller.dispatchAdvanceDowntime({ activityId: id, ticks: 1 });
      this.render();
    }
  }

  static async #onCompleteDowntime(this: DowntimeApplication, event: any, target: any): Promise<void> {
    const id = target?.dataset?.downtimeId ?? target?.getAttribute?.("data-downtime-id");
    if (id) {
      await this.#controller.dispatchCompleteDowntime(id);
      this.render();
    }
  }

  static async #onCancelDowntime(this: DowntimeApplication, event: any, target: any): Promise<void> {
    const id = target?.dataset?.downtimeId ?? target?.getAttribute?.("data-downtime-id");
    if (id) {
      await this.#controller.dispatchCancelDowntime(id);
      this.render();
    }
  }

  static #onCloseModal(this: DowntimeApplication): void {
    this.#controller.closeModal();
    this.render();
  }
}
