import { ok, type Result } from "../core/contracts/result.js";
import { failure, isRecord } from "../core/validation/value-validation.js";
import type { DiplomacyOwner } from "../diplomacy/owner-contract.js";
import { historyWindow } from "../diplomacy/owner-contract.js";
import { validateRelationDefinition } from "./types/relation-validation.js";
import type { RelationDefinition, RelationBaseAxis } from "./types/relation-types.js";
import { validateRelationState, applyRelationIncident, addRelationModifier, endRelationModifier, endRelation, resolveRelationAxis,
  type RelationState, type RelationModifier } from "./relation-history.js";
export interface RelationOwnerData { readonly definition: RelationDefinition; readonly state: RelationState; }
export const relationOwner: DiplomacyOwner = {
  validate(raw): Result<RelationOwnerData> {
    if (!isRecord(raw)) return failure("DM_RELATION_STATE_INVALID", "Relation envelope unavailable");
    const d = validateRelationDefinition(raw.definition); if (!d.ok) return d;
    const s = validateRelationState(raw.state, d.value); return s.ok ? ok({ definition: d.value, state: s.value }) : s;
  },
  identity(data) { return (data as RelationOwnerData).state.relation; },
  parties(data) { return (data as RelationOwnerData).state.relation.parties.map(p => p.ref); },
  change(data, action, c) {
    const { state: s, definition: d } = data as RelationOwnerData;
    if (!isRecord(action)) return failure("DM_RELATION_CHANGE_INVALID", "Relation action must be structured");
    const context = { ...c, eventId: c.eventId.startsWith("cmd_") ? `reve_${c.eventId.slice(4)}` : c.eventId,
      summary: c.reason, visibility: action.kind === "modifier" ? (action.value as RelationModifier)?.visibility
      : action.kind === "end-modifier" ? s.modifiers.find(m => m.id === action.id)?.visibility ?? s.relation.visibility : s.relation.visibility };
    let changed: Result<RelationState>;
    if (action.kind === "incident") changed = applyRelationIncident(s, d, context, action.deltas as readonly RelationBaseAxis[], (action.reversalOf ?? null) as string | null);
    else if (action.kind === "modifier") changed = addRelationModifier(s, d, context, { ...(action.value as RelationModifier), createdAt: c.at });
    else if (action.kind === "end-modifier") changed = endRelationModifier(s, d, context, action.id as string);
    else if (action.kind === "end") changed = endRelation(s, d, context);
    else return failure("DM_RELATION_CHANGE_INVALID", "Unsupported relation action");
    return changed.ok ? ok({ definition: d, state: changed.value }) : changed;
  },
  project(data, c) {
    const { state: s, definition: d } = data as RelationOwnerData, r = s.relation;
    if (!c.canSee(r.visibility)) return failure("DM_DIPLOMACY_NOT_FOUND", "Entity unavailable", "not-found");
    const selectors = d.symmetry === "symmetric" ? d.axes.map(a => ({ axisId: a.id, fromPartyId: null, toPartyId: null }))
      : d.axes.flatMap(a => r.parties.flatMap(from => r.parties.filter(to => to.id !== from.id).map(to => ({ axisId: a.id, fromPartyId: from.id, toPartyId: to.id }))));
    const scores: unknown[] = [];
    for (const selector of selectors) { const score = resolveRelationAxis(s, d, selector, c.at, c.worldTick, c.canSee); if (!score.ok) return score; scores.push({ ...selector, ...score.value }); }
    return ok({ id: r.id, revision: r.revision, label: r.label, lifecycle: r.lifecycle, parties: r.parties, scope: r.scope, scores,
      history: historyWindow(s.events.filter(e => c.canSee(e.visibility)), c),
      ...(c.isGm ? { definition: d, modifiers: s.modifiers } : {}) });
  }
};
