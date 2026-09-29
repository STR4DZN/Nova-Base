import test from "node:test";
import assert from "node:assert/strict";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import type { Result } from "../../src/core/contracts/result.js";
import { ReputationTrackRegistry, adjustReputation, decayReputation, projectReputation,
  validateReputationRecord, validateReputationTrackDefinition, type ReputationRecord,
  type ReputationTrackDefinition, type ReputationAdjustment } from "../../src/reputation/reputation-model.js";

const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const definition: ReputationTrackDefinition = { id: "test:esteem", version: 1, label: "Esteem", minimum: -100,
  maximum: 100, baseline: 0, visibility: "public", publicPresentation: "band",
  bands: [{ id: "test:low", label: "Distrusted", minimum: -100, maximum: -1 },
    { id: "test:high", label: "Trusted", minimum: 0, maximum: 100 }], decay: { amount: 3, periodTicks: 10 } };
function fixture() {
  const registry = new ReputationTrackRegistry(); unwrap(registry.register(definition));
  const record: ReputationRecord = { schemaVersion: 1, id: createOpaqueId("rep"), revision: 0, label: "Audience reputation",
    subjectRef: { type: "narrative", id: "guild" }, audienceRef: { type: "test:audience", id: "residents" },
    visibility: "public", createdAt: 0, updatedAt: 0, entries: [],
    tracks: [{ definitionId: definition.id, definitionVersion: 1, score: 20, initialScore: 20, lastDecayWorldTick: 0 }] };
  return { record, registry };
}
const input = (r: ReputationRecord, patch: Partial<ReputationAdjustment> = {}): ReputationAdjustment => ({
  expectedRevision: r.revision, entryId: crypto.randomUUID(), trackId: definition.id, delta: 5, source: { type: "incident", id: "gm" },
  reason: "Audience witnessed incident", at: r.updatedAt + 1, worldTick: 0, ...patch });

test("G6.3: track definitions are versioned, immutable and validate range/bands/decay", () => {
  const { registry } = fixture(); assert.equal(registry.register(definition).ok, false);
  assert.equal(registry.register({ ...definition, version: 2 }).ok, true);
  assert.equal(Object.isFrozen(registry.get(definition.id, 1)?.bands), true);
  registry.freeze(); assert.equal(registry.register({ ...definition, version: 3 }).ok, false);
  for (const patch of [{ baseline: 101 }, { decay: { amount: 0, periodTicks: 10 } }, { bands: [] },
    { bands: [{ ...definition.bands[0], maximum: -2 }, definition.bands[1]] }, { minimum: NaN }])
    assert.equal(validateReputationTrackDefinition({ ...definition, ...patch }).ok, false);
});
test("G6.3: adjustment records actual clamped delta and reversal compensates only once", () => {
  const { record, registry } = fixture(), before = structuredClone(record), c = input(record, { delta: 999 });
  const next = unwrap(adjustReputation(record, registry, c)); assert.deepEqual(record, before);
  assert.equal(next.tracks[0].score, 100); assert.equal(next.entries[0].delta, 80);
  const reverse = unwrap(adjustReputation(next, registry, input(next, { delta: -80, reversalOf: c.entryId }), "reversal"));
  assert.equal(reverse.tracks[0].score, 20); assert.deepEqual(reverse.entries[0], next.entries[0]);
  assert.equal(adjustReputation(reverse, registry, input(reverse, { delta: -80, reversalOf: c.entryId }), "reversal").ok, false);
  assert.deepEqual(unwrap(validateReputationRecord(JSON.parse(JSON.stringify(reverse)), registry)), reverse);
});
test("G6.3: reversal cannot compensate a decay, another reversal or silently clamp", () => {
  const { record, registry } = fixture(), c = input(record, { delta: 80 });
  const next = unwrap(adjustReputation(record, registry, c));
  const later = unwrap(adjustReputation(next, registry, input(next, { delta: -190 })));
  assert.equal(adjustReputation(later, registry, input(later, { delta: -80, reversalOf: c.entryId }), "reversal").ok, false);
  const decayed = unwrap(decayReputation(record, registry, input(record, { worldTick: 10 })));
  assert.equal(adjustReputation(decayed, registry, input(decayed, { delta: 3, reversalOf: decayed.entries[0].id }), "reversal").ok, false);
});
test("G6.3: decay consumes complete periods, retains remainder and audits baseline no-ops", () => {
  const { record, registry } = fixture();
  const first = unwrap(decayReputation(record, registry, input(record, { worldTick: 25 })));
  assert.equal(first.tracks[0].score, 14); assert.equal(first.tracks[0].lastDecayWorldTick, 20);
  assert.strictEqual(unwrap(decayReputation(first, registry, input(first, { worldTick: 29 }))), first);
  const baseline = unwrap(decayReputation(first, registry, input(first, { worldTick: 1000 })));
  assert.equal(baseline.tracks[0].score, 0); assert.equal(baseline.entries.length, 2);
  const audit = unwrap(decayReputation(baseline, registry, input(baseline, { worldTick: 1010 })));
  assert.equal(audit.entries[2].delta, 0); assert.equal(audit.revision, 3); assert.equal(audit.tracks[0].lastDecayWorldTick, 1010);
  assert.equal(decayReputation(audit, registry, input(audit, { worldTick: 1009 })).ok, false);
  assert.equal(decayReputation(audit, registry, input(audit, { worldTick: 1011, source: { type: "bad" } })).ok, false);
});
test("G6.3: decay approaches baseline from below and requires explicit policy/tick", () => {
  const { record, registry } = fixture(); const negative = { ...record, tracks: [{ ...record.tracks[0], score: -20, initialScore: -20 }] };
  assert.equal(unwrap(decayReputation(negative, registry, input(negative, { worldTick: 20 }))).tracks[0].score, -14);
  assert.equal(decayReputation(record, registry, input(record, { worldTick: null })).ok, false);
  const unknown = { ...record, tracks: [{ ...record.tracks[0], lastDecayWorldTick: null }] };
  assert.equal(decayReputation(unknown, registry, input(unknown, { worldTick: 20 })).ok, false);
});
test("G6.3: Player band view never reveals raw score/history, hidden tracks or their revision", () => {
  const { record, registry } = fixture();
  unwrap(registry.register({ ...definition, id: "test:secret", visibility: "secret", publicPresentation: "score" }));
  const mixed = { ...record, tracks: [...record.tracks, { ...record.tracks[0], definitionId: "test:secret" }] };
  const player = unwrap(projectReputation(mixed, registry, false, v => v === "public")) as any;
  assert.deepEqual(player.tracks, [{ definitionId: definition.id, label: "Esteem", band: "Trusted" }]);
  assert.equal(player.revision, undefined); assert.equal(player.entries, undefined);
  const secretChanged = unwrap(adjustReputation(mixed, registry, input(mixed, { trackId: "test:secret", delta: 10 })));
  assert.deepEqual(unwrap(projectReputation(secretChanged, registry, false, v => v === "public")), player);
  assert.deepEqual(unwrap(projectReputation(secretChanged, registry, true, () => true)), secretChanged);
  assert.equal(projectReputation({ ...record, visibility: "secret" }, registry, false, v => v === "public").ok, false);
});
test("G6.3: score presentation is explicit and audience records remain independent", () => {
  const { record, registry } = fixture(); unwrap(registry.register({ ...definition, version: 2, publicPresentation: "score" }));
  const scoreView = { ...record, tracks: [{ ...record.tracks[0], definitionVersion: 2 }] };
  assert.equal((unwrap(projectReputation(scoreView, registry, false, () => true)) as any).tracks[0].score, 20);
  const other = { ...record, id: createOpaqueId("rep"), audienceRef: { type: "narrative", id: "foreign-guild" } };
  unwrap(adjustReputation(record, registry, input(record))); assert.equal(other.tracks[0].score, 20);
});
test("G6.3: corrupt history, stale revision, unknown definition and invalid refs fail closed", () => {
  const { record, registry } = fixture(); const changed = unwrap(adjustReputation(record, registry, input(record)));
  assert.equal(adjustReputation(changed, registry, input(changed, { expectedRevision: 0 })).ok, false);
  assert.equal(adjustReputation(changed, registry, input(changed, { entryId: changed.entries[0].id })).ok, false);
  assert.equal(validateReputationRecord({ ...changed, entries: [] }, registry).ok, false);
  assert.equal(validateReputationRecord({ ...record, tracks: [{ ...record.tracks[0], definitionVersion: 99 }] }, registry).ok, false);
  assert.equal(validateReputationRecord({ ...record, subjectRef: { type: "user", id: "user" } }, registry).ok, false);
  assert.equal(validateReputationRecord({ ...record, garbage: () => {} }, registry).ok, false);
  assert.strictEqual(unwrap(adjustReputation(record, registry, input(record, { delta: 0 }))), record);
});
test("G6.3: large score deltas use exact arithmetic and reject unrepresentable applied movement", () => {
  const { record } = fixture(), registry = new ReputationTrackRegistry();
  unwrap(registry.register({ ...definition, minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER,
    bands: [], publicPresentation: "score" }));
  const large = { ...record, tracks: [{ ...record.tracks[0], score: Number.MAX_SAFE_INTEGER, initialScore: Number.MAX_SAFE_INTEGER }] };
  const first = unwrap(adjustReputation(large, registry, input(large, { delta: -Number.MAX_SAFE_INTEGER })));
  assert.equal(first.tracks[0].score, 0);
  assert.equal(adjustReputation(first, registry, input(first, { delta: Number.MAX_SAFE_INTEGER })).ok, true);
});
test("G6.3: durable history supports 2000 entries and shared source refs but rejects cycles", () => {
  const { record, registry } = fixture(), source = { type: "incident", id: "gm" };
  const entries = Array.from({ length: 2000 }, (_, i) => ({ id: `entry-${i}`, trackId: definition.id, kind: "adjustment" as const,
    delta: i % 2 ? -1 : 1, before: i % 2 ? 21 : 20, after: i % 2 ? 20 : 21, source, reason: "Recorded incident",
    at: i + 1, worldTick: null, reversalOf: null }));
  const large = { ...record, updatedAt: 2000, entries };
  assert.equal(validateReputationRecord(large, registry).ok, true);
  assert.deepEqual(unwrap(validateReputationRecord(JSON.parse(JSON.stringify(large)), registry)), large);
  const cyclic: any = { ...record }; cyclic.cycle = cyclic; assert.equal(validateReputationRecord(cyclic, registry).ok, false);
});
