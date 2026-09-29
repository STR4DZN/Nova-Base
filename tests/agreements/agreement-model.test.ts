import test from "node:test";
import assert from "node:assert/strict";
import type { Result } from "../../src/core/contracts/result.js";
import { AgreementTermRegistry, changeAgreement, agreementIsEffective, validateAgreementInstance, validateAgreementDefinition,
  type AgreementDefinition, type AgreementInstance, type AgreementChangeContext, type AgreementAction, type AgreementTerm } from "../../src/agreements/agreement-model.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const d: AgreementDefinition = { id: "test:treaty", version: 1, label: "Treaty", minParties: 2, maxParties: null,
  allowedPartyRoles: ["signatory"], allowedTermTypes: ["domain-manager:narrative"], amendmentRequiresApproval: true,
  automaticRenewalAllowed: false, effectiveLifecycles: ["active", "breached"] };
const registry = new AgreementTermRegistry();
const term = (title = "Peace"): AgreementTerm => ({ id: "peace", type: "domain-manager:narrative", title, text: "Narrative term",
  visibility: "public", partyIds: ["a", "b"], payload: {} });
const duration = { startsAtWorldTick: null, expiresAtWorldTick: 100 };
function draft(): AgreementInstance { return { schemaVersion: 1, id: crypto.randomUUID(), definitionId: d.id, definitionVersion: 1,
  revision: 0, label: "A/B", visibility: "public", parties: ["a", "b", "c"].map(id => ({ id, role: "signatory", ref: { type: "narrative", id } })),
  terms: [], duration, lifecycle: "draft", createdAt: 0, updatedAt: 0, proposals: [], amendments: [], events: [], supersedesId: null }; }
const context = (a: AgreementInstance, patch: Partial<AgreementChangeContext> = {}): AgreementChangeContext => ({
  expectedRevision: a.revision, eventId: crypto.randomUUID(), at: a.updatedAt + 1, worldTick: 10, reason: "GM reviewed terms",
  sourceRefs: [{ type: "manual", id: "gm" }], ...patch });
const change = (a: AgreementInstance, action: AgreementAction, def = d, patch: Partial<AgreementChangeContext> = {}) =>
  unwrap(changeAgreement(a, def, registry, context(a, patch), action));
function offer(a = draft(), purpose: "propose" | "amend" = "propose", def = d): AgreementInstance {
  return change(a, { kind: purpose, proposalId: crypto.randomUUID(), partyId: "a", terms: [term()], duration,
    proposalExpiresAtWorldTick: 50 }, def);
}
function acceptAll(a: AgreementInstance, def = d): AgreementInstance {
  for (const party of a.parties) { const p = a.proposals.at(-1)!; a = change(a, { kind: "accept", proposalId: p.id, expectedProposalRevision: p.revision, partyId: party.id }, def); }
  return a;
}
function activate(a: AgreementInstance, def = d): AgreementInstance {
  const p = a.proposals.at(-1)!; return change(a, { kind: "activate", proposalId: p.id, expectedProposalRevision: p.revision, amendmentId: crypto.randomUUID() }, def);
}
const active = () => activate(acceptAll(offer()));

test("G6.4: multiparty proposal is separate from active terms and activation requires unanimous current acceptance", () => {
  let a = offer(), before = structuredClone(a), p = a.proposals[0]; assert.equal(a.lifecycle, "proposed"); assert.deepEqual(a.terms, []);
  assert.equal(changeAgreement(a, d, registry, context(a), { kind: "activate", proposalId: p.id, expectedProposalRevision: p.revision }).ok, false);
  a = acceptAll(a); assert.equal(a.lifecycle, "pendingApproval"); assert.deepEqual(a.terms, []);
  a = activate(a); assert.equal(a.lifecycle, "active"); assert.equal(a.terms[0].title, "Peace"); assert.equal(a.duration.startsAtWorldTick, 10);
  assert.equal(a.proposals[0].lifecycle, "enacted"); assert.deepEqual(before.terms, []);
  assert.deepEqual(unwrap(validateAgreementInstance(JSON.parse(JSON.stringify(a)), d, registry)), a);
});
test("G6.4: counter preserves old snapshot and resets votes, rejects stale proposal revision", () => {
  let a = offer(), p = a.proposals[0]; a = change(a, { kind: "accept", proposalId: p.id, expectedProposalRevision: p.revision, partyId: "a" });
  p = a.proposals[0]; const old = structuredClone(p.rounds[0]);
  a = change(a, { kind: "counter", proposalId: p.id, expectedProposalRevision: p.revision, partyId: "b", terms: [term("Changed")], duration });
  assert.deepEqual(a.proposals[0].rounds[0], old); assert.deepEqual(a.proposals[0].rounds[1].acceptedPartyIds, []);
  assert.equal(a.lifecycle, "proposed");
  assert.equal(changeAgreement(a, d, registry, context(a), { kind: "accept", proposalId: p.id, expectedProposalRevision: p.revision, partyId: "c" }).ok, false);
  a = activate(acceptAll(a)); assert.equal(a.terms[0].title, "Changed"); assert.equal(a.proposals[0].rounds.length, 2);
});
test("G6.4: rejection permits a new proposal without deleting rejected rounds", () => {
  let a = offer(); const p = a.proposals[0]; a = change(a, { kind: "reject", proposalId: p.id, expectedProposalRevision: 0, partyId: "b" });
  assert.equal(a.lifecycle, "draft"); assert.equal(a.proposals[0].lifecycle, "rejected");
  a = offer(a); assert.equal(a.proposals.length, 2); assert.deepEqual(a.proposals[0].rounds[0].rejectedPartyIds, ["b"]);
});
test("G6.4: proposal deadline closes acceptance; explicit expiration preserves history", () => {
  const a = offer(), p = a.proposals[0], action = { kind: "accept", proposalId: p.id, expectedProposalRevision: 0, partyId: "a" } as const;
  assert.equal(changeAgreement(a, d, registry, context(a, { worldTick: 50 }), action).ok, false);
  assert.equal(changeAgreement(a, d, registry, context(a), { kind: "expire-proposal", proposalId: p.id, expectedProposalRevision: 0 }).ok, false);
  const expired = change(a, { kind: "expire-proposal", proposalId: p.id, expectedProposalRevision: 0 }, d, { worldTick: 50 });
  assert.equal(expired.lifecycle, "draft"); assert.equal(expired.proposals[0].lifecycle, "expired"); assert.equal(expired.proposals[0].rounds.length, 1);
});
test("G6.4: amendment requires reapproval, keeps active old terms until enactment and snapshots before/after", () => {
  let a = active(); const previous = structuredClone(a.terms);
  a = change(a, { kind: "amend", proposalId: "amend", partyId: "a", terms: [term("Amended")], duration, proposalExpiresAtWorldTick: 50 });
  assert.equal(a.lifecycle, "active"); assert.deepEqual(a.terms, previous);
  a = activate(acceptAll(a)); assert.equal(a.amendments.length, 1); assert.deepEqual(a.amendments[0].beforeTerms, previous);
  assert.equal(a.amendments[0].afterTerms[0].title, "Amended"); assert.equal(a.terms[0].title, "Amended"); assert.equal(a.proposals.length, 2);
});
test("G6.4: explicit no-reapproval policy still requires durable amendment ID/history", () => {
  const def = { ...d, amendmentRequiresApproval: false }, a = active();
  const action = { kind: "amend", proposalId: "unused", partyId: "a", terms: [term("Direct")], duration, proposalExpiresAtWorldTick: null } as const;
  assert.equal(changeAgreement(a, def, registry, context(a), action).ok, false);
  const changed = change(a, { ...action, amendmentId: "amendment-1" }, def);
  assert.equal(changed.amendments[0].proposalId, null); assert.equal(changed.terms[0].title, "Direct");
});
test("G6.4: breach preserves agreement; expiry and suspension deactivate effectiveness without erasing terms", () => {
  let a = active(); a = change(a, { kind: "breach" }); assert.equal(a.lifecycle, "breached"); assert.equal(agreementIsEffective(a, d, 20), true);
  assert.equal(agreementIsEffective(a, { ...d, effectiveLifecycles: ["active"] }, 20), false);
  a = change(a, { kind: "suspend" }); assert.equal(agreementIsEffective(a, d, 20), false); a = change(a, { kind: "resume" });
  assert.equal(agreementIsEffective(a, d, 100), false);
  assert.equal(changeAgreement(a, d, registry, context(a), { kind: "expire" }).ok, false);
  a = change(a, { kind: "expire" }, d, { worldTick: 100 }); assert.equal(a.terms.length, 1); assert.equal(a.proposals.length, 1);
  assert.equal(changeAgreement(a, d, registry, context(a), { kind: "resume" }).ok, false);
});
test("G6.4: renewal extends duration only under explicit automatic policy and records event", () => {
  const a = active(); assert.equal(changeAgreement(a, d, registry, context(a), { kind: "renew", expiresAtWorldTick: 200, automatic: true }).ok, false);
  const renewed = change(a, { kind: "renew", expiresAtWorldTick: 200, automatic: false });
  assert.equal(renewed.duration.expiresAtWorldTick, 200); assert.equal(renewed.events.at(-1)?.kind, "renew");
  assert.equal(changeAgreement(renewed, d, registry, context(renewed), { kind: "renew", expiresAtWorldTick: 199, automatic: false }).ok, false);
});
test("G6.4: idempotent vote/lifecycle no-ops do not append audit or revision", () => {
  let a = offer(); a = change(a, { kind: "accept", proposalId: a.proposals[0].id, expectedProposalRevision: 0, partyId: "a" });
  assert.strictEqual(change(a, { kind: "accept", proposalId: a.proposals[0].id, expectedProposalRevision: 1, partyId: "a" }), a);
  a = change(activate(acceptAll(offer())), { kind: "terminate" }); assert.strictEqual(change(a, { kind: "terminate" }), a);
});
test("G6.4: validators reject corrupt party, history, votes, duration and unavailable term owner", () => {
  const a = active();
  assert.equal(validateAgreementDefinition({ ...d, minParties: 1 }).ok, false);
  assert.equal(validateAgreementInstance({ ...a, parties: [a.parties[0], a.parties[0]] }, d, registry).ok, false);
  assert.equal(validateAgreementInstance({ ...a, duration: { startsAtWorldTick: 10, expiresAtWorldTick: 10 } }, d, registry).ok, false);
  assert.equal(validateAgreementInstance({ ...a, events: [a.events[0], a.events[0]] }, d, registry).ok, false);
  assert.equal(validateAgreementInstance({ ...a, terms: [{ ...term(), type: "test:missing" }] }, { ...d, allowedTermTypes: ["test:missing"] }, registry).ok, false);
  assert.equal(validateAgreementInstance({ ...a, garbage: () => {} }, d, registry).ok, false);
});
test("G6.4: stale entity revision, unknown party and duplicate event fail before mutation", () => {
  const a = active(), before = structuredClone(a);
  assert.equal(changeAgreement(a, d, registry, context(a, { expectedRevision: 0 }), { kind: "breach" }).ok, false);
  assert.equal(changeAgreement(a, d, registry, context(a, { eventId: a.events[0].id }), { kind: "breach" }).ok, false);
  assert.deepEqual(a, before);
  assert.equal(changeAgreement(draft(), d, registry, context(draft()), { kind: "propose", proposalId: "x", partyId: "outsider", terms: [], duration, proposalExpiresAtWorldTick: null }).ok, false);
});
