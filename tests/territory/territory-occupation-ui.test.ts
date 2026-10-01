import test from "node:test";
import assert from "node:assert/strict";
import { occupationFields, occupationReferenceIds, parseOccupationFields, parseOccupationEnd, renderOccupationFields, renderOccupationEnd, renderOccupationRequest, renderTerritoryOccupations } from "../../src/ui/domain-patterns/diplomacy/territory-occupation-form.js";
import { DiplomacyApplication, DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
import { ok } from "../../src/core/contracts/result.js";
const unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const source = { type: "manual", id: "test" }, domain = "JournalEntry.party", territory = "JournalEntry.region";
const temporal = { sourceRef: source, visibility: "public" as const, startsAtWorldTick: 0, expiresAtWorldTick: null };
const presence = [{ ...temporal, id: "p1", partyRef: { type: "domain" as const, uuid: domain }, presenceType: "domain-manager:military", active: true, amount: 10 },
  { ...temporal, id: "p2", partyRef: { type: "narrative" as const, id: "Historical" }, presenceType: "domain-manager:military", active: false, amount: null }];
const claims = [{ ...temporal, id: "control", claimantRef: { type: "domain" as const, uuid: domain }, claimType: "domain-manager:control", lifecycle: "active" as const, contested: false, strength: null, inherited: false },
  { ...temporal, id: "historical", claimantRef: { type: "domain" as const, uuid: domain }, claimType: "domain-manager:control", lifecycle: "ended" as const, contested: true, strength: null, inherited: false },
  { ...temporal, id: "ownership", claimantRef: { type: "domain" as const, uuid: domain }, claimType: "domain-manager:ownership", lifecycle: "active" as const, contested: false, strength: null, inherited: false }];
const fields = (patch = {}) => ({ ...occupationFields(), occupationPartyRef: domain, occupationPresenceIds: '["p1","p2"]', occupationControlIds: '["control"]', occupationRevision: "0", reason: "Occupation", ...patch });
const parse = (patch = {}, tick = 10) => parseOccupationFields(fields(patch), presence, claims, tick, "occupation", source);
const occupation = () => unwrap(parse()).value;
function controller(isGm = true) {
  const calls: any[] = [], api: any = {}; let fail = false;
  const target = { id: territory, revision: 0, worldTick: 10, presence, claims, occupations: [occupation()] };
  api.territory = { query: async () => ok(target), modify: async (p: any) => { calls.push(p); return fail ? { ok: false, error: { message: "Failure" } } : ok({}); } };
  api.proposals = { submit: async (p: any) => { calls.push(p); return ok({}); }, decide: async (p: any) => { calls.push(p); return ok({}); } };
  const c = new DiplomacyApplicationController(api); c.selectTab("territory"); c.select(territory); c.detail = target; c.list = { isGm }; return { c, calls, target, fail: () => fail = true };
}
test("G6 occupation UI: all five native states and optional references roundtrip", () => {
  for (const occupationLifecycle of ["established", "contested", "stable", "withdrawing", "ended"]) {
    const o = unwrap(parse({ occupationLifecycle, occupationPresenceIds: "[]", occupationControlIds: "[]" })).value;
    assert.deepEqual(unwrap(parseOccupationFields(occupationFields(o), presence, claims, 20, o.id, o.sourceRef)).value, o);
  }
});
test("G6 occupation UI: multiple references retain declaration order and historical sources", () => {
  const o = unwrap(parse({ occupationControlIds: '["historical","control"]' })).value; assert.deepEqual(o.presenceIds, ["p1", "p2"]); assert.deepEqual(o.controlClaimIds, ["historical", "control"]); assert.equal(presence[1].active, false); assert.equal(claims[1].lifecycle, "ended");
});
test("G6 occupation UI: unavailable, wrong collection and ownership claims rejected uniformly", () => {
  for (const patch of [{ occupationPresenceIds: '["secret-marker"]' }, { occupationPresenceIds: '["control"]' }, { occupationControlIds: '["ownership"]' }, { occupationControlIds: '["missing"]' }, { occupationReferencesUnavailable: "on" }]) {
    const r = parse(patch); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.code, "DM_TERRITORY_OCCUPATION_UNAVAILABLE");
  }
});
test("G6 occupation UI: malformed list, repeated reference and blank selections are distinct", () => {
  for (const s of ["", "bad", "{}", '["p1","p1"]', '[null]', '[""]', '[1]']) assert.equal(occupationReferenceIds(s).ok, false);
  assert.deepEqual(unwrap(occupationReferenceIds(undefined)), []); assert.deepEqual(unwrap(occupationReferenceIds("[]")), []);
});
test("G6 occupation UI: six party types validate origin only for embedded parties", () => {
  for (const type of ["domain", "actor", "narrative", "populationGroup", "operationalGroup", "notable"]) {
    const embedded = ["populationGroup", "operationalGroup", "notable"].includes(type), ref = type === "actor" ? "Actor.p" : type === "domain" ? domain : "party";
    const o = unwrap(parse({ occupationPartyType: type, occupationPartyRef: ref, occupationDomainUuid: embedded ? domain : "" })).value; assert.equal(o.occupierRef.type, type);
    assert.equal(parse({ occupationPartyType: type, occupationPartyRef: ref, occupationDomainUuid: embedded ? "" : domain }).ok, false);
  }
});
test("G6 occupation UI: invalid party, state and visibility reject before sending", () => {
  for (const p of [{ occupationPartyRef: "" }, { occupationPartyType: "other" }, { occupationLifecycle: "active" }, { occupationVisibility: "private" }]) assert.equal(parse(p).ok, false);
});
test("G6 occupation UI: explicit clock inclusive start and exclusive end preserve zero", () => {
  assert.equal(unwrap(parse()).value.startsAtWorldTick, 10); assert.equal(unwrap(parse({ occupationStarts: "0", occupationExpires: "1" })).value.startsAtWorldTick, 0);
  for (const p of [{ occupationStarts: "-1" }, { occupationStarts: "0.5" }, { occupationExpires: "10" }, { occupationExpires: String(Number.MAX_SAFE_INTEGER + 1) }, { occupationExpires: "bad" }]) assert.equal(parse(p).ok, false);
  assert.equal(parseOccupationFields(fields({ occupationStarts: "0" }), presence, claims, undefined as any, "occupation", source).ok, false);
});
test("G6 occupation UI: ending admits only projected source and keeps terminal record selectable", () => {
  assert.deepEqual(unwrap(parseOccupationEnd({ occupationId: "occupation" }, [{ ...occupation(), lifecycle: "ended" }])), { kind: "end-occupation", id: "occupation" });
  for (const occupationId of ["secret-marker", "", "missing"]) assert.equal(parseOccupationEnd({ occupationId }, [occupation()]).ok, false);
});
test("G6 occupation UI: rendering escapes user text without reflecting unavailable reference markers", () => {
  const html = renderOccupationFields(presence, claims, fields({ occupationPartyRef: '<script>"', occupationPresenceIds: '["secret-marker"]' }));
  assert.equal(html.includes("<script>"), false); assert.equal(html.includes("secret-marker"), false); assert.equal(html.includes('value="ownership"'), false); assert.ok(html.includes("occupationReferencesUnavailable")); assert.ok(html.includes("multiple"));
  assert.equal(renderOccupationRequest({ kind: "end-occupation", id: "<script>" }).includes("<script>"), false);
});
test("G6 occupation UI: unavailable selection remains a blocking flag until explicit reset", () => {
  const h = renderOccupationFields(presence, claims, fields({ occupationReferencesUnavailable: "on", occupationPresenceIds: "[]" })); assert.ok(h.includes("Limpe o rascunho")); assert.equal(parse({ occupationReferencesUnavailable: "on", occupationPresenceIds: "[]" }).ok, false);
});
test("G6 occupation UI: overview shows all states, scheduled and expired independently of recorded status", () => {
  const occupations = [{ ...occupation(), id: "ended", lifecycle: "ended" }, { ...occupation(), id: "future", startsAtWorldTick: 11 }, { ...occupation(), id: "expired", expiresAtWorldTick: 10 }, occupation()];
  const html = renderTerritoryOccupations({ revision: 0, occupations, presence, claims }, 10, false, {}, {}); assert.ok(html.includes("4 registros visíveis; 1 não encerrados")); assert.ok(html.includes("1 Encerrada")); assert.ok(html.includes("Agendada")); assert.ok(html.includes("Expirada")); assert.ok(html.includes("Enviar proposta ao GM"));
});
test("G6 occupation UI: GM mutation versus Player proposal, reason and revision validation", async () => {
  for (const isGm of [true, false]) { const { c, calls } = controller(isGm); unwrap(await c.submitOccupation(fields())); const intent = isGm ? calls[0] : calls[0].intent; assert.equal(intent.action.kind, "occupation"); assert.equal(intent.action.value.presenceIds.length, 2); }
  const { c, calls } = controller(); assert.equal((await c.submitOccupation(fields({ occupationRevision: "1" }))).ok, false); assert.equal((await c.submitOccupation(fields({ reason: " " }))).ok, false); assert.equal(calls.length, 0); assert.equal(c.occupationDraft.reason, " ");
});
test("G6 occupation UI: failed source keeps ID/draft and context/reset clears it", async () => {
  const { c, calls, fail } = controller(); fail(); await c.submitOccupation(fields()); await c.submitOccupation(fields()); assert.equal(calls[0].action.value.id, calls[1].action.value.id); c.resetOccupationDrafts(); assert.deepEqual(c.occupationDraft, {}); c.select("JournalEntry.other"); assert.deepEqual(c.occupationEndDraft, {});
});
test("G6 occupation UI: GM structured review preserves identity/source; end target cannot be substituted", async () => {
  const { c, calls, target } = controller(); c.selectTab("proposals"); c.list = { isGm: true }; const original = { kind: "territory", mode: "modify", id: territory, expectedRevision: 0, reason: "Original", action: { kind: "occupation", value: occupation() } };
  c.detail = { id: "proposal", revision: 0, original }; c.occupationReviewTarget = target;
  unwrap(await c.review("approve", "Revised", { ...fields({ occupationLifecycle: "withdrawing", occupationControlIds: "[]" }), occupationReview: "on" })); assert.equal(calls[0].editedIntent.action.value.id, "occupation"); assert.deepEqual(calls[0].editedIntent.action.value.sourceRef, source); assert.equal(calls[0].editedIntent.action.value.lifecycle, "withdrawing"); assert.equal(original.action.value.lifecycle, "established");
  c.detail = { id: "end", revision: 0, original: { ...original, action: { kind: "end-occupation", id: "occupation" } } }; unwrap(await c.review("approve", "End", { occupationReview: "on", occupationId: "secret-other" })); assert.equal(calls[1].editedIntent.action.id, "occupation");
});
test("G6 occupation UI: unavailable target blocks approval but rejection does not require target or form validity", async () => {
  const { c, calls } = controller(); c.selectTab("proposals"); c.list = { isGm: true }; c.detail = { id: "proposal", revision: 0, original: { kind: "territory", mode: "modify", id: territory, expectedRevision: 0, action: { kind: "occupation", value: occupation() } } };
  assert.equal((await c.review("approve", "GM", { occupationReview: "on" })).ok, false); unwrap(await c.review("reject", "Invalid", { occupationReview: "on", occupationPresenceIds: "bad" })); assert.equal(calls[0].decision, "reject"); assert.equal(calls[0].editedIntent, undefined);
});
test("G6 occupation bindings: multiple selections, drafts, review, ending and reset route correctly", async () => {
  const { c, calls, target } = controller(), app = new DiplomacyApplication({ api: c.api }), listeners: Record<string, Function> = {}, saved = globalThis.FormData;
  app.controller.selectTab("territory"); app.controller.select(territory); app.controller.detail = target; app.controller.list = c.list;
  (app as any).element = { addEventListener: (e: string, fn: Function) => listeners[e] = fn }; (app as any).render = async () => {};
  (globalThis as any).FormData = class { constructor(readonly form: any) {} forEach(fn: Function) { Object.entries(this.form.values).forEach(([k, v]) => (Array.isArray(v) ? v : [v]).forEach(value => fn(value, k))); } getAll(k: string) { const v = this.form.values[k]; return v === undefined ? [] : Array.isArray(v) ? v : [v]; } };
  const form: any = { dataset: { dmForm: "territory-occupation" }, values: { ...fields(), occupationPresenceIds: ["p1", "p2"], occupationControlIds: ["control"] } };
  try { (app as any)._onRender(); listeners.input({ target: { closest: () => form } }); assert.equal(app.controller.occupationDraft.occupationPresenceIds, '["p1","p2"]'); await listeners.submit({ target: form, preventDefault() {} }); assert.deepEqual(calls[0].action.value.presenceIds, ["p1", "p2"]);
    await listeners.submit({ target: { dataset: { dmForm: "territory-occupation-end" }, values: { occupationId: "occupation", occupationRevision: "0", reason: "End" } }, preventDefault() {} }); assert.equal(calls[1].action.kind, "end-occupation");
    app.controller.selectTab("proposals"); app.controller.list = { isGm: true }; app.controller.detail = { id: "proposal", revision: 0, original: { kind: "territory", mode: "modify", id: territory, expectedRevision: 0, action: calls[0].action, reason: "Requested" } }; app.controller.occupationReviewTarget = target;
    const reviewForm: any = { dataset: { dmForm: "review" }, values: { ...form.values, occupationReview: "on", occupationControlIds: [], reason: "Reviewed" }, querySelector: () => true };
    listeners.input({ target: { closest: () => reviewForm } }); assert.equal(app.controller.occupationReviewFields.occupationControlIds, "[]");
    reviewForm.values.occupationReferencesUnavailable = "on";
    await listeners.click({ target: { closest: () => ({ dataset: { dmOccupationReviewReset: "true" }, closest: () => reviewForm }) } }); assert.equal(app.controller.occupationReviewFields.occupationReferencesUnavailable, undefined); assert.equal(app.controller.occupationReviewFields.occupationPresenceIds, "[]"); delete reviewForm.values.occupationReferencesUnavailable;
    await listeners.submit({ target: reviewForm, submitter: { value: "approve" }, preventDefault() {} }); assert.deepEqual(calls[2].editedIntent.action.value.controlClaimIds, []);
    await listeners.click({ target: { closest: () => ({ dataset: { dmOccupationReset: "true" } }) } }); assert.deepEqual(app.controller.occupationDraft, {});
  } finally { (globalThis as any).FormData = saved; }
});
