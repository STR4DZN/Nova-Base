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

  get viewModel(): PeopleSubsystemViewModel | null {
    return this.#lastViewModel;
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
    await this.loadViewModel();
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
            <form data-create-type="notable">
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
                  <option value="public" selected>Public</option>
                  <option value="restricted">Restricted</option>
                  <option value="secret">Secret</option>
                </select>
              </label>
              <div class="dm-modal-actions">
                <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
                <button type="submit" class="dm-btn dm-btn-primary">Create</button>
              </div>
            </form>
          </div>
        `;
      case "roles":
        return `
          <div class="dm-modal dm-create-role-modal" data-modal-type="role">
            <h3>Create Role</h3>
            <form data-create-type="role">
              <label>Title/Label: <input type="text" name="name" required /></label>
              <label>Definition ID: <input type="text" name="definitionId" required /></label>
              <label>Scope:
                <select name="scope">
                  <option value="domain" selected>Domain</option>
                  <option value="operational-group">Operational Group</option>
                </select>
              </label>
              <label>Visibility:
                <select name="visibility">
                  <option value="public" selected>Public</option>
                  <option value="restricted">Restricted</option>
                  <option value="secret">Secret</option>
                </select>
              </label>
              <div class="dm-modal-actions">
                <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
                <button type="submit" class="dm-btn dm-btn-primary">Create</button>
              </div>
            </form>
          </div>
        `;
      case "operationalGroups":
        return `
          <div class="dm-modal dm-create-group-modal" data-modal-type="group">
            <h3>Create Operational Group</h3>
            <form data-create-type="group">
              <label>Name: <input type="text" name="name" required /></label>
              <label>Definition ID: <input type="text" name="definitionId" required /></label>
              <label>Membership Mode:
                <select name="membershipMode">
                  <option value="abstract" selected>Abstract</option>
                  <option value="explicit">Explicit</option>
                </select>
              </label>
              <label>Visibility:
                <select name="visibility">
                  <option value="public" selected>Public</option>
                  <option value="restricted">Restricted</option>
                  <option value="secret">Secret</option>
                </select>
              </label>
              <div class="dm-modal-actions">
                <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
                <button type="submit" class="dm-btn dm-btn-primary">Create</button>
              </div>
            </form>
          </div>
        `;
      default:
        return `
          <div class="dm-modal dm-create-default-modal">
            <h3>Create ${escapeHtml(createType)}</h3>
            <form data-create-type="${escapeAttribute(createType)}">
              <label>Name: <input type="text" name="name" required /></label>
              <div class="dm-modal-actions">
                <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
                <button type="submit" class="dm-btn dm-btn-primary">Create</button>
              </div>
            </form>
          </div>
        `;
    }
  }
}

function extractFormData(form: HTMLElement): Record<string, string> {
  const data: Record<string, string> = {};
  if (
    typeof FormData !== "undefined" &&
    typeof (globalThis as any).HTMLFormElement !== "undefined" &&
    form instanceof (globalThis as any).HTMLFormElement
  ) {
    try {
      const fd = new FormData(form as HTMLFormElement);
      (fd as any).forEach?.((val: unknown, key: string) => {
        if (typeof val === "string") {
          data[key] = val.trim();
        }
      });
      return data;
    } catch {}
  }

  const elements = (form as any).querySelectorAll?.("input, select, textarea") ?? [];
  elements.forEach((el: any) => {
    const name = el.getAttribute?.("name") || el.name;
    if (!name) return;
    let value = el.value;
    if (el.tagName === "SELECT" && (!value || value === "")) {
      const selectedOption = el.querySelector?.("option[selected]") ?? el.querySelector?.("option");
      if (selectedOption) {
        value = selectedOption.getAttribute?.("value") ?? selectedOption.value ?? "";
      }
    }
    if (el.tagName === "TEXTAREA" && (!value || value === "")) {
      if (el.textContent) {
        value = el.textContent;
      }
    }
    if (value === undefined || value === null || value === "") {
      const attrVal = el.getAttribute?.("value");
      if (attrVal !== undefined && attrVal !== null) {
        value = attrVal;
      }
    }
    if (value !== undefined && value !== null) {
      data[name] = String(value).trim();
    }
  });
  return data;
}

function matchesSelector(el: any, sel: string): boolean {
  sel = sel.trim();
  if (sel.includes(",")) {
    return sel.split(",").some((part) => matchesSelector(el, part.trim()));
  }
  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    const classes = (el.className || "").split(/\s+/);
    return classes.includes(cls);
  }
  if (sel.startsWith("[")) {
    const attrMatch = sel.match(/^\[([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]$/);
    if (attrMatch) {
      const attrName = attrMatch[1];
      const expectedVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4];
      if (expectedVal === undefined) return el.hasAttribute?.(attrName) ?? false;
      return el.getAttribute?.(attrName) === expectedVal;
    }
  }
  if (sel.includes("[")) {
    const parts = sel.match(/^([a-zA-Z0-9_-]+)(\[.+\])$/);
    if (parts) {
      return matchesSelector(el, parts[1]) && matchesSelector(el, parts[2]);
    }
  }
  return (el.tagName || "").toLowerCase() === sel.toLowerCase();
}

function querySelectorMock(root: any, selector: string): any {
  if (selector.includes(",")) {
    const parts = selector.split(",").map((s) => s.trim());
    for (const part of parts) {
      const found = querySelectorMock(root, part);
      if (found) return found;
    }
    return null;
  }
  for (const child of root.children ?? []) {
    if (matchesSelector(child, selector)) return child;
    const found = querySelectorMock(child, selector);
    if (found) return found;
  }
  return null;
}

function querySelectorAllMock(root: any, selector: string): any[] {
  if (selector.includes(",")) {
    const parts = selector.split(",").map((s) => s.trim());
    const set = new Set<any>();
    for (const part of parts) {
      for (const el of querySelectorAllMock(root, part)) {
        set.add(el);
      }
    }
    return Array.from(set);
  }
  const results: any[] = [];
  for (const child of root.children ?? []) {
    if (matchesSelector(child, selector)) results.push(child);
    results.push(...querySelectorAllMock(child, selector));
  }
  return results;
}

export function createMockElement(tagName: string, props: any = {}): any {
  const listeners: Record<string, Function[]> = {};
  const children: any[] = [];
  const attributes: Record<string, string> = {};
  let innerHtml = props.innerHTML ?? "";

  const element = {
    tagName: tagName.toUpperCase(),
    className: props.className ?? "",
    attributes,
    children,
    parent: null as any,
    value: props.value ?? "",
    name: props.name ?? "",
    ownerDocument: {
      createElement: (tag: string) => createMockElement(tag)
    },
    get innerHTML(): string {
      return innerHtml;
    },
    set innerHTML(val: string) {
      innerHtml = val;
      parseHtmlToMockTree(element, val);
    },
    get textContent(): string {
      return innerHtml.replace(/<[^>]*>/g, "");
    },
    set textContent(val: string) {
      innerHtml = val;
    },
    getAttribute(name: string): string | null {
      return attributes[name] ?? null;
    },
    setAttribute(name: string, value: string): void {
      attributes[name] = String(value);
      if (name === "class") element.className = String(value);
      if (name === "name") element.name = String(value);
      if (name === "value") element.value = String(value);
    },
    hasAttribute(name: string): boolean {
      return Object.prototype.hasOwnProperty.call(attributes, name);
    },
    appendChild(child: any): any {
      child.parent = element;
      children.push(child);
      return child;
    },
    prepend(child: any): any {
      child.parent = element;
      children.unshift(child);
      return child;
    },
    remove(): void {
      if (element.parent) {
        const idx = element.parent.children.indexOf(element);
        if (idx !== -1) element.parent.children.splice(idx, 1);
        element.parent = null;
      }
    },
    replaceChildren(...newChildren: any[]): void {
      children.length = 0;
      for (const c of newChildren) {
        c.parent = element;
        children.push(c);
      }
    },
    addEventListener(type: string, listener: Function): void {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(listener);
    },
    dispatchEvent(event: any): boolean {
      event.target = element;
      let defaultPrevented = false;
      if (!event.preventDefault) {
        event.preventDefault = () => {
          defaultPrevented = true;
        };
      }
      let curr: any = element;
      while (curr) {
        const handlers = curr._listeners?.[event.type] ?? [];
        for (const h of handlers) {
          h(event);
        }
        curr = curr.parent;
      }
      if (!defaultPrevented && event.type === "click") {
        const isBtn = element.tagName === "BUTTON" || (element.tagName === "INPUT" && attributes.type === "submit");
        const btnType = attributes.type ?? (element.tagName === "BUTTON" ? "submit" : "button");
        if (isBtn && btnType === "submit") {
          const form = element.closest?.("form");
          if (form) {
            form.dispatchEvent({ type: "submit", target: form });
          }
        }
      }
      return true;
    },
    async dispatchEventAsync(event: any): Promise<boolean> {
      event.target = element;
      let defaultPrevented = false;
      if (!event.preventDefault) {
        event.preventDefault = () => {
          defaultPrevented = true;
        };
      }
      let curr: any = element;
      while (curr) {
        const handlers = curr._listeners?.[event.type] ?? [];
        for (const h of handlers) {
          await h(event);
        }
        curr = curr.parent;
      }
      if (!defaultPrevented && event.type === "click") {
        const isBtn = element.tagName === "BUTTON" || (element.tagName === "INPUT" && attributes.type === "submit");
        const btnType = attributes.type ?? (element.tagName === "BUTTON" ? "submit" : "button");
        if (isBtn && btnType === "submit") {
          const form = element.closest?.("form");
          if (form) {
            await form.dispatchEventAsync({ type: "submit", target: form });
          }
        }
      }
      return true;
    },
    click(): void {
      element.dispatchEvent({ type: "click" });
    },
    async clickAsync(): Promise<void> {
      await element.dispatchEventAsync({ type: "click" });
    },
    querySelector(selector: string): any {
      return querySelectorMock(element, selector);
    },
    querySelectorAll(selector: string): any[] {
      return querySelectorAllMock(element, selector);
    },
    closest(selector: string): any {
      let curr: any = element;
      while (curr) {
        if (matchesSelector(curr, selector)) return curr;
        curr = curr.parent;
      }
      return null;
    },
    get _listeners() {
      return listeners;
    }
  };

  if (props.attributes) {
    for (const [k, v] of Object.entries(props.attributes)) {
      element.setAttribute(k, String(v));
    }
  }

  if (innerHtml) {
    parseHtmlToMockTree(element, innerHtml);
  }

  return element;
}

function parseHtmlToMockTree(root: any, html: string): void {
  root.children.length = 0;
  const selfClosing = new Set(["input", "img", "br", "hr", "meta", "link"]);
  const stack: any[] = [root];

  const tokenRegex = /<(\/?)([a-zA-Z0-9_-]+)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(html)) !== null) {
    const isClosing = match[1] === "/";
    const tagName = match[2].toUpperCase();
    const rawAttrs = match[3] ?? "";

    if (isClosing) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName === tagName) {
          while (stack.length >= i + 1) {
            stack.pop();
          }
          break;
        }
      }
      continue;
    }

    const isSelfClosing = rawAttrs.trim().endsWith("/") || selfClosing.has(tagName.toLowerCase());

    const child = createMockElement(tagName);
    child.parent = stack[stack.length - 1];

    const attrRegex = /([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const attrName = attrMatch[1];
      if (attrName === "/") continue;
      const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      child.setAttribute(attrName, attrVal);
      if (attrName === "class") child.className = attrVal;
      if (attrName === "name") child.name = attrVal;
      if (attrName === "value") child.value = attrVal;
    }

    stack[stack.length - 1].appendChild(child);

    if (!isSelfClosing) {
      stack.push(child);
    }
  }
}

const BaseApp =
  (globalThis as any).foundry?.applications?.api?.ApplicationV2 ??
  class MockApplicationV2 {
    options: any;
    element: any = null;

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
      } else if (result && typeof content.replaceChildren === "function") {
        content.replaceChildren(result);
      }
    }

    _attachActionListeners(element: any): void {
      if (!element || element.__actionsBound) return;
      element.__actionsBound = true;
      const actions = (this.constructor as any).DEFAULT_OPTIONS?.actions ?? {};
      element.addEventListener("click", async (event: any) => {
        const actionEl = event.target?.closest?.("[data-action]");
        if (!actionEl) return;
        const actionName = actionEl.getAttribute?.("data-action");
        if (actionName && typeof actions[actionName] === "function") {
          event.preventDefault?.();
          await actions[actionName].call(this, event, actionEl);
        }
      });
    }

    _onRender(context: any, options?: any): void {}

    async render(force?: boolean, options?: any): Promise<this> {
      if (!this.element) {
        if (typeof (globalThis as any).document?.createElement === "function") {
          this.element = (globalThis as any).document.createElement("div");
        } else {
          this.element = createMockElement("div", {
            className: "domain-manager dm-people-app-v2"
          });
        }
      }
      const context = await this._prepareContext(options);
      const result = await this._renderHTML(context, options);
      this._replaceHTML(result, this.element, options);
      this._attachActionListeners(this.element);
      this._onRender(context, options);
      return this;
    }

    async close(options?: any): Promise<void> {
      this.element = null;
    }
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
      closeModal: PeopleApplication.#onCloseModal
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

  get element(): HTMLElement | null {
    return ((this as any)._element as HTMLElement | null) ?? this.#element;
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
    const el = this.element ?? (this as any)._element ?? this.#element;
    if (el) {
      this.attachEventListeners(el);
    }
  }

  attachEventListeners(element: HTMLElement): void {
    this.#element = element;

    // Attach submit listeners to forms that haven't been bound yet
    const forms = element.querySelectorAll?.("form") ?? [];
    forms.forEach((form: any) => {
      if (form.__submitBound) return;
      form.__submitBound = true;
      form.addEventListener?.("submit", async (event: any) => {
        event.preventDefault?.();
        await PeopleApplication.#onSubmitCreate.call(this, event, form as HTMLElement);
      });
    });
  }

  closeModal(): void {
    const el = this.element ?? this.#element;
    if (el) {
      const backdrops = el.querySelectorAll?.(".dm-modal-backdrop") ?? [];
      backdrops.forEach((b: any) => b.remove?.());
    }
  }

  openCreateModal(createType: string): { readonly type: string; readonly html: string } {
    this.closeModal();
    const modal = this.#controller.openCreateModal(createType);
    const el = this.element ?? this.#element;
    if (el) {
      let modalContainer: any;
      if (typeof (globalThis as any).document?.createElement === "function") {
        modalContainer = (globalThis as any).document.createElement("div");
      } else {
        modalContainer = createMockElement("div", { className: "dm-modal-backdrop" });
      }
      modalContainer.className = "dm-modal-backdrop";
      modalContainer.innerHTML = modal.html;
      el.appendChild(modalContainer);
      this.attachEventListeners(el);
    }
    return modal;
  }

  static async #onSelectTab(this: PeopleApplication, event: Event, target: HTMLElement): Promise<void> {
    const tab = target.getAttribute?.("data-tab") as PeopleTab;
    if (tab) {
      this.#controller.selectTab(tab);
      await this.#controller.loadViewModel();
      await (this as any).render?.();
    }
  }

  static async #onSelectEntity(this: PeopleApplication, event: Event, target: HTMLElement): Promise<void> {
    const type = target.getAttribute?.("data-entity-type") as SelectedEntity["type"];
    const id = target.getAttribute?.("data-entity-id");
    if (type && id) {
      this.#controller.selectEntity(type, id);
      await this.#controller.loadViewModel();
      await (this as any).render?.();
    }
  }

  static async #onOpenCreateModal(this: PeopleApplication, event: Event, target: HTMLElement): Promise<void> {
    const createType = target.getAttribute?.("data-create-type") ?? this.#controller.activeTab;
    this.openCreateModal(createType);
  }

  static async #onCloseModal(this: PeopleApplication, event: Event, target: HTMLElement): Promise<void> {
    event?.preventDefault?.();
    this.closeModal();
  }

  static async #onSubmitCreate(this: PeopleApplication, event: Event, target: HTMLElement): Promise<void> {
    event?.preventDefault?.();
    const form = (target.tagName === "FORM" ? target : target.closest?.("form")) as HTMLFormElement | null;
    if (!form) return;

    const createType = form.getAttribute?.("data-create-type") ?? target.getAttribute?.("data-create-type") ?? "";
    const formData = extractFormData(form);

    let result: Result<unknown>;
    switch (createType) {
      case "notables":
      case "notable": {
        result = await this.#controller.dispatchCreateNotable({
          name: formData.name,
          type: (formData.type as any) || "inline",
          actorUuid: formData.actorUuid || undefined,
          description: formData.description || undefined,
          visibility: (formData.visibility as any) || "public"
        });
        break;
      }
      case "roles":
      case "role": {
        result = await this.#controller.dispatchCreateRole({
          definitionId: formData.definitionId,
          customLabel: formData.name || formData.customLabel || undefined,
          scope: (formData.scope as any) || "domain",
          visibility: (formData.visibility as any) || "public"
        });
        break;
      }
      case "group":
      case "operationalGroups": {
        result = await this.#controller.dispatchCreateOperationalGroup({
          name: formData.name,
          definitionId: formData.definitionId || formData.type,
          membershipMode: (formData.membershipMode as any) || "abstract",
          visibility: (formData.visibility as any) || "public"
        });
        break;
      }
      default: {
        result = err(
          createPublicError({
            code: "DM_UNKNOWN_CREATE_TYPE",
            category: "validation",
            message: `Unknown create type: ${createType}`
          })
        );
      }
    }

    if (!result.ok) {
      const errorMsg = result.error.message;
      const notify = (globalThis as any).ui?.notifications?.error;
      if (typeof notify === "function") {
        notify(`Failed to create ${createType}: ${errorMsg}`);
      }
      let errorContainer = form.querySelector?.(".dm-form-error") as HTMLElement | null;
      if (!errorContainer && form.ownerDocument) {
        errorContainer = form.ownerDocument.createElement("div");
        errorContainer.className = "dm-form-error";
        form.prepend?.(errorContainer);
      }
      if (errorContainer) {
        errorContainer.textContent = errorMsg;
      }
      return;
    }

    this.closeModal();
    await this.#controller.loadViewModel();
    await (this as any).render?.();
  }
}

