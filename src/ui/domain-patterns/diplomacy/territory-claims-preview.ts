import { renderTerritoryRightsPreview } from "./territory-rights-preview.js";
import type { TerritoryClaimsImpactPreview, InheritedClaimOrigin } from "../../../territory/territory-claims-impact.js";
import { escapeHtml as h } from "../facilities/facility-view.js";
const origin = (r: InheritedClaimOrigin) => `${r.sourceTerritoryLabel} · ${r.sourceTerritoryUuid} · revisão ${r.sourceRevision}`;
const party = (r: InheritedClaimOrigin) => { const p = r.claim.claimantRef; return `${p.type}: ${p.uuid ?? p.id}${p.domainUuid ? ` (${p.domainUuid})` : ""}`; };
function renderTerritoryClaimsPreview(preview: any): string {
  if (!preview) return "";
  const impacts: TerritoryClaimsImpactPreview | undefined = preview.claimInheritanceImpact;
  if (!impacts) return `<p role="status">Prévia validada: ${preview.changes.length} território(s). Nenhuma propriedade de instalação será alterada.</p>`;
  const t = preview.changes.find((c: any) => c.id === preview.id), parent = (uuid: string | null) => h(uuid ?? "Raiz");
  return `<section data-dm-territory-preview-result><h3>Prévia da hierarquia e das reivindicações herdadas</h3>
    <p role="status">Consulta no tick ${impacts.worldTick}. Mudanças nos territórios, acordos, condições ou relógio exigem nova prévia antes de confirmar.</p>
    <p>As reivindicações locais permanecem nos seus registros. Esta mudança recalcula a herança; propriedade e ocupação permanecem independentes. Direitos herdados são recalculados sem gravar concessões locais.</p>
    ${impacts.axes.map(a => `<section><h4>${a.axis === "locatedInUuid" ? "Hierarquia física" : "Hierarquia administrativa"}</h4>
      <p>Pai: ${parent(t.before.territory[a.axis])} → ${parent(t.after.territory[a.axis])}.</p>
      ${!a.changed ? "<p>Sem alteração neste eixo.</p>" : `<p>${a.territories.length} território(s) afetados, incluindo o alvo e seus descendentes neste eixo.</p>
        ${a.territories.map(row => `<details open><summary>${h(row.label)} · ${h(row.territoryUuid)} · revisão ${row.revision}</summary>
          <p>${row.before.length} herdadas antes → ${row.after.length} depois: ${row.added.length} recebidas, ${row.removed.length} perdidas, ${row.retained.length} mantidas. ${row.localCount} locais vigentes preservadas.</p>
          ${row.added.length + row.removed.length + row.retained.length ? `<div class="dm-territory-claims-table"><table><thead><tr><th>Resultado</th><th>Origem</th><th>Reivindicação</th><th>Parte</th><th>Tipo</th><th>Situação</th><th>Antes</th><th>Depois</th></tr></thead><tbody>
            ${[[row.removed, "Perdida", "Sim", "Não"], [row.added, "Recebida", "Não", "Sim"], [row.retained, "Mantida", "Sim", "Sim"]].map(([rows, label, b, n]) => (rows as readonly InheritedClaimOrigin[]).map(r => `<tr><td>${label}</td><td>${h(origin(r))}</td><td>${h(r.claim.id)}</td><td>${h(party(r))}</td><td>${h(r.claim.claimType)}</td><td>${r.claim.contested ? "Contestada" : "Não contestada"}</td><td>${b}</td><td>${n}</td></tr>`).join("")).join("")}</tbody></table></div>` : "<p>Nenhuma reivindicação herdada vigente antes ou depois.</p>"}</details>`).join("")}`}</section>`).join("")}</section>`;
}

export function renderTerritoryPreview(preview: any): string {
  return renderTerritoryClaimsPreview(preview) + (preview?.rightInheritanceImpact ? renderTerritoryRightsPreview(preview.rightInheritanceImpact) : "");
}
