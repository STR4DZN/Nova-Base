import { ok, type Result } from "../core/contracts/result.js";
import { failure, immutable, isJsonData, isText, isTimestamp, isTypedRef, revisionGuard } from "../core/validation/value-validation.js";
import { validateTerritoryState, type TerritoryClaim, type TerritoryChangeContext, type TerritoryState, type TerritoryStateEvent } from "./territory-state.js";

export interface TerritoryTransferTarget {
  readonly territoryUuid: string; readonly expectedRevision: number; readonly supersedeClaimIds: readonly string[]; readonly newClaim: TerritoryClaim;
}
export interface TerritoryTransferPlan {
  readonly targets: readonly TerritoryTransferTarget[]; readonly context: Omit<TerritoryChangeContext, "expectedRevision">;
  readonly affectedClaimCount: number; readonly facilityOwnershipChanges: 0;
}
/** Competing unselected claims survive. Transfer makes no legitimacy judgment. Lease/concession are rights, not transfers. */
export function previewTerritoryTransfer(states: readonly TerritoryState[], targets: readonly TerritoryTransferTarget[], c: Omit<TerritoryChangeContext, "expectedRevision">): Result<TerritoryTransferPlan> {
  if (!isJsonData(targets) || !targets.length || new Set(targets.map(t => t.territoryUuid)).size !== targets.length
    || !isText(c.eventId) || !isTimestamp(c.at) || !isTimestamp(c.worldTick) || !isText(c.reason)
    || !Array.isArray(c.sourceRefs) || !c.sourceRefs.length || !c.sourceRefs.every(isTypedRef)) return failure("DM_TERRITORY_TRANSFER_INVALID", "Transfer requires unique targets and audit context");
  let count = 0;
  for (const target of targets) {
    const state = states.find(s => s.territory.uuid === target.territoryUuid); if (!state) return failure("DM_TERRITORY_NOT_FOUND", "Transfer territory unavailable", "not-found");
    const valid = validateTerritoryState(state); if (!valid.ok) return valid;
    const stale = revisionGuard(state.territory.revision, target.expectedRevision); if (stale) return stale;
    if (c.at < state.territory.updatedAt || state.events.some(e => e.id === c.eventId) || state.territory.hierarchyHistory.some(e => e.id === c.eventId)
      || !Array.isArray(target.supersedeClaimIds) || !target.supersedeClaimIds.length || new Set(target.supersedeClaimIds).size !== target.supersedeClaimIds.length
      || target.supersedeClaimIds.some(id => !state.claims.some(x => x.id === id && x.claimType === "domain-manager:ownership" && x.lifecycle === "active"))
      || !target.newClaim || target.newClaim.claimType !== "domain-manager:ownership" || target.newClaim.lifecycle !== "active"
      || target.newClaim.startsAtWorldTick !== c.worldTick || state.claims.some(x => x.id === target.newClaim.id))
      return failure("DM_TERRITORY_TRANSFER_INVALID", "Transfer requires active ownership claims and a new distinct ownership claim");
    const candidate = transferredState(state, target, c), check = validateTerritoryState(candidate); if (!check.ok) return check;
    count += target.supersedeClaimIds.length;
  }
  return ok(immutable(structuredClone({ targets, context: c, affectedClaimCount: count, facilityOwnershipChanges: 0 as const })));
}
function transferredState(state: TerritoryState, t: TerritoryTransferTarget, c: Omit<TerritoryChangeContext, "expectedRevision">): TerritoryState {
  const old = state.claims.filter(x => t.supersedeClaimIds.includes(x.id)), claims = [...state.claims.map(x => t.supersedeClaimIds.includes(x.id)
    ? { ...x, lifecycle: "superseded" as const } : x), t.newClaim];
  const event: TerritoryStateEvent = { ...c, id: c.eventId, kind: "domain-manager:ownership-transfer", targetIds: [...t.supersedeClaimIds, t.newClaim.id],
    before: old, after: claims.filter(x => t.supersedeClaimIds.includes(x.id) || x.id === t.newClaim.id) };
  return { ...state, territory: { ...state.territory, revision: state.territory.revision + 1, updatedAt: c.at }, claims, events: [...state.events, event] };
}
/** All children are validated before returning any change. Persistence uses one coordinated transaction. */
export function commitTerritoryTransfer(states: readonly TerritoryState[], plan: TerritoryTransferPlan): Result<readonly TerritoryState[]> {
  const fresh = previewTerritoryTransfer(states, plan.targets, plan.context); if (!fresh.ok) return fresh;
  const targets = new Map(plan.targets.map(t => [t.territoryUuid, t]));
  return ok(immutable(states.map(s => { const t = targets.get(s.territory.uuid); return t ? transferredState(s, t, plan.context) : structuredClone(s); })));
}
