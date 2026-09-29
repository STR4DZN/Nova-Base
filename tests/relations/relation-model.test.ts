import test from "node:test";
import assert from "node:assert/strict";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import type { Result } from "../../src/core/contracts/result.js";
import type { RelationDefinition, RelationInstance } from "../../src/relations/types/relation-types.js";
import { validateRelationDefinition, validateRelationInstance, validateRelationPartyRef,
  validateRelationLifecycleTransition, validateRelationUniqueness } from "../../src/relations/types/relation-validation.js";
import { RelationDefinitionRegistry } from "../../src/relations/definitions/relation-registry.js";

const unwrap = <T>(result: Result<T>): T => { if (!result.ok) assert.fail(JSON.stringify(result.error)); return result.value; };
const definition = (patch: Partial<RelationDefinition> = {}): RelationDefinition => ({
  id: "test:cooperation", version: 1, label: "Cooperation", symmetry: "symmetric",
  minParties: 2, maxParties: null, allowedPartyTypes: ["domain", "populationGroup", "operationalGroup", "notable", "actor", "narrative", "test:integration"],
  allowedPartyRoles: ["partner", "patron", "client"], allowMultiple: false, stancePolicy: "none",
  axes: [{ id: "test:trust", label: "Trust", minimum: -100, maximum: 100, defaultValue: 0 }], ...patch
});
const instance = (patch: Partial<RelationInstance> = {}): RelationInstance => ({
  schemaVersion: 1, id: createOpaqueId("rel"), definitionId: "test:cooperation", definitionVersion: 1,
  revision: 0, label: "A/B", lifecycle: "active", parties: [
    { id: "a", role: "partner", ref: { type: "domain", uuid: "JournalEntry.alpha" } },
    { id: "b", role: "partner", ref: { type: "domain", uuid: "JournalEntry.beta" } }
  ], scope: null, baseAxes: [{ axisId: "test:trust", value: 20, fromPartyId: null, toPartyId: null }],
  visibility: "public", createdAt: 100, updatedAt: 100, endedAt: null, ...patch
});

test("G6.1: symmetric relation validates without Domain owner and round-trips JSON", () => {
  const original = instance(), validated = unwrap(validateRelationInstance(original, definition()));
  assert.deepEqual(unwrap(validateRelationInstance(JSON.parse(JSON.stringify(validated)), definition())), original);
  assert.ok(Object.isFrozen(validated)); assert.ok(Object.isFrozen(validated.parties[0].ref));
  assert.ok(Object.isFrozen(validated.baseAxes[0]));
});

test("G6.1: asymmetric multiparty scores keep independent directions and scopes", () => {
  const d = definition({ symmetry: "asymmetric", stancePolicy: "manual" });
  const r = instance({ stance: "Uneasy", scope: { type: "territory", uuid: "JournalEntry.region" },
    parties: [...instance().parties, { id: "c", role: "client", ref: { type: "actor", uuid: "Actor.pilot" } }],
    baseAxes: [ { axisId: "test:trust", value: -70, fromPartyId: "a", toPartyId: "b" },
      { axisId: "test:trust", value: 80, fromPartyId: "b", toPartyId: "a" },
      { axisId: "test:trust", value: 30, fromPartyId: "c", toPartyId: "a" } ] });
  const result = unwrap(validateRelationInstance(r, d));
  assert.deepEqual(result.baseAxes.map(a => a.value), [-70, 80, 30]);
  assert.deepEqual(result.scope, r.scope); assert.equal(result.stance, "Uneasy");
});

for (const ref of [
  { type: "domain", uuid: "JournalEntry.alpha" }, { type: "actor", uuid: "Compendium.test.package.actors.Actor.pilot" },
  { type: "populationGroup", id: "pop_shared", domainUuid: "JournalEntry.alpha" },
  { type: "operationalGroup", id: "opg_shared", domainUuid: "JournalEntry.alpha" },
  { type: "notable", id: "not_shared", domainUuid: "JournalEntry.alpha" },
  { type: "narrative", id: "council" }, { type: "test:integration", id: "external-party" }
]) test(`G6.1: accepts ${ref.type} party reference`, () => assert.deepEqual(unwrap(validateRelationPartyRef(ref)), ref));

for (const ref of [
  { type: "user", uuid: "User.player" }, { type: "actor", uuid: "JournalEntry.alpha" },
  { type: "domain", id: "alpha" }, { type: "notable", id: "not_one" },
  { type: "populationGroup", uuid: "Actor.alpha", domainUuid: "JournalEntry.alpha" },
  { type: "operationalGroup", id: "opg_one", domainUuid: "Actor.alpha" },
  { type: "narrative", id: "story", uuid: "JournalEntry.alpha" },
  { type: "test:integration", uuid: "User.player" }, { type: "narrative", id: " " }
]) test(`G6.1: rejects invalid party ${JSON.stringify(ref)}`, () => assert.equal(validateRelationPartyRef(ref).ok, false));

for (const patch of [
  { id: "unscoped" }, { version: 0 }, { version: 1.5 }, { minParties: 1 }, { maxParties: 1 },
  { allowedPartyTypes: ["user"] }, { allowedPartyRoles: ["partner", "partner"] }, { allowMultiple: "yes" },
  { symmetry: { toString: () => "symmetric" } }, { stancePolicy: "automatic" },
  { axes: [{ id: "test:trust", label: "Trust", minimum: 5, maximum: 3, defaultValue: 4 }] },
  { axes: [{ id: "test:trust", label: "Trust", minimum: 0, maximum: 10, defaultValue: 11 }] },
  { axes: [definition().axes[0], definition().axes[0]] }
]) test(`G6.1: rejects malformed definition ${Object.keys(patch)[0]} ${JSON.stringify(patch)}`, () => {
  assert.equal(validateRelationDefinition({ ...definition(), ...patch }).ok, false);
});

for (const patch of [
  { schemaVersion: 2 }, { id: "rel_guess" }, { definitionVersion: 2 }, { definitionId: "test:unknown" },
  { revision: -1 }, { revision: 1.5 }, { lifecycle: "terminated" }, { endedAt: 100 }, { updatedAt: 99 },
  { createdAt: Infinity }, { visibility: "private" }, { visibility: ["public"] }, { stance: "Neutral" },
  { parties: [instance().parties[0]] }, { scope: { type: "territory", id: "a", uuid: "JournalEntry.a" } },
  { baseAxes: [{ axisId: "test:trust", value: 100.5, fromPartyId: null, toPartyId: null }] },
  { baseAxes: [{ axisId: "test:trust", value: Number.MAX_SAFE_INTEGER + 1, fromPartyId: null, toPartyId: null }] },
  { baseAxes: [{ axisId: "test:missing", value: 0, fromPartyId: null, toPartyId: null }] },
  { baseAxes: [{ axisId: "test:trust", value: -101, fromPartyId: null, toPartyId: null }] },
  { baseAxes: [{ axisId: "test:trust", value: 0, fromPartyId: "a", toPartyId: "b" }] },
  { baseAxes: [instance().baseAxes[0], instance().baseAxes[0]] }
]) test(`G6.1: rejects malformed instance ${Object.keys(patch)[0]} ${JSON.stringify(patch)}`, () => {
  assert.equal(validateRelationInstance({ ...instance(), ...patch }, definition()).ok, false);
});

test("G6.1: party IDs/entities cannot repeat; People IDs in distinct owners remain distinct", () => {
  const r = instance();
  assert.equal(validateRelationInstance({ ...r, parties: [r.parties[0], r.parties[0]] }, definition()).ok, false);
  assert.equal(validateRelationInstance({ ...r, parties: [r.parties[0], { ...r.parties[0], id: "new" }] }, definition()).ok, false);
  const refs = ["alpha", "beta"].map((owner, i) => ({ id: `p${i}`, role: "partner",
    ref: { type: "notable" as const, id: "not_same", domainUuid: `JournalEntry.${owner}` } }));
  assert.equal(validateRelationInstance({ ...r, parties: refs }, definition()).ok, true);
});

test("G6.1: bilateral cap, roles and party types follow definition policy", () => {
  const three = instance({ parties: [...instance().parties,
    { id: "c", role: "partner", ref: { type: "narrative", id: "council" } }] });
  assert.equal(validateRelationInstance(three, definition({ maxParties: 2 })).ok, false);
  assert.equal(validateRelationInstance(three, definition({ allowedPartyTypes: ["domain"] })).ok, false);
  assert.equal(validateRelationInstance(instance(), definition({ allowedPartyRoles: ["client"] })).ok, false);
  assert.equal(validateRelationInstance(instance(), definition({ minParties: 3 })).ok, false);
  unwrap(validateRelationInstance(three, definition({ minParties: 3, maxParties: 3 })));
});

test("G6.1: unknown or incomplete records fail closed without creating defaults", () => {
  for (const raw of [null, [], "relation", new Date(), {}]) {
    assert.equal(validateRelationDefinition(raw).ok, false);
    assert.equal(validateRelationInstance(raw, definition()).ok, false);
  }
  const r = instance(), before = structuredClone(r);
  for (const key of ["revision", "definitionVersion", "parties", "scope", "baseAxes", "createdAt"]) {
    const malformed: any = { ...r }; delete malformed[key];
    assert.equal(validateRelationInstance(malformed, definition()).ok, false);
  }
  assert.deepEqual(r, before);
});

test("G6.1: asymmetry rejects missing, self or unknown direction", () => {
  for (const [fromPartyId, toPartyId] of [[null, null], ["a", "a"], ["a", "missing"]]) {
    assert.equal(validateRelationInstance(instance({ baseAxes: [{ axisId: "test:trust", value: 1, fromPartyId, toPartyId }] }),
      definition({ symmetry: "asymmetric" })).ok, false);
  }
});

test("G6.1: ended state preserves parties/axes, requires timestamp, cannot reopen silently", () => {
  const r = instance({ lifecycle: "ended", updatedAt: 200, endedAt: 200 });
  assert.deepEqual(unwrap(validateRelationInstance(r, definition())).parties, r.parties);
  assert.deepEqual(unwrap(validateRelationInstance(r, definition())).baseAxes, r.baseAxes);
  assert.equal(validateRelationInstance({ ...r, endedAt: null }, definition()).ok, false);
  assert.equal(validateRelationInstance({ ...r, endedAt: 201 }, definition()).ok, false);
  unwrap(validateRelationLifecycleTransition("active", "ended"));
  unwrap(validateRelationLifecycleTransition("ended", "ended"));
  assert.equal(validateRelationLifecycleTransition("ended", "active").ok, false);
  assert.equal(validateRelationLifecycleTransition("bad" as never, "bad" as never).ok, false);
});

test("G6.1: qualitative definitions can have no axes; derived stance is not persisted", () => {
  unwrap(validateRelationInstance(instance({ baseAxes: [] }), definition({ axes: [], stancePolicy: "derived" })));
  assert.equal(validateRelationInstance(instance({ stance: "Friendly" }), definition({ stancePolicy: "derived" })).ok, false);
  unwrap(validateRelationDefinition(definition({ axes: [{ id: "test:custom", label: "Custom", minimum: -3, maximum: 3, defaultValue: 1 }] })));
});

test("G6.1: duplicate type guard ignores party order, scope key order and definition revision", () => {
  const prior = instance({ scope: { type: "territory", id: "north" } });
  const reordered = instance({ scope: { id: "north", type: "territory" }, parties: [...prior.parties].reverse() });
  const copy = structuredClone([prior, reordered]);
  assert.equal(validateRelationUniqueness(reordered, definition(), [prior]).ok, false);
  assert.equal(validateRelationUniqueness({ ...reordered, definitionVersion: 2 }, definition({ version: 2 }), [prior]).ok, false);
  assert.equal(validateRelationUniqueness({ ...reordered, id: prior.id }, definition({ allowMultiple: true }), [prior]).ok, false);
  unwrap(validateRelationUniqueness(reordered, definition({ allowMultiple: true }), [prior]));
  unwrap(validateRelationUniqueness(instance({ scope: { type: "territory", id: "south" } }), definition(), [prior]));
  unwrap(validateRelationUniqueness(instance({ definitionId: "test:rivalry" }), definition({ id: "test:rivalry" }), [prior]));
  unwrap(validateRelationUniqueness(reordered, definition(), [{ ...prior, lifecycle: "ended", endedAt: 100 }]));
  assert.deepEqual([prior, reordered], copy);
});

test("G6.1: registry is versioned, isolated from input mutations, and frozen", () => {
  const registry = new RelationDefinitionRegistry(), original = structuredClone(definition());
  unwrap(registry.register(original)); unwrap(registry.register(definition({ version: 2 })));
  (original.axes as any)[0].minimum = -999;
  assert.equal(registry.get(original.id, 1)?.axes[0].minimum, -100);
  assert.equal(registry.get(original.id, 2)?.version, 2);
  assert.equal(registry.get(original.id, 99), undefined);
  assert.equal(registry.register(definition()).ok, false);
  assert.equal(registry.list().length, 2);
  registry.freeze(); assert.equal(registry.isFrozen, true);
  assert.equal(registry.register(definition({ id: "test:another" })).ok, false);
});

test("G6.1: scale fixture validates 1000 independent relations without changing inputs", () => {
  const d = definition();
  for (let i = 0; i < 1000; i++) {
    const r = instance({ scope: { type: "context", id: `campaign-${i}` } });
    assert.deepEqual(unwrap(validateRelationInstance(r, d)), r);
  }
});
