import test from "node:test";
import assert from "node:assert/strict";
import type { Result } from "../../src/core/contracts/result.js";
import type { Territory } from "../../src/territory/territory-hierarchy.js";
import { changeTerritoryState, emptyTerritoryState, projectTerritoryState, resolveTerritoryInfluence, validateTerritoryState,
  type TerritoryAction, type TerritoryChangeContext, type TerritoryClaim, type TerritorialSource, type TerritoryInfluence, type TerritoryState } from "../../src/territory/territory-state.js";
import { previewTerritoryTransfer, commitTerritoryTransfer } from "../../src/territory/territory-transfer.js";
import { validateTerritoryDispute, changeTerritoryDispute, type TerritoryDispute } from "../../src/territory/territory-disputes.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const party = (id: string) => ({ type: "domain" as const, uuid: `JournalEntry.${id}` });
const territory = (id = "t"): Territory => ({ schemaVersion: 1, uuid: `JournalEntry.${id}`, revision: 0, label: id,
  kind: "domain-manager:region", scale: "region", visibility: "public", createdAt: 0, updatedAt: 0,
  locatedInUuid: null, administrativeParentUuid: null, geography: {}, hierarchyHistory: [] });
const source = (id: string, patch: Partial<TerritorialSource> = {}): TerritorialSource => ({ id, sourceRef: { type: "manual", id: "gm" },
  visibility: "public", startsAtWorldTick: 0, expiresAtWorldTick: null, ...patch });
const claim = (id: string, type = "ownership", owner = "a"): TerritoryClaim => ({ ...source(id), claimantRef: party(owner),
  claimType: `domain-manager:${type}`, lifecycle: "active", contested: false, strength: null, inherited: false });
const context = (s: TerritoryState): TerritoryChangeContext => ({ expectedRevision: s.territory.revision, eventId: crypto.randomUUID(),
  at: s.territory.updatedAt + 1, worldTick: 1, reason: "GM explicit decision", sourceRefs: [{ type: "manual", id: "gm" }] });
const change = (s: TerritoryState, action: TerritoryAction) => unwrap(changeTerritoryState(s, context(s), action));
const owned = (id = "t") => change(emptyTerritoryState(territory(id)), { kind: "claim", value: claim("original") });

test("G6.7: ownership/admin/control and competing claims coexist without winner selection", () => {
  let s = owned();
  for (const [id, type, owner] of [["competitor", "ownership", "b"], ["admin", "administration", "c"], ["control", "control", "d"]])
    s = change(s, { kind: "claim", value: claim(id, type, owner) });
  assert.equal(s.claims.length, 4); assert.equal(s.claims.filter(c => c.claimType === "domain-manager:ownership" && c.lifecycle === "active").length, 2);
  assert.equal("owner" in s.territory, false); assert.equal("winner" in s, false);
  assert.deepEqual(unwrap(validateTerritoryState(JSON.parse(JSON.stringify(s)))), s);
});
test("G6.7: contextual recognition permits opposing audiences and no position", () => {
  let s = owned();
  for (const [id, position] of [["yes", "positive"], ["no", "negative"], ["unknown", "unknown"]] as const)
    s = change(s, { kind: "recognition", value: { ...source(id), claimId: "original", recognizingRef: party(id), position } });
  assert.equal(s.recognitions.length, 3); assert.equal(s.claims[0].contested, false);
  assert.equal(changeTerritoryState(s, context(s), { kind: "recognition", value: { ...source("orphan"), claimId: "missing", recognizingRef: party("x"), position: "positive" } }).ok, false);
});
test("G6.7: presence never creates or overwrites ownership/control", () => {
  const s = change(owned(), { kind: "presence", value: { ...source("troops"), partyRef: party("b"), presenceType: "domain-manager:military", amount: 40, active: true } });
  assert.equal(s.claims.length, 1); assert.equal(s.claims[0].claimantRef.uuid, "JournalEntry.a");
  const ended = change(s, { kind: "end-presence", id: "troops" }); assert.equal(ended.presence[0].active, false); assert.equal(ended.claims.length, 1);
});
const influence = (): TerritoryInfluence => ({ ...source("influence"), partyRef: party("b"), active: true,
  axes: [{ axisId: "domain-manager:political", base: 20, minimum: -100, maximum: 100,
    decay: { amount: 5, periodTicks: 10, fromWorldTick: 0, baseline: 0 } }, { axisId: "domain-manager:economic", base: -20, minimum: -100, maximum: 100, decay: null }],
  modifiers: [{ ...source("visible", { expiresAtWorldTick: 30 }), axisId: "domain-manager:political", delta: 7, active: true },
    { ...source("hidden", { visibility: "secret" }), axisId: "domain-manager:political", delta: 50, active: true }] });
test("G6.7: influence is independent and derives decay/modifiers without mutating base", () => {
  const s = change(emptyTerritoryState(territory()), { kind: "influence", value: influence() }), before = structuredClone(s);
  const rows = resolveTerritoryInfluence(s, 20, v => v === "public");
  assert.equal(rows[0].value, 17); assert.equal(rows[0].decay, -10); assert.equal(rows[0].modifiers, 7);
  assert.equal(rows[1].value, -20); assert.deepEqual(s, before); assert.equal(s.presence.length, 0); assert.equal(s.claims.length, 0);
});
test("G6.7: secret modifiers never influence public numbers, expiration has exclusive boundary", () => {
  const s = change(emptyTerritoryState(territory()), { kind: "influence", value: influence() });
  assert.equal(resolveTerritoryInfluence(s, 20, () => true)[0].value, 67);
  assert.equal(resolveTerritoryInfluence(s, 30, v => v === "public")[0].value, 5);
  assert.equal(resolveTerritoryInfluence(s, Number.MAX_SAFE_INTEGER, v => v === "public")[0].value, 0);
  assert.equal(resolveTerritoryInfluence(s, -1, () => true).length, 0);
});
test("G6.7: rights and leases do not transfer claims; revocation respects policy", () => {
  const s = change(owned(), { kind: "right", value: { ...source("lease", { expiresAtWorldTick: 10 }), beneficiaryRef: party("tenant"),
    rightType: "domain-manager:build", inherited: true, revocable: false, active: true, conditionRefs: [], grants: ["test:build"] } });
  assert.equal(s.claims[0].claimantRef.uuid, "JournalEntry.a");
  assert.equal(changeTerritoryState(s, context(s), { kind: "revoke-right", id: "lease" }).ok, false);
});
test("G6.7: links preserve direction, operational status, integer costs/capacity and dependencies", () => {
  const s = change(owned(), { kind: "link", value: { ...source("portal"), targetTerritoryUuid: "JournalEntry.other", linkType: "domain-manager:portal",
    direction: "outbound", status: "operational", cost: 2, capacity: 4, dependencyRefs: [{ type: "agreement", id: "lease" }] } });
  assert.equal(s.links[0].direction, "outbound"); const closed = change(s, { kind: "update-link", id: "portal", status: "closed" });
  assert.equal(closed.links[0].status, "closed"); assert.equal(closed.claims[0].lifecycle, "active");
  assert.equal(changeTerritoryState(s, context(s), { kind: "link", value: { ...s.links[0], id: "self", targetTerritoryUuid: s.territory.uuid } }).ok, false);
});
test("G6.7: occupation records refer to control/presence and ending them never invents a new owner", () => {
  let s = change(owned(), { kind: "claim", value: claim("control", "control", "invader") });
  s = change(s, { kind: "presence", value: { ...source("army"), partyRef: party("invader"), presenceType: "domain-manager:military", amount: 20, active: true } });
  s = change(s, { kind: "occupation", value: { ...source("occupation"), occupierRef: party("invader"), lifecycle: "established", presenceIds: ["army"], controlClaimIds: ["control"] } });
  s = change(s, { kind: "end-occupation", id: "occupation" }); assert.equal(s.occupations[0].lifecycle, "ended");
  assert.equal(s.claims[0].claimantRef.uuid, "JournalEntry.a"); assert.equal(s.claims[1].claimantRef.uuid, "JournalEntry.invader");
});
test("G6.7: malformed sources and duplicate IDs are rejected, no-op keeps identity", () => {
  const s = owned(); assert.equal(changeTerritoryState(s, context(s), { kind: "claim", value: claim("original") }).ok, false);
  for (const patch of [{ strength: 0.5 }, { claimType: "owner" }, { startsAtWorldTick: -1 }, { expiresAtWorldTick: 0 }, { visibility: "invalid" }, { claimantRef: { type: "domain", id: "bad" } }])
    assert.equal(changeTerritoryState(s, context(s), { kind: "claim", value: { ...claim("new"), ...patch } as TerritoryClaim }).ok, false);
  const ended = change(s, { kind: "end-claim", id: "original" });
  assert.strictEqual(unwrap(changeTerritoryState(ended, context(ended), { kind: "end-claim", id: "original" })), ended);
});
test("G6.7: mutations guard stale revision and reject missing audit reason", () => {
  const s = owned(); assert.equal(changeTerritoryState(s, { ...context(s), expectedRevision: 0 }, { kind: "contest-claim", id: "original" }).ok, false);
  assert.equal(changeTerritoryState(s, { ...context(s), reason: "" }, { kind: "contest-claim", id: "original" }).ok, false);
  const changed = change(s, { kind: "contest-claim", id: "original" }); assert.equal(changed.claims[0].contested, true);
  assert.equal(changed.events[1].before && (changed.events[1].before as TerritoryClaim).contested, false);
});
test("G6.7: atomic batch transfer supersedes selected claims and preserves competitors, recognition and history", () => {
  let a = owned("a"); a = change(a, { kind: "claim", value: claim("competing", "ownership", "c") }); const b = owned("b"), states = [a, b], before = structuredClone(states);
  const c = context(a), targets = states.map(s => ({ territoryUuid: s.territory.uuid, expectedRevision: s.territory.revision,
    supersedeClaimIds: ["original"], newClaim: { ...claim("new", "ownership", "buyer"), startsAtWorldTick: c.worldTick } }));
  const plan = unwrap(previewTerritoryTransfer(states, targets, c)); assert.equal(plan.facilityOwnershipChanges, 0); assert.deepEqual(states, before);
  const next = unwrap(commitTerritoryTransfer(states, plan)); assert.equal(next[0].claims[0].lifecycle, "superseded");
  assert.equal(next[0].claims[1].lifecycle, "active"); assert.equal(next[0].claims[2].claimantRef.uuid, "JournalEntry.buyer"); assert.equal(next[0].events.length, 3);
  assert.deepEqual(states, before); for (const s of next) assert.equal(validateTerritoryState(s).ok, true);
});
test("G6.7: batch transfer aborts all outputs when any revision is stale or selected claim is not ownership", () => {
  const states = [owned("a"), owned("b")], c = context(states[0]), targets = states.map(s => ({ territoryUuid: s.territory.uuid,
    expectedRevision: s.territory.revision, supersedeClaimIds: ["original"], newClaim: { ...claim("new"), startsAtWorldTick: c.worldTick } }));
  const plan = unwrap(previewTerritoryTransfer(states, targets, c));
  const changed = [states[0], change(states[1], { kind: "contest-claim", id: "original" })];
  assert.equal(commitTerritoryTransfer(changed, plan).ok, false); assert.equal(states[0].claims.length, 1);
  assert.equal(previewTerritoryTransfer(states, [{ ...targets[0], newClaim: claim("new", "administration") }], c).ok, false);
});
const dispute = (): TerritoryDispute => ({ schemaVersion: 1, id: "dispute", revision: 0, label: "Claim dispute", disputeType: "domain-manager:ownership",
  territoryUuids: ["JournalEntry.t"], parties: [party("a"), party("b")], claimRefs: [{ territoryUuid: "JournalEntry.t", claimId: "original" }],
  visibility: "public", lifecycle: "latent", createdAt: 0, updatedAt: 0, events: [] });
test("G6.7: disputes settle only from explicit outcome and retain history, no strength winner", () => {
  const s = owned(); let d = unwrap(validateTerritoryDispute(dispute(), [s]));
  d = unwrap(changeTerritoryDispute(d, [s], { ...context(s), expectedRevision: 0 }, "active", null));
  const c = { ...context(s), expectedRevision: d.revision, at: 3 };
  assert.equal(changeTerritoryDispute(d, [s], c, "settled", null).ok, false);
  d = unwrap(changeTerritoryDispute(d, [s], c, "settled", { type: "manual-outcome", id: "gm-result" }));
  assert.equal(d.events.length, 2); assert.equal(s.claims[0].lifecycle, "active");
  assert.equal(changeTerritoryDispute(d, [s], { ...c, expectedRevision: d.revision, eventId: "reopen", at: 4 }, "active", null).ok, false);
  assert.deepEqual(unwrap(validateTerritoryDispute(JSON.parse(JSON.stringify(d)), [s])), d);
});
test("G6.7: disputes reject orphan claims, invalid parties and forged state/history", () => {
  const s = owned(); for (const patch of [{ claimRefs: [{ territoryUuid: "JournalEntry.t", claimId: "orphan" }] },
    { territoryUuids: ["JournalEntry.missing"] }, { parties: [party("a")] }, { lifecycle: "settled" }])
    assert.equal(validateTerritoryDispute({ ...dispute(), ...patch }, [s]).ok, false);
});
test("G6.7: public projection strips private sources/history/geography and orphan recognition references", () => {
  let s = owned(); s = change(s, { kind: "claim", value: { ...claim("SECRET_CLAIM"), visibility: "secret" } });
  s = change(s, { kind: "recognition", value: { ...source("SECRET_RECOGNITION"), claimId: "SECRET_CLAIM", recognizingRef: party("x"), position: "positive" } });
  s = change(s, { kind: "influence", value: influence() });
  const projected = projectTerritoryState(s, v => v === "public")!;
  assert.equal(projected.claims.length, 1); assert.equal(projected.recognitions.length, 0); assert.equal(projected.events.length, 0);
  assert.equal(projected.influence[0].modifiers.length, 1); assert.equal(JSON.stringify(projected).includes("SECRET"), false);
  assert.equal(projectTerritoryState({ ...s, territory: { ...s.territory, visibility: "secret" } }, v => v === "public"), null);
});
test("G6.7: large multi-source state validates and projects without mutating canonical truth", () => {
  const s = { ...emptyTerritoryState(territory()), claims: Array.from({ length: 3000 }, (_, i) => claim(`claim${i}`, "ownership", `p${i}`)) };
  assert.equal(validateTerritoryState(s).ok, true); assert.equal(projectTerritoryState(s, v => v === "public")!.claims.length, 3000);
  assert.equal(s.events.length, 0);
});
