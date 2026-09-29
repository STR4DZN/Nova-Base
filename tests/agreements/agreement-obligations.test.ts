import test from "node:test";
import assert from "node:assert/strict";
import { ok, type Result } from "../../src/core/contracts/result.js";
import { AgreementTermRegistry, changeAgreement, type AgreementDefinition, type AgreementInstance, type AgreementChangeContext,
  type AgreementTerm, type AgreementAction } from "../../src/agreements/agreement-model.js";
import { registerAgreementTermOwners, initializeAgreementObligations, changeObligation, resolveAgreementCompliance,
  resolveAgreementGrants, validateAgreementState, collectAgreementOwnerOperations, type AgreementState, type ObligationAction } from "../../src/agreements/agreement-obligations.js";
import { AgreementEffectOwnerRegistry, prepareAgreementOwnerOperations, executeAgreementOwnerOperations, type AgreementEffectOwner } from "../../src/agreements/agreement-owner-operations.js";
import { CompositeMutationSession } from "../../src/mutations/composite-mutation-session.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const registry = new AgreementTermRegistry(); unwrap(registerAgreementTermOwners(registry));
const d: AgreementDefinition = { id: "test:contract", version: 1, label: "Contract", minParties: 2, maxParties: 2, allowedPartyRoles: ["party"],
  allowedTermTypes: ["domain-manager:obligation", "domain-manager:right", "domain-manager:capability", "domain-manager:owner-operation"],
  amendmentRequiresApproval: false, automaticRenewalAllowed: false, effectiveLifecycles: ["active", "breached"] };
const operation = { id: "payment", ownerId: "test:economy", operation: "test:pay", targetRefs: [{ type: "domain", uuid: "JournalEntry.A" }], payload: { amount: 3 } };
const term = (id: string, type: string, payload: Record<string, unknown>, visibility: "public" | "secret" = "public"): AgreementTerm => ({
  id, type: `domain-manager:${type}`, title: id, text: null, visibility, partyIds: ["a", "b"], payload });
const obligation = term("tribute", "obligation", { kind: "domain-manager:payment", obligatedPartyId: "a", beneficiaryPartyId: "b",
  dueAtWorldTick: 20, graceTicks: 5, overduePolicy: "report", requirementRef: { type: "resource", id: "world:coin" }, consequences: [operation] });
const right = term("access", "right", { beneficiaryPartyId: "b", territoryUuid: "JournalEntry.T", rightType: "domain-manager:entry",
  startsAtWorldTick: null, expiresAtWorldTick: 50, inherited: true, revocable: true, conditionRefs: [], grants: ["test:dock"] });
const capability = term("trade", "capability", { beneficiaryPartyId: "b", capabilityIds: ["test:trade"], scopeRef: null,
  conditionRefs: [{ type: "condition", id: "route-open" }] });
const c = (a: AgreementInstance, patch: Partial<AgreementChangeContext> = {}): AgreementChangeContext => ({ expectedRevision: a.revision,
  eventId: crypto.randomUUID(), at: a.updatedAt + 1, worldTick: 10, reason: "GM evidence review", sourceRefs: [{ type: "manual", id: "gm" }], ...patch });
const change = (a: AgreementInstance, action: AgreementAction) => unwrap(changeAgreement(a, d, registry, c(a), action));
function fixture(terms = [obligation, right, capability]): AgreementState {
  let a: AgreementInstance = { schemaVersion: 1, id: crypto.randomUUID(), definitionId: d.id, definitionVersion: 1, revision: 0, label: "Contract",
    visibility: "public", parties: ["a", "b"].map(id => ({ id, role: "party", ref: { type: "domain", uuid: `JournalEntry.${id.toUpperCase()}` } })),
    terms: [], duration: { startsAtWorldTick: null, expiresAtWorldTick: 100 }, lifecycle: "draft", createdAt: 0, updatedAt: 0,
    proposals: [], amendments: [], events: [], supersedesId: null };
  a = change(a, { kind: "propose", proposalId: "offer", partyId: "a", terms, duration: a.duration, proposalExpiresAtWorldTick: null });
  for (const partyId of ["a", "b"]) a = change(a, { kind: "accept", proposalId: "offer", expectedProposalRevision: a.proposals[0].revision, partyId });
  a = change(a, { kind: "activate", proposalId: "offer", expectedProposalRevision: a.proposals[0].revision });
  return unwrap(validateAgreementState({ agreement: a, obligations: initializeAgreementObligations(a) }, d, registry));
}
const mutate = (s: AgreementState, action: ObligationAction) => unwrap(changeObligation(s, d, registry, s.obligations[0].id,
  s.obligations[0].revision, c(s.agreement), action));

test("G6.5: due and grace are read models, not automatic confirmed breach/termination", () => {
  const s = fixture(), before = structuredClone(s);
  assert.equal(unwrap(resolveAgreementCompliance(s, 19))[0].lifecycle, "pending");
  assert.equal(unwrap(resolveAgreementCompliance(s, 20))[0].lifecycle, "due");
  assert.equal(unwrap(resolveAgreementCompliance(s, 25))[0].pastGrace, false);
  const late = unwrap(resolveAgreementCompliance(s, 26))[0]; assert.equal(late.pastGrace, true); assert.equal(late.confirmedBreach, false);
  assert.equal(late.allegedBreach, false); assert.equal(s.agreement.lifecycle, "active"); assert.deepEqual(s, before);
});
test("G6.5: overdue policy may allege breach but never confirms it", () => {
  const s = fixture([{ ...obligation, payload: { ...obligation.payload, overduePolicy: "allege-breach" } }]);
  const result = unwrap(resolveAgreementCompliance(s, 100))[0]; assert.equal(result.allegedBreach, true); assert.equal(result.confirmedBreach, false);
  assert.equal(s.obligations[0].lifecycle, "pending");
});
test("G6.5: evidence, allegation, contest and decision are audited separately", () => {
  let s = fixture(); s = mutate(s, { kind: "allege" }); s = mutate(s, { kind: "contest" });
  s = mutate(s, { kind: "evidence", evidence: { id: "receipt", ref: { type: "economy-receipt", id: "payment-receipt" }, statement: "Payment was made",
    position: "contest", visibility: "secret", at: s.agreement.updatedAt + 1 } });
  assert.equal(s.obligations[0].lifecycle, "pending"); assert.equal(s.obligations[0].contested, true);
  s = mutate(s, { kind: "decide", lifecycle: "satisfied" }); assert.equal(s.obligations[0].contested, false); assert.equal(s.obligations[0].events.length, 4);
  assert.equal(s.agreement.lifecycle, "active"); assert.equal(s.obligations[0].evidence.length, 1);
  assert.equal(changeObligation(s, d, registry, s.obligations[0].id, s.obligations[0].revision, c(s.agreement), { kind: "decide", lifecycle: "pending" }).ok, false);
  assert.deepEqual(unwrap(validateAgreementState(JSON.parse(JSON.stringify(s)), d, registry)), s);
});
test("G6.5: confirmed partial breach preserves agreement and unrelated obligations/rights", () => {
  const s = mutate(fixture(), { kind: "decide", lifecycle: "breached" });
  assert.equal(unwrap(resolveAgreementCompliance(s, 30))[0].confirmedBreach, true); assert.equal(s.agreement.lifecycle, "active");
  assert.equal(resolveAgreementGrants(s.agreement, d, 30, () => true, () => true).rights.length, 1);
});
test("G6.5: rights, grants and conditions are derived and cease at source expiry/suspension", () => {
  const s = fixture(), a = s.agreement;
  let grants = resolveAgreementGrants(a, d, 20, () => false, () => true); assert.equal(grants.rights.length, 1); assert.equal(grants.capabilities.length, 1);
  grants = resolveAgreementGrants(a, d, 20, () => true, () => true); assert.equal(grants.capabilities.length, 2);
  assert.equal(resolveAgreementGrants(a, d, 50, () => true, () => true).rights.length, 0);
  assert.equal(resolveAgreementGrants(a, d, 100, () => true, () => true).capabilities.length, 0);
  const suspended = change(a, { kind: "suspend" }); assert.equal(resolveAgreementGrants(suspended, d, 20, () => true, () => true).rights.length, 0);
  assert.equal(a.terms.length, 3); assert.equal(a.parties[1].ref.uuid, "JournalEntry.B");
});
test("G6.5: secret terms are filtered before derived rights/capabilities", () => {
  const a = fixture([{ ...right, visibility: "secret" }, capability]).agreement;
  const gm = resolveAgreementGrants(a, d, 20, () => true, () => true), player = resolveAgreementGrants(a, d, 20, () => true, v => v === "public");
  assert.equal(gm.rights.length, 1); assert.equal(player.rights.length, 0); assert.equal(player.capabilities.length, 1);
});
test("G6.5: amendment preserves obligation source snapshot and creates a new generation for changed requirements", () => {
  const s = fixture(); const a = change(s.agreement, { kind: "amend", proposalId: "unused", partyId: "a", amendmentId: "edit", terms: [
    { ...obligation, payload: { ...obligation.payload, dueAtWorldTick: 80 } }, right, capability], duration: s.agreement.duration, proposalExpiresAtWorldTick: null });
  const next = unwrap(validateAgreementState({ agreement: a, obligations: initializeAgreementObligations(a, s.obligations) }, d, registry));
  assert.equal(next.obligations.length, 2); assert.deepEqual(next.obligations[0], s.obligations[0]);
  const compliance = unwrap(resolveAgreementCompliance(next, 30)); assert.equal(compliance[0].applicable, false); assert.equal(compliance[1].lifecycle, "pending");
});
test("G6.5: stale revisions, orphan term, duplicate evidence and malformed structured payload fail closed", () => {
  const s = fixture(), id = s.obligations[0].id;
  assert.equal(changeObligation(s, d, registry, id, 99, c(s.agreement), { kind: "allege" }).ok, false);
  assert.equal(changeObligation(s, d, registry, id, 0, c(s.agreement, { expectedRevision: 0 }), { kind: "allege" }).ok, false);
  assert.equal(validateAgreementState({ ...s, obligations: [{ ...s.obligations[0], termId: "missing" }] }, d, registry).ok, false);
  assert.equal(registry.validate({ ...right, payload: { ...right.payload, territoryUuid: "Actor.invalid" } }).ok, false);
  assert.equal(registry.validate({ ...capability, payload: { ...capability.payload, capabilityIds: ["bad"] } }).ok, false);
  assert.strictEqual(unwrap(changeObligation(mutate(s, { kind: "allege" }), d, registry, id, 1,
    c({ ...s.agreement, revision: s.agreement.revision + 1, updatedAt: s.agreement.updatedAt + 1 }), { kind: "allege" })).obligations[0].allegedBreach, true);
});
function owners(calls: string[]) {
  const owner: AgreementEffectOwner = { id: "test:economy", subsystem: "economy", validate: () => ok(undefined), getLockKeys: () => ["domain:A"],
    execute: async (op, ctx) => { calls.push(ctx.operationRef); return ok({ operationId: op.id, receiptRef: { type: "economy-receipt", id: "actual-receipt" }, result: { paid: 3 } }); },
    reconcile: async () => ok("applied"), compensate: async () => ok(undefined) };
  const r = new AgreementEffectOwnerRegistry(); unwrap(r.register(owner)); return r;
}
test("G6.5: owner effects are declared and planned without changing economic balances", () => {
  const calls: string[] = [], r = owners(calls), a = fixture([term("pay", "owner-operation", { operations: [operation] })]).agreement;
  const intents = collectAgreementOwnerOperations(a, d, 20), plan = unwrap(prepareAgreementOwnerOperations(intents, r));
  assert.deepEqual(plan.lockKeys, ["domain:A"]); assert.equal(calls.length, 0);
  assert.equal(prepareAgreementOwnerOperations([operation], new AgreementEffectOwnerRegistry()).ok, false);
  assert.equal(prepareAgreementOwnerOperations([operation, operation], r).ok, false);
});
test("G6.5: execution calls owner through CompositeMutationSession and retains real receipt/identity", async () => {
  const calls: string[] = [], r = owners(calls), plan = unwrap(prepareAgreementOwnerOperations([operation], r));
  const session = unwrap(await CompositeMutationSession.prepare({ commandId: createOpaqueId("cmd"), authorityEpoch: 7,
    lockKeys: ["domain:A"], expectedLockKeys: ["domain:A"], recoveryType: "agreement-effects", parentRef: "agreement" }));
  const receipts = unwrap(await executeAgreementOwnerOperations(plan, r, session));
  assert.equal(receipts[0].receiptRef.id, "actual-receipt"); assert.match(calls[0], /agreement-effect:payment$/);
  const missingLock = unwrap(await CompositeMutationSession.prepare({ commandId: createOpaqueId("cmd"), lockKeys: [], recoveryType: "agreement-effects", parentRef: "agreement" }));
  assert.equal((await executeAgreementOwnerOperations(plan, r, missingLock)).ok, false); assert.equal(calls.length, 1);
});
