import type { TerritoryRightsReport, TerritoryRightView } from "../../../diplomacy/territory-rights-query.js";
import { CLAIM_INHERITANCE_AXES } from "./territory-claims-view.js";
import { escapeHtml as h, escapeAttribute as attr } from "../facilities/facility-view.js";
const statusLabel = { effective: "Efetivo", inactive: "Inativo", "source-inactive": "Acordo sem vigência ativa", scheduled: "Agendado", expired: "Expirado", "conditions-unconfirmed": "Condições não confirmadas" };
const rightLabel = (type: string) => ({ "domain-manager:entry": "Entrada", "domain-manager:trade": "Comércio", "domain-manager:transit": "Trânsito", "domain-manager:build": "Construção", "domain-manager:extract": "Extração" })[type] ?? type;
const yes = (value: boolean) => value ? "Sim" : "Não";
function rowsTable(rows: readonly TerritoryRightView[]): string {
  return `<div class="dm-territory-claims-table"><table><thead><tr><th>Direito / beneficiário</th><th>Origem / âmbito</th><th>Herança</th><th>Situação / vigência</th><th>Condições</th><th>Revogável</th><th>Capacidades declaradas</th></tr></thead><tbody>${rows.map(r => `<tr>
    <td>${h(rightLabel(r.rightType))}<small>${h(r.rightId)}</small><small>${h(r.beneficiaryRef.type)}: ${h(r.beneficiaryRef.uuid ?? r.beneficiaryRef.id ?? "")}${"domainUuid" in r.beneficiaryRef ? ` (${h(r.beneficiaryRef.domainUuid)})` : ""}</small></td>
    <td><button type="button" data-dm-right-kind="${r.origin.kind}" data-dm-right-origin="${attr(r.origin.id)}">${h(r.origin.label)}</button><small>${r.origin.kind === "agreement" ? "Acordo" : "Território"}: ${h(r.origin.id)} · revisão ${r.origin.revision}</small><small>Âmbito: ${h(r.sourceTerritoryLabel)} (${h(r.sourceTerritoryUuid)}) · revisão ${r.sourceTerritoryRevision}</small></td>
    <td>${r.inherited ? "Herdado" : "Local"}<small>Propaga aos descendentes: ${yes(r.propagates)}</small></td>
    <td>${statusLabel[r.status]}<small>Origem ativa: ${yes(r.sourceActive)}</small><small>${r.startsAtWorldTick} → ${r.expiresAtWorldTick ?? "sem limite"} (fim exclusivo)</small></td>
    <td>${r.conditions.length ? r.conditions.map(c => `${h(c.ref.type)}: ${h(c.ref.uuid ?? c.ref.id ?? "")} · ${c.confirmed === null ? "Não avaliada" : c.confirmed ? "Confirmada" : "Não confirmada"}`).join("<br>") : "Sem condições"}</td>
    <td>${yes(r.revocable)}</td><td>${r.grants.length ? r.grants.map(h).join("<br>") : "Nenhuma"}</td></tr>`).join("")}</tbody></table></div>`;
}
/** Renders only the authenticated projection, never copies derived rights into local edit controls. */
export function renderTerritoryRights(report: TerritoryRightsReport): string {
  const effective = report.entries.filter(r => r.status === "effective"), other = report.entries.filter(r => r.status !== "effective");
  return `<section><h3>Direitos territoriais efetivos por origem</h3><form data-dm-form="right-inheritance"><label>Consultar herança dos direitos<select name="rightInheritanceAxis">${CLAIM_INHERITANCE_AXES.map(([key, title]) => `<option value="${key}"${key === report.axis ? " selected" : ""}>${title}</option>`).join("")}</select></label><button>Consultar</button></form>
    <p>${effective.length} direitos efetivos visíveis no tick ${report.worldTick}. Cada hierarquia é consultada separadamente, com as origens acessíveis e disponíveis.</p>
    <p>Um direito pode existir sem conceder capacidades. As capacidades declaradas nesta tabela não representam a resolução final de capacidades do beneficiário. A herança é calculada sem copiar registros locais.</p>
    ${effective.length ? rowsTable(effective) : "<p>Nenhum direito efetivo visível nesta consulta.</p>"}
    ${other.length ? `<details><summary>Outros direitos visíveis: ${other.length}</summary>${rowsTable(other)}</details>` : ""}</section>`;
}
