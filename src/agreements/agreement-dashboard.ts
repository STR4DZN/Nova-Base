import { immutable } from "../core/validation/value-validation.js";
import { AGREEMENT_LIFECYCLES, type AgreementLifecycle } from "./agreement-model.js";
export type AgreementLifecycleFilter = AgreementLifecycle | "negotiation";
export interface AgreementDashboardSummary {
  readonly total: number;
  readonly byLifecycle: Readonly<Record<AgreementLifecycle, number>>;
}
export const agreementLifecycleLabels: Readonly<Record<AgreementLifecycle, string>> = Object.freeze({
  draft: "Rascunho", proposed: "Proposta inicial", pendingApproval: "Em aprovação", active: "Ativo",
  suspended: "Suspenso", breached: "Quebra registrada", expired: "Expirado", terminated: "Encerrado"
});
export const AGREEMENT_DASHBOARD_GROUPS: readonly { readonly filter: AgreementLifecycleFilter; readonly label: string }[] = immutable([
  { filter: "draft", label: "Rascunhos" }, { filter: "negotiation", label: "Em negociação" }, { filter: "active", label: "Ativos" },
  { filter: "suspended", label: "Suspensos" }, { filter: "breached", label: "Quebra registrada" }, { filter: "expired", label: "Expirados" },
  { filter: "terminated", label: "Encerrados" }
]);
export function isAgreementLifecycleFilter(value: unknown): value is AgreementLifecycleFilter {
  return value === "negotiation" || AGREEMENT_LIFECYCLES.includes(value as AgreementLifecycle);
}
export function matchesAgreementLifecycle(lifecycle: AgreementLifecycle, filter?: AgreementLifecycleFilter | ""): boolean {
  return !filter || (filter === "negotiation" ? lifecycle === "proposed" || lifecycle === "pendingApproval" : lifecycle === filter);
}
/** Includes only states admitted by the authority's audience/search/recovery filters. */
export function summarizeAgreementLifecycles(states: readonly AgreementLifecycle[]): AgreementDashboardSummary {
  const counts = Object.fromEntries(AGREEMENT_LIFECYCLES.map(state => [state, 0])) as Record<AgreementLifecycle, number>;
  for (const state of states) counts[state]++;
  return immutable({ total: states.length, byLifecycle: counts });
}
