import test from "node:test";
import assert from "node:assert/strict";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import type { Result } from "../../src/core/contracts/result.js";
import type { DiplomacyOwnerContext } from "../../src/diplomacy/owner-contract.js";
import { reputationOwner, type ReputationOwnerData } from "../../src/reputation/reputation-owner.js";
import { defaultReputationTrackFields, parseReputationTrackFields, reputationTrackDefinitionFields, renderReputationTrackFields } from "../../src/ui/domain-patterns/diplomacy/reputation-track-form.js";
import { DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
import type { ReputationTrackDefinition } from "../../src/reputation/reputation-model.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const definition = (patch: Partial<ReputationTrackDefinition> = {}): ReputationTrackDefinition => ({
  id: "test:esteem", version: 1, label: "Esteem", minimum: -100, maximum: 100, baseline: 0,
  visibility: "public", publicPresentation: "band", bands: [
    { id: "test:low", label: "Low", minimum: -100, maximum: -1 }, { id: "test:high", label: "High", minimum: 0, maximum: 100 }],
  decay: { amount: 3, periodTicks: 10 }, ...patch });
function data(): ReputationOwnerData {
  return { definitions: [definition()], record: { schemaVersion: 1, id: createOpaqueId("rep"), revision: 0,
    label: "Standing", subjectRef: { type: "narrative", id: "subject" }, audienceRef: { type: "narrative", id: "audience" },
    visibility: "public", createdAt: 0, updatedAt: 0, entries: [],
    tracks: [{ definitionId: "test:esteem", definitionVersion: 1, score: 20, initialScore: 20, lastDecayWorldTick: 0 }] } };
}
const context = (d: ReputationOwnerData, patch: Partial<DiplomacyOwnerContext> = {}): DiplomacyOwnerContext => ({
  expectedRevision: d.record.revision, eventId: crypto.randomUUID(), at: d.record.updatedAt + 1, worldTick: 10,
  reason: "GM configured", sourceRefs: [{ type: "manual", id: "gm" }], ...patch });
const change = (d: ReputationOwnerData, action: unknown, patch: Partial<DiplomacyOwnerContext> = {}) =>
  reputationOwner.change(d, action, context(d, patch), []) as Result<ReputationOwnerData>;
const policy = (patch: Partial<ReputationTrackDefinition> = {}) => {
  const { id, version, ...p } = definition(patch); return p;
};
const configure = (d: ReputationOwnerData, p = policy({ label: "New label" }), version = 2, patch: Partial<DiplomacyOwnerContext> = {}) =>
  change(d, { kind: "configure-track", trackId: "test:esteem", policy: p, definitionVersion: version }, patch);
const fields = (patch: Record<string, string> = {}, prefix = "config_") =>
  Object.fromEntries(Object.entries({ ...defaultReputationTrackFields(), ...patch }).map(([k, v]) => [prefix + k, v]));

test("G6 reputation config: adding a track preserves existing scores/history and anchors its decay at authority time", () => {
  const d = data(), before = structuredClone(d), next = unwrap(change(d, { kind: "add-track",
    definition: definition({ id: "test:renown" }), initialScore: 40 }, { worldTick: 100 }));
  assert.deepEqual(d, before); assert.equal(next.record.revision, 1); assert.deepEqual(next.record.tracks[0], d.record.tracks[0]);
  assert.equal(next.record.tracks[1].initialScore, 40); assert.equal(next.record.tracks[1].lastDecayWorldTick, 100);
  assert.equal(next.configurationHistory?.[0].kind, "track-added"); assert.deepEqual(next.record.entries, []);
  const tooEarly = unwrap(change(next, { kind: "decay", trackId: "test:renown" }, { worldTick: 105 }));
  assert.equal(tooEarly.record.revision, 1);
  const decayed = unwrap(change(next, { kind: "decay", trackId: "test:renown" }, { worldTick: 110 }));
  assert.equal(decayed.record.tracks[1].score, 37); assert.deepEqual(decayed.configurationHistory, next.configurationHistory);
});
test("G6 reputation config: policy version changes retain score entries, original snapshot and initial score", () => {
  const d = unwrap(change(data(), { kind: "adjust", trackId: "test:esteem", delta: 5 }));
  const next = unwrap(configure(d));
  assert.equal(next.record.tracks[0].score, 25); assert.equal(next.record.tracks[0].initialScore, 20);
  assert.deepEqual(next.record.entries, d.record.entries); assert.deepEqual(next.definitions[0], d.definitions[0]);
  assert.equal(next.record.tracks[0].definitionVersion, 2); assert.equal(next.record.tracks[0].lastDecayWorldTick, 0);
  assert.equal(next.configurationHistory?.[0].beforeVersion, 1); assert.equal(next.configurationHistory?.[0].afterVersion, 2);
  assert.deepEqual(unwrap(reputationOwner.validate(JSON.parse(JSON.stringify(next)), [])), next);
});
test("G6 reputation config: decay policy change consumes no retrospective periods and disable/enable rebases explicitly", () => {
  const d = data(), next = unwrap(configure(d, policy({ decay: { amount: 5, periodTicks: 10 } }), 2, { worldTick: 100 }));
  assert.equal(next.record.tracks[0].lastDecayWorldTick, 100);
  assert.equal(unwrap(change(next, { kind: "decay", trackId: "test:esteem" }, { worldTick: 109 })).record.tracks[0].score, 20);
  const decayed = unwrap(change(next, { kind: "decay", trackId: "test:esteem" }, { worldTick: 110 }));
  assert.equal(decayed.record.tracks[0].score, 15);
  const disabled = unwrap(configure(decayed, policy({ decay: null }), 3, { worldTick: 150 }));
  assert.equal(disabled.record.tracks[0].lastDecayWorldTick, null);
  assert.equal(change(disabled, { kind: "decay", trackId: "test:esteem" }, { worldTick: 160 }).ok, false);
  const enabled = unwrap(configure(disabled, policy(), 4, { worldTick: 200 }));
  assert.equal(enabled.record.tracks[0].lastDecayWorldTick, 200);
  assert.equal(enabled.record.tracks[0].score, 15);
});
test("G6 reputation config: identical configuration is a no-op; stale revisions are still rejected", () => {
  const d = data(); assert.strictEqual(unwrap(configure(d, policy())), d);
  assert.equal(configure(d, policy(), 2, { expectedRevision: 1 }).ok, false);
  assert.equal(configure(d, policy(), 2, { reason: "" }).ok, false);
});
test("G6 reputation config: duplicate track, fractional/unsafe/out-of-range score and invalid policy fail before mutation", () => {
  const d = data(), before = structuredClone(d);
  assert.equal(change(d, { kind: "add-track", definition: definition(), initialScore: 0 }).ok, false);
  for (const initialScore of [101, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(change(d, { kind: "add-track", definition: definition({ id: "test:new" }), initialScore }).ok, false);
  for (const p of [policy({ minimum: -101 }), policy({ baseline: 101 }), policy({ bands: [] }),
    policy({ decay: { amount: 0, periodTicks: 1 } })]) assert.equal(configure(d, p).ok, false);
  assert.equal(change(d, { kind: "configure-track", trackId: "test:missing", policy: policy(), definitionVersion: 2 }).ok, false);
  assert.equal(configure(d, policy({ label: "Changed" }), 1).ok, false); assert.deepEqual(d, before);
});
test("G6 reputation config: version collisions and broken before/after audit are rejected", () => {
  const d = data(), withVersion = { ...d, definitions: [...d.definitions, definition({ version: 2, label: "Reserved" })] };
  assert.equal(configure(withVersion).ok, false);
  const changed = unwrap(configure(d)), forged = structuredClone(changed) as any;
  forged.configurationHistory[0].afterVersion = 1;
  assert.equal(reputationOwner.validate(forged, []).ok, false);
  forged.configurationHistory[0].afterVersion = 2; forged.record.tracks[0].definitionVersion = 1;
  assert.equal(reputationOwner.validate(forged, []).ok, false);
});
test("G6 reputation config: absent legacy audit remains readable and hidden configuration never reaches Player DTO", () => {
  assert.equal(reputationOwner.validate(data(), []).ok, true);
  const changed = unwrap(change(data(), { kind: "add-track", definition: definition({ id: "test:private", label: "secret-marker", visibility: "secret" }) }));
  const player = unwrap(reputationOwner.project(changed, { isGm: false, canSee: v => v === "public", at: 100, worldTick: 10, historyOffset: 0, historyLimit: 30 })) as any;
  assert.equal(player.tracks.length, 1); assert.equal(player.tracks[0].score, undefined);
  for (const token of ["secret-marker", "test:private", "configurationHistory", "initialScore", "lastDecayWorldTick"])
    assert.equal(JSON.stringify(player).includes(token), false);
  const gm = unwrap(reputationOwner.project(changed, { isGm: true, canSee: () => true, at: 100, worldTick: 10, historyOffset: 0, historyLimit: 30 })) as any;
  assert.equal(gm.configurationHistory.length, 1); assert.equal(gm.tracks[1].label, "secret-marker");
});
test("G6 reputation config: form parses custom bands, privacy, initial value and enabled/disabled decay", () => {
  const parsed = unwrap(parseReputationTrackFields(fields({ id: "test:custom", initialScore: "25", decayEnabled: "on", decayAmount: "5", decayPeriod: "10" }), "config_"));
  assert.equal(parsed.definition.id, "test:custom"); assert.equal(parsed.initialScore, 25);
  assert.deepEqual(parsed.definition.decay, { amount: 5, periodTicks: 10 }); assert.equal(parsed.definition.bands.length, 3);
  const hidden = unwrap(parseReputationTrackFields(fields({ publicPresentation: "hidden", bands: "", decayAmount: "" }), "config_"));
  assert.equal(hidden.definition.decay, null); assert.deepEqual(hidden.definition.bands, []);
});
test("G6 reputation config: form rejects blank/fractional values, malformed/overlapping/incomplete bands and invalid decay", () => {
  for (const patch of [{ baseline: "" }, { initialScore: "1.5" }, { minimum: "NaN" }, { id: "not-namespaced" },
    { bands: "Bad | 0" }, { bands: "Low | -100 | 10\nHigh | 0 | 100" }, { bands: "Only | 0 | 100" },
    { decayEnabled: "on", decayPeriod: "0" }, { maximum: String(Number.MAX_SAFE_INTEGER + 1) }])
    assert.equal(parseReputationTrackFields(fields(patch), "config_").ok, false, JSON.stringify(patch));
});
test("G6 reputation config: unchanged existing form preserves band IDs and policy for no-op detection", () => {
  const d = definition(), values = reputationTrackDefinitionFields(d);
  const parsed = unwrap(parseReputationTrackFields(fields(values), "config_", { id: d.id, version: d.version, bandIds: d.bands.map(b => b.id) }));
  assert.deepEqual(parsed.definition, d);
});
test("G6 reputation config: form renders escaped content and locks existing identifier/range", () => {
  const html = renderReputationTrackFields("config_", { ...defaultReputationTrackFields(), label: '<img src=x onerror="bad">', bands: "</textarea><script>bad</script>" }, true);
  assert.equal(html.includes("<script>"), false); assert.equal(html.includes('<img src=x'), false);
  assert.ok(html.includes("readonly")); assert.equal(html.includes('name="config_initialScore"'), false);
  assert.ok(html.includes('name="config_decayEnabled"'));
});
test("G6 reputation config UI: creation submits multiple independently configured tracks through public API", async () => {
  const sent: any[] = [], controller = new DiplomacyApplicationController({ reputation: { create: async (value: any) => { sent.push(value); return { ok: true, value }; } } } as any);
  controller.tab = "reputation"; controller.list = { isGm: true };
  const base = { label: "Standing", subject: "subject", audience: "audience", reason: "Created", visibility: "public" };
  controller.addReputationTrackForm(base);
  unwrap(await controller.create({ ...base, ...fields({ id: "test:first" }, "rep_0_"),
    ...fields({ id: "test:second", initialScore: "10", decayEnabled: "on", decayAmount: "2", decayPeriod: "5" }, "rep_1_") }));
  assert.equal(sent.length, 1); assert.equal(sent[0].data.definitions.length, 2);
  assert.equal(sent[0].data.record.tracks[1].initialScore, 10); assert.equal(sent[0].data.record.tracks[1].lastDecayWorldTick, null);
  assert.equal(sent[0].data.definitions[1].decay.amount, 2);
});
test("G6 reputation config UI: invalid input is preserved; removing/reindexing tracks keeps other fields", async () => {
  const controller = new DiplomacyApplicationController({ reputation: { create: async () => assert.fail("must not send") } } as any);
  controller.tab = "reputation"; controller.list = { isGm: true }; controller.creating = true;
  const values = { label: "Typed name", subject: "a", audience: "b", reason: "Typed reason", visibility: "restricted", ...fields({ baseline: "broken" }, "rep_0_") };
  assert.equal((await controller.create(values)).ok, false); const html = controller.createForm();
  assert.ok(html.includes("Typed name")); assert.ok(html.includes("broken")); assert.ok(html.includes('value="restricted" selected'));
  controller.addReputationTrackForm({ ...values, rep_1_label: "Second" });
  controller.removeReputationTrackForm(0, { ...values, rep_1_label: "Second" });
  assert.equal(controller.reputationTrackCount, 1); assert.equal(controller.reputationFormFields.rep_0_label, "Second");
  assert.equal(controller.reputationFormFields.reason, "Typed reason");
});
test("G6 reputation config UI: GM edits via semantic action, Player has no configuration form or direct mutation", async () => {
  const mutations: any[] = [], controller = new DiplomacyApplicationController({ reputation: { modify: async (value: any) => { mutations.push(value); return { ok: true, value }; } } } as any);
  controller.tab = "reputation"; controller.list = { isGm: true };
  controller.detail = unwrap(reputationOwner.project(data(), { isGm: true, canSee: () => true, at: 100, worldTick: 10, historyOffset: 0, historyLimit: 30 }));
  const values = fields({ ...reputationTrackDefinitionFields(definition()), label: "New label" });
  unwrap(await controller.configureReputationTrack({ ...values, trackId: "test:esteem", reason: "Edited" }, true));
  assert.equal(mutations[0].action.kind, "configure-track"); assert.equal(mutations[0].action.policy.label, "New label");
  assert.equal(mutations[0].expectedRevision, 0); assert.equal(mutations[0].action.definitionVersion, undefined);
  controller.list = { isGm: false }; assert.equal(controller.reputationConfigurationForms(), "");
  assert.equal((await controller.configureReputationTrack({ ...values, trackId: "test:esteem", reason: "Denied" }, true)).ok, false);
  assert.equal(mutations.length, 1);
});
test("G6 reputation config UI: failed unchecked decay configuration remains unchecked and keeps reason", async () => {
  const controller = new DiplomacyApplicationController({ reputation: { modify: async () => ({ ok: false, error: { code: "DM_REVISION_CONFLICT", message: "stale" } }) } } as any);
  controller.tab = "reputation"; controller.list = { isGm: true };
  controller.detail = unwrap(reputationOwner.project(data(), { isGm: true, canSee: () => true, at: 100, worldTick: 10, historyOffset: 0, historyLimit: 30 }));
  const values = fields(reputationTrackDefinitionFields(definition())); delete values.config_decayEnabled;
  assert.equal((await controller.configureReputationTrack({ ...values, trackId: "test:esteem", reason: "Saved reason" }, true)).ok, false);
  const html = controller.reputationConfigurationForms();
  assert.ok(html.includes("Saved reason")); assert.equal(html.includes('name="config_decayEnabled" checked'), false);
});
test("G6 reputation config: 100 configured tracks round-trip without a parallel reputation balance", () => {
  let d = data(); for (let i = 0; i < 100; i++)
    d = unwrap(change(d, { kind: "add-track", definition: definition({ id: `test:track-${i}` }), initialScore: i }));
  const roundtrip = unwrap(reputationOwner.validate(JSON.parse(JSON.stringify(d)), [])) as ReputationOwnerData;
  assert.equal(roundtrip.record.tracks.length, 101); assert.equal(roundtrip.configurationHistory?.length, 100);
  assert.equal(roundtrip.record.entries.length, 0);
});
