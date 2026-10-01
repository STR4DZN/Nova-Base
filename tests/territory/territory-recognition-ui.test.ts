import test from "node:test";
import assert from "node:assert/strict";
import { ok, type Result } from "../../src/core/contracts/result.js";
import { createDiplomacyDraft } from "../../src/diplomacy/diplomacy-drafts.js";
import { territoryOwner } from "../../src/territory/territory-owner.js";
import { recognitionFields, parseRecognitionFields, renderRecognitionFields, renderRecognitionRequest, renderTerritoryRecognitions } from "../../src/ui/domain-patterns/diplomacy/territory-recognition-form.js";
import { DiplomacyApplicationController, DiplomacyApplication } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
import type { TerritoryState, TerritoryClaim } from "../../src/territory/territory-state.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const source = { id: "claim", sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 0, expiresAtWorldTick: null } as const;
const claim: TerritoryClaim = { ...source, claimType: "domain-manager:ownership", claimantRef: { type: "narrative", id: "Guild" }, lifecycle: "active", contested: false, strength: null, inherited: false };
const fields = (patch = {}) => ({ ...recognitionFields(), recognitionClaimId: "claim", recognitionPartyRef: "JournalEntry.domain", reason: "Recognize", recognitionRevision: "0", ...patch });
const parse = (patch = {}, claims = [claim], tick = 10) => parseRecognitionFields(fields(patch), claims, tick, "recognition", { type: "manual", id: "ui" });
const data = (): TerritoryState => ({ ...createDiplomacyDraft("territory", "Region", [], "public").data as TerritoryState, claims: [claim] });
function controller(isGm = true) {
  let target: any = unwrap(territoryOwner.project(data(), { isGm, canSee: v => isGm || v === "public", at: 1, worldTick: 10, historyOffset: 0, historyLimit: 0 }));
  let fail = false; const calls: any[] = [], api: any = {};
  for (const tab of ["territory", "proposals", "relations", "agreements", "reputation", "disputes"]) api[tab] = {
    query: async (q: any) => { calls.push({ tab, mode: "query", q }); return fail ? { ok: false, error: { code: "FAIL", message: "Unavailable", severity: "error" } } : ok(q.id ? target : { items: [], isGm, worldTick: 10, total: 0 }); },
    modify: async (p: any) => { calls.push({ tab, mode: "modify", p }); return fail ? { ok: false, error: { code: "FAIL", message: "Unavailable", severity: "error" } } : ok({}); }
  };
  api.proposals.submit = async (p: any) => { calls.push({ mode: "submit", p }); return fail ? { ok: false, error: { code: "FAIL", message: "Unavailable", severity: "error" } } : ok({}); };
  api.proposals.decide = async (p: any) => { calls.push({ mode: "decide", p }); return ok({}); };
  const c = new DiplomacyApplicationController(api); c.selectTab("territory"); c.select(target.id); c.detail = target; c.list = { isGm, worldTick: 10 };
  return { c, calls, fail: () => fail = true, target: (d: any) => target = d, original: target };
}
test("G6 recognition UI: positive, negative and unknown actions carry explicit independent context", () => {
  for (const position of ["positive", "negative", "unknown"]) { const d = unwrap(parse({ recognitionPosition: position })); assert.equal(d.kind, "recognition"); assert.equal(d.value.position, position); assert.equal(d.value.claimId, "claim"); assert.equal(d.value.startsAtWorldTick, 10); assert.equal(d.value.expiresAtWorldTick, null); assert.deepEqual(d.value.recognizingRef, { type: "domain", uuid: "JournalEntry.domain" }); }
});
test("G6 recognition UI: all six supported party types retain ID/UUID and embedded Domain context", () => {
  for (const [type, ref] of [["domain", "JournalEntry.domain"], ["actor", "Actor.actor"], ["narrative", "Guild"], ["populationGroup", "population"], ["operationalGroup", "group"], ["notable", "notable"]]) {
    const embedded = ["populationGroup", "operationalGroup", "notable"].includes(type), d = unwrap(parse({ recognitionPartyType: type, recognitionPartyRef: ref, recognitionDomainUuid: embedded ? "JournalEntry.domain" : "" }));
    assert.equal(d.value.recognizingRef.type, type); assert.equal(d.value.recognizingRef.domainUuid, embedded ? "JournalEntry.domain" : undefined);
    assert.equal(d.value.recognizingRef[type === "domain" || type === "actor" ? "uuid" : "id"], ref);
  }
});
test("G6 recognition UI: malformed party type, UUID, missing People Domain and non-People origin reject", () => {
  for (const patch of [{ recognitionPartyType: "User", recognitionPartyRef: "User.player" }, { recognitionPartyType: "domain", recognitionPartyRef: "Actor.actor" },
    { recognitionPartyType: "actor", recognitionPartyRef: "JournalEntry.domain" }, { recognitionPartyRef: "" }, { recognitionPartyType: "notable" },
    { recognitionPartyType: "notable", recognitionDomainUuid: "Actor.actor" }, { recognitionDomainUuid: "JournalEntry.domain" }, { recognitionPartyType: "future:provider" }]) assert.equal(parse(patch).ok, false);
});
test("G6 recognition UI: tick zero, blank start clock, exclusive expiry and safe integers validate without guessed zero", () => {
  assert.equal(unwrap(parse({ recognitionStarts: "0", recognitionExpires: "1" })).value.startsAtWorldTick, 0);
  assert.equal(unwrap(parse({ recognitionStarts: "" }, [claim], 0)).value.startsAtWorldTick, 0);
  assert.equal(unwrap(parse({ recognitionStarts: String(Number.MAX_SAFE_INTEGER) })).value.startsAtWorldTick, Number.MAX_SAFE_INTEGER);
  for (const patch of [{ recognitionStarts: "-1" }, { recognitionStarts: "1.5" }, { recognitionExpires: "10" }, { recognitionExpires: "0" }, { recognitionExpires: "bad" }, { recognitionStarts: String(Number.MAX_SAFE_INTEGER + 1) }]) assert.equal(parse(patch).ok, false);
  assert.equal(parseRecognitionFields(fields(), [claim], undefined as any, "recognition", { type: "manual", id: "ui" }).ok, false);
});
test("G6 recognition UI: selection only uses admitted claims, including visible historical claims", () => {
  assert.equal(parse({ recognitionClaimId: "secret-claim-marker" }).ok, false); assert.equal(parse({}, []).ok, false);
  assert.ok(parse({}, [{ ...claim, lifecycle: "ended" }]).ok); assert.ok(parse({}, [{ ...claim, lifecycle: "superseded" }]).ok);
  assert.equal(parse({ recognitionPosition: "yes" }).ok, false); assert.equal(parse({ recognitionVisibility: "private" }).ok, false);
});
test("G6 recognition UI: field roundtrip preserves embedded scope, unknown position, tick zero and nullable expiry", () => {
  const r = unwrap(parse({ recognitionPartyType: "notable", recognitionPartyRef: "n1", recognitionDomainUuid: "JournalEntry.domain", recognitionStarts: "0", recognitionVisibility: "restricted" })).value;
  assert.deepEqual(unwrap(parseRecognitionFields(recognitionFields(r), [claim], 10, r.id, r.sourceRef)).value, r); assert.equal(recognitionFields().recognitionPosition, "unknown");
  assert.ok(renderRecognitionFields([claim], {}).includes("<details><summary>Visibilidade e vigência"));
  assert.ok(renderRecognitionFields([claim], recognitionFields(r)).includes("<details open><summary>Domínio de origem para grupos"));
});
test("G6 recognition UI: current counts reflect declaration windows and never combine positions into legitimacy", () => {
  const r = unwrap(parse()).value, d: any = { id: "T", revision: 0, claims: [claim], recognitions: [
    { ...r, id: "yes", position: "positive", startsAtWorldTick: 0, expiresAtWorldTick: 10 }, { ...r, id: "no", position: "negative", startsAtWorldTick: 10 },
    { ...r, id: "unknown", position: "unknown", startsAtWorldTick: 11 }] };
  const h = renderTerritoryRecognitions(d, 10, false, {}); assert.ok(h.includes("0 reconhecem · 1 não reconhecem · 0 sem posição")); assert.ok(h.includes("Agendada")); assert.ok(h.includes("Expirada")); assert.ok(h.includes("Vigente")); assert.ok(h.includes("sem votação")); assert.ok(h.includes("Propor reconhecimento ao GM"));
});
test("G6 recognition UI: authority projection removes secret declarations and public recognition of hidden claims before cards", () => {
  const s = data(), r = unwrap(parse()).value;
  const d = { ...s, claims: [...s.claims, { ...claim, id: "secret-claim-marker", visibility: "secret" }], recognitions: [r, { ...r, id: "hidden-declaration-marker", visibility: "secret" }, { ...r, id: "hidden-target-marker", claimId: "secret-claim-marker" }] };
  const projected: any = unwrap(territoryOwner.project(d, { isGm: false, canSee: v => v === "public", at: 1, worldTick: 10, historyOffset: 0, historyLimit: 0 }));
  assert.equal(projected.worldTick, 10); assert.equal(projected.recognitions.length, 1); const h = renderTerritoryRecognitions(projected, 10, false, {});
  for (const marker of ["secret-claim-marker", "hidden-declaration-marker", "hidden-target-marker"]) assert.equal(h.includes(marker), false); assert.ok(h.includes("1 declarações visíveis"));
});
test("G6 recognition UI: forms, requests and draft fields escape markup, attributes and private unavailable selection", () => {
  const r = unwrap(parse({ recognitionPartyType: "narrative", recognitionPartyRef: "<script>Guild</script>" })).value;
  const h = renderRecognitionRequest({ ...r, claimId: '<b>claim</b>' }) + renderRecognitionFields([{ ...claim, id: '\" onclick=\"bad' }], { ...fields(), recognitionPartyRef: '\" onclick=\"bad', recognitionClaimId: "secret-selection-marker" });
  assert.equal(h.includes("<script>"), false); assert.equal(h.includes("<b>claim</b>"), false); assert.ok(h.includes("&quot;")); assert.equal(h.includes("secret-selection-marker"), false); assert.ok(h.includes("seleção anterior está indisponível"));
});
test("G6 recognition UI: empty projected claims disable entry without pretending no canonical recognition exists", () => {
  const h = renderTerritoryRecognitions({ revision: 0, claims: [], recognitions: [] }, 0, true, {}); assert.ok(h.includes("Nenhuma declaração de reconhecimento visível")); assert.ok(h.includes("Adicione uma reivindicação visível")); assert.equal(h.includes('data-dm-form="territory-recognition"'), false);
});
test("G6 recognition UI: GM submits semantic owner mutation, Player submits immutable-intent proposal, neither changes local claims", async () => {
  for (const isGm of [true, false]) { const { c, calls, original } = controller(isGm), before = structuredClone(original); unwrap(await c.submitRecognition(fields()));
    const call = calls.at(-1); assert.equal(call.mode, isGm ? "modify" : "submit"); const p = isGm ? call.p : call.p.intent;
    assert.equal(p.expectedRevision, 0); assert.equal(p.action.kind, "recognition"); assert.equal(p.action.value.claimId, "claim"); assert.equal(p.reason, "Recognize"); assert.deepEqual(original, before); assert.deepEqual(c.territoryRecognitionFields, {}); }
});
test("G6 recognition UI: invalid input and failed send keep complete draft and stable declaration ID", async () => {
  const { c, calls, fail } = controller(); assert.equal((await c.submitRecognition(fields({ recognitionExpires: "5" }))).ok, false); assert.equal(c.territoryRecognitionFields.recognitionExpires, "5"); assert.equal(calls.length, 0);
  fail(); assert.equal((await c.submitRecognition(fields())).ok, false); const id = calls.at(-1).p.action.value.id;
  assert.equal((await c.submitRecognition(fields())).ok, false); assert.equal(calls.at(-1).p.action.value.id, id); assert.equal(c.territoryRecognitionFields.reason, "Recognize");
});
test("G6 recognition UI: stale form revision and absent reason reject locally without replacing retained draft", async () => {
  const { c, calls } = controller(); c.detail = { ...c.detail, revision: 1 };
  assert.equal((await c.submitRecognition(fields())).ok, false); assert.equal(c.territoryRecognitionFields.recognitionRevision, "0"); assert.equal(calls.length, 0);
  c.resetRecognitionDraft(); assert.equal((await c.submitRecognition(fields({ recognitionRevision: "1", reason: " " }))).ok, false); assert.equal(calls.length, 0);
});
test("G6 recognition UI: switching entity/tab clears drafts and stale detail read removes old form", async () => {
  const { c, fail } = controller(); c.territoryRecognitionFields = fields(); c.recognitionReviewFields = { reason: "Old" }; c.select("Other"); assert.deepEqual(c.territoryRecognitionFields, {}); assert.deepEqual(c.recognitionReviewFields, {});
  c.territoryRecognitionFields = fields(); c.selectTab("relations"); assert.deepEqual(c.territoryRecognitionFields, {}); c.selectTab("territory"); fail(); assert.equal((await c.load()).ok, false); assert.equal(c.detail, null); assert.equal(c.list, null); assert.equal(c.render().includes('data-dm-form="territory-recognition"'), false);
});
test("G6 recognition UI: GM structured review edits recognition only and preserves original source/identity", async () => {
  const { c, calls, original: target } = controller(), original = { kind: "territory", mode: "modify", id: target.id, expectedRevision: 0, action: unwrap(parse()), reason: "Original request" };
  c.selectTab("proposals"); c.detail = { id: "proposal", revision: 0, lifecycle: "pending", original }; c.list = { isGm: true }; c.recognitionReviewTarget = target;
  const before = structuredClone(original); unwrap(await c.review("approve", "GM decision", { ...fields({ recognitionPosition: "negative" }), recognitionReview: "on", targetRevision: "1" }));
  const p = calls.at(-1).p; assert.equal(p.editedIntent.action.value.position, "negative"); assert.equal(p.editedIntent.expectedRevision, 1); assert.equal(p.editedIntent.action.value.id, original.action.value.id); assert.deepEqual(p.editedIntent.action.value.sourceRef, original.action.value.sourceRef); assert.deepEqual(original, before); assert.deepEqual(c.recognitionReviewFields, {});
});
test("G6 recognition UI: invalid review remains editable, rejection bypasses declaration checks but needs reason", async () => {
  const { c, calls, original: target } = controller(); c.selectTab("proposals"); c.detail = { id: "proposal", revision: 0, lifecycle: "pending", original: { kind: "territory", mode: "modify", id: target.id, action: unwrap(parse()) } }; c.list = { isGm: true }; c.recognitionReviewTarget = target;
  const f = { ...fields({ recognitionPosition: "bad" }), recognitionReview: "on" }; assert.equal((await c.review("approve", "Decision", f)).ok, false); assert.equal(c.recognitionReviewFields.recognitionPosition, "bad"); assert.equal(calls.length, 0);
  c.recognitionReviewTarget = null; assert.equal((await c.review("reject", " ", f)).ok, false); unwrap(await c.review("reject", "Reject", f)); assert.equal(calls.at(-1).p.decision, "reject"); assert.equal(Object.hasOwn(calls.at(-1).p, "editedIntent"), false);
});
test("G6 recognition UI: application binds recognition form and reset without invoking generic preview", async () => {
  const { c } = controller(), app = new DiplomacyApplication({ api: c.api }), listeners: Record<string, Function> = {}, saved = globalThis.FormData;
  app.controller.selectTab("territory"); app.controller.select(c.detail.id); app.controller.detail = c.detail; app.controller.list = c.list;
  (app as any).element = { addEventListener: (e: string, fn: Function) => listeners[e] = fn }; let renders = 0; (app as any).render = async () => { renders++; };
  (globalThis as any).FormData = class { constructor(readonly form: any) {} forEach(fn: Function) { Object.entries(this.form.values).forEach(([k, v]) => fn(v, k)); } };
  try { app._onRender(); await listeners.submit({ target: { dataset: { dmForm: "territory-recognition" }, values: fields({ recognitionExpires: "5" }) }, preventDefault() {} }); assert.equal(app.controller.territoryRecognitionFields.recognitionExpires, "5");
    await listeners.click({ target: { closest: () => ({ dataset: { dmRecognitionReset: "true" } }) } }); assert.deepEqual(app.controller.territoryRecognitionFields, {}); assert.equal(renders, 2);
  } finally { globalThis.FormData = saved; }
});
