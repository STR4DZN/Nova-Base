import test from "node:test";
import assert from "node:assert/strict";
import type { Result } from "../../src/core/contracts/result.js";
import { ok } from "../../src/core/contracts/result.js";
import { agreementOwner, type AgreementOwnerData } from "../../src/agreements/agreement-owner.js";
import type { AgreementTerm } from "../../src/agreements/agreement-model.js";
import { createDiplomacyDraft } from "../../src/diplomacy/diplomacy-drafts.js";
import { renderAgreementObligations, renderAgreementAmendments, renderAgreementDuration } from "../../src/ui/domain-patterns/diplomacy/agreement-inspector-view.js";
import { DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const duration = { startsAtWorldTick: null, expiresAtWorldTick: 100 };
const obligation = (id = "tribute", payload = {}, patch: Partial<AgreementTerm> = {}): AgreementTerm => ({ id,
  type: "domain-manager:obligation", title: id, text: "Pay tribute", visibility: "public", partyIds: ["party-0", "party-1"],
  payload: { kind: "domain-manager:payment", obligatedPartyId: "party-0", beneficiaryPartyId: "party-1", dueAtWorldTick: 20,
    graceTicks: 5, overduePolicy: "report", requirementRef: { type: "resource", id: "test:coin" }, consequences: [], ...payload }, ...patch });
function fixture(terms = [obligation()]) {
  const raw: any = createDiplomacyDraft("agreement", "Treaty", [{ type: "narrative", id: "A" }, { type: "narrative", id: "B" }], "public").data;
  raw.definition.amendmentRequiresApproval = false;
  let data = unwrap(agreementOwner.validate(raw, [])) as AgreementOwnerData;
  const change = (action: unknown) => { data = unwrap(agreementOwner.change(data, action, { expectedRevision: data.state.agreement.revision,
    eventId: crypto.randomUUID(), at: data.state.agreement.updatedAt + 1, worldTick: 10, reason: "Review reason", sourceRefs: [{ type: "manual", id: "gm" }] }, [])) as AgreementOwnerData; };
  change({ kind: "propose", proposalId: "offer", partyId: "party-0", terms, duration, proposalExpiresAtWorldTick: null });
  for (const partyId of ["party-0", "party-1"]) change({ kind: "accept", proposalId: "offer", expectedProposalRevision: data.state.agreement.proposals[0].revision, partyId });
  change({ kind: "activate", proposalId: "offer", expectedProposalRevision: 2 });
  const project = (tick = 10, isGm = true, offset = 0, limit = 30, canSee = (v: string) => isGm || v === "public") =>
    unwrap(agreementOwner.project(data, { isGm, canSee, worldTick: tick, at: 10, historyOffset: offset, historyLimit: limit })) as any;
  const mutate = (action: unknown, index = 0) => { const o = data.state.obligations[index]; change({ kind: "obligation", obligationId: o.id, expectedObligationRevision: o.revision, action }); };
  const amend = (terms: AgreementTerm[], id = "edit", nextDuration = { startsAtWorldTick: 10, expiresAtWorldTick: 100 }) =>
    change({ kind: "amend", proposalId: "unused", partyId: "party-0", amendmentId: id, terms, duration: nextDuration, proposalExpiresAtWorldTick: null });
  return { project, mutate, amend, change, get data() { return data; } };
}
const html = (d: any, isGm = true) => renderAgreementObligations(d.obligations, d.parties, d.worldTick, isGm);
test("G6 inspector: due, inclusive grace boundary and overdue are derived without persistence", () => {
  const f = fixture(), before = structuredClone(f.data);
  assert.equal(f.project(19).obligations[0].compliance.lifecycle, "pending");
  assert.equal(f.project(20).obligations[0].compliance.lifecycle, "due");
  assert.equal(f.project(25).obligations[0].compliance.pastGrace, false);
  const d = f.project(26); assert.equal(d.obligations[0].lifecycle, "pending"); assert.equal(d.obligations[0].compliance.pastGrace, true);
  for (const token of ["Estado registrado: Pendente", "estado consultado: Vencida", "Vencimento: 20", "tolerância: 5", "inclusive): 25", "Tolerância ultrapassada", "confirmado: Não", "Responsável: A", "beneficiário: B", "resource: test:coin"]) assert.ok(html(d).includes(token), token);
  assert.equal(d.lifecycle, "active"); assert.deepEqual(f.data, before);
});
test("G6 inspector: null deadlines and safe integer sum remain precise", () => {
  const undated = fixture([obligation("undated", { dueAtWorldTick: null, beneficiaryPartyId: null })]).project(100);
  assert.equal(undated.obligations[0].deadline.graceEndsAtWorldTick, null); assert.ok(html(undated).includes("Vencimento: Sem prazo")); assert.ok(html(undated).includes("beneficiário: Não declarado"));
  const d = fixture([obligation("max", { dueAtWorldTick: Number.MAX_SAFE_INTEGER, graceTicks: 2 })]).project(Number.MAX_SAFE_INTEGER);
  assert.equal(d.obligations[0].deadline.graceEndsAtWorldTick, "9007199254740993"); assert.ok(html(d).includes("9007199254740993")); assert.equal(d.obligations[0].compliance.pastGrace, false);
});
test("G6 inspector: overdue allegation is distinguished from confirmed breach", () => {
  const f = fixture([obligation("late", { overduePolicy: "allege-breach" })]), d = f.project(26);
  assert.equal(d.obligations[0].compliance.allegedBreach, true); assert.equal(d.obligations[0].compliance.confirmedBreach, false);
  assert.ok(html(d).includes("Alegação: Sim; descumprimento confirmado: Não")); assert.equal(f.data.state.obligations[0].allegedBreach, false);
  f.mutate({ kind: "decide", lifecycle: "breached" }); assert.ok(html(f.project(26)).includes("Descumprimento confirmado")); assert.equal(f.project(26).lifecycle, "active");
});
test("G6 inspector: terminal decisions and evidence never fabricate satisfaction", () => {
  const f = fixture(); f.mutate({ kind: "evidence", evidence: { id: "receipt", ref: { type: "evidence", id: "receipt" }, statement: "Payment claimed", position: "contest", visibility: "public", at: 0 } });
  assert.equal(f.project().obligations[0].lifecycle, "pending"); assert.ok(html(f.project()).includes("Contesta"));
  f.mutate({ kind: "decide", lifecycle: "satisfied" }); const d = f.project(26);
  assert.equal(d.obligations[0].compliance.lifecycle, "satisfied"); assert.ok(html(d).includes("Obrigação encerrada por decisão registrada")); assert.equal(d.lifecycle, "active");
});
test("G6 inspector: Player DTO omits secret obligations, snapshots, evidence and audit", () => {
  const f = fixture([obligation(), obligation("PRIVATE_OBLIGATION", {}, { visibility: "secret" })]);
  f.mutate({ kind: "evidence", evidence: { id: "PRIVATE_EVIDENCE", ref: { type: "evidence", id: "PRIVATE_RECEIPT" }, statement: "PRIVATE_STATEMENT", position: "support", visibility: "secret", at: 0 } });
  const d = f.project(26, false); assert.equal(d.obligations.length, 1); assert.equal(d.compliance.length, 1);
  assert.deepEqual(d.obligations[0].evidence, []); assert.deepEqual(d.obligations[0].events, []); assert.deepEqual(d.history, []);
  assert.equal(JSON.stringify(d).includes("PRIVATE_"), false); assert.equal(html(d, false).includes("Review reason"), false); assert.equal(html(d, false).includes("Histórico da obrigação"), false);
});
test("G6 inspector: visible evidence includes position, reference, statement and authority timestamp", () => {
  const f = fixture(); f.mutate({ kind: "evidence", evidence: { id: "e", ref: { type: "economy-receipt", id: "receipt" }, statement: "Review receipt", position: "support", visibility: "public", at: 999999 } });
  const d = f.project(10, false), e = d.obligations[0].evidence[0]; assert.equal(e.at, f.data.state.agreement.updatedAt);
  for (const token of ["economy-receipt: receipt", "Review receipt", "Apoia", "public", String(e.at)]) assert.ok(html(d, false).includes(token), token);
});
test("G6 inspector: amendment keeps original deadlines and distinct applicable generation", () => {
  const f = fixture(); f.amend([obligation("tribute", { dueAtWorldTick: 80 })]); const d = f.project(30);
  assert.equal(d.obligations.length, 2); assert.equal(d.obligations[0].compliance.applicable, false); assert.equal(d.obligations[1].compliance.applicable, true);
  assert.equal(d.obligations[0].termSnapshot.payload.dueAtWorldTick, 20); assert.equal(d.obligations[1].termSnapshot.payload.dueAtWorldTick, 80);
  assert.equal(d.obligations[0].termsSource.id, "offer"); assert.equal(d.obligations[1].termsSource.id, "edit");
  for (const token of ["Histórica", "Prazo histórico", "Vigente no acordo", "Vencimento: 20", "Vencimento: 80"]) assert.ok(html(d).includes(token), token);
});
test("G6 inspector: removed secret historical generation is never exposed", () => {
  const f = fixture([obligation("PRIVATE_ORIGINAL", {}, { visibility: "secret" })]); f.amend([obligation("public-new")]);
  const p = f.project(30, false); assert.equal(p.obligations.length, 1); assert.deepEqual(p.amendments, []); assert.equal(JSON.stringify(p).includes("PRIVATE_"), false);
});
test("G6 inspector: projection is detached, immutable and absent from persisted state", () => {
  const f = fixture(), d = f.project(); assert.equal(Object.isFrozen(d.obligations[0].termSnapshot.payload), true);
  assert.throws(() => { d.obligations[0].termSnapshot.title = "overwrite"; }, TypeError);
  assert.equal(f.data.state.obligations[0].termSnapshot, undefined); assert.equal(f.data.state.obligations[0].compliance, undefined);
  assert.equal(f.data.state.agreement.terms[0].title, "tribute");
});
test("G6 inspector: GM event and amendment paging retains exact snapshots and duration diff", () => {
  const f = fixture(); f.mutate({ kind: "allege" }); f.mutate({ kind: "contest" });
  f.amend([obligation("tribute", { dueAtWorldTick: 80 })], "edit-one", { startsAtWorldTick: 10, expiresAtWorldTick: 150 });
  f.amend([obligation("tribute", { dueAtWorldTick: 90 })], "edit-two", { startsAtWorldTick: 10, expiresAtWorldTick: 200 });
  const d = f.project(30, true, 1, 1); assert.equal(d.obligations[0].events.length, 1); assert.equal(d.obligations[0].events[0].kind, "contest");
  assert.equal(d.amendments.length, 1); assert.equal(d.amendments[0].id, "edit-two"); assert.equal(d.amendments[0].comparison.duration.before.expiresAtWorldTick, 150);
  const h = renderAgreementAmendments(d.amendments, true); for (const token of ["edit-two", "Todos os termos antes", "Todos os termos depois", "80", "90", "150", "200", "Emenda direta do GM"]) assert.ok(h.includes(token), token);
  assert.equal(renderAgreementAmendments(d.amendments, false), "");
});
test("G6 inspector: amendment diff is calculated only after audience filtering", () => {
  const f = fixture([obligation(), obligation("PRIVATE_TERM", {}, { visibility: "secret" })]);
  f.amend([obligation(), obligation("PRIVATE_TERM", { dueAtWorldTick: 99 }, { visibility: "secret" })]);
  const d = f.project(10, true, 0, 30, v => v === "public"); assert.deepEqual(d.amendments[0].comparison.terms, []); assert.equal(JSON.stringify(d.amendments).includes("PRIVATE_"), false);
});
test("G6 inspector: terms, evidence, sources and amendment IDs are escaped", () => {
  const evil = '<script>alert("bad")</script>', f = fixture([obligation("evil", { requirementRef: { type: "resource", id: evil } }, { title: evil, text: evil })]);
  f.mutate({ kind: "evidence", evidence: { id: "e", ref: { type: "evidence", id: evil }, statement: evil, position: "support", visibility: "public", at: 0 } });
  f.amend([obligation("evil", {}, { title: evil, text: evil })], evil);
  const d = f.project(), h = html(d) + renderAgreementAmendments(d.amendments, true);
  assert.equal(h.includes("<script>"), false); assert.ok(h.includes("&lt;script&gt;"));
});
test("G6 inspector: empty sections and unlimited duration give truthful messages", () => {
  assert.ok(renderAgreementObligations([], [], 10, true).includes("Nenhuma obrigação visível"));
  assert.ok(renderAgreementAmendments([], true).includes("Nenhuma emenda nesta página"));
  assert.ok(renderAgreementDuration({ startsAtWorldTick: null, expiresAtWorldTick: null }, 10).includes("fim sem limite"));
});
test("G6 inspector: selection uses exact visible obligation and preserves input without mutation", () => {
  const calls: any[] = [], f = fixture(), c = new DiplomacyApplicationController({ agreements: { modify: async (x: any) => { calls.push(x); return ok({}); } } } as any);
  c.tab = "agreements"; c.list = { isGm: true, worldTick: 10 }; c.detail = f.project(26); c.agreementFormFields = { kind: "obligation:decide", reason: "Review", text: "Keep", lifecycle: "satisfied" };
  unwrap(c.selectAgreementObligation(c.detail.obligations[0].id)); assert.equal(c.agreementFormFields.kind, "obligation:decide"); assert.equal(c.agreementFormFields.reason, "Review"); assert.equal(c.agreementFormFields.text, "Keep");
  const a: any = unwrap(c.buildAction(c.agreementFormFields)); assert.equal(a.expectedObligationRevision, 0); assert.equal(a.obligationId, c.detail.obligations[0].id);
  assert.equal(c.selectAgreementObligation("typo").ok, false); assert.equal(c.buildAction({ kind: "obligation:allege", obligationId: "typo" }).ok, false);
  c.agreementFormFields.kind = "amend"; unwrap(c.selectAgreementObligation(a.obligationId)); assert.equal(c.agreementFormFields.kind, "obligation:evidence"); assert.equal(calls.length, 0);
  assert.ok(c.inspector().includes("Consulta no tick 26")); assert.equal(c.inspector().includes("Consulta no tick 10"), false);
});
