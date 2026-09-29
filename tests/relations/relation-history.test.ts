import test from "node:test";
import assert from "node:assert/strict";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import type { Result } from "../../src/core/contracts/result.js";
import type { RelationDefinition, RelationBaseAxis } from "../../src/relations/types/relation-types.js";
import { addRelationModifier, applyRelationIncident, endRelation, endRelationModifier, resolveRelationAxis,
  validateRelationState, type RelationState, type RelationChangeContext, type RelationModifier } from "../../src/relations/relation-history.js";

const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const d: RelationDefinition = { id: "test:relation", version: 1, label: "Relation", symmetry: "symmetric", minParties: 2,
  maxParties: null, allowedPartyTypes: ["narrative"], allowedPartyRoles: ["partner"], allowMultiple: false,
  stancePolicy: "derived", axes: [{ id: "test:trust", label: "Trust", minimum: -100, maximum: 100, defaultValue: 0 }] };
const selector = { axisId: "test:trust", fromPartyId: null, toPartyId: null };
const delta = (value: number): RelationBaseAxis => ({ ...selector, value });
function state(): RelationState {
  return { relation: { schemaVersion: 1, id: createOpaqueId("rel"), definitionId: d.id, definitionVersion: 1,
    revision: 0, label: "A/B", lifecycle: "active", scope: null, baseAxes: [delta(20)], visibility: "public",
    createdAt: 0, updatedAt: 0, endedAt: null,
    parties: ["a", "b"].map(id => ({ id, role: "partner", ref: { type: "narrative", id } })) }, modifiers: [], events: [] };
}
const context = (s: RelationState, patch: Partial<RelationChangeContext> = {}): RelationChangeContext => ({
  expectedRevision: s.relation.revision, eventId: createOpaqueId("reve"), at: s.relation.updatedAt + 1,
  worldTick: 0, summary: "GM incident", visibility: "public", sourceRefs: [{ type: "manual", id: "gm" }], ...patch });
const modifier = (c: RelationChangeContext, patch: Partial<RelationModifier> = {}): RelationModifier => ({
  ...delta(10), id: crypto.randomUUID(), source: { type: "incident", id: "source" }, visibility: c.visibility,
  lifecycle: "active", createdAt: c.at, expiresAt: null, expiresAtWorldTick: null, stackKey: "test:stack", stacking: "add", ...patch });

test("G6.2: incident clamps base and records the actual applied delta; inputs remain unchanged", () => {
  const s = state(), before = structuredClone(s), c = context(s);
  const next = unwrap(applyRelationIncident(s, d, c, [delta(200)]));
  assert.equal(next.relation.baseAxes[0].value, 100); assert.equal(next.events[0].effects[0].value, 80);
  assert.equal(next.relation.revision, 1); assert.deepEqual(s, before);
  const reversed = unwrap(applyRelationIncident(next, d, context(next), [delta(-80)], c.eventId));
  assert.equal(reversed.relation.baseAxes[0].value, 20); assert.equal(reversed.events.length, 2);
  assert.deepEqual(reversed.events[0], next.events[0]);
  assert.equal(applyRelationIncident(reversed, d, context(reversed), [delta(-80)], c.eventId).ok, false);
});
test("G6.2: reversal must be exact, cannot reverse a reversal or silently clamp after later change", () => {
  const s = state(), c = context(s), changed = unwrap(applyRelationIncident(s, d, c, [delta(80)]));
  assert.equal(applyRelationIncident(changed, d, context(changed), [delta(-79)], c.eventId).ok, false);
  const later = unwrap(applyRelationIncident(changed, d, context(changed), [delta(-190)]));
  assert.equal(applyRelationIncident(later, d, context(later), [delta(-80)], c.eventId).ok, false);
  const rc = context(changed), reversed = unwrap(applyRelationIncident(changed, d, rc, [delta(-80)], c.eventId));
  assert.equal(applyRelationIncident(reversed, d, context(reversed), [delta(80)], rc.eventId).ok, false);
});
test("G6.2: secret modifiers are filtered before public score calculation", () => {
  let s = state(); const c = context(s, { visibility: "secret" });
  s = unwrap(addRelationModifier(s, d, c, modifier(c, { value: 60 })));
  assert.equal(s.relation.baseAxes[0].value, 20);
  const player = unwrap(resolveRelationAxis(s, d, selector, 5, 0, v => v === "public"));
  assert.equal(player.effective, 20); assert.deepEqual(player.modifierIds, []);
  const gm = unwrap(resolveRelationAxis(s, d, selector, 5, 0, () => true)); assert.equal(gm.effective, 80);
  assert.equal(endRelationModifier(s, d, context(s), s.modifiers[0].id).ok, false);
});
test("G6.2: real-time and world-tick expiry remove effects without deleting history", () => {
  let s = state(); const c = context(s);
  s = unwrap(addRelationModifier(s, d, c, modifier(c, { expiresAt: 10, expiresAtWorldTick: 5 })));
  assert.equal(unwrap(resolveRelationAxis(s, d, selector, 2, 4, () => true)).effective, 30);
  assert.equal(unwrap(resolveRelationAxis(s, d, selector, 10, 4, () => true)).effective, 20);
  assert.equal(unwrap(resolveRelationAxis(s, d, selector, 2, 5, () => true)).effective, 20);
  assert.equal(unwrap(resolveRelationAxis(s, d, selector, 2, null, () => true)).effective, 20);
  assert.equal(s.events.length, 1); assert.equal(s.modifiers.length, 1); assert.equal(s.modifiers[0].lifecycle, "active");
});
for (const stacking of ["add", "replace", "strongest"] as const) test(`G6.2: explicit ${stacking} stacking is deterministic`, () => {
  let s = state();
  for (const value of [30, -10]) { const c = context(s); s = unwrap(addRelationModifier(s, d, c, modifier(c, { value, stacking }))); }
  assert.equal(unwrap(resolveRelationAxis(s, d, selector, 9, 0, () => true)).effective, { add: 40, replace: 10, strongest: 50 }[stacking]);
});
test("G6.2: ended modifiers and ended relations retain their full history and base", () => {
  let s = state(); const c = context(s), m = modifier(c); s = unwrap(addRelationModifier(s, d, c, m));
  s = unwrap(endRelationModifier(s, d, context(s), m.id));
  const noop = unwrap(endRelationModifier(s, d, context(s), m.id)); assert.strictEqual(noop, s);
  assert.equal(unwrap(resolveRelationAxis(s, d, selector, 8, 0, () => true)).effective, 20);
  s = unwrap(endRelation(s, d, context(s))); assert.equal(s.events.length, 3);
  assert.equal(s.relation.lifecycle, "ended"); assert.equal(s.modifiers.length, 1);
  assert.equal(applyRelationIncident(s, d, context(s), [delta(1)]).ok, false);
  assert.strictEqual(unwrap(endRelation(s, d, context(s))), s);
});
test("G6.2: stale revision, duplicate event, bad refs/direction/timestamps and JSON corruption fail closed", () => {
  const s = state();
  assert.equal(applyRelationIncident(s, d, context(s, { visibility: "secret" }), [delta(1)]).ok, false);
  assert.equal(applyRelationIncident(s, d, context(s, { expectedRevision: 9 }), [delta(1)]).ok, false);
  assert.equal(applyRelationIncident(s, d, context(s, { at: -1 }), [delta(1)]).ok, false);
  assert.equal(applyRelationIncident(s, d, context(s), [{ ...delta(1), toPartyId: "b" }]).ok, false);
  const c = context(s), next = unwrap(applyRelationIncident(s, d, c, [delta(1)]));
  assert.equal(applyRelationIncident(next, d, context(next, { eventId: c.eventId }), [delta(1)]).ok, false);
  assert.equal(validateRelationState({ ...s, garbage: () => {} }, d).ok, false);
  assert.equal(validateRelationState({ ...next, events: [...next.events, next.events[0]] }, d).ok, false);
});
test("G6.2: large modifier sums use exact arithmetic and clamp without overflow", () => {
  let s = state();
  for (let i = 0; i < 100; i++) { const c = context(s); s = unwrap(addRelationModifier(s, d, c, modifier(c, { value: Number.MAX_SAFE_INTEGER }))); }
  assert.equal(unwrap(resolveRelationAxis(s, d, selector, 200, 0, () => true)).effective, 100);
  assert.deepEqual(unwrap(validateRelationState(JSON.parse(JSON.stringify(s)), d)), s);
});
