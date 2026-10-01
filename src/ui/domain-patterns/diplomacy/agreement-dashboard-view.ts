import { AGREEMENT_LIFECYCLES } from "../../../agreements/agreement-model.js";
import { AGREEMENT_DASHBOARD_GROUPS, agreementLifecycleLabels, type AgreementDashboardSummary,
  type AgreementLifecycleFilter } from "../../../agreements/agreement-dashboard.js";
import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
export function renderAgreementDashboard(summary: AgreementDashboardSummary | undefined, filter: AgreementLifecycleFilter | "", search: string): string {
  if (!summary) return '<section><h2>Acordos por estado</h2><p>Resumo indisponível. Atualize a consulta para ver os acordos visíveis.</p></section>';
  const card = (value: string, label: string, count: number) => `<button type="button" data-dm-agreement-state="${value}" aria-pressed="${filter === value}">
    <span>${escapeHtml(label)}</span><strong>${count}</strong></button>`;
  return `<section><h2>Acordos por estado</h2>
    <p>${search ? `Contagens dos acordos visíveis encontrados para “${escapeHtml(search)}”.` : "Contagens de todos os acordos visíveis."} O filtro de estado e a página não alteram estas contagens.</p>
    <div class="dm-agreement-summary">${card("", "Todos", summary.total)}${AGREEMENT_DASHBOARD_GROUPS.map(g => card(g.filter, g.label,
      g.filter === "negotiation" ? summary.byLifecycle.proposed + summary.byLifecycle.pendingApproval : summary.byLifecycle[g.filter])).join("")}</div>
    <form data-dm-form="agreement-state"><label>Filtrar por estado<select name="agreementLifecycle"><option value="" ${filter === "" ? "selected" : ""}>Todos os estados</option>
      <option value="negotiation" ${filter === "negotiation" ? "selected" : ""}>Em negociação (proposta inicial / aprovação)</option>
      ${AGREEMENT_LIFECYCLES.map(state => `<option value="${state}" ${filter === state ? "selected" : ""}>${escapeHtml(agreementLifecycleLabels[state])}</option>`).join("")}</select></label><button>Aplicar filtro</button></form>
    <p>Em negociação reúne propostas iniciais e acordos em aprovação. Emendas pendentes mantêm o estado vigente do acordo. Os estados são os registrados; atingir um prazo não expira o acordo automaticamente.</p>
    <p>Filtro atual: ${escapeHtml(filter === "negotiation" ? "Em negociação" : filter ? agreementLifecycleLabels[filter] : "Todos os estados")}.</p>
    ${filter ? '<button type="button" data-dm-agreement-state="">Limpar filtro de estado</button>' : ""}
  </section>`;
}
export function renderAgreementListItem(item: { id: string; label: string; lifecycle: string }, selectedId: string | null): string {
  return `<button type="button" data-dm-id="${escapeAttribute(item.id)}" aria-pressed="${selectedId === item.id}">
    ${escapeHtml(item.label)} <small>${escapeHtml(agreementLifecycleLabels[item.lifecycle as keyof typeof agreementLifecycleLabels] ?? item.lifecycle)}</small></button>`;
}
