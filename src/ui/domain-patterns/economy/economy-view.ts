import type {
  EconomySubsystemViewModel,
  ResourceAccountViewModel,
  ReservationItemViewModel,
  LedgerEntryViewModel
} from "./economy-presenter.js";

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttribute(value: unknown): string {
  return escapeHtml(value);
}

export function renderEconomySubsystemHtml(vm: EconomySubsystemViewModel): string {
  return `
    <div class="dm-economy-subsystem" data-domain-uuid="${escapeAttribute(vm.domainUuid)}">
      <header class="dm-economy-header">
        <div class="dm-header-title">
          <h3><i class="fas fa-coins"></i> Economy & Resources</h3>
        </div>
        <div class="dm-header-actions">
          <button type="button" class="dm-btn dm-btn-secondary" data-action="openTransferModal">
            <i class="fas fa-exchange-alt"></i> Transfer
          </button>
          ${
            vm.viewerIsGm
              ? `
            <button type="button" class="dm-btn dm-btn-secondary" data-action="openAdjustModal">
              <i class="fas fa-sliders-h"></i> Adjust
            </button>
            <button type="button" class="dm-btn dm-btn-primary" data-action="openCreateAccountModal">
              <i class="fas fa-plus"></i> New Account
            </button>
          `
              : ""
          }
        </div>
      </header>

      <section class="dm-resource-cards-section">
        ${renderResourceCards(vm.accounts)}
      </section>

      <section class="dm-reservations-section">
        <h4><i class="fas fa-bookmark"></i> Active Reservations</h4>
        ${renderReservationsTable(vm.reservations)}
      </section>

      <section class="dm-ledger-history-section">
        <h4><i class="fas fa-history"></i> Recent Ledger Activity</h4>
        ${renderLedgerTable(vm.recentLedger, {
          page: vm.ledgerPage,
          totalCount: vm.ledgerTotalCount,
          hasMore: vm.ledgerHasMore,
          hasPrev: vm.ledgerHasPrev
        })}
      </section>
    </div>
  `;
}

function renderResourceCards(accounts: readonly ResourceAccountViewModel[] = []): string {
  if (!accounts || accounts.length === 0) {
    return `<div class="dm-empty-state">No resource accounts configured in this domain.</div>`;
  }

  return `
    <div class="dm-resource-grid">
      ${accounts
        .map(
          (acc) => `
        <div class="dm-card dm-resource-card ${escapeAttribute(acc.statusBadgeClass)} ${acc.isSecret ? "secret" : ""}"
             data-resource-id="${escapeAttribute(acc.resourceId)}">
          <div class="dm-card-header">
            <div class="dm-card-icon"><i class="${escapeAttribute(acc.icon ?? "fas fa-box")}"></i></div>
            <h4 class="dm-card-title">${escapeHtml(acc.label)}</h4>
            <div class="dm-card-badges">
              ${acc.isSecret ? `<span class="dm-badge-secret"><i class="fas fa-eye-slash"></i> Secret</span>` : ""}
              ${
                acc.mode === "provider"
                  ? `<span class="dm-badge-provider ${acc.providerAvailable ? "online" : "offline"}"><i class="fas fa-plug"></i> ${escapeHtml(acc.providerId ?? "Provider")} (${acc.providerAvailable ? "Active" : "Offline"})</span>`
                  : ""
              }
              <button type="button" class="dm-btn-icon dm-btn-detail" data-action="openResourceDetail" data-resource-id="${escapeAttribute(acc.resourceId)}" title="View details">
                <i class="fas fa-info-circle"></i>
              </button>
            </div>
          </div>

          <div class="dm-card-balance">
            <span class="dm-balance-major">${escapeHtml(acc.balanceFormatted)}</span>
          </div>

          <div class="dm-card-metrics">
            <div class="dm-metric">
              <span class="dm-metric-label">Reserved:</span>
              <span class="dm-metric-value">${escapeHtml(acc.reservedFormatted)}</span>
            </div>
            <div class="dm-metric">
              <span class="dm-metric-label">Available:</span>
              <span class="dm-metric-value dm-metric-available">${escapeHtml(acc.availableFormatted)}</span>
            </div>
            <div class="dm-metric">
              <span class="dm-metric-label">Capacity:</span>
              <span class="dm-metric-value">${escapeHtml(acc.capacityFormatted)}</span>
            </div>
          </div>

          ${
            acc.capacityPercentage !== null
              ? `
            <div class="dm-capacity-progress-bar">
              <div class="dm-progress-fill ${escapeAttribute(acc.statusBadgeClass)}" style="width: ${acc.capacityPercentage}%"></div>
            </div>
          `
              : ""
          }
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function renderLedgerTable(
  entries: readonly LedgerEntryViewModel[] = [],
  pagination?: {
    page: number;
    totalCount: number;
    hasMore: boolean;
    hasPrev: boolean;
  }
): string {
  if (!entries || entries.length === 0) {
    return `<div class="dm-empty-state">No recent ledger transactions recorded.</div>`;
  }

  return `
    <div class="dm-ledger-container">
      <table class="dm-ledger-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Resource</th>
            <th>Type</th>
            <th>Delta</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          ${entries
            .map(
              (e) => `
            <tr class="dm-ledger-row">
              <td class="dm-col-time">${escapeHtml(e.timestampFormatted)}</td>
              <td class="dm-col-resource">${escapeHtml(e.resourceLabel)}</td>
              <td class="dm-col-kind"><span class="dm-kind-badge">${escapeHtml(e.kind)}</span></td>
              <td class="dm-col-delta ${escapeAttribute(e.deltaClass)}">${escapeHtml(e.deltaFormatted)}</td>
              <td class="dm-col-reason">${escapeHtml(e.reason ?? "—")}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
      ${
        pagination !== undefined
          ? `
        <div class="dm-ledger-pagination">
          <button type="button" class="dm-btn dm-btn-secondary dm-btn-sm" data-action="prevLedgerPage" ${!pagination.hasPrev ? "disabled" : ""}>
            <i class="fas fa-chevron-left"></i> Previous
          </button>
          <span class="dm-ledger-page-info">Showing ${entries.length} of ${pagination.totalCount} transactions (Page ${pagination.page + 1})</span>
          <button type="button" class="dm-btn dm-btn-secondary dm-btn-sm" data-action="nextLedgerPage" ${!pagination.hasMore ? "disabled" : ""}>
            Next <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function renderReservationsTable(reservations: readonly ReservationItemViewModel[] = []): string {
  if (!reservations || reservations.length === 0) {
    return `<div class="dm-empty-state">No active reservations recorded.</div>`;
  }

  return `
    <table class="dm-reservations-table">
      <thead>
        <tr>
          <th>Resource</th>
          <th>Reserved Amount</th>
          <th>Status</th>
          <th>Reason</th>
          <th>Expires</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${reservations
          .map(
            (r) => `
          <tr class="dm-reservation-row" data-reservation-id="${escapeAttribute(r.id)}">
            <td class="dm-col-resource">${escapeHtml(r.resourceLabel)}</td>
            <td class="dm-col-amount">${escapeHtml(r.amountFormatted)}</td>
            <td class="dm-col-status"><span class="dm-kind-badge ${escapeAttribute(r.status)}">${escapeHtml(r.status)}</span></td>
            <td class="dm-col-reason">${escapeHtml(r.reason ?? "—")}</td>
            <td class="dm-col-expires">${escapeHtml(r.expiresAtFormatted ?? "Never")}</td>
            <td class="dm-col-actions">
              <button type="button" class="dm-btn dm-btn-xs dm-btn-danger" data-action="releaseReservation" data-reservation-id="${escapeAttribute(r.id)}" title="Release Reservation">
                <i class="fas fa-times-circle"></i> Release
              </button>
            </td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

export function renderTransferModalHtml(
  domainUuid: string,
  accounts: readonly ResourceAccountViewModel[]
): string {
  return `
    <div class="dm-modal dm-transfer-modal" data-modal-type="transfer">
      <h3><i class="fas fa-exchange-alt"></i> Transfer Resources</h3>
      <form data-form-type="transfer">
        <input type="hidden" name="sourceDomainUuid" value="${escapeAttribute(domainUuid)}" />
        <label>
          Resource:
          <select name="resourceId" required>
            ${accounts.map((a) => `<option value="${escapeAttribute(a.resourceId)}" data-precision="${escapeAttribute(a.precision)}" data-available="${escapeAttribute(a.availableMinor)}" data-label="${escapeAttribute(a.label)}" data-unit="${escapeAttribute(a.displayUnit ?? "")}">${escapeHtml(a.label)} (Available: ${escapeHtml(a.availableFormatted)})</option>`).join("")}
          </select>
        </label>
        <label>
          Target Domain UUID:
          <input type="text" name="targetDomainUuid" required placeholder="JournalEntry.id..." />
        </label>
        <label>
          Amount:
          <input type="text" inputmode="decimal" name="amount" required placeholder="Amount (e.g. 10 or 10.50)" />
        </label>
        <div class="dm-preview-box" id="dm-transfer-preview">
          <div class="dm-preview-title"><i class="fas fa-eye"></i> Transfer Impact Preview</div>
          <div class="dm-preview-body">
            <span class="dm-preview-item">Available after transfer: <span class="dm-preview-val">—</span></span>
          </div>
        </div>
        <label>
          Reason:
          <input type="text" name="reason" placeholder="Transfer notes or motivation" />
        </label>
        <div class="dm-modal-actions">
          <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
          <button type="submit" class="dm-btn dm-btn-primary">Transfer</button>
        </div>
      </form>
    </div>
  `;
}

export function renderAdjustModalHtml(
  domainUuid: string,
  accounts: readonly ResourceAccountViewModel[]
): string {
  return `
    <div class="dm-modal dm-adjust-modal" data-modal-type="adjust">
      <h3><i class="fas fa-sliders-h"></i> Authoritative Adjustment</h3>
      <form data-form-type="adjust">
        <input type="hidden" name="domainUuid" value="${escapeAttribute(domainUuid)}" />
        <label>
          Resource:
          <select name="resourceId" required>
            ${accounts.map((a) => `<option value="${escapeAttribute(a.resourceId)}" data-precision="${escapeAttribute(a.precision)}" data-balance="${escapeAttribute(a.balanceMinor)}" data-label="${escapeAttribute(a.label)}" data-unit="${escapeAttribute(a.displayUnit ?? "")}">${escapeHtml(a.label)} (Current: ${escapeHtml(a.balanceFormatted)})</option>`).join("")}
          </select>
        </label>
        <label>
          Delta Amount (positive or negative):
          <input type="text" inputmode="decimal" name="delta" required placeholder="Delta (e.g. +10.50 or -5)" />
        </label>
        <div class="dm-preview-box" id="dm-adjust-preview">
          <div class="dm-preview-title"><i class="fas fa-eye"></i> Adjustment Impact Preview</div>
          <div class="dm-preview-body">
            <span class="dm-preview-item">Balance after adjustment: <span class="dm-preview-val">—</span></span>
          </div>
        </div>
        <label>
          Reason (Required):
          <input type="text" name="reason" required placeholder="Mandatory audit explanation" />
        </label>
        <div class="dm-modal-actions">
          <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
          <button type="submit" class="dm-btn dm-btn-primary">Apply Adjustment</button>
        </div>
      </form>
    </div>
  `;
}

export function renderResourceDetailModalHtml(account: ResourceAccountViewModel): string {
  return `
    <div class="dm-modal dm-detail-modal" data-modal-type="resourceDetail">
      <h3><i class="${escapeAttribute(account.icon ?? "fas fa-box")}"></i> ${escapeHtml(account.label)}</h3>
      <div class="dm-detail-content">
        <div class="dm-detail-row"><span class="dm-detail-label">Resource ID:</span> <code>${escapeHtml(account.resourceId)}</code></div>
        <div class="dm-detail-row"><span class="dm-detail-label">Description:</span> <span>${escapeHtml(account.description || "No description provided.")}</span></div>
        <div class="dm-detail-row"><span class="dm-detail-label">Category:</span> <span>${escapeHtml(account.categoryId || "Custom")}</span></div>
        ${
          account.tags && account.tags.length > 0
            ? `<div class="dm-detail-row"><span class="dm-detail-label">Tags:</span> <span>${account.tags.map((t) => `<span class="dm-tag">${escapeHtml(t)}</span>`).join(" ")}</span></div>`
            : ""
        }
        <div class="dm-detail-row"><span class="dm-detail-label">Mode:</span> <span class="dm-kind-badge">${escapeHtml(account.mode)}</span></div>
        ${
          account.mode === "provider"
            ? `<div class="dm-detail-row"><span class="dm-detail-label">Provider:</span> <span>${escapeHtml(account.providerId ?? "external")} (${account.providerAvailable ? "Active" : "Unavailable"})</span></div>`
            : ""
        }
        <div class="dm-detail-row"><span class="dm-detail-label">Balance:</span> <strong>${escapeHtml(account.balanceFormatted)}</strong> (raw: ${escapeHtml(account.balanceMinor)})</div>
        <div class="dm-detail-row"><span class="dm-detail-label">Reserved:</span> <span>${escapeHtml(account.reservedFormatted)}</span> (raw: ${escapeHtml(account.reservedMinor)})</div>
        <div class="dm-detail-row"><span class="dm-detail-label">Available:</span> <span>${escapeHtml(account.availableFormatted)}</span> (raw: ${escapeHtml(account.availableMinor)})</div>
        <div class="dm-detail-row"><span class="dm-detail-label">Capacity:</span> <span>${escapeHtml(account.capacityFormatted)}</span></div>
        <div class="dm-detail-row"><span class="dm-detail-label">Status:</span> <span>${escapeHtml(account.status)}</span></div>
      </div>
      <div class="dm-modal-actions">
        <button type="button" class="dm-btn dm-btn-primary" data-action="closeModal">Close</button>
      </div>
    </div>
  `;
}

export function renderCreateAccountModalHtml(
  domainUuid: string,
  availableDefinitions: readonly { id: string; label: string; precision: number }[] = []
): string {
  return `
    <div class="dm-modal dm-create-account-modal" data-modal-type="createAccount">
      <h3><i class="fas fa-plus-circle"></i> Create Resource Account</h3>
      <form data-form-type="createAccount">
        <input type="hidden" name="domainUuid" value="${escapeAttribute(domainUuid)}" />
        <label>
          Resource:
          ${
            availableDefinitions.length > 0
              ? `
            <select name="resourceId" required>
              ${availableDefinitions.map((d) => `<option value="${escapeAttribute(d.id)}" data-precision="${escapeAttribute(d.precision)}">${escapeHtml(d.label)} (${escapeHtml(d.id)})</option>`).join("")}
            </select>
          `
              : `
            <input type="text" name="resourceId" required placeholder="e.g. domain-manager:treasury" />
          `
          }
        </label>
        <label>
          Initial Balance:
          <input type="text" inputmode="decimal" name="initialBalance" placeholder="0" />
        </label>
        <label>
          Base Capacity (leave empty for unlimited):
          <input type="text" inputmode="decimal" name="baseCapacity" placeholder="Unlimited" />
        </label>
        <label>
          Visibility:
          <select name="visibility">
            <option value="public" selected>Public (Visible to all players)</option>
            <option value="restricted">Restricted (Controller / Authorized)</option>
            <option value="secret">Secret (GM Only)</option>
          </select>
        </label>
        <label>
          Reason:
          <input type="text" name="reason" placeholder="Initial allocation note" />
        </label>
        <div class="dm-modal-actions">
          <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
          <button type="submit" class="dm-btn dm-btn-primary">Create Account</button>
        </div>
      </form>
    </div>
  `;
}
