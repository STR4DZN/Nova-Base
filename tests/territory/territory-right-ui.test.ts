import test from "node:test";
import assert from "node:assert/strict";
import { rightFields, parseRightFields, parseRightRevocation, changeRightConditionRows, renderRightFields, renderRightRevocation, renderRightRequest, renderTerritoryRightForms } from "../../src/ui/domain-patterns/diplomacy/territory-right-form.js";
import { DiplomacyApplication, DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
import { ok } from "../../src/core/contracts/result.js";
const unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const source = { type: "manual", id: "form" }, domain = "JournalEntry.party", territory = "JournalEntry.region";
const fields = (patch = {}) => ({ ...rightFields(), rightPartyRef: domain, rightRevision: "0", reason: "Concessão", ...patch });
const parse = (patch = {}, tick = 10) => parseRightFields(fields(patch), tick, "right", source);
const right = () => unwrap(parse()).value;
function controller(isGm = true) {
  const calls: any[] = [], api: any = {}; let fail = false;
  const target = { id: territory, revision: 0, worldTick: 10, rights: [right()] };
  api.territory = { query: async (p: any) => ok(p.id ? target : { items: [], total: 0, isGm }), modify: async (p: any) => { calls.push(p); return fail ? { ok: false, error: { message: "Failure" } } : ok({}); } };
  api.proposals = { submit: async (p: any) => { calls.push(p); return ok({}); }, decide: async (p: any) => { calls.push(p); return ok({}); }, query: async (p: any) => ok(p.id ? c.detail : { items: [], isGm }) };
  const c = new DiplomacyApplicationController(api); c.selectTab("territory"); c.select(territory); c.detail = target; c.list = { isGm }; return { c, calls, target, fail: () => fail = true };
}
test("G6 rights UI: six canonical beneficiary types validate embedded origins", () => {
  for (const type of ["domain", "actor", "narrative", "populationGroup", "operationalGroup", "notable"]) {
    const embedded = ["populationGroup", "operationalGroup", "notable"].includes(type), ref = type === "actor" ? "Actor.p" : type === "domain" ? domain : "party";
    const r = unwrap(parse({ rightPartyType: type, rightPartyRef: ref, rightDomainUuid: embedded ? domain : "" })).value; assert.equal(r.beneficiaryRef.type, type);
    assert.equal(parse({ rightPartyType: type, rightPartyRef: ref, rightDomainUuid: embedded ? "" : domain }).ok, false);
  }
  for (const p of [{ rightPartyRef: "" }, { rightPartyType: "unsupported" }, { rightPartyRef: "bad" }]) assert.equal(parse(p).ok, false);
});
test("G6 rights UI: all source flags and custom namespaced types roundtrip", () => {
  for (const rightInherited of ["true", "false"]) for (const rightRevocable of ["true", "false"]) for (const rightActive of ["true", "false"]) {
    const r = unwrap(parse({ rightInherited, rightRevocable, rightActive, rightType: "addon:passage" })).value;
    assert.deepEqual(unwrap(parseRightFields(rightFields(r), 20, r.id, r.sourceRef)).value, r);
  }
  for (const p of [{ rightType: "trade" }, { rightActive: "on" }, { rightInherited: "" }, { rightRevocable: "maybe" }, { rightVisibility: "private" }]) assert.equal(parse(p).ok, false);
});
test("G6 rights UI: explicit zero and blank authoritative tick have exclusive expiry", () => {
  assert.equal(unwrap(parse()).value.startsAtWorldTick, 10); assert.equal(unwrap(parse({ rightStarts: "0", rightExpires: "1" })).value.startsAtWorldTick, 0);
  for (const p of [{ rightStarts: "-1" }, { rightStarts: ".5" }, { rightStarts: "NaN" }, { rightExpires: "10" }, { rightExpires: "-1" }, { rightExpires: "Infinity" }, { rightExpires: String(Number.MAX_SAFE_INTEGER + 1) }]) assert.equal(parse(p).ok, false);
  assert.equal(parseRightFields(fields(), undefined as any, "right", source).ok, false); assert.equal(parseRightFields(fields(), 10, "", source).ok, false); assert.equal(parseRightFields(fields(), 10, "right", { type: "manual", uuid: "bad" }).ok, false);
});
const conditionFields = { rightConditionCount: "2", rightConditionType0: "policy", rightConditionMode0: "id", rightConditionValue0: "permit", rightConditionType1: "document", rightConditionMode1: "uuid", rightConditionValue1: "JournalEntry.condition" };
test("G6 rights UI: typed ID and UUID conditions and declared grants roundtrip without execution", () => {
  const r = unwrap(parse({ ...conditionFields, rightGrants: " addon:entry \r\n\naddon:trade " })).value;
  assert.deepEqual(r.conditionRefs, [{ type: "policy", id: "permit" }, { type: "document", uuid: "JournalEntry.condition" }]); assert.deepEqual(r.grants, ["addon:entry", "addon:trade"]);
  assert.deepEqual(unwrap(parseRightFields(rightFields(r), 30, r.id, r.sourceRef)).value, r); assert.deepEqual(unwrap(parse()).value.grants, []);
});
test("G6 rights UI: malformed, duplicate and incomplete conditions or capacities fail before send", () => {
  for (const p of [{ rightConditionCount: "-1" }, { rightConditionCount: "1.5" }, { rightConditionCount: "101" }, { rightConditionCount: "1" }, { ...conditionFields, rightConditionMode0: "both" }, { ...conditionFields, rightConditionValue1: "not-uuid" }, { ...conditionFields, rightConditionType1: "policy", rightConditionMode1: "id", rightConditionValue1: "permit" }, { rightGrants: "addon:a\naddon:a" }, { rightGrants: "addon:a,addon:b" }]) assert.equal(parse(p).ok, false);
});
test("G6 rights UI: row add/remove reindexes without losing unsaved fields", () => {
  const f = fields(conditionFields), added = changeRightConditionRows(f); assert.equal(added.rightConditionCount, "3"); assert.equal(added.rightConditionValue1, "JournalEntry.condition");
  const removed = changeRightConditionRows(added, 0); assert.equal(removed.rightConditionCount, "2"); assert.equal(removed.rightConditionValue0, "JournalEntry.condition"); assert.equal(removed.rightConditionValue1, ""); assert.equal(removed.reason, f.reason); assert.equal(removed.rightConditionValue2, undefined);
  assert.deepEqual(changeRightConditionRows(f, 8), f); assert.deepEqual(changeRightConditionRows({ ...f, rightConditionCount: "bad" }), { ...f, rightConditionCount: "bad" });
});
test("G6 rights UI: revocation only accepts visible local active revocable records", () => {
  const rights = [right(), { ...right(), id: "inactive", active: false }, { ...right(), id: "permanent", revocable: false }];
  assert.deepEqual(unwrap(parseRightRevocation({ rightId: "right" }, rights)), { kind: "revoke-right", id: "right" });
  for (const rightId of ["inactive", "permanent", "inherited", "agreement", "missing", ""]) assert.equal(parseRightRevocation({ rightId }, rights).ok, false);
  const html = renderRightRevocation(rights, { rightId: "hidden-marker" }); assert.equal(html.includes('value="inactive"'), false); assert.equal(html.includes('value="permanent"'), false); assert.equal(html.includes("hidden-marker"), false);
});
test("G6 rights UI: user text escaped in fields, conditions and summaries", () => {
  const r = { ...right(), beneficiaryRef: { type: "narrative", id: '<script>"' }, conditionRefs: [{ type: "test", id: "<img>" }], grants: ["<script>"] };
  for (const html of [renderRightFields({ ...rightFields(r), rightType: '<script>"' }), renderRightRequest({ kind: "right", value: r }), renderRightRequest({ kind: "revoke-right", id: "<script>" })]) { assert.equal(html.includes("<script>"), false); assert.equal(html.includes("<img>"), false); }
});
test("G6 rights UI: contextual forms separate grants and revocation from inherited sources", () => {
  const html = renderTerritoryRightForms({ revision: 2, rights: [], territoryRights: { entries: [{ rightId: "inherited-marker" }] } }, false, { rightRevision: "1" }, {});
  assert.ok(html.includes('data-dm-form="territory-right"')); assert.ok(html.includes('data-dm-form="territory-right-revoke"')); assert.ok(html.includes("rascunho: 1")); assert.ok(html.includes("Enviar proposta ao GM")); assert.equal(html.includes("inherited-marker"), false);
});
test("G6 rights UI: GM modifies and Player proposes; generic duplicate actions removed", async () => {
  for (const isGm of [true, false]) { const { c, calls } = controller(isGm); unwrap(await c.submitRight(fields())); const intent = isGm ? calls[0] : calls[0].intent; assert.equal(intent.action.kind, "right"); assert.deepEqual(intent.action.value.beneficiaryRef, { type: "domain", uuid: domain }); assert.equal(c.actionForm().includes('<option value="right">'), false); unwrap(await c.submitRight({ rightId: "right", rightRevision: "0", reason: "Revogar" }, true)); assert.equal((isGm ? calls[1] : calls[1].intent).action.kind, "revoke-right"); }
});
test("G6 rights UI: failed request retains stable ID, draft and bound revision until explicit reset", async () => {
  const { c, calls, target, fail } = controller(); fail(); await c.submitRight(fields()); await c.submitRight(fields()); assert.equal(calls[0].action.value.id, calls[1].action.value.id);
  target.revision = 1; assert.equal((await c.submitRight(fields())).ok, false); assert.equal(calls.length, 2); assert.equal(c.rightDraft.rightRevision, "0");
  assert.equal((await c.submitRight(fields({ rightRevision: "1", reason: " " }))).ok, false); c.resetRightDrafts(); assert.deepEqual(c.rightDraft, {}); c.select("JournalEntry.other"); assert.deepEqual(c.rightRevokeDraft, {});
});
test("G6 rights UI: structured GM grant review preserves original ID/source and requires fresh revision", async () => {
  const { c, calls, target } = controller(); c.selectTab("proposals"); c.list = { isGm: true }; target.revision = 1;
  const original = { kind: "territory", mode: "modify", id: territory, expectedRevision: 0, reason: "Original", action: { kind: "right", value: right() } };
  c.detail = { id: "proposal", revision: 0, original }; c.rightReviewTarget = target;
  assert.equal((await c.review("approve", "GM", { ...fields(), rightReview: "on" })).ok, false);
  unwrap(await c.review("approve", "GM", { ...fields({ ...conditionFields, rightType: "addon:trade" }), rightReview: "on", targetRevision: "1" }));
  assert.equal(calls[0].editedIntent.expectedRevision, 1); assert.equal(calls[0].editedIntent.action.value.id, "right"); assert.deepEqual(calls[0].editedIntent.action.value.sourceRef, source); assert.equal(calls[0].editedIntent.action.value.conditionRefs.length, 2); assert.equal(original.action.value.rightType, "domain-manager:entry");
});
test("G6 rights UI: fixed revocation review cannot substitute source; rejection works without target", async () => {
  const { c, calls, target } = controller(); c.selectTab("proposals"); c.list = { isGm: true };
  c.detail = { id: "proposal", revision: 0, original: { kind: "territory", mode: "modify", id: territory, expectedRevision: 0, action: { kind: "revoke-right", id: "right" } } }; c.rightReviewTarget = target;
  unwrap(await c.review("approve", "GM", { rightReview: "on", rightId: "other" })); assert.equal(calls[0].editedIntent.action.id, "right");
  c.rightReviewTarget = null; assert.equal((await c.review("approve", "GM", { rightReview: "on" })).ok, false); unwrap(await c.review("reject", "Unavailable", { rightReview: "on", rightConditionCount: "bad" })); assert.equal(calls[1].editedIntent, undefined);
});
test("G6 rights UI: pending review loads fresh target and failure clears target while preserving draft", async () => {
  const { c, target } = controller(); c.selectTab("proposals"); c.select("proposal"); c.detail = { id: "proposal", lifecycle: "pending", revision: 0, original: { kind: "territory", mode: "modify", id: territory, expectedRevision: 0, action: { kind: "right", value: right() } } };
  c.rightReviewFields = { rightType: "addon:draft" }; unwrap(await c.load()); assert.equal(c.rightReviewTarget, target); (c.api.territory as any).query = async () => ({ ok: false, error: { message: "Missing" } }); unwrap(await c.load()); assert.equal(c.rightReviewTarget, null); assert.equal(c.rightReviewFields.rightType, "addon:draft");
});
test("G6 rights bindings: drafts, condition rows, grant, revocation, structured review and reset route", async () => {
  const { c, calls, target } = controller(), app = new DiplomacyApplication({ api: c.api }), listeners: Record<string, Function> = {}, saved = globalThis.FormData;
  app.controller.selectTab("territory"); app.controller.select(territory); app.controller.detail = target; app.controller.list = c.list;
  (app as any).element = { addEventListener: (e: string, fn: Function) => listeners[e] = fn }; (app as any).render = async () => {};
  (globalThis as any).FormData = class { constructor(readonly form: any) {} forEach(fn: Function) { Object.entries(this.form.values).forEach(([k, v]) => fn(v, k)); } };
  const form: any = { dataset: { dmForm: "territory-right" }, values: fields() };
  try { (app as any)._onRender(); listeners.input({ target: { closest: () => form } }); assert.equal(app.controller.rightDraft.reason, "Concessão");
    const click = async (dataset: any) => listeners.click({ target: { closest: () => ({ dataset, closest: () => form }) } });
    await click({ dmRightConditionAdd: "true" }); assert.equal(app.controller.rightDraft.rightConditionCount, "1"); form.values = { ...app.controller.rightDraft, rightConditionType0: "policy", rightConditionValue0: "permit" };
    await click({ dmRightConditionRemove: "0" }); assert.equal(app.controller.rightDraft.rightConditionCount, "0"); form.values = app.controller.rightDraft;
    await listeners.submit({ target: form, preventDefault() {} }); assert.equal(calls[0].action.kind, "right");
    await listeners.submit({ target: { dataset: { dmForm: "territory-right-revoke" }, values: { rightId: "right", rightRevision: "0", reason: "Revogar" } }, preventDefault() {} }); assert.equal(calls[1].action.kind, "revoke-right");
    app.controller.selectTab("proposals"); app.controller.list = { isGm: true }; app.controller.detail = { id: "proposal", revision: 0, original: { kind: "territory", mode: "modify", id: territory, expectedRevision: 0, action: calls[0].action } }; app.controller.rightReviewTarget = target;
    const review: any = { dataset: { dmForm: "review" }, values: { ...fields(), rightReview: "on", rightType: "addon:review", reason: "Review" }, querySelector: (sel: string) => sel.includes("rightReview") };
    listeners.input({ target: { closest: () => review } }); assert.equal(app.controller.rightReviewFields.rightType, "addon:review"); await listeners.submit({ target: review, submitter: { value: "approve" }, preventDefault() {} }); assert.equal(calls[2].editedIntent.action.value.rightType, "addon:review");
    await click({ dmRightReset: "true" }); assert.deepEqual(app.controller.rightDraft, {});
  } finally { (globalThis as any).FormData = saved; }
});
