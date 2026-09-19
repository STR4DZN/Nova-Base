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
  ProjectDefinitionRegistry,
  createDefaultProjectRegistry
} from "../../../projects/definitions/project-registry.js";
import type { ProjectInstance, ProjectLifecycle } from "../../../projects/types/project-types.js";
import {
  buildProjectsViewModel,
  type ProjectsPresenterOptions,
  type ProjectsSubsystemViewModel,
  type ProjectViewModel
} from "./project-presenter.js";
import {
  escapeAttribute,
  escapeHtml,
  renderProjectDetailModalHtml,
  renderProjectsSubsystemHtml,
  renderProjectStartModalHtml
} from "./project-view.js";

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

export interface ProjectsAppOptions {
  readonly domainUuid: string;
  readonly commandBus?: CommandBus;
  readonly domains: DomainReadRepository;
  readonly projectRegistry?: ProjectDefinitionRegistry;
  readonly viewer?: Partial<ViewerIdentity>;
}

export type ProjectsModalType = "start" | "detail" | null;

export class ProjectsApplicationController {
  readonly #domainUuid: string;
  readonly #commandBus?: CommandBus;
  readonly #domains: DomainReadRepository;
  readonly #projectRegistry: ProjectDefinitionRegistry;
  readonly #viewer?: Partial<ViewerIdentity>;

  #activeModal: ProjectsModalType = null;
  #selectedProjectId: string | null = null;
  #filterLifecycle: ProjectLifecycle | "all" = "all";
  #searchTerm: string = "";
  #lastViewModel: ProjectsSubsystemViewModel | null = null;

  constructor(options: ProjectsAppOptions) {
    this.#domainUuid = options.domainUuid;
    this.#commandBus = options.commandBus;
    this.#domains = options.domains;
    this.#projectRegistry = options.projectRegistry ?? createDefaultProjectRegistry();
    this.#viewer = options.viewer;
  }

  get domainUuid(): string {
    return this.#domainUuid;
  }

  get activeModal(): ProjectsModalType {
    return this.#activeModal;
  }

  get selectedProjectId(): string | null {
    return this.#selectedProjectId;
  }

  get filterLifecycle(): ProjectLifecycle | "all" {
    return this.#filterLifecycle;
  }

  get searchTerm(): string {
    return this.#searchTerm;
  }

  get viewModel(): ProjectsSubsystemViewModel | null {
    return this.#lastViewModel;
  }

  setFilterLifecycle(filter: ProjectLifecycle | "all"): void {
    this.#filterLifecycle = filter;
  }

  setSearchTerm(term: string): void {
    this.#searchTerm = term;
  }

  openStartModal(): void {
    this.#activeModal = "start";
  }

  openProjectDetail(projectId: string): void {
    this.#selectedProjectId = projectId;
    this.#activeModal = "detail";
  }

  closeModal(): void {
    this.#activeModal = null;
    this.#selectedProjectId = null;
  }

  async loadViewModel(): Promise<Result<ProjectsSubsystemViewModel>> {
    const id = this.#domainUuid.startsWith("JournalEntry.")
      ? this.#domainUuid.slice("JournalEntry.".length)
      : this.#domainUuid;

    const docRes = await this.#domains.read(id);
    if (!docRes.ok) return docRes;

    const isGm = this.#viewer?.isGm ?? false;
    const vm = buildProjectsViewModel(docRes.value, {
      viewerIsGm: isGm,
      projectRegistry: this.#projectRegistry,
      filterLifecycle: this.#filterLifecycle,
      searchTerm: this.#searchTerm
    });

    this.#lastViewModel = vm;
    return ok(vm);
  }

  render(viewModel: ProjectsSubsystemViewModel | null): string {
    const vm = viewModel ?? this.#lastViewModel;
    if (!vm) {
      return `<div class="dm-loading">Loading Projects Subsystem...</div>`;
    }

    const mainHtml = renderProjectsSubsystemHtml(vm);

    let modalHtml = "";
    if (this.#activeModal === "start") {
      const defs = this.#projectRegistry.list();
      modalHtml = renderProjectStartModalHtml(this.#domainUuid, defs);
    } else if (this.#activeModal === "detail" && this.#selectedProjectId) {
      const p = vm.projects.find((item) => item.id === this.#selectedProjectId);
      if (p) {
        modalHtml = renderProjectDetailModalHtml(p, vm.viewerIsGm);
      }
    }

    return `
      <div class="dm-projects-app-v2" data-domain-uuid="${escapeAttribute(this.#domainUuid)}">
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
          message: "CommandBus is required for dispatching projects mutations"
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
            message: "Project command rejected"
          })
      );
    }
    return ok(receipt.result);
  }

  async dispatchStartProject(payload: {
    readonly definitionId: string;
    readonly name?: string;
    readonly label?: string;
    readonly targetRef?: string;
    readonly workRequired: number;
    readonly initialState?: ProjectLifecycle;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:start-project", {
      domainUuid: this.#domainUuid,
      definitionId: payload.definitionId,
      name: payload.name ?? payload.label ?? payload.definitionId,
      workRequired: payload.workRequired,
      initialState: payload.initialState ?? "active",
      targetRef: payload.targetRef ?? this.#domainUuid
    });
    const res = await this.#executeCommand(cmd);
    if (!res.ok) return res;
    const project = (res.value as any)?.project;
    return ok({
      project,
      projectId: project?.id
    });
  }

  async dispatchAdvanceProject(payload: {
    readonly projectId: string;
    readonly units: number;
    readonly notes?: string;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:advance-project", {
      domainUuid: this.#domainUuid,
      projectId: payload.projectId,
      units: payload.units,
      notes: payload.notes
    });
    return this.#executeCommand(cmd);
  }

  async dispatchPauseProject(projectId: string, reason?: string): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:pause-project", {
      domainUuid: this.#domainUuid,
      projectId,
      reason
    });
    return this.#executeCommand(cmd);
  }

  async dispatchResumeProject(projectId: string, reason?: string): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:resume-project", {
      domainUuid: this.#domainUuid,
      projectId,
      reason
    });
    return this.#executeCommand(cmd);
  }

  async dispatchCancelProject(projectId: string, reason?: string): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:cancel-project", {
      domainUuid: this.#domainUuid,
      projectId,
      reason
    });
    return this.#executeCommand(cmd);
  }

  async dispatchCompleteProject(payload: {
    readonly projectId: string;
    readonly notes?: string;
    readonly outcomes?: unknown;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:complete-project", {
      domainUuid: this.#domainUuid,
      projectId: payload.projectId,
      notes: payload.notes,
      outcomes: payload.outcomes
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
      const classes = ((this.constructor as any).DEFAULT_OPTIONS?.classes ?? ["domain-manager", "dm-projects-app-v2"]).join(" ");
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

export class ProjectsApplication extends BaseApp {
  static DEFAULT_OPTIONS = {
    id: "domain-manager-projects-{id}",
    classes: ["domain-manager", "dm-projects-app-v2"],
    tag: "div",
    window: {
      title: "Projects & Construction",
      icon: "fas fa-hammer",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 820,
      height: 620
    },
    actions: {
      openStartModal: ProjectsApplication.#onOpenStartModal,
      openProjectDetail: ProjectsApplication.#onOpenProjectDetail,
      advanceProject: ProjectsApplication.#onAdvanceProject,
      pauseProject: ProjectsApplication.#onPauseProject,
      resumeProject: ProjectsApplication.#onResumeProject,
      cancelProject: ProjectsApplication.#onCancelProject,
      closeModal: ProjectsApplication.#onCloseModal
    }
  };

  readonly #controller: ProjectsApplicationController;

  constructor(options: ProjectsAppOptions) {
    super(options);
    this.#controller = new ProjectsApplicationController(options);
  }

  get controller(): ProjectsApplicationController {
    return this.#controller;
  }

  async _prepareContext(options?: any): Promise<{ viewModel: ProjectsSubsystemViewModel | null; error: any }> {
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

        if (formType === "startProject") {
          const workRequired = parseInt(data.workRequired || "10", 10);
          await this.#controller.dispatchStartProject({
            definitionId: data.definitionId,
            label: data.label || undefined,
            targetRef: data.targetRef || undefined,
            workRequired: isNaN(workRequired) ? 10 : workRequired,
            initialState: (data.initialState as any) || "active"
          });
          this.#controller.closeModal();
          this.render();
        } else if (formType === "advanceProject") {
          const projectId = form.getAttribute?.("data-project-id");
          const units = parseInt(data.progressUnits || "1", 10);
          if (projectId) {
            await this.#controller.dispatchAdvanceProject({
              projectId,
              units: isNaN(units) ? 1 : units
            });
            this.render();
          }
        }
      });
    });

    const filterSelect = element.querySelector?.('select[data-action="filterProjects"]') as HTMLSelectElement | null;
    if (filterSelect && !(filterSelect as any)._dmChangeBound) {
      (filterSelect as any)._dmChangeBound = true;
      filterSelect.addEventListener("change", () => {
        this.#controller.setFilterLifecycle(filterSelect.value as any);
        this.render();
      });
    }

    const searchInput = element.querySelector?.('input[data-action="searchProjects"]') as HTMLInputElement | null;
    if (searchInput && !(searchInput as any)._dmInputBound) {
      (searchInput as any)._dmInputBound = true;
      searchInput.addEventListener("input", () => {
        this.#controller.setSearchTerm(searchInput.value);
        this.render();
      });
    }
  }

  static #onOpenStartModal(this: ProjectsApplication): void {
    this.#controller.openStartModal();
    this.render();
  }

  static #onOpenProjectDetail(this: ProjectsApplication, event: any, target: any): void {
    const id = target?.dataset?.projectId ?? target?.getAttribute?.("data-project-id");
    if (id) {
      this.#controller.openProjectDetail(id);
      this.render();
    }
  }

  static async #onAdvanceProject(this: ProjectsApplication, event: any, target: any): Promise<void> {
    const id = target?.dataset?.projectId ?? target?.getAttribute?.("data-project-id");
    if (id) {
      await this.#controller.dispatchAdvanceProject({ projectId: id, units: 1 });
      this.render();
    }
  }

  static async #onPauseProject(this: ProjectsApplication, event: any, target: any): Promise<void> {
    const id = target?.dataset?.projectId ?? target?.getAttribute?.("data-project-id");
    if (id) {
      await this.#controller.dispatchPauseProject(id);
      this.render();
    }
  }

  static async #onResumeProject(this: ProjectsApplication, event: any, target: any): Promise<void> {
    const id = target?.dataset?.projectId ?? target?.getAttribute?.("data-project-id");
    if (id) {
      await this.#controller.dispatchResumeProject(id);
      this.render();
    }
  }

  static async #onCancelProject(this: ProjectsApplication, event: any, target: any): Promise<void> {
    const id = target?.dataset?.projectId ?? target?.getAttribute?.("data-project-id");
    if (id) {
      await this.#controller.dispatchCancelProject(id);
      this.render();
    }
  }

  static #onCloseModal(this: ProjectsApplication): void {
    this.#controller.closeModal();
    this.render();
  }
}
