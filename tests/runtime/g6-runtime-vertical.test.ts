import test from "node:test";
import assert from "node:assert/strict";
import { composeDomainManagerRuntime } from "../../src/bootstrap/domain-manager-runtime.js";
import { InMemoryDiplomacyStorageAdapter, FoundryDiplomacyStorageAdapter, DIPLOMACY_FLAG, type DiplomacyEntity } from "../../src/diplomacy/diplomacy-store.js";
import { InMemoryTransactionStorageAdapter, FoundryJournalTransactionStorageAdapter, TRANSACTION_DOCUMENT_NAME, TRANSACTION_FLAG_NAMESPACE } from "../../src/mutations/transaction-storage-adapter.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { InMemoryCommandTransport, InMemoryTransportHub } from "../../src/commands/in-memory-command-transport.js";
import { createCommandId } from "../../src/commands/command-envelope.js";
import { emptyTerritoryState } from "../../src/territory/territory-state.js";
import type { Result } from "../../src/core/contracts/result.js";
import { createDiplomacyDraft } from "../../src/diplomacy/diplomacy-drafts.js";
import { DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
import { InMemoryLedgerStorageAdapter } from "../../src/economy/storage/ledger-storage-adapter.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const domainUuid = "JournalEntry.domainG6";
function fixture(adapter = new InMemoryDiplomacyStorageAdapter(), transactions = new InMemoryTransactionStorageAdapter()) {
  const record = { schemaVersion: 1, revision: 0, definition: { identity: { aliases: [], summary: "Test", description: "Test" },
    classification: { kind: "base", scale: "small", tags: [] }, hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: { "domain-manager:domain": { controllers: ["player"] } } } }, state: { lifecycle: "active" },
    metadata: { createdByUserId: "gm", archivedAt: null, source: { type: "manual", ref: null } } };
  const doc = { id: "domainG6", uuid: domainUuid, name: "Test", flags: { "domain-manager": record }, ownership: { default: 0, player: 1 },
    update: async (data: Record<string, unknown>) => { if (data["flags.domain-manager"]) doc.flags["domain-manager"] = structuredClone(data["flags.domain-manager"]) as typeof record; } };
  const hub = new InMemoryTransportHub();
  const ledger = new InMemoryLedgerStorageAdapter();
  const time = { tick: 10 };
  const make = (user = "gm") => composeDomainManagerRuntime({
    domainStore: { get: id => id === doc.id ? doc : undefined, list: () => [doc], create: async () => { throw Error("unused"); } } as any,
    authority: { service: new PrimaryAuthorityService({ getUsers: () => [{ id: "gm", isGM: true, active: true }, { id: user, isGM: user === "gm", active: true }],
      getCurrentUserId: () => user, getPreferredUserId: () => "gm" }, { authorityUserId: "gm", authorityEpoch: 1, initialized: true }) } as any,
    transport: new InMemoryCommandTransport({ currentUserId: user, getAuthorityUserId: () => "gm" }, hub),
    diplomacyStorageAdapter: adapter, transactionStorageAdapter: transactions, ledgerStorageAdapter: ledger, worldTick: () => time.tick });
  return { make, adapter, transactions, time };
}
function relation(id = "rel_00000000-0000-4000-8000-000000000001", visibility = "public") {
  return { definition: { id: "test:relation", version: 1, label: "Relation", symmetry: "symmetric", minParties: 2, maxParties: null,
    allowedPartyTypes: ["domain", "narrative"], allowedPartyRoles: ["partner"], allowMultiple: true, stancePolicy: "derived",
    axes: [{ id: "test:trust", label: "Trust", minimum: -100, maximum: 100, defaultValue: 0 }] },
    state: { relation: { schemaVersion: 1, id, definitionId: "test:relation", definitionVersion: 1, revision: 0, label: "Partners", lifecycle: "active", scope: null,
      baseAxes: [{ axisId: "test:trust", value: 20, fromPartyId: null, toPartyId: null }], visibility, createdAt: 0, updatedAt: 0, endedAt: null,
      parties: [{ id: "a", role: "partner", ref: { type: "domain", uuid: domainUuid } }, { id: "b", role: "partner", ref: { type: "narrative", id: "guild" } }] }, modifiers: [], events: [] } };
}
const incident = { kind: "incident", deltas: [{ axisId: "test:trust", value: 5, fromPartyId: null, toPartyId: null }] };
const command = (type: string, payload: unknown) => ({ contractVersion: 1 as const, commandId: createCommandId(), type, payload, issuedAtReal: Date.now() });
async function prepareAgreement(r: ReturnType<typeof composeDomainManagerRuntime>, terms: readonly any[]) {
  const draft = createDiplomacyDraft("agreement", "Treaty", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public");
  unwrap(await r.diplomacy.agreements.create({ ...draft, reason: "Create" }));
  const modify = async (action: unknown) => { const d: any = unwrap(await r.diplomacy.agreements.query({ id: draft.id }));
    return r.diplomacy.agreements.modify({ id: draft.id, expectedRevision: d.revision, action, reason: "GM decision" }); };
  unwrap(await modify({ kind: "propose", proposalId: "offer", partyId: "party-0", terms, duration: { startsAtWorldTick: null, expiresAtWorldTick: 100 }, proposalExpiresAtWorldTick: null }));
  for (const partyId of ["party-0", "party-1"]) { const d: any = unwrap(await r.diplomacy.agreements.query({ id: draft.id })); unwrap(await modify({ kind: "accept", proposalId: "offer", expectedProposalRevision: d.proposals[0].revision, partyId })); }
  return { id: draft.id, modify, activate: () => modify({ kind: "activate", proposalId: "offer", expectedProposalRevision: 2, amendmentId: "activation" }) };
}
const economicOperation = { id: "pay", ownerId: "domain-manager:economy", operation: "economy:adjust", targetRefs: [{ type: "domain", uuid: domainUuid }],
  payload: { domainUuid, resourceId: "domain-manager:treasury", deltaMinor: 7, reason: "Treaty consequence" } };
test("review G6: public tickets retry the same intent once and status authenticates remote callers", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger"), id = relation().state.relation.id;
  try { await gm.initialize(); unwrap(await gm.diplomacy.relations.create({ id, data: relation(), reason: "Create" }));
    const ticket = unwrap(gm.diplomacy.commands.prepare("relations:modify", { id, expectedRevision: 0, action: incident, reason: "Once" }));
    assert.ok(Object.isFrozen(ticket)); assert.ok(Object.isFrozen(ticket.payload));
    assert.equal(unwrap(await gm.diplomacy.commands.execute(ticket)).status, "executed");
    assert.equal(unwrap(await gm.diplomacy.commands.retry(ticket)).status, "executed");
    assert.equal((unwrap(await gm.diplomacy.relations.query({ id })) as any).revision, 1);
    assert.equal((await player.diplomacy.commands.status(ticket.commandId)).ok, false);
    const request = unwrap(player.diplomacy.commands.prepare("diplomacy:submit-proposal", { id: "ticket-request", intent: { kind: "relation", mode: "modify", id,
      expectedRevision: 1, action: incident, reason: "Proposal" } }));
    assert.equal(unwrap(await player.diplomacy.commands.execute(request)).status, "executed");
    assert.equal(unwrap(await player.diplomacy.commands.status(request.commandId)).status, "executed");
    assert.equal((await stranger.diplomacy.commands.status(request.commandId)).ok, false);
    assert.equal(gm.diplomacy.commands.prepare("economy:adjust", {}).ok, false);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("review G6: dispute participation cannot disclose another territory's restricted claim", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  const territory = createDiplomacyDraft("territory", "Public territory", [], "public");
  const dispute = createDiplomacyDraft("dispute", "Restricted dispute", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "restricted", [territory.id]);
  try { await gm.initialize();
    const data: any = territory.data; data.claims = [{ id: "restricted-claim-marker", sourceRef: { type: "manual", id: "gm" }, visibility: "restricted",
      startsAtWorldTick: 0, expiresAtWorldTick: null, claimantRef: { type: "narrative", id: "guild" }, claimType: "domain-manager:ownership",
      lifecycle: "active", contested: false, strength: null, inherited: false }];
    unwrap(await gm.diplomacy.territory.create({ id: territory.id, data, reason: "Create" }));
    const disputeData: any = dispute.data; disputeData.claimRefs = [{ territoryUuid: territory.id, claimId: "restricted-claim-marker" }];
    unwrap(await gm.diplomacy.disputes.create({ id: dispute.id, data: disputeData, reason: "Create" }));
    assert.equal((unwrap(await player.diplomacy.territory.query({ id: territory.id })) as any).claims.length, 0);
    const detail: any = unwrap(await player.diplomacy.disputes.query({ id: dispute.id }));
    assert.equal(detail.claimRefs.length, 0); assert.equal(JSON.stringify(detail).includes("restricted-claim-marker"), false);
    assert.equal((unwrap(await gm.diplomacy.disputes.query({ id: dispute.id })) as any).claimRefs.length, 1);
  } finally { player.destroy(); gm.destroy(); }
});
test("review G6: agreement creation cannot fabricate owner execution receipts", async () => {
  const f = fixture(), gm = f.make(), draft = createDiplomacyDraft("agreement", "New treaty", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public");
  try { await gm.initialize();
    assert.equal((await gm.diplomacy.agreements.create({ id: draft.id, data: { ...(draft.data as object), executedOperations: ["forged"] }, reason: "Create" })).ok, false);
    assert.equal(f.adapter.state.size, 0);
    unwrap(await gm.diplomacy.agreements.create({ ...draft, reason: "Create clean draft" }));
  } finally { gm.destroy(); }
});
test("review G6: durable proposal replay remains bound to the original authenticated proposer after reload", async () => {
  const f = fixture(), first = f.make(), player = f.make("player"), id = relation().state.relation.id;
  const cmd = command("diplomacy:submit-proposal", { id: "private-request", intent: { kind: "relation", mode: "modify", id,
    expectedRevision: 0, action: incident, reason: "Private intent" } });
  try { await first.initialize(); unwrap(await first.diplomacy.relations.create({ id, data: relation(), reason: "Create" }));
    assert.equal(unwrap(await player.commandBus.execute(cmd)).status, "executed");
  } finally { player.destroy(); first.destroy(); }
  const reload = f.make(), original = f.make("player"), stranger = f.make("stranger");
  try { await reload.initialize();
    assert.equal(unwrap(await stranger.commandBus.execute(cmd)).status, "rejected");
    assert.equal(unwrap(await original.commandBus.execute(cmd)).status, "executed");
    assert.equal(f.adapter.state.size, 2);
  } finally { stranger.destroy(); original.destroy(); reload.destroy(); }
});
test("G6.9 runtime: composed owners, immutable facade and durable semantic state survive reload", async () => {
  const f = fixture(), r = f.make();
  try {
    await r.initialize();
    assert.equal(Object.isFrozen(r.publicApi.diplomacy), true);
    assert.equal((r.publicApi.diplomacy as any).store, undefined);
    for (const namespace of ["relations", "reputation", "agreements", "territory", "disputes"]) assert.ok(r.registry.get(`${namespace}:modify`));
    unwrap(await r.diplomacy.relations.create({ id: "rel_00000000-0000-4000-8000-000000000001", data: relation(), reason: "Create" }));
    unwrap(await r.diplomacy.relations.modify({ id: "rel_00000000-0000-4000-8000-000000000001", expectedRevision: 0, action: incident, reason: "Incident" }));
    assert.equal((unwrap(await r.diplomacy.relations.query({ id: "rel_00000000-0000-4000-8000-000000000001" })) as any).scores[0].effective, 25);
  } finally { r.destroy(); }
  const reload = f.make();
  try { await reload.initialize(); const detail: any = unwrap(await reload.diplomacy.relations.query({ id: "rel_00000000-0000-4000-8000-000000000001" }));
    assert.equal(detail.revision, 1); assert.equal(detail.scores[0].effective, 25); assert.equal(detail.history.length, 1);
    assert.equal((await reload.diplomacy.relations.modify({ id: "rel_00000000-0000-4000-8000-000000000001", expectedRevision: 0, action: incident, reason: "Stale" })).ok, false);
  } finally { reload.destroy(); }
});
test("G6.9 runtime: authenticated remote sender cannot forge GM or inspect secrets", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try {
    await gm.initialize();
    unwrap(await gm.diplomacy.relations.create({ id: "rel_00000000-0000-4000-8000-000000000001", data: relation(), reason: "Create" }));
    unwrap(await gm.diplomacy.relations.create({ id: "rel_00000000-0000-4000-8000-000000000002", data: relation("rel_00000000-0000-4000-8000-000000000002", "secret"), reason: "Create" }));
    const value = { id: "hidden", axisId: "test:trust", value: 60, fromPartyId: null, toPartyId: null,
      source: { type: "incident", id: "secret-source" }, visibility: "secret", lifecycle: "active", createdAt: 0,
      expiresAt: null, expiresAtWorldTick: null, stackKey: "test:stack", stacking: "add" };
    unwrap(await gm.diplomacy.relations.modify({ id: "rel_00000000-0000-4000-8000-000000000001", expectedRevision: 0, action: { kind: "modifier", value }, reason: "Hidden" }));
    const detail: any = unwrap(await player.diplomacy.relations.query({ id: "rel_00000000-0000-4000-8000-000000000001" }));
    assert.equal(detail.scores[0].effective, 20); assert.equal(JSON.stringify(detail).includes("secret-source"), false);
    assert.equal((await player.diplomacy.relations.query({ id: "rel_00000000-0000-4000-8000-000000000002" })).ok, false);
    assert.equal((unwrap(await player.diplomacy.relations.query()) as any).total, 1);
    const forged = unwrap(await player.commandBus.execute(command("relations:modify", { id: "rel_00000000-0000-4000-8000-000000000001", expectedRevision: 1, action: incident, reason: "Forged", isGm: true, senderUserId: "gm" })));
    assert.equal(forged.status, "rejected");
    assert.equal((await stranger.diplomacy.capabilities(domainUuid)).ok, false);
  } finally { player.destroy(); stranger.destroy(); gm.destroy(); }
});
test("G6.9 runtime: durable command dedupe persists after process restart", async () => {
  const f = fixture(), first = f.make(), cmd = command("relations:modify", { id: "rel_00000000-0000-4000-8000-000000000001", expectedRevision: 0, action: incident, reason: "Once" });
  try { await first.initialize(); unwrap(await first.diplomacy.relations.create({ id: "rel_00000000-0000-4000-8000-000000000001", data: relation(), reason: "Create" }));
    assert.equal(unwrap(await first.commandBus.execute(cmd)).status, "executed"); } finally { first.destroy(); }
  const second = f.make();
  try { await second.initialize(); assert.equal(unwrap(await second.commandBus.execute(cmd)).status, "executed");
    const detail: any = unwrap(await second.diplomacy.relations.query({ id: "rel_00000000-0000-4000-8000-000000000001" })); assert.equal(detail.revision, 1); assert.equal(detail.history.length, 1);
    const conflict = unwrap(await second.commandBus.execute({ ...cmd, payload: { ...cmd.payload, reason: "Different" } })); assert.equal(conflict.status, "rejected");
  } finally { second.destroy(); }
});
test("G6.9 runtime: uncertain storage is fenced and recovered forward from durable intent", async () => {
  class Uncertain extends InMemoryDiplomacyStorageAdapter { fail = true; override async write(e: DiplomacyEntity) { await super.write(e); if (this.fail) { this.fail = false; throw Error("lost response"); } } }
  const f = fixture(new Uncertain()), first = f.make();
  try { await first.initialize(); const result = await first.diplomacy.relations.create({ id: "rel_00000000-0000-4000-8000-000000000001", data: relation(), reason: "Create" }); assert.equal(result.ok, false);
    assert.equal((await first.diplomacy.relations.query({ id: "rel_00000000-0000-4000-8000-000000000001" })).ok, false);
  } finally { first.destroy(); }
  const second = f.make();
  try { await second.initialize(); await second.handleAuthorityTransition();
    const detail: any = unwrap(await second.diplomacy.relations.query({ id: "rel_00000000-0000-4000-8000-000000000001" })); assert.equal(detail.revision, 0);
    assert.equal(f.adapter.state.size, 1);
  } finally { second.destroy(); }
});
test("G6.9 runtime: shared location hierarchy rejects missing/cyclic parent through semantic command", async () => {
  const f = fixture(), r = f.make();
  const state = (id: string) => emptyTerritoryState({ schemaVersion: 1, uuid: `JournalEntry.${id}`, revision: 0, label: id,
    kind: "test:region", scale: "region", visibility: "public", createdAt: 0, updatedAt: 0, locatedInUuid: null, administrativeParentUuid: null, geography: {}, hierarchyHistory: [] });
  try { await r.initialize();
    for (const id of ["a", "b"]) unwrap(await r.diplomacy.territory.create({ id: `JournalEntry.${id}`, data: state(id), reason: "Create" }));
    unwrap(await r.diplomacy.territory.modify({ id: "JournalEntry.a", expectedRevision: 0, action: { kind: "reparent", parents: { locatedInUuid: "JournalEntry.b", administrativeParentUuid: null } }, reason: "Nest" }));
    assert.equal((await r.diplomacy.territory.modify({ id: "JournalEntry.b", expectedRevision: 0, action: { kind: "reparent", parents: { locatedInUuid: "JournalEntry.a", administrativeParentUuid: null } }, reason: "Cycle" })).ok, false);
  } finally { r.destroy(); }
});
test("G6.9 persistence: canonical journals have neutral names and deny public ownership", async () => {
  let input: any;
  const host: any = { journal: { contents: [] }, create: async (data: any) => { input = data; return { id: "private", flags: data.flags, ownership: data.ownership, update: async () => {}, delete: async () => {} }; } };
  const adapter = new FoundryDiplomacyStorageAdapter(host);
  const entity: DiplomacyEntity = { schemaVersion: 1, kind: "relation", id: "rel_00000000-0000-4000-8000-000000000001", revision: 0, data: relation(), receipts: [] };
  await adapter.write(entity); assert.deepEqual(input.ownership, { default: 0 }); assert.equal(input.name.includes("Partners"), false);
  host.journal.contents = [{ id: "leaked", flags: { [DIPLOMACY_FLAG]: entity }, ownership: { default: 1 } }];
  await assert.rejects(adapter.loadAll(), /NOT_PRIVATE/);
});
test("G6.9 proposals: controller proposes, GM edits and approves atomically, original survives reload", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger"), id = "rel_00000000-0000-4000-8000-000000000001";
  const intent = { kind: "relation" as const, mode: "modify" as const, id, expectedRevision: 0, action: incident, reason: "Player request" };
  try { await gm.initialize(); unwrap(await gm.diplomacy.relations.create({ id, data: relation(), reason: "Create" }));
    assert.equal((await stranger.diplomacy.proposals.submit({ id: "unauthorized", intent })).ok, false);
    unwrap(await player.diplomacy.proposals.submit({ id: "request", intent }));
    assert.equal((unwrap(await gm.diplomacy.relations.query({ id })) as any).scores[0].effective, 20);
    assert.equal((await stranger.diplomacy.proposals.query({ id: "request" })).ok, false);
    assert.equal((await player.diplomacy.proposals.decide({ id: "request", expectedRevision: 0, decision: "approve", reason: "Fake GM" })).ok, false);
    const editedIntent = { ...intent, action: { ...incident, deltas: [{ ...incident.deltas[0], value: 3 }] }, reason: "Adjusted" };
    unwrap(await gm.diplomacy.proposals.decide({ id: "request", expectedRevision: 0, decision: "approve", reason: "Reviewed", editedIntent }));
    const audit: any = unwrap(await player.diplomacy.proposals.query({ id: "request" })); assert.deepEqual(audit.original, intent); assert.deepEqual(audit.decision.approvedIntent, editedIntent);
    assert.equal((unwrap(await gm.diplomacy.relations.query({ id })) as any).scores[0].effective, 23);
    assert.equal((await gm.diplomacy.proposals.decide({ id: "request", expectedRevision: 1, decision: "approve", reason: "Again" })).ok, false);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); const audit: any = unwrap(await reload.diplomacy.proposals.query({ id: "request" }));
    assert.deepEqual(audit.original, intent); assert.equal(audit.lifecycle, "approved"); } finally { reload.destroy(); }
});
test("G6.9 proposals: stale approval fails closed and rejection preserves the request", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), id = "rel_00000000-0000-4000-8000-000000000001";
  const intent = { kind: "relation" as const, mode: "modify" as const, id, expectedRevision: 0, action: incident, reason: "Request" };
  try { await gm.initialize(); unwrap(await gm.diplomacy.relations.create({ id, data: relation(), reason: "Create" }));
    unwrap(await player.diplomacy.proposals.submit({ id: "request", intent }));
    unwrap(await gm.diplomacy.relations.modify({ id, expectedRevision: 0, action: incident, reason: "Meanwhile" }));
    assert.equal((await gm.diplomacy.proposals.decide({ id: "request", expectedRevision: 0, decision: "approve", reason: "Stale" })).ok, false);
    assert.equal((unwrap(await gm.diplomacy.proposals.query({ id: "request" })) as any).lifecycle, "pending");
    unwrap(await gm.diplomacy.proposals.decide({ id: "request", expectedRevision: 0, decision: "reject", reason: "State changed" }));
    const audit: any = unwrap(await player.diplomacy.proposals.query({ id: "request" })); assert.deepEqual(audit.original, intent); assert.equal(audit.lifecycle, "rejected");
  } finally { player.destroy(); gm.destroy(); }
});
test("G6.9 UI: draft forms create each owner through authority and open a paginated escaped inspector", async () => {
  const f = fixture(), r = f.make(), c = new DiplomacyApplicationController(r.diplomacy);
  try { await r.initialize();
    let territory = "";
    for (const tab of ["relations", "reputation", "agreements", "territory", "disputes"] as const) {
      c.selectTab(tab); unwrap(await c.load());
      unwrap(await c.create({ label: "<script>Test</script>", subject: domainUuid, audience: "guild", visibility: "public", reason: "Create through UI", territories: territory }));
      unwrap(await c.load()); assert.equal(c.list.items.length, 1); assert.ok(c.detail); assert.equal(c.detail.revision, 0);
      assert.equal(c.render().includes("<script>Test</script>"), false); assert.ok(c.render().includes("&lt;script&gt;Test&lt;/script&gt;"));
      if (tab === "territory") territory = c.detail.id;
    }
    const app = await r.diplomacy.open(); assert.ok(app.element.innerHTML.includes("Relações")); await app.close();
  } finally { r.destroy(); }
});
test("G6.9 UI: territorial preview binds the confirmed payload and stale/edited fields require another preview", async () => {
  const f = fixture(), r = f.make(), c = new DiplomacyApplicationController(r.diplomacy);
  try { await r.initialize(); c.selectTab("territory"); unwrap(await c.load()); unwrap(await c.create({ label: "Region", visibility: "public", reason: "Create" })); unwrap(await c.load());
    const fields = { kind: "reparent", physical: "", administrative: "", reason: "Confirm roots" };
    assert.equal((await c.change(fields)).ok, false); unwrap(await c.change(fields, true));
    assert.equal((await c.change({ ...fields, reason: "Edited after preview" })).ok, false); unwrap(await c.change(fields));
  } finally { r.destroy(); }
});
test("G6.9 agreements: real economic owner executes once on activation, remains once after suspend/resume and restart", async () => {
  const f = fixture(), r = f.make(), draft = createDiplomacyDraft("agreement", "Trade treaty", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public");
  try { await r.initialize();
    const account = unwrap(await r.economy.createAccount({ domainUuid, resourceId: "domain-manager:treasury", initialBalanceMinor: 100 })); assert.equal(account.status, "executed");
    unwrap(await r.diplomacy.agreements.create({ ...draft, reason: "Create" }));
    const modify = async (action: unknown) => { const d: any = unwrap(await r.diplomacy.agreements.query({ id: draft.id })); return unwrap(await r.diplomacy.agreements.modify({ id: draft.id, expectedRevision: d.revision, action, reason: "Reviewed treaty" })); };
    const term = { id: "payment", type: "domain-manager:owner-operation", title: "Payment", text: null, visibility: "public", partyIds: ["party-0", "party-1"],
      payload: { operations: [{ id: "pay", ownerId: "domain-manager:economy", operation: "economy:adjust", targetRefs: [{ type: "domain", uuid: domainUuid }],
        payload: { domainUuid, resourceId: "domain-manager:treasury", deltaMinor: 7, reason: "Treaty activation" } }] } };
    await modify({ kind: "propose", proposalId: "offer", partyId: "party-0", terms: [term], duration: { startsAtWorldTick: null, expiresAtWorldTick: 100 }, proposalExpiresAtWorldTick: null });
    for (const partyId of ["party-0", "party-1"]) { const d: any = unwrap(await r.diplomacy.agreements.query({ id: draft.id })); await modify({ kind: "accept", proposalId: "offer", expectedProposalRevision: d.proposals[0].revision, partyId }); }
    await modify({ kind: "activate", proposalId: "offer", expectedProposalRevision: 2, amendmentId: "activate" });
    const count = r.ledgerStore.query({ domainUuid }).length; assert.equal(count, 2);
    await modify({ kind: "suspend" }); await modify({ kind: "resume" }); assert.equal(r.ledgerStore.query({ domainUuid }).length, count);
  } finally { r.destroy(); }
  const reload = f.make(); try { await reload.initialize(); const d: any = unwrap(await reload.diplomacy.agreements.query({ id: draft.id }));
    unwrap(await reload.diplomacy.agreements.modify({ id: draft.id, expectedRevision: d.revision, action: { kind: "breach" }, reason: "Explicit breach" }));
    assert.equal(reload.ledgerStore.query({ domainUuid }).length, 2);
  } finally { reload.destroy(); }
});
test("G6.10 security: recovery journals deny observer access to secret before/after images", async () => {
  let created: any;
  const host: any = { journal: { contents: [], get: () => undefined }, createJournalEntry: async (p: any) => { created = p; return { id: "tx" }; } };
  const adapter = new FoundryJournalTransactionStorageAdapter(host);
  await adapter.saveSnapshot({ schemaVersion: 1, records: [], updatedAt: 0 }); assert.deepEqual(created.ownership, { default: 0 });
  host.journal.contents = [{ id: "tx", name: TRANSACTION_DOCUMENT_NAME, flags: { [TRANSACTION_FLAG_NAMESPACE]: { schemaVersion: 1, records: [], updatedAt: 0 } }, ownership: { observer: 1 } }];
  await assert.rejects(new FoundryJournalTransactionStorageAdapter(host).loadSnapshot(), /NOT_PRIVATE/);
});
test("G6.10 recovery: partial batch transfer is isolated and completed without erasing competing claims", async () => {
  class BatchFailure extends InMemoryDiplomacyStorageAdapter {
    failId: string | null = null;
    override async write(e: DiplomacyEntity) { if (e.id === this.failId) { this.failId = null; throw Error("disk failure"); } await super.write(e); }
  }
  const adapter = new BatchFailure(), f = fixture(adapter), first = f.make(), territories: string[] = [];
  const claim = (id: string, owner: string) => ({ id, sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 10, expiresAtWorldTick: null,
    claimantRef: { type: "narrative", id: owner }, claimType: "domain-manager:ownership", lifecycle: "active", contested: false, strength: null, inherited: false });
  try { await first.initialize();
    for (const label of ["A", "B"]) { const draft = createDiplomacyDraft("territory", label, [], "public"), data: any = draft.data;
      data.claims = [claim("old", "original"), claim("competitor", "competitor")]; unwrap(await first.diplomacy.territory.create({ id: draft.id, data, reason: "Create" })); territories.push(draft.id); }
    adapter.failId = territories[1];
    const result = await first.diplomacy.territory.modify({ id: territories[0], expectedRevision: 0, reason: "Batch sale", action: { kind: "transfer",
      targets: territories.map(territoryUuid => ({ territoryUuid, expectedRevision: 0, supersedeClaimIds: ["old"], newClaim: claim("new", "buyer") })) } });
    assert.equal(result.ok, false); for (const id of territories) assert.equal((await first.diplomacy.territory.query({ id })).ok, false);
  } finally { first.destroy(); }
  const reload = f.make(); try { await reload.initialize(); await reload.handleAuthorityTransition();
    for (const id of territories) { const d: any = unwrap(await reload.diplomacy.territory.query({ id })); assert.equal(d.revision, 1);
      assert.equal(d.claims.find((c: any) => c.id === "old").lifecycle, "superseded"); assert.equal(d.claims.find((c: any) => c.id === "competitor").lifecycle, "active");
      assert.equal(d.claims.find((c: any) => c.id === "new").claimantRef.id, "buyer"); assert.equal(d.events.length, 1); }
  } finally { reload.destroy(); }
});
test("G6.10 recovery: divergent canonical state is never overwritten by automatic recovery", async () => {
  class Uncertain extends InMemoryDiplomacyStorageAdapter { fail = true; override async write(e: DiplomacyEntity) { await super.write(e); if (this.fail) { this.fail = false; throw Error("lost confirmation"); } } }
  const f = fixture(new Uncertain()), first = f.make(), id = "rel_00000000-0000-4000-8000-000000000001";
  try { await first.initialize(); assert.equal((await first.diplomacy.relations.create({ id, data: relation(), reason: "Create" })).ok, false); } finally { first.destroy(); }
  const current: any = await f.adapter.read("relation", id); current.data.state.relation.label = "External change"; await f.adapter.write(current);
  const reload = f.make(); try { await reload.initialize(); await reload.handleAuthorityTransition();
    assert.equal((await reload.diplomacy.relations.query({ id })).ok, false); assert.equal((await f.adapter.read("relation", id) as any).data.state.relation.label, "External change");
  } finally { reload.destroy(); }
});
test("G6.10 grants: authority applies source visibility, conditions, scope and expiry before provenance", async () => {
  const f = fixture(), r = f.make(), player = f.make("player"), draft = createDiplomacyDraft("territory", "Port", [], "public");
  try { await r.initialize(); unwrap(await r.diplomacy.territory.create({ ...draft, reason: "Create" }));
    let revision = 0;
    for (const [id, visibility, conditionRefs] of [["visible", "public", []], ["hidden", "secret", []], ["conditional", "public", [{ type: "condition", id: "unresolved" }]]] as const) {
      unwrap(await r.diplomacy.territory.modify({ id: draft.id, expectedRevision: revision++, reason: "Grant", action: { kind: "right", value: {
        id, sourceRef: { type: "manual", id: "gm" }, visibility, startsAtWorldTick: 0, expiresAtWorldTick: 20, beneficiaryRef: { type: "domain", uuid: domainUuid },
        rightType: "domain-manager:entry", inherited: true, revocable: true, active: true, conditionRefs, grants: [`test:${id}`] } } }));
    }
    const caps: any = unwrap(await player.diplomacy.capabilities(domainUuid, draft.id));
    assert.ok(JSON.stringify(caps).includes("test:visible")); assert.equal(JSON.stringify(caps).includes("test:hidden"), false); assert.equal(JSON.stringify(caps).includes("test:conditional"), false);
    assert.equal(JSON.stringify(unwrap(await player.diplomacy.capabilities(domainUuid))).includes("test:visible"), false);
    f.time.tick = 20; assert.equal(JSON.stringify(unwrap(await player.diplomacy.capabilities(domainUuid, draft.id))).includes("test:visible"), false);
  } finally { player.destroy(); r.destroy(); }
});
test("G6.10 tree and scale: indexed branches are independent and list pagination excludes secret counts", async () => {
  const f = fixture(), r = f.make(), player = f.make("player");
  const root = createDiplomacyDraft("territory", "Root", [], "public"), child = createDiplomacyDraft("territory", "Child", [], "public");
  try { await r.initialize(); unwrap(await r.diplomacy.territory.create({ ...root, reason: "Create" })); unwrap(await r.diplomacy.territory.create({ ...child, reason: "Create" }));
    unwrap(await r.diplomacy.territory.modify({ id: child.id, expectedRevision: 0, reason: "Nest", action: { kind: "reparent", parents: { locatedInUuid: root.id, administrativeParentUuid: null } } }));
    assert.equal((unwrap(await r.diplomacy.territory.query({ parentUuid: root.id })) as any).items[0].id, child.id);
    assert.equal((unwrap(await r.diplomacy.territory.query({ parentUuid: root.id, treeAxis: "administrativeParentUuid" })) as any).total, 0);
    assert.equal((await r.diplomacy.territory.query({ limit: 101 })).ok, false);
  } finally { player.destroy(); r.destroy(); }
  for (let i = 0; i < 250; i++) { const draft = createDiplomacyDraft("territory", `Region ${i}`, [], i < 50 ? "secret" : "public");
    await f.adapter.write({ schemaVersion: 1, kind: "territory", id: draft.id, revision: 0, data: draft.data, receipts: [] }); }
  const gm2 = f.make(), p2 = f.make("player"); try { await gm2.initialize(); const page: any = unwrap(await p2.diplomacy.territory.query({ limit: 30, offset: 30 }));
    assert.equal(page.total, 202); assert.equal(page.items.length, 30); assert.equal(page.items.some((x: any) => "claims" in x), false);
  } finally { p2.destroy(); gm2.destroy(); }
});
test("G6.10 security: public territory cannot expose private parent, target or unclassified metadata", async () => {
  const f = fixture(), r = f.make(), player = f.make("player"), secret = createDiplomacyDraft("territory", "Hidden", [], "secret"), publicDraft = createDiplomacyDraft("territory", "Visible", [], "public");
  try { await r.initialize(); unwrap(await r.diplomacy.territory.create({ ...secret, reason: "Create" }));
    const data: any = publicDraft.data; data.territory.locatedInUuid = secret.id; data.hiddenMetadata = "private-note"; data.territory.hiddenMetadata = "private-note";
    data.claims.push({ id: "visible", sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 0, expiresAtWorldTick: null,
      claimantRef: { type: "narrative", id: "claimant", hiddenMetadata: "private-note" }, claimType: "domain-manager:ownership", lifecycle: "active", contested: false, strength: null, inherited: false, hiddenMetadata: "private-note" });
    data.links.push({ id: "hidden-target", sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 0, expiresAtWorldTick: null,
      targetTerritoryUuid: secret.id, linkType: "domain-manager:portal", direction: "both", status: "operational", cost: null, capacity: null, dependencyRefs: [] });
    unwrap(await r.diplomacy.territory.create({ id: publicDraft.id, data, reason: "Create" }));
    const d: any = unwrap(await player.diplomacy.territory.query({ id: publicDraft.id }));
    assert.equal(d.territory.locatedInUuid, null); assert.equal(d.links.length, 0); assert.equal(JSON.stringify(d).includes("private-note"), false); assert.equal(JSON.stringify(d).includes(secret.id), false);
    assert.equal((await player.diplomacy.territory.query({ parentUuid: secret.id })).ok, false); assert.equal((await player.diplomacy.capabilities(domainUuid, secret.id)).ok, false);
  } finally { player.destroy(); r.destroy(); }
});
test("G6.10 security: GM-only changes to a reviewed proposal stay on the authority", async () => {
  const f = fixture(), r = f.make(), player = f.make("player"), id = "rel_00000000-0000-4000-8000-000000000001";
  try { await r.initialize(); unwrap(await r.diplomacy.relations.create({ id, data: relation(), reason: "Create" }));
    const value = { id: "private-modifier", axisId: "test:trust", value: 5, fromPartyId: null, toPartyId: null, source: { type: "incident", id: "private-source" },
      visibility: "public", lifecycle: "active", createdAt: 0, expiresAt: null, expiresAtWorldTick: null, stackKey: "test:stack", stacking: "add" };
    const intent: any = { kind: "relation", mode: "modify", id, expectedRevision: 0, action: { kind: "modifier", value }, reason: "Request" };
    unwrap(await player.diplomacy.proposals.submit({ id: "request", intent }));
    unwrap(await r.diplomacy.proposals.decide({ id: "request", expectedRevision: 0, decision: "approve", reason: "Private review",
      editedIntent: { ...intent, action: { kind: "modifier", value: { ...value, visibility: "secret", source: { type: "incident", id: "gm-secret-source" } } } } }));
    const p: any = unwrap(await player.diplomacy.proposals.query({ id: "request" })); assert.deepEqual(p.original, intent);
    assert.equal(JSON.stringify(p).includes("gm-secret-source"), false); assert.equal(JSON.stringify(unwrap(await r.diplomacy.proposals.query({ id: "request" }))).includes("gm-secret-source"), true);
  } finally { player.destroy(); r.destroy(); }
});
test("G6.10 effects: economic receipt is reconciled after lost parent-save response without paying twice", async () => {
  class UncertainAgreement extends InMemoryDiplomacyStorageAdapter { fail = true; override async write(e: DiplomacyEntity) {
    await super.write(e); if (this.fail && e.kind === "agreement" && (e.data as any).state.agreement.lifecycle === "active") { this.fail = false; throw Error("lost save response"); } } }
  const f = fixture(new UncertainAgreement()), first = f.make(); let id = "";
  try { await first.initialize(); assert.equal(unwrap(await first.economy.createAccount({ domainUuid, resourceId: "domain-manager:treasury", initialBalanceMinor: 100 })).status, "executed");
    const a = await prepareAgreement(first, [{ id: "payment", type: "domain-manager:owner-operation", title: "Pay", text: null, visibility: "public", partyIds: ["party-0", "party-1"], payload: { operations: [economicOperation] } }]); id = a.id;
    assert.equal((await a.activate()).ok, false); assert.equal(first.ledgerStore.query({ domainUuid }).length, 2); assert.equal((await first.diplomacy.agreements.query({ id })).ok, false);
  } finally { first.destroy(); }
  const reload = f.make(); try { await reload.initialize(); await reload.handleAuthorityTransition();
    assert.equal((unwrap(await reload.diplomacy.agreements.query({ id })) as any).lifecycle, "active"); assert.equal(reload.ledgerStore.query({ domainUuid }).length, 2);
  } finally { reload.destroy(); }
});
test("G6.10 effects: unavailable owner prevents activation before any canonical write", async () => {
  const f = fixture(), r = f.make();
  try { await r.initialize(); const a = await prepareAgreement(r, [{ id: "unknown", type: "domain-manager:owner-operation", title: "External owner", text: null,
    visibility: "public", partyIds: ["party-0", "party-1"], payload: { operations: [{ ...economicOperation, ownerId: "test:missing-owner" }] } }]);
    const result = await a.activate(); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_AGREEMENT_OWNER_UNAVAILABLE");
    assert.equal((unwrap(await r.diplomacy.agreements.query({ id: a.id })) as any).lifecycle, "pendingApproval"); assert.equal(r.ledgerStore.query({ domainUuid }).length, 0);
  } finally { r.destroy(); }
});
test("G6.10 obligations: due date only reports; explicit confirmed breach may apply owner consequence once", async () => {
  const f = fixture(), r = f.make();
  try { await r.initialize(); assert.equal(unwrap(await r.economy.createAccount({ domainUuid, resourceId: "domain-manager:treasury", initialBalanceMinor: 100 })).status, "executed");
    const a = await prepareAgreement(r, [{ id: "tribute", type: "domain-manager:obligation", title: "Tribute", text: null, visibility: "public", partyIds: ["party-0", "party-1"],
      payload: { kind: "domain-manager:payment", obligatedPartyId: "party-0", beneficiaryPartyId: "party-1", dueAtWorldTick: 20, graceTicks: 0,
        overduePolicy: "report", requirementRef: { type: "resource", id: "domain-manager:treasury" }, consequences: [economicOperation] } }]);
    unwrap(await a.activate()); f.time.tick = 30;
    let d: any = unwrap(await r.diplomacy.agreements.query({ id: a.id })); assert.equal(d.compliance[0].lifecycle, "due"); assert.equal(d.compliance[0].confirmedBreach, false); assert.equal(r.ledgerStore.query({ domainUuid }).length, 1);
    const action = { kind: "obligation", obligationId: d.obligations[0].id, expectedObligationRevision: 0, action: { kind: "decide", lifecycle: "breached" }, applyConsequences: true };
    unwrap(await a.modify(action)); d = unwrap(await r.diplomacy.agreements.query({ id: a.id })); assert.equal(d.lifecycle, "active"); assert.equal(d.obligations[0].lifecycle, "breached"); assert.equal(r.ledgerStore.query({ domainUuid }).length, 2);
    unwrap(await a.modify({ ...action, expectedObligationRevision: 1 })); assert.equal(r.ledgerStore.query({ domainUuid }).length, 2);
  } finally { r.destroy(); }
});
test("G6.10 reference guards: transfer cannot introduce a missing Domain, and embedded People parties require their owner record", async () => {
  const f = fixture(), r = f.make(), draft = createDiplomacyDraft("territory", "Region", [], "public");
  const claim = { id: "old", sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 10, expiresAtWorldTick: null,
    claimantRef: { type: "narrative", id: "owner" }, claimType: "domain-manager:ownership", lifecycle: "active", contested: false, strength: null, inherited: false };
  try { await r.initialize(); const data: any = draft.data; data.claims = [claim]; unwrap(await r.diplomacy.territory.create({ id: draft.id, data, reason: "Create" }));
    const result = await r.diplomacy.territory.modify({ id: draft.id, expectedRevision: 0, reason: "Invalid buyer", action: { kind: "transfer", targets: [{ territoryUuid: draft.id,
      expectedRevision: 0, supersedeClaimIds: ["old"], newClaim: { ...claim, id: "new", claimantRef: { type: "domain", uuid: "JournalEntry.missing" } } }] } });
    assert.equal(result.ok, false); assert.equal((unwrap(await r.diplomacy.territory.query({ id: draft.id })) as any).claims[0].lifecycle, "active");
    const relationData: any = relation(); relationData.definition.allowedPartyTypes.push("notable"); relationData.state.relation.parties[1].ref = { type: "notable", id: "missing", domainUuid };
    assert.equal((await r.diplomacy.relations.create({ id: relationData.state.relation.id, data: relationData, reason: "Missing notable" })).ok, false);
  } finally { r.destroy(); }
});
test("G6 audit: authority enforces relation uniqueness policy and independent scopes", async () => {
  const f = fixture(), r = f.make(), a: any = relation(), b: any = relation("rel_00000000-0000-4000-8000-000000000007");
  try { await r.initialize(); a.definition.allowMultiple = false; b.definition.allowMultiple = false;
    unwrap(await r.diplomacy.relations.create({ id: a.state.relation.id, data: a, reason: "Create unique" }));
    const rejected = await r.diplomacy.relations.create({ id: b.state.relation.id, data: b, reason: "Duplicate parties/type/scope" });
    assert.equal(rejected.ok, false); if (!rejected.ok) assert.equal(rejected.error.code, "DM_RELATION_DUPLICATE_TYPE");
    b.state.relation.scope = { type: "narrative", id: "different-context" };
    unwrap(await r.diplomacy.relations.create({ id: b.state.relation.id, data: b, reason: "Distinct scope" }));
    assert.equal((unwrap(await r.diplomacy.relations.query()) as any).total, 2);
    const race = ["rel_00000000-0000-4000-8000-000000000008", "rel_00000000-0000-4000-8000-000000000009"].map(id => {
      const data: any = relation(id); data.definition.allowMultiple = false; data.definition.id = "test:race"; data.state.relation.definitionId = "test:race";
      return r.diplomacy.relations.create({ id, data, reason: "Concurrent unique create" });
    });
    assert.equal((await Promise.all(race)).filter(result => result.ok).length, 1);
  } finally { r.destroy(); }
});
test("G6 audit: inherited treaty rights reach descendants without becoming global or copied truth", async () => {
  const f = fixture(), r = f.make(), player = f.make("player"), root = createDiplomacyDraft("territory", "Port", [], "public"), child = createDiplomacyDraft("territory", "Dock", [], "public");
  try { await r.initialize(); unwrap(await r.diplomacy.territory.create({ ...root, reason: "Create" })); unwrap(await r.diplomacy.territory.create({ ...child, reason: "Create" }));
    unwrap(await r.diplomacy.territory.modify({ id: child.id, expectedRevision: 0, action: { kind: "reparent", parents: { locatedInUuid: root.id, administrativeParentUuid: null } }, reason: "Nest" }));
    const treaty = await prepareAgreement(r, [{ id: "entry", type: "domain-manager:right", title: "Dock access", text: null, visibility: "public", partyIds: ["party-0"],
      payload: { beneficiaryPartyId: "party-0", territoryUuid: root.id, rightType: "domain-manager:entry", startsAtWorldTick: 0, expiresAtWorldTick: 20,
        inherited: true, revocable: true, conditionRefs: [], grants: ["test:treaty-entry"] } }]); unwrap(await treaty.activate());
    const scoped: any = unwrap(await player.diplomacy.capabilities(domainUuid, child.id));
    assert.ok(scoped.enabledCapabilityIds.includes("test:treaty-entry"));
    const provenance = scoped.grantsByCapability["test:treaty-entry"][0]; assert.equal(provenance.sourceType, "agreement"); assert.equal(provenance.inherited, true); assert.equal(provenance.scopeRef.uuid, child.id);
    assert.equal((unwrap(await player.diplomacy.capabilities(domainUuid)) as any).enabledCapabilityIds.includes("test:treaty-entry"), false);
    assert.equal((unwrap(await r.diplomacy.territory.query({ id: child.id })) as any).rights.length, 0);
    f.time.tick = 20; assert.equal((unwrap(await player.diplomacy.capabilities(domainUuid, child.id)) as any).enabledCapabilityIds.includes("test:treaty-entry"), false);
  } finally { player.destroy(); r.destroy(); }
});
test("G6 audit: restricted territory access uses all participating party types consistently", async () => {
  const f = fixture(), r = f.make(), player = f.make("player"), root = createDiplomacyDraft("territory", "Recognition-only", [], "restricted"), child = createDiplomacyDraft("territory", "Visible child", [], "public");
  try { await r.initialize(); const data: any = root.data;
    data.claims = [{ id: "guild", sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 0, expiresAtWorldTick: null,
      claimantRef: { type: "narrative", id: "guild" }, claimType: "domain-manager:ownership", lifecycle: "active", contested: false, strength: null, inherited: false }];
    data.recognitions = [{ id: "recognition", sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 0, expiresAtWorldTick: null,
      claimId: "guild", recognizingRef: { type: "domain", uuid: domainUuid }, position: "positive" }];
    unwrap(await r.diplomacy.territory.create({ id: root.id, data, reason: "Create" })); unwrap(await r.diplomacy.territory.create({ ...child, reason: "Create" }));
    unwrap(await r.diplomacy.territory.modify({ id: child.id, expectedRevision: 0, action: { kind: "reparent", parents: { locatedInUuid: root.id, administrativeParentUuid: null } }, reason: "Nest" }));
    unwrap(await player.diplomacy.territory.query({ id: root.id }));
    assert.equal((unwrap(await player.diplomacy.territory.query({ parentUuid: root.id })) as any).total, 1);
    assert.equal((unwrap(await player.diplomacy.territory.query({ id: child.id })) as any).territory.locatedInUuid, root.id);
    unwrap(await player.diplomacy.capabilities(domainUuid, root.id));
  } finally { player.destroy(); r.destroy(); }
});
test("G6 audit: public reputation and influence DTOs discard undeclared party metadata", async () => {
  const f = fixture(), r = f.make(), player = f.make("player"), rep = createDiplomacyDraft("reputation", "Standing", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public"), territory = createDiplomacyDraft("territory", "Influence", [], "public");
  try { await r.initialize(); const reputationData: any = rep.data; reputationData.record.subjectRef.privateMetadata = "private-sentinel";
    unwrap(await r.diplomacy.reputation.create({ id: rep.id, data: reputationData, reason: "Create" }));
    const territoryData: any = territory.data; territoryData.influence = [{ id: "political", sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 0, expiresAtWorldTick: null,
      partyRef: { type: "domain", uuid: domainUuid, privateMetadata: "private-sentinel" }, active: true,
      axes: [{ axisId: "test:political", base: 20, minimum: -100, maximum: 100, decay: null }], modifiers: [] }];
    unwrap(await r.diplomacy.territory.create({ id: territory.id, data: territoryData, reason: "Create" }));
    assert.equal(JSON.stringify(unwrap(await player.diplomacy.reputation.query({ id: rep.id }))).includes("private-sentinel"), false);
    assert.equal(JSON.stringify(unwrap(await player.diplomacy.territory.query({ id: territory.id }))).includes("private-sentinel"), false);
  } finally { player.destroy(); r.destroy(); }
});

test("G6 stance vertical: Player proposes a manual stance; GM approval, retry and reload preserve a single audit event", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), data: any = relation(), id = data.state.relation.id;
  data.definition.stancePolicy = "manual";
  try {
    await gm.initialize(); unwrap(await gm.diplomacy.relations.create({ id, data, reason: "Create manual relation" }));
    assert.equal((await player.diplomacy.relations.modify({ id, expectedRevision: 0, action: { kind: "stance", value: "Alliance" }, reason: "Denied direct write" })).ok, false);
    unwrap(await player.diplomacy.proposals.submit({ id: "stance-request", intent: {
      kind: "relation", mode: "modify", id, expectedRevision: 0, action: { kind: "stance", value: "Alliance" }, reason: "Player proposal" } }));
    assert.equal((unwrap(await gm.diplomacy.relations.query({ id })) as any).revision, 0);
    const ticket = unwrap(gm.diplomacy.commands.prepare("diplomacy:decide-proposal", {
      id: "stance-request", expectedRevision: 0, decision: "approve", reason: "GM approved" }));
    unwrap(await gm.diplomacy.commands.execute(ticket)); unwrap(await gm.diplomacy.commands.retry(ticket));
    const detail: any = unwrap(await player.diplomacy.relations.query({ id }));
    assert.equal(detail.stances[0].value, "Alliance"); assert.equal(detail.revision, 1);
    assert.equal(detail.history.filter((e: any) => e.kind === "stance-changed").length, 1);
  } finally { player.destroy(); gm.destroy(); }
  const reload = f.make(); try {
    await reload.initialize(); const detail: any = unwrap(await reload.diplomacy.relations.query({ id }));
    assert.equal(detail.stances[0].value, "Alliance"); assert.equal(detail.revision, 1);
    assert.equal(detail.history.filter((e: any) => e.kind === "stance-changed").length, 1);
    unwrap(await reload.diplomacy.relations.modify({ id, expectedRevision: 1, action: { kind: "stance", value: "Alliance" }, reason: "Same value" }));
    assert.equal((unwrap(await reload.diplomacy.relations.query({ id })) as any).revision, 1);
  } finally { reload.destroy(); }
});
test("G6 stance vertical: secret temporary sources affect only GM classification through the real public API", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), data: any = relation(), id = data.state.relation.id;
  data.definition.stanceRules = [
    { id: "test:high", label: "High", visibility: "public", conditions: [{ axisId: "test:trust", minimum: 30, maximum: 100 }] },
    { id: "test:low", label: "Low", visibility: "public", conditions: [{ axisId: "test:trust", minimum: -100, maximum: 29 }] }
  ];
  try {
    await gm.initialize(); unwrap(await gm.diplomacy.relations.create({ id, data, reason: "Create derived relation" }));
    unwrap(await gm.diplomacy.relations.modify({ id, expectedRevision: 0, reason: "Secret modifier", action: { kind: "modifier", value: {
      id: "secret-stance-modifier", axisId: "test:trust", value: 20, fromPartyId: null, toPartyId: null,
      source: { type: "incident", id: "private-stance-source" }, visibility: "secret", lifecycle: "active", createdAt: 0,
      expiresAt: null, expiresAtWorldTick: 20, stackKey: "test:stack", stacking: "add" } } }));
    const publicDetail: any = unwrap(await player.diplomacy.relations.query({ id }));
    assert.equal(publicDetail.stances[0].value, "Low"); assert.equal(JSON.stringify(publicDetail).includes("private-stance-source"), false);
    assert.equal(JSON.stringify(publicDetail).includes("secret-stance-modifier"), false);
    assert.equal((unwrap(await gm.diplomacy.relations.query({ id })) as any).stances[0].value, "High");
    f.time.tick = 20; assert.equal((unwrap(await gm.diplomacy.relations.query({ id })) as any).stances[0].value, "Low");
  } finally { player.destroy(); gm.destroy(); }
});

const reputationDraftFor = (label = "Standing") => createDiplomacyDraft("reputation", label,
  [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public");
const reputationPolicyFor = (detail: any, trackId: string, patch: Record<string, unknown> = {}) => {
  const track = detail.tracks.find((t: any) => t.definitionId === trackId);
  const current = detail.definitions.find((d: any) => d.id === trackId && d.version === track.definitionVersion);
  const { id, version, ...policy } = current; return { ...policy, ...patch };
};
test("G6 reputation configuration vertical: UI creates multiple tracks with an authority clock and private presentation", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), controller = new DiplomacyApplicationController(gm.diplomacy);
  try {
    await gm.initialize(); f.time.tick = 100;
    controller.tab = "reputation"; await controller.load(); controller.addReputationTrackForm({});
    unwrap(await controller.create({ label: "Multi standing", subject: domainUuid, audience: "guild", visibility: "public", reason: "Create",
      rep_0_id: "test:standing-public", rep_0_label: "Public", rep_0_initialScore: "20", rep_0_decayEnabled: "on", rep_0_decayAmount: "5", rep_0_decayPeriod: "10",
      rep_1_id: "test:standing-secret", rep_1_label: "secret-configuration-marker", rep_1_visibility: "secret" }));
    const id = controller.selectedId!, detail: any = unwrap(await gm.diplomacy.reputation.query({ id }));
    assert.equal(detail.tracks.length, 2); assert.equal(detail.tracks[0].lastDecayWorldTick, 100);
    assert.equal(detail.tracks[0].score, 20);
    f.time.tick = 105; unwrap(await gm.diplomacy.reputation.modify({ id, expectedRevision: 0, action: { kind: "decay", trackId: "test:standing-public" }, reason: "Early decay" }));
    assert.equal((unwrap(await gm.diplomacy.reputation.query({ id })) as any).revision, 0);
    f.time.tick = 110; unwrap(await gm.diplomacy.reputation.modify({ id, expectedRevision: 0, action: { kind: "decay", trackId: "test:standing-public" }, reason: "Decay" }));
    assert.equal((unwrap(await gm.diplomacy.reputation.query({ id })) as any).tracks[0].score, 15);
    const publicDetail: any = unwrap(await player.diplomacy.reputation.query({ id }));
    assert.equal(publicDetail.tracks.length, 1); assert.equal(publicDetail.tracks[0].score, undefined);
    assert.equal(JSON.stringify(publicDetail).includes("secret-configuration-marker"), false);
    assert.equal(JSON.stringify(publicDetail).includes("lastDecayWorldTick"), false);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 reputation configuration vertical: edit, same-ticket retry, no-op and reload preserve versions and one audit", async () => {
  const f = fixture(), gm = f.make(), draft = reputationDraftFor(); let id = draft.id;
  try {
    await gm.initialize(); unwrap(await gm.diplomacy.reputation.create({ ...draft, reason: "Create" }));
    unwrap(await gm.diplomacy.reputation.modify({ id, expectedRevision: 0, action: { kind: "adjust", trackId: "domain-manager:standing", delta: 30 }, reason: "Award" }));
    const old: any = unwrap(await gm.diplomacy.reputation.query({ id })); f.time.tick = 100;
    const policy = reputationPolicyFor(old, "domain-manager:standing", { label: "Configured", decay: { amount: 5, periodTicks: 10 } });
    const ticket = unwrap(gm.diplomacy.commands.prepare("reputation:modify", { id, expectedRevision: 1,
      action: { kind: "configure-track", trackId: "domain-manager:standing", policy, definitionVersion: 999 }, reason: "Configure" }));
    assert.equal(unwrap(await gm.diplomacy.commands.execute(ticket)).status, "executed");
    assert.equal(unwrap(await gm.diplomacy.commands.retry(ticket)).status, "executed");
    const detail: any = unwrap(await gm.diplomacy.reputation.query({ id }));
    assert.equal(detail.revision, 2); assert.equal(detail.tracks[0].definitionVersion, 2);
    assert.equal(detail.tracks[0].lastDecayWorldTick, 100); assert.equal(detail.tracks[0].score, 30);
    assert.deepEqual(detail.entries, old.entries); assert.deepEqual(detail.definitions[0], old.definitions[0]);
    assert.equal(detail.configurationHistory.length, 1);
    unwrap(await gm.diplomacy.reputation.modify({ id, expectedRevision: 2,
      action: { kind: "configure-track", trackId: "domain-manager:standing", policy }, reason: "Identical" }));
    assert.equal((unwrap(await gm.diplomacy.reputation.query({ id })) as any).revision, 2);
  } finally { gm.destroy(); }
  const reload = f.make(); try {
    await reload.initialize(); const detail: any = unwrap(await reload.diplomacy.reputation.query({ id }));
    assert.equal(detail.revision, 2); assert.equal(detail.configurationHistory.length, 1);
    assert.equal(detail.tracks[0].definitionVersion, 2); assert.equal(detail.tracks[0].score, 30);
  } finally { reload.destroy(); }
});
test("G6 reputation configuration vertical: concurrent edits of shared content allocate distinct immutable versions", async () => {
  const f = fixture(), gm = f.make(), a = reputationDraftFor("A"), b = reputationDraftFor("B");
  try {
    await gm.initialize(); unwrap(await gm.diplomacy.reputation.create({ ...a, reason: "Create A" })); unwrap(await gm.diplomacy.reputation.create({ ...b, reason: "Create B" }));
    const old: any = unwrap(await gm.diplomacy.reputation.query({ id: a.id }));
    const results = await Promise.all([a, b].map((draft, i) => gm.diplomacy.reputation.modify({ id: draft.id, expectedRevision: 0,
      action: { kind: "configure-track", trackId: "domain-manager:standing", policy: reputationPolicyFor(old, "domain-manager:standing", { label: "Version " + i }) }, reason: "Configure" })));
    assert.ok(results.every(r => r.ok), JSON.stringify(results));
    const after = await Promise.all([a, b].map(async draft => unwrap(await gm.diplomacy.reputation.query({ id: draft.id })) as any));
    assert.deepEqual(after.map(d => d.tracks[0].definitionVersion).sort(), [2, 3]);
    for (const d of after) { assert.deepEqual(d.definitions[0], old.definitions[0]); assert.equal(d.tracks[0].score, 0); }
  } finally { gm.destroy(); }
});
test("G6 reputation configuration vertical: conflicting shared snapshots and fabricated creation audit are rejected", async () => {
  const f = fixture(), gm = f.make(), a = reputationDraftFor("A"), b = reputationDraftFor("B");
  try {
    await gm.initialize(); unwrap(await gm.diplomacy.reputation.create({ ...a, reason: "Create" })); unwrap(await gm.diplomacy.reputation.create({ ...b, reason: "Create" }));
    const definition: any = { id: "test:custom-track", version: 1, label: "Custom", minimum: 0, maximum: 100, baseline: 0,
      visibility: "public", publicPresentation: "score", bands: [], decay: null };
    unwrap(await gm.diplomacy.reputation.modify({ id: a.id, expectedRevision: 0, action: { kind: "add-track", definition, initialScore: 10 }, reason: "Add" }));
    const rejected = await gm.diplomacy.reputation.modify({ id: b.id, expectedRevision: 0,
      action: { kind: "add-track", definition: { ...definition, label: "Conflicting" }, initialScore: 10 }, reason: "Conflict" });
    assert.equal(rejected.ok, false); if (!rejected.ok) assert.equal(rejected.error.code, "DM_DIPLOMACY_DEFINITION_CONFLICT");
    const untouched: any = unwrap(await gm.diplomacy.reputation.query({ id: b.id })); assert.equal(untouched.revision, 0); assert.equal(untouched.tracks.length, 1);
    const source = await f.adapter.read("reputation", a.id); assert.ok(source); const forged: any = structuredClone(source.data);
    const id = "rep_00000000-0000-4000-8000-000000000123"; forged.record.id = id; forged.record.revision = 0;
    const invalid = await gm.diplomacy.reputation.create({ id, data: forged, reason: "Fake prior configuration" });
    assert.equal(invalid.ok, false);
    assert.equal(await f.adapter.read("reputation", id), null);
  } finally { gm.destroy(); }
});
test("G6 reputation configuration vertical: policy edits and probing secret track policies are GM-only", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), draft = reputationDraftFor();
  try {
    await gm.initialize(); unwrap(await gm.diplomacy.reputation.create({ ...draft, reason: "Create" }));
    const detail: any = unwrap(await gm.diplomacy.reputation.query({ id: draft.id }));
    const policy = reputationPolicyFor(detail, "domain-manager:standing", { label: "New" });
    assert.equal((await player.diplomacy.reputation.modify({ id: draft.id, expectedRevision: 0, action: { kind: "configure-track", trackId: "domain-manager:standing", policy }, reason: "Denied" })).ok, false);
    for (const trackId of ["domain-manager:standing", "test:unknown-hidden"]) {
      const proposed = await player.diplomacy.proposals.submit({ id: "probe-" + trackId, intent: { kind: "reputation", mode: "modify",
        id: draft.id, expectedRevision: 0, action: { kind: "configure-track", trackId, policy }, reason: "Probe policy" } });
      assert.equal(proposed.ok, false); if (!proposed.ok) assert.equal(proposed.error.code, "DM_SECURITY_PERMISSION_DENIED");
    }
    assert.equal((unwrap(await gm.diplomacy.reputation.query({ id: draft.id })) as any).revision, 0);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 reputation configuration vertical: proposed creation activates decay on approval, ignoring client clock", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), draft = reputationDraftFor(), data: any = draft.data;
  data.definitions[0].decay = { amount: 1, periodTicks: 10 }; data.record.tracks[0].lastDecayWorldTick = 999;
  try {
    await gm.initialize(); unwrap(await player.diplomacy.proposals.submit({ id: "create-configured-standing",
      intent: { kind: "reputation", mode: "create", id: draft.id, data, reason: "Create configured record" } }));
    assert.equal((await gm.diplomacy.reputation.query({ id: draft.id })).ok, false);
    f.time.tick = 100;
    unwrap(await gm.diplomacy.proposals.decide({ id: "create-configured-standing", expectedRevision: 0, decision: "approve", reason: "Approved" }));
    const detail: any = unwrap(await gm.diplomacy.reputation.query({ id: draft.id }));
    assert.equal(detail.tracks[0].lastDecayWorldTick, 100); assert.equal(detail.revision, 0);
  } finally { player.destroy(); gm.destroy(); }
});

test("G6 agreement negotiation vertical: UI deadline expires only at authority tick and resets initial lifecycle", async () => {
  const f = fixture(), gm = f.make(), draft = createDiplomacyDraft("agreement", "Offer", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public");
  try {
    await gm.initialize(); unwrap(await gm.diplomacy.agreements.create({ ...draft, reason: "Create" }));
    const ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("agreements"); ui.select(draft.id); unwrap(await ui.load());
    unwrap(await ui.change({ kind: "propose", partyId: "party-0", title: "Initial", text: "Full offer", visibility: "public", proposalExpires: "25", expires: "100", reason: "Negotiate" }));
    unwrap(await ui.load()); const proposal = ui.detail.proposals[0]; assert.equal(proposal.expiresAtWorldTick, 25); assert.equal(proposal.rounds[0].duration.expiresAtWorldTick, 100);
    const rev = ui.detail.revision; ui.list.worldTick = 25;
    assert.equal((await ui.change({ kind: "expire-proposal", sourceId: proposal.id, reason: "Too early" })).ok, false);
    assert.equal((unwrap(await gm.diplomacy.agreements.query({ id: draft.id })) as any).revision, rev);
    f.time.tick = 25; unwrap(await ui.load()); unwrap(await ui.change({ kind: "expire-proposal", sourceId: proposal.id, reason: "Deadline" })); unwrap(await ui.load());
    assert.equal(ui.detail.lifecycle, "draft"); assert.equal(ui.detail.proposals[0].lifecycle, "expired"); assert.equal(ui.detail.history.filter((e: any) => e.kind === "expire-proposal").length, 1);
    assert.ok(ui.inspector().includes("Rodada 1"));
  } finally { gm.destroy(); }
});
test("G6 agreement negotiation vertical: manual UI renewal preserves terms/rights, exact ticket retry and reload", async () => {
  const f = fixture(), gm = f.make(); let id = "", ticket: any;
  const term = { id: "grant", type: "domain-manager:capability", title: "Access", text: null, visibility: "public", partyIds: ["party-0", "party-1"],
    payload: { beneficiaryPartyId: "party-0", capabilityIds: ["test:renewed-access"], scopeRef: null, conditionRefs: [] } };
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, [term]); id = a.id; unwrap(await a.activate());
    const ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("agreements"); ui.select(id); unwrap(await ui.load());
    const action = unwrap(ui.buildAction({ kind: "renew", renewExpires: "200" }));
    ticket = unwrap(gm.diplomacy.commands.prepare("agreements:modify", { id, expectedRevision: ui.detail.revision, action, reason: "Extend manually" }));
    unwrap(await gm.diplomacy.commands.execute(ticket)); unwrap(await gm.diplomacy.commands.retry(ticket));
    const after: any = unwrap(await gm.diplomacy.agreements.query({ id })); assert.equal(after.duration.expiresAtWorldTick, 200); assert.equal(after.duration.startsAtWorldTick, 10);
    assert.deepEqual(after.terms, [term]); assert.equal(after.history.filter((e: any) => e.kind === "renew").length, 1);
    assert.equal((await gm.diplomacy.agreements.modify({ id, expectedRevision: ui.detail.revision, action, reason: "Stale" })).ok, false);
    f.time.tick = 150; const caps: any = unwrap(await gm.diplomacy.capabilities(domainUuid));
    assert.ok(JSON.stringify(caps).includes("test:renewed-access"));
  } finally { gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); unwrap(await reload.diplomacy.commands.retry(ticket));
    const after: any = unwrap(await reload.diplomacy.agreements.query({ id })); assert.equal(after.duration.expiresAtWorldTick, 200); assert.equal(after.history.filter((e: any) => e.kind === "renew").length, 1);
  } finally { reload.destroy(); }
});
test("G6 agreement negotiation vertical: sanitized round diff and reset votes use real owner and survive reload", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"); let id = "";
  const term = { id: "visible", type: "domain-manager:narrative", title: "Visible", text: "Old", visibility: "public", partyIds: ["party-0", "party-1"], payload: {} };
  const secret = { ...structuredClone(term), id: "private-negotiation", title: "PRIVATE_NEGOTIATION_MARKER", visibility: "secret" };
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, [term, secret]); id = a.id;
    // The accepted round is activated before negotiating an amendment.
    unwrap(await a.activate()); unwrap(await a.modify({ kind: "amend", proposalId: "amend-offer", partyId: "party-0", terms: [term, secret], duration: { startsAtWorldTick: 10, expiresAtWorldTick: 100 }, proposalExpiresAtWorldTick: 50 }));
    unwrap(await a.modify({ kind: "accept", proposalId: "amend-offer", expectedProposalRevision: 0, partyId: "party-0" }));
    unwrap(await a.modify({ kind: "counter", proposalId: "amend-offer", expectedProposalRevision: 1, partyId: "party-1", terms: [{ ...term, text: "New" }, { ...secret, text: "PRIVATE_CHANGE_MARKER" }], duration: { startsAtWorldTick: 10, expiresAtWorldTick: 120 } }));
    const g: any = unwrap(await gm.diplomacy.agreements.query({ id })); const p: any = unwrap(await player.diplomacy.agreements.query({ id }));
    assert.equal(g.proposals[1].rounds[1].comparison.terms.length, 2); assert.equal(p.proposals[1].rounds[1].comparison.terms.length, 1);
    assert.deepEqual(p.proposals[1].rounds[1].acceptedPartyIds, []); assert.equal(p.proposals[1].rounds[0].acceptedPartyIds.length, 1);
    assert.equal(p.proposals[1].rounds[1].comparison.terms[0].before.text, "Old"); assert.equal(p.proposals[1].rounds[1].comparison.terms[0].after.text, "New");
    assert.equal(JSON.stringify(p).includes("PRIVATE_"), false); assert.equal(JSON.stringify(p).includes("private-negotiation"), false);
    assert.deepEqual(p.terms[0], term); assert.equal(p.duration.expiresAtWorldTick, 100);
    const ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("agreements"); ui.select(id); unwrap(await ui.load());
    assert.ok(ui.inspector().includes("Comparação com a rodada anterior")); assert.equal(ui.inspector().includes("PRIVATE_"), false);
  } finally { player.destroy(); gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); const d: any = unwrap(await reload.diplomacy.agreements.query({ id })); assert.equal(d.proposals[1].rounds.length, 2); assert.equal(d.proposals[1].rounds[1].comparison.terms.length, 2);
  } finally { reload.destroy(); }
});
test("G6 agreement negotiation vertical: Player UI renewal waits for GM approval and records original intent", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, []); unwrap(await a.activate());
    const ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("agreements"); ui.select(a.id); unwrap(await ui.load());
    const rev = ui.detail.revision; unwrap(await ui.change({ kind: "renew", renewExpires: "200", reason: "Please extend" }));
    assert.equal((unwrap(await gm.diplomacy.agreements.query({ id: a.id })) as any).revision, rev);
    const inbox: any = unwrap(await gm.diplomacy.proposals.query({})); const request: any = unwrap(await gm.diplomacy.proposals.query({ id: inbox.items[0].id }));
    assert.equal(request.original.action.automatic, false); assert.equal(request.original.action.expiresAtWorldTick, 200);
    unwrap(await gm.diplomacy.proposals.decide({ id: request.id, expectedRevision: request.revision, decision: "approve", reason: "GM approved" }));
    const d: any = unwrap(await gm.diplomacy.agreements.query({ id: a.id })); assert.equal(d.duration.expiresAtWorldTick, 200); assert.equal(d.history.filter((e: any) => e.kind === "renew").length, 1);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 agreement negotiation vertical: expired amendment keeps active terms and same expiration ticket is a no-op", async () => {
  const f = fixture(), gm = f.make();
  const term = { id: "current", type: "domain-manager:narrative", title: "Current", text: null, visibility: "public", partyIds: ["party-0", "party-1"], payload: {} };
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, [term]); unwrap(await a.activate());
    unwrap(await a.modify({ kind: "amend", proposalId: "expired-amendment", partyId: "party-0", terms: [{ ...term, title: "Not active" }], duration: { startsAtWorldTick: 10, expiresAtWorldTick: 200 }, proposalExpiresAtWorldTick: 20 }));
    const before: any = unwrap(await gm.diplomacy.agreements.query({ id: a.id })); f.time.tick = 20;
    const ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("agreements"); ui.select(a.id); unwrap(await ui.load());
    const action = unwrap(ui.buildAction({ kind: "expire-proposal", sourceId: "expired-amendment" }));
    const ticket = unwrap(gm.diplomacy.commands.prepare("agreements:modify", { id: a.id, expectedRevision: ui.detail.revision, action, reason: "Deadline" }));
    unwrap(await gm.diplomacy.commands.execute(ticket)); unwrap(await gm.diplomacy.commands.retry(ticket)); unwrap(await ui.load());
    assert.equal(ui.detail.lifecycle, "active"); assert.deepEqual(ui.detail.terms, before.terms); assert.deepEqual(ui.detail.duration, before.duration);
    const rev = ui.detail.revision; unwrap(await ui.change({ kind: "expire-proposal", sourceId: "expired-amendment", reason: "Already expired" })); unwrap(await ui.load()); assert.equal(ui.detail.revision, rev);
    assert.equal(ui.detail.history.filter((e: any) => e.kind === "expire-proposal").length, 1);
  } finally { gm.destroy(); }
});
test("G6 agreement negotiation vertical: UI amendment without reapproval receives unique audit ID", async () => {
  const f = fixture(), gm = f.make(), draft = createDiplomacyDraft("agreement", "Direct amendment", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public");
  const data: any = draft.data; data.definition.amendmentRequiresApproval = false;
  try {
    await gm.initialize(); unwrap(await gm.diplomacy.agreements.create({ id: draft.id, data, reason: "Create" }));
    const ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("agreements"); ui.select(draft.id); unwrap(await ui.load());
    unwrap(await ui.change({ kind: "propose", partyId: "party-0", title: "Original", expires: "100", visibility: "public", reason: "Offer" })); unwrap(await ui.load());
    for (const partyId of ["party-0", "party-1"]) { unwrap(await ui.change({ kind: "accept", partyId, reason: "Accept" })); unwrap(await ui.load()); }
    unwrap(await ui.change({ kind: "activate", reason: "Enact" })); unwrap(await ui.load());
    unwrap(await ui.change({ kind: "amend", partyId: "party-0", title: "Changed", expires: "200", visibility: "public", reason: "GM amended" })); unwrap(await ui.load());
    assert.equal(ui.detail.terms[0].title, "Changed"); assert.equal(ui.detail.amendments.length, 1); assert.ok(ui.detail.amendments[0].id);
    assert.equal(ui.detail.amendments[0].beforeTerms[0].title, "Original"); assert.equal(ui.detail.amendments[0].afterTerms[0].title, "Changed");
    assert.equal(ui.detail.lifecycle, "active"); assert.equal(ui.detail.proposals.length, 1);
  } finally { gm.destroy(); }
});

const inspectorObligation = (id = "tribute", payload = {}, visibility = "public") => ({ id, type: "domain-manager:obligation", title: id,
  text: "Pay tribute", visibility, partyIds: ["party-0", "party-1"], payload: { kind: "domain-manager:payment", obligatedPartyId: "party-0",
    beneficiaryPartyId: "party-1", dueAtWorldTick: 20, graceTicks: 5, overduePolicy: "report", requirementRef: { type: "resource", id: "test:coin" }, consequences: [], ...payload } });
test("G6 agreement inspector vertical: authority clock drives read-only due/grace and reload preserves stored state", async () => {
  const f = fixture(), gm = f.make(); let id = "", revision = 0;
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, [inspectorObligation()]); id = a.id; unwrap(await a.activate());
    const before: any = unwrap(await gm.diplomacy.agreements.query({ id })); revision = before.revision;
    f.time.tick = 25; const atEnd: any = unwrap(await gm.diplomacy.agreements.query({ id })); assert.equal(atEnd.obligations[0].compliance.pastGrace, false);
    f.time.tick = 26; const ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("agreements"); ui.select(id); unwrap(await ui.load());
    assert.equal(ui.detail.worldTick, 26); assert.equal(ui.detail.obligations[0].lifecycle, "pending"); assert.equal(ui.detail.obligations[0].compliance.lifecycle, "due");
    assert.ok(ui.inspector().includes("Tolerância ultrapassada")); assert.ok(ui.inspector().includes("confirmado: Não"));
    const after: any = unwrap(await gm.diplomacy.agreements.query({ id })); assert.equal(after.revision, revision); assert.equal(after.lifecycle, "active"); assert.deepEqual(after.history, before.history);
  } finally { gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); const d: any = unwrap(await reload.diplomacy.agreements.query({ id }));
    assert.equal(d.revision, revision); assert.equal(d.obligations[0].lifecycle, "pending"); assert.equal(d.obligations[0].compliance.pastGrace, true); assert.equal(d.obligations[0].deadline.graceEndsAtWorldTick, "25");
  } finally { reload.destroy(); }
});
test("G6 agreement inspector vertical: Player selected evidence waits for GM and durable retry records once", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"); let id = "", ticket: any;
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, [inspectorObligation()]); id = a.id; unwrap(await a.activate());
    const ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("agreements"); ui.select(id); unwrap(await ui.load());
    const revision = ui.detail.revision, obligationId = ui.detail.obligations[0].id; unwrap(ui.selectAgreementObligation(obligationId));
    assert.ok(ui.inspector().includes("Selecionar obrigação para proposta ao GM"));
    unwrap(await ui.change({ ...ui.agreementFormFields, outcome: "payment-receipt", text: "Payment claimed", position: "contest", visibility: "public", reason: "Please review" }));
    const pending: any = unwrap(await gm.diplomacy.agreements.query({ id })); assert.equal(pending.revision, revision); assert.deepEqual(pending.obligations[0].evidence, []);
    const inbox: any = unwrap(await gm.diplomacy.proposals.query({})), request: any = unwrap(await gm.diplomacy.proposals.query({ id: inbox.items[0].id }));
    assert.equal(request.original.action.obligationId, obligationId); assert.equal(request.original.action.expectedObligationRevision, 0);
    ticket = unwrap(gm.diplomacy.commands.prepare("diplomacy:decide-proposal", { id: request.id, expectedRevision: request.revision, decision: "approve", reason: "Receipt reviewed" }));
    unwrap(await gm.diplomacy.commands.execute(ticket)); unwrap(await gm.diplomacy.commands.retry(ticket)); unwrap(await ui.load());
    assert.equal(ui.detail.obligations[0].evidence.length, 1); assert.equal(ui.detail.obligations[0].lifecycle, "pending"); assert.equal(ui.detail.obligations[0].compliance.contested, true);
    assert.ok(ui.inspector().includes("Payment claimed")); assert.deepEqual(ui.detail.obligations[0].events, []);
  } finally { player.destroy(); gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); unwrap(await reload.diplomacy.commands.retry(ticket)); const d: any = unwrap(await reload.diplomacy.agreements.query({ id }));
    assert.equal(d.obligations[0].evidence.length, 1); assert.equal(d.obligations[0].events.length, 1); assert.equal(d.obligations[0].events[0].reason, "Please review");
  } finally { reload.destroy(); }
});
test("G6 agreement inspector vertical: private snapshots/evidence stay absent after approved amendment and reload", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"); let id = "";
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, [inspectorObligation(), inspectorObligation("PRIVATE_OBLIGATION", {}, "secret")]); id = a.id; unwrap(await a.activate());
    let d: any = unwrap(await gm.diplomacy.agreements.query({ id }));
    unwrap(await a.modify({ kind: "obligation", obligationId: d.obligations[0].id, expectedObligationRevision: 0,
      action: { kind: "evidence", evidence: { id: "PRIVATE_EVIDENCE", ref: { type: "evidence", id: "PRIVATE_RECEIPT" }, statement: "PRIVATE_STATEMENT", position: "support", visibility: "secret", at: 0 } } }));
    unwrap(await a.modify({ kind: "amend", proposalId: "edited-offer", partyId: "party-0", terms: [inspectorObligation("tribute", { dueAtWorldTick: 80 })],
      duration: { startsAtWorldTick: 10, expiresAtWorldTick: 150 }, proposalExpiresAtWorldTick: null }));
    for (const [revision, partyId] of ["party-0", "party-1"].entries()) unwrap(await a.modify({ kind: "accept", proposalId: "edited-offer", expectedProposalRevision: revision, partyId }));
    unwrap(await a.modify({ kind: "activate", proposalId: "edited-offer", expectedProposalRevision: 2, amendmentId: "deadline-edit" }));
    f.time.tick = 30; d = unwrap(await gm.diplomacy.agreements.query({ id })); assert.equal(d.obligations.length, 3); assert.equal(d.amendments[0].proposalId, "edited-offer");
    assert.equal(d.amendments[0].comparison.duration.before.expiresAtWorldTick, 100); assert.equal(d.amendments[0].comparison.duration.after.expiresAtWorldTick, 150);
    const ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("agreements"); ui.select(id); unwrap(await ui.load());
    assert.equal(ui.detail.obligations.length, 2); assert.equal(ui.detail.obligations[0].compliance.applicable, false); assert.equal(ui.detail.obligations[1].compliance.applicable, true);
    assert.equal(JSON.stringify(ui.detail).includes("PRIVATE_"), false); assert.equal(ui.inspector().includes("PRIVATE_"), false); assert.deepEqual(ui.detail.amendments, []);
    assert.ok(ui.inspector().includes("Vencimento: 20")); assert.ok(ui.inspector().includes("Vencimento: 80"));
    const gmUi = new DiplomacyApplicationController(gm.diplomacy); gmUi.selectTab("agreements"); gmUi.select(id); unwrap(await gmUi.load());
    assert.ok(gmUi.inspector().includes("Alterações aplicadas pela emenda")); assert.ok(gmUi.inspector().includes("Proposta edited-offer"));
  } finally { player.destroy(); gm.destroy(); }
  const reload = f.make(), p = f.make("player"); try { await reload.initialize(); const d: any = unwrap(await p.diplomacy.agreements.query({ id }));
    assert.equal(d.obligations[0].termSnapshot.payload.dueAtWorldTick, 20); assert.equal(d.obligations[1].termSnapshot.payload.dueAtWorldTick, 80); assert.equal(JSON.stringify(d).includes("PRIVATE_"), false);
  } finally { p.destroy(); reload.destroy(); }
});
test("G6 agreement inspector vertical: GM selected decision enforces stale revision and leaves consequences unapplied", async () => {
  const f = fixture(), gm = f.make();
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, [inspectorObligation("tribute", { consequences: [structuredClone(economicOperation)] })]); unwrap(await a.activate());
    const ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("agreements"); ui.select(a.id); unwrap(await ui.load());
    unwrap(ui.selectAgreementObligation(ui.detail.obligations[0].id)); const stale = ui.detail.revision;
    const d: any = unwrap(await gm.diplomacy.agreements.query({ id: a.id })); unwrap(await a.modify({ kind: "obligation", obligationId: d.obligations[0].id, expectedObligationRevision: 0, action: { kind: "allege" } }));
    assert.equal((await ui.change({ kind: "obligation:decide", obligationId: d.obligations[0].id, lifecycle: "breached", reason: "Stale decision" })).ok, false);
    assert.equal(ui.detail.revision, stale); assert.equal(ui.agreementFormFields.reason, "Stale decision");
    unwrap(await ui.load()); unwrap(await ui.change({ kind: "obligation:decide", obligationId: d.obligations[0].id, lifecycle: "breached", reason: "Confirmed by GM" })); unwrap(await ui.load());
    assert.equal(ui.detail.lifecycle, "active"); assert.equal(ui.detail.obligations[0].compliance.confirmedBreach, true); assert.ok(ui.inspector().includes("Confirmed by GM"));
    assert.ok(ui.inspector().includes("economy:adjust"));
    const stored = [...f.adapter.state.values()].find(e => e.kind === "agreement" && e.id === a.id)!;
    assert.deepEqual((stored.data as any).executedOperations, []);
  } finally { gm.destroy(); }
});
