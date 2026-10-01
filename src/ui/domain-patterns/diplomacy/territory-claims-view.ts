import type { EffectiveTerritoryClaimView } from "../../../diplomacy/territory-claims-query.js";
import type { TerritoryParentAxis } from "../../../territory/territory-hierarchy.js";
import type { RelationPartyRef } from "../../../relations/types/relation-types.js";
import { escapeHtml as h, escapeAttribute as attr } from "../facilities/facility-view.js";
export const CLAIM_INHERITANCE_AXES = [["locatedInUuid", "Hierarquia física"], ["administrativeParentUuid", "Hierarquia administrativa"]] as const;
const typeLabel = (type: string) => ({ "domain-manager:ownership": "Propriedade", "domain-manager:administration": "Administração", "domain-manager:control": "Controle" })[type] ?? type;
const partyLabel = (r: RelationPartyRef) => `${r.type}: ${"uuid" in r ? r.uuid : r.id}${"domainUuid" in r ? ` (${r.domainUuid})` : ""}`;
/** Input is the authenticated detail DTO; inherited claims stay separate from local editable sources. */
export function renderTerritoryClaims(rows: readonly EffectiveTerritoryClaimView[], axis: TerritoryParentAxis, tick: number): string {
  const local = rows.filter(r => !r.inherited).length;
  return `<section><h3>Reivindicações vigentes por origem</h3><form data-dm-form="claim-inheritance"><label>Consultar herança<select name="claimInheritanceAxis">${CLAIM_INHERITANCE_AXES.map(([key, title]) => `<option value="${key}"${key === axis ? " selected" : ""}>${title}</option>`).join("")}</select></label><button>Consultar</button></form>
    <p>${local} locais · ${rows.length - local} herdadas visíveis no tick ${tick}. Cada hierarquia é consultada separadamente.</p>
    <p>Esta consulta usa as origens acessíveis e disponíveis. Reivindicações concorrentes e contestadas permanecem separadas; a herança é calculada sem copiar registros para este território.</p>
    ${rows.length ? `<div class="dm-territory-claims-table"><table><thead><tr><th>Natureza</th><th>Origem</th><th>Reivindicação</th><th>Parte</th><th>Tipo</th><th>Situação</th><th>Vigência</th><th>Propaga aos descendentes</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.inherited ? "Herdada" : "Local"}</td><td><button type="button" data-dm-claim-origin="${attr(r.sourceTerritoryUuid)}">${h(r.sourceTerritoryLabel)}</button><small>${h(r.sourceTerritoryUuid)} · revisão ${r.sourceRevision}</small></td><td>${h(r.claim.id)}</td><td>${h(partyLabel(r.claim.claimantRef))}</td><td>${h(typeLabel(r.claim.claimType))}</td><td>${r.claim.contested ? "Contestada" : "Não contestada"}</td><td>${r.claim.startsAtWorldTick} → ${r.claim.expiresAtWorldTick ?? "sem limite"}</td><td>${r.claim.inherited ? "Sim" : "Não"}</td></tr>`).join("")}</tbody></table></div>` : "<p>Nenhuma reivindicação vigente visível nesta consulta.</p>"}</section>`;
}
