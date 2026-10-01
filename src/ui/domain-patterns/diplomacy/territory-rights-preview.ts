import type { TerritoryRightsImpactPreview } from "../../../territory/territory-rights-impact.js";
import type { TerritoryRightView } from "../../../territory/territory-rights-view-model.js";
import { escapeHtml as h } from "../facilities/facility-view.js";
function row(r: TerritoryRightView, result: string, before: string, after: string): string {
  const p = r.beneficiaryRef;
  return `<tr><td>${result}</td><td>${r.origin.kind === "agreement" ? "Acordo" : "Território"}: ${h(r.origin.label)}<small>${h(r.origin.id)} · revisão ${r.origin.revision}</small></td>
    <td>${h(r.sourceTerritoryLabel)}<small>${h(r.sourceTerritoryUuid)} · revisão ${r.sourceTerritoryRevision}</small></td>
    <td>${h(r.rightType)}<small>${h(r.rightId)}</small><small>${h(p.type)}: ${h(p.uuid ?? p.id ?? "")}${p.domainUuid ? ` (${h(p.domainUuid)})` : ""}</small></td>
    <td>${r.startsAtWorldTick} → ${r.expiresAtWorldTick ?? "sem limite"}<small>Início inclusivo · fim exclusivo</small></td>
    <td>${r.conditions.length ? r.conditions.map(c => `${h(c.ref.type)}: ${h(c.ref.uuid ?? c.ref.id ?? "")} · ${c.confirmed === true ? "Confirmada" : "Não confirmada"}`).join("<br>") : "Sem condições"}</td>
    <td>${r.revocable ? "Sim" : "Não"}</td><td>${r.grants.length ? r.grants.map(h).join("<br>") : "Nenhuma"}</td><td>${before} → ${after}</td></tr>`;
}
export function renderTerritoryRightsPreview(preview: TerritoryRightsImpactPreview): string {
  return `<section data-dm-territory-rights-preview><h3>Impactos nos direitos herdados</h3><p>Direitos efetivos no tick ${preview.worldTick}, por origem e beneficiário. Condições não confirmadas não conferem direitos nesta consulta.</p>
    <p>Capacidades declaradas são apresentadas separadamente; esta prévia não calcula a resolução final de capacidades, não executa consequences e não copia direitos para os registros locais.</p>
    ${preview.axes.map(a => `<section><h4>${a.axis === "locatedInUuid" ? "Hierarquia física" : "Hierarquia administrativa"}</h4>${!a.changed ? "<p>Sem alteração neste eixo.</p>" : a.territories.map(t => `<details open><summary>${h(t.label)} · ${h(t.territoryUuid)} · revisão ${t.revision}</summary>
      <p>${t.before.length} herdados antes → ${t.after.length} depois: ${t.added.length} recebidos, ${t.removed.length} perdidos, ${t.retained.length} mantidos. ${t.localCount} direitos locais efetivos preservados.</p>
      ${t.added.length + t.removed.length + t.retained.length ? `<div class="dm-territory-claims-table"><table><thead><tr><th>Resultado</th><th>Origem</th><th>Âmbito</th><th>Direito / beneficiário</th><th>Vigência</th><th>Condições</th><th>Revogável</th><th>Capacidades declaradas</th><th>Antes → depois</th></tr></thead><tbody>${t.removed.map(r => row(r, "Perdido", "Sim", "Não")).join("")}${t.added.map(r => row(r, "Recebido", "Não", "Sim")).join("")}${t.retained.map(r => row(r, "Mantido", "Sim", "Sim")).join("")}</tbody></table></div>` : "<p>Nenhum direito herdado efetivo antes ou depois.</p>"}</details>`).join("")}</section>`).join("")}</section>`;
}
