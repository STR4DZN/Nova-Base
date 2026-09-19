import type { FacilityDefinition } from "../../../facilities/types/facility-types.js";
import type { FacilitiesSubsystemViewModel, FacilityViewModel } from "./facility-presenter.js";

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

export function renderFacilitiesTableHtml(facilities: readonly FacilityViewModel[]): string {
  if (facilities.length === 0) {
    return `<div class="dm-empty-state">No facilities found.</div>`;
  }

  return `
    <table class="dm-facilities-table">
      <thead>
        <tr>
          <th>Facility</th>
          <th>Level</th>
          <th>Lifecycle</th>
          <th>Readiness</th>
          <th>Integrity</th>
          <th>Maintenance</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${facilities.map((f) => {
          const hasConditions = f.conditions.length > 0;
          return `
            <tr class="dm-facility-row" data-facility-id="${escapeAttribute(f.id)}">
              <td class="dm-cell-name">
                <span class="dm-facility-label">${escapeHtml(f.name)}</span>
                <span class="dm-def-id">(${escapeHtml(f.definitionId)})</span>
                ${f.isSecret ? `<span class="dm-badge dm-badge-secret">Secret</span>` : ""}
                ${hasConditions ? `<span class="dm-badge dm-badge-warning" title="${f.conditions.length} active condition(s)">Conditions (${f.conditions.length})</span>` : ""}
              </td>
              <td class="dm-cell-level">
                <span class="dm-level-pill">Lv.${f.level}</span>
              </td>
              <td class="dm-cell-lifecycle">
                <span class="dm-badge ${escapeAttribute(f.lifecycleBadgeClass)}">${escapeHtml(f.lifecycle)}</span>
              </td>
              <td class="dm-cell-readiness">
                <span class="dm-badge ${escapeAttribute(f.readinessBadgeClass)}">${escapeHtml(f.readiness)}</span>
              </td>
              <td class="dm-cell-integrity">
                <div class="dm-progress-container dm-integrity-meter dm-integrity-${escapeAttribute(f.integrityClass)}">
                  <div class="dm-progress-bar" style="width: ${f.integrityPercent}%;"></div>
                  <span class="dm-progress-text">${f.structuralIntegrity} / ${f.maxStructuralIntegrity} (${f.integrityPercent}%)</span>
                </div>
              </td>
              <td class="dm-cell-maintenance">
                <span class="dm-badge ${escapeAttribute(f.maintenance.statusBadgeClass)}">${escapeHtml(f.maintenance.status)}</span>
                <span class="dm-subtext">${escapeHtml(f.maintenance.formattedRatio)}</span>
              </td>
              <td class="dm-cell-actions">
                <button type="button" class="dm-btn dm-btn-sm" data-action="openFacilityDetail" data-facility-id="${escapeAttribute(f.id)}" title="Inspect Facility">
                  <i class="fas fa-search"></i> Inspect
                </button>
                ${f.canMaintain ? `
                  <button type="button" class="dm-btn dm-btn-sm dm-btn-secondary" data-action="openMaintenanceModal" data-facility-id="${escapeAttribute(f.id)}" title="Perform Maintenance">
                    <i class="fas fa-wrench"></i> Maintain
                  </button>
                ` : ""}
                ${f.canRepair ? `
                  <button type="button" class="dm-btn dm-btn-sm dm-btn-primary" data-action="openRepairModal" data-facility-id="${escapeAttribute(f.id)}" title="Repair Facility">
                    <i class="fas fa-tools"></i> Repair
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

export function renderFacilityDetailModalHtml(facility: FacilityViewModel, viewerIsGm: boolean): string {
  return `
    <div class="dm-modal dm-facility-detail-modal" data-facility-id="${escapeAttribute(facility.id)}">
      <header class="dm-modal-header">
        <h3>Facility Inspector: ${escapeHtml(facility.name)}</h3>
        <button type="button" class="dm-btn-close" data-action="closeModal">&times;</button>
      </header>

      <div class="dm-modal-body">
        <section class="dm-detail-summary">
          <div class="dm-summary-grid">
            <div class="dm-stat">
              <span class="dm-stat-label">Lifecycle</span>
              <span class="dm-badge ${escapeAttribute(facility.lifecycleBadgeClass)}">${escapeHtml(facility.lifecycle)}</span>
            </div>
            <div class="dm-stat">
              <span class="dm-stat-label">Readiness (Operational)</span>
              <span class="dm-badge ${escapeAttribute(facility.readinessBadgeClass)}">${escapeHtml(facility.readiness)}</span>
            </div>
            <div class="dm-stat">
              <span class="dm-stat-label">Level</span>
              <span>Level ${facility.level}</span>
            </div>
            <div class="dm-stat">
              <span class="dm-stat-label">Revision</span>
              <span>v${facility.revision}</span>
            </div>
          </div>

          <div class="dm-integrity-section">
            <h4>Structural Integrity</h4>
            <div class="dm-progress-container dm-progress-large dm-integrity-${escapeAttribute(facility.integrityClass)}">
              <div class="dm-progress-bar" style="width: ${facility.integrityPercent}%;"></div>
              <span class="dm-progress-text">${facility.structuralIntegrity} / ${facility.maxStructuralIntegrity} HP (${facility.integrityPercent}%)</span>
            </div>
          </div>

          <div class="dm-maintenance-section">
            <h4>Maintenance Status</h4>
            <div class="dm-maint-overview">
              <span class="dm-badge ${escapeAttribute(facility.maintenance.statusBadgeClass)}">
                ${escapeHtml(facility.maintenance.status.toUpperCase())}
              </span>
              <span class="dm-maint-ratio">Cycle Progress: ${escapeHtml(facility.maintenance.formattedRatio)} (${facility.maintenance.ticksSinceLastMaintenance}/${facility.maintenance.intervalTicks} ticks)</span>
              ${facility.maintenance.consecutiveMissedCycles > 0 ? `
                <span class="dm-badge dm-badge-danger">${facility.maintenance.consecutiveMissedCycles} missed cycle(s)</span>
              ` : ""}
            </div>
          </div>
        </section>

        ${facility.conditions.length > 0 ? `
          <section class="dm-section dm-conditions-section">
            <h4 class="dm-warning-text"><i class="fas fa-exclamation-circle"></i> Active Conditions & Damage</h4>
            <ul class="dm-condition-list">
              ${facility.conditions.map((c) => `
                <li class="dm-condition-item">
                  <span class="dm-badge ${escapeAttribute(c.severityBadgeClass)}">${escapeHtml(c.severity)}</span>
                  <span class="dm-condition-desc">${escapeHtml(c.description)}</span>
                  ${c.suppressesCapabilities.length > 0 ? `
                    <span class="dm-suppression-note">(Suppresses: ${c.suppressesCapabilities.map(escapeHtml).join(", ")})</span>
                  ` : ""}
                </li>
              `).join("")}
            </ul>
          </section>
        ` : ""}

        <section class="dm-section dm-capabilities-section">
          <h4>Effective Capabilities</h4>
          ${facility.effectiveCapabilities.length > 0 ? `
            <div class="dm-caps-tags">
              ${facility.effectiveCapabilities.map((cap) => `
                <span class="dm-cap-tag"><code>${escapeHtml(cap)}</code></span>
              `).join("")}
            </div>
          ` : `
            <div class="dm-muted-text">No active capabilities provided in current status.</div>
          `}
        </section>

        <section class="dm-section dm-modules-section">
          <h4>Infrastructure Modules & Upgrades</h4>
          <div class="dm-slots-overview">
            <span>Installed Modules: ${facility.activeModulesCount}</span> |
            <span>Active Upgrades: ${facility.activeUpgradesCount}</span>
          </div>
        </section>
      </div>

      <footer class="dm-modal-footer">
        ${facility.canMaintain ? `
          <button type="button" class="dm-btn dm-btn-secondary" data-action="openMaintenanceModal" data-facility-id="${escapeAttribute(facility.id)}">
            <i class="fas fa-wrench"></i> Perform Maintenance
          </button>
        ` : ""}

        ${facility.canRepair ? `
          <button type="button" class="dm-btn dm-btn-primary" data-action="openRepairModal" data-facility-id="${escapeAttribute(facility.id)}">
            <i class="fas fa-tools"></i> Repair Damage
          </button>
        ` : ""}

        <button type="button" class="dm-btn" data-action="closeModal">Close</button>
      </footer>
    </div>
  `;
}

export function renderFacilityCreateModalHtml(
  domainUuid: string,
  definitions: readonly FacilityDefinition[]
): string {
  return `
    <div class="dm-modal dm-facility-create-modal">
      <header class="dm-modal-header">
        <h3>Commission / Plan Facility</h3>
        <button type="button" class="dm-btn-close" data-action="closeModal">&times;</button>
      </header>

      <form data-form-type="createFacility" data-domain-uuid="${escapeAttribute(domainUuid)}">
        <div class="dm-modal-body">
          <div class="dm-form-group">
            <label for="dm-facility-definition">Facility Type / Blueprint</label>
            <select id="dm-facility-definition" name="definitionId" required>
              <option value="">-- Select a blueprint --</option>
              ${definitions.map((d) => `
                <option value="${escapeAttribute(d.id)}">
                  ${escapeHtml(d.label)} - Max Lv.${d.maxLevel}
                </option>
              `).join("")}
            </select>
          </div>

          <div class="dm-form-group">
            <label for="dm-facility-name">Facility Name</label>
            <input type="text" id="dm-facility-name" name="name" placeholder="Custom facility designation (optional)" />
          </div>

          <div class="dm-form-group">
            <label for="dm-facility-level">Starting Level</label>
            <input type="number" id="dm-facility-level" name="level" min="1" max="10" value="1" required />
          </div>

          <div class="dm-form-group">
            <label for="dm-facility-lifecycle">Initial Lifecycle State</label>
            <select id="dm-facility-lifecycle" name="initialLifecycle">
              <option value="operational">Operational (Fully functional)</option>
              <option value="planned">Planned (Blueprint / Draft)</option>
              <option value="underConstruction">Under Construction</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <footer class="dm-modal-footer">
          <button type="submit" class="dm-btn dm-btn-primary">
            <i class="fas fa-check"></i> Commission Facility
          </button>
          <button type="button" class="dm-btn" data-action="closeModal">Cancel</button>
        </footer>
      </form>
    </div>
  `;
}

export function renderFacilityMaintenanceModalHtml(facility: FacilityViewModel): string {
  return `
    <div class="dm-modal dm-facility-maintenance-modal" data-facility-id="${escapeAttribute(facility.id)}">
      <header class="dm-modal-header">
        <h3>Perform Maintenance: ${escapeHtml(facility.name)}</h3>
        <button type="button" class="dm-btn-close" data-action="closeModal">&times;</button>
      </header>

      <form data-form-type="maintainFacility" data-facility-id="${escapeAttribute(facility.id)}">
        <div class="dm-modal-body">
          <p>
            Committing maintenance will reset the maintenance cycle timer to 0 ticks, clear overdue statuses, and restore standard operational readiness.
          </p>

          <div class="dm-maint-details">
            <div>Current Status: <strong>${escapeHtml(facility.maintenance.status)}</strong></div>
            <div>Elapsed Ticks: <strong>${facility.maintenance.ticksSinceLastMaintenance} / ${facility.maintenance.intervalTicks}</strong></div>
            <div>Missed Cycles: <strong>${facility.maintenance.consecutiveMissedCycles}</strong></div>
          </div>

          <div class="dm-form-group">
            <label for="dm-maint-notes">Maintenance Log Notes</label>
            <input type="text" id="dm-maint-notes" name="notes" placeholder="Standard inspection and overhaul" />
          </div>
        </div>

        <footer class="dm-modal-footer">
          <button type="submit" class="dm-btn dm-btn-primary">
            <i class="fas fa-wrench"></i> Complete Maintenance
          </button>
          <button type="button" class="dm-btn" data-action="closeModal">Cancel</button>
        </footer>
      </form>
    </div>
  `;
}

export function renderFacilityRepairModalHtml(facility: FacilityViewModel): string {
  const missingIntegrity = facility.maxStructuralIntegrity - facility.structuralIntegrity;

  return `
    <div class="dm-modal dm-facility-repair-modal" data-facility-id="${escapeAttribute(facility.id)}">
      <header class="dm-modal-header">
        <h3>Repair Facility: ${escapeHtml(facility.name)}</h3>
        <button type="button" class="dm-btn-close" data-action="closeModal">&times;</button>
      </header>

      <form data-form-type="repairFacility" data-facility-id="${escapeAttribute(facility.id)}">
        <div class="dm-modal-body">
          <div class="dm-form-group">
            <label for="dm-repair-amount">Restore Structural Integrity (HP)</label>
            <input type="number" id="dm-repair-amount" name="restoreIntegrity" min="1" max="${missingIntegrity > 0 ? missingIntegrity : 100}" value="${missingIntegrity > 0 ? missingIntegrity : 10}" required />
            <small class="dm-help-text">Deficit: ${missingIntegrity} HP (Current: ${facility.structuralIntegrity} / Max: ${facility.maxStructuralIntegrity})</small>
          </div>

          ${facility.conditions.length > 0 ? `
            <div class="dm-form-group">
              <label>Clear Active Damage Conditions</label>
              <div class="dm-conditions-checkboxes">
                ${facility.conditions.map((c) => `
                  <label class="dm-checkbox-label">
                    <input type="checkbox" name="clearConditions" value="${escapeAttribute(c.id)}" checked />
                    [${escapeHtml(c.severity)}] ${escapeHtml(c.description)}
                  </label>
                `).join("")}
              </div>
            </div>
          ` : ""}
        </div>

        <footer class="dm-modal-footer">
          <button type="submit" class="dm-btn dm-btn-primary">
            <i class="fas fa-tools"></i> Execute Repairs
          </button>
          <button type="button" class="dm-btn" data-action="closeModal">Cancel</button>
        </footer>
      </form>
    </div>
  `;
}

export function renderFacilitiesSubsystemHtml(vm: FacilitiesSubsystemViewModel): string {
  return `
    <div class="dm-facilities-subsystem" data-domain-uuid="${escapeAttribute(vm.domainUuid)}">
      <header class="dm-subsystem-header">
        <div class="dm-header-title">
          <h2>Facilities & Infrastructure</h2>
          <span class="dm-header-subtitle">Domain Installations, Capacities, Maintenance & Readiness</span>
        </div>

        <div class="dm-summary-counters">
          <div class="dm-counter-card">
            <span class="dm-counter-value">${vm.totalCount}</span>
            <span class="dm-counter-label">Total</span>
          </div>
          <div class="dm-counter-card dm-counter-operational">
            <span class="dm-counter-value">${vm.operationalCount}</span>
            <span class="dm-counter-label">Operational</span>
          </div>
          <div class="dm-counter-card dm-counter-ready">
            <span class="dm-counter-value">${vm.readyCount}</span>
            <span class="dm-counter-label">Ready</span>
          </div>
          <div class="dm-counter-card dm-counter-damaged">
            <span class="dm-counter-value">${vm.degradedOrDamagedCount}</span>
            <span class="dm-counter-label">Damaged/Degraded</span>
          </div>
        </div>
      </header>

      <div class="dm-toolbar">
        <div class="dm-toolbar-filters">
          <label class="dm-filter-label">Readiness:</label>
          <select name="filterReadiness" data-action="filterReadiness" class="dm-select-sm">
            <option value="all" ${vm.filterReadiness === "all" ? "selected" : ""}>All Readiness</option>
            <option value="ready" ${vm.filterReadiness === "ready" ? "selected" : ""}>Ready</option>
            <option value="limited" ${vm.filterReadiness === "limited" ? "selected" : ""}>Limited</option>
            <option value="blocked" ${vm.filterReadiness === "blocked" ? "selected" : ""}>Blocked</option>
            <option value="unavailable" ${vm.filterReadiness === "unavailable" ? "selected" : ""}>Unavailable</option>
          </select>

          <input
            type="text"
            placeholder="Search facilities..."
            data-action="searchFacilities"
            value="${escapeAttribute(vm.searchTerm)}"
            class="dm-input-sm dm-search-input"
          />
        </div>

        <div class="dm-toolbar-actions">
          <button type="button" class="dm-btn dm-btn-primary dm-btn-sm" data-action="openCreateModal">
            <i class="fas fa-plus"></i> Commission Facility
          </button>
        </div>
      </div>

      <main class="dm-subsystem-content">
        ${renderFacilitiesTableHtml(vm.facilities)}
      </main>
    </div>
  `;
}
