import type { DowntimeDefinition } from "../../../downtime/types/downtime-types.js";
import type { DowntimeSubsystemViewModel, DowntimeViewModel } from "./downtime-presenter.js";

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

export function renderDowntimeTableHtml(activities: readonly DowntimeViewModel[]): string {
  if (activities.length === 0) {
    return `<div class="dm-empty-state">No downtime activities found.</div>`;
  }

  return `
    <table class="dm-downtime-table">
      <thead>
        <tr>
          <th>Endeavor / Activity</th>
          <th>Definition</th>
          <th>Scope</th>
          <th>Status</th>
          <th>Progress / Duration</th>
          <th>Participants</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${activities.map((a) => {
          return `
            <tr class="dm-downtime-row" data-downtime-id="${escapeAttribute(a.id)}">
              <td class="dm-cell-name">
                <span class="dm-downtime-label">${escapeHtml(a.label)}</span>
                ${a.isSecret ? `<span class="dm-badge dm-badge-secret">Secret</span>` : ""}
              </td>
              <td class="dm-cell-def">
                <code>${escapeHtml(a.definitionId)}</code>
              </td>
              <td class="dm-cell-scope">
                <span class="dm-badge ${escapeAttribute(a.scopeBadgeClass)}">${escapeHtml(a.scope)}</span>
              </td>
              <td class="dm-cell-status">
                <span class="dm-badge ${escapeAttribute(a.lifecycleBadgeClass)}">${escapeHtml(a.lifecycle)}</span>
              </td>
              <td class="dm-cell-duration">
                ${a.isIndefinite ? `
                  <div class="dm-indefinite-tag">
                    <i class="fas fa-infinity"></i> ${escapeHtml(a.durationFormatted)}
                  </div>
                ` : `
                  <div class="dm-progress-container">
                    <div class="dm-progress-bar" style="width: ${a.progressPercent ?? 0}%;"></div>
                    <span class="dm-progress-text">${escapeHtml(a.durationFormatted)} (${a.progressPercent ?? 0}%)</span>
                  </div>
                `}
              </td>
              <td class="dm-cell-participants">
                <span class="dm-participants-summary">
                  <i class="fas fa-users"></i> ${a.participants.length} participant(s)
                </span>
              </td>
              <td class="dm-cell-actions">
                <button type="button" class="dm-btn dm-btn-sm" data-action="openDowntimeDetail" data-downtime-id="${escapeAttribute(a.id)}" title="Inspect Activity">
                  <i class="fas fa-search"></i> Inspect
                </button>
                ${a.canAdvance ? `
                  <button type="button" class="dm-btn dm-btn-sm dm-btn-primary" data-action="advanceDowntime" data-downtime-id="${escapeAttribute(a.id)}" title="Advance 1 Tick">
                    <i class="fas fa-step-forward"></i> +1 Tick
                  </button>
                ` : ""}
                ${a.canComplete ? `
                  <button type="button" class="dm-btn dm-btn-sm dm-btn-success" data-action="completeDowntime" data-downtime-id="${escapeAttribute(a.id)}" title="Complete Activity">
                    <i class="fas fa-check"></i> Complete
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

export function renderDowntimeDetailModalHtml(downtime: DowntimeViewModel, viewerIsGm: boolean): string {
  return `
    <div class="dm-modal dm-downtime-detail-modal" data-downtime-id="${escapeAttribute(downtime.id)}">
      <header class="dm-modal-header">
        <h3>Endeavor Inspector: ${escapeHtml(downtime.label)}</h3>
        <button type="button" class="dm-btn-close" data-action="closeModal">&times;</button>
      </header>

      <div class="dm-modal-body">
        <section class="dm-detail-summary">
          <div class="dm-summary-grid">
            <div class="dm-stat">
              <span class="dm-stat-label">Status</span>
              <span class="dm-badge ${escapeAttribute(downtime.lifecycleBadgeClass)}">${escapeHtml(downtime.lifecycle)}</span>
            </div>
            <div class="dm-stat">
              <span class="dm-stat-label">Scope</span>
              <span class="dm-badge ${escapeAttribute(downtime.scopeBadgeClass)}">${escapeHtml(downtime.scope)}</span>
            </div>
            <div class="dm-stat">
              <span class="dm-stat-label">Definition</span>
              <code>${escapeHtml(downtime.definitionId)}</code>
            </div>
            <div class="dm-stat">
              <span class="dm-stat-label">Elapsed / Duration</span>
              <span>${escapeHtml(downtime.durationFormatted)}</span>
            </div>
          </div>

          <div class="dm-progress-section">
            <h4>Endeavor Duration</h4>
            ${downtime.isIndefinite ? `
              <div class="dm-indefinite-notice">
                <i class="fas fa-infinity"></i> Indefinite Activity (Running continuously for ${downtime.progressTicks} ticks)
              </div>
            ` : `
              <div class="dm-progress-container dm-progress-large">
                <div class="dm-progress-bar" style="width: ${downtime.progressPercent ?? 0}%;"></div>
                <span class="dm-progress-text">${escapeHtml(downtime.durationFormatted)} (${downtime.progressPercent ?? 0}%)</span>
              </div>
            `}
          </div>
        </section>

        <section class="dm-section dm-participants-section">
          <h4>Participants (${downtime.participants.length})</h4>
          ${downtime.participants.length > 0 ? `
            <ul class="dm-participants-list">
              ${downtime.participants.map((p) => `
                <li class="dm-participant-item">
                  <span class="dm-participant-type dm-badge">[${escapeHtml(p.participantType)}]</span>
                  <span class="dm-participant-name"><strong>${escapeHtml(p.displayName)}</strong></span>
                  <span class="dm-participant-role">(${escapeHtml(p.role)})</span>
                  <span class="dm-participant-cap">Capacity: ${p.capacityConsumed}</span>
                </li>
              `).join("")}
            </ul>
          ` : `
            <div class="dm-muted-text">No registered participants.</div>
          `}
        </section>

        <section class="dm-section dm-outcomes-section">
          <h4>Expected Outcomes & Receipts</h4>
          ${downtime.outcomes.length > 0 ? `
            <ul class="dm-outcomes-list">
              ${downtime.outcomes.map((o) => `
                <li class="dm-outcome-item ${o.received ? "dm-outcome-received" : ""}">
                  <span class="dm-badge ${o.received ? "dm-badge-healthy" : "dm-badge-info"}">
                    ${o.received ? "Granted" : "Pending"}
                  </span>
                  <span class="dm-outcome-desc">${escapeHtml(o.description)}</span>
                  <span class="dm-outcome-type">(${escapeHtml(o.type)})</span>
                </li>
              `).join("")}
            </ul>
          ` : `
            <div class="dm-muted-text">No outcomes declared.</div>
          `}
        </section>

        ${downtime.description ? `
          <section class="dm-section dm-desc-section">
            <h4>Narrative Details</h4>
            <p>${escapeHtml(downtime.description)}</p>
          </section>
        ` : ""}
      </div>

      <footer class="dm-modal-footer">
        ${downtime.canAdvance ? `
          <form class="dm-advance-ticks-form" data-form-type="advanceDowntime" data-downtime-id="${escapeAttribute(downtime.id)}">
            <input type="number" name="ticks" value="1" min="1" max="100" class="dm-input-sm" style="width: 60px;" />
            <button type="submit" class="dm-btn dm-btn-primary">
              <i class="fas fa-forward"></i> Advance Ticks
            </button>
          </form>
        ` : ""}

        ${downtime.canComplete ? `
          <button type="button" class="dm-btn dm-btn-success" data-action="completeDowntime" data-downtime-id="${escapeAttribute(downtime.id)}">
            <i class="fas fa-check"></i> Complete Activity
          </button>
        ` : ""}

        ${downtime.canCancel ? `
          <button type="button" class="dm-btn dm-btn-danger" data-action="cancelDowntime" data-downtime-id="${escapeAttribute(downtime.id)}">
            <i class="fas fa-times"></i> Cancel Activity
          </button>
        ` : ""}

        <button type="button" class="dm-btn" data-action="closeModal">Close</button>
      </footer>
    </div>
  `;
}

export function renderDowntimeStartModalHtml(
  domainUuid: string,
  definitions: readonly DowntimeDefinition[]
): string {
  return `
    <div class="dm-modal dm-downtime-start-modal">
      <header class="dm-modal-header">
        <h3>Initiate Downtime Activity</h3>
        <button type="button" class="dm-btn-close" data-action="closeModal">&times;</button>
      </header>

      <form data-form-type="startDowntime" data-domain-uuid="${escapeAttribute(domainUuid)}">
        <div class="dm-modal-body">
          <div class="dm-form-group">
            <label for="dm-downtime-definition">Activity Blueprint</label>
            <select id="dm-downtime-definition" name="definitionId" required>
              <option value="">-- Select an activity --</option>
              ${definitions.map((d) => `
                <option value="${escapeAttribute(d.id)}" data-scope="${escapeAttribute(d.scope)}" data-duration="${d.defaultDurationTicks ?? ""}">
                  ${escapeHtml(d.label)} (${escapeHtml(d.scope)}) ${d.defaultDurationTicks ? `- ${d.defaultDurationTicks} ticks` : "- Indefinite"}
                </option>
              `).join("")}
            </select>
          </div>

          <div class="dm-form-group">
            <label for="dm-downtime-label">Activity Label / Description</label>
            <input type="text" id="dm-downtime-label" name="label" placeholder="Custom endeavor label (optional)" />
          </div>

          <div class="dm-form-group">
            <label for="dm-downtime-scope">Scope</label>
            <select id="dm-downtime-scope" name="scope">
              <option value="domain">Domain-wide</option>
              <option value="group">Operational Group</option>
              <option value="individual">Individual Notable / Actor</option>
              <option value="cross-domain">Cross-Domain</option>
            </select>
          </div>

          <div class="dm-form-group">
            <label for="dm-downtime-duration">Duration (Ticks)</label>
            <input type="number" id="dm-downtime-duration" name="durationTicks" min="1" placeholder="Leave empty for Indefinite duration" />
            <small class="dm-help-text">Leave blank for open-ended or indefinite downtime.</small>
          </div>

          <div class="dm-form-group">
            <label for="dm-participant-ref">Primary Participant Reference</label>
            <input type="text" id="dm-participant-ref" name="participantRef" placeholder="Notable ID, Group ID, or Domain reference" />
          </div>
        </div>

        <footer class="dm-modal-footer">
          <button type="submit" class="dm-btn dm-btn-primary">
            <i class="fas fa-play"></i> Begin Activity
          </button>
          <button type="button" class="dm-btn" data-action="closeModal">Cancel</button>
        </footer>
      </form>
    </div>
  `;
}

export function renderDowntimeSubsystemHtml(vm: DowntimeSubsystemViewModel): string {
  return `
    <div class="dm-downtime-subsystem" data-domain-uuid="${escapeAttribute(vm.domainUuid)}">
      <header class="dm-subsystem-header">
        <div class="dm-header-title">
          <h2>Downtime & Endeavors</h2>
          <span class="dm-header-subtitle">Interludes, Character Endeavors, Training & Reconnaissance</span>
        </div>

        <div class="dm-summary-counters">
          <div class="dm-counter-card">
            <span class="dm-counter-value">${vm.totalCount}</span>
            <span class="dm-counter-label">Total</span>
          </div>
          <div class="dm-counter-card dm-counter-active">
            <span class="dm-counter-value">${vm.activeCount}</span>
            <span class="dm-counter-label">In Progress</span>
          </div>
          <div class="dm-counter-card dm-counter-completed">
            <span class="dm-counter-value">${vm.completedCount}</span>
            <span class="dm-counter-label">Completed</span>
          </div>
        </div>
      </header>

      <div class="dm-toolbar">
        <div class="dm-toolbar-filters">
          <label class="dm-filter-label">Status:</label>
          <select name="filterLifecycle" data-action="filterDowntimeLifecycle" class="dm-select-sm">
            <option value="all" ${vm.filterLifecycle === "all" ? "selected" : ""}>All Statuses</option>
            <option value="active" ${vm.filterLifecycle === "active" ? "selected" : ""}>In Progress</option>
            <option value="completed" ${vm.filterLifecycle === "completed" ? "selected" : ""}>Completed</option>
            <option value="paused" ${vm.filterLifecycle === "paused" ? "selected" : ""}>Paused</option>
            <option value="canceled" ${vm.filterLifecycle === "canceled" ? "selected" : ""}>Canceled</option>
          </select>

          <input
            type="text"
            placeholder="Search activities..."
            data-action="searchDowntime"
            value="${escapeAttribute(vm.searchTerm)}"
            class="dm-input-sm dm-search-input"
          />
        </div>

        <div class="dm-toolbar-actions">
          <button type="button" class="dm-btn dm-btn-primary dm-btn-sm" data-action="openStartModal">
            <i class="fas fa-plus"></i> Initiate Downtime
          </button>
        </div>
      </div>

      <main class="dm-subsystem-content">
        ${renderDowntimeTableHtml(vm.activities)}
      </main>
    </div>
  `;
}
