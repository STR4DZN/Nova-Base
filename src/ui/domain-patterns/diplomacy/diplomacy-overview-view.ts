import type { DiplomacyOverview, DiplomacyOverviewFilter, DiplomacyOverviewReason } from "../../../diplomacy/diplomacy-overview.js";
import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
const categories: readonly [DiplomacyOverviewFilter, string][] = [["all", "Todos os destaques"], ["breaches", "Quebras registradas"],
  ["overdue", "Obrigações fora do prazo"], ["expiring", "Prazos dos acordos"], ["disputes", "Disputas abertas"], ["proposals", "Propostas pendentes"], ["changes", "Alterações recentes (GM)"]];
const reasons: Record<DiplomacyOverviewReason, string> = { breach: "Quebra registrada", overdue: "Obrigação além da carência",
  "expiry-due": "Prazo de vigência alcançado", expiring: "Vigência perto do fim", dispute: "Disputa aberta", proposal: "Aguarda revisão", recent: "Alteração recente" };
const tabs = { relation: "relations", reputation: "reputation", agreement: "agreements", territory: "territory", dispute: "disputes", proposal: "proposals" } as const;
const kinds = { relation: "Relação", reputation: "Reputação", agreement: "Acordo", territory: "Território", dispute: "Disputa", proposal: "Proposta" } as const;
export function renderDiplomacyOverview(d: DiplomacyOverview | null, filter: DiplomacyOverviewFilter, expiryHorizonTicks: number, recentHours: number): string {
  const controls = `<form data-dm-form="overview-filter"><label>Destaques<select name="filter">${categories.map(([v, label]) => `<option value="${v}" ${v === filter ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <label>Horizonte de vigência (ticks do mundo)<input type="number" name="expiryHorizonTicks" min="0" max="1000000" step="1" value="${expiryHorizonTicks}" required></label>
    <label>Alterações recentes GM (horas reais)<input type="number" name="recentHours" min="1" max="720" step="1" value="${recentHours}" required></label><button>Aplicar</button></form>`;
  if (!d) return `<section><h2>Painel geral da diplomacia</h2><p>Resumo indisponível. Atualize a consulta.</p>${controls}</section>`;
  const s = d.summary;
  const counts = { all: s.attention, breaches: s.breaches, overdue: s.overdue, expiring: s.expiring, disputes: s.disputes, proposals: s.proposals, changes: s.changes };
  return `<section><h2>Painel geral da diplomacia</h2><p>Somente registros visíveis e disponíveis, dentro da pesquisa. Os cards contam registros, antes do filtro e da página; um registro pode aparecer em mais de um card.</p>
    <div class="dm-agreement-summary">${categories.map(([v, label]) => `<button type="button" data-dm-overview-filter="${v}" aria-pressed="${filter === v}" ${v === "changes" && !d.isGm ? "disabled" : ""}>${escapeHtml(label)}<strong>${counts[v] === null ? "Exclusivo do GM" : counts[v]}</strong></button>`).join("")}</div>
    <p>Registros: ${Object.entries(s.records).map(([kind, count]) => `${kinds[kind as keyof typeof kinds]}: ${count}`).join(" · ")}</p>${controls}
    <p>Tick atual: ${d.worldTick}. Horizonte: ${d.expiryHorizonTicks} ticks. Alterações nos últimos ${d.recentHours} h reais, apuradas pela autoridade${d.isGm ? "" : "; auditoria recente exclusiva do GM"}.</p>
    <p>Prazo alcançado não encerra um acordo. Atraso não confirma uma quebra. Disputas incluem latentes e congeladas. Propostas: ${d.isGm ? "inbox da autoridade" : "somente as enviadas por você"}.</p>
    <p>${d.total} destaques neste filtro; ${s.attention} registros com pendências/alertas. Alterações recentes também podem aparecer sem pendência.</p>
    ${d.items.length ? `<div class="dm-reputation-history-table"><table><thead><tr><th>Registro</th><th>Estado</th><th>Destaques</th><th>Vigência / alteração</th></tr></thead><tbody>${d.items.map(r => `<tr><td><button type="button" data-dm-overview-tab="${tabs[r.kind]}" data-dm-overview-id="${escapeAttribute(r.id)}">${escapeHtml(r.label)}</button><small>${kinds[r.kind]}</small></td>
      <td>${escapeHtml(r.lifecycle)}</td><td>${r.reasons.map(x => reasons[x]).join(" · ")}</td><td>${r.expiresAtWorldTick !== undefined ? `Fim no tick ${r.expiresAtWorldTick}` : ""}${r.changedAtReal !== undefined ? ` · ${escapeHtml((r.changedAtReal <= 8_640_000_000_000_000 ? new Date(r.changedAtReal).toISOString() : String(r.changedAtReal) + " ms"))}` : ""}</td></tr>`).join("")}</tbody></table></div>` : "<p>Nenhum destaque visível neste filtro/pesquisa.</p>"}
    <button type="button" data-dm-page="-1" ${d.offset === 0 ? "disabled" : ""}>Anterior</button><button type="button" data-dm-page="1" ${d.offset + d.limit >= d.total ? "disabled" : ""}>Próxima</button></section>`;
}
