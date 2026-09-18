import type { EconomySubsystemViewModel, ResourceAccountViewModel, LedgerEntryViewModel } from "./economy-presenter.js";

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

      <section class="dm-ledger-history-section">
        <h4><i class="fas fa-history"></i> Recent Ledger Activity</h4>
        ${renderLedgerTable(vm.recentLedger)}
      </section>
    </div>
  `;
}

function renderResourceCards(accounts: readonly ResourceAccountViewModel[]): string {
  if (accounts.length === 0) {
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

function renderLedgerTable(entries: readonly LedgerEntryViewModel[]): string {
  if (entries.length === 0) {
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
            ${accounts.map((a) => `<option value="${escapeAttribute(a.resourceId)}">${escapeHtml(a.label)} (Available: ${escapeHtml(a.availableFormatted)})</option>`).join("")}
          </select>
        </label>
        <label>
          Target Domain UUID:
          <input type="text" name="targetDomainUuid" required placeholder="JournalEntry.id..." />
        </label>
        <label>
          Amount:
          <input type="number" name="amount" min="1" step="1" required />
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
            ${accounts.map((a) => `<option value="${escapeAttribute(a.resourceId)}">${escapeHtml(a.label)} (Current: ${escapeHtml(a.balanceFormatted)})</option>`).join("")}
          </select>
        </label>
        <label>
          Delta Amount (positive or negative):
          <input type="number" name="delta" step="1" required />
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
