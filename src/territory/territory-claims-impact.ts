import { ok, type Result } from "../core/contracts/result.js";
import { failure, immutable, isTimestamp } from "../core/validation/value-validation.js";
import { validateTerritoryGraph, type TerritoryParentAxis } from "./territory-hierarchy.js";
import { projectTerritoryState, validateTerritoryState, type TerritoryClaim, type TerritoryState } from "./territory-state.js";
import { resolveTerritoryClaims } from "./territory-rights.js";
export interface InheritedClaimOrigin {
  readonly sourceTerritoryUuid: string; readonly sourceTerritoryLabel: string; readonly sourceRevision: number; readonly claim: TerritoryClaim;
}
export interface TerritoryClaimImpact {
  readonly territoryUuid: string; readonly label: string; readonly revision: number; readonly localCount: number;
  readonly before: readonly InheritedClaimOrigin[]; readonly after: readonly InheritedClaimOrigin[];
  readonly added: readonly InheritedClaimOrigin[]; readonly removed: readonly InheritedClaimOrigin[]; readonly retained: readonly InheritedClaimOrigin[];
}
export interface TerritoryClaimsImpactPreview {
  readonly worldTick: number;
  readonly axes: readonly { readonly axis: TerritoryParentAxis; readonly changed: boolean; readonly territories: readonly TerritoryClaimImpact[] }[];
}
/** GM review of a validated reparent plan. Claims remain derived; local sources and other owners never change. */
export function previewTerritoryClaimsImpact(before: readonly TerritoryState[], after: readonly TerritoryState[], uuid: string, tick: number): Result<TerritoryClaimsImpactPreview> {
  if (!isTimestamp(tick)) return failure("DM_TERRITORY_CLAIMS_TIME_INVALID", "Claim impact preview requires an explicit world tick");
  for (const states of [before, after]) {
    for (const state of states) { const valid = validateTerritoryState(state); if (!valid.ok) return valid; }
    const graph = validateTerritoryGraph(states.map(s => s.territory)); if (!graph.ok) return graph;
  }
  const targetBefore = before.find(s => s.territory.uuid === uuid), targetAfter = after.find(s => s.territory.uuid === uuid);
  if (!targetBefore || !targetAfter) return failure("DM_TERRITORY_NOT_FOUND", "Claim impact target unavailable", "not-found");
  const visibleBefore = before.map(s => projectTerritoryState(s, () => true)!), visibleAfter = after.map(s => projectTerritoryState(s, () => true)!);
  const origins = (states: readonly TerritoryState[], id: string, axis: TerritoryParentAxis) => {
    const resolved = resolveTerritoryClaims(states, id, { worldTick: tick, inheritanceAxis: axis, canSee: () => true });
    if (!resolved.ok) return resolved;
    const sourceMap = new Map(states.map(s => [s.territory.uuid, s.territory]));
    return ok({ localCount: resolved.value.filter(r => !r.inherited).length, inherited: resolved.value.filter(r => r.inherited).map(r => ({
      sourceTerritoryUuid: r.sourceTerritoryUuid, sourceTerritoryLabel: sourceMap.get(r.sourceTerritoryUuid)!.label,
      sourceRevision: sourceMap.get(r.sourceTerritoryUuid)!.revision, claim: r.claim })) });
  };
  const key = (r: InheritedClaimOrigin) => JSON.stringify([r.sourceTerritoryUuid, r.claim.id]);
  const axes: TerritoryClaimsImpactPreview["axes"][number][] = [];
  for (const axis of ["locatedInUuid", "administrativeParentUuid"] as const) {
    const changed = targetBefore.territory[axis] !== targetAfter.territory[axis], territories: TerritoryClaimImpact[] = [];
    if (changed) {
      const children = new Map<string, string[]>();
      for (const s of before) { const parent = s.territory[axis]; if (parent) { const ids = children.get(parent) ?? []; ids.push(s.territory.uuid); children.set(parent, ids); } }
      const affected = [uuid]; for (let i = 0; i < affected.length; i++) affected.push(...children.get(affected[i]) ?? []);
      const statesById = new Map(before.map(s => [s.territory.uuid, s.territory]));
      for (const id of affected) {
        const b = origins(visibleBefore, id, axis); if (!b.ok) return b;
        const a = origins(visibleAfter, id, axis); if (!a.ok) return a;
        const bKeys = new Set(b.value.inherited.map(key)), aKeys = new Set(a.value.inherited.map(key)), t = statesById.get(id)!;
        territories.push({ territoryUuid: id, label: t.label, revision: t.revision, localCount: b.value.localCount,
          before: b.value.inherited, after: a.value.inherited, added: a.value.inherited.filter(r => !bKeys.has(key(r))),
          removed: b.value.inherited.filter(r => !aKeys.has(key(r))), retained: a.value.inherited.filter(r => bKeys.has(key(r))) });
      }
    }
    axes.push({ axis, changed, territories });
  }
  return ok(immutable({ worldTick: tick, axes }));
}
