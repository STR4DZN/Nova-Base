import { ok, type Result } from "../core/contracts/result.js";
import { failure, immutable, isTimestamp } from "../core/validation/value-validation.js";
import { canonicalJsonStringify } from "../commands/command-dedupe-store.js";
import type { TypedRef } from "../core/identity/refs.js";
import type { RelationPartyRef, RelationVisibility } from "../relations/types/relation-types.js";
import { territoryAncestors, type TerritoryParentAxis } from "./territory-hierarchy.js";
import { temporalSourceIsEffective, type TerritoryState, type TerritoryClaim, type TerritoryRight, type TerritoryLink } from "./territory-state.js";
export const samePartyRef = (a: RelationPartyRef, b: RelationPartyRef) => canonicalJsonStringify(a) === canonicalJsonStringify(b);
export interface EffectiveTerritoryRight {
  readonly sourceTerritoryUuid: string; readonly territoryUuid: string; readonly rightId: string;
  readonly beneficiaryRef: RelationPartyRef; readonly rightType: string; readonly inherited: boolean; readonly grants: readonly string[];
}
export interface TerritoryRightsContext {
  readonly worldTick: number; readonly canSee: (visibility: RelationVisibility) => boolean;
  readonly conditionSatisfied: (ref: TypedRef) => boolean; readonly inheritanceAxis: TerritoryParentAxis;
  readonly accessAllowed?: (right: TerritoryRight, targetTerritoryUuid: string) => boolean;
}
/** Inheritance stays derived. It never duplicates grants into descendant records. */
export function resolveTerritoryRights(states: readonly TerritoryState[], territoryUuid: string, beneficiary: RelationPartyRef, c: TerritoryRightsContext): Result<readonly EffectiveTerritoryRight[]> {
  if (!isTimestamp(c.worldTick)) return failure("DM_TERRITORY_RIGHTS_TIME_INVALID", "Rights require an explicit world tick");
  const target = states.find(s => s.territory.uuid === territoryUuid);
  if (!target) return failure("DM_TERRITORY_NOT_FOUND", "Right target unavailable", "not-found");
  if (!c.canSee(target.territory.visibility)) return ok([]);
  const ancestors = territoryAncestors(states.map(s => s.territory), territoryUuid, c.inheritanceAxis); if (!ancestors.ok) return ancestors;
  const sources = [territoryUuid, ...ancestors.value], rights: EffectiveTerritoryRight[] = [];
  for (const uuid of sources) {
    const state = states.find(s => s.territory.uuid === uuid)!; if (!c.canSee(state.territory.visibility)) continue;
    for (const r of state.rights) {
      if (!r.active || !temporalSourceIsEffective(r, c.worldTick) || !c.canSee(r.visibility) || !samePartyRef(r.beneficiaryRef, beneficiary)
        || (uuid !== territoryUuid && !r.inherited) || !r.conditionRefs.every(c.conditionSatisfied) || (c.accessAllowed && !c.accessAllowed(r, territoryUuid))) continue;
      rights.push({ sourceTerritoryUuid: uuid, territoryUuid, rightId: r.id, beneficiaryRef: r.beneficiaryRef, rightType: r.rightType,
        inherited: uuid !== territoryUuid, grants: r.grants });
    }
  }
  return ok(immutable(structuredClone(rights)));
}
export function resolveTerritoryClaims(states: readonly TerritoryState[], territoryUuid: string, c: Pick<TerritoryRightsContext, "worldTick" | "canSee" | "inheritanceAxis">): Result<readonly {
  readonly sourceTerritoryUuid: string; readonly inherited: boolean; readonly claim: TerritoryClaim;
}[]> {
  if (!isTimestamp(c.worldTick)) return failure("DM_TERRITORY_CLAIMS_TIME_INVALID", "Claims require an explicit world tick");
  const target = states.find(s => s.territory.uuid === territoryUuid);
  if (!target) return failure("DM_TERRITORY_NOT_FOUND", "Claim target unavailable", "not-found");
  if (!c.canSee(target.territory.visibility)) return ok([]);
  const ancestors = territoryAncestors(states.map(s => s.territory), territoryUuid, c.inheritanceAxis); if (!ancestors.ok) return ancestors;
  return ok(immutable([territoryUuid, ...ancestors.value].flatMap(uuid => {
    const s = states.find(s => s.territory.uuid === uuid)!; if (!c.canSee(s.territory.visibility)) return [];
    return s.claims.filter(x => x.lifecycle === "active" && temporalSourceIsEffective(x, c.worldTick) && c.canSee(x.visibility)
      && (uuid === territoryUuid || x.inherited)).map(claim => ({ sourceTerritoryUuid: uuid, inherited: uuid !== territoryUuid, claim }));
  })));
}
export function resolveTerritoryLinks(states: readonly TerritoryState[], territoryUuid: string, c: Pick<TerritoryRightsContext, "worldTick" | "canSee" | "conditionSatisfied">): readonly {
  readonly sourceTerritoryUuid: string; readonly targetTerritoryUuid: string; readonly link: TerritoryLink;
}[] {
  const target = states.find(s => s.territory.uuid === territoryUuid);
  if (!isTimestamp(c.worldTick) || !target || !c.canSee(target.territory.visibility)) return [];
  return immutable(states.flatMap(s => !c.canSee(s.territory.visibility) ? [] : s.links.filter(l => c.canSee(l.visibility)
    && (l.status === "operational" || l.status === "limited") && temporalSourceIsEffective(l, c.worldTick) && l.dependencyRefs.every(c.conditionSatisfied)
    && (s.territory.uuid === territoryUuid ? l.direction !== "inbound" : l.targetTerritoryUuid === territoryUuid && l.direction !== "outbound")
    && states.some(x => x.territory.uuid === l.targetTerritoryUuid && c.canSee(x.territory.visibility)))
    .map(link => ({ sourceTerritoryUuid: territoryUuid, targetTerritoryUuid: s.territory.uuid === territoryUuid ? link.targetTerritoryUuid : s.territory.uuid, link }))));
}
