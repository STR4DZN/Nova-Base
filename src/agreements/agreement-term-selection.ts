import { ok, type Result } from "../core/contracts/result.js";
import { failure, isRecord, isText } from "../core/validation/value-validation.js";
import type { AgreementTerm } from "./agreement-model.js";

/** Replace the explicitly selected slots; retain every unselected canonical term. */
export function mergeAgreementTermSelection(base: readonly AgreementTerm[], terms: readonly AgreementTerm[],
  selectedIds: readonly string[]): Result<readonly AgreementTerm[]> {
  if (!Array.isArray(terms) || !Array.isArray(selectedIds) || !selectedIds.every(isText)
    || new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !base.some(t => t.id === id)))
    return failure("DM_AGREEMENT_TERM_SELECTION_INVALID", "A seleção de termos não corresponde ao snapshot de origem.", "conflict");
  const selected = new Set(selectedIds), untouched = new Set(base.filter(t => !selected.has(t.id)).map(t => t.id));
  if (terms.some(t => !isRecord(t) || !isText(t.id) || untouched.has(t.id)))
    return failure("DM_AGREEMENT_TERM_SELECTION_CONFLICT", "Um termo da edição conflita com um termo fora da seleção.", "conflict");
  const merged: AgreementTerm[] = []; let cursor = 0;
  for (const term of base) {
    if (!selected.has(term.id)) merged.push(structuredClone(term));
    else if (cursor < terms.length) merged.push(structuredClone(terms[cursor++]));
  }
  merged.push(...terms.slice(cursor).map(t => structuredClone(t)));
  return ok(merged);
}
