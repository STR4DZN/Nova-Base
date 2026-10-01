import { ok, type Result } from "../core/contracts/result.js";
import { failure, isRecord, isText } from "../core/validation/value-validation.js";
import { historyWindow, type DiplomacyOwner } from "../diplomacy/owner-contract.js";
import { AgreementTermRegistry, changeAgreement, validateAgreementDefinition, type AgreementDefinition, type AgreementAction } from "./agreement-model.js";
import { registerAgreementTermOwners, validateAgreementState, initializeAgreementObligations, changeObligation, resolveAgreementCompliance,
  obligationTerm, type AgreementState, type ObligationAction } from "./agreement-obligations.js";
import { compareAgreementSnapshots } from "./agreement-negotiation.js";
import { projectObligationInspector } from "./agreement-obligation-inspector.js";
export interface AgreementOwnerData { readonly definition: AgreementDefinition; readonly state: AgreementState; readonly executedOperations?: readonly string[]; }
export function agreementTermRegistry(): AgreementTermRegistry { const registry = new AgreementTermRegistry(); registerAgreementTermOwners(registry); registry.freeze(); return registry; }
export const agreementOwner: DiplomacyOwner = {
  validate(raw): Result<AgreementOwnerData> {
    if (!isRecord(raw)) return failure("DM_AGREEMENT_STATE_INVALID", "Agreement envelope unavailable");
    const d = validateAgreementDefinition(raw.definition); if (!d.ok) return d;
    if (raw.executedOperations !== undefined && (!Array.isArray(raw.executedOperations) || !raw.executedOperations.every(isText)
      || new Set(raw.executedOperations).size !== raw.executedOperations.length)) return failure("DM_AGREEMENT_STATE_INVALID", "Invalid effect execution history");
    const state = validateAgreementState(raw.state, d.value, agreementTermRegistry()); return state.ok ? ok({ definition: d.value, state: state.value,
      executedOperations: (raw.executedOperations ?? []) as readonly string[] }) : state;
  },
  identity(data) { return (data as AgreementOwnerData).state.agreement; },
  parties(data) { return (data as AgreementOwnerData).state.agreement.parties.map(p => p.ref); },
  change(data, action, c) {
    const { definition: d, state: s } = data as AgreementOwnerData;
    if (!isRecord(action)) return failure("DM_AGREEMENT_CHANGE_INVALID", "Invalid agreement action");
    let state: Result<AgreementState>;
    if (action.kind === "obligation") {
      const nested = action.action as ObligationAction;
      const normalized = nested?.kind === "evidence" ? { ...nested, evidence: { ...nested.evidence, at: c.at } } : nested;
      state = changeObligation(s, d, agreementTermRegistry(), action.obligationId as string,
        action.expectedObligationRevision as number, c, normalized);
    }
    else { const a = changeAgreement(s.agreement, d, agreementTermRegistry(), c, action as unknown as AgreementAction);
      state = a.ok ? validateAgreementState({ agreement: a.value, obligations: initializeAgreementObligations(a.value, s.obligations) }, d, agreementTermRegistry()) : a; }
    return state.ok ? ok({ ...(data as AgreementOwnerData), definition: d, state: state.value }) : state;
  },
  project(data, c) {
    const { definition: d, state: s } = data as AgreementOwnerData, a = s.agreement;
    if (!c.canSee(a.visibility)) return failure("DM_DIPLOMACY_NOT_FOUND", "Entity unavailable", "not-found");
    const terms = a.terms.filter(t => c.canSee(t.visibility)), compliance = resolveAgreementCompliance(s, c.worldTick); if (!compliance.ok) return compliance;
    const visibleObligations = s.obligations.filter(o => {
      const term = obligationTerm(a, o);
      return term !== undefined && c.canSee(term.visibility);
    });
    const complianceById = new Map(compliance.value.map(row => [row.obligationId, row]));
    const visibleIds = new Set(visibleObligations.map(o => o.id));
    return ok({ id: a.id, label: a.label, revision: a.revision, lifecycle: a.lifecycle, parties: a.parties, duration: a.duration, terms, worldTick: c.worldTick,
      obligations: visibleObligations.map(o => projectObligationInspector({ ...o,
        evidence: o.evidence.filter(e => c.canSee(e.visibility)), events: c.isGm ? historyWindow(o.events, c) : [] },
        obligationTerm(a, o)!, complianceById.get(o.id)!)),
      compliance: compliance.value.filter(row => visibleIds.has(row.obligationId)),
      proposals: a.proposals.map(p => {
        const rounds = p.rounds.map(r => ({ ...r, terms: r.terms.filter(t => c.canSee(t.visibility)) }));
        return { ...p, rounds: rounds.map((r, i) => ({ ...r, comparison: i === 0 ? null
          : compareAgreementSnapshots(rounds[i - 1].terms, r.terms, rounds[i - 1].duration, r.duration) })) };
      }),
      amendments: c.isGm ? historyWindow(a.amendments, c).map(m => {
        const beforeTerms = m.beforeTerms.filter(t => c.canSee(t.visibility)), afterTerms = m.afterTerms.filter(t => c.canSee(t.visibility));
        return { ...m, beforeTerms, afterTerms, comparison: compareAgreementSnapshots(beforeTerms, afterTerms, m.beforeDuration, m.afterDuration) };
      }) : [], history: c.isGm ? historyWindow(a.events, c) : [],
      ...(c.isGm ? { definition: d } : {}) });
  }
};
