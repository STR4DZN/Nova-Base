import { immutable } from "../core/validation/value-validation.js";
import type { AgreementTerm } from "./agreement-model.js";
import type { AgreementObligation, ObligationCompliance, ObligationTermPayload } from "./agreement-obligations.js";
export interface AgreementObligationInspector extends AgreementObligation {
  readonly termSnapshot: AgreementTerm;
  readonly compliance: ObligationCompliance;
  readonly deadline: { readonly dueAtWorldTick: number | null; readonly graceTicks: number; readonly graceEndsAtWorldTick: string | null };
}
/** The caller supplies only a term already admitted by the viewer's visibility filter. */
export function projectObligationInspector(obligation: AgreementObligation, term: AgreementTerm,
  compliance: ObligationCompliance): AgreementObligationInspector {
  const p = term.payload as ObligationTermPayload;
  return immutable(structuredClone({ ...obligation, termSnapshot: term, compliance,
    deadline: { dueAtWorldTick: p.dueAtWorldTick, graceTicks: p.graceTicks,
      graceEndsAtWorldTick: p.dueAtWorldTick === null ? null : String(BigInt(p.dueAtWorldTick) + BigInt(p.graceTicks)) } }));
}
