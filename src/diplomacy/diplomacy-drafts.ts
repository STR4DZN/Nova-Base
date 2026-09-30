import { createOpaqueId } from "../core/identity/ids.js";
import type { RelationPartyRef, RelationVisibility } from "../relations/types/relation-types.js";
import { emptyTerritoryState } from "../territory/territory-state.js";
import type { OwnerIntent } from "./owner-commands.js";
/** UI drafts are proposals, not canonical state. The authority validates every field on create. */
export function createDiplomacyDraft(kind: OwnerIntent["kind"], label: string, parties: readonly RelationPartyRef[], visibility: RelationVisibility,
  territoryUuids: readonly string[] = []): { id: string; data: unknown } {
  const base = { schemaVersion: 1 as const, revision: 0, label, visibility, createdAt: 0, updatedAt: 0 };
  if (kind === "relation") {
    const id = createOpaqueId("rel");
    return { id, data: { definition: { id: "domain-manager:diplomatic-relation", version: 2, label: "Diplomatic relation", symmetry: "symmetric",
      minParties: 2, maxParties: null, allowedPartyTypes: ["domain", "actor", "narrative"], allowedPartyRoles: ["participant"],
      allowMultiple: true, stancePolicy: "derived", stanceRules: [
        { id: "domain-manager:distrust", label: "Desconfiança", visibility: "public", conditions: [{ axisId: "domain-manager:trust", minimum: -100, maximum: -1 }] },
        { id: "domain-manager:neutral", label: "Neutralidade", visibility: "public", conditions: [{ axisId: "domain-manager:trust", minimum: 0, maximum: 0 }] },
        { id: "domain-manager:trust", label: "Confiança", visibility: "public", conditions: [{ axisId: "domain-manager:trust", minimum: 1, maximum: 100 }] }
      ], axes: ["trust", "affinity", "fear", "respect"].map(axis => ({ id: `domain-manager:${axis}`, label: axis, minimum: -100, maximum: 100, defaultValue: 0 })) },
      state: { relation: { ...base, id, definitionId: "domain-manager:diplomatic-relation", definitionVersion: 2, lifecycle: "active",
        parties: parties.map((ref, i) => ({ id: `party-${i}`, role: "participant", ref })), scope: null, baseAxes: [], endedAt: null }, modifiers: [], events: [] } } };
  }
  if (kind === "reputation") {
    const id = createOpaqueId("rep");
    return { id, data: { definitions: [{ id: "domain-manager:standing", version: 1, label: "Standing", minimum: -100, maximum: 100, baseline: 0,
      visibility: "public", publicPresentation: "band", bands: [{ id: "domain-manager:distrusted", label: "Distrusted", minimum: -100, maximum: -1 },
        { id: "domain-manager:neutral", label: "Neutral", minimum: 0, maximum: 0 }, { id: "domain-manager:trusted", label: "Trusted", minimum: 1, maximum: 100 }], decay: null }],
      record: { ...base, id, subjectRef: parties[0], audienceRef: parties[1], entries: [],
        tracks: [{ definitionId: "domain-manager:standing", definitionVersion: 1, score: 0, initialScore: 0, lastDecayWorldTick: null }] } } };
  }
  if (kind === "agreement") {
    const id = crypto.randomUUID();
    return { id, data: { definition: { id: "domain-manager:treaty", version: 1, label: "Treaty", minParties: 2, maxParties: null,
      allowedPartyRoles: ["signatory"], allowedTermTypes: ["domain-manager:narrative", "domain-manager:obligation", "domain-manager:right", "domain-manager:capability", "domain-manager:owner-operation"],
      amendmentRequiresApproval: true, automaticRenewalAllowed: false, effectiveLifecycles: ["active", "breached"] }, state: { agreement: {
        ...base, id, definitionId: "domain-manager:treaty", definitionVersion: 1, lifecycle: "draft", parties: parties.map((ref, i) => ({ id: `party-${i}`, role: "signatory", ref })),
        terms: [], duration: { startsAtWorldTick: null, expiresAtWorldTick: null }, proposals: [], amendments: [], events: [], supersedesId: null }, obligations: [] }, executedOperations: [] } };
  }
  if (kind === "territory") {
    const id = `JournalEntry.${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    return { id, data: emptyTerritoryState({ ...base, uuid: id, kind: "domain-manager:region", scale: "region", locatedInUuid: null,
      administrativeParentUuid: null, geography: {}, hierarchyHistory: [] }) };
  }
  const id = crypto.randomUUID();
  return { id, data: { ...base, id, disputeType: "domain-manager:ownership", territoryUuids, parties, claimRefs: [], lifecycle: "latent", events: [] } };
}
