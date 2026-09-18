import type { PeopleSubsystemViewModel } from "./people-presenter.js";

export function renderPeopleSubsystemHtml(vm: PeopleSubsystemViewModel): string {
  const pop = vm.population;

  const notablesHtml = vm.notables.length === 0
    ? `<div class="dm-empty-state">No notables registered.</div>`
    : `<div class="dm-notables-grid">
        ${vm.notables.map((n) => {
          const portrait = n.notable.type === "inline" ? n.notable.portrait : undefined;
          return `
          <div class="dm-notable-card ${n.badgeClass} ${n.isSecret ? "dm-secret" : ""}" data-notable-id="${n.notable.id}">
            <div class="dm-notable-portrait">
              ${portrait ? `<img src="${portrait}" alt="${n.status.resolvedName}" />` : `<div class="dm-default-avatar"></div>`}
            </div>
            <div class="dm-notable-details">
              <span class="dm-notable-name">${n.status.resolvedName}</span>
              <span class="dm-notable-type">${n.notable.type}</span>
              ${n.isSecret ? `<span class="dm-badge-secret">Secret</span>` : ""}
            </div>
          </div>
        `;
        }).join("")}
      </div>`;

  const rolesHtml = vm.roles.length === 0
    ? `<div class="dm-empty-state">No roles defined.</div>`
    : `<div class="dm-roles-list">
        ${vm.roles.map((r) => `
          <div class="dm-role-item ${r.statusClass} ${r.isSecret ? "dm-secret" : ""}" data-role-id="${r.evaluation.role.id}">
            <div class="dm-role-header">
              <span class="dm-role-title">${r.evaluation.effectiveLabel}</span>
              <span class="dm-role-badge dm-badge-${r.statusClass}">${r.statusClass}</span>
              ${r.isSecret ? `<span class="dm-badge-secret">Secret</span>` : ""}
            </div>
            <div class="dm-role-occupants">
              ${r.evaluation.role.occupants.length === 0 ? "<em>Vacant</em>" : `${r.evaluation.role.occupants.length} occupant(s)`}
            </div>
          </div>
        `).join("")}
      </div>`;

  const opgHtml = vm.operationalGroups.length === 0
    ? `<div class="dm-empty-state">No operational groups.</div>`
    : `<div class="dm-opg-list">
        ${vm.operationalGroups.map((g) => `
          <div class="dm-opg-item ${g.statusClass} ${g.isSecret ? "dm-secret" : ""}" data-opg-id="${g.group.id}">
            <span class="dm-opg-name">${g.group.name}</span>
            <span class="dm-opg-size">Size: ${g.group.size} (${g.group.membershipMode})</span>
            <span class="dm-badge dm-badge-${g.statusClass}">${g.statusClass}</span>
          </div>
        `).join("")}
      </div>`;

  const workforceTypes = Object.values(vm.workforce.types);
  const wfHtml = workforceTypes.length === 0
    ? `<div class="dm-empty-state">No workforce available.</div>`
    : `<div class="dm-workforce-grid">
        ${workforceTypes.map((w) => `
          <div class="dm-wf-stat ${w.isOvercommitted ? "dm-overcommitted" : ""}">
            <span class="dm-wf-label">${w.workforceTypeId}</span>
            <span class="dm-wf-value">${w.available} / ${w.capacity}</span>
            ${w.isOvercommitted ? `<span class="dm-alert">OVERCOMMIT</span>` : ""}
          </div>
        `).join("")}
      </div>`;

  return `
    <div class="dm-people-subsystem" data-domain-uuid="${vm.domainUuid}">
      <header class="dm-subsystem-header">
        <h2>People & Demographics</h2>
        <div class="dm-population-counter">
          <span class="dm-label">Population:</span>
          <span class="dm-value">${pop.formattedTotal}</span>
        </div>
      </header>

      <section class="dm-section dm-notables-section">
        <h3>Notables</h3>
        ${notablesHtml}
      </section>

      <section class="dm-section dm-roles-section">
        <h3>Roles & Offices</h3>
        ${rolesHtml}
      </section>

      <section class="dm-section dm-opg-section">
        <h3>Operational Groups</h3>
        ${opgHtml}
      </section>

      <section class="dm-section dm-workforce-section">
        <h3>Workforce Status</h3>
        ${wfHtml}
      </section>
    </div>
  `;
}
