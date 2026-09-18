import type { CommandBus } from "../../../commands/command-bus.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../../commands/command-envelope.js";
import { createPublicError } from "../../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../../core/contracts/result.js";
import type { DomainReadRepository } from "../../../storage/repositories/domain-repository.js";
import type { PublicPeopleApi } from "../../../people/services/people-service.js";
import type { ViewerIdentity } from "../../../projection/viewer-identity.js";
import type { PeopleSubsystemViewModel } from "./people-presenter.js";
import { escapeAttribute, escapeHtml } from "./people-view.js";

function makeCommand<T>(type: string, payload: T): DomainCommand<T> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

export type PeopleTab = "population" | "notables" | "roles" | "operationalGroups" | "assignments";

export interface SelectedEntity {
  readonly type: "notable" | "role" | "group" | "assignment" | "reservation" | "popGroup";
  readonly id: string;
}

export interface PeopleAppOptions {
  readonly domainUuid: string;
  readonly commandBus: CommandBus;
  readonly peopleApi: PublicPeopleApi;
  readonly domains: DomainReadRepository;
  readonly viewer?: Partial<ViewerIdentity>;
}

export class PeopleApplicationController {
  readonly #domainUuid: string;
  readonly #commandBus: CommandBus;
  readonly #peopleApi: PublicPeopleApi;
  readonly #domains: DomainReadRepository;
  readonly #viewer?: Partial<ViewerIdentity>;

  #activeTab: PeopleTab = "notables";
  #selectedEntity: SelectedEntity | null = null;
  #lastViewModel: PeopleSubsystemViewModel | null = null;

  constructor(options: PeopleAppOptions) {
    this.#domainUuid = options.domainUuid;
    this.#commandBus = options.commandBus;
    this.#peopleApi = options.peopleApi;
    this.#domains = options.domains;
    this.#viewer = options.viewer;
  }

  get domainUuid(): string {
    return this.#domainUuid;
  }

  get activeTab(): PeopleTab {
    return this.#activeTab;
  }

  get selectedEntity(): SelectedEntity | null {
    return this.#selectedEntity;
  }

  selectTab(tab: PeopleTab): void {
    this.#activeTab = tab;
  }

  selectEntity(type: SelectedEntity["type"], id: string): void {
    this.#selectedEntity = { type, id };
  }

  clearSelection(): void {
    this.#selectedEntity = null;
  }

  async loadViewModel(): Promise<Result<PeopleSubsystemViewModel>> {
    const id = this.#domainUuid.startsWith("JournalEntry.")
      ? this.#domainUuid.slice("JournalEntry.".length)
      : this.#domainUuid;

    const docRes = await this.#domains.read(id);
    if (!docRes.ok) return docRes;

    const isGm = this.#viewer?.isGm ?? true;
    const vm = this.#peopleApi.buildViewModel(docRes.value, {
      viewerIsGm: isGm
    });

    this.#lastViewModel = vm;
    return ok(vm);
  }

  async #executeCommand<T>(cmd: DomainCommand<T>): Promise<Result<unknown>> {
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(
        res.value.error ??
          createPublicError({
            code: "DM_COMMAND_REJECTED",
            category: "internal",
            message: "Command was rejected by authority"
          })
      );
    }
    return ok(res.value.result);
  }

  // Action Dispatchers via CommandBus
  async dispatchCreateNotable(payload: {
    readonly name?: string;
    readonly type?: "actor" | "inline";
    readonly actorUuid?: string;
    readonly description?: string;
    readonly tags?: readonly string[];
    readonly visibility?: "public" | "restricted" | "secret";
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("people:create-notable", {
      domainUuid: this.#domainUuid,
      notable: {
        type: payload.type ?? "inline",
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.actorUuid !== undefined ? { actorUuid: payload.actorUuid } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        tags: payload.tags ?? [],
        visibility: payload.visibility ?? "public"
      }
    });
    return this.#executeCommand(cmd);
  }

  async dispatchCreateRole(payload: {
    readonly definitionId: string;
    readonly customLabel?: string;
    readonly occupants?: readonly string[];
    readonly visibility?: "public" | "restricted" | "secret";
    readonly scope?: "domain" | "operational-group";
    readonly operationalGroupId?: string;
    readonly notes?: string;
    readonly tags?: readonly string[];
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("people:create-role", {
      domainUuid: this.#domainUuid,
      role: {
        definitionId: payload.definitionId,
        ...(payload.customLabel !== undefined ? { customLabel: payload.customLabel } : {}),
        occupants: payload.occupants ?? [],
        visibility: payload.visibility ?? "public",
        scope: payload.scope ?? "domain",
        ...(payload.operationalGroupId !== undefined ? { operationalGroupId: payload.operationalGroupId } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        tags: payload.tags ?? []
      }
    });
    return this.#executeCommand(cmd);
  }

  async dispatchCreateOperationalGroup(payload: {
    readonly name: string;
    readonly definitionId: string;
    readonly membershipMode?: "abstract" | "explicit";
    readonly size?: number;
    readonly members?: readonly string[];
    readonly populationGroupId?: string;
    readonly visibility?: "public" | "restricted" | "secret";
    readonly notes?: string;
    readonly tags?: readonly string[];
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("people:create-operational-group", {
      domainUuid: this.#domainUuid,
      group: {
        name: payload.name,
        definitionId: payload.definitionId,
        membershipMode: payload.membershipMode ?? "abstract",
        size: payload.size ?? payload.members?.length ?? 1,
        members: payload.members ?? [],
        ...(payload.populationGroupId !== undefined ? { populationGroupId: payload.populationGroupId } : {}),
        visibility: payload.visibility ?? "public",
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        tags: payload.tags ?? []
      }
    });
    return this.#executeCommand(cmd);
  }

  async dispatchCreateAssignment(payload: {
    readonly sourceRef: string;
    readonly targetRef: string;
    readonly workforceTypeId: string;
    readonly amount: number;
    readonly visibility?: "public" | "secret";
    readonly startedAtWorld?: number;
    readonly endsAtWorld?: number;
    readonly notes?: string;
    readonly allowOvercommit?: boolean;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("people:create-assignment", {
      domainUuid: this.#domainUuid,
      assignment: {
        sourceRef: payload.sourceRef,
        targetRef: payload.targetRef,
        workforceTypeId: payload.workforceTypeId,
        amount: payload.amount,
        visibility: payload.visibility ?? "public",
        ...(payload.startedAtWorld !== undefined ? { startedAtWorld: payload.startedAtWorld } : {}),
        ...(payload.endsAtWorld !== undefined ? { endsAtWorld: payload.endsAtWorld } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {})
      },
      ...(payload.allowOvercommit !== undefined ? { allowOvercommit: payload.allowOvercommit } : {})
    });
    return this.#executeCommand(cmd);
  }

  async dispatchCancelAssignment(assignmentId: string): Promise<Result<unknown>> {
    const cmd = makeCommand("people:cancel-assignment", {
      domainUuid: this.#domainUuid,
      assignmentId
    });
    return this.#executeCommand(cmd);
  }

  async dispatchCreateReservation(payload: {
    readonly sourceRef: string;
    readonly targetRef: string;
    readonly workforceTypeId: string;
    readonly amount: number;
    readonly correlationId?: string;
    readonly visibility?: "public" | "secret";
    readonly expiresAtReal?: number;
    readonly expiresAtWorld?: number;
    readonly notes?: string;
    readonly allowOvercommit?: boolean;
  }): Promise<Result<unknown>> {
    const cmd = makeCommand("people:create-reservation", {
      domainUuid: this.#domainUuid,
      reservation: {
        sourceRef: payload.sourceRef,
        targetRef: payload.targetRef,
        workforceTypeId: payload.workforceTypeId,
        amount: payload.amount,
        ...(payload.correlationId !== undefined ? { correlationId: payload.correlationId } : {}),
        visibility: payload.visibility ?? "public",
        ...(payload.expiresAtReal !== undefined ? { expiresAtReal: payload.expiresAtReal } : {}),
        ...(payload.expiresAtWorld !== undefined ? { expiresAtWorld: payload.expiresAtWorld } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {})
      },
      ...(payload.allowOvercommit !== undefined ? { allowOvercommit: payload.allowOvercommit } : {})
    });
    return this.#executeCommand(cmd);
  }

  async dispatchReleaseReservation(reservationId: string): Promise<Result<unknown>> {
    const cmd = makeCommand("people:release-reservation", {
      domainUuid: this.#domainUuid,
      reservationId
    });
    return this.#executeCommand(cmd);
  }

  // HTML Rendering (Collection + Inspector + Create Modals/Buttons)
  render(vm: PeopleSubsystemViewModel): string {
    this.#lastViewModel = vm;

    const tabsHtml = `
      <nav class="dm-people-tabs" role="tablist">
        <button type="button" class="dm-tab ${this.#activeTab === "notables" ? "active" : ""}" data-action="selectTab" data-tab="notables">
          <i class="fas fa-user-shield"></i> Notables (${vm.notables.length})
        </button>
        <button type="button" class="dm-tab ${this.#activeTab === "roles" ? "active" : ""}" data-action="selectTab" data-tab="roles">
          <i class="fas fa-sitemap"></i> Roles (${vm.roles.length})
        </button>
        <button type="button" class="dm-tab ${this.#activeTab === "operationalGroups" ? "active" : ""}" data-action="selectTab" data-tab="operationalGroups">
          <i class="fas fa-users-cog"></i> Operational Groups (${vm.operationalGroups.length})
        </button>
        <button type="button" class="dm-tab ${this.#activeTab === "population" ? "active" : ""}" data-action="selectTab" data-tab="population">
          <i class="fas fa-users"></i> Population (${escapeHtml(vm.population.formattedTotal)})
        </button>
        <button type="button" class="dm-tab ${this.#activeTab === "assignments" ? "active" : ""}" data-action="selectTab" data-tab="assignments">
          <i class="fas fa-tasks"></i> Workforce & Assignments
        </button>
      </nav>
    `;

    const collectionHtml = this.#renderCollectionView(vm);
    const inspectorHtml = this.#renderInspectorView(vm);

    return `
      <div class="dm-people-app-v2" data-domain-uuid="${escapeAttribute(this.#domainUuid)}">
        <header class="dm-app-header">
          <h2><i class="fas fa-users-crown"></i> People & Governance Subsystem</h2>
          <div class="dm-app-actions">
            <button type="button" class="dm-btn dm-btn-primary" data-action="openCreateModal" data-create-type="${escapeAttribute(this.#activeTab)}">
              <i class="fas fa-plus"></i> Create New
            </button>
          </div>
        </header>

        ${tabsHtml}

        <div class="dm-people-layout">
          <main class="dm-collection-container">
            ${collectionHtml}
          </main>

          <aside class="dm-inspector-container">
            ${inspectorHtml}
          </aside>
        </div>
      </div>
    `;
  }

  #renderCollectionView(vm: PeopleSubsystemViewModel): string {
    switch (this.#activeTab) {
      case "notables":
        return this.#renderNotablesCollection(vm);
      case "roles":
        return this.#renderRolesCollection(vm);
      case "operationalGroups":
        return this.#renderOperationalGroupsCollection(vm);
      case "population":
        return this.#renderPopulationCollection(vm);
      case "assignments":
        return this.#renderAssignmentsCollection(vm);
    }
  }

  #renderNotablesCollection(vm: PeopleSubsystemViewModel): string {
    if (vm.notables.length === 0) {
      return `<div class="dm-empty-state">No notables found in domain. Click 'Create New' to register a notable leader or agent.</div>`;
    }

    return `
      <div class="dm-collection-grid">
        ${vm.notables.map((n) => {
          const isSelected = this.#selectedEntity?.type === "notable" && this.#selectedEntity.id === n.notable.id;
          return `
            <div class="dm-card dm-notable-card ${isSelected ? "selected" : ""} ${n.isSecret ? "secret" : ""}"
                 data-action="selectEntity" data-entity-type="notable" data-entity-id="${escapeAttribute(n.notable.id)}">
              <div class="dm-card-badge ${escapeAttribute(n.badgeClass)}">${escapeHtml(n.notable.type)}</div>
              <h4 class="dm-card-title">${escapeHtml(n.status.resolvedName)}</h4>
              ${n.notable.description ? `<div class="dm-card-subtitle">${escapeHtml(n.notable.description)}</div>` : ""}
              ${n.isSecret ? `<span class="dm-badge-secret"><i class="fas fa-eye-slash"></i> Secret</span>` : ""}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  #renderRolesCollection(vm: PeopleSubsystemViewModel): string {
    if (vm.roles.length === 0) {
      return `<div class="dm-empty-state">No roles configured. Click 'Create New' to establish a leadership office or operational group role.</div>`;
    }

    return `
      <div class="dm-collection-list">
        ${vm.roles.map((r) => {
          const isSelected = this.#selectedEntity?.type === "role" && this.#selectedEntity.id === r.evaluation.role.id;
          return `
            <div class="dm-list-row dm-role-row ${isSelected ? "selected" : ""} ${r.isSecret ? "secret" : ""}"
                 data-action="selectEntity" data-entity-type="role" data-entity-id="${escapeAttribute(r.evaluation.role.id)}">
              <div class="dm-row-main">
                <span class="dm-role-name">${escapeHtml(r.evaluation.effectiveLabel)}</span>
                <span class="dm-badge dm-badge-${escapeAttribute(r.statusClass)}">${escapeHtml(r.statusClass)}</span>
                ${r.isSecret ? `<span class="dm-badge-secret"><i class="fas fa-eye-slash"></i> Secret</span>` : ""}
              </div>
              <div class="dm-row-meta">
                <span>Occupants: ${r.evaluation.role.occupants.length}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  #renderOperationalGroupsCollection(vm: PeopleSubsystemViewModel): string {
    if (vm.operationalGroups.length === 0) {
      return `<div class="dm-empty-state">No operational groups registered. Click 'Create New' to muster squads, patrols, or guilds.</div>`;
    }

    return `
      <div class="dm-collection-list">
        ${vm.operationalGroups.map((g) => {
          const isSelected = this.#selectedEntity?.type === "group" && this.#selectedEntity.id === g.group.id;
          return `
            <div class="dm-list-row dm-group-row ${isSelected ? "selected" : ""} ${g.isSecret ? "secret" : ""}"
                 data-action="selectEntity" data-entity-type="group" data-entity-id="${escapeAttribute(g.group.id)}">
              <div class="dm-row-main">
                <span class="dm-group-name">${escapeHtml(g.group.name)}</span>
                <span class="dm-badge dm-badge-${escapeAttribute(g.statusClass)}">${escapeHtml(g.statusClass)}</span>
                ${g.isSecret ? `<span class="dm-badge-secret"><i class="fas fa-eye-slash"></i> Secret</span>` : ""}
              </div>
              <div class="dm-row-meta">
                <span>Size: ${g.group.size} (${escapeHtml(g.group.membershipMode)})</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  #renderPopulationCollection(vm: PeopleSubsystemViewModel): string {
    return `
      <div class="dm-population-view">
        <div class="dm-summary-card">
          <h3>Total Population: ${escapeHtml(vm.population.formattedTotal)}</h3>
          <p>Mode: <strong>${escapeHtml(vm.population.state.mode)}</strong> | Precision: <strong>${escapeHtml(vm.population.resolution.precision)}</strong></p>
        </div>
      </div>
    `;
  }

  #renderAssignmentsCollection(vm: PeopleSubsystemViewModel): string {
    const workforceTypes = Object.values(vm.workforce.types);
    return `
      <div class="dm-assignments-view">
        <h3>Workforce Capacities</h3>
        <div class="dm-workforce-grid">
          ${workforceTypes.map((w) => `
            <div class="dm-wf-card ${w.isOvercommitted ? "overcommitted" : ""}">
              <h4>${escapeHtml(w.workforceTypeId)}</h4>
              <div class="dm-wf-numbers">
                <span>Available: <strong>${w.available}</strong></span>
                <span>Committed: ${w.committed}</span>
                <span>Reserved: ${w.reserved}</span>
                <span>Capacity: ${w.capacity}</span>
              </div>
              ${w.isOvercommitted ? `<div class="dm-badge-alert">OVERCOMMIT</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  #renderInspectorView(vm: PeopleSubsystemViewModel): string {
    if (!this.#selectedEntity) {
      return `
        <div class="dm-inspector-empty">
          <i class="fas fa-info-circle"></i>
          <p>Select an item from the collection to inspect attributes, assignments, and resolution status.</p>
        </div>
      `;
    }

    const { type, id } = this.#selectedEntity;

    if (type === "notable") {
      const n = vm.notables.find((item) => item.notable.id === id);
      if (!n) return `<div class="dm-inspector-empty">Notable not found or hidden.</div>`;
      return `
        <div class="dm-inspector-content">
          <h3>Notable Inspector</h3>
          <div class="dm-inspector-field">
            <label>Name:</label> <span>${escapeHtml(n.status.resolvedName)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>ID:</label> <code>${escapeHtml(n.notable.id)}</code>
          </div>
          <div class="dm-inspector-field">
            <label>Type:</label> <span>${escapeHtml(n.notable.type)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Visibility:</label> <span>${escapeHtml(n.notable.visibility)}</span>
          </div>
          ${n.notable.description ? `<div class="dm-inspector-field"><label>Description:</label> <p>${escapeHtml(n.notable.description)}</p></div>` : ""}
          ${n.notable.tags.length > 0 ? `<div class="dm-inspector-field"><label>Tags:</label> <span>${escapeHtml(n.notable.tags.join(", "))}</span></div>` : ""}
        </div>
      `;
    }

    if (type === "role") {
      const r = vm.roles.find((item) => item.evaluation.role.id === id);
      if (!r) return `<div class="dm-inspector-empty">Role not found or hidden.</div>`;
      return `
        <div class="dm-inspector-content">
          <h3>Role Inspector</h3>
          <div class="dm-inspector-field">
            <label>Title:</label> <span>${escapeHtml(r.evaluation.effectiveLabel)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Definition ID:</label> <code>${escapeHtml(r.evaluation.role.definitionId)}</code>
          </div>
          <div class="dm-inspector-field">
            <label>Status:</label> <span class="dm-badge dm-badge-${escapeAttribute(r.statusClass)}">${escapeHtml(r.statusClass)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Requirements Satisfied:</label> <span>${r.evaluation.isRequirementSatisfied ? "Yes" : "No"}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Occupants (${r.evaluation.role.occupants.length}):</label>
            <ul>
              ${r.evaluation.role.occupants.map((occId) => `<li><code>${escapeHtml(occId)}</code></li>`).join("")}
            </ul>
          </div>
        </div>
      `;
    }

    if (type === "group") {
      const g = vm.operationalGroups.find((item) => item.group.id === id);
      if (!g) return `<div class="dm-inspector-empty">Group not found or hidden.</div>`;
      return `
        <div class="dm-inspector-content">
          <h3>Operational Group Inspector</h3>
          <div class="dm-inspector-field">
            <label>Name:</label> <span>${escapeHtml(g.group.name)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Definition:</label> <code>${escapeHtml(g.group.definitionId)}</code>
          </div>
          <div class="dm-inspector-field">
            <label>Size:</label> <span>${g.group.size} (${escapeHtml(g.group.membershipMode)})</span>
          </div>
          <div class="dm-inspector-field">
            <label>Lifecycle:</label> <span>${escapeHtml(g.group.lifecycle)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Members (${g.group.members.length}):</label>
            <ul>
              ${g.group.members.map((mId) => `<li><code>${escapeHtml(mId)}</code></li>`).join("")}
            </ul>
          </div>
        </div>
      `;
    }

    return `<div class="dm-inspector-empty">Unknown entity type.</div>`;
  }

  openCreateModal(createType: string): { readonly type: string; readonly html: string } {
    const html = this.renderCreateModal(createType);
    return { type: createType, html };
  }

  renderCreateModal(createType: string): string {
    switch (createType) {
      case "notables":
        return `
          <div class="dm-modal dm-create-notable-modal" data-modal-type="notable">
            <h3>Create Notable</h3>
            <form data-action="submitCreate" data-create-type="notable">
              <label>Name: <input type="text" name="name" required /></label>
              <label>Type: 
                <select name="type">
                  <option value="inline">Inline</option>
                  <option value="actor">Actor</option>
                </select>
              </label>
              <label>Actor UUID (optional): <input type="text" name="actorUuid" /></label>
              <label>Description: <textarea name="description"></textarea></label>
              <label>Visibility:
                <select name="visibility">
                  <option value="public">Public</option>
                  <option value="secret">Secret</option>
                </select>
              </label>
              <button type="submit" class="dm-btn dm-btn-primary">Create</button>
            </form>
          </div>
        `;
      case "roles":
        return `
          <div class="dm-modal dm-create-role-modal" data-modal-type="role">
            <h3>Create Role</h3>
            <form data-action="submitCreate" data-create-type="role">
              <label>Title/Label: <input type="text" name="name" required /></label>
              <label>Definition ID: <input type="text" name="definitionId" required /></label>
              <label>Scope:
                <select name="scope">
                  <option value="domain">Domain</option>
                  <option value="operational-group">Operational Group</option>
                </select>
              </label>
              <button type="submit" class="dm-btn dm-btn-primary">Create</button>
            </form>
          </div>
        `;
      case "operationalGroups":
        return `
          <div class="dm-modal dm-create-group-modal" data-modal-type="group">
            <h3>Create Operational Group</h3>
            <form data-action="submitCreate" data-create-type="group">
              <label>Name: <input type="text" name="name" required /></label>
              <label>Type: <input type="text" name="type" required /></label>
              <label>Membership Mode:
                <select name="membershipMode">
                  <option value="abstract">Abstract</option>
                  <option value="explicit">Explicit</option>
                </select>
              </label>
              <button type="submit" class="dm-btn dm-btn-primary">Create</button>
            </form>
          </div>
        `;
      default:
        return `
          <div class="dm-modal dm-create-default-modal">
            <h3>Create ${escapeHtml(createType)}</h3>
            <form data-action="submitCreate" data-create-type="${escapeAttribute(createType)}">
              <label>Name: <input type="text" name="name" required /></label>
              <button type="submit" class="dm-btn dm-btn-primary">Create</button>
            </form>
          </div>
        `;
    }
  }
}

const BaseApp =
  (globalThis as any).foundry?.applications?.api?.ApplicationV2 ??
  class MockApplicationV2 {
    options: any;
    constructor(options: any = {}) {
      this.options = options;
    }
    async render(force?: boolean): Promise<this> {
      return this;
    }
    async close(): Promise<void> {}
  };

/**
 * Foundry VTT V13 ApplicationV2 implementation for People & Governance.
 */
export class PeopleApplication extends BaseApp {
  static DEFAULT_OPTIONS = {
    id: "domain-manager-people-{id}",
    classes: ["domain-manager", "dm-people-app-v2"],
    tag: "div",
    window: {
      title: "People & Governance",
      icon: "fas fa-users-crown",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 820,
      height: 640
    },
    actions: {
      selectTab: PeopleApplication.#onSelectTab,
      selectEntity: PeopleApplication.#onSelectEntity,
      openCreateModal: PeopleApplication.#onOpenCreateModal,
      submitCreate: PeopleApplication.#onSubmitCreate
    }
  };

  readonly #controller: PeopleApplicationController;
  #element: HTMLElement | null = null;

  constructor(options: PeopleAppOptions) {
    super(options);
    this.#controller = new PeopleApplicationController(options);
  }

  get controller(): PeopleApplicationController {
    return this.#controller;
  }

  async _prepareContext(options?: any): Promise<{ viewModel: PeopleSubsystemViewModel | null; error: any }> {
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

  attachEventListeners(element: HTMLElement): void {
    this.#element = element;
    element.addEventListener("click", async (event) => {
      const target = (event.target as HTMLElement).closest?.("[data-action]") as HTMLElement | null;
      if (!target) return;
      const action = target.getAttribute("data-action");

      if (action === "selectTab") {
        const tab = target.getAttribute("data-tab") as PeopleTab;
        if (tab) {
          this.#controller.selectTab(tab);
          const vmRes = await this.#controller.loadViewModel();
          if (vmRes.ok) {
            element.innerHTML = this.#controller.render(vmRes.value);
          }
        }
      } else if (action === "selectEntity") {
        const type = target.getAttribute("data-entity-type") as SelectedEntity["type"];
        const id = target.getAttribute("data-entity-id");
        if (type && id) {
          this.#controller.selectEntity(type, id);
          const vmRes = await this.#controller.loadViewModel();
          if (vmRes.ok) {
            element.innerHTML = this.#controller.render(vmRes.value);
          }
        }
      } else if (action === "openCreateModal") {
        const createType = target.getAttribute("data-create-type") ?? this.#controller.activeTab;
        this.openCreateModal(createType);
      }
    });
  }

  openCreateModal(createType: string): { readonly type: string; readonly html: string } {
    const modal = this.#controller.openCreateModal(createType);
    if (this.#element) {
      const modalContainer = (globalThis as any).document?.createElement?.("div");
      if (modalContainer) {
        modalContainer.className = "dm-modal-backdrop";
        modalContainer.innerHTML = modal.html;
        this.#element.appendChild(modalContainer);
      }
    }
    return modal;
  }

  static async #onSelectTab(this: PeopleApplication, event: Event, target: HTMLElement): Promise<void> {
    const tab = target.getAttribute("data-tab") as PeopleTab;
    if (tab) {
      this.#controller.selectTab(tab);
      await (this as any).render?.();
    }
  }

  static async #onSelectEntity(this: PeopleApplication, event: Event, target: HTMLElement): Promise<void> {
    const type = target.getAttribute("data-entity-type") as SelectedEntity["type"];
    const id = target.getAttribute("data-entity-id");
    if (type && id) {
      this.#controller.selectEntity(type, id);
      await (this as any).render?.();
    }
  }

  static async #onOpenCreateModal(this: PeopleApplication, event: Event, target: HTMLElement): Promise<void> {
    const createType = target.getAttribute("data-create-type") ?? this.#controller.activeTab;
    this.openCreateModal(createType);
  }

  static async #onSubmitCreate(this: PeopleApplication, event: Event, target: HTMLElement): Promise<void> {
    await this.#controller.loadViewModel();
    await (this as any).render?.();
  }
}

