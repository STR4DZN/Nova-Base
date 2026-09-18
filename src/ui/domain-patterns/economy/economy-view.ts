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
        ${renderLedgerTable(vm.recentLedger)}
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
            ${acc.isSecret ? `<span class="dm-badge-secret"><i class="fas fa-eye-slash"></i> Secret</span>` : ""}
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

function renderLedgerTable(entries: readonly LedgerEntryViewModel[] = []): string {
  if (!entries || entries.length === 0) {
    return `<div class="dm-empty-state">No recent ledger transactions recorded.</div>`;
  }

  return `
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
            ${accounts.map((a) => `<option value="${escapeAttribute(a.resourceId)}" data-precision="${escapeAttribute(a.precision)}">${escapeHtml(a.label)} (Available: ${escapeHtml(a.availableFormatted)})</option>`).join("")}
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
            ${accounts.map((a) => `<option value="${escapeAttribute(a.resourceId)}" data-precision="${escapeAttribute(a.precision)}">${escapeHtml(a.label)} (Current: ${escapeHtml(a.balanceFormatted)})</option>`).join("")}
          </select>
        </label>
        <label>
          Delta Amount (positive or negative):
          <input type="text" inputmode="decimal" name="delta" required placeholder="Delta (e.g. +10.50 or -5)" />
        </label>
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
