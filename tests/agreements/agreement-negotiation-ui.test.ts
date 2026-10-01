import test from "node:test";
import assert from "node:assert/strict";
import { ok, type Result } from "../../src/core/contracts/result.js";
import { compareAgreementSnapshots } from "../../src/agreements/agreement-negotiation.js";
import { agreementOwner } from "../../src/agreements/agreement-owner.js";
import { createDiplomacyDraft } from "../../src/diplomacy/diplomacy-drafts.js";
import { DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
import { renderAgreementNegotiation } from "../../src/ui/domain-patterns/diplomacy/agreement-negotiation-view.js";
import type { AgreementTerm } from "../../src/agreements/agreement-model.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const duration = { startsAtWorldTick: null, expiresAtWorldTick: 100 };
const term = (id = "t", patch: Partial<AgreementTerm> = {}): AgreementTerm => ({ id, type: "domain-manager:narrative", title: "Treaty", text: "Old", visibility: "public", partyIds: ["party-0", "party-1"], payload: {}, ...patch });
function data() { return unwrap(agreementOwner.validate(createDiplomacyDraft("agreement", "Treaty", [{ type: "narrative", id: "A" }, { type: "narrative", id: "B" }], "public").data, [])); }
function project(secretOnly = false) {
  let d = data();
  const change = (action: unknown) => { d = unwrap(agreementOwner.change(d, action, { expectedRevision: d.state.agreement.revision,
    eventId: crypto.randomUUID(), at: d.state.agreement.updatedAt + 1, worldTick: 10, reason: "Negotiate", sourceRefs: [{ type: "manual", id: "gm" }] }, [])) as typeof d; };
  change({ kind: "propose", proposalId: "offer", partyId: "party-0", terms: [term(), term("hidden", { title: "PRIVATE_MARKER", visibility: "secret" })], duration, proposalExpiresAtWorldTick: 50 });
  change({ kind: "counter", proposalId: "offer", expectedProposalRevision: 0, partyId: "party-1", terms: [term("t", { text: secretOnly ? "Old" : "New" }), term("hidden", { title: "PRIVATE_MARKER_2", visibility: "secret" })], duration });
  return { d, gm: unwrap(agreementOwner.project(d, { isGm: true, canSee: () => true, worldTick: 10, at: 10, historyOffset: 0, historyLimit: 30 })) as any,
    player: unwrap(agreementOwner.project(d, { isGm: false, canSee: v => v === "public", worldTick: 10, at: 10, historyOffset: 0, historyLimit: 30 })) as any };
}
function controller(isGm = true, result: Result<unknown> = ok({})) {
  const calls: any[] = [], api = { agreements: { modify: async (x: any) => { calls.push(x); return result; } }, proposals: { submit: async (x: any) => { calls.push(x); return result; } } };
  const c = new DiplomacyApplicationController(api as any); c.tab = "agreements"; c.list = { isGm, worldTick: 10 }; c.detail = { id: "agr", revision: 3, label: "Treaty", lifecycle: "active", duration: { ...duration }, parties: data().state.agreement.parties,
    terms: [term()], proposals: [{ id: "old", revision: 2, lifecycle: "enacted", rounds: [] }, { id: "offer", revision: 1, lifecycle: "open", rounds: [] }], obligations: [] };
  return { c, calls };
}
test("G6 agreement UI: diff distinguishes added, removed and changed terms with exact before/after", () => {
  const before = [term("remove"), term()], after = [term("t", { text: "New", payload: { x: 2 } }), term("add")];
  const d = compareAgreementSnapshots(before, after, duration, { ...duration, expiresAtWorldTick: 200 });
  assert.deepEqual(d.terms.map(x => [x.id, x.kind]), [["remove", "removed"], ["t", "changed"], ["add", "added"]]);
  assert.deepEqual(d.terms[1].changedFields, ["text", "payload"]); assert.equal(d.terms[1].before?.text, "Old"); assert.equal(d.terms[1].after?.text, "New"); assert.equal(d.duration.changed, true);
  assert.equal(Object.isFrozen(d.terms[1].before), true); assert.equal(before[1].text, "Old");
});
test("G6 agreement UI: structural payload key order is no change; actual reorder is explicit", () => {
  const before = [term("a", { payload: { x: 1, y: 2 } }), term("b")];
  const same = compareAgreementSnapshots(before, [term("a", { payload: { y: 2, x: 1 } }), term("b")], duration, duration);
  assert.deepEqual(same.terms, []); assert.equal(same.duration.changed, false); assert.equal(same.orderChanged, false);
  assert.equal(compareAgreementSnapshots(before, [...before].reverse(), duration, duration).orderChanged, true);
});
test("G6 agreement UI: diff covers type, title, privacy and party changes", () => {
  const d = compareAgreementSnapshots([term()], [term("t", { type: "test:other", title: "New", visibility: "secret", partyIds: ["party-0"] })], duration, duration);
  assert.deepEqual(d.terms[0].changedFields, ["type", "title", "visibility", "partyIds"]);
});
test("G6 agreement UI: owner compares after projection and does not expose hidden changes", () => {
  const { d, gm, player } = project(true), before = structuredClone(d);
  assert.equal(gm.proposals[0].rounds[1].comparison.terms.length, 1);
  assert.deepEqual(player.proposals[0].rounds[1].comparison.terms, []);
  assert.equal(JSON.stringify(player).includes("PRIVATE_MARKER"), false); assert.equal(JSON.stringify(player).includes('"hidden"'), false);
  assert.equal(player.proposals[0].rounds[0].comparison, null); assert.deepEqual(d, before);
});
test("G6 agreement UI: visible diff is complete while secret history stays absent from rendered Player view", () => {
  const { player } = project(), html = renderAgreementNegotiation(player.proposals, player.parties, 10, false);
  for (const token of ["Rodada 1", "Rodada 2", "Antes", "Depois", "Old", "New", "ofertada por", "Aceitaram"]) assert.ok(html.includes(token), token);
  assert.equal(html.includes("PRIVATE_MARKER"), false); assert.ok(html.includes("disabled"));
});
test("G6 agreement UI: round rendering escapes term, payload, party and proposal values", () => {
  const { gm } = project(); gm.proposals[0].id = '"><script>bad</script>'; gm.proposals[0].rounds[0].terms = [term("evil", { title: "<img onerror=bad>", text: "</p><script>bad</script>", payload: { evil: "</pre><script>bad</script>" } })];
  const html = renderAgreementNegotiation(gm.proposals, [{ id: "party-0", ref: { id: "<script>party</script>" } }], 50, true);
  assert.equal(html.includes("<script>"), false); assert.equal(html.includes("<img onerror"), false); assert.ok(html.includes("&lt;script&gt;"));
});
test("G6 agreement UI: expiration is available at deadline, never for closed or undated proposals", () => {
  const { gm } = project(); const p = gm.proposals[0];
  assert.equal(renderAgreementNegotiation([p], gm.parties, 49, true).includes("disabled"), true);
  assert.equal(renderAgreementNegotiation([p], gm.parties, 50, true).includes("disabled"), false);
  for (const patch of [{ lifecycle: "enacted" }, { lifecycle: "expired" }, { expiresAtWorldTick: null }])
    assert.equal(renderAgreementNegotiation([{ ...p, ...patch }], gm.parties, 50, true).includes('data-dm-form="agreement-expire-proposal"'), false);
});
test("G6 agreement UI: manual renewal builds precise normal intent and preserves terms", async () => {
  const { c, calls } = controller(); unwrap(await c.change({ kind: "renew", renewExpires: "200", reason: "Extend" }));
  assert.deepEqual(calls[0], { kind: "agreement", mode: "modify", id: "agr", expectedRevision: 3, action: { kind: "renew", expiresAtWorldTick: 200, automatic: false }, reason: "Extend" });
  assert.equal(c.detail.terms[0].text, "Old"); assert.deepEqual(c.agreementFormFields, {});
});
test("G6 agreement UI: invalid/indefinite/nonrenewable dates fail locally without sending", async () => {
  const { c, calls } = controller(); for (const renewExpires of ["", "100", "10", "1.5", "NaN", String(Number.MAX_SAFE_INTEGER + 1)]) assert.equal((await c.change({ kind: "renew", renewExpires, reason: "Bad" })).ok, false);
  c.detail.duration.expiresAtWorldTick = null; assert.equal(c.buildAction({ kind: "renew", renewExpires: "200" }).ok, false);
  c.detail.duration = duration; c.detail.lifecycle = "expired"; assert.equal(c.buildAction({ kind: "renew", renewExpires: "200" }).ok, false); assert.equal(calls.length, 0);
});
test("G6 agreement UI: selects exact proposal/revision, rejects unknown ID without latest fallback", () => {
  const { c } = controller(); assert.deepEqual(unwrap(c.buildAction({ kind: "expire-proposal", sourceId: "offer" })), { kind: "expire-proposal", proposalId: "offer", expectedProposalRevision: 1 });
  for (const kind of ["counter", "accept", "reject", "activate", "expire-proposal"]) assert.equal(c.buildAction({ kind, sourceId: "typo" }).ok, false);
  assert.equal((unwrap(c.buildAction({ kind: "accept", partyId: "party-0" })) as any).proposalId, "offer");
});
test("G6 agreement UI: proposal deadline is distinct from term duration; amendment has audit ID", () => {
  const { c } = controller(); const fields = { kind: "amend", title: "New", partyId: "party-0", starts: "20", expires: "200", proposalExpires: "50", visibility: "public" };
  const a: any = unwrap(c.buildAction(fields)); assert.deepEqual(a.duration, { startsAtWorldTick: 20, expiresAtWorldTick: 200 }); assert.equal(a.proposalExpiresAtWorldTick, 50); assert.ok(a.amendmentId);
  for (const key of ["starts", "expires", "proposalExpires"]) assert.equal(c.buildAction({ ...fields, [key]: "-1" }).ok, false);
});
test("G6 agreement UI: Player renewal is a proposal and never calls owner mutation directly", async () => {
  const { c, calls } = controller(false); unwrap(await c.change({ kind: "renew", renewExpires: "200", reason: "Please" }));
  assert.equal(calls.length, 1); assert.ok(calls[0].intent); assert.equal(calls[0].intent.action.automatic, false);
});
test("G6 agreement UI: failed forms preserve operation, dates, text, reason and checkboxes with escaping", async () => {
  const { c } = controller(true, { ok: false, error: { code: "FAIL", message: "Rejected", severity: "error" } } as any);
  const fields = { kind: "amend", title: '"<script>bad</script>', text: "</textarea><script>bad</script>", partyId: "party-1", sourceId: "offer", proposalExpires: "50", expires: "200", reason: "Review", inherited: "on", visibility: "restricted" };
  assert.equal((await c.change(fields)).ok, false); const html = c.actionForm();
  assert.ok(html.includes('value="amend" selected')); assert.ok(html.includes('value="offer" selected')); assert.ok(html.includes('value="50"')); assert.ok(html.includes('value="Review"')); assert.ok(html.includes('name="inherited" checked')); assert.equal(html.includes("<script>"), false);
  c.selectTab("relations"); assert.deepEqual(c.agreementFormFields, {});
});
test("G6 agreement UI: empty negotiation and 100 rounds remain truthful and read-only", () => {
  assert.ok(renderAgreementNegotiation([], [], 10, true).includes("Nenhuma proposta"));
  const rounds = Array.from({ length: 100 }, (_, i) => ({ round: i + 1, terms: [term("t", { text: String(i) })], duration, offeredByPartyId: "party-0", at: i, acceptedPartyIds: [], rejectedPartyIds: [], comparison: i ? compareAgreementSnapshots([term("t", { text: String(i - 1) })], [term("t", { text: String(i) })], duration, duration) : null }));
  const html = renderAgreementNegotiation([{ id: "offer", revision: 99, purpose: "initial", lifecycle: "open", expiresAtWorldTick: null, rounds }], [], 10, true);
  assert.ok(html.includes("Rodada 100")); assert.equal(rounds[0].terms[0].text, "0");
});
test("G6 agreement UI: failed expiration form retains its reason only for the selected proposal", () => {
  const { gm } = project(); const html = renderAgreementNegotiation([gm.proposals[0], { ...gm.proposals[0], id: "other" }], gm.parties, 50, true,
    { kind: "expire-proposal", sourceId: "offer", reason: '"<script>deadline</script>' });
  assert.equal(html.includes("<script>"), false); assert.equal((html.match(/deadline/g) ?? []).length, 1); assert.ok(html.includes('value=""'));
});
