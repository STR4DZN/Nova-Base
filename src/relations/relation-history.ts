import { ok, type Result } from "../core/contracts/result.js";
import { isFoundryUuid, type TypedRef } from "../core/identity/refs.js";
import { isOpaqueId } from "../core/identity/ids.js";
import { boundedInteger, isJsonData, failure, immutable, isNamespaced, isRecord, isSafeInteger, isText,
  isTimestamp, isVisibility, revisionGuard } from "../core/validation/value-validation.js";
import type { RelationBaseAxis, RelationDefinition, RelationInstance, RelationVisibility } from "./types/relation-types.js";
import { validateRelationInstance } from "./types/relation-validation.js";

export interface RelationModifier extends RelationBaseAxis {
  readonly id: string;
  readonly source: TypedRef;
  readonly visibility: RelationVisibility;
  readonly lifecycle: "active" | "ended";
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly expiresAtWorldTick: number | null;
  readonly stackKey: string;
  readonly stacking: "add" | "replace" | "strongest";
}
export interface RelationEvent {
  readonly id: string;
  readonly kind: "incident" | "reversal" | "modifier-added" | "modifier-ended" | "ended";
  readonly partyIds: readonly string[];
  readonly sourceRefs: readonly TypedRef[];
  readonly at: number;
  readonly worldTick: number | null;
  readonly summary: string;
  readonly visibility: RelationVisibility;
  readonly effects: readonly RelationBaseAxis[];
  readonly reversalOf: string | null;
  readonly modifierId: string | null;
}
export interface RelationState {
  readonly relation: RelationInstance;
  readonly modifiers: readonly RelationModifier[];
  readonly events: readonly RelationEvent[];
}
export interface RelationChangeContext {
  readonly expectedRevision: number;
  readonly eventId: string;
  readonly at: number;
  readonly worldTick: number | null;
  readonly summary: string;
  readonly visibility: RelationVisibility;
  readonly sourceRefs: readonly TypedRef[];
}
const refValid = (ref: unknown): ref is TypedRef => isRecord(ref) && isText(ref.type)
  && ((isText(ref.id) && ref.uuid === undefined) || (isFoundryUuid(ref.uuid) && ref.id === undefined));
const directionKey = (score: RelationBaseAxis) => JSON.stringify([score.axisId, score.fromPartyId, score.toPartyId]);
function scoreValid(score: unknown, r: RelationInstance, d: RelationDefinition, delta: boolean): score is RelationBaseAxis {
  if (!isRecord(score) || !isSafeInteger(score.value) || !d.axes.some(a => a.id === score.axisId)) return false;
  const axis = d.axes.find(a => a.id === score.axisId)!;
  if (!delta && (score.value < axis.minimum || score.value > axis.maximum)) return false;
  if (d.symmetry === "symmetric") return score.fromPartyId === null && score.toPartyId === null;
  return isText(score.fromPartyId) && isText(score.toPartyId) && score.fromPartyId !== score.toPartyId
    && r.parties.some(p => p.id === score.fromPartyId) && r.parties.some(p => p.id === score.toPartyId);
}
export function validateRelationState(raw: unknown, d: RelationDefinition): Result<RelationState> {
  if (!isRecord(raw) || !isJsonData(raw)) return failure("DM_RELATION_STATE_INVALID", "Relation state must be a JSON-safe object");
  const relation = validateRelationInstance(raw.relation, d); if (!relation.ok) return relation;
  if (!Array.isArray(raw.modifiers) || !Array.isArray(raw.events)) return failure("DM_RELATION_STATE_INVALID", "Modifiers and events must be lists");
  const modifierIds = new Set<string>(), eventIds = new Set<string>(), reversals = new Set<string>();
  for (const m of raw.modifiers) {
    if (!isRecord(m) || !isText(m.id) || modifierIds.has(m.id) || !scoreValid(m, relation.value, d, true)
      || !refValid(m.source) || !isVisibility(m.visibility) || (m.lifecycle !== "active" && m.lifecycle !== "ended")
      || !isTimestamp(m.createdAt) || (m.expiresAt !== null && (!isTimestamp(m.expiresAt) || m.expiresAt <= m.createdAt))
      || (m.expiresAtWorldTick !== null && !isTimestamp(m.expiresAtWorldTick)) || !isText(m.stackKey)
      || (m.stacking !== "add" && m.stacking !== "replace" && m.stacking !== "strongest"))
      return failure("DM_RELATION_MODIFIER_INVALID", "Invalid modifier, source, expiry or duplicate ID");
    modifierIds.add(m.id);
  }
  let lastTime = relation.value.createdAt;
  for (const e of raw.events) {
    if (!isRecord(e) || !isOpaqueId(e.id, "reve") || eventIds.has(e.id) || !isTimestamp(e.at) || e.at < lastTime
      || typeof e.kind !== "string" || !["incident", "reversal", "modifier-added", "modifier-ended", "ended"].includes(e.kind)
      || !isText(e.summary) || !isVisibility(e.visibility) || (e.worldTick !== null && !isTimestamp(e.worldTick))
      || !Array.isArray(e.partyIds) || !e.partyIds.every(id => relation.value.parties.some(p => p.id === id))
      || !Array.isArray(e.sourceRefs) || !e.sourceRefs.every(refValid) || !Array.isArray(e.effects)
      || !e.effects.every(s => scoreValid(s, relation.value, d, true)) || new Set(e.effects.map(directionKey)).size !== e.effects.length
      || (e.reversalOf !== null && (!isText(e.reversalOf) || !eventIds.has(e.reversalOf) || reversals.has(e.reversalOf)))
      || (e.kind === "reversal" ? e.reversalOf === null : e.reversalOf !== null)
      || (e.modifierId !== null && (!isText(e.modifierId) || !modifierIds.has(e.modifierId))))
      return failure("DM_RELATION_EVENT_INVALID", "Invalid event history, order or reversal reference");
    if (e.reversalOf) {
      const original = raw.events.find(prior => prior.id === e.reversalOf);
      if (original?.kind !== "incident" || original.visibility !== e.visibility
        || JSON.stringify(e.effects) !== JSON.stringify(original.effects.map((score: RelationBaseAxis) => ({ ...score, value: -score.value }))))
        return failure("DM_RELATION_EVENT_INVALID", "Reversal does not match the original applied effects");
      reversals.add(e.reversalOf);
    }
    eventIds.add(e.id); lastTime = e.at;
  }
  if (lastTime > relation.value.updatedAt) return failure("DM_RELATION_EVENT_INVALID", "History timestamp exceeds entity timestamp");
  return ok(immutable(structuredClone({ relation: relation.value, modifiers: raw.modifiers, events: raw.events })) as RelationState);
}

function changeGuard(s: RelationState, d: RelationDefinition, c: RelationChangeContext): Result<never> | null {
  const valid = validateRelationState(s, d); if (!valid.ok) return valid;
  const stale = revisionGuard(s.relation.revision, c.expectedRevision); if (stale) return stale;
  if (s.relation.lifecycle !== "active") return failure("DM_RELATION_ENDED", "Ended relation is read-only");
  if (!isOpaqueId(c.eventId, "reve") || s.events.some(e => e.id === c.eventId) || !isTimestamp(c.at) || c.at < s.relation.updatedAt
    || (c.worldTick !== null && !isTimestamp(c.worldTick)) || !isText(c.summary) || !isVisibility(c.visibility)
    || !Array.isArray(c.sourceRefs) || !c.sourceRefs.every(refValid)) return failure("DM_RELATION_CHANGE_INVALID", "Invalid change context or duplicate event");
  return null;
}
function event(s: RelationState, c: RelationChangeContext, kind: RelationEvent["kind"], effects: readonly RelationBaseAxis[] = [],
  reversalOf: string | null = null, modifierId: string | null = null): RelationEvent {
  return { id: c.eventId, kind, partyIds: s.relation.parties.map(p => p.id), sourceRefs: c.sourceRefs, at: c.at,
    worldTick: c.worldTick, summary: c.summary, visibility: c.visibility, effects, reversalOf, modifierId };
}
export function applyRelationIncident(s: RelationState, d: RelationDefinition, c: RelationChangeContext,
  deltas: readonly RelationBaseAxis[], reversalOf: string | null = null): Result<RelationState> {
  const guard = changeGuard(s, d, c); if (guard) return guard;
  if (c.visibility !== s.relation.visibility) return failure("DM_RELATION_VISIBILITY_CONFLICT", "A base-score change must retain the relation visibility; use a restricted modifier for hidden effects");
  if (!Array.isArray(deltas) || !deltas.length || !deltas.every(delta => scoreValid(delta, s.relation, d, true))
    || new Set(deltas.map(directionKey)).size !== deltas.length) return failure("DM_RELATION_INCIDENT_INVALID", "Incident requires unique valid axis deltas");
  if (reversalOf !== null) {
    const original = s.events.find(e => e.id === reversalOf);
    if (!original || original.kind !== "incident" || s.events.some(e => e.reversalOf === reversalOf)
      || c.visibility !== original.visibility || JSON.stringify(deltas) !== JSON.stringify(original.effects.map(x => ({ ...x, value: -x.value }))))
      return failure("DM_RELATION_REVERSAL_INVALID", "Reversal must compensate the original applied deltas exactly once with the same visibility");
  }
  const baseAxes = [...s.relation.baseAxes], effects: RelationBaseAxis[] = [];
  for (const delta of deltas) {
    const axis = d.axes.find(a => a.id === delta.axisId)!;
    const index = baseAxes.findIndex(a => directionKey(a) === directionKey(delta));
    const before = index < 0 ? axis.defaultValue : baseAxes[index].value;
    const sum = BigInt(before) + BigInt(delta.value), after = boundedInteger(sum, axis.minimum, axis.maximum);
    if (reversalOf !== null && BigInt(after) !== sum) return failure("DM_RELATION_REVERSAL_OUT_OF_RANGE", "Reversal requires review; later changes prevent exact compensation");
    const applied = Number(BigInt(after) - BigInt(before));
    if (!isSafeInteger(applied)) return failure("DM_RELATION_AXIS_OVERFLOW", "Applied delta exceeds safe integer range");
    const score = { ...delta, value: after }; if (index < 0) baseAxes.push(score); else baseAxes[index] = score;
    effects.push({ ...delta, value: applied });
  }
  return validateRelationState({ ...s, relation: { ...s.relation, baseAxes, revision: s.relation.revision + 1, updatedAt: c.at },
    events: [...s.events, event(s, c, reversalOf ? "reversal" : "incident", effects, reversalOf)] }, d);
}
export function addRelationModifier(s: RelationState, d: RelationDefinition, c: RelationChangeContext, modifier: RelationModifier): Result<RelationState> {
  const guard = changeGuard(s, d, c); if (guard) return guard;
  if (modifier.createdAt !== c.at || modifier.lifecycle !== "active" || modifier.visibility !== c.visibility)
    return failure("DM_RELATION_MODIFIER_INVALID", "Modifier creation time/visibility must match the event");
  return validateRelationState({ relation: { ...s.relation, revision: s.relation.revision + 1, updatedAt: c.at },
    modifiers: [...s.modifiers, modifier], events: [...s.events, event(s, c, "modifier-added", [], null, modifier.id)] }, d);
}
export function endRelationModifier(s: RelationState, d: RelationDefinition, c: RelationChangeContext, id: string): Result<RelationState> {
  const guard = changeGuard(s, d, c); if (guard) return guard;
  const modifier = s.modifiers.find(m => m.id === id); if (!modifier) return failure("DM_RELATION_MODIFIER_NOT_FOUND", "Modifier missing", "not-found");
  if (modifier.visibility !== c.visibility) return failure("DM_RELATION_MODIFIER_INVALID", "Modifier event must retain source visibility");
  if (modifier.lifecycle === "ended") return ok(s);
  return validateRelationState({ relation: { ...s.relation, revision: s.relation.revision + 1, updatedAt: c.at },
    modifiers: s.modifiers.map(m => m.id === id ? { ...m, lifecycle: "ended" } : m),
    events: [...s.events, event(s, c, "modifier-ended", [], null, id)] }, d);
}
export function endRelation(s: RelationState, d: RelationDefinition, c: RelationChangeContext): Result<RelationState> {
  const valid = validateRelationState(s, d); if (!valid.ok) return valid;
  const stale = revisionGuard(s.relation.revision, c.expectedRevision); if (stale) return stale;
  if (s.relation.lifecycle === "ended") return ok(s);
  const guard = changeGuard(s, d, c); if (guard) return guard;
  return validateRelationState({ ...s, relation: { ...s.relation, lifecycle: "ended", endedAt: c.at, updatedAt: c.at,
    revision: s.relation.revision + 1 }, events: [...s.events, event(s, c, "ended")] }, d);
}

/** Resolve without writes; filter sources before deriving the public score. */
export function resolveRelationAxis(s: RelationState, d: RelationDefinition, selector: Omit<RelationBaseAxis, "value">,
  at: number, worldTick: number | null, canSee: (visibility: RelationVisibility) => boolean): Result<{ base: number; effective: number; modifierIds: readonly string[] }> {
  const valid = validateRelationState(s, d); if (!valid.ok) return valid;
  if (!isTimestamp(at) || (worldTick !== null && !isTimestamp(worldTick))) return failure("DM_RELATION_TIME_INVALID", "Invalid resolver time");
  if (!canSee(s.relation.visibility)) return failure("DM_RELATION_NOT_FOUND", "Relation not available", "not-found");
  if (!scoreValid({ ...selector, value: 0 }, s.relation, d, true)) return failure("DM_RELATION_AXIS_DIRECTION_INVALID", "Unknown score direction");
  const axis = d.axes.find(a => a.id === selector.axisId)!;
  const base = s.relation.baseAxes.find(a => directionKey(a) === directionKey({ ...selector, value: 0 }))?.value ?? axis.defaultValue;
  const groups = new Map<string, RelationModifier[]>();
  for (const m of s.modifiers) {
    if (s.relation.lifecycle !== "active" || m.lifecycle !== "active" || m.createdAt > at || (m.expiresAt !== null && m.expiresAt <= at)
      || (m.expiresAtWorldTick !== null && (worldTick === null || m.expiresAtWorldTick <= worldTick))
      || !canSee(m.visibility) || directionKey(m) !== directionKey({ ...selector, value: 0 })) continue;
    const key = JSON.stringify([m.stackKey, m.stacking]); groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const active: RelationModifier[] = [];
  for (const list of groups.values()) {
    if (list[0].stacking === "add") active.push(...list);
    else if (list[0].stacking === "replace") active.push(list.reduce((a, b) => a.createdAt > b.createdAt || a.createdAt === b.createdAt && a.id > b.id ? a : b));
    else active.push(list.reduce((a, b) => Math.abs(a.value) > Math.abs(b.value) || Math.abs(a.value) === Math.abs(b.value) && a.id > b.id ? a : b));
  }
  return ok({ base, effective: boundedInteger(active.reduce((sum, m) => sum + BigInt(m.value), BigInt(base)), axis.minimum, axis.maximum),
    modifierIds: Object.freeze(active.map(m => m.id)) });
}
