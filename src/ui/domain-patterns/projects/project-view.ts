import type { ProjectDefinition } from "../../../projects/types/project-types.js";
import type { ProjectViewModel, ProjectsSubsystemViewModel } from "./project-presenter.js";

/**
 * Escapes characters for safe inclusion in HTML text nodes.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escapes characters for safe inclusion in HTML attribute values.
 */
export function escapeAttribute(value: unknown): string {
  return escapeHtml(value);
}

export function renderProjectsTableHtml(projects: readonly ProjectViewModel[]): string {
  if (projects.length === 0) {
    return `<div class="dm-empty-state">No projects found.</div>`;
  }

  return `
    <table class="dm-projects-table">
      <thead>
        <tr>
          <th>Project</th>
          <th>Definition</th>
          <th>Status</th>
          <th>Progress</th>
          <th>Target</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${projects.map((p) => {
          const hasBlockers = p.blockers.length > 0;
          return `
            <tr class="dm-project-row ${escapeAttribute(p.statusBadgeClass)}" data-project-id="${escapeAttribute(p.id)}">
              <td class="dm-cell-name">
                <span class="dm-project-label">${escapeHtml(p.label)}</span>
                ${p.isSecret ? `<span class="dm-badge dm-badge-secret">Secret</span>` : ""}
                ${hasBlockers ? `<span class="dm-badge dm-badge-blocked" title="Blocked">Blocked (${p.blockers.length})</span>` : ""}
              </td>
              <td class="dm-cell-def">
                <code>${escapeHtml(p.definitionId)}</code>
              </td>
              <td class="dm-cell-status">
                <span class="dm-badge ${escapeAttribute(p.statusBadgeClass)}">${escapeHtml(p.lifecycle)}</span>
              </td>
              <td class="dm-cell-progress">
                <div class="dm-progress-container">
                  <div class="dm-progress-bar" style="width: ${p.progressPercent}%;"></div>
                  <span class="dm-progress-text">${p.workCompleted} / ${p.workRequired} (${p.progressPercent}%)</span>
                </div>
              </td>
              <td class="dm-cell-target">
                <span>${escapeHtml(p.targetRef)}</span>
              </td>
              <td class="dm-cell-actions">
                <button type="button" class="dm-btn dm-btn-sm" data-action="openProjectDetail" data-project-id="${escapeAttribute(p.id)}" title="Inspect Project">
                  <i class="fas fa-search"></i> Inspect
                </button>
                ${p.canAdvance ? `
                  <button type="button" class="dm-btn dm-btn-sm dm-btn-primary" data-action="advanceProject" data-project-id="${escapeAttribute(p.id)}" title="Advance Project">
                    <i class="fas fa-play"></i> Advance
                  </button>
                ` : ""}
                ${p.canPause ? `
                  <button type="button" class="dm-btn dm-btn-sm" data-action="pauseProject" data-project-id="${escapeAttribute(p.id)}" title="Pause Project">
                    <i class="fas fa-pause"></i> Pause
                  </button>
                ` : ""}
                ${p.canResume ? `
                  <button type="button" class="dm-btn dm-btn-sm" data-action="resumeProject" data-project-id="${escapeAttribute(p.id)}" title="Resume Project">
                    <i class="fas fa-play"></i> Resume
                  </button>
                ` : ""}
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

export function renderProjectDetailModalHtml(project: ProjectViewModel, viewerIsGm: boolean): string {
  const hasBlockers = project.blockers.length > 0;

  return `
    <div class="dm-modal dm-project-detail-modal" data-project-id="${escapeAttribute(project.id)}">
      <header class="dm-modal-header">
        <h3>Project Inspector: ${escapeHtml(project.label)}</h3>
        <button type="button" class="dm-btn-close" data-action="closeModal">&times;</button>
      </header>

      <div class="dm-modal-body">
        <section class="dm-detail-summary">
          <div class="dm-summary-grid">
            <div class="dm-stat">
              <span class="dm-stat-label">Status</span>
              <span class="dm-badge ${escapeAttribute(project.statusBadgeClass)}">${escapeHtml(project.lifecycle)}</span>
            </div>
            <div class="dm-stat">
              <span class="dm-stat-label">Definition</span>
              <code>${escapeHtml(project.definitionId)}</code>
            </div>
            <div class="dm-stat">
              <span class="dm-stat-label">Target</span>
              <span>${escapeHtml(project.targetRef)}</span>
            </div>
            <div class="dm-stat">
              <span class="dm-stat-label">Revision</span>
              <span>v${project.revision}</span>
            </div>
          </div>

          <div class="dm-progress-section">
            <h4>Work Progress</h4>
            <div class="dm-progress-container dm-progress-large">
              <div class="dm-progress-bar" style="width: ${project.progressPercent}%;"></div>
              <span class="dm-progress-text">${project.workCompleted} / ${project.workRequired} units (${project.progressPercent}%)</span>
            </div>
          </div>
        </section>

        ${hasBlockers ? `
          <section class="dm-section dm-blockers-section">
            <h4 class="dm-danger-text"><i class="fas fa-exclamation-triangle"></i> Active Blockers</h4>
            <ul class="dm-blocker-list">
              ${project.blockers.map((b) => `
                <li class="dm-blocker-item ${b.isSecret ? "dm-secret" : ""}">
                  <span class="dm-blocker-category">[${escapeHtml(b.category)}]</span>
                  <span class="dm-blocker-message">${escapeHtml(b.message)}</span>
                  ${b.isSecret ? `<span class="dm-badge dm-badge-secret">Secret</span>` : ""}
                </li>
              `).join("")}
            </ul>
          </section>
        ` : ""}

        ${project.workforce.length > 0 ? `
          <section class="dm-section dm-workforce-section">
            <h4>Workforce Requirements</h4>
            <div class="dm-workforce-grid">
              ${project.workforce.map((w) => `
                <div class="dm-wf-stat ${w.satisfied ? "dm-satisfied" : "dm-unsatisfied"}">
                  <span class="dm-wf-type">${escapeHtml(w.typeId)}</span>
                  <span class="dm-wf-numbers">${w.allocated} / ${w.required}</span>
                  <span class="dm-badge ${w.satisfied ? "dm-badge-healthy" : "dm-badge-danger"}">
                    ${w.satisfied ? "Met" : "Deficit"}
                  </span>
                </div>
              `).join("")}
            </div>
          </section>
        ` : ""}

        ${project.requirements.length > 0 ? `
          <section class="dm-section dm-requirements-section">
            <h4>Prerequisites & Requirements</h4>
            <ul class="dm-req-list">
              ${project.requirements.map((r) => `
                <li class="dm-req-item dm-req-${escapeAttribute(r.status)}">
                  <span class="dm-req-kind">${escapeHtml(r.kind)}</span>
                  <span class="dm-req-target">${escapeHtml(r.targetRef)}</span>
                  <span class="dm-badge dm-badge-${escapeAttribute(r.status)}">${escapeHtml(r.status)}</span>
                </li>
              `).join("")}
            </ul>
          </section>
        ` : ""}

        ${project.description ? `
          <section class="dm-section dm-desc-section">
            <h4>Description</h4>
            <p>${escapeHtml(project.description)}</p>
          </section>
        ` : ""}
      </div>

      <footer class="dm-modal-footer">
        ${project.canAdvance ? `
          <form class="dm-advance-inline-form" data-form-type="advanceProject" data-project-id="${escapeAttribute(project.id)}">
            <input type="number" name="progressUnits" value="1" min="1" max="1000" class="dm-input-sm" style="width: 70px;" />
            <button type="submit" class="dm-btn dm-btn-primary">
              <i class="fas fa-hammer"></i> Commit Advance
            </button>
          </form>
        ` : ""}

        ${project.canPause ? `
          <button type="button" class="dm-btn" data-action="pauseProject" data-project-id="${escapeAttribute(project.id)}">
            <i class="fas fa-pause"></i> Pause
          </button>
        ` : ""}

        ${project.canResume ? `
          <button type="button" class="dm-btn dm-btn-success" data-action="resumeProject" data-project-id="${escapeAttribute(project.id)}">
            <i class="fas fa-play"></i> Resume
          </button>
        ` : ""}

        ${project.canCancel ? `
          <button type="button" class="dm-btn dm-btn-danger" data-action="cancelProject" data-project-id="${escapeAttribute(project.id)}">
            <i class="fas fa-times"></i> Cancel Project
          </button>
        ` : ""}

        <button type="button" class="dm-btn" data-action="closeModal">Close</button>
      </footer>
    </div>
  `;
}

export function renderProjectStartModalHtml(
  domainUuid: string,
  definitions: readonly ProjectDefinition[]
): string {
  return `
    <div class="dm-modal dm-project-start-modal">
      <header class="dm-modal-header">
        <h3>Start New Project</h3>
        <button type="button" class="dm-btn-close" data-action="closeModal">&times;</button>
      </header>

      <form data-form-type="startProject" data-domain-uuid="${escapeAttribute(domainUuid)}">
        <div class="dm-modal-body">
          <div class="dm-form-group">
            <label for="dm-project-definition">Project Template / Definition</label>
            <select id="dm-project-definition" name="definitionId" required>
              <option value="">-- Select a definition --</option>
              ${definitions.map((d) => `
                <option value="${escapeAttribute(d.id)}" data-work="${d.defaultWorkRequired}">
                  ${escapeHtml(d.label)} (${d.defaultWorkRequired} units) ${d.category ? `- ${escapeHtml(d.category)}` : ""}
                </option>
              `).join("")}
            </select>
          </div>

          <div class="dm-form-group">
            <label for="dm-project-name">Project Label / Name</label>
            <input type="text" id="dm-project-name" name="label" placeholder="Custom project name (optional)" />
          </div>

          <div class="dm-form-group">
            <label for="dm-project-target">Target Reference</label>
            <input type="text" id="dm-project-target" name="targetRef" value="${escapeAttribute(domainUuid)}" placeholder="Target entity ref or domain UUID" />
          </div>

          <div class="dm-form-group">
            <label for="dm-project-work">Total Work Required</label>
            <input type="number" id="dm-project-work" name="workRequired" min="1" value="10" required />
          </div>

          <div class="dm-form-group">
            <label for="dm-project-state">Initial State</label>
            <select id="dm-project-state" name="initialState">
              <option value="active">Active (Ready to advance)</option>
              <option value="planned">Planned (Draft)</option>
            </select>
          </div>
        </div>

        <footer class="dm-modal-footer">
          <button type="submit" class="dm-btn dm-btn-primary">
            <i class="fas fa-play"></i> Initialize & Start
          </button>
          <button type="button" class="dm-btn" data-action="closeModal">Cancel</button>
        </footer>
      </form>
    </div>
  `;
}

export function renderProjectsSubsystemHtml(vm: ProjectsSubsystemViewModel): string {
  return `
    <div class="dm-projects-subsystem" data-domain-uuid="${escapeAttribute(vm.domainUuid)}">
      <header class="dm-subsystem-header">
        <div class="dm-header-title">
          <h2>Projects & Construction</h2>
          <span class="dm-header-subtitle">Domain Initiatives, Infrastructure & Engineering</span>
        </div>

        <div class="dm-summary-counters">
          <div class="dm-counter-card">
            <span class="dm-counter-value">${vm.totalCount}</span>
            <span class="dm-counter-label">Total</span>
          </div>
          <div class="dm-counter-card dm-counter-active">
            <span class="dm-counter-value">${vm.activeCount}</span>
            <span class="dm-counter-label">Active</span>
          </div>
          <div class="dm-counter-card dm-counter-paused">
            <span class="dm-counter-value">${vm.pausedCount}</span>
            <span class="dm-counter-label">Paused</span>
          </div>
          <div class="dm-counter-card dm-counter-blocked">
            <span class="dm-counter-value">${vm.blockedCount}</span>
            <span class="dm-counter-label">Blocked</span>
          </div>
          <div class="dm-counter-card dm-counter-completed">
            <span class="dm-counter-value">${vm.completedCount}</span>
            <span class="dm-counter-label">Completed</span>
          </div>
        </div>
      </header>

      <div class="dm-toolbar">
        <div class="dm-toolbar-filters">
          <label class="dm-filter-label">Filter:</label>
          <select name="filterLifecycle" data-action="filterProjects" class="dm-select-sm">
            <option value="all" ${vm.filterLifecycle === "all" ? "selected" : ""}>All Lifecycles</option>
            <option value="active" ${vm.filterLifecycle === "active" ? "selected" : ""}>Active</option>
            <option value="paused" ${vm.filterLifecycle === "paused" ? "selected" : ""}>Paused</option>
            <option value="blocked" ${vm.filterLifecycle === "blocked" ? "selected" : ""}>Blocked</option>
            <option value="completed" ${vm.filterLifecycle === "completed" ? "selected" : ""}>Completed</option>
            <option value="cancelled" ${vm.filterLifecycle === "cancelled" ? "selected" : ""}>Cancelled</option>
          </select>

          <input
            type="text"
            placeholder="Search projects..."
            data-action="searchProjects"
            value="${escapeAttribute(vm.searchTerm)}"
            class="dm-input-sm dm-search-input"
          />
        </div>

        <div class="dm-toolbar-actions">
          <button type="button" class="dm-btn dm-btn-primary dm-btn-sm" data-action="openStartModal">
            <i class="fas fa-plus"></i> Start Project
          </button>
        </div>
      </div>

      <main class="dm-subsystem-content">
        ${renderProjectsTableHtml(vm.projects)}
      </main>
    </div>
  `;
}
