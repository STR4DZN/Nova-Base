import { ok } from "../core/contracts/result.js";
import { failure, isRecord } from "../core/validation/value-validation.js";
import { historyWindow, type DiplomacyOwner } from "../diplomacy/owner-contract.js";
import { changeTerritoryState, validateTerritoryState, projectTerritoryState, resolveTerritoryInfluence, type TerritoryState, type TerritoryAction } from "./territory-state.js";
import { validateTerritoryDispute, changeTerritoryDispute, type TerritoryDispute, type DisputeLifecycle } from "./territory-disputes.js";
import type { TypedRef } from "../core/identity/refs.js";
export const territoryOwner: DiplomacyOwner = {
  validate: validateTerritoryState,
  identity(data) { const t = (data as TerritoryState).territory; return { ...t, id: t.uuid }; },
  parties(data) { const s = data as TerritoryState; return [...s.claims.map(c => c.claimantRef), ...s.recognitions.map(r => r.recognizingRef),
    ...s.presence.map(p => p.partyRef), ...s.influence.map(i => i.partyRef), ...s.rights.map(r => r.beneficiaryRef), ...s.occupations.map(o => o.occupierRef)]; },
  change(data, action, c) { return changeTerritoryState(data as TerritoryState, c, action as TerritoryAction); },
  project(data, c) {
    const s = data as TerritoryState, projected = projectTerritoryState(s, c.canSee);
    if (!projected) return failure("DM_DIPLOMACY_NOT_FOUND", "Entity unavailable", "not-found");
    return ok({ id: s.territory.uuid, label: s.territory.label, revision: s.territory.revision,
      ...projected, events: historyWindow(projected.events, c), territory: { ...projected.territory, hierarchyHistory: historyWindow(projected.territory.hierarchyHistory, c) },
      effectiveInfluence: resolveTerritoryInfluence(projected, c.worldTick, c.canSee) });
  }
};
export const disputeOwner: DiplomacyOwner = {
  validate: validateTerritoryDispute,
  identity(data) { return data as TerritoryDispute; },
  parties(data) { return (data as TerritoryDispute).parties; },
  change(data, action, c, territories) {
    if (!isRecord(action) || action.kind !== "decide") return failure("DM_TERRITORY_DISPUTE_CHANGE_INVALID", "Unsupported dispute decision");
    return changeTerritoryDispute(data as TerritoryDispute, territories, c, action.lifecycle as DisputeLifecycle, (action.outcomeRef ?? null) as TypedRef | null);
  },
  project(data, c) { const d = data as TerritoryDispute; if (!c.canSee(d.visibility)) return failure("DM_DIPLOMACY_NOT_FOUND", "Entity unavailable", "not-found");
    return ok({ ...d, events: c.isGm ? historyWindow(d.events, c) : [] }); }
};
