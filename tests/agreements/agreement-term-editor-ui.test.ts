import test from "node:test";
import assert from "node:assert/strict";
import { ok, type Result } from "../../src/core/contracts/result.js";
import { mergeAgreementTermSelection } from "../../src/agreements/agreement-term-selection.js";
import type { AgreementTerm } from "../../src/agreements/agreement-model.js";
import { agreementTermFields, newAgreementTerm, parseAgreementTermEditor, reorderAgreementTermFields } from "../../src/ui/domain-patterns/diplomacy/agreement-term-editor.js";
import { DiplomacyApplication, DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const parties = ["party-0", "party-1"], duration = { startsAtWorldTick: 10, expiresAtWorldTick: 100 };
const term = (id = "t", patch: Partial<AgreementTerm> = {}): AgreementTerm => ({ id, type: "domain-manager:narrative", title: id,
  text: null, visibility: "public", partyIds: [...parties], payload: {}, ...patch });
function controller(isGm = true, result: Result<unknown> = ok({})) {
  const calls: any[] = [], c = new DiplomacyApplicationController({ agreements: { modify: async (x: any) => { calls.push(x); return result; } },
    proposals: { submit: async (x: any) => { calls.push(x); return result; } } } as any);
  c.tab = "agreements"; c.selectedId = "agr"; c.list = { isGm, worldTick: 10 }; c.detail = { id: "agr", revision: 3, label: "Treaty", lifecycle: "active", worldTick: 10,
    duration: { ...duration }, parties: parties.map((id, i) => ({ id, ref: { type: "narrative", id: i ? "B" : "A" } })), terms: [term("a"), term("b")],
    proposals: [], obligations: [], amendments: [] };
  return { c, calls };
}
test("G6 terms: selection retains hidden slots, replaces selected slots, adds terms and never mutates", () => {
  const base = [term("a"), term("secret", { visibility: "secret" }), term("b")], before = structuredClone(base);
  const merged = unwrap(mergeAgreementTermSelection(base, [term("b", { title: "Changed" }), term("new")], ["a", "b"]));
  assert.deepEqual(merged.map(t => t.id), ["b", "secret", "new"]); assert.deepEqual(merged[1], base[1]); assert.deepEqual(base, before);
  (merged[1] as any).title = "mutated output"; assert.equal(base[1].title, "secret");
});
test("G6 terms: empty selection is append-only; explicit full removal preserves unselected terms", () => {
  const base = [term("a"), term("secret")]; assert.deepEqual(unwrap(mergeAgreementTermSelection(base, [term("new")], [])).map(t => t.id), ["a", "secret", "new"]);
  assert.deepEqual(unwrap(mergeAgreementTermSelection(base, [], ["a"])).map(t => t.id), ["secret"]);
  assert.deepEqual(unwrap(mergeAgreementTermSelection(base, [], ["a", "secret"])), []);
});
test("G6 terms: malformed selection and collision outside selection fail closed", () => {
  for (const ids of [["missing"], ["a", "a"], [null], {}]) assert.equal(mergeAgreementTermSelection([term("a")], [], ids as any).ok, false);
  assert.equal(mergeAgreementTermSelection([term("a"), term("hidden")], [term("hidden")], ["a"]).ok, false);
  assert.equal(mergeAgreementTermSelection([term("a")], [null] as any, []).ok, false);
});
test("G6 terms: unchanged fields round-trip complete native payload, null/empty text and extras", () => {
  const terms = [term("null"), term("empty", { text: "" }), term("spaced", { title: "Title", text: " \n text \n ", payload: { extra: { retain: true } } }),
    { ...newAgreementTerm("domain-manager:capability", parties), title: "Grant", payload: { beneficiaryPartyId: "party-1", capabilityIds: ["test:trade"], scopeRef: null, conditionRefs: [{ type: "condition", id: "route" }], extension: { x: 1 } }, extraTop: "retained" }];
  const fields: Record<string, string> = {}; terms.forEach((t, i) => Object.entries(agreementTermFields(t, parties)).forEach(([k, v]) => fields[`term_${i}_${k}`] = v));
  assert.deepEqual(unwrap(parseAgreementTermEditor(fields, terms.length, parties, terms)), terms);
});
test("G6 terms: invalid JSON, non-object payload, duplicates, privacy, parties and type are rejected", () => {
  const { c } = controller(); unwrap(c.openAgreementTermEditor("amend")); const f = c.agreementTermEditor!.fields;
  for (const payload of ["{", "null", "[]", "1"]) assert.equal(c.buildAction({ ...f, term_0_payload: payload }).ok, false);
  for (const patch of [{ term_1_id: "a" }, { term_0_title: "" }, { term_0_visibility: "invalid" }, { term_0_type: "unsupported:type" }]) assert.equal(c.buildAction({ ...f, ...patch }).ok, false);
  const o = newAgreementTerm("domain-manager:obligation", parties); const fields = Object.fromEntries(Object.entries(agreementTermFields({ ...o, title: "Due" }, parties)).map(([k, v]) => [`term_0_${k}`, v]));
  assert.equal(parseAgreementTermEditor({ ...fields, term_0_party_0: "" }, 1, parties, []).ok, false);
  assert.equal(parseAgreementTermEditor(fields, -1, parties, []).ok, false);
});
test("G6 terms: all native structured payloads can be edited and validated without dropping conditions", () => {
  const ts = [term(), { ...newAgreementTerm("domain-manager:capability", parties), title: "Grant", payload: { beneficiaryPartyId: "party-0", capabilityIds: ["test:trade"], scopeRef: null, conditionRefs: [] } },
    { ...newAgreementTerm("domain-manager:right", parties), title: "Access", payload: { ...newAgreementTerm("domain-manager:right", parties).payload, territoryUuid: "JournalEntry.T" } },
    { ...newAgreementTerm("domain-manager:obligation", parties), title: "Due" }, { ...newAgreementTerm("domain-manager:owner-operation", parties), title: "Owner" }];
  const fields: Record<string, string> = {}; ts.forEach((t, i) => Object.entries(agreementTermFields(t, parties)).forEach(([k, v]) => fields[`term_${i}_${k}`] = v));
  const parsed = unwrap(parseAgreementTermEditor(fields, ts.length, parties, ts)); assert.deepEqual(parsed, ts);
  const bad = { ...fields, term_3_payload: JSON.stringify({ ...ts[3].payload, dueAtWorldTick: 1.5 }) }; assert.equal(parseAgreementTermEditor(bad, ts.length, parties, ts).ok, false);
});
test("G6 terms: amendment opens all terms and exact duration without touching owner", () => {
  const { c, calls } = controller(), before = structuredClone(c.detail); unwrap(c.openAgreementTermEditor("amend"));
  const f = c.agreementTermEditor!.fields, a: any = unwrap(c.buildAction(f)); assert.deepEqual(a.terms, before.terms); assert.deepEqual(a.baseTermIds, ["a", "b"]); assert.deepEqual(a.duration, duration);
  assert.equal(a.partyId, "party-0"); assert.equal(c.agreementTermEditor!.revision, 3); assert.deepEqual(c.detail, before); assert.equal(calls.length, 0);
});
test("G6 terms: counter uses exact last offered snapshot and revision rather than active terms", () => {
  const { c } = controller(); c.detail.proposals = [{ id: "offer", revision: 7, lifecycle: "open", expiresAtWorldTick: 50,
    rounds: [{ terms: [term("first")], duration }, { terms: [term("last")], duration: { ...duration, expiresAtWorldTick: 200 } }] }];
  assert.equal(c.openAgreementTermEditor("counter", "typo").ok, false); unwrap(c.openAgreementTermEditor("counter", "offer"));
  const a: any = unwrap(c.buildAction(c.agreementTermEditor!.fields)); assert.deepEqual(a.terms.map((t: any) => t.id), ["last"]); assert.equal(a.expectedProposalRevision, 7); assert.equal(a.duration.expiresAtWorldTick, 200);
  c.detail.proposals[0].revision++; assert.equal(c.buildAction(c.agreementTermEditor!.fields).ok, false);
});
test("G6 terms: add/remove/move preserve raw invalid input, metadata and stable IDs", () => {
  const { c } = controller(); unwrap(c.openAgreementTermEditor("amend")); let f = { ...c.agreementTermEditor!.fields, reason: "Keep reason", term_0_payload: "{ broken" };
  c.addAgreementTerm(f); f = { ...c.agreementTermEditor!.fields }; const newId = f.term_2_id;
  assert.equal(c.agreementTermEditor!.count, 3); c.moveAgreementTerm(2, -1, f); assert.equal(c.agreementTermEditor!.fields.term_1_id, newId);
  c.removeAgreementTerm(2, c.agreementTermEditor!.fields); assert.equal(c.agreementTermEditor!.count, 2); assert.equal(c.agreementTermEditor!.fields.term_0_payload, "{ broken"); assert.equal(c.agreementTermEditor!.fields.reason, "Keep reason");
  assert.equal(c.agreementTermEditor!.fields.term_2_id, undefined); assert.equal(c.agreementTermEditor!.fields.term_1_id, newId);
  assert.deepEqual(reorderAgreementTermFields({ reason: "R", term_0_text: "a", term_1_text: "b" }, [1, 0]), { reason: "R", term_1_text: "a", term_0_text: "b" });
});
test("G6 terms: type switch resets only chosen payload and preserves identity, text and other rows", () => {
  const { c } = controller(); unwrap(c.openAgreementTermEditor("amend")); const f = { ...c.agreementTermEditor!.fields, term_0_type: "domain-manager:obligation", term_0_text: "Keep text" };
  unwrap(c.changeAgreementTermType(0, f)); const saved = c.agreementTermEditor!.fields;
  assert.equal(saved.term_0_id, "a"); assert.equal(saved.term_0_text, "Keep text"); assert.equal(saved.term_1_type, "domain-manager:narrative"); assert.equal(JSON.parse(saved.term_0_payload).graceTicks, 0);
});
test("G6 terms: mandatory preview shows added/removed/changed/reordered and duration without sending", async () => {
  const { c, calls } = controller(); unwrap(c.openAgreementTermEditor("amend")); let f = { ...c.agreementTermEditor!.fields, term_0_title: "Edited", expires: "200", reason: "Review" };
  assert.equal((await c.change(f)).ok, false); assert.equal(calls.length, 0);
  unwrap(c.previewAgreementTerms(f)); assert.equal(c.agreementTermPreview!.terms[0].kind, "changed"); assert.equal(c.agreementTermPreview!.duration.changed, true);
  assert.ok(c.agreementTermEditingForm().includes("Prévia das alterações visíveis")); assert.equal(calls.length, 0);
  c.moveAgreementTerm(1, -1, f); unwrap(c.previewAgreementTerms(c.agreementTermEditor!.fields)); assert.equal(c.agreementTermPreview!.orderChanged, true);
  f = { ...c.agreementTermEditor!.fields, reason: "Changed reason" }; assert.equal((await c.change(f)).ok, false); assert.equal(calls.length, 0);
});
test("G6 terms: failed authority save preserves full snapshot, dates and escaped raw input", async () => {
  const { c, calls } = controller(true, { ok: false, error: { code: "FAIL", message: "Rejected", severity: "error" } } as any); unwrap(c.openAgreementTermEditor("amend"));
  const f = { ...c.agreementTermEditor!.fields, term_0_title: '<script>bad</script>', term_0_text: '</textarea><script>bad</script>', reason: '"Review', expires: "200", proposalExpires: "50" };
  unwrap(c.previewAgreementTerms(f)); assert.equal((await c.change(f)).ok, false); assert.equal(calls.length, 1); assert.deepEqual(c.agreementTermEditor!.fields, f);
  const h = c.agreementTermEditingForm(); assert.equal(h.includes("<script>"), false); assert.ok(h.includes("&lt;script&gt;")); assert.ok(h.includes('value="200"')); assert.ok(h.includes('value="50"')); assert.ok(h.includes("b"));
});
test("G6 terms: Player sends visible selection for approval and no direct mutation", async () => {
  const { c, calls } = controller(false); unwrap(c.openAgreementTermEditor("amend")); const f = { ...c.agreementTermEditor!.fields, reason: "Please amend", term_0_title: "Changed" };
  unwrap(c.previewAgreementTerms(f)); unwrap(await c.change(f)); assert.equal(calls.length, 1); assert.ok(calls[0].intent); assert.deepEqual(calls[0].intent.action.baseTermIds, ["a", "b"]);
  assert.equal(calls[0].intent.expectedRevision, 3); assert.equal(c.agreementTermEditor, null);
});
test("G6 terms: stale detail preserves draft and refuses automatic rebase/preview/send", async () => {
  const { c, calls } = controller(); unwrap(c.openAgreementTermEditor("amend")); const f = { ...c.agreementTermEditor!.fields, reason: "Keep draft" };
  unwrap(c.previewAgreementTerms(f)); c.detail.revision++; assert.equal((await c.change(f)).ok, false); assert.equal(calls.length, 0); assert.deepEqual(c.agreementTermEditor!.fields, f);
  assert.equal(c.previewAgreementTerms(f).ok, false); assert.ok(c.agreementTermEditingForm().includes("O acordo mudou"));
  c.select("another"); assert.equal(c.agreementTermEditor, null); assert.equal(c.agreementTermPreview, null);
});
test("G6 terms: new draft supports multiple terms, explicit empty snapshot and separate deadline", () => {
  const { c } = controller(); c.detail.lifecycle = "draft"; c.detail.terms = []; c.detail.duration = { startsAtWorldTick: null, expiresAtWorldTick: null };
  unwrap(c.openAgreementTermEditor("propose")); let f = { ...c.agreementTermEditor!.fields, term_0_title: "First", expires: "100", proposalExpires: "50" };
  c.addAgreementTerm(f); f = { ...c.agreementTermEditor!.fields, term_1_title: "Second" }; const a: any = unwrap(c.buildAction(f));
  assert.equal(a.terms.length, 2); assert.equal(a.proposalExpiresAtWorldTick, 50); assert.equal(a.duration.expiresAtWorldTick, 100); assert.notEqual(a.terms[0].id, a.terms[1].id);
  c.removeAgreementTerm(1, f); c.removeAgreementTerm(0, c.agreementTermEditor!.fields); const empty: any = unwrap(c.buildAction(c.agreementTermEditor!.fields)); assert.deepEqual(empty.terms, []);
});
test("G6 terms: configured types, deadlines, durations and operation identity are enforced", () => {
  const { c } = controller(); unwrap(c.openAgreementTermEditor("amend")); const f = c.agreementTermEditor!.fields;
  c.detail.definition = { allowedTermTypes: ["domain-manager:obligation"] }; assert.equal(c.buildAction(f).ok, false); delete c.detail.definition;
  for (const patch of [{ starts: "20", expires: "20" }, { expires: "1.5" }, { starts: "-1" }, { proposalExpires: "10" }, { kind: "counter" }, { sourceId: "other" }]) assert.equal(c.buildAction({ ...f, ...patch }).ok, false);
  c.selectTab("territory"); assert.equal(c.agreementTermEditor, null);
});
test("G6 terms: application bindings retain raw text and route row edits/preview/cancel", async () => {
  const savedFormData = globalThis.FormData, listeners: Record<string, Function> = {}, { c } = controller();
  const app = new DiplomacyApplication({ api: c.api }); Object.assign(app.controller, { tab: c.tab, selectedId: c.selectedId, list: c.list, detail: c.detail });
  const form: any = { dataset: { dmForm: "agreement-terms" }, values: {} }, previewElement = { textContent: "Previous preview" }; let renders = 0;
  (app as any).element = { addEventListener: (event: string, fn: Function) => listeners[event] = fn, querySelector: () => previewElement }; (app as any).render = async () => { renders++; };
  (globalThis as any).FormData = class { constructor(readonly f: any) {} forEach(fn: Function) { Object.entries(this.f.values).forEach(([k, v]) => fn(v, k)); } };
  try {
    app._onRender(); unwrap(app.controller.openAgreementTermEditor("amend")); form.values = { ...app.controller.agreementTermEditor!.fields, term_0_text: "  keep spaces  " };
    await listeners.input({ target: { closest: () => form } }); assert.equal(app.controller.agreementTermEditor!.fields.term_0_text, "  keep spaces  ");
    assert.ok(previewElement.textContent.includes("Confira novamente"));
    const button = (dataset: any) => ({ dataset, closest: () => form });
    await listeners.click({ target: { closest: () => button({ dmTermAdd: "true" }) } }); assert.equal(app.controller.agreementTermEditor!.count, 3);
    form.values = { ...app.controller.agreementTermEditor!.fields, term_2_title: "Third" };
    await listeners.click({ target: { closest: () => button({ dmTermPreview: "true" }) } }); assert.ok(app.controller.agreementTermPreview);
    await listeners.click({ target: { closest: () => button({ dmTermCancel: "true" }) } }); assert.equal(app.controller.agreementTermEditor, null); assert.equal(renders, 3);
  } finally { globalThis.FormData = savedFormData; }
});
