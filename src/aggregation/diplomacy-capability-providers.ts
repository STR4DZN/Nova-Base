import type { TypedRef } from "../core/identity/refs.js";
import type { RelationVisibility } from "../relations/types/relation-types.js";
import type { AgreementDefinition, AgreementInstance } from "../agreements/agreement-model.js";
import { resolveAgreementGrants } from "../agreements/agreement-obligations.js";
import type { TerritoryState } from "../territory/territory-state.js";
import { resolveTerritoryRights, samePartyRef } from "../territory/territory-rights.js";
import { territoryAncestors, type TerritoryParentAxis } from "../territory/territory-hierarchy.js";
import type { CapabilityGrantProvenance } from "./people-grants.js";
import type { CapabilityGrantProvider, CapabilityResolutionContext } from "./capability-resolver.js";
import { isTimestamp } from "../core/validation/value-validation.js";
export interface DiplomacyCapabilityContext {
  readonly worldTick: number; readonly agreements: readonly { readonly agreement: AgreementInstance; readonly definition: AgreementDefinition }[];
  readonly territories: readonly TerritoryState[]; readonly territoryUuid?: string; readonly inheritanceAxis?: TerritoryParentAxis;
  readonly canSee: (visibility: RelationVisibility) => boolean; readonly conditionSatisfied: (ref: TypedRef) => boolean;
}
export class AgreementCapabilityProvider implements CapabilityGrantProvider {
  readonly id = "agreement";
  resolveGrants(context: CapabilityResolutionContext): readonly CapabilityGrantProvenance[] {
    const c = context.diplomacy; if (!c || !isTimestamp(c.worldTick)) return [];
    const ancestry = c.territoryUuid ? territoryAncestors(c.territories.map(s => s.territory), c.territoryUuid,
      c.inheritanceAxis ?? "locatedInUuid") : null;
    return c.agreements.flatMap(({ agreement, definition }) => {
      const derived = resolveAgreementGrants(agreement, definition, c.worldTick, c.conditionSatisfied, c.canSee);
      return derived.capabilities.flatMap(g => {
        if (!samePartyRef(g.beneficiaryRef, { type: "domain", uuid: context.domainUuid })) return [];
        const right = derived.rights.find(r => r.termId === g.termId), source = right
          ? c.territories.find(s => s.territory.uuid === right.payload.territoryUuid) : null;
        if (right && (!source || !c.canSee(source.territory.visibility))) return [];
        const inherited = !!(right?.payload.inherited && ancestry?.ok && ancestry.value.includes(right.payload.territoryUuid));
        const inScope = g.scopeRef === null || g.scopeRef.type === "territory" && (g.scopeRef.uuid === c.territoryUuid || inherited)
          || g.scopeRef.type === "domain" && g.scopeRef.uuid === context.domainUuid;
        if (!inScope) return [];
        return [{ capabilityId: g.capabilityId, sourceType: "agreement" as const, sourceId: `${g.agreementId}:${g.termId}`,
          sourceLabel: agreement.label, scopeRef: inherited ? { type: "territory", uuid: c.territoryUuid! } : g.scopeRef,
          ...(right ? { inherited } : {}) }];
      });
    });
  }
}
export class TerritoryRightCapabilityProvider implements CapabilityGrantProvider {
  readonly id = "territory-right";
  resolveGrants(context: CapabilityResolutionContext): readonly CapabilityGrantProvenance[] {
    const c = context.diplomacy; if (!c || !c.territoryUuid || !isTimestamp(c.worldTick)) return [];
    const result = resolveTerritoryRights(c.territories, c.territoryUuid, { type: "domain", uuid: context.domainUuid }, {
      worldTick: c.worldTick, canSee: c.canSee, conditionSatisfied: c.conditionSatisfied, inheritanceAxis: c.inheritanceAxis ?? "locatedInUuid" });
    if (!result.ok) return [];
    return result.value.flatMap(r => r.grants.map(capabilityId => ({ capabilityId, sourceType: "territory-right" as const,
      sourceId: `${r.sourceTerritoryUuid}:${r.rightId}`, sourceLabel: r.rightType,
      scopeRef: { type: "territory", uuid: r.territoryUuid }, inherited: r.inherited })));
  }
}
