import { canonicalJsonStringify } from "../commands/command-dedupe-store.js";
import { immutable } from "../core/validation/value-validation.js";
import type { AgreementDuration, AgreementTerm } from "./agreement-model.js";
export interface AgreementTermDifference {
  readonly id: string; readonly kind: "added" | "removed" | "changed";
  readonly before: AgreementTerm | null; readonly after: AgreementTerm | null;
  readonly changedFields: readonly string[];
}
export interface AgreementNegotiationDifference {
  readonly terms: readonly AgreementTermDifference[];
  readonly duration: { readonly before: AgreementDuration; readonly after: AgreementDuration; readonly changed: boolean };
  readonly orderChanged: boolean;
}
/** Compare audience-filtered snapshots only. This read model never mutates or stores terms. */
export function compareAgreementSnapshots(before: readonly AgreementTerm[], after: readonly AgreementTerm[],
  beforeDuration: AgreementDuration, afterDuration: AgreementDuration): AgreementNegotiationDifference {
  const old = new Map(before.map(t => [t.id, t])), next = new Map(after.map(t => [t.id, t]));
  const terms: AgreementTermDifference[] = [];
  const fields = ["type", "title", "text", "visibility", "partyIds", "payload"] as const;
  for (const b of before) {
    const a = next.get(b.id);
    if (!a) terms.push({ id: b.id, kind: "removed", before: b, after: null, changedFields: [] });
    else {
      const changedFields = fields.filter(k => canonicalJsonStringify(b[k]) !== canonicalJsonStringify(a[k]));
      if (changedFields.length) terms.push({ id: b.id, kind: "changed", before: b, after: a, changedFields });
    }
  }
  for (const a of after) if (!old.has(a.id)) terms.push({ id: a.id, kind: "added", before: null, after: a, changedFields: [] });
  const sharedBefore = before.filter(t => next.has(t.id)).map(t => t.id), sharedAfter = after.filter(t => old.has(t.id)).map(t => t.id);
  return immutable(structuredClone({ terms, duration: { before: beforeDuration, after: afterDuration,
    changed: canonicalJsonStringify(beforeDuration) !== canonicalJsonStringify(afterDuration) },
    orderChanged: canonicalJsonStringify(sharedBefore) !== canonicalJsonStringify(sharedAfter) }));
}
