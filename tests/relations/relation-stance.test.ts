import test from "node:test";
import assert from "node:assert/strict";
import type { Result } from "../../src/core/contracts/result.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import type { RelationDefinition, RelationStanceRule } from "../../src/relations/types/relation-types.js";
import { validateRelationDefinition } from "../../src/relations/types/relation-validation.js";
import { addRelationModifier, applyRelationIncident, endRelation, setRelationStance, validateRelationState,
  type RelationState, type RelationChangeContext } from "../../src/relations/relation-history.js";
import { resolveRelationStances } from "../../src/relations/relation-stance.js";
import { relationOwner } from "../../src/relations/relation-owner.js";
import { createDiplomacyDraft } from "../../src/diplomacy/diplomacy-drafts.js";
import { DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const rule = (id: string, minimum: number, maximum: number, visibility: "public" | "secret" = "public"): RelationStanceRule =>
  ({ id: `test:${id}`, label: id, visibility, conditions: [{ axisId: "test:trust", minimum, maximum }] });
const definition = (patch: Partial<RelationDefinition> = {}): RelationDefinition => ({
  id: "test:relation", version: 1, label: "Relation", symmetry: "symmetric", minParties: 2, maxParties: null,
  allowedPartyTypes: ["narrative"], allowedPartyRoles: ["partner"], allowMultiple: true, stancePolicy: "derived",
  axes: [{ id: "test:trust", label: "Trust", minimum: -100, maximum: 100, defaultValue: 0 }],
  stanceRules: [rule("hostile", -100, -1), rule("neutral", 0, 0), rule("friendly", 1, 100)], ...patch });
const state = (d = definition()): RelationState => ({
  relation: { schemaVersion: 1, id: createOpaqueId("rel"), definitionId: d.id, definitionVersion: d.version,
    revision: 0, label: "A/B", lifecycle: "active", scope: null, baseAxes: [], visibility: "public",
    createdAt: 0, updatedAt: 0, endedAt: null,
    parties: ["a", "b"].map(id => ({ id, role: "partner", ref: { type: "narrative", id } })) },
  modifiers: [], events: [] });
const context = (s: RelationState): RelationChangeContext => ({ expectedRevision: s.relation.revision,
  eventId: createOpaqueId("reve"), at: s.relation.updatedAt + 1, worldTick: 10,
  summary: "GM change", visibility: "public", sourceRefs: [] });
const publicViewer = (v: string) => v === "public";
const view = (s: RelationState, d = definition(), at = 100, tick: number | null = 10, canSee = publicViewer) =>
  unwrap(resolveRelationStances(s, d, at, tick, canSee));

test("G6 stance: boundaries, defaults and reasons are derived without persisting stance or changing axes", () => {
  const d = definition(), s = state(d), before = structuredClone(s);
  assert.equal(view(s, d)[0].value, "neutral");
  for (const [value, label] of [[-100, "hostile"], [-1, "hostile"], [0, "neutral"], [1, "friendly"], [100, "friendly"]] as const) {
    const changed = { ...s, relation: { ...s.relation, baseAxes: [{ axisId: "test:trust", fromPartyId: null, toPartyId: null, value }] } };
    const stance = view(changed, d)[0]; assert.equal(stance.value, label); assert.equal(stance.reasons[0].effective, value);
    assert.equal(Object.hasOwn(changed.relation, "stance"), false);
  }
  assert.deepEqual(s, before); assert.ok(Object.isFrozen(view(s, d)[0].reasons));
});
test("G6 stance: all declared conditions match and overlapping rules use declared order", () => {
  const d = definition({ axes: [...definition().axes, { id: "test:fear", label: "Fear", minimum: -100, maximum: 100, defaultValue: 0 }],
    stanceRules: [{ ...rule("fearful", -100, 100), conditions: [...rule("fearful", -100, 100).conditions, { axisId: "test:fear", minimum: 10, maximum: 100 }] },
      rule("first", -100, 100), rule("second", -100, 100)] });
  const s = state(d); assert.equal(view(s, d)[0].value, "first");
  const changed = { ...s, relation: { ...s.relation, baseAxes: [{ axisId: "test:fear", fromPartyId: null, toPartyId: null, value: 10 }] } };
  assert.equal(view(changed, d)[0].value, "fearful");
});
test("G6 stance: secret rules do not affect value, reasons or configuration status for a Player", () => {
  const d = definition({ stanceRules: [rule("secret-marker", -100, 100, "secret")] }), s = state(d);
  assert.deepEqual(view(s, d), view(s, { ...d, stanceRules: [] }));
  assert.equal(JSON.stringify(view(s, d)).includes("secret-marker"), false);
  assert.equal(view(s, d, 100, 10, () => true)[0].value, "secret-marker");
});
test("G6 stance: hidden modifiers are filtered before classification; expiry and ended lifecycle remove temporary effects", () => {
  const d = definition(), s = state(d), c = context(s);
  const m = { id: "private-modifier", axisId: "test:trust", value: 30, fromPartyId: null, toPartyId: null,
    source: { type: "incident", id: "private-source" }, visibility: "secret" as const, lifecycle: "active" as const,
    createdAt: c.at, expiresAt: null, expiresAtWorldTick: 20, stackKey: "test:stack", stacking: "add" as const };
  const changed = unwrap(addRelationModifier(s, d, { ...c, visibility: "secret" }, m));
  assert.equal(view(changed, d)[0].value, "neutral");
  assert.equal(JSON.stringify(view(changed, d)).includes("private-"), false);
  assert.equal(view(changed, d, 100, 10, () => true)[0].value, "friendly");
  assert.equal(view(changed, d, 100, 20, () => true)[0].value, "neutral");
  assert.equal(view(changed, d, 100, null, () => true)[0].value, "neutral");
  const ended = unwrap(endRelation(changed, d, context(changed)));
  assert.equal(view(ended, d, 100, 10, () => true)[0].value, "neutral");
  assert.equal(ended.events.length, 2);
});
test("G6 stance: directed relations classify each party direction independently", () => {
  const d = definition({ symmetry: "asymmetric" }), s = state(d);
  const changed = { ...s, relation: { ...s.relation, baseAxes: [
    { axisId: "test:trust", fromPartyId: "a", toPartyId: "b", value: 20 },
    { axisId: "test:trust", fromPartyId: "b", toPartyId: "a", value: -20 }] } };
  assert.deepEqual(view(changed, d).map(x => [x.fromPartyId, x.toPartyId, x.value]), [["a", "b", "friendly"], ["b", "a", "hostile"]]);
});
test("G6 stance: legacy derived definitions remain readable and report unconfigured rather than inventing labels", () => {
  const { stanceRules: ignored, ...d } = definition(), s = state(d);
  assert.equal(view(s, d)[0].status, "unconfigured"); assert.equal(view(s, d)[0].value, null);
  assert.equal(view(s, { ...d, stanceRules: [rule("only-high", 50, 100)] })[0].status, "unmatched");
  assert.equal(validateRelationState({ ...s, relation: { ...s.relation, stance: "persisted-derived" } }, d).ok, false);
});
test("G6 stance: malformed rules, unknown/duplicate axes, unsafe ranges and non-derived configurations are rejected", () => {
  const d = definition(), r = rule("valid", 0, 100);
  const invalid = [
    { ...d, stanceRules: [r, r] }, { ...d, stancePolicy: "manual" }, { ...d, stanceRules: [{ ...r, conditions: [] }] },
    { ...d, stanceRules: [{ ...r, visibility: "hidden" }] }, { ...d, stanceRules: [{ ...r, id: "bad" }] },
    { ...d, stanceRules: [{ ...r, conditions: [{ axisId: "test:missing", minimum: 0, maximum: 1 }] }] },
    { ...d, stanceRules: [{ ...r, conditions: [...r.conditions, ...r.conditions] }] },
    { ...d, stanceRules: [rule("low", -101, 0)] }, { ...d, stanceRules: [rule("reverse", 10, 0)] },
    { ...d, stanceRules: [rule("unsafe", 0, Number.MAX_SAFE_INTEGER + 1)] }
  ];
  for (const value of invalid) assert.equal(validateRelationDefinition(value).ok, false, JSON.stringify(value));
  const validated = unwrap(validateRelationDefinition(d)); assert.ok(Object.isFrozen(validated.stanceRules?.[0].conditions));
});
test("G6 stance: manual edit, clear, no-op and round-trip keep an append-only before/after audit", () => {
  const d = definition({ stancePolicy: "manual", stanceRules: undefined }), s = state(d), before = structuredClone(s);
  const next = unwrap(setRelationStance(s, d, context(s), "Alliance"));
  assert.equal(next.relation.stance, "Alliance"); assert.equal(next.relation.revision, 1);
  assert.deepEqual(next.events[0].stanceChange, { before: null, after: "Alliance" });
  assert.equal(view(next, d)[0].value, "Alliance");
  assert.equal(unwrap(setRelationStance(next, d, context(next), "Alliance")), next);
  const cleared = unwrap(setRelationStance(next, d, context(next), null));
  assert.equal(Object.hasOwn(cleared.relation, "stance"), false); assert.equal(cleared.relation.revision, 2);
  assert.deepEqual(cleared.events[0], next.events[0]); assert.deepEqual(cleared.events[1].stanceChange, { before: "Alliance", after: null });
  assert.deepEqual(unwrap(validateRelationState(JSON.parse(JSON.stringify(cleared)), d)), cleared);
  assert.deepEqual(s, before);
});
test("G6 stance: manual action rejects stale revision, ended relation, invalid values and nonmanual policy", () => {
  const d = definition({ stancePolicy: "manual", stanceRules: undefined }), s = state(d);
  for (const value of ["", " padded ", 5, undefined]) assert.equal(setRelationStance(s, d, context(s), value).ok, false);
  assert.equal(setRelationStance(s, d, { ...context(s), expectedRevision: 1 }, "A").ok, false);
  assert.equal(setRelationStance(s, definition(), context(s), "A").ok, false);
  assert.equal(setRelationStance(unwrap(endRelation(s, d, context(s))), d, { ...context(s), expectedRevision: 1, at: 2 }, "A").ok, false);
});
test("G6 stance: forged audit chains and persisted value divergence are rejected", () => {
  const d = definition({ stancePolicy: "manual", stanceRules: undefined }), s = state(d);
  const first = unwrap(setRelationStance(s, d, context(s), "A")), second = unwrap(setRelationStance(first, d, context(first), "B"));
  assert.equal(validateRelationState({ ...second, relation: { ...second.relation, stance: "C" } }, d).ok, false);
  const forged = structuredClone(second) as any; forged.events[1].stanceChange.before = "C";
  assert.equal(validateRelationState(forged, d).ok, false);
});
test("G6 stance: resolver validates time, relation visibility and absence policy including zero-axis definitions", () => {
  const d = definition({ axes: [], stancePolicy: "none", stanceRules: undefined }), s = state(d);
  assert.deepEqual(view(s, d), []);
  for (const [at, tick] of [[-1, 0], [0, -1], [NaN, null], [0, 0.5]] as const)
    assert.equal(resolveRelationStances(s, d, at, tick, publicViewer).ok, false);
  assert.equal(resolveRelationStances({ ...s, relation: { ...s.relation, visibility: "secret" } }, d, 0, 0, publicViewer).ok, false);
});
test("G6 stance: owner DTO and UI display escaped manual posture without offering edits for derived policy", () => {
  const d = definition({ stancePolicy: "manual", stanceRules: undefined }), s = state(d);
  const changed = unwrap(setRelationStance(s, d, context(s), "<script>alert(1)</script>"));
  const detail = unwrap(relationOwner.project({ definition: d, state: changed }, { isGm: false, canSee: publicViewer,
    at: 100, worldTick: 10, historyOffset: 0, historyLimit: 30 })) as any;
  const c = new DiplomacyApplicationController({} as any); c.detail = detail; c.list = { isGm: false };
  const html = c.inspector(); assert.equal(html.includes("<script>"), false); assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('value="stance"')); assert.deepEqual(unwrap(c.buildAction({ kind: "stance", stance: "" })), { kind: "stance", value: null });
  c.detail = unwrap(relationOwner.project({ definition: definition(), state: state() }, { isGm: true, canSee: () => true,
    at: 100, worldTick: 10, historyOffset: 0, historyLimit: 30 }));
  assert.equal(c.actionForm().includes('value="stance"'), false); assert.equal(c.buildAction({ kind: "stance", stance: "A" }).ok, false);
});
test("G6 stance: new draft v2 has usable rules; definition snapshots from v1 are not rewritten", () => {
  const draft = createDiplomacyDraft("relation", "New", [{ type: "narrative", id: "a" }, { type: "narrative", id: "b" }], "public");
  const data = unwrap(relationOwner.validate(draft.data, [])) as any;
  assert.equal(data.definition.version, 2); assert.equal(data.state.relation.definitionVersion, 2);
  assert.equal(view(data.state, data.definition)[0].value, "Neutralidade");
  const old = definition(); assert.equal(old.version, 1);
});
test("G6 stance: resolving 1000 independent records produces immutable views without accumulating writes", () => {
  const d = definition(); for (let i = 0; i < 1000; i++) {
    const s = state(d); assert.equal(view(s, d)[0].value, "neutral"); assert.equal(s.relation.revision, 0); assert.equal(s.events.length, 0);
  }
});

test("G6 stance UI: new manual/none modes and optional derived JSON reach authority without exposing canonical stores", async () => {
  const created: any[] = [], api: any = { relations: { create: async (value: any) => { created.push(value); return { ok: true, value }; } } };
  const controller = new DiplomacyApplicationController(api); controller.list = { isGm: true };
  for (const mode of ["manual", "none", "derived"]) {
    unwrap(await controller.create({ label: "New relation", subject: "a", audience: "b", visibility: "public",
      reason: "Create", stancePolicy: mode, stance: "Alliance", stanceRules: mode === "derived" ? "[]" : "" }));
    const data = created.at(-1).data; assert.equal(data.definition.stancePolicy, mode);
    if (mode === "manual") { assert.equal(data.state.relation.stance, "Alliance"); assert.equal(data.definition.stanceRules, undefined); }
    if (mode === "none") { assert.equal(data.state.relation.stance, undefined); assert.equal(data.definition.stanceRules, undefined); }
    if (mode === "derived") assert.deepEqual(data.definition.stanceRules, []);
  }
  const count = created.length;
  assert.equal((await controller.create({ label: "Invalid", subject: "a", audience: "b", visibility: "public",
    reason: "Bad JSON", stancePolicy: "derived", stanceRules: "{" })).ok, false);
  assert.equal(created.length, count);
});
