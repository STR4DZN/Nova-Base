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
const inheritedClaim = (id: string, patch = {}) => ({ id, sourceRef: { type: "manual", id: "gm" }, visibility: "public",
  startsAtWorldTick: 0, expiresAtWorldTick: null, claimantRef: { type: "narrative", id: "guild" }, claimType: "domain-manager:ownership",
  lifecycle: "active", contested: false, strength: null, inherited: true, ...patch });
const hierarchyInput = (ids: { child: string; administrative: string }, patch = {}) => ({ id: ids.child, expectedRevision: 0, reason: "Move hierarchy",
  action: { kind: "reparent", parents: { locatedInUuid: ids.administrative, administrativeParentUuid: null } }, ...patch });
async function claimsTerritories(r: ReturnType<typeof composeDomainManagerRuntime>) {
  const add = async (label: string, claims: any[], patch = {}, visibility = "public") => {
    const d = createDiplomacyDraft("territory", label, [], visibility as any), data: any = d.data;
    data.claims = claims; Object.assign(data.territory, patch); unwrap(await r.diplomacy.territory.create({ ...d, reason: "Create claims source" })); return d.id;
  };
  const root = await add("Root origin", [inheritedClaim("root", { claimType: "domain-manager:control" })]);
  const physical = await add("Physical origin", [inheritedClaim("same", { contested: true }), inheritedClaim("no-propagation", { inherited: false }),
    inheritedClaim("expired", { expiresAtWorldTick: 10 }), inheritedClaim("future", { startsAtWorldTick: 11 }),
    inheritedClaim("ended", { lifecycle: "ended" }), inheritedClaim("private-claim-marker", { visibility: "restricted" }),
    inheritedClaim("secret-claim-marker", { visibility: "secret" })], { locatedInUuid: root });
  const administrative = await add("Administrative origin", [inheritedClaim("admin")]);
  const child = await add("Child", [inheritedClaim("same", { inherited: false, claimantRef: { type: "domain", uuid: domainUuid } }),
    inheritedClaim("local-private", { visibility: "restricted", inherited: false, claimantRef: { type: "domain", uuid: domainUuid } })],
    { locatedInUuid: physical, administrativeParentUuid: administrative });
  return { root, physical, administrative, child, add };
}
function fixture(adapter = new InMemoryDiplomacyStorageAdapter(), transactions = new InMemoryTransactionStorageAdapter(), conditions?: (ref: import("../../src/core/identity/refs.js").TypedRef) => boolean) {
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
    diplomacyStorageAdapter: adapter, transactionStorageAdapter: transactions, ledgerStorageAdapter: ledger, worldTick: () => time.tick, diplomacyConditionSatisfied: conditions });
  return { make, adapter, transactions, time, ledger };
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
    assert.equal((await c.change({ ...fields, reason: "Edited after preview" })).ok, false);
    assert.equal((await c.change(fields)).ok, false); unwrap(await c.change(fields, true)); unwrap(await c.change(fields));
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
    unwrap(ui.openAgreementTermEditor("amend"));
    const fields = { ...ui.agreementTermEditor!.fields, term_0_title: "Changed", expires: "200", reason: "GM amended" };
    unwrap(ui.previewAgreementTerms(fields)); unwrap(await ui.change(fields)); unwrap(await ui.load());
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

test("G6 term editor vertical: proposal and counter retain multiple native snapshots and reset votes", async () => {
  const f = fixture(), gm = f.make(), draft = createDiplomacyDraft("agreement", "Editor treaty", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public");
  try {
    await gm.initialize(); unwrap(await gm.diplomacy.agreements.create({ ...draft, reason: "Create" }));
    const ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("agreements"); ui.select(draft.id); unwrap(await ui.load()); unwrap(ui.openAgreementTermEditor("propose"));
    let fields = { ...ui.agreementTermEditor!.fields, term_0_title: "Narrative", term_0_text: "  Keep exact spacing  ", expires: "100", proposalExpires: "50", reason: "Three terms" };
    ui.addAgreementTerm(fields); fields = { ...ui.agreementTermEditor!.fields, term_1_title: "Grant", term_1_type: "domain-manager:capability",
      term_1_payload: JSON.stringify({ beneficiaryPartyId: "party-0", capabilityIds: ["test:multi-grant"], scopeRef: null, conditionRefs: [] }) };
    ui.addAgreementTerm(fields); fields = { ...ui.agreementTermEditor!.fields, term_2_title: "Obligation", term_2_type: "domain-manager:obligation", term_2_payload: JSON.stringify(inspectorObligation().payload) };
    unwrap(ui.previewAgreementTerms(fields)); assert.equal(ui.agreementTermPreview!.terms.length, 3); unwrap(await ui.change(fields)); unwrap(await ui.load());
    const offer = ui.detail.proposals[0], ids = offer.rounds[0].terms.map((t: any) => t.id); assert.equal(offer.rounds[0].terms.length, 3); assert.equal(offer.expiresAtWorldTick, 50);
    assert.equal(offer.rounds[0].terms[0].text, "  Keep exact spacing  "); assert.equal(ui.detail.terms.length, 0); assert.equal(ui.detail.obligations.length, 0);
    assert.equal(JSON.stringify(unwrap(await gm.diplomacy.capabilities(domainUuid))).includes("test:multi-grant"), false);
    unwrap(await ui.change({ kind: "accept", sourceId: offer.id, partyId: "party-0", reason: "Accept first" })); unwrap(await ui.load());
    unwrap(ui.openAgreementTermEditor("counter", offer.id)); fields = { ...ui.agreementTermEditor!.fields, term_0_title: "Revised", reason: "Counter three terms" };
    ui.moveAgreementTerm(2, -1, fields); fields = { ...ui.agreementTermEditor!.fields }; unwrap(ui.previewAgreementTerms(fields)); unwrap(await ui.change(fields)); unwrap(await ui.load());
    const last = ui.detail.proposals[0].rounds[1]; assert.deepEqual(last.terms.map((t: any) => t.id), [ids[0], ids[2], ids[1]]); assert.deepEqual(last.acceptedPartyIds, []); assert.equal(last.comparison.orderChanged, true);
    assert.equal(ui.detail.proposals[0].rounds[0].terms[0].title, "Narrative");
    for (const partyId of ["party-0", "party-1"]) { unwrap(await ui.change({ kind: "accept", sourceId: offer.id, partyId, reason: "Agree" })); unwrap(await ui.load()); }
    unwrap(await ui.change({ kind: "activate", sourceId: offer.id, reason: "Activate" })); unwrap(await ui.load());
    assert.equal(ui.detail.terms.length, 3); assert.equal(ui.detail.obligations.length, 1); assert.ok(JSON.stringify(unwrap(await gm.diplomacy.capabilities(domainUuid))).includes("test:multi-grant"));
  } finally { gm.destroy(); }
});
test("G6 term editor vertical: Player amendment preserves secret canonical terms through GM approval and enactment/reload", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"); let id = "", secretBefore: any;
  const visible = { id: "visible", type: "domain-manager:narrative", title: "Visible", text: null, visibility: "public", partyIds: ["party-0", "party-1"], payload: { untouched: [1, 2] } };
  const secret = { ...structuredClone(visible), id: "private-term", title: "PRIVATE_FULL_TERM", visibility: "secret", payload: { private: "PRIVATE_PAYLOAD" } };
  const grant = { id: "grant", type: "domain-manager:capability", title: "Grant", text: null, visibility: "public", partyIds: ["party-0"], payload: { beneficiaryPartyId: "party-0", capabilityIds: ["test:preserved-grant"], scopeRef: null, conditionRefs: [] } };
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, [visible, secret, grant]); id = a.id; unwrap(await a.activate()); secretBefore = structuredClone(secret);
    const ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("agreements"); ui.select(id); unwrap(await ui.load()); unwrap(ui.openAgreementTermEditor("amend"));
    assert.equal(ui.agreementTermEditor!.count, 2); let fields = { ...ui.agreementTermEditor!.fields, term_0_title: "Edited", reason: "Please edit" };
    ui.addAgreementTerm(fields); fields = { ...ui.agreementTermEditor!.fields, term_2_title: "Added" }; unwrap(ui.previewAgreementTerms(fields));
    assert.equal(ui.agreementTermEditingForm().includes("PRIVATE_"), false); unwrap(await ui.change(fields));
    const pending: any = unwrap(await gm.diplomacy.agreements.query({ id })); assert.deepEqual(pending.terms, [visible, secret, grant]);
    const inbox: any = unwrap(await gm.diplomacy.proposals.query({})), request: any = unwrap(await gm.diplomacy.proposals.query({ id: inbox.items[0].id }));
    assert.equal(JSON.stringify(request.original.action).includes("PRIVATE_"), false); assert.deepEqual(request.original.action.baseTermIds, ["visible", "grant"]);
    unwrap(await gm.diplomacy.proposals.decide({ id: request.id, expectedRevision: request.revision, decision: "approve", reason: "Approved" }));
    let d: any = unwrap(await gm.diplomacy.agreements.query({ id })), offer = d.proposals[1]; assert.equal(offer.rounds[0].terms.length, 4); assert.deepEqual(offer.rounds[0].terms[1], secretBefore);
    for (const [revision, partyId] of ["party-0", "party-1"].entries()) unwrap(await a.modify({ kind: "accept", proposalId: offer.id, expectedProposalRevision: revision, partyId }));
    unwrap(await a.modify({ kind: "activate", proposalId: offer.id, expectedProposalRevision: 2, amendmentId: "edited-through-player" }));
    d = unwrap(await gm.diplomacy.agreements.query({ id })); assert.deepEqual(d.terms[1], secretBefore); assert.deepEqual(d.terms[2], grant); assert.equal(d.terms[0].title, "Edited");
    assert.ok(JSON.stringify(unwrap(await gm.diplomacy.capabilities(domainUuid))).includes("test:preserved-grant"));
  } finally { player.destroy(); gm.destroy(); }
  const reload = f.make(), p = f.make("player"); try { await reload.initialize(); const g: any = unwrap(await reload.diplomacy.agreements.query({ id })), d: any = unwrap(await p.diplomacy.agreements.query({ id }));
    assert.equal(g.terms.length, 4); assert.deepEqual(g.terms[1], secretBefore); assert.equal(d.terms.length, 3); assert.equal(JSON.stringify(d).includes("PRIVATE_"), false);
  } finally { p.destroy(); reload.destroy(); }
});
test("G6 term editor vertical: authority rejects stale editor revision and retains complete draft", async () => {
  const f = fixture(), gm = f.make();
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, [inspectorObligation()]); unwrap(await a.activate());
    const ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("agreements"); ui.select(a.id); unwrap(await ui.load()); unwrap(ui.openAgreementTermEditor("amend"));
    const fields = { ...ui.agreementTermEditor!.fields, term_0_title: "Keep draft", reason: "Intent from stale revision" }; unwrap(ui.previewAgreementTerms(fields));
    unwrap(await a.modify({ kind: "renew", expiresAtWorldTick: 200, automatic: false }));
    assert.equal((await ui.change(fields)).ok, false); assert.deepEqual(ui.agreementTermEditor!.fields, fields);
    const d: any = unwrap(await gm.diplomacy.agreements.query({ id: a.id })); assert.equal(d.duration.expiresAtWorldTick, 200); assert.equal(d.terms[0].title, "tribute"); assert.equal(d.proposals.length, 1);
    unwrap(await ui.load()); assert.equal(ui.previewAgreementTerms(fields).ok, false); assert.equal(ui.agreementTermEditor!.revision < ui.detail.revision, true);
  } finally { gm.destroy(); }
});
test("G6 term editor vertical: selected deletion in Player direct amendment retains secret terms and audits exact before/after", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), draft = createDiplomacyDraft("agreement", "Direct editor", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public");
  const data: any = draft.data; data.definition.amendmentRequiresApproval = false;
  const visible = { id: "visible", type: "domain-manager:narrative", title: "Visible", text: null, visibility: "public", partyIds: ["party-0", "party-1"], payload: {} }, hidden = { ...structuredClone(visible), id: "hidden", title: "PRIVATE_KEEP", visibility: "secret" };
  try {
    await gm.initialize(); unwrap(await gm.diplomacy.agreements.create({ id: draft.id, data, reason: "Create" }));
    const g = new DiplomacyApplicationController(gm.diplomacy); g.selectTab("agreements"); g.select(draft.id); unwrap(await g.load());
    unwrap(await gm.diplomacy.agreements.modify({ id: draft.id, expectedRevision: 0, action: { kind: "propose", proposalId: "offer", partyId: "party-0", terms: [visible, hidden], duration: { startsAtWorldTick: null, expiresAtWorldTick: 100 }, proposalExpiresAtWorldTick: null }, reason: "Offer" }));
    for (const partyId of ["party-0", "party-1"]) { unwrap(await g.load()); unwrap(await g.change({ kind: "accept", partyId, reason: "Accept" })); }
    unwrap(await g.load()); unwrap(await g.change({ kind: "activate", reason: "Activate" }));
    const ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("agreements"); ui.select(draft.id); unwrap(await ui.load()); unwrap(ui.openAgreementTermEditor("amend"));
    ui.removeAgreementTerm(0, { ...ui.agreementTermEditor!.fields, reason: "Remove visible term" }); const fields = { ...ui.agreementTermEditor!.fields };
    unwrap(ui.previewAgreementTerms(fields)); assert.equal(ui.agreementTermPreview!.terms[0].kind, "removed"); unwrap(await ui.change(fields));
    const inbox: any = unwrap(await gm.diplomacy.proposals.query({})), request: any = unwrap(await gm.diplomacy.proposals.query({ id: inbox.items[0].id }));
    unwrap(await gm.diplomacy.proposals.decide({ id: request.id, expectedRevision: request.revision, decision: "approve", reason: "Delete visible only" }));
    const d: any = unwrap(await gm.diplomacy.agreements.query({ id: draft.id })); assert.deepEqual(d.terms, [hidden]); assert.equal(d.amendments[0].beforeTerms.length, 2); assert.deepEqual(d.amendments[0].afterTerms, [hidden]); assert.equal(d.lifecycle, "active");
    const p: any = unwrap(await player.diplomacy.agreements.query({ id: draft.id })); assert.deepEqual(p.terms, []); assert.equal(JSON.stringify(p).includes("PRIVATE_"), false);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 term editor vertical: canonical selection rejects collisions/unknown IDs and exact ticket retry enacts one proposal", async () => {
  const f = fixture(), gm = f.make(); let id = "", ticket: any;
  const visible = { id: "visible", type: "domain-manager:narrative", title: "Visible", text: null, visibility: "public", partyIds: ["party-0", "party-1"], payload: {} }, secret = { ...structuredClone(visible), id: "secret", visibility: "secret" };
  try {
    await gm.initialize(); const a = await prepareAgreement(gm, [visible, secret]); id = a.id; unwrap(await a.activate());
    const before: any = unwrap(await gm.diplomacy.agreements.query({ id }));
    for (const patch of [{ terms: [structuredClone(secret)], baseTermIds: ["visible"] }, { terms: [], baseTermIds: ["missing"] }, { terms: [], baseTermIds: ["visible", "visible"] }]) {
      assert.equal((await gm.diplomacy.agreements.modify({ id, expectedRevision: before.revision, action: { kind: "amend", proposalId: crypto.randomUUID(), partyId: "party-0", duration: before.duration, proposalExpiresAtWorldTick: null, ...patch }, reason: "Invalid selection" })).ok, false);
    }
    assert.equal((unwrap(await gm.diplomacy.agreements.query({ id })) as any).revision, before.revision);
    const ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("agreements"); ui.select(id); unwrap(await ui.load()); unwrap(ui.openAgreementTermEditor("amend"));
    const fields = { ...ui.agreementTermEditor!.fields, term_0_title: "Edited", reason: "Once" }; unwrap(ui.previewAgreementTerms(fields));
    ticket = unwrap(gm.diplomacy.commands.prepare("agreements:modify", { id, expectedRevision: before.revision, action: unwrap(ui.buildAction(fields)), reason: "Once" }));
    unwrap(await gm.diplomacy.commands.execute(ticket)); unwrap(await gm.diplomacy.commands.retry(ticket)); const after: any = unwrap(await gm.diplomacy.agreements.query({ id }));
    assert.equal(after.proposals.length, 2); assert.equal(after.proposals[1].rounds[0].terms[0].title, "Edited"); assert.deepEqual(after.proposals[1].rounds[0].terms[1], secret);
  } finally { gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); unwrap(await reload.diplomacy.commands.retry(ticket)); assert.equal((unwrap(await reload.diplomacy.agreements.query({ id })) as any).proposals.length, 2);
  } finally { reload.destroy(); }
});

async function seedDashboardAgreement(adapter: InMemoryDiplomacyStorageAdapter, lifecycle: import("../../src/agreements/agreement-model.js").AgreementLifecycle, label: string, visibility = "public", controlled = true) {
  const { agreementOwner } = await import("../../src/agreements/agreement-owner.js");
  const d = createDiplomacyDraft("agreement", label, [{ type: "domain", uuid: controlled ? domainUuid : "JournalEntry.uncontrolled" }, { type: "narrative", id: "guild" }], visibility as any);
  let data: any = unwrap(agreementOwner.validate(d.data, []));
  const change = (action: unknown, tick = 10) => { const revision = data.state.agreement.revision;
    data = unwrap(agreementOwner.change(data, action, { expectedRevision: revision, eventId: `event-${revision}`, at: data.state.agreement.updatedAt + 1, worldTick: tick, reason: "Seed persisted history", sourceRefs: [{ type: "manual", id: "gm" }] }, [])); };
  if (!["draft", "terminated"].includes(lifecycle)) {
    change({ kind: "propose", proposalId: "offer", partyId: "party-0", terms: [], duration: { startsAtWorldTick: null, expiresAtWorldTick: 100 }, proposalExpiresAtWorldTick: null });
    if (lifecycle !== "proposed") change({ kind: "accept", proposalId: "offer", expectedProposalRevision: 0, partyId: "party-0" });
    if (!["proposed", "pendingApproval"].includes(lifecycle)) {
      change({ kind: "accept", proposalId: "offer", expectedProposalRevision: 1, partyId: "party-1" });
      change({ kind: "activate", proposalId: "offer", expectedProposalRevision: 2, amendmentId: "activation" });
      if (lifecycle === "suspended") change({ kind: "suspend" });
      if (lifecycle === "breached") change({ kind: "breach" });
      if (lifecycle === "expired") change({ kind: "expire" }, 100);
    }
  }
  if (lifecycle === "terminated") change({ kind: "terminate" });
  assert.equal(data.state.agreement.lifecycle, lifecycle);
  await adapter.write({ schemaVersion: 1, kind: "agreement", id: d.id, revision: data.state.agreement.revision, data, receipts: [] });
  return d.id;
}
test("G6 dashboard runtime: authoritative public API filters all persisted lifecycle states and negotiation group", async () => {
  const f = fixture(); const { AGREEMENT_LIFECYCLES } = await import("../../src/agreements/agreement-model.js");
  for (const state of AGREEMENT_LIFECYCLES) await seedDashboardAgreement(f.adapter, state, `Treaty ${state}`);
  const gm = f.make(), player = f.make("player");
  try { await gm.initialize();
    const all: any = unwrap(await gm.diplomacy.agreements.query()); assert.equal(all.total, 8); assert.equal(all.agreementSummary.total, 8);
    for (const state of AGREEMENT_LIFECYCLES) { const d: any = unwrap(await player.diplomacy.agreements.query({ agreementLifecycle: state }));
      assert.equal(d.total, 1); assert.equal(d.items[0].lifecycle, state); assert.equal(d.agreementSummary.byLifecycle[state], 1); assert.equal(d.agreementSummary.total, 8); }
    const group: any = unwrap(await player.diplomacy.agreements.query({ agreementLifecycle: "negotiation" })); assert.equal(group.total, 2);
    assert.deepEqual(group.items.map((x: any) => x.lifecycle).sort(), ["pendingApproval", "proposed"]);
    assert.equal((await player.diplomacy.agreements.query({ agreementLifecycle: "all" } as any)).ok, false);
    assert.equal((await player.diplomacy.agreements.query({ id: all.items[0].id, agreementLifecycle: "draft" })).ok, false);
    for (const owner of [player.diplomacy.relations, player.diplomacy.reputation, player.diplomacy.territory, player.diplomacy.disputes, player.diplomacy.proposals])
      assert.equal((await owner.query({ agreementLifecycle: "active" })).ok, false);
    assert.equal((unwrap(await player.diplomacy.relations.query()) as any).agreementSummary, undefined);
    assert.equal((unwrap(await gm.diplomacy.agreements.query({ id: all.items[0].id })) as any).agreementSummary, undefined);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 dashboard runtime: authenticated participant, stranger and GM receive only authorized aggregate counts", async () => {
  const f = fixture(); await seedDashboardAgreement(f.adapter, "active", "Public"); await seedDashboardAgreement(f.adapter, "suspended", "Controlled", "restricted");
  const secret = await seedDashboardAgreement(f.adapter, "terminated", "Private marker", "secret");
  await seedDashboardAgreement(f.adapter, "breached", "Other participant", "restricted", false);
  const gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const a: any = unwrap(await gm.diplomacy.agreements.query()), b: any = unwrap(await player.diplomacy.agreements.query()), c: any = unwrap(await stranger.diplomacy.agreements.query());
    assert.equal(a.agreementSummary.total, 4); assert.equal(b.agreementSummary.total, 2); assert.equal(c.agreementSummary.total, 1);
    assert.equal(b.agreementSummary.byLifecycle.suspended, 1); assert.equal(b.agreementSummary.byLifecycle.breached, 0); assert.equal(b.agreementSummary.byLifecycle.terminated, 0);
    assert.equal(JSON.stringify(b).includes(secret), false); assert.equal(JSON.stringify(b).includes("Private marker"), false);
    assert.equal((unwrap(await player.diplomacy.agreements.query({ search: "Private marker" })) as any).agreementSummary.total, 0);
    const filtered: any = unwrap(await player.diplomacy.agreements.query({ agreementLifecycle: "terminated" })); assert.equal(filtered.total, 0); assert.equal(filtered.agreementSummary.total, 2);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 dashboard runtime: controller pages and search compose; reads preserve history across authority reload", async () => {
  const f = fixture(); for (let i = 0; i < 35; i++) await seedDashboardAgreement(f.adapter, "draft", `Trade ${i}`);
  await seedDashboardAgreement(f.adapter, "active", "Other"); const before = await f.adapter.loadAll(), gm = f.make(); let expected: any;
  try { await gm.initialize(); const c = new DiplomacyApplicationController(gm.diplomacy); c.selectTab("agreements"); c.setSearch("trade"); unwrap(c.selectAgreementLifecycle("draft"));
    unwrap(await c.load()); assert.equal(c.list.items.length, 30); assert.equal(c.list.agreementSummary.total, 35); c.offset = 30; unwrap(await c.load());
    assert.equal(c.list.items.length, 5); assert.equal(c.list.total, 35); assert.equal(c.list.agreementSummary.total, 35);
    expected = c.list.agreementSummary; assert.deepEqual(await f.adapter.loadAll(), before);
    assert.ok(c.render().includes("acordos neste filtro/pesquisa"));
  } finally { gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); const d: any = unwrap(await reload.diplomacy.agreements.query({ search: "trade", agreementLifecycle: "draft", offset: 30 }));
    assert.deepEqual(d.agreementSummary, expected); assert.equal(d.items.length, 5); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { reload.destroy(); }
});
test("G6 dashboard runtime: pending amendment and elapsed deadline leave registered active state unchanged", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const p = await prepareAgreement(gm, []); unwrap(await p.activate());
    unwrap(await p.modify({ kind: "amend", amendmentId: "pending", proposalId: "amend-offer", partyId: "party-0", terms: [], duration: { startsAtWorldTick: null, expiresAtWorldTick: 200 }, proposalExpiresAtWorldTick: 50 }));
    const before = await f.adapter.loadAll(); f.time.tick = 500;
    const d: any = unwrap(await gm.diplomacy.agreements.query({ agreementLifecycle: "active" })); assert.equal(d.total, 1); assert.equal(d.agreementSummary.byLifecycle.active, 1);
    assert.equal(d.agreementSummary.byLifecycle.expired, 0); const negotiations: any = unwrap(await gm.diplomacy.agreements.query({ agreementLifecycle: "negotiation" })); assert.equal(negotiations.total, 0);
    assert.deepEqual(await f.adapter.loadAll(), before); assert.equal(f.time.tick, 500);
    const detail: any = unwrap(await gm.diplomacy.agreements.query({ id: p.id })); assert.equal(detail.proposals.at(-1).lifecycle, "open"); assert.equal(detail.lifecycle, "active");
    unwrap(await p.modify({ kind: "expire" })); const expired: any = unwrap(await gm.diplomacy.agreements.query({ agreementLifecycle: "expired" })); assert.equal(expired.total, 1);
  } finally { gm.destroy(); }
});

test("G6 reputation history runtime: authority filters real adjustments, exact reversal and configured decay using applied deltas", async () => {
  const f = fixture(), gm = f.make(), draft = reputationDraftFor();
  try { await gm.initialize(); unwrap(await gm.diplomacy.reputation.create({ ...draft, reason: "Create standing" }));
    let d: any = unwrap(await gm.diplomacy.reputation.query({ id: draft.id }));
    unwrap(await gm.diplomacy.reputation.modify({ id: draft.id, expectedRevision: d.revision, action: { kind: "configure-track", trackId: "domain-manager:standing",
      policy: reputationPolicyFor(d, "domain-manager:standing", { decay: { amount: 5, periodTicks: 10 } }) }, reason: "Enable decay" }));
    const modify = async (action: any) => { const current: any = unwrap(await gm.diplomacy.reputation.query({ id: draft.id }));
      return gm.diplomacy.reputation.modify({ id: draft.id, expectedRevision: current.revision, action, reason: "Audited change" }); };
    d = unwrap(await gm.diplomacy.reputation.query({ id: draft.id }));
    const ticket = unwrap(gm.diplomacy.commands.prepare("reputation:modify", { id: draft.id, expectedRevision: d.revision,
      action: { kind: "adjust", trackId: "domain-manager:standing", delta: 230 }, reason: "Clamp to policy range" }));
    unwrap(await gm.diplomacy.commands.execute(ticket)); unwrap(await gm.diplomacy.commands.retry(ticket));
    d = unwrap(await gm.diplomacy.reputation.query({ id: draft.id })); assert.equal(d.entries[0].delta, 100); const original = d.entries[0].id;
    f.time.tick = 20; unwrap(await modify({ kind: "decay", trackId: "domain-manager:standing" }));
    unwrap(await modify({ kind: "adjust", trackId: "domain-manager:standing", delta: -100, reversalOf: original }));
    f.time.tick = 30; unwrap(await modify({ kind: "decay", trackId: "domain-manager:standing" }));
    const before = await f.adapter.loadAll();
    const all: any = unwrap(await gm.diplomacy.reputation.query({ id: draft.id })); assert.equal(all.tracks[0].score, 0); assert.equal(all.reputationHistory.total, 4);
    assert.deepEqual(all.reputationHistory.byKind, { adjustment: 1, reversal: 1, decay: 2 }); assert.equal(all.configurationHistory.length, 1);
    const source: any = unwrap(await gm.diplomacy.reputation.query({ id: draft.id, reputationHistory: { source: { type: "command", id: ticket.commandId } } }));
    assert.equal(source.reputationHistory.total, 1); assert.equal(source.reputationHistory.sources.items[0].gains, "100"); assert.equal(source.entries[0].delta, 100);
    const decay: any = unwrap(await gm.diplomacy.reputation.query({ id: draft.id, reputationHistory: { trackId: "domain-manager:standing", kind: "decay", fromWorldTick: 20, toWorldTick: 30 } }));
    assert.equal(decay.reputationHistory.total, 2); assert.deepEqual(decay.entries.map((e: any) => e.delta), [-5, 5]); assert.equal(decay.tracks[0].score, 0);
    const reversal: any = unwrap(await gm.diplomacy.reputation.query({ id: draft.id, reputationHistory: { kind: "reversal" } }));
    assert.equal(reversal.entries[0].reversalOf, original); assert.equal(reversal.reputationHistory.sources.items[0].losses, "-100");
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});
async function seedReputationHistory(adapter: InMemoryDiplomacyStorageAdapter) {
  const { reputationOwner } = await import("../../src/reputation/reputation-owner.js"), draft = reputationDraftFor(); let data: any = draft.data;
  const change = (action: any, source: any, tick: number) => { data = unwrap(reputationOwner.change(data, action, {
    expectedRevision: data.record.revision, eventId: crypto.randomUUID(), at: data.record.updatedAt + 1, worldTick: tick, sourceRefs: [source], reason: "Seed canonical history" }, [])); };
  for (let i = 0; i < 65; i++) change({ kind: "adjust", trackId: "domain-manager:standing", delta: i % 2 ? -1 : 1 }, { type: "mission", id: String(i % 35) }, i);
  const extra = { ...data.definitions[0], id: "test:private-history", version: 1, label: "private-history-track-marker", visibility: "secret", publicPresentation: "hidden" };
  change({ kind: "add-track", definition: extra, initialScore: 0 }, { type: "manual", id: "gm" }, 65);
  change({ kind: "adjust", trackId: extra.id, delta: 5 }, { type: "mission", uuid: "JournalEntry.privateHistorySource" }, 66);
  await adapter.write({ schemaVersion: 1, kind: "reputation", id: draft.id, revision: data.record.revision, data, receipts: [] });
  return draft.id;
}
test("G6 reputation history runtime: authenticated Player/stranger cannot receive history or probe private sources/tracks", async () => {
  const f = fixture(), id = await seedReputationHistory(f.adapter), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize();
    for (const viewer of [player, stranger]) { const d: any = unwrap(await viewer.diplomacy.reputation.query({ id })); assert.equal(d.tracks.length, 1);
      assert.equal(d.entries, undefined); assert.equal(d.reputationHistory, undefined); assert.equal(d.tracks[0].score, undefined);
      assert.equal(JSON.stringify(d).includes("private-history"), false); assert.equal(JSON.stringify(d).includes("privateHistorySource"), false);
      const known = await viewer.diplomacy.reputation.query({ id, reputationHistory: { trackId: "domain-manager:standing" } }), hidden = await viewer.diplomacy.reputation.query({ id, reputationHistory: { trackId: "test:private-history" } });
      assert.deepEqual(known, hidden); assert.equal(known.ok, false);
      const source = await viewer.diplomacy.reputation.query({ id, reputationHistory: { source: { type: "mission", uuid: "JournalEntry.privateHistorySource" } } });
      assert.deepEqual(known, source); assert.equal((await viewer.diplomacy.reputation.query({ id, reputationSourceOffset: 0 })).ok, false);
    }
    const privateTrack: any = unwrap(await gm.diplomacy.reputation.query({ id, reputationHistory: { trackId: "test:private-history", source: { type: "mission", uuid: "JournalEntry.privateHistorySource" } } }));
    assert.equal(privateTrack.reputationHistory.total, 1); assert.equal(privateTrack.reputationHistory.sources.items[0].net, "5");
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 reputation history runtime: GM controller uses independent pages, source drilldown and resets filters for another record", async () => {
  const f = fixture(), id = await seedReputationHistory(f.adapter), gm = f.make(), c = new DiplomacyApplicationController(gm.diplomacy);
  try { await gm.initialize(); c.selectTab("reputation"); c.select(id); unwrap(await c.load());
    unwrap(c.applyReputationHistory({ trackId: "domain-manager:standing", kind: "", sourceType: "", sourceKind: "id", sourceRef: "", from: "", to: "" })); unwrap(await c.load());
    assert.equal(c.detail.entries.length, 30); assert.equal(c.detail.reputationHistory.total, 65); assert.equal(c.detail.reputationHistory.sources.total, 35);
    c.historyOffset = 60; c.reputationSourceOffset = 30; unwrap(await c.load()); assert.equal(c.detail.entries.length, 5); assert.equal(c.detail.reputationHistory.sources.items.length, 5);
    const source = c.detail.reputationHistory.sources.items[0]; unwrap(c.filterReputationSource(source.trackId, source.source.type, "id", source.source.id)); unwrap(await c.load());
    assert.equal(c.historyOffset, 0); assert.equal(c.reputationSourceOffset, 0); assert.equal(c.detail.reputationHistory.sources.total, 1);
    assert.ok(c.render().includes("Ver lançamentos desta fonte"));
    const other = reputationDraftFor("Other standing"); unwrap(await gm.diplomacy.reputation.create({ ...other, reason: "Create other" })); c.select(other.id); unwrap(await c.load());
    assert.deepEqual(c.reputationHistoryFilter, {}); assert.equal(c.detail.reputationHistory.total, 0); assert.ok(c.render().includes("Nenhum lançamento nesta página/filtro"));
  } finally { gm.destroy(); }
});
test("G6 reputation history runtime: filters and summaries rebuild after reload without changing canonical score, history or clock", async () => {
  const f = fixture(), id = await seedReputationHistory(f.adapter), before = await f.adapter.loadAll(), gm = f.make(); let expected: any;
  const query = { id, reputationHistory: { trackId: "domain-manager:standing", sourceType: "mission", fromWorldTick: 10, toWorldTick: 60 }, historyOffset: 30, historyLimit: 30, reputationSourceOffset: 30, reputationSourceLimit: 30 };
  try { await gm.initialize(); expected = unwrap(await gm.diplomacy.reputation.query(query)); assert.equal(expected.reputationHistory.total, 51);
    assert.equal(expected.entries.length, 21); assert.equal(expected.tracks[0].score, 1); assert.equal(expected.reputationHistory.sources.total, 35);
    assert.deepEqual(await f.adapter.loadAll(), before); assert.equal(f.time.tick, 10);
  } finally { gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); assert.deepEqual(unwrap(await reload.diplomacy.reputation.query(query)), expected); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { reload.destroy(); }
});
test("G6 reputation history runtime: filters cannot enter list/other namespaces and exact-final entry page has no next button", async () => {
  const f = fixture(), gm = f.make(), draft = reputationDraftFor();
  try { await gm.initialize(); unwrap(await gm.diplomacy.reputation.create({ ...draft, reason: "Create" }));
    for (const owner of [gm.diplomacy.relations, gm.diplomacy.agreements, gm.diplomacy.territory, gm.diplomacy.disputes, gm.diplomacy.proposals])
      assert.equal((await owner.query({ id: draft.id, reputationHistory: {} })).ok, false);
    assert.equal((await gm.diplomacy.reputation.query({ reputationHistory: {} })).ok, false);
    assert.equal((await gm.diplomacy.reputation.query({ id: draft.id, reputationHistory: { fromWorldTick: 20, toWorldTick: 10 } })).ok, false);
    for (let i = 0; i < 30; i++) unwrap(await gm.diplomacy.reputation.modify({ id: draft.id, expectedRevision: i, action: { kind: "adjust", trackId: "domain-manager:standing", delta: 1 }, reason: "Award" }));
    const c = new DiplomacyApplicationController(gm.diplomacy); c.selectTab("reputation"); c.select(draft.id); unwrap(await c.load());
    assert.equal(c.detail.entries.length, 30); assert.equal(c.detail.reputationHistory.total, 30); assert.ok(c.render().includes('data-dm-history="1" disabled'));
    assert.equal((unwrap(await gm.diplomacy.reputation.query()) as any).reputationHistory, undefined);
  } finally { gm.destroy(); }
});

test("G6 overview runtime: immutable public facade aggregates six owners with authenticated requester inbox", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const rel = relation(); unwrap(await gm.diplomacy.relations.create({ id: rel.state.relation.id, data: rel, reason: "Create" }));
    const rep = createDiplomacyDraft("reputation", "Standing", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public");
    unwrap(await gm.diplomacy.reputation.create({ ...rep, reason: "Create" }));
    const territory = createDiplomacyDraft("territory", "Region", [], "public"); unwrap(await gm.diplomacy.territory.create({ ...territory, reason: "Create" }));
    const dispute = createDiplomacyDraft("dispute", "Boundary", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "restricted", [territory.id]);
    unwrap(await gm.diplomacy.disputes.create({ ...dispute, reason: "Create" }));
    const a = await prepareAgreement(gm, []); unwrap(await a.activate());
    unwrap(await player.diplomacy.proposals.submit({ id: "overview-request", intent: { kind: "relation", mode: "modify", id: rel.state.relation.id, expectedRevision: 0, action: incident, reason: "Private intent marker" } }));
    assert.ok(gm.registry.get("diplomacy:overview")); assert.ok(Object.isFrozen(gm.publicApi.diplomacy.overview));
    const all = unwrap(await gm.diplomacy.overview.query({ expiryHorizonTicks: 90 })), own = unwrap(await player.diplomacy.overview.query({ expiryHorizonTicks: 90 })), other = unwrap(await stranger.diplomacy.overview.query({ expiryHorizonTicks: 90 }));
    assert.deepEqual(all.summary.records, { relation: 1, reputation: 1, agreement: 1, territory: 1, dispute: 1, proposal: 1 });
    assert.equal(all.summary.proposals, 1); assert.equal(own.summary.proposals, 1); assert.equal(other.summary.proposals, 0); assert.equal(other.summary.disputes, 0);
    assert.equal(own.summary.expiring, 1); assert.equal(own.summary.changes, null); assert.equal(JSON.stringify(own).includes("Private intent marker"), false);
    for (const item of own.items) assert.equal(Object.hasOwn(item, "changedAtReal"), false);
    assert.equal(JSON.stringify(other).includes("overview-request"), false);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 overview runtime: restricted and secret records cannot affect Player counts or private search", async () => {
  const f = fixture(); await seedDashboardAgreement(f.adapter, "active", "Public"); await seedDashboardAgreement(f.adapter, "breached", "Controlled", "restricted");
  const secret = await seedDashboardAgreement(f.adapter, "breached", "Secret probe marker", "secret"); await seedDashboardAgreement(f.adapter, "breached", "Other", "restricted", false);
  const gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const a = unwrap(await gm.diplomacy.overview.query()), b = unwrap(await player.diplomacy.overview.query()), c = unwrap(await stranger.diplomacy.overview.query());
    assert.equal(a.summary.breaches, 3); assert.equal(b.summary.breaches, 1); assert.equal(c.summary.breaches, 0); assert.equal(b.summary.records.agreement, 2); assert.equal(c.summary.records.agreement, 1);
    assert.equal(JSON.stringify(b).includes(secret), false); assert.equal(JSON.stringify(b).includes("Secret probe marker"), false);
    for (const search of ["Secret probe marker", "Missing record marker"]) { const d = unwrap(await player.diplomacy.overview.query({ search })); assert.equal(d.total, 0); assert.equal(d.summary.attention, 0); assert.equal(d.summary.records.agreement, 0); }
    for (const query of [{ isGm: true }, { senderUserId: "gm" }, { id: secret }, { agreementLifecycle: "active" }, { recentHours: 0 }])
      assert.equal((await player.diplomacy.overview.query(query as any)).ok, false);
    const ticket = unwrap(player.diplomacy.commands.prepare("diplomacy:overview", { filter: "breaches" })); assert.equal(unwrap(await player.diplomacy.commands.execute(ticket)).status, "executed");
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 overview runtime: visible current obligations determine overdue and breach, without secret term counts", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const a = await prepareAgreement(gm, [inspectorObligation("Secret obligation marker", { overduePolicy: "allege-breach" }, "secret")]); unwrap(await a.activate());
    f.time.tick = 26; const before = await f.adapter.loadAll();
    assert.equal(unwrap(await gm.diplomacy.overview.query()).summary.overdue, 1); assert.equal(unwrap(await gm.diplomacy.overview.query()).summary.breaches, 0);
    assert.equal(unwrap(await player.diplomacy.overview.query()).summary.overdue, 0); assert.equal(unwrap(await stranger.diplomacy.overview.query()).summary.overdue, 0);
    assert.deepEqual(await f.adapter.loadAll(), before);
    const d: any = unwrap(await gm.diplomacy.agreements.query({ id: a.id })), obligation = d.obligations[0];
    unwrap(await a.modify({ kind: "obligation", obligationId: obligation.id, expectedObligationRevision: obligation.revision, action: { kind: "decide", lifecycle: "breached" } }));
    assert.equal(unwrap(await gm.diplomacy.overview.query()).summary.breaches, 1); assert.equal(unwrap(await player.diplomacy.overview.query()).summary.breaches, 0);
    const publicAgreement = await prepareAgreement(gm, [inspectorObligation("Public obligation")]); unwrap(await publicAgreement.activate());
    f.time.tick = 25; assert.equal(unwrap(await stranger.diplomacy.overview.query()).summary.overdue, 0);
    f.time.tick = 26; const s = unwrap(await stranger.diplomacy.overview.query()); assert.equal(s.summary.overdue, 1); assert.equal(s.summary.breaches, 0);
    assert.equal(JSON.stringify(s).includes("Secret obligation marker"), false); assert.equal(JSON.stringify(s).includes("test:coin"), false);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 overview runtime: recovery entity and graph fences exclude records and derivatives until recovery", async () => {
  const { lockKey } = await import("../../src/mutations/lock-keys.js"); const f = fixture(); const id = await seedDashboardAgreement(f.adapter, "breached", "Blocked"); const gm = f.make();
  try { await gm.initialize(); const territory = createDiplomacyDraft("territory", "Region", [], "public"); unwrap(await gm.diplomacy.territory.create({ ...territory, reason: "Create" }));
    const dispute = createDiplomacyDraft("dispute", "Boundary", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public", [territory.id]); unwrap(await gm.diplomacy.disputes.create({ ...dispute, reason: "Create" }));
    const before = await f.adapter.loadAll(); gm.recovery.fenceRegistry.installFence({ transactionId: "block", lockKeys: [lockKey.diplomacy("agreement", id), lockKey.territoryGraph()], reason: "Needs recovery" });
    const d = unwrap(await gm.diplomacy.overview.query({ expiryHorizonTicks: 100 })); assert.equal(d.summary.records.agreement, 0); assert.equal(d.summary.records.territory, 0); assert.equal(d.summary.records.dispute, 0); assert.equal(d.summary.breaches, 0); assert.equal(d.summary.expiring, 0);
    gm.recovery.fenceRegistry.removeFence("block"); assert.equal(unwrap(await gm.diplomacy.overview.query()).summary.disputes, 1); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});
test("G6 overview runtime: GM canonical changes and controller drilldown reload without owner mutation", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"); let id = "";
  try { await gm.initialize(); const rep = createDiplomacyDraft("reputation", "Standing", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public"); id = rep.id;
    unwrap(await gm.diplomacy.reputation.create({ ...rep, reason: "Create" })); unwrap(await gm.diplomacy.reputation.modify({ id, expectedRevision: 0, action: { kind: "adjust", trackId: "domain-manager:standing", delta: 5 }, reason: "Hidden history marker" }));
    const before = await f.adapter.loadAll(), c = new DiplomacyApplicationController(gm.diplomacy); c.selectTab("overview"); unwrap(c.applyOverviewFilter("changes")); unwrap(await c.load());
    assert.equal(c.list.summary.changes, 1); assert.equal(c.list.items[0].id, id); assert.ok(c.list.items[0].changedAtReal > 0);
    unwrap(c.openOverviewItem("reputation", id)); unwrap(await c.load()); assert.equal(c.detail.tracks[0].score, 5);
    const p = unwrap(await player.diplomacy.overview.query({ filter: "changes" })); assert.equal(p.total, 0); assert.equal(p.summary.changes, null); assert.equal(JSON.stringify(p).includes("Hidden history marker"), false);
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); assert.equal(unwrap(await reload.diplomacy.overview.query({ filter: "changes" })).items[0].id, id); }
  finally { reload.destroy(); }
});
test("G6 overview runtime: multiple pages retain search-scoped cards, expiry alerts and active lifecycle after reload", async () => {
  const f = fixture(); for (let i = 0; i < 35; i++) await seedDashboardAgreement(f.adapter, "active", `Trade ${i}`); await seedDashboardAgreement(f.adapter, "active", "Other"); f.time.tick = 100;
  const before = await f.adapter.loadAll(), gm = f.make(); let counts: any;
  try { await gm.initialize(); const c = new DiplomacyApplicationController(gm.diplomacy); c.selectTab("overview"); c.setSearch("trade"); unwrap(c.applyOverviewFilter("expiring", 0)); unwrap(await c.load());
    assert.equal(c.list.items.length, 30); assert.equal(c.list.summary.expiring, 35); c.offset = 30; unwrap(await c.load()); assert.equal(c.list.items.length, 5); assert.equal(c.list.total, 35); assert.equal(c.list.summary.expiring, 35);
    assert.ok(c.list.items.every((x: any) => x.reasons.includes("expiry-due") && x.lifecycle === "active")); counts = c.list.summary; assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); const d = unwrap(await reload.diplomacy.overview.query({ search: "trade", filter: "expiring", offset: 30, expiryHorizonTicks: 0 })); assert.deepEqual(d.summary, counts); assert.equal(d.items.length, 5); assert.deepEqual(await f.adapter.loadAll(), before); }
  finally { reload.destroy(); }
});
test("G6 overview runtime: public agreement restricted terms admit controllers, hide strangers and omit satisfied deadlines", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const a = await prepareAgreement(gm, [inspectorObligation("Restricted deadline marker", {}, "restricted")]); unwrap(await a.activate());
    f.time.tick = 26; assert.equal(unwrap(await player.diplomacy.overview.query()).summary.overdue, 1); assert.equal(unwrap(await stranger.diplomacy.overview.query()).summary.overdue, 0);
    const d: any = unwrap(await gm.diplomacy.agreements.query({ id: a.id })), obligation = d.obligations[0];
    unwrap(await a.modify({ kind: "obligation", obligationId: obligation.id, expectedObligationRevision: obligation.revision, action: { kind: "decide", lifecycle: "satisfied" } }));
    const before = await f.adapter.loadAll(), p = unwrap(await player.diplomacy.overview.query()); assert.equal(p.summary.overdue, 0); assert.equal(p.summary.breaches, 0); assert.equal(JSON.stringify(p).includes("Restricted deadline marker"), false); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});

async function recognitionTerritory(gm: ReturnType<typeof composeDomainManagerRuntime>) {
  const draft = createDiplomacyDraft("territory", "Recognition region", [], "public");
  const source = { sourceRef: { type: "manual", id: "gm" }, startsAtWorldTick: 0, expiresAtWorldTick: null, claimType: "domain-manager:ownership", lifecycle: "active", contested: false, strength: null, inherited: false };
  const data: any = draft.data; data.claims = [
    { ...source, id: "visible-claim", visibility: "public", claimantRef: { type: "domain", uuid: domainUuid } },
    { ...source, id: "secret-claim-marker", visibility: "secret", claimantRef: { type: "narrative", id: "private guild" } },
    { ...source, id: "restricted-claim", visibility: "restricted", claimantRef: { type: "domain", uuid: domainUuid } }
  ];
  data.claims = data.claims.map((c: any) => ({ ...c, sourceRef: { ...c.sourceRef } }));
  unwrap(await gm.diplomacy.territory.create({ id: draft.id, data, reason: "Create recognition fixture" })); return draft.id;
}
const recognitionAction = (claimId = "visible-claim", patch = {}) => ({ kind: "recognition", value: { id: crypto.randomUUID(), claimId,
  recognizingRef: { type: "domain", uuid: domainUuid }, position: "positive", sourceRef: { type: "manual", id: "recognition" },
  visibility: "public", startsAtWorldTick: 10, expiresAtWorldTick: null, ...patch } });
test("G6 recognition security: guessed secret claim and missing claim produce the same rejection before proposal preparation", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const id = await recognitionTerritory(gm), before = await f.adapter.loadAll(); let error: any;
    for (const claimId of ["secret-claim-marker", "missing-claim-marker"]) {
      const result = await player.diplomacy.proposals.submit({ id: crypto.randomUUID(), intent: { kind: "territory", mode: "modify", id,
        expectedRevision: 0, action: recognitionAction(claimId), reason: "Request recognition" } });
      assert.equal(result.ok, false); if (!result.ok) { if (error) assert.deepEqual(result.error, error); error = result.error; }
    }
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
const recognitionUiFields = (patch = {}) => ({ recognitionClaimId: "visible-claim", recognitionPartyType: "domain", recognitionPartyRef: domainUuid,
  recognitionDomainUuid: "", recognitionPosition: "unknown", recognitionVisibility: "public", recognitionStarts: "", recognitionExpires: "", reason: "Declare position", ...patch });
test("G6 recognition runtime: GM form registers three contextual positions and read-only window counts preserve claims", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const id = await recognitionTerritory(gm), ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("territory"); ui.select(id); unwrap(await ui.load());
    const claims = structuredClone(ui.detail.claims);
    for (const [position, starts, expires] of [["positive", "0", "10"], ["negative", "10", "20"], ["unknown", "15", ""]]) {
      unwrap(await ui.submitRecognition(recognitionUiFields({ recognitionPosition: position, recognitionStarts: starts, recognitionExpires: expires, recognitionRevision: String(ui.detail.revision) }))); unwrap(await ui.load());
    }
    assert.equal(ui.detail.recognitions.length, 3); assert.equal(ui.detail.revision, 3); assert.deepEqual(ui.detail.claims, claims); assert.equal(ui.detail.worldTick, 10);
    const p: any = unwrap(await player.diplomacy.territory.query({ id })); assert.equal(p.recognitions.length, 3); assert.equal(p.claims.length, 2);
    const before = await f.adapter.loadAll(), h = ui.render(); assert.ok(h.includes("0 reconhecem · 1 não reconhecem · 0 sem posição")); assert.ok(h.includes("Expirada")); assert.ok(h.includes("Agendada"));
    f.time.tick = 15; unwrap(await ui.load()); assert.ok(ui.render().includes("0 reconhecem · 1 não reconhecem · 1 sem posição")); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 recognition runtime: Player submits visible claim, GM UI edits context on approval without rewriting original", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const id = await recognitionTerritory(gm), ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("territory"); ui.select(id); unwrap(await ui.load());
    assert.equal(ui.render().includes("secret-claim-marker"), false); unwrap(await ui.submitRecognition(recognitionUiFields({ recognitionPosition: "positive", recognitionRevision: "0" })));
    const list: any = unwrap(await player.diplomacy.proposals.query()), proposalId = list.items[0].id, requested: any = unwrap(await player.diplomacy.proposals.query({ id: proposalId }));
    assert.equal((unwrap(await gm.diplomacy.territory.query({ id })) as any).recognitions.length, 0); assert.equal((await stranger.diplomacy.proposals.query({ id: proposalId })).ok, false);
    const review = new DiplomacyApplicationController(gm.diplomacy); review.selectTab("proposals"); review.select(proposalId); unwrap(await review.load());
    assert.ok(review.recognitionReviewTarget); assert.equal(review.recognitionReviewTarget.worldTick, 10); assert.ok(review.render().includes("Revisar reconhecimento")); assert.ok(review.render().includes("Reconhecimento solicitado"));
    unwrap(await review.review("approve", "Revised explicit decision", { ...recognitionUiFields({ recognitionPartyType: "narrative", recognitionPartyRef: "Council", recognitionPosition: "negative", recognitionStarts: "0", recognitionExpires: "50", recognitionVisibility: "restricted" }), recognitionReview: "on" }));
    const approved: any = unwrap(await player.diplomacy.proposals.query({ id: proposalId })); assert.deepEqual(approved.original, requested.original); assert.equal(approved.decision.approvedIntent.action.value.position, "negative");
    const target: any = unwrap(await player.diplomacy.territory.query({ id })); assert.equal(target.recognitions[0].recognizingRef.id, "Council"); assert.equal(target.recognitions[0].id, requested.original.action.value.id); assert.equal(target.recognitions[0].startsAtWorldTick, 0);
    assert.equal((unwrap(await stranger.diplomacy.territory.query({ id })) as any).recognitions.length, 0); unwrap(await review.load()); assert.ok(review.render().includes("Reconhecimento aprovado")); assert.equal(review.render().includes("Aprovar reconhecimento"), false);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 recognition runtime: stale form and stale approval retain draft until explicit revision refresh", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const id = await recognitionTerritory(gm), ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("territory"); ui.select(id); unwrap(await ui.load());
    unwrap(await gm.diplomacy.territory.modify({ id, expectedRevision: 0, action: { kind: "contest-claim", id: "visible-claim" }, reason: "Concurrent edit" }));
    assert.equal((await ui.submitRecognition(recognitionUiFields({ recognitionRevision: "0" }))).ok, false); unwrap(await ui.load()); assert.equal(ui.territoryRecognitionFields.recognitionRevision, "0"); assert.equal((await ui.submitRecognition(recognitionUiFields({ recognitionRevision: "0" }))).ok, false);
    ui.resetRecognitionDraft(); unwrap(await ui.submitRecognition(recognitionUiFields({ recognitionRevision: "1" })));
    const list: any = unwrap(await player.diplomacy.proposals.query()), proposalId = list.items[0].id;
    unwrap(await gm.diplomacy.territory.modify({ id, expectedRevision: 1, action: { kind: "contest-claim", id: "restricted-claim" }, reason: "Another edit" }));
    const review = new DiplomacyApplicationController(gm.diplomacy); review.selectTab("proposals"); review.select(proposalId); unwrap(await review.load());
    const fields = { ...recognitionUiFields({ recognitionPosition: "positive" }), recognitionReview: "on" };
    assert.equal((await review.review("approve", "Needs refresh", fields)).ok, false); assert.equal(review.recognitionReviewFields.recognitionPosition, "positive"); assert.equal((unwrap(await gm.diplomacy.proposals.query({ id: proposalId })) as any).lifecycle, "pending");
    assert.equal((await review.review("approve", "Bad revision", { ...fields, targetRevision: "-1" })).ok, false);
    unwrap(await review.review("approve", "Accept current revision after review", { ...fields, targetRevision: "2" }));
    assert.equal((unwrap(await gm.diplomacy.territory.query({ id })) as any).revision, 3); assert.equal((unwrap(await gm.diplomacy.territory.query({ id })) as any).recognitions.length, 1);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 recognition runtime: GM edited secret claim cannot leak through public approved recognition or proposal after reload", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"); let proposalId = "", id = "";
  try { await gm.initialize(); id = await recognitionTerritory(gm);
    unwrap(await player.diplomacy.proposals.submit({ id: "recognition-secret-review", intent: { kind: "territory", mode: "modify", id, expectedRevision: 0, action: recognitionAction(), reason: "Visible request" } })); proposalId = "recognition-secret-review";
    const review = new DiplomacyApplicationController(gm.diplomacy); review.selectTab("proposals"); review.select(proposalId); unwrap(await review.load());
    unwrap(await review.review("approve", "Explicit revision", { ...recognitionUiFields({ recognitionClaimId: "secret-claim-marker", recognitionPosition: "negative", recognitionStarts: "10" }), recognitionReview: "on" }));
    const p: any = unwrap(await player.diplomacy.proposals.query({ id: proposalId })), t: any = unwrap(await player.diplomacy.territory.query({ id }));
    assert.equal(p.lifecycle, "approved"); assert.equal(p.decision.approvedIntent, null); assert.equal(JSON.stringify(p).includes("secret-claim-marker"), false); assert.equal(t.recognitions.length, 0);
    assert.equal((unwrap(await gm.diplomacy.proposals.query({ id: proposalId })) as any).decision.approvedIntent.action.value.claimId, "secret-claim-marker");
  } finally { player.destroy(); gm.destroy(); }
  const reload = f.make(), controller = f.make("player"); try { await reload.initialize(); const before = await f.adapter.loadAll(), p: any = unwrap(await controller.diplomacy.proposals.query({ id: proposalId })); assert.equal(p.decision.approvedIntent, null); assert.equal(JSON.stringify(p).includes("secret-claim-marker"), false); assert.equal((unwrap(await controller.diplomacy.territory.query({ id })) as any).recognitions.length, 0); assert.deepEqual(await f.adapter.loadAll(), before); }
  finally { controller.destroy(); reload.destroy(); }
});
test("G6 recognition runtime: controller permissions and fresh party/reference validation block direct or unsupported mutations", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const id = await recognitionTerritory(gm), before = await f.adapter.loadAll();
    assert.equal((await player.diplomacy.territory.modify({ id, expectedRevision: 0, action: recognitionAction(), reason: "Direct" })).ok, false);
    assert.equal((await stranger.diplomacy.proposals.submit({ id: "stranger-recognition", intent: { kind: "territory", mode: "modify", id, expectedRevision: 0, action: recognitionAction(), reason: "Request" } })).ok, false);
    for (const recognizingRef of [{ type: "domain", uuid: "JournalEntry.missing" }, { type: "actor", uuid: "Actor.missing" }, { type: "notable", id: "missing", domainUuid }]) {
      assert.equal((await gm.diplomacy.territory.modify({ id, expectedRevision: 0, action: recognitionAction("visible-claim", { recognizingRef }), reason: "Invalid party" })).ok, false);
    }
    assert.deepEqual(await f.adapter.loadAll(), before);
    unwrap(await player.diplomacy.proposals.submit({ id: "restricted-recognition", intent: { kind: "territory", mode: "modify", id, expectedRevision: 0, action: recognitionAction("restricted-claim"), reason: "Visible restricted claim" } }));
    assert.equal((unwrap(await player.diplomacy.proposals.query({ id: "restricted-recognition" })) as any).lifecycle, "pending");
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 recognition runtime: exact submit/approval ticket replay appends one declaration and reload keeps request and history", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"); let id = "", submit: any, approve: any;
  try { await gm.initialize(); id = await recognitionTerritory(gm); submit = unwrap(player.diplomacy.commands.prepare("diplomacy:submit-proposal", { id: "recognition-retry", intent: { kind: "territory", mode: "modify", id, expectedRevision: 0, action: recognitionAction(), reason: "One request" } }));
    unwrap(await player.diplomacy.commands.execute(submit)); unwrap(await player.diplomacy.commands.retry(submit));
    assert.equal((unwrap(await player.diplomacy.proposals.query()) as any).total, 1);
    approve = unwrap(gm.diplomacy.commands.prepare("diplomacy:decide-proposal", { id: "recognition-retry", expectedRevision: 0, decision: "approve", reason: "One decision" }));
    unwrap(await gm.diplomacy.commands.execute(approve)); unwrap(await gm.diplomacy.commands.retry(approve)); const t: any = unwrap(await gm.diplomacy.territory.query({ id })); assert.equal(t.recognitions.length, 1); assert.equal(t.events.length, 1); assert.equal(t.revision, 1);
  } finally { player.destroy(); gm.destroy(); }
  const reload = f.make(), original = f.make("player"); try { await reload.initialize(); const before = await f.adapter.loadAll(); unwrap(await original.diplomacy.commands.retry(submit)); unwrap(await reload.diplomacy.commands.retry(approve));
    assert.equal((unwrap(await reload.diplomacy.territory.query({ id })) as any).recognitions.length, 1); const p: any = unwrap(await original.diplomacy.proposals.query({ id: "recognition-retry" })); assert.equal(p.original.action.value.position, "positive"); assert.equal(p.lifecycle, "approved"); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { original.destroy(); reload.destroy(); }
});
test("G6 recognition runtime: unavailable fenced target disables approval but rejection touches only proposal owner", async () => {
  const { lockKey } = await import("../../src/mutations/lock-keys.js"); const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const id = await recognitionTerritory(gm);
    unwrap(await player.diplomacy.proposals.submit({ id: "recognition-reject-fence", intent: { kind: "territory", mode: "modify", id, expectedRevision: 0, action: recognitionAction(), reason: "Request" } }));
    const before: any = unwrap(await gm.diplomacy.territory.query({ id })); gm.recovery.fenceRegistry.installFence({ transactionId: "recognition-block", lockKeys: [lockKey.diplomacy("territory", id), lockKey.territoryGraph()], reason: "Needs recovery" });
    const ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("proposals"); ui.select("recognition-reject-fence"); unwrap(await ui.load()); assert.equal(ui.recognitionReviewTarget, null); assert.ok(ui.render().includes('disabled>Aprovar reconhecimento')); assert.ok(ui.render().includes('value="reject" formnovalidate'));
    assert.equal((await ui.review("approve", "Unavailable", { ...recognitionUiFields(), recognitionReview: "on" })).ok, false);
    unwrap(await ui.review("reject", "Rejected without changing target", { recognitionReview: "on", recognitionPosition: "bad" }));
    const p: any = unwrap(await gm.diplomacy.proposals.query({ id: "recognition-reject-fence" })); assert.equal(p.lifecycle, "rejected"); assert.equal(p.decision.approvedIntent, null);
    gm.recovery.fenceRegistry.removeFence("recognition-block"); assert.deepEqual(unwrap(await gm.diplomacy.territory.query({ id })), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 recognition runtime: locked submit checks fresh persisted claim visibility instead of prior public index", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const id = await recognitionTerritory(gm); assert.equal((unwrap(await player.diplomacy.territory.query({ id })) as any).claims.some((c: any) => c.id === "visible-claim"), true);
    const row: any = await f.adapter.read("territory", id); row.data.claims[0].visibility = "secret"; await f.adapter.write(row); const before = await f.adapter.loadAll();
    const result = await player.diplomacy.proposals.submit({ id: "recognition-after-visibility-edit", intent: { kind: "territory", mode: "modify", id, expectedRevision: 0, action: recognitionAction(), reason: "Formerly visible claim" } });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_RECOGNITION_UNAVAILABLE"); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 recognition runtime: approved projection refreshes persisted target privacy without canonical mutation", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const id = await recognitionTerritory(gm); unwrap(await player.diplomacy.proposals.submit({ id: "recognition-current-privacy", intent: { kind: "territory", mode: "modify", id, expectedRevision: 0, action: recognitionAction(), reason: "Visible request" } }));
    unwrap(await gm.diplomacy.proposals.decide({ id: "recognition-current-privacy", expectedRevision: 0, decision: "approve", reason: "Explicit approval" }));
    assert.ok((unwrap(await player.diplomacy.proposals.query({ id: "recognition-current-privacy" })) as any).decision.approvedIntent);
    const row: any = await f.adapter.read("territory", id); row.data.claims[0].visibility = "secret"; await f.adapter.write(row); const before = await f.adapter.loadAll();
    const p: any = unwrap(await player.diplomacy.proposals.query({ id: "recognition-current-privacy" })); assert.equal(p.lifecycle, "approved"); assert.equal(p.decision.approvedIntent, null); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});

async function linkTerritories(gm: ReturnType<typeof composeDomainManagerRuntime>) {
  const source = await recognitionTerritory(gm), ids: Record<string, string> = {};
  for (const visibility of ["public", "restricted", "secret"]) {
    const draft = createDiplomacyDraft("territory", `Destination ${visibility}`, [], visibility as any);
    unwrap(await gm.diplomacy.territory.create({ ...draft, reason: "Destination" })); ids[visibility] = draft.id;
  }
  return { source, ...ids };
}
function linkAction(targetTerritoryUuid: string, patch: any = {}) {
  return { kind: "link", value: { id: crypto.randomUUID(), sourceRef: { type: "manual", id: "test-link" }, visibility: "public", startsAtWorldTick: 0, expiresAtWorldTick: null,
    targetTerritoryUuid, linkType: "domain-manager:road", direction: "both", status: "operational", cost: null, capacity: null, dependencyRefs: [], ...patch } };
}
test("G6 links runtime: invisible and missing destination proposals have uniform rejection without writes", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await linkTerritories(gm), before = await f.adapter.loadAll(), errors: string[] = [];
    for (const target of [ids.secret, ids.restricted, "JournalEntry.missing"]) {
      const result = await player.diplomacy.proposals.submit({ id: crypto.randomUUID(), intent: { kind: "territory", mode: "modify", id: ids.source, expectedRevision: 0, action: linkAction(target), reason: "Guess destination" } });
      assert.equal(result.ok, false); if (!result.ok) errors.push(result.error.code);
    }
    assert.deepEqual(errors, Array(3).fill("DM_TERRITORY_LINK_UNAVAILABLE")); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 links runtime: Player cannot update secret link by guessing its ID", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await linkTerritories(gm); unwrap(await gm.diplomacy.territory.modify({ id: ids.source, expectedRevision: 0, action: linkAction(ids.public, { id: "hidden-link-marker", visibility: "secret" }), reason: "Private road" }));
    const before = await f.adapter.loadAll(), errors: string[] = [];
    for (const id of ["hidden-link-marker", "missing-link"]) {
      const result = await player.diplomacy.proposals.submit({ id: crypto.randomUUID(), intent: { kind: "territory", mode: "modify", id: ids.source, expectedRevision: 1, action: { kind: "update-link", id, status: "closed" }, reason: "Guess link" } });
      assert.equal(result.ok, false); if (!result.ok) errors.push(result.error.code);
    }
    assert.deepEqual(errors, ["DM_TERRITORY_LINK_UNAVAILABLE", "DM_TERRITORY_LINK_UNAVAILABLE"]); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 links runtime: GM revised private destination is hidden from approved Player proposal", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await linkTerritories(gm), intent = { kind: "territory", mode: "modify", id: ids.source, expectedRevision: 0, action: linkAction(ids.public), reason: "Road" };
    unwrap(await player.diplomacy.proposals.submit({ id: "link-private-review", intent }));
    unwrap(await gm.diplomacy.proposals.decide({ id: "link-private-review", expectedRevision: 0, decision: "approve", reason: "Private destination", editedIntent: { ...intent, action: linkAction(ids.secret) } }));
    const p: any = unwrap(await player.diplomacy.proposals.query({ id: "link-private-review" })); assert.equal(p.decision.approvedIntent, null); assert.equal(JSON.stringify(p).includes(ids.secret), false);
    assert.equal((unwrap(await player.diplomacy.territory.query({ id: ids.source })) as any).links.length, 0);
  } finally { player.destroy(); gm.destroy(); }
});
function linkUiFields(target: string, patch = {}) { return { linkTarget: target, linkType: "domain-manager:road", linkDirection: "both", linkStatus: "operational", linkVisibility: "public", linkStarts: "", linkExpires: "", linkCost: "", linkCapacity: "", linkDependencies: "", linkRevision: "0", reason: "Road", ...patch }; }
test("G6 links runtime: GM UI creates declarative link and audited status changes without reciprocal or economic effects", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await linkTerritories(gm), ui = new DiplomacyApplicationController(gm.diplomacy); ui.selectTab("territory"); ui.select(ids.source); unwrap(await ui.load());
    const destinationBefore: any = unwrap(await gm.diplomacy.territory.query({ id: ids.public })), ledgerBefore = await f.ledger.loadSnapshot();
    unwrap(await ui.submitLink(linkUiFields(ids.public, { linkDirection: "outbound", linkCost: "0", linkCapacity: "5", linkDependencies: JSON.stringify([{ type: "facility", id: "bridge" }]), linkStarts: "0", linkExpires: "20" })));
    unwrap(await ui.load()); const l = ui.detail.links[0]; assert.equal(l.direction, "outbound"); assert.equal(l.cost, 0); assert.equal(l.capacity, 5); assert.equal(l.startsAtWorldTick, 0); assert.equal(ui.detail.events.length, 1);
    for (const [i, status] of ["limited", "closed", "destroyed", "operational"].entries()) { unwrap(await ui.submitLink({ linkId: l.id, linkStatus: status, linkRevision: String(i + 1), reason: "Operational decision" }, true)); unwrap(await ui.load()); assert.equal(ui.detail.links[0].status, status); }
    assert.equal(ui.detail.revision, 5); assert.equal(ui.detail.events.length, 5); assert.deepEqual(unwrap(await gm.diplomacy.territory.query({ id: ids.public })), destinationBefore); assert.deepEqual(await f.ledger.loadSnapshot(), ledgerBefore);
    const before = await f.adapter.loadAll(); f.time.tick = 20; unwrap(await ui.load()); assert.ok(ui.render().includes("0 operacional · 0 limitada")); assert.ok(ui.render().includes("Expirada")); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});
test("G6 links runtime: Player GUI proposal and GM structured link/status reviews preserve original intent", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const ids = await linkTerritories(gm), ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("territory"); ui.select(ids.source); unwrap(await ui.load());
    assert.equal(ui.linkDestinations.some(d => d.id === ids.secret || d.id === ids.restricted || d.id === ids.source), false); assert.equal(ui.render().includes(ids.secret), false);
    unwrap(await ui.submitLink(linkUiFields(ids.public))); const p: any = unwrap(await player.diplomacy.proposals.query()), pid = p.items[0].id, original: any = unwrap(await player.diplomacy.proposals.query({ id: pid }));
    assert.equal((unwrap(await gm.diplomacy.territory.query({ id: ids.source })) as any).links.length, 0); assert.equal((await stranger.diplomacy.proposals.query({ id: pid })).ok, false);
    const review = new DiplomacyApplicationController(gm.diplomacy); review.selectTab("proposals"); review.select(pid); unwrap(await review.load()); assert.ok(review.render().includes("Revisar ligação territorial"));
    unwrap(await review.review("approve", "Reviewed road", { ...linkUiFields(ids.public, { linkCapacity: "3", linkStatus: "limited" }), linkReview: "on" })); const approved: any = unwrap(await player.diplomacy.proposals.query({ id: pid }));
    assert.deepEqual(approved.original, original.original); assert.equal(approved.decision.approvedIntent.action.value.id, original.original.action.value.id); assert.equal(approved.decision.approvedIntent.action.value.capacity, 3);
    unwrap(await ui.load()); const link = ui.detail.links[0]; unwrap(await ui.submitLink({ linkId: link.id, linkStatus: "closed", linkRevision: "1", reason: "Closure" }, true));
    const pending: any = unwrap(await player.diplomacy.proposals.query()); const sid = pending.items.find((x: any) => x.lifecycle === "pending").id; review.select(sid); unwrap(await review.load());
    unwrap(await review.review("approve", "GM closure", { linkReview: "on", linkStatus: "destroyed" })); unwrap(await ui.load()); assert.equal(ui.detail.links[0].status, "destroyed");
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 links runtime: fresh destination privacy blocks old selections and hides approved links after reload", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"); let source = "";
  try { await gm.initialize(); const ids = await linkTerritories(gm); source = ids.source;
    unwrap(await player.diplomacy.proposals.submit({ id: "link-privacy", intent: { kind: "territory", mode: "modify", id: source, expectedRevision: 0, action: linkAction(ids.public), reason: "Road" } })); unwrap(await gm.diplomacy.proposals.decide({ id: "link-privacy", expectedRevision: 0, decision: "approve", reason: "Accept" }));
    assert.equal((unwrap(await player.diplomacy.territory.query({ id: source })) as any).links.length, 1);
    const row: any = await f.adapter.read("territory", ids.public); row.data.territory.visibility = "secret"; await f.adapter.write(row); const before = await f.adapter.loadAll();
    const p: any = unwrap(await player.diplomacy.proposals.query({ id: "link-privacy" })); assert.equal(p.decision.approvedIntent, null); assert.equal((unwrap(await player.diplomacy.territory.query({ id: source })) as any).links.length, 0);
    const result = await player.diplomacy.proposals.submit({ id: "old-destination", intent: { kind: "territory", mode: "modify", id: source, expectedRevision: 1, action: linkAction(ids.public), reason: "Old selection" } }); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_LINK_UNAVAILABLE"); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
  const reload = f.make(), player2 = f.make("player"); try { await reload.initialize(); const before = await f.adapter.loadAll(); assert.equal((unwrap(await player2.diplomacy.proposals.query({ id: "link-privacy" })) as any).decision.approvedIntent, null); assert.equal((unwrap(await player2.diplomacy.territory.query({ id: source })) as any).links.length, 0); assert.deepEqual(await f.adapter.loadAll(), before); }
  finally { player2.destroy(); reload.destroy(); }
});
test("G6 links runtime: destination fence blocks create/status approval and rejection only closes proposal", async () => {
  const { lockKey } = await import("../../src/mutations/lock-keys.js"); const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await linkTerritories(gm), action = linkAction(ids.public);
    unwrap(await player.diplomacy.proposals.submit({ id: "link-fence", intent: { kind: "territory", mode: "modify", id: ids.source, expectedRevision: 0, action, reason: "Road" } })); const before = await f.adapter.read("territory", ids.source);
    gm.recovery.fenceRegistry.installFence({ transactionId: "dest-fence", lockKeys: [lockKey.diplomacy("territory", ids.public)], reason: "Needs recovery" });
    assert.equal((await gm.diplomacy.proposals.decide({ id: "link-fence", expectedRevision: 0, decision: "approve", reason: "Blocked" })).ok, false);
    assert.equal((await gm.diplomacy.territory.modify({ id: ids.source, expectedRevision: 0, action, reason: "Blocked" })).ok, false);
    unwrap(await gm.diplomacy.proposals.decide({ id: "link-fence", expectedRevision: 0, decision: "reject", reason: "Unavailable route" })); assert.deepEqual(await f.adapter.read("territory", ids.source), before);
    gm.recovery.fenceRegistry.removeFence("dest-fence"); unwrap(await gm.diplomacy.territory.modify({ id: ids.source, expectedRevision: 0, action, reason: "Create" }));
    unwrap(await player.diplomacy.proposals.submit({ id: "status-fence", intent: { kind: "territory", mode: "modify", id: ids.source, expectedRevision: 1, action: { kind: "update-link", id: action.value.id, status: "closed" }, reason: "Closure" } }));
    gm.recovery.fenceRegistry.installFence({ transactionId: "dest-fence", lockKeys: [lockKey.diplomacy("territory", ids.public)], reason: "Needs recovery" }); assert.equal((unwrap(await player.diplomacy.territory.query({ id: ids.source })) as any).links.length, 0);
    assert.equal((await gm.diplomacy.proposals.decide({ id: "status-fence", expectedRevision: 0, decision: "approve", reason: "Blocked" })).ok, false); unwrap(await gm.diplomacy.proposals.decide({ id: "status-fence", expectedRevision: 0, decision: "reject", reason: "Reject" }));
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 links runtime: stale draft and stale approval require explicit revision after review", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await linkTerritories(gm), ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("territory"); ui.select(ids.source); unwrap(await ui.load());
    unwrap(await gm.diplomacy.territory.modify({ id: ids.source, expectedRevision: 0, action: { kind: "contest-claim", id: "visible-claim" }, reason: "Concurrent" }));
    assert.equal((await ui.submitLink(linkUiFields(ids.public))).ok, false); unwrap(await ui.load()); assert.equal(ui.territoryLinkFields.linkRevision, "0"); assert.equal((await ui.submitLink(linkUiFields(ids.public))).ok, false); ui.resetLinkDrafts(); unwrap(await ui.submitLink(linkUiFields(ids.public, { linkRevision: "1" })));
    const p: any = unwrap(await player.diplomacy.proposals.query()), pid = p.items[0].id; unwrap(await gm.diplomacy.territory.modify({ id: ids.source, expectedRevision: 1, action: { kind: "contest-claim", id: "restricted-claim" }, reason: "Another" }));
    const review = new DiplomacyApplicationController(gm.diplomacy); review.selectTab("proposals"); review.select(pid); unwrap(await review.load()); const fields = { ...linkUiFields(ids.public, { linkStatus: "limited" }), linkReview: "on" };
    assert.equal((await review.review("approve", "Stale", fields)).ok, false); assert.equal(review.linkReviewFields.linkStatus, "limited"); unwrap(await review.review("approve", "After reviewing current state", { ...fields, targetRevision: "2" })); assert.equal((unwrap(await gm.diplomacy.territory.query({ id: ids.source })) as any).revision, 3);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 links runtime: exact link and status ticket retries stay once after reload", async () => {
  const f = fixture(), gm = f.make(); let source = "", create: any, status: any;
  try { await gm.initialize(); const ids = await linkTerritories(gm); source = ids.source; const action = linkAction(ids.public);
    create = unwrap(gm.diplomacy.commands.prepare("territory:modify", { id: source, expectedRevision: 0, action, reason: "Create once" })); unwrap(await gm.diplomacy.commands.execute(create)); unwrap(await gm.diplomacy.commands.retry(create));
    status = unwrap(gm.diplomacy.commands.prepare("territory:modify", { id: source, expectedRevision: 1, action: { kind: "update-link", id: action.value.id, status: "limited" }, reason: "Update once" })); unwrap(await gm.diplomacy.commands.execute(status)); unwrap(await gm.diplomacy.commands.retry(status));
    const d: any = unwrap(await gm.diplomacy.territory.query({ id: source })); assert.equal(d.links.length, 1); assert.equal(d.events.length, 2); assert.equal(d.revision, 2);
  } finally { gm.destroy(); }
  const reload = f.make(); try { await reload.initialize(); const before = await f.adapter.loadAll(); unwrap(await reload.diplomacy.commands.retry(create)); unwrap(await reload.diplomacy.commands.retry(status)); const d: any = unwrap(await reload.diplomacy.territory.query({ id: source })); assert.equal(d.links[0].status, "limited"); assert.equal(d.events.length, 2); assert.deepEqual(await f.adapter.loadAll(), before); } finally { reload.destroy(); }
});
test("G6 links runtime: paged visible destinations pin selection outside current page without loading all details", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await linkTerritories(gm);
    for (let i = 0; i < 32; i++) { const d = createDiplomacyDraft("territory", `Public destination ${i}`, [], "public"); unwrap(await gm.diplomacy.territory.create({ ...d, reason: "Destination" })); }
    const ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("territory"); ui.select(ids.source); unwrap(await ui.load()); assert.equal(ui.linkDestinationPage.items.length, 30); assert.equal(ui.linkDestinationPage.total, 34);
    ui.territoryLinkFields = linkUiFields(ids.public); ui.linkDestinationOffset = 30; unwrap(await ui.load()); assert.equal(ui.linkDestinationPage.items.length, 4); assert.ok(ui.linkDestinations.some(d => d.id === ids.public)); assert.equal(ui.territoryLinkFields.linkTarget, ids.public);
    ui.applyDestinationSearch("Public destination 31"); unwrap(await ui.load()); assert.equal(ui.linkDestinationPage.total, 1); assert.equal(ui.linkDestinationOffset, 0); assert.equal(ui.linkDestinations.length, 2); assert.equal(ui.render().includes(ids.secret), false);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 links runtime: controller-visible restricted destinations and secret requests stay private after approval", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const ids = await linkTerritories(gm), d = createDiplomacyDraft("territory", "Controlled restricted destination", [], "restricted"), state: any = d.data;
    state.claims = [{ id: "destination-claim", sourceRef: { type: "manual", id: "gm" }, visibility: "restricted", startsAtWorldTick: 0, expiresAtWorldTick: null, claimantRef: { type: "domain", uuid: domainUuid }, claimType: "domain-manager:ownership", lifecycle: "active", contested: false, strength: null, inherited: false }];
    unwrap(await gm.diplomacy.territory.create({ ...d, data: state, reason: "Controlled destination" }));
    const ui = new DiplomacyApplicationController(player.diplomacy); ui.selectTab("territory"); ui.select(ids.source); unwrap(await ui.load()); assert.ok(ui.linkDestinations.some(x => x.id === d.id));
    unwrap(await ui.submitLink(linkUiFields(d.id, { linkVisibility: "secret" }))); const proposals: any = unwrap(await player.diplomacy.proposals.query()), pid = proposals.items[0].id;
    unwrap(await gm.diplomacy.proposals.decide({ id: pid, expectedRevision: 0, decision: "approve", reason: "GM private road" }));
    const p: any = unwrap(await player.diplomacy.proposals.query({ id: pid })); assert.equal(p.decision.approvedIntent, null); assert.equal(p.original.action.value.targetTerritoryUuid, d.id);
    assert.equal((unwrap(await player.diplomacy.territory.query({ id: ids.source })) as any).links.length, 0); assert.equal((await stranger.diplomacy.territory.query({ id: d.id })).ok, false);
    const before = await f.adapter.loadAll(); for (const target of [ids.source, "JournalEntry.missing"]) assert.equal((await gm.diplomacy.territory.modify({ id: ids.source, expectedRevision: 1, action: linkAction(target), reason: "Invalid destination" })).ok, false); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 links runtime: create-intent hidden destinations and fresh persisted secret links are rejected without writes", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await linkTerritories(gm), d = createDiplomacyDraft("territory", "Proposed region", [], "public"), state: any = d.data;
    const source: any = unwrap(await gm.diplomacy.territory.query({ id: ids.source })); state.claims = structuredClone(source.claims); state.links = [linkAction(ids.secret).value];
    const before = await f.adapter.loadAll(), proposal = await player.diplomacy.proposals.submit({ id: "hidden-create-link", intent: { kind: "territory", mode: "create", id: d.id, data: state, reason: "Guess hidden target" } });
    assert.equal(proposal.ok, false); if (!proposal.ok) assert.equal(proposal.error.code, "DM_TERRITORY_LINK_UNAVAILABLE"); assert.deepEqual(await f.adapter.loadAll(), before);
    const action = linkAction(ids.public); unwrap(await gm.diplomacy.territory.modify({ id: ids.source, expectedRevision: 0, action, reason: "Public link" }));
    const row: any = await f.adapter.read("territory", ids.source); row.data.links[0].visibility = "secret"; await f.adapter.write(row); const privateBefore = await f.adapter.loadAll();
    const result = await player.diplomacy.proposals.submit({ id: "formerly-public-link", intent: { kind: "territory", mode: "modify", id: ids.source, expectedRevision: 1, action: { kind: "update-link", id: action.value.id, status: "closed" }, reason: "Former selection" } });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_LINK_UNAVAILABLE"); assert.deepEqual(await f.adapter.loadAll(), privateBefore);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 links runtime: guessed fenced destination uses the same unavailable error as invisible and missing targets", async () => {
  const { lockKey } = await import("../../src/mutations/lock-keys.js"); const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await linkTerritories(gm); gm.recovery.fenceRegistry.installFence({ transactionId: "private-destination-fence", lockKeys: [lockKey.diplomacy("territory", ids.secret), lockKey.diplomacy("territory", ids.public)], reason: "Private recovery reason" });
    const before = await f.adapter.loadAll(), errors: any[] = [];
    for (const target of [ids.secret, ids.public, "JournalEntry.missing"]) { const result = await player.diplomacy.proposals.submit({ id: crypto.randomUUID(), intent: { kind: "territory", mode: "modify", id: ids.source, expectedRevision: 0, action: linkAction(target), reason: "Unavailable selection" } }); assert.equal(result.ok, false); if (!result.ok) errors.push(result.error); }
    assert.equal(errors.length, 3); assert.ok(errors.every(e => e.code === "DM_TERRITORY_LINK_UNAVAILABLE")); assert.deepEqual(errors[0], errors[1]); assert.deepEqual(errors[1], errors[2]); assert.equal(JSON.stringify(errors).includes("Private recovery reason"), false); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});

import { influenceFields as territoryInfluenceFields, modifierFields as territoryModifierFields } from '../../src/ui/domain-patterns/diplomacy/territory-influence-form.js';
function influenceUiFields(patch:any={}) { return {...territoryInfluenceFields(),influencePartyRef:domainUuid,axis_0_base:'20',reason:'Influence',influenceRevision:'0',...patch}; }
test('G6 influence runtime: GUI creates axes, modifies separately and ends without ownership side effects',async()=>{
 const f=fixture(),gm=f.make();try{await gm.initialize();const id=await recognitionTerritory(gm),ui=new DiplomacyApplicationController(gm.diplomacy);ui.selectTab('territory');ui.select(id);unwrap(await ui.load());unwrap(await ui.submitInfluence(influenceUiFields(),'influence'));unwrap(await ui.load());const inf=ui.detail.influence[0];assert.equal(ui.detail.effectiveInfluence[0].value,20);
 unwrap(await ui.submitInfluence({...territoryModifierFields(),influenceId:inf.id,modifier_axis:inf.axes[0].axisId,modifier_delta:'-7',influenceRevision:'1',reason:'Modifier'},'add-influence-modifier'));unwrap(await ui.load());assert.equal(ui.detail.effectiveInfluence[0].value,13);assert.equal(ui.detail.influence[0].axes[0].base,20);
 unwrap(await ui.submitInfluence({influenceId:inf.id,modifierId:ui.detail.influence[0].modifiers[0].id,influenceRevision:'2',reason:'End'},'end-influence-modifier'));unwrap(await ui.load());assert.equal(ui.detail.effectiveInfluence[0].value,20);assert.equal(ui.detail.events.length,3);assert.equal(ui.detail.claims.length,3);
 unwrap(await ui.submitInfluence({influenceId:inf.id,influenceRevision:'3',reason:'End source'},'end-influence'));unwrap(await ui.load());assert.equal(ui.detail.effectiveInfluence.length,0);assert.equal(ui.detail.influence[0].modifiers.length,1);
 }finally{gm.destroy();}
});
test('G6 influence runtime: Player proposal approval preserves source, and stranger cannot read request',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player'),stranger=f.make('stranger');try{await gm.initialize();const id=await recognitionTerritory(gm),ui=new DiplomacyApplicationController(player.diplomacy);ui.selectTab('territory');ui.select(id);unwrap(await ui.load());unwrap(await ui.submitInfluence(influenceUiFields(),'influence'));assert.equal((unwrap(await gm.diplomacy.territory.query({id})) as any).influence.length,0);
 const pid=(unwrap(await player.diplomacy.proposals.query()) as any).items[0].id;assert.equal((await stranger.diplomacy.proposals.query({id:pid})).ok,false);unwrap(await gm.diplomacy.proposals.decide({id:pid,expectedRevision:0,decision:'approve',reason:'Approved'}));unwrap(await ui.load());assert.equal(ui.detail.influence.length,1);assert.equal(ui.detail.influence[0].axes[0].base,20);
 }finally{stranger.destroy();player.destroy();gm.destroy();}
});
test('G6 influence runtime: secret source and modifier IDs reject uniformly without writes',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await recognitionTerritory(gm),ui=new DiplomacyApplicationController(gm.diplomacy);ui.selectTab('territory');ui.select(id);unwrap(await ui.load());unwrap(await ui.submitInfluence(influenceUiFields({influenceVisibility:'secret'}),'influence'));unwrap(await ui.load());const secret=ui.detail.influence[0].id;
 for(const target of [secret,'missing']){const before=await f.adapter.loadAll();assert.equal((await player.diplomacy.proposals.submit({id:crypto.randomUUID(),intent:{kind:'territory',mode:'modify',id,expectedRevision:1,action:{kind:'end-influence',id:target},reason:'Guess'}})).ok,false);assert.deepEqual(await f.adapter.loadAll(),before);}
 unwrap(await ui.submitInfluence(influenceUiFields({influenceRevision:'1'}),'influence'));unwrap(await ui.load());const visible=ui.detail.influence.find((i:any)=>i.visibility==='public');unwrap(await ui.submitInfluence({...territoryModifierFields(),influenceId:visible.id,modifier_axis:visible.axes[0].axisId,modifier_delta:'80',modifier_visibility:'secret',influenceRevision:'2',reason:'Private'},'add-influence-modifier'));unwrap(await ui.load());const d:any=unwrap(await player.diplomacy.territory.query({id}));assert.equal(d.influence.length,1);assert.equal(d.influence[0].modifiers.length,0);assert.equal(d.effectiveInfluence[0].value,20);
 const before=await f.adapter.loadAll();for(const mid of [visible.id,ui.detail.influence.find((i:any)=>i.id===visible.id).modifiers[0].id,'missing'])assert.equal((await player.diplomacy.proposals.submit({id:crypto.randomUUID(),intent:{kind:'territory',mode:'modify',id,expectedRevision:3,action:{kind:'end-influence-modifier',id:visible.id,modifierId:mid},reason:'Guess modifier'}})).ok,false);assert.deepEqual(await f.adapter.loadAll(),before);
 }finally{player.destroy();gm.destroy();}
});
test('G6 influence runtime: exact ticket retry and reload preserve single event',async()=>{
 const f=fixture(),gm=f.make();let id='',ticket:any;try{await gm.initialize();id=await recognitionTerritory(gm);ticket=unwrap(gm.diplomacy.commands.prepare('territory:modify',{id,expectedRevision:0,reason:'Once',action:{kind:'influence',value:{id:'once',sourceRef:{type:'manual',id:'test'},visibility:'public',startsAtWorldTick:0,expiresAtWorldTick:null,partyRef:{type:'domain',uuid:domainUuid},active:true,axes:[{axisId:'domain-manager:trade',base:20,minimum:-100,maximum:100,decay:null}],modifiers:[]}}}));unwrap(await gm.diplomacy.commands.execute(ticket));unwrap(await gm.diplomacy.commands.retry(ticket));}finally{gm.destroy();}
 const reload=f.make();try{await reload.initialize();const before=await f.adapter.loadAll();unwrap(await reload.diplomacy.commands.retry(ticket));const d:any=unwrap(await reload.diplomacy.territory.query({id}));assert.equal(d.influence.length,1);assert.equal(d.events.length,1);assert.deepEqual(await f.adapter.loadAll(),before);}finally{reload.destroy();}
});
test('G6 influence runtime: GM private edit redacts approved intent and fresh privacy change blocks guesses',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await recognitionTerritory(gm),ui=new DiplomacyApplicationController(player.diplomacy);ui.selectTab('territory');ui.select(id);unwrap(await ui.load());unwrap(await ui.submitInfluence(influenceUiFields(),'influence'));const pid=(unwrap(await player.diplomacy.proposals.query()) as any).items[0].id;const proposal:any=unwrap(await gm.diplomacy.proposals.query({id:pid}));
 unwrap(await gm.diplomacy.proposals.decide({id:pid,expectedRevision:0,decision:'approve',reason:'Private',editedIntent:{...proposal.original,action:{...proposal.original.action,value:{...proposal.original.action.value,visibility:'secret'}}}}));assert.equal((unwrap(await player.diplomacy.proposals.query({id:pid})) as any).decision.approvedIntent,null);
 const row:any=await f.adapter.read('territory',id);row.data.influence[0].visibility='public';await f.adapter.write(row);unwrap(await player.diplomacy.territory.query({id}));row.data.influence[0].visibility='secret';await f.adapter.write(row);const before=await f.adapter.loadAll();assert.equal((await player.diplomacy.proposals.submit({id:'old-index-influence',intent:{kind:'territory',mode:'modify',id,expectedRevision:1,action:{kind:'end-influence',id:row.data.influence[0].id},reason:'Old index'}})).ok,false);assert.deepEqual(await f.adapter.loadAll(),before);
 }finally{player.destroy();gm.destroy();}
});

async function occupationTerritory(gm: ReturnType<typeof composeDomainManagerRuntime>) {
  const draft = createDiplomacyDraft('territory','Occupation region',[],'public'), data:any=draft.data;
  const source = (id:string,visibility='public') => ({id,sourceRef:{type:'manual',id:'gm'},visibility,startsAtWorldTick:0,expiresAtWorldTick:null});
  data.claims=['ownership','control','secret-control'].map(id=>({...source(id,id.startsWith('secret')?'secret':'public'),claimantRef:{type:'domain',uuid:domainUuid},claimType:id==='ownership'?'domain-manager:ownership':'domain-manager:control',lifecycle:'active',contested:false,strength:null,inherited:false}));
  data.presence=['presence','secret-presence'].map(id=>({...source(id,id.startsWith('secret')?'secret':'public'),partyRef:{type:'domain',uuid:domainUuid},presenceType:'domain-manager:military',amount:1,active:true}));
  unwrap(await gm.diplomacy.territory.create({...draft,data,reason:'Occupation references'}));return draft.id;
}
function occupationAction(patch:any={}) {return {kind:'occupation',value:{id:crypto.randomUUID(),sourceRef:{type:'manual',id:'test-occupation'},visibility:'public',startsAtWorldTick:0,expiresAtWorldTick:null,occupierRef:{type:'domain',uuid:domainUuid},lifecycle:'established',presenceIds:['presence'],controlClaimIds:['control'],...patch}};}
test('G6 occupation privacy: invisible references rejected uniformly without proposal writes',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await occupationTerritory(gm),before=await f.adapter.loadAll(),errors:string[]=[];
 for(const patch of [{presenceIds:['secret-presence']},{presenceIds:['missing']},{controlClaimIds:['secret-control']},{controlClaimIds:['missing']}]){const r=await player.diplomacy.proposals.submit({id:crypto.randomUUID(),intent:{kind:'territory',mode:'modify',id,expectedRevision:0,reason:'Guess ref',action:occupationAction(patch)}});assert.equal(r.ok,false);if(!r.ok)errors.push(r.error.code);}
 assert.equal(new Set(errors).size,1);assert.deepEqual(await f.adapter.loadAll(),before);
 }finally{player.destroy();gm.destroy();}
});
test('G6 occupation privacy: hidden occupation IDs cannot be ended by Player',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await occupationTerritory(gm);unwrap(await gm.diplomacy.territory.modify({id,expectedRevision:0,reason:'Private',action:occupationAction({id:'secret-occupation',visibility:'secret'})}));const before=await f.adapter.loadAll(),errors:string[]=[];
 for(const target of ['secret-occupation','missing']){const r=await player.diplomacy.proposals.submit({id:crypto.randomUUID(),intent:{kind:'territory',mode:'modify',id,expectedRevision:1,action:{kind:'end-occupation',id:target},reason:'Guess'}});assert.equal(r.ok,false);if(!r.ok)errors.push(r.error.code);}assert.equal(new Set(errors).size,1);assert.deepEqual(await f.adapter.loadAll(),before);
 }finally{player.destroy();gm.destroy();}
});
test('G6 occupation privacy: GM edit to private reference hides approved intent',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await occupationTerritory(gm),intent={kind:'territory',mode:'modify',id,expectedRevision:0,reason:'Occupation',action:occupationAction()};unwrap(await player.diplomacy.proposals.submit({id:'occupation-private-edit',intent}));
 unwrap(await gm.diplomacy.proposals.decide({id:'occupation-private-edit',expectedRevision:0,decision:'approve',reason:'Private reference',editedIntent:{...intent,action:occupationAction({...intent.action.value,controlClaimIds:['secret-control']})}}));const p:any=unwrap(await player.diplomacy.proposals.query({id:'occupation-private-edit'}));assert.equal(p.decision.approvedIntent,null);assert.equal(JSON.stringify(p).includes('secret-control'),false);
 }finally{player.destroy();gm.destroy();}
});
import { occupationFields as territoryOccupationFields } from '../../src/ui/domain-patterns/diplomacy/territory-occupation-form.js';
const occupationUiFields=(patch:any={})=>({...territoryOccupationFields(),occupationPartyRef:domainUuid,occupationPresenceIds:'["presence"]',occupationControlIds:'["control"]',occupationRevision:'0',reason:'Occupation',...patch});
test('G6 occupation runtime: GM UI records five states, expiry is read-only and ownership unchanged',async()=>{
 const f=fixture(),gm=f.make();try{await gm.initialize();const id=await occupationTerritory(gm),ui=new DiplomacyApplicationController(gm.diplomacy);ui.selectTab('territory');ui.select(id);unwrap(await ui.load());const claims=structuredClone(ui.detail.claims),presence=structuredClone(ui.detail.presence);
 for(const state of ['established','contested','stable','withdrawing','ended']){unwrap(await ui.submitOccupation(occupationUiFields({occupationLifecycle:state,occupationRevision:String(ui.detail.revision),occupationStarts:'0',occupationExpires:'11'})));unwrap(await ui.load());}
 assert.equal(ui.detail.occupations.length,5);assert.equal(ui.detail.events.length,5);assert.deepEqual(ui.detail.claims,claims);assert.deepEqual(ui.detail.presence,presence);assert.ok(ui.render().includes('5 registros visíveis; 4 não encerrados'));const before=await f.adapter.loadAll();f.time.tick=11;unwrap(await ui.load());assert.ok(ui.render().includes('5 registros visíveis; 0 não encerrados'));assert.equal(ui.detail.occupations[0].lifecycle,'established');assert.deepEqual(await f.adapter.loadAll(),before);
 }finally{gm.destroy();}
});
test('G6 occupation runtime: Player proposal and structured GM edits preserve original and source identity',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player'),stranger=f.make('stranger');try{await gm.initialize();const id=await occupationTerritory(gm),ui=new DiplomacyApplicationController(player.diplomacy);ui.selectTab('territory');ui.select(id);unwrap(await ui.load());assert.equal(ui.render().includes('secret-control'),false);unwrap(await ui.submitOccupation(occupationUiFields()));const pid=(unwrap(await player.diplomacy.proposals.query()) as any).items[0].id,request:any=unwrap(await player.diplomacy.proposals.query({id:pid}));assert.equal((await stranger.diplomacy.proposals.query({id:pid})).ok,false);assert.equal((unwrap(await gm.diplomacy.territory.query({id})) as any).occupations.length,0);
 const review=new DiplomacyApplicationController(gm.diplomacy);review.selectTab('proposals');review.select(pid);unwrap(await review.load());assert.ok(review.render().includes('Revisar ocupação territorial'));unwrap(await review.review('approve','Revised',{...occupationUiFields({occupationLifecycle:'withdrawing',occupationPartyType:'narrative',occupationPartyRef:'Council',occupationControlIds:'[]',occupationStarts:'0',occupationExpires:'50'}),occupationReview:'on'}));const approved:any=unwrap(await player.diplomacy.proposals.query({id:pid}));assert.deepEqual(approved.original,request.original);assert.equal(approved.decision.approvedIntent.action.value.id,request.original.action.value.id);assert.equal(approved.decision.approvedIntent.action.value.lifecycle,'withdrawing');unwrap(await ui.load());assert.equal(ui.detail.occupations[0].occupierRef.id,'Council');assert.equal(ui.detail.claims[0].lifecycle,'active');
 }finally{stranger.destroy();player.destroy();gm.destroy();}
});
test('G6 occupation runtime: Player ending approved by GM preserves dependencies and repeat ending is no-op',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await occupationTerritory(gm);unwrap(await gm.diplomacy.territory.modify({id,expectedRevision:0,reason:'Create',action:occupationAction({id:'occupied'})}));const ui=new DiplomacyApplicationController(player.diplomacy);ui.selectTab('territory');ui.select(id);unwrap(await ui.load());const claims=structuredClone(ui.detail.claims),presence=structuredClone(ui.detail.presence);unwrap(await ui.submitOccupation({occupationId:'occupied',occupationRevision:'1',reason:'End'},true));const pid=(unwrap(await player.diplomacy.proposals.query()) as any).items[0].id,review=new DiplomacyApplicationController(gm.diplomacy);review.selectTab('proposals');review.select(pid);unwrap(await review.load());unwrap(await review.review('approve','GM ended',{occupationReview:'on',occupationId:'secret-occupation'}));unwrap(await ui.load());assert.equal(ui.detail.occupations[0].lifecycle,'ended');assert.deepEqual(ui.detail.occupations[0].presenceIds,['presence']);assert.deepEqual(ui.detail.claims,claims);assert.deepEqual(ui.detail.presence,presence);
 unwrap(await gm.diplomacy.territory.modify({id,expectedRevision:2,action:{kind:'end-occupation',id:'occupied'},reason:'Repeated end'}));const d:any=unwrap(await gm.diplomacy.territory.query({id}));assert.equal(d.revision,2);assert.equal(d.events.length,2);
 }finally{player.destroy();gm.destroy();}
});
test('G6 occupation runtime: historical dependencies stay linked without reactivating them',async()=>{
 const f=fixture(),gm=f.make();try{await gm.initialize();const id=await occupationTerritory(gm);unwrap(await gm.diplomacy.territory.modify({id,expectedRevision:0,reason:'End presence',action:{kind:'end-presence',id:'presence'}}));unwrap(await gm.diplomacy.territory.modify({id,expectedRevision:1,reason:'End control',action:{kind:'end-claim',id:'control'}}));const ui=new DiplomacyApplicationController(gm.diplomacy);ui.selectTab('territory');ui.select(id);unwrap(await ui.load());unwrap(await ui.submitOccupation(occupationUiFields({occupationRevision:'2'})));unwrap(await ui.load());assert.equal(ui.detail.presence[0].active,false);assert.equal(ui.detail.claims.find((c:any)=>c.id==='control').lifecycle,'ended');assert.equal(ui.detail.occupations[0].lifecycle,'established');
 }finally{gm.destroy();}
});
test('G6 occupation runtime: reference privacy is checked against persisted state despite old index',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await occupationTerritory(gm);unwrap(await player.diplomacy.territory.query({id}));const row:any=await f.adapter.read('territory',id);row.data.presence[0].visibility='secret';await f.adapter.write(row);const before=await f.adapter.loadAll();assert.equal((await player.diplomacy.proposals.submit({id:'occupation-old-index',intent:{kind:'territory',mode:'modify',id,expectedRevision:0,reason:'Old selection',action:occupationAction()}})).ok,false);assert.deepEqual(await f.adapter.loadAll(),before);
 }finally{player.destroy();gm.destroy();}
});
test('G6 occupation runtime: fresh privacy changes hide approved creation and ending intents',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await occupationTerritory(gm);unwrap(await player.diplomacy.proposals.submit({id:'occupation-public-create',intent:{kind:'territory',mode:'modify',id,expectedRevision:0,reason:'Create',action:occupationAction({id:'created'})}}));unwrap(await gm.diplomacy.proposals.decide({id:'occupation-public-create',expectedRevision:0,decision:'approve',reason:'Approved'}));unwrap(await player.diplomacy.proposals.submit({id:'occupation-public-end',intent:{kind:'territory',mode:'modify',id,expectedRevision:1,reason:'End',action:{kind:'end-occupation',id:'created'}}}));unwrap(await gm.diplomacy.proposals.decide({id:'occupation-public-end',expectedRevision:0,decision:'approve',reason:'Approved'}));
 const row:any=await f.adapter.read('territory',id);row.data.occupations[0].visibility='secret';await f.adapter.write(row);const before=await f.adapter.loadAll();for(const pid of ['occupation-public-create','occupation-public-end'])assert.equal((unwrap(await player.diplomacy.proposals.query({id:pid})) as any).decision.approvedIntent,null);assert.deepEqual(await f.adapter.loadAll(),before);
 }finally{player.destroy();gm.destroy();}
});
test('G6 occupation runtime: stale source draft and approval require explicit revision review',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await occupationTerritory(gm),ui=new DiplomacyApplicationController(player.diplomacy);ui.selectTab('territory');ui.select(id);unwrap(await ui.load());unwrap(await gm.diplomacy.territory.modify({id,expectedRevision:0,reason:'Concurrent',action:{kind:'contest-claim',id:'ownership'}}));assert.equal((await ui.submitOccupation(occupationUiFields())).ok,false);unwrap(await ui.load());assert.equal(ui.occupationDraft.occupationRevision,'0');assert.equal((await ui.submitOccupation(occupationUiFields())).ok,false);ui.resetOccupationDrafts();unwrap(await ui.submitOccupation(occupationUiFields({occupationRevision:'1'})));const pid=(unwrap(await player.diplomacy.proposals.query()) as any).items[0].id;unwrap(await gm.diplomacy.territory.modify({id,expectedRevision:1,reason:'Another concurrent',action:{kind:'contest-claim',id:'control'}}));const review=new DiplomacyApplicationController(gm.diplomacy);review.selectTab('proposals');review.select(pid);unwrap(await review.load());const fields={...occupationUiFields({occupationLifecycle:'contested'}),occupationReview:'on'};assert.equal((await review.review('approve','Stale',fields)).ok,false);assert.equal(review.occupationReviewFields.occupationLifecycle,'contested');unwrap(await review.review('approve','Reviewed',{...fields,targetRevision:'2'}));assert.equal((unwrap(await gm.diplomacy.territory.query({id})) as any).revision,3);
 }finally{player.destroy();gm.destroy();}
});
test('G6 occupation runtime: exact create/end ticket retries remain once after reload',async()=>{
 const f=fixture(),gm=f.make();let id='',create:any,end:any;try{await gm.initialize();id=await occupationTerritory(gm);create=unwrap(gm.diplomacy.commands.prepare('territory:modify',{id,expectedRevision:0,reason:'Once',action:occupationAction({id:'once'})}));unwrap(await gm.diplomacy.commands.execute(create));unwrap(await gm.diplomacy.commands.retry(create));end=unwrap(gm.diplomacy.commands.prepare('territory:modify',{id,expectedRevision:1,reason:'End once',action:{kind:'end-occupation',id:'once'}}));unwrap(await gm.diplomacy.commands.execute(end));unwrap(await gm.diplomacy.commands.retry(end));}finally{gm.destroy();}
 const reload=f.make();try{await reload.initialize();const before=await f.adapter.loadAll();unwrap(await reload.diplomacy.commands.retry(create));unwrap(await reload.diplomacy.commands.retry(end));const d:any=unwrap(await reload.diplomacy.territory.query({id}));assert.equal(d.occupations.length,1);assert.equal(d.occupations[0].lifecycle,'ended');assert.equal(d.events.length,2);assert.equal(d.revision,2);assert.deepEqual(await f.adapter.loadAll(),before);}finally{reload.destroy();}
});
test('G6 occupation runtime: fenced territory blocks approval, rejection only writes proposal',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await occupationTerritory(gm);unwrap(await player.diplomacy.proposals.submit({id:'occupation-fence',intent:{kind:'territory',mode:'modify',id,expectedRevision:0,reason:'Create',action:occupationAction()}}));const {lockKey}=await import('../../src/mutations/lock-keys.js');gm.recovery.fenceRegistry.installFence({transactionId:'occupation-fenced',lockKeys:[lockKey.diplomacy('territory',id)],reason:'Needs recovery'});
 const review=new DiplomacyApplicationController(gm.diplomacy);review.selectTab('proposals');review.select('occupation-fence');unwrap(await review.load());assert.equal(review.occupationReviewTarget,null);assert.equal((await review.review('approve','Blocked',{occupationReview:'on'})).ok,false);unwrap(await review.review('reject','Rejected',{occupationReview:'on'}));assert.equal((unwrap(await gm.diplomacy.proposals.query({id:'occupation-fence'})) as any).lifecycle,'rejected');const row:any=await f.adapter.read('territory',id);assert.equal(row.revision,0);
 }finally{player.destroy();gm.destroy();}
});
test('G6 occupation runtime: create intents validate inline references and private new declarations stay private',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await occupationTerritory(gm),current:any=unwrap(await gm.diplomacy.territory.query({id})),draft=createDiplomacyDraft('territory','Inline',[],'public'),data:any=draft.data;data.claims=current.claims;data.presence=current.presence;data.occupations=[occupationAction({id:'inline-private-ref',controlClaimIds:['secret-control']}).value];assert.equal((await player.diplomacy.proposals.submit({id:'occupation-inline',intent:{...draft,data,reason:'Inline'}})).ok,false);
 const ui=new DiplomacyApplicationController(player.diplomacy);ui.selectTab('territory');ui.select(id);unwrap(await ui.load());unwrap(await ui.submitOccupation(occupationUiFields({occupationVisibility:'secret'})));const pid=(unwrap(await player.diplomacy.proposals.query()) as any).items[0].id;unwrap(await gm.diplomacy.proposals.decide({id:pid,expectedRevision:0,decision:'approve',reason:'Private new occupation'}));assert.equal((unwrap(await player.diplomacy.proposals.query({id:pid})) as any).decision.approvedIntent,null);unwrap(await ui.load());assert.equal(ui.detail.occupations.length,0);
 }finally{player.destroy();gm.destroy();}
});
test('G6 occupation runtime: approved dependency turns private and end proposal admission stays uniform',async()=>{
 const f=fixture(),gm=f.make(),player=f.make('player');try{await gm.initialize();const id=await occupationTerritory(gm);unwrap(await player.diplomacy.proposals.submit({id:'occupation-dependency-private',intent:{kind:'territory',mode:'modify',id,expectedRevision:0,reason:'Create',action:occupationAction({id:'depends'})}}));unwrap(await gm.diplomacy.proposals.decide({id:'occupation-dependency-private',expectedRevision:0,decision:'approve',reason:'Approved'}));const row:any=await f.adapter.read('territory',id);row.data.presence[0].visibility='secret';await f.adapter.write(row);const before=await f.adapter.loadAll();assert.equal((unwrap(await player.diplomacy.proposals.query({id:'occupation-dependency-private'})) as any).decision.approvedIntent,null);assert.equal((unwrap(await player.diplomacy.territory.query({id})) as any).occupations.length,0);
 for(const target of ['depends','missing'])assert.equal((await player.diplomacy.proposals.submit({id:crypto.randomUUID(),intent:{kind:'territory',mode:'modify',id,expectedRevision:1,reason:'End',action:{kind:'end-occupation',id:target}}})).ok,false);assert.deepEqual(await f.adapter.loadAll(),before);
 }finally{player.destroy();gm.destroy();}
});
test("G6 claims runtime: physical default preserves competing local and inherited claims with origin revisions", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await claimsTerritories(gm), before = await f.adapter.loadAll();
    const d: any = unwrap(await player.publicApi.diplomacy.territory.query({ id: ids.child }));
    assert.equal(d.claimInheritanceAxis, "locatedInUuid"); assert.deepEqual(d.effectiveClaims.map((r: any) => [r.sourceTerritoryUuid, r.claim.id, r.inherited]),
      [[ids.child, "same", false], [ids.child, "local-private", false], [ids.physical, "same", true], [ids.root, "root", true]]);
    assert.equal(d.effectiveClaims[2].sourceTerritoryLabel, "Physical origin"); assert.equal(d.effectiveClaims[2].sourceRevision, 0);
    assert.equal(d.effectiveClaims[2].claim.contested, true); assert.equal(d.effectiveClaims[0].claim.inherited, false);
    assert.equal(d.claims.length, 2); assert.equal(d.rights.length, 0); assert.equal(d.occupations.length, 0); assert.equal(d.effectiveClaims.some((r: any) => r.winner), false);
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 claims runtime: administrative ancestry is independent and GM sees private claims only on selected path", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await claimsTerritories(gm);
    const admin: any = unwrap(await player.diplomacy.territory.query({ id: ids.child, claimInheritanceAxis: "administrativeParentUuid" }));
    assert.deepEqual(admin.effectiveClaims.map((r: any) => r.claim.id), ["same", "local-private", "admin"]);
    const physical: any = unwrap(await gm.diplomacy.territory.query({ id: ids.child }));
    assert.deepEqual(physical.effectiveClaims.map((r: any) => r.claim.id), ["same", "local-private", "same", "private-claim-marker", "secret-claim-marker", "root"]);
    assert.equal((await player.diplomacy.territory.query({ id: ids.child, claimInheritanceAxis: "both" as any })).ok, false);
    assert.equal((await player.diplomacy.territory.query({ claimInheritanceAxis: "locatedInUuid" })).ok, false);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 claims runtime: ancestor audience is evaluated independently of child controller", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const ids = await claimsTerritories(gm);
    const p: any = unwrap(await player.diplomacy.territory.query({ id: ids.child })); assert.equal(JSON.stringify(p).includes("private-claim-marker"), false);
    const s: any = unwrap(await stranger.diplomacy.territory.query({ id: ids.child })); assert.equal(JSON.stringify(s).includes("local-private"), false);
    const row: any = await f.adapter.read("territory", ids.physical); row.data.claims[5].claimantRef = { type: "domain", uuid: domainUuid }; await f.adapter.write(row);
    const owned: any = unwrap(await player.diplomacy.territory.query({ id: ids.child })); assert.ok(owned.effectiveClaims.some((r: any) => r.claim.id === "private-claim-marker"));
    assert.equal(JSON.stringify(owned).includes("secret-claim-marker"), false); assert.equal(JSON.stringify(unwrap(await stranger.diplomacy.territory.query({ id: ids.child }))).includes("private-claim-marker"), false);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 claims runtime: hidden middle origin stops traversal even when grandparent is public", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await claimsTerritories(gm); const row: any = await f.adapter.read("territory", ids.physical);
    row.data.territory.visibility = "secret"; row.data.territory.label = "secret-origin-marker"; await f.adapter.write(row);
    const d: any = unwrap(await player.diplomacy.territory.query({ id: ids.child })); assert.equal(d.effectiveClaims.length, 2); assert.equal(d.territory.locatedInUuid, null);
    for (const marker of [ids.physical, ids.root, "secret-origin-marker", "root", "private-claim-marker"]) assert.equal(JSON.stringify(d).includes(marker), false);
    assert.ok((unwrap(await gm.diplomacy.territory.query({ id: ids.child })) as any).effectiveClaims.some((r: any) => r.sourceTerritoryUuid === ids.root));
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 claims runtime: changed persistent visibility and labels override the cached ancestor", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await claimsTerritories(gm); unwrap(await player.diplomacy.territory.query({ id: ids.child }));
    const row: any = await f.adapter.read("territory", ids.physical); row.data.claims[0].visibility = "secret"; row.data.territory.label = "Renamed origin"; await f.adapter.write(row);
    const d: any = unwrap(await player.diplomacy.territory.query({ id: ids.child })); assert.equal(d.effectiveClaims.some((r: any) => r.sourceTerritoryUuid === ids.physical), false);
    row.data.claims[0].visibility = "public"; await f.adapter.write(row);
    assert.equal((unwrap(await player.diplomacy.territory.query({ id: ids.child })) as any).effectiveClaims.find((r: any) => r.sourceTerritoryUuid === ids.physical).sourceTerritoryLabel, "Renamed origin");
    const target: any = await f.adapter.read("territory", ids.child); target.data.territory.visibility = "secret"; await f.adapter.write(target);
    assert.equal((await player.diplomacy.territory.query({ id: ids.child })).ok, false);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 claims runtime: unavailable ancestor fences truncate only that lineage without exposing recovery metadata", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await claimsTerritories(gm), { lockKey } = await import("../../src/mutations/lock-keys.js");
    gm.recovery.fenceRegistry.installFence({ transactionId: "private-recovery-marker", lockKeys: [lockKey.diplomacy("territory", ids.physical)], reason: "secret-reason-marker" });
    const d: any = unwrap(await player.diplomacy.territory.query({ id: ids.child })); assert.equal(d.effectiveClaims.length, 2); assert.equal(JSON.stringify(d).includes("private-recovery-marker"), false);
    assert.equal((unwrap(await player.diplomacy.territory.query({ id: ids.child, claimInheritanceAxis: "administrativeParentUuid" })) as any).effectiveClaims.length, 3);
    gm.recovery.fenceRegistry.installFence({ transactionId: "graph-fence", lockKeys: [lockKey.territoryGraph()], reason: "Needs recovery" }); assert.equal((await player.diplomacy.territory.query({ id: ids.child })).ok, false);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 claims runtime: missing, corrupt and mismatched origins never fabricate inherited data", async () => {
  for (const mode of ["missing", "corrupt", "identity", "revision"]) {
    const f = fixture(), gm = f.make(), player = f.make("player");
    try { await gm.initialize(); const ids = await claimsTerritories(gm);
      if (mode === "missing") await f.adapter.remove("territory", ids.physical);
      else { const row: any = await f.adapter.read("territory", ids.physical); if (mode === "corrupt") row.data.claims = "corrupt";
        if (mode === "identity") row.data.territory.uuid = ids.administrative;
        if (mode === "revision") row.data.territory.revision = 1;
        await f.adapter.write(row); }
      const before = await f.adapter.loadAll(), d: any = unwrap(await player.diplomacy.territory.query({ id: ids.child })); assert.equal(d.effectiveClaims.length, 2); assert.deepEqual(await f.adapter.loadAll(), before);
    } finally { player.destroy(); gm.destroy(); }
  }
});
test("G6 claims runtime: cycles return local sources only and do not hang or repair storage", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await claimsTerritories(gm), row: any = await f.adapter.read("territory", ids.root);
    row.data.territory.locatedInUuid = ids.child; await f.adapter.write(row); const before = await f.adapter.loadAll();
    const d: any = unwrap(await player.diplomacy.territory.query({ id: ids.child })); assert.equal(d.effectiveClaims.length, 2); assert.ok(d.effectiveClaims.every((r: any) => !r.inherited)); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 claims runtime: authoritative clock observes inclusive starts and exclusive ends without mutations", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await claimsTerritories(gm), before = await f.adapter.loadAll();
    const query = async () => (unwrap(await player.diplomacy.territory.query({ id: ids.child })) as any).effectiveClaims.map((r: any) => r.claim.id);
    assert.equal((await query()).includes("expired"), false); assert.equal((await query()).includes("future"), false);
    f.time.tick = 9; assert.equal((await query()).includes("expired"), true); f.time.tick = 11; assert.equal((await query()).includes("future"), true);
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 claims runtime: reparent changes derived origins while local claims and audited revisions remain native", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await claimsTerritories(gm);
    unwrap(await gm.diplomacy.territory.modify({ id: ids.child, expectedRevision: 0, action: { kind: "reparent", parents: { locatedInUuid: ids.administrative, administrativeParentUuid: ids.physical } }, reason: "Change hierarchy" }));
    const d: any = unwrap(await player.diplomacy.territory.query({ id: ids.child })); assert.equal(d.revision, 1); assert.deepEqual(d.effectiveClaims.map((r: any) => r.claim.id), ["same", "local-private", "admin"]);
    const row: any = await f.adapter.read("territory", ids.child); assert.equal(row.data.claims.length, 2); assert.equal(row.data.territory.hierarchyHistory.length, 1);
    const before = await f.adapter.loadAll(); unwrap(await player.diplomacy.territory.query({ id: ids.child })); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 claims runtime: inherited IDs cannot become local recognition or occupation references", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await claimsTerritories(gm), ui = new DiplomacyApplicationController(player.diplomacy);
    ui.selectTab("territory"); ui.select(ids.child); unwrap(await ui.load()); assert.equal(ui.detail.claims.some((c: any) => c.id === "root"), false);
    const before = await f.adapter.loadAll(); assert.equal((await player.diplomacy.proposals.submit({ id: "inherited-local-recognition", intent: { kind: "territory", mode: "modify", id: ids.child, expectedRevision: 0, reason: "Wrong origin",
      action: { kind: "recognition", value: { id: "wrong", sourceRef: { type: "manual", id: "player" }, visibility: "public", startsAtWorldTick: 10, expiresAtWorldTick: null, claimId: "root", recognizingRef: { type: "domain", uuid: domainUuid }, position: "positive" } } } })).ok, false);
    assert.equal((await player.diplomacy.proposals.submit({ id: "inherited-local-occupation", intent: { kind: "territory", mode: "modify", id: ids.child, expectedRevision: 0, reason: "Wrong origin",
      action: occupationAction({ presenceIds: [], controlClaimIds: ["root"] }) } })).ok, false);
    assert.deepEqual(await f.adapter.loadAll(), before); assert.equal(ui.openClaimOrigin(ids.root).ok, true); unwrap(await ui.load()); assert.equal(ui.detail.id, ids.root);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 claims runtime: reload recalculates derivation without storing projections or creating audit entries", async () => {
  const f = fixture(), first = f.make(); let ids: Awaited<ReturnType<typeof claimsTerritories>>;
  try { await first.initialize(); ids = await claimsTerritories(first); unwrap(await first.diplomacy.territory.query({ id: ids.child })); } finally { first.destroy(); }
  const reload = f.make(), player = f.make("player");
  try { await reload.initialize(); const before = await f.adapter.loadAll(); const d: any = unwrap(await player.diplomacy.territory.query({ id: ids!.child })); assert.equal(d.effectiveClaims.length, 4);
    assert.equal(d.events.length, 0); assert.equal(JSON.stringify(before).includes("effectiveClaims"), false); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); reload.destroy(); }
});
test("G6 claim impact runtime: GM preview shows both axes and exact inherited before/after without any writes", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), before = await f.adapter.loadAll(), preview: any = unwrap(await gm.diplomacy.previewTerritory(hierarchyInput(ids)));
    assert.equal(preview.claimInheritanceImpact.worldTick, 10); assert.equal(preview.facilityOwnershipChanges, 0); assert.equal(preview.changes.length, 1);
    const physical = preview.claimInheritanceImpact.axes[0].territories[0]; assert.equal(physical.localCount, 2);
    assert.deepEqual(physical.removed.map((r: any) => r.claim.id), ["same", "private-claim-marker", "secret-claim-marker", "root"]);
    assert.deepEqual(physical.added.map((r: any) => r.claim.id), ["admin"]); assert.equal(physical.retained.length, 0);
    assert.equal(preview.claimInheritanceImpact.axes[1].territories[0].removed[0].claim.id, "admin"); assert.equal(preview.previewSnapshot.worldTick, 10);
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: each changed axis includes only its target and actual descendants", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), physical = await ids.add("Physical child", [], { locatedInUuid: ids.child }),
    grandchild = await ids.add("Physical grandchild", [], { locatedInUuid: physical }), admin = await ids.add("Administrative child", [], { administrativeParentUuid: ids.child });
    const preview: any = unwrap(await gm.diplomacy.previewTerritory(hierarchyInput(ids))); assert.deepEqual(preview.claimInheritanceImpact.axes[0].territories.map((r: any) => r.territoryUuid), [ids.child, physical, grandchild]);
    assert.deepEqual(preview.claimInheritanceImpact.axes[1].territories.map((r: any) => r.territoryUuid), [ids.child, admin]);
    assert.equal(preview.changes.some((c: any) => c.id === physical), false);
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: preview remains GM-only; authenticated Player or third party cannot forge access to secret sources", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const ids = await claimsTerritories(gm), before = await f.adapter.loadAll();
    for (const r of [player, stranger]) { assert.equal((await r.publicApi.diplomacy.previewTerritory(hierarchyInput(ids))).ok, false);
      const forged = unwrap(await r.commandBus.execute(command("territory:preview", { ...hierarchyInput(ids), isGm: true, senderUserId: "gm" }))); assert.equal(forged.status, "rejected"); assert.equal(JSON.stringify(forged).includes("secret-claim-marker"), false); }
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 claim impact runtime: ancestor mutation invalidates confirmation despite unchanged target revision", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), input = hierarchyInput(ids), preview: any = unwrap(await gm.diplomacy.previewTerritory(input));
    unwrap(await gm.diplomacy.territory.modify({ id: ids.physical, expectedRevision: 0, reason: "End source", action: { kind: "end-claim", id: "same" } }));
    const before = await f.adapter.loadAll(), result = await gm.diplomacy.territory.modify({ ...input, previewSnapshot: preview.previewSnapshot }); assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_PREVIEW_STALE"); assert.deepEqual(await f.adapter.loadAll(), before); assert.equal((await f.adapter.read("territory", ids.child))!.revision, 0);
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: unversioned persisted source visibility change invalidates old preview", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), input = hierarchyInput(ids), preview: any = unwrap(await gm.diplomacy.previewTerritory(input));
    const row: any = await f.adapter.read("territory", ids.physical); row.data.claims[0].visibility = "secret"; await f.adapter.write(row);
    const before = await f.adapter.loadAll(), result = await gm.diplomacy.territory.modify({ ...input, previewSnapshot: preview.previewSnapshot }); assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_PREVIEW_STALE"); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: clock drift requires a new preview at the authoritative tick", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), input = hierarchyInput(ids), preview: any = unwrap(await gm.diplomacy.previewTerritory(input)), before = await f.adapter.loadAll(); f.time.tick = 11;
    const result = await gm.diplomacy.territory.modify({ ...input, previewSnapshot: preview.previewSnapshot }); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_PREVIEW_STALE"); assert.deepEqual(await f.adapter.loadAll(), before);
    const fresh: any = unwrap(await gm.diplomacy.previewTerritory(input)); assert.equal(fresh.claimInheritanceImpact.axes[0].territories[0].before.some((r: any) => r.claim.id === "future"), true);
    unwrap(await gm.diplomacy.territory.modify({ ...input, previewSnapshot: fresh.previewSnapshot }));
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: external unindexed territorial catalog addition invalidates snapshot", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), input = hierarchyInput(ids), preview: any = unwrap(await gm.diplomacy.previewTerritory(input)), d = createDiplomacyDraft("territory", "External addition", [], "public");
    await f.adapter.write({ schemaVersion: 1, kind: "territory", id: d.id, revision: 0, data: d.data, receipts: [] }); const before = await f.adapter.loadAll();
    const result = await gm.diplomacy.territory.modify({ ...input, previewSnapshot: preview.previewSnapshot }); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_PREVIEW_STALE"); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: no-op retains revisions and hierarchy audit with no affected axes", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), input = hierarchyInput(ids, { action: { kind: "reparent", parents: { locatedInUuid: ids.physical, administrativeParentUuid: ids.administrative } } }),
    preview: any = unwrap(await gm.diplomacy.previewTerritory(input)); assert.ok(preview.claimInheritanceImpact.axes.every((a: any) => !a.changed && a.territories.length === 0));
    const result: any = unwrap(await gm.diplomacy.territory.modify({ ...input, previewSnapshot: preview.previewSnapshot })); assert.equal(result.changed, false);
    const row: any = await f.adapter.read("territory", ids.child); assert.equal(row.revision, 0); assert.equal(row.data.territory.hierarchyHistory.length, 0);
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: root detachment writes only target hierarchy and recalculates descendants without copied claims", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), child = await ids.add("Descendant", [], { locatedInUuid: ids.child }), before: any[] = [...await f.adapter.loadAll()],
    input = hierarchyInput(ids, { action: { kind: "reparent", parents: { locatedInUuid: null, administrativeParentUuid: null } } }), preview: any = unwrap(await gm.diplomacy.previewTerritory(input));
    assert.equal(preview.claimInheritanceImpact.axes[0].territories[0].after.length, 0); unwrap(await gm.diplomacy.territory.modify({ ...input, previewSnapshot: preview.previewSnapshot }));
    for (const row of await f.adapter.loadAll()) { const old: any = before.find(x => x.id === row.id); if (row.id !== ids.child) assert.deepEqual(row, old); else { const data: any = row.data; assert.deepEqual(data.claims, old.data.claims); assert.equal(data.territory.hierarchyHistory.length, 1); assert.equal(row.revision, 1); } }
    assert.equal((unwrap(await gm.diplomacy.territory.query({ id: child })) as any).effectiveClaims.length, 0);
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: ancestor recovery fence blocks new preview and old-snapshot confirmation", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), input = hierarchyInput(ids), preview: any = unwrap(await gm.diplomacy.previewTerritory(input)), { lockKey } = await import("../../src/mutations/lock-keys.js"), before = await f.adapter.loadAll();
    gm.recovery.fenceRegistry.installFence({ transactionId: "claim-impact-fence", lockKeys: [lockKey.diplomacy("territory", ids.physical)], reason: "Recover source" });
    assert.equal((await gm.diplomacy.previewTerritory(input)).ok, false); assert.equal((await gm.diplomacy.territory.modify({ ...input, previewSnapshot: preview.previewSnapshot })).ok, false); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: corrupt, inconsistent or missing ancestry fails closed without preparing misleading impacts", async () => {
  for (const mode of ["corrupt", "identity", "revision", "missing"]) {
    const f = fixture(), gm = f.make();
    try { await gm.initialize(); const ids = await claimsTerritories(gm);
      if (mode === "missing") await f.adapter.remove("territory", ids.physical);
      else { const row: any = await f.adapter.read("territory", ids.physical); if (mode === "corrupt") row.data.claims = "bad"; if (mode === "identity") row.data.territory.uuid = ids.root; if (mode === "revision") row.data.territory.revision = 1; await f.adapter.write(row); }
      const before = await f.adapter.loadAll(); assert.equal((await gm.diplomacy.previewTerritory(hierarchyInput(ids))).ok, false); assert.deepEqual(await f.adapter.loadAll(), before);
    } finally { gm.destroy(); }
  }
});
test("G6 claim impact runtime: changed target revision cannot be bypassed with an old snapshot", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), input = hierarchyInput(ids), preview: any = unwrap(await gm.diplomacy.previewTerritory(input));
    unwrap(await gm.diplomacy.territory.modify({ id: ids.child, expectedRevision: 0, reason: "Contest target", action: { kind: "contest-claim", id: "same", contested: true } })); const before = await f.adapter.loadAll();
    const result = await gm.diplomacy.territory.modify({ ...input, previewSnapshot: preview.previewSnapshot }); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_REVISION_CONFLICT"); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: GM interface previews, preserves fields, confirms and keeps inherited changes derived", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), ui = new DiplomacyApplicationController(gm.diplomacy), fields = { kind: "reparent", physical: ids.administrative, administrative: "", reason: "Move hierarchy" };
    ui.selectTab("territory"); ui.select(ids.child); unwrap(await ui.load()); assert.equal((await ui.change(fields)).ok, false); unwrap(await ui.change(fields, true)); unwrap(await ui.load());
    assert.ok(ui.actionForm().includes('value="reparent" selected')); assert.ok(ui.actionForm().includes(`value="${ids.administrative}"`)); assert.ok(ui.actionForm().includes("Prévia da hierarquia"));
    unwrap(await ui.change(fields)); unwrap(await ui.load()); assert.equal(ui.detail.revision, 1); assert.equal(ui.detail.claims.length, 2); assert.equal(ui.detail.effectiveClaims.length, 3);
    const row: any = await f.adapter.read("territory", ids.child); assert.equal(row.data.previewSnapshot, undefined); assert.equal(row.data.claimInheritanceImpact, undefined); assert.equal(row.data.territory.hierarchyHistory.length, 1);
  } finally { gm.destroy(); }
});
test("G6 claim impact runtime: exact confirmation ticket retries once despite later clock drift and reload", async () => {
  const f = fixture(), first = f.make(); let ticket: any, child = "";
  try { await first.initialize(); const ids = await claimsTerritories(first), input = hierarchyInput(ids), preview: any = unwrap(await first.diplomacy.previewTerritory(input)); child = ids.child;
    ticket = unwrap(first.diplomacy.commands.prepare("territory:modify", { ...input, previewSnapshot: preview.previewSnapshot })); assert.equal(unwrap(await first.diplomacy.commands.execute(ticket)).status, "executed");
    f.time.tick = 20; assert.equal(unwrap(await first.diplomacy.commands.retry(ticket)).status, "executed");
  } finally { first.destroy(); }
  const reload = f.make(); try { await reload.initialize(); assert.equal(unwrap(await reload.diplomacy.commands.retry(ticket)).status, "executed"); const row: any = await f.adapter.read("territory", child); assert.equal(row.revision, 1); assert.equal(row.data.territory.hierarchyHistory.length, 1); } finally { reload.destroy(); }
});
test("G6 claim impact runtime: Player reparent proposal remains immutable and needs a GM decision", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await claimsTerritories(gm), ui = new DiplomacyApplicationController(player.diplomacy), fields = { kind: "reparent", physical: ids.administrative, administrative: "", reason: "Propose hierarchy" };
    ui.selectTab("territory"); ui.select(ids.child); unwrap(await ui.load()); unwrap(await ui.change(fields)); assert.equal((await f.adapter.read("territory", ids.child))!.revision, 0);
    const proposals: any = unwrap(await player.diplomacy.proposals.query()), detail: any = unwrap(await player.diplomacy.proposals.query({ id: proposals.items[0].id })); assert.equal(detail.original.previewSnapshot, undefined); assert.equal(detail.original.action.parents.locatedInUuid, ids.administrative);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 claim impact runtime: preview snapshot binds action and reason; same revision cannot silently reuse another plan", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await claimsTerritories(gm), input = hierarchyInput(ids), preview: any = unwrap(await gm.diplomacy.previewTerritory(input)), before = await f.adapter.loadAll();
    for (const patch of [{ reason: "Other" }, { action: { kind: "reparent", parents: { locatedInUuid: null, administrativeParentUuid: null } } }]) {
      const result = await gm.diplomacy.territory.modify({ ...input, ...patch, previewSnapshot: preview.previewSnapshot }); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_PREVIEW_STALE"); }
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});

const territorialRight = (id: string, patch = {}) => ({ id, sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 0,
  expiresAtWorldTick: null, beneficiaryRef: { type: "narrative", id: "guild" }, rightType: "domain-manager:entry", inherited: true,
  revocable: true, active: true, conditionRefs: [], grants: [], ...patch });
async function rightsTerritories(r: ReturnType<typeof composeDomainManagerRuntime>) {
  const add = async (label: string, rights: any[], patch = {}, visibility = "public") => {
    const draft = createDiplomacyDraft("territory", label, [], visibility as any), data: any = draft.data;
    data.rights = rights.map(right => structuredClone(right)); Object.assign(data.territory, patch); unwrap(await r.diplomacy.territory.create({ ...draft, reason: "Create rights source" })); return draft.id;
  };
  const root = await add("Rights root", [territorialRight("root")]);
  const physical = await add("Rights physical", [territorialRight("same"), territorialRight("no-propagation", { inherited: false }),
    territorialRight("private-right-marker", { visibility: "restricted" }), territorialRight("secret-right-marker", { visibility: "secret" })], { locatedInUuid: root });
  const administrative = await add("Rights administrative", [territorialRight("admin")]);
  const child = await add("Rights child", [territorialRight("same", { inherited: false, beneficiaryRef: { type: "domain", uuid: domainUuid } }),
    territorialRight("local-private-right", { visibility: "restricted", beneficiaryRef: { type: "domain", uuid: domainUuid } })],
    { locatedInUuid: physical, administrativeParentUuid: administrative });
  return { root, physical, administrative, child, add };
}
const rightTerm = (territoryUuid: string, id = "same", payload = {}, visibility = "public") => ({ id, type: "domain-manager:right", title: "Right", text: null,
  partyIds: ["party-0"], visibility, payload: { beneficiaryPartyId: "party-0", territoryUuid, rightType: "domain-manager:trade", startsAtWorldTick: null,
    expiresAtWorldTick: null, inherited: true, revocable: true, conditionRefs: [], grants: [], ...payload } });
const rightsReport = async (r: ReturnType<typeof composeDomainManagerRuntime>, id: string, patch = {}) =>
  (unwrap(await r.publicApi.diplomacy.territory.query({ id, ...patch })) as any).territoryRights;
test("G6 rights runtime: read-only physical rights preserve all origins, empty grants and local records", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await rightsTerritories(gm), before = await f.adapter.loadAll();
    const d: any = unwrap(await player.publicApi.diplomacy.territory.query({ id: ids.child }));
    assert.deepEqual(d.territoryRights.entries.map((r: any) => [r.origin.id, r.rightId, r.inherited]), [[ids.child, "same", false], [ids.child, "local-private-right", false], [ids.physical, "same", true], [ids.root, "root", true]]);
    assert.equal(d.territoryRights.effectiveCount, 4); assert.equal(d.territoryRights.axis, "locatedInUuid"); assert.equal(d.territoryRights.worldTick, 10);
    assert.ok(d.territoryRights.entries.every((r: any) => r.grants.length === 0 && r.status === "effective")); assert.equal(d.rights.length, 2);
    assert.equal(d.territoryRights.entries[2].origin.revision, 0); assert.equal(d.territoryRights.entries[2].sourceTerritoryLabel, "Rights physical");
    assert.deepEqual(await f.adapter.loadAll(), before);
    assert.equal((await gm.diplomacy.territory.modify({ id: ids.child, expectedRevision: 0, action: { kind: "revoke-right", id: "root" }, reason: "Wrong origin" })).ok, false);
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 rights runtime: right hierarchy is independent from claims and other axis", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await rightsTerritories(gm);
    const d: any = unwrap(await player.diplomacy.territory.query({ id: ids.child, rightInheritanceAxis: "administrativeParentUuid", claimInheritanceAxis: "locatedInUuid" }));
    assert.equal(d.claimInheritanceAxis, "locatedInUuid"); assert.deepEqual(d.territoryRights.entries.map((r: any) => r.rightId), ["same", "local-private-right", "admin"]);
    assert.equal((await player.diplomacy.territory.query({ id: ids.child, rightInheritanceAxis: "both" as any })).ok, false);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 rights runtime: source audience is independent of child, including restricted conditions", async () => {
  const calls: string[] = [], f = fixture(undefined, undefined, ref => { calls.push(ref.id!); return true; }), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const ids = await rightsTerritories(gm), row: any = await f.adapter.read("territory", ids.physical);
    row.data.rights[2].conditionRefs = [{ type: "requirement", id: "private-condition-marker" }]; await f.adapter.write(row);
    assert.equal(JSON.stringify(await rightsReport(player, ids.child)).includes("private-right-marker"), false); assert.deepEqual(calls, []);
    assert.equal(JSON.stringify(await rightsReport(stranger, ids.child)).includes("local-private-right"), false);
    row.data.rights[2].beneficiaryRef = { type: "domain", uuid: domainUuid }; await f.adapter.write(row);
    assert.ok((await rightsReport(player, ids.child)).entries.some((r: any) => r.rightId === "private-right-marker")); assert.deepEqual(calls, ["private-condition-marker"]);
    assert.equal(JSON.stringify(await rightsReport(player, ids.child)).includes("secret-right-marker"), false);
    assert.equal(JSON.stringify(await rightsReport(stranger, ids.child)).includes("private-right-marker"), false);
    assert.ok((await rightsReport(gm, ids.child)).entries.some((r: any) => r.rightId === "secret-right-marker"));
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 rights runtime: hidden middle origin blocks parent rights and scoped treaty traversal", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await rightsTerritories(gm), treaty = await prepareAgreement(gm, [rightTerm(ids.root)]); unwrap(await treaty.activate());
    const row: any = await f.adapter.read("territory", ids.physical); row.data.territory.visibility = "secret"; row.data.territory.label = "hidden-right-origin"; await f.adapter.write(row);
    const d: any = unwrap(await player.diplomacy.territory.query({ id: ids.child })); assert.equal(d.territory.locatedInUuid, null); assert.equal(d.territoryRights.entries.length, 2);
    for (const marker of [ids.physical, ids.root, treaty.id, "hidden-right-origin"]) assert.equal(JSON.stringify(d).includes(marker), false);
    assert.ok((await rightsReport(gm, ids.child)).entries.some((r: any) => r.origin.id === treaty.id));
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 rights runtime: inactive, inclusive start, exclusive expiry and condition states are derived at authority tick", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const ids = await rightsTerritories(gm), id = await ids.add("Timing", [territorialRight("now", { startsAtWorldTick: 10, expiresAtWorldTick: 11 }),
    territorialRight("future", { startsAtWorldTick: 11 }), territorialRight("expired", { expiresAtWorldTick: 10 }), territorialRight("inactive", { active: false }),
    territorialRight("conditional", { conditionRefs: [{ type: "requirement", id: "check" }] })]);
    const before = await f.adapter.loadAll(), result = await rightsReport(gm, id, { worldTick: 999, conditionSatisfied: true });
    assert.equal(result.worldTick, 10); assert.deepEqual(result.entries.map((r: any) => r.status), ["effective", "scheduled", "expired", "inactive", "conditions-unconfirmed"]);
    assert.equal(result.entries[4].conditions[0].confirmed, false); f.time.tick = 11;
    assert.deepEqual((await rightsReport(gm, id)).entries.slice(0, 2).map((r: any) => r.status), ["expired", "effective"]); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});
test("G6 rights runtime: only literal true authorizes conditions; throws and missing providers fail closed", async () => {
  for (const [provider, expected] of [[undefined, false], [() => false, false], [() => "yes" as any, false], [() => { throw Error("private-provider-error"); }, false], [() => true, true]] as const) {
    const f = fixture(undefined, undefined, provider), gm = f.make();
    try { await gm.initialize(); const ids = await rightsTerritories(gm), id = await ids.add("Conditional", [territorialRight("conditional", { conditionRefs: [{ type: "requirement", id: "check" }] })]);
      const result = await rightsReport(gm, id); assert.equal(result.entries[0].status, expected ? "effective" : "conditions-unconfirmed");
      assert.equal(JSON.stringify(result).includes("private-provider-error"), false);
    } finally { gm.destroy(); }
  }
});
test("G6 rights runtime: conditions are memoized, sanitized and skipped outside visible eligible sources", async () => {
  const calls: any[] = [], f = fixture(undefined, undefined, ref => { calls.push(ref); return true; }), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await rightsTerritories(gm), ref = { type: "requirement", id: "shared", privateMetadata: "secret-ref-marker" };
    const id = await ids.add("Conditions", [territorialRight("a", { conditionRefs: [ref] }), territorialRight("b", { conditionRefs: [ref] }),
      territorialRight("future", { startsAtWorldTick: 11, conditionRefs: [{ type: "requirement", id: "future" }] }), territorialRight("expired", { expiresAtWorldTick: 10, conditionRefs: [{ type: "requirement", id: "expired" }] }),
      territorialRight("inactive", { active: false, conditionRefs: [{ type: "requirement", id: "inactive" }] }), territorialRight("hidden", { visibility: "secret", conditionRefs: [{ type: "requirement", id: "hidden" }] })]);
    const treaty = await prepareAgreement(gm, [rightTerm(id, "condition-treaty", { conditionRefs: [ref] })]); unwrap(await treaty.activate()); calls.length = 0;
    const result = await rightsReport(player, id); assert.deepEqual(calls, [{ type: "requirement", id: "shared" }]); assert.equal(JSON.stringify(result).includes("secret-ref-marker"), false);
    assert.deepEqual(result.entries.filter((r: any) => ["scheduled", "expired", "inactive"].includes(r.status)).map((r: any) => r.conditions[0].confirmed), [null, null, null]);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 rights runtime: active treaty rights join territory sources while capability-only terms stay separate", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await rightsTerritories(gm), treaty = await prepareAgreement(gm, [rightTerm(ids.physical), rightTerm(ids.physical, "own-only", { inherited: false }),
    rightTerm(ids.administrative, "admin-treaty"), { id: "capability-only", type: "domain-manager:capability", title: "Capability", text: null, partyIds: ["party-0"], visibility: "public",
      payload: { beneficiaryPartyId: "party-0", capabilityIds: ["test:construction"], scopeRef: null, conditionRefs: [] } }]);
    assert.equal((await rightsReport(player, ids.child)).entries.some((r: any) => r.origin.id === treaty.id), false); unwrap(await treaty.activate());
    const before = await f.adapter.loadAll(), result = await rightsReport(player, ids.child), a = result.entries.filter((r: any) => r.origin.kind === "agreement");
    assert.equal(a.length, 1); assert.equal(a[0].rightId, "same"); assert.equal(a[0].status, "effective"); assert.equal(a[0].inherited, true); assert.deepEqual(a[0].grants, []);
    assert.equal(a[0].origin.id, treaty.id); assert.equal(a[0].origin.revision, 4); assert.equal(a[0].sourceTerritoryUuid, ids.physical); assert.equal(a[0].sourceTerritoryRevision, 0);
    assert.equal((await rightsReport(player, ids.child, { rightInheritanceAxis: "administrativeParentUuid" })).entries.find((r: any) => r.origin.kind === "agreement").rightId, "admin-treaty");
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 rights runtime: agreement and term audiences independently gate visibility", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const ids = await rightsTerritories(gm), treaty = await prepareAgreement(gm, [rightTerm(ids.child, "public-term"), rightTerm(ids.child, "restricted-term-marker", {}, "restricted"), rightTerm(ids.child, "secret-term-marker", {}, "secret")]); unwrap(await treaty.activate());
    assert.ok((await rightsReport(player, ids.child)).entries.some((r: any) => r.rightId === "restricted-term-marker")); assert.equal(JSON.stringify(await rightsReport(stranger, ids.child)).includes("restricted-term-marker"), false);
    assert.equal(JSON.stringify(await rightsReport(player, ids.child)).includes("secret-term-marker"), false);
    const row: any = await f.adapter.read("agreement", treaty.id); row.data.state.agreement.parties[0].ref = { type: "narrative", id: "other" }; await f.adapter.write(row);
    assert.equal(JSON.stringify(await rightsReport(player, ids.child)).includes("restricted-term-marker"), false);
    row.data.state.agreement.visibility = "restricted"; await f.adapter.write(row); assert.equal(JSON.stringify(await rightsReport(player, ids.child)).includes(treaty.id), false);
    row.data.state.agreement.visibility = "secret"; await f.adapter.write(row); assert.equal(JSON.stringify(await rightsReport(player, ids.child)).includes(treaty.id), false);
    assert.ok((await rightsReport(gm, ids.child)).entries.some((r: any) => r.rightId === "secret-term-marker"));
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 rights runtime: treaty lifecycle, intersected windows and pending amendments retain truthful effective states", async () => {
  const f = fixture(undefined, undefined, () => true), gm = f.make();
  try { await gm.initialize(); const ids = await rightsTerritories(gm), treaty = await prepareAgreement(gm, [rightTerm(ids.child, "current", { startsAtWorldTick: 10, expiresAtWorldTick: 20 }),
    rightTerm(ids.child, "future", { startsAtWorldTick: 11, conditionRefs: [{ type: "requirement", id: "future" }] }), rightTerm(ids.child, "expired", { expiresAtWorldTick: 10 })]); unwrap(await treaty.activate());
    const row: any = await f.adapter.read("agreement", treaty.id); row.data.state.agreement.duration = { startsAtWorldTick: 5, expiresAtWorldTick: 15 }; await f.adapter.write(row);
    const states = () => rightsReport(gm, ids.child).then(r => r.entries.filter((e: any) => e.origin.kind === "agreement"));
    let entries = await states(); assert.deepEqual(entries.map((r: any) => r.status), ["effective", "scheduled", "expired"]); assert.equal(entries[0].startsAtWorldTick, 10); assert.equal(entries[0].expiresAtWorldTick, 15); assert.equal(entries[1].conditions[0].confirmed, null);
    unwrap(await treaty.modify({ kind: "amend", proposalId: "pending-right", partyId: "party-0", terms: [rightTerm(ids.child, "not-active")], duration: { startsAtWorldTick: null, expiresAtWorldTick: null }, proposalExpiresAtWorldTick: null }));
    entries = await states(); assert.equal(entries[0].rightId, "current"); assert.equal(entries.some((r: any) => r.rightId === "not-active"), false);
    unwrap(await treaty.modify({ kind: "suspend" })); assert.ok((await states()).every((r: any) => r.status === "source-inactive"));
    unwrap(await treaty.modify({ kind: "resume" })); assert.equal((await states())[0].status, "effective"); f.time.tick = 15; assert.equal((await states())[0].status, "expired");
  } finally { gm.destroy(); }
});
test("G6 rights runtime: fresh treaty edits and external additions override stale catalog and do not write", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await rightsTerritories(gm), treaty = await prepareAgreement(gm, [rightTerm(ids.child)]); unwrap(await treaty.activate()); await rightsReport(player, ids.child);
    const row: any = await f.adapter.read("agreement", treaty.id); row.data.state.agreement.label = "Fresh treaty label"; row.data.state.agreement.terms[0].payload.grants = ["test:fresh-capability"]; await f.adapter.write(row);
    let result = await rightsReport(player, ids.child); assert.equal(result.entries.find((r: any) => r.origin.kind === "agreement").origin.label, "Fresh treaty label"); assert.deepEqual(result.entries.find((r: any) => r.origin.kind === "agreement").grants, ["test:fresh-capability"]);
    const external = structuredClone(row); external.id = "agreement_external_rights"; external.data.state.agreement.id = external.id; await f.adapter.write(external);
    const before = await f.adapter.loadAll(); result = await rightsReport(player, ids.child); assert.ok(result.entries.some((r: any) => r.origin.id === external.id)); assert.deepEqual(await f.adapter.loadAll(), before);
    row.data.state.agreement.visibility = "secret"; await f.adapter.write(row); assert.equal(JSON.stringify(await rightsReport(player, ids.child)).includes(treaty.id), false);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 rights runtime: missing, corrupt, incoherent and fenced agreements provide no derived rights", async () => {
  for (const mode of ["missing", "corrupt", "identity", "revision", "fence"]) {
    const f = fixture(), gm = f.make(), player = f.make("player");
    try { await gm.initialize(); const ids = await rightsTerritories(gm), treaty = await prepareAgreement(gm, [rightTerm(ids.child)]); unwrap(await treaty.activate());
      if (mode === "missing") await f.adapter.remove("agreement", treaty.id);
      else if (mode === "fence") { const { lockKey } = await import("../../src/mutations/lock-keys.js"); gm.recovery.fenceRegistry.installFence({ transactionId: "private-right-fence", lockKeys: [lockKey.diplomacy("agreement", treaty.id)], reason: "secret-reason" }); }
      else { const row: any = await f.adapter.read("agreement", treaty.id); if (mode === "corrupt") row.data.state.agreement.terms[0].payload.rightType = 123;
        if (mode === "identity") row.data.state.agreement.id = "wrong-id"; if (mode === "revision") row.data.state.agreement.revision += 1; await f.adapter.write(row); }
      const before = await f.adapter.loadAll(), result = await rightsReport(player, ids.child); assert.equal(result.entries.some((r: any) => r.origin.kind === "agreement"), false);
      for (const marker of [treaty.id, "private-right-fence", "secret-reason"]) assert.equal(JSON.stringify(result).includes(marker), false); assert.deepEqual(await f.adapter.loadAll(), before);
    } finally { player.destroy(); gm.destroy(); }
  }
});
test("G6 rights runtime: unavailable territory ancestors and cycles truncate derived sources without repairing storage", async () => {
  for (const mode of ["missing", "corrupt", "identity", "revision", "fence", "cycle"]) {
    const f = fixture(), gm = f.make(), player = f.make("player");
    try { await gm.initialize(); const ids = await rightsTerritories(gm);
      if (mode === "missing") await f.adapter.remove("territory", ids.physical);
      else if (mode === "fence") { const { lockKey } = await import("../../src/mutations/lock-keys.js"); gm.recovery.fenceRegistry.installFence({ transactionId: "rights-source-fence", lockKeys: [lockKey.diplomacy("territory", ids.physical)], reason: "Unavailable" }); }
      else { const row: any = await f.adapter.read("territory", mode === "cycle" ? ids.root : ids.physical);
        if (mode === "corrupt") row.data.rights = "broken"; if (mode === "identity") row.data.territory.uuid = ids.administrative;
        if (mode === "revision") row.data.territory.revision += 1; if (mode === "cycle") row.data.territory.locatedInUuid = ids.child; await f.adapter.write(row); }
      const before = await f.adapter.loadAll(), result = await rightsReport(player, ids.child); assert.equal(result.entries.length, 2); assert.ok(result.entries.every((r: any) => !r.inherited)); assert.deepEqual(await f.adapter.loadAll(), before);
    } finally { player.destroy(); gm.destroy(); }
  }
});
test("G6 rights runtime: no-grant rights do not synthesize capabilities or modify economic state", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await rightsTerritories(gm), treaty = await prepareAgreement(gm, [rightTerm(ids.child)]); unwrap(await treaty.activate());
    const before = await f.adapter.loadAll(), domainBefore = unwrap(await gm.domains.read("domainG6")), ledgerBefore = await f.ledger.loadSnapshot();
    const result = await rightsReport(player, ids.child); assert.ok(result.entries.some((r: any) => r.origin.kind === "agreement" && r.status === "effective" && !r.grants.length));
    const caps: any = unwrap(await player.diplomacy.capabilities(domainUuid, ids.child));
    assert.equal(JSON.stringify(caps).includes("domain-manager:entry"), false); assert.equal(JSON.stringify(caps).includes("domain-manager:trade"), false);
    assert.deepEqual(await f.adapter.loadAll(), before); assert.deepEqual(unwrap(await gm.domains.read("domainG6")), domainBefore); assert.deepEqual(await f.ledger.loadSnapshot(), ledgerBefore);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 rights runtime: agreement conditions fail closed and source inactivity skips evaluation", async () => {
  let calls = 0, satisfied = false;
  const f = fixture(undefined, undefined, () => { calls++; return satisfied; }), gm = f.make();
  try { await gm.initialize(); const ids = await rightsTerritories(gm), treaty = await prepareAgreement(gm, [rightTerm(ids.child, "conditional-treaty", { conditionRefs: [{ type: "requirement", id: "permit" }] })]); unwrap(await treaty.activate()); calls = 0;
    const row = async () => (await rightsReport(gm, ids.child)).entries.find((r: any) => r.origin.kind === "agreement");
    assert.equal((await row()).status, "conditions-unconfirmed"); assert.equal(calls, 1); satisfied = true;
    assert.equal((await row()).status, "effective"); unwrap(await treaty.modify({ kind: "suspend" })); calls = 0;
    const suspended = await row(); assert.equal(suspended.status, "source-inactive"); assert.equal(suspended.conditions[0].confirmed, null); assert.equal(calls, 0);
  } finally { gm.destroy(); }
});
test("G6 rights runtime: audited revocation refreshes derived status without deleting the source", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const ids = await rightsTerritories(gm);
    unwrap(await gm.diplomacy.territory.modify({ id: ids.physical, expectedRevision: 0, reason: "Revoke source right", action: { kind: "revoke-right", id: "same" } }));
    const d: any = unwrap(await player.diplomacy.territory.query({ id: ids.child })), source = d.territoryRights.entries.find((r: any) => r.origin.id === ids.physical && r.rightId === "same");
    assert.equal(source.status, "inactive"); assert.equal(source.origin.revision, 1); assert.equal(d.rights.length, 2); assert.equal(d.revision, 0);
    const origin: any = unwrap(await gm.diplomacy.territory.query({ id: ids.physical })); assert.equal(origin.rights.length, 4); assert.equal(origin.events.length, 1);
    assert.equal(d.territoryRights.entries.find((r: any) => r.origin.id === ids.child && r.rightId === "same").status, "effective");
  } finally { player.destroy(); gm.destroy(); }
});

async function rightImpactWorld(gm: ReturnType<typeof composeDomainManagerRuntime>, conditional = false) {
  const ids = await rightsTerritories(gm), next = await ids.add("Next rights branch", [territorialRight("same")], { locatedInUuid: ids.root });
  const physicalChild = await ids.add("Affected rights child", [territorialRight("desc-local")], { locatedInUuid: ids.child });
  const adminChild = await ids.add("Other axis child", [], { administrativeParentUuid: ids.child });
  const treaties = [];
  for (const [scope, termId] of [[ids.physical, "old"], [next, "new"], [ids.root, "common"], [ids.child, "local"]]) {
    const draft = createDiplomacyDraft("agreement", "Rights treaty", [{ type: "domain", uuid: domainUuid }, { type: "narrative", id: "guild" }], "public");
    unwrap(await gm.diplomacy.agreements.create({ ...draft, reason: "Create rights treaty" }));
    let revision = 0;
    const modify = async (action: unknown) => { const result = await gm.diplomacy.agreements.modify({ id: draft.id, expectedRevision: revision, action, reason: "GM decision" });
      if (result.ok) revision = (result.value as any).revision; return result; };
    unwrap(await modify({ kind: "propose", proposalId: "offer", partyId: "party-0", terms: [rightTerm(scope, termId, conditional && ["old", "new"].includes(termId) ? { conditionRefs: [{ type: "requirement", id: "permit" }] } : {})], duration: { startsAtWorldTick: null, expiresAtWorldTick: 100 }, proposalExpiresAtWorldTick: null }));
    unwrap(await modify({ kind: "accept", proposalId: "offer", expectedProposalRevision: 0, partyId: "party-0" }));
    unwrap(await modify({ kind: "accept", proposalId: "offer", expectedProposalRevision: 1, partyId: "party-1" }));
    const treaty = { id: draft.id, modify, activate: () => modify({ kind: "activate", proposalId: "offer", expectedProposalRevision: 2, amendmentId: "activation" }) };
    unwrap(await treaty.activate()); treaties.push(treaty);
  }
  const input = { id: ids.child, expectedRevision: 0, reason: "Move rights ancestry", action: { kind: "reparent", parents: { locatedInUuid: next, administrativeParentUuid: ids.administrative } } };
  return { ...ids, next, physicalChild, adminChild, treaties, input };
}
test("G6 rights impact runtime: GM preview includes Territory and Agreement provenance for each physical descendant", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const w = await rightImpactWorld(gm), before = await f.adapter.loadAll(), p: any = unwrap(await gm.diplomacy.previewTerritory(w.input));
    const axis = p.rightInheritanceImpact.axes[0]; assert.deepEqual(axis.territories.map((r: any) => r.territoryUuid), [w.child, w.physicalChild]);
    const target = axis.territories[0]; assert.equal(target.localCount, 3); assert.equal(target.removed.length, 4); assert.equal(target.added.length, 2); assert.equal(target.retained.length, 2);
    assert.ok(target.removed.some((r: any) => r.origin.id === w.treaties[0].id && r.rightId === "old")); assert.ok(target.added.some((r: any) => r.origin.id === w.treaties[1].id));
    assert.ok(target.retained.some((r: any) => r.origin.id === w.treaties[2].id)); assert.ok(target.removed.some((r: any) => r.rightId === "secret-right-marker"));
    assert.ok(target.added.every((r: any) => r.grants.length === 0)); assert.equal(p.rightInheritanceImpact.axes[1].changed, false); assert.deepEqual(p.rightInheritanceImpact.axes[1].territories, []);
    assert.equal(p.changes.length, 1); assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { gm.destroy(); }
});
test("G6 rights impact runtime: confirmation changes only primary hierarchy and inspector matches inherited preview", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const w = await rightImpactWorld(gm), p: any = unwrap(await gm.diplomacy.previewTerritory(w.input)), before = await f.adapter.loadAll(), ledgerBefore = await f.ledger.loadSnapshot();
    unwrap(await gm.diplomacy.territory.modify({ ...w.input, previewSnapshot: p.previewSnapshot }));
    const key = (r: any) => JSON.stringify([r.origin.kind, r.origin.id, r.sourceTerritoryUuid, r.rightId]);
    for (const t of p.rightInheritanceImpact.axes[0].territories) {
      const d: any = unwrap(await gm.diplomacy.territory.query({ id: t.territoryUuid }));
      assert.deepEqual(d.territoryRights.entries.filter((r: any) => r.inherited && r.status === "effective").map(key).sort(), t.after.map(key).sort());
      const original: any = before.find(e => e.kind === "territory" && e.id === t.territoryUuid); assert.deepEqual(d.rights, original.data.rights);
    }
    const after = await f.adapter.loadAll(); for (const original of before) if (original.id !== w.child) assert.deepEqual(after.find(e => e.id === original.id && e.kind === original.kind), original);
    const d: any = unwrap(await gm.diplomacy.territory.query({ id: w.child })); assert.equal(d.revision, 1); assert.equal(d.territory.hierarchyHistory.length, 1); assert.equal(d.territory.locatedInUuid, w.next); assert.equal(d.rights.length, 2);
    assert.deepEqual(await f.ledger.loadSnapshot(), ledgerBefore);
  } finally { gm.destroy(); }
});
test("G6 rights impact runtime: Player and third party cannot preview or forge GM metadata", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player"), stranger = f.make("stranger");
  try { await gm.initialize(); const w = await rightImpactWorld(gm), before = await f.adapter.loadAll();
    for (const r of [player, stranger]) {
      assert.equal((await r.diplomacy.previewTerritory(w.input)).ok, false);
      const receipt = unwrap(await r.commandBus.execute(command("territory:preview", { ...w.input, isGm: true, senderUserId: "gm" })));
      assert.equal(receipt.status, "rejected"); assert.equal(JSON.stringify(receipt).includes(w.treaties[0].id), false);
      assert.equal(JSON.stringify(receipt).includes("secret-right-marker"), false);
    }
    assert.deepEqual(await f.adapter.loadAll(), before);
  } finally { stranger.destroy(); player.destroy(); gm.destroy(); }
});
test("G6 rights impact runtime: source revocation invalidates reviewed rights with primary revision unchanged", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const w = await rightImpactWorld(gm), p: any = unwrap(await gm.diplomacy.previewTerritory(w.input));
    unwrap(await gm.diplomacy.territory.modify({ id: w.physical, expectedRevision: 0, action: { kind: "revoke-right", id: "same" }, reason: "Revoke ancestor" }));
    const before = await f.adapter.loadAll(), result = await gm.diplomacy.territory.modify({ ...w.input, previewSnapshot: p.previewSnapshot });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_PREVIEW_STALE"); assert.deepEqual(await f.adapter.loadAll(), before);
    const current: any = unwrap(await gm.diplomacy.previewTerritory(w.input)); assert.equal(current.rightInheritanceImpact.axes[0].territories[0].removed.some((r: any) => r.origin.id === w.physical && r.rightId === "same"), false);
  } finally { gm.destroy(); }
});
test("G6 rights impact runtime: treaty suspension invalidates confirmation and fresh preview excludes its rights", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const w = await rightImpactWorld(gm), p: any = unwrap(await gm.diplomacy.previewTerritory(w.input)); unwrap(await w.treaties[1].modify({ kind: "suspend" }));
    const before = await f.adapter.loadAll(), result = await gm.diplomacy.territory.modify({ ...w.input, previewSnapshot: p.previewSnapshot }); assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_PREVIEW_STALE"); assert.deepEqual(await f.adapter.loadAll(), before);
    const fresh: any = unwrap(await gm.diplomacy.previewTerritory(w.input)); assert.equal(fresh.rightInheritanceImpact.axes[0].territories[0].added.some((r: any) => r.origin.id === w.treaties[1].id), false);
  } finally { gm.destroy(); }
});
test("G6 rights impact runtime: condition changes in either direction invalidate snapshot without source or clock drift", async () => {
  for (const initial of [true, false]) {
    let satisfied = initial, calls = 0; const f = fixture(undefined, undefined, () => { calls++; return satisfied; }), gm = f.make();
    try { await gm.initialize(); const w = await rightImpactWorld(gm, true); calls = 0;
      const p: any = unwrap(await gm.diplomacy.previewTerritory(w.input)); assert.equal(calls, 1); satisfied = !initial; calls = 0;
      const before = await f.adapter.loadAll(), result = await gm.diplomacy.territory.modify({ ...w.input, previewSnapshot: p.previewSnapshot });
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_PREVIEW_STALE"); assert.equal(calls, 1); assert.deepEqual(await f.adapter.loadAll(), before);
      const fresh: any = unwrap(await gm.diplomacy.previewTerritory(w.input)); assert.equal(fresh.rightInheritanceImpact.axes[0].territories[0].added.some((r: any) => r.origin.id === w.treaties[1].id), !initial);
    } finally { gm.destroy(); }
  }
});
test("G6 rights impact runtime: clock boundary and missing condition provider affect rights but never grants or source writes", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const w = await rightImpactWorld(gm, true), row: any = await f.adapter.read("territory", w.next); row.data.rights[0].expiresAtWorldTick = 11; await f.adapter.write(row);
    const p: any = unwrap(await gm.diplomacy.previewTerritory(w.input)); assert.equal(p.rightInheritanceImpact.axes[0].territories[0].added.length, 1); f.time.tick = 11;
    const before = await f.adapter.loadAll(); assert.equal((await gm.diplomacy.territory.modify({ ...w.input, previewSnapshot: p.previewSnapshot })).ok, false); assert.deepEqual(await f.adapter.loadAll(), before);
    const fresh: any = unwrap(await gm.diplomacy.previewTerritory(w.input)); assert.equal(fresh.rightInheritanceImpact.axes[0].territories[0].added.length, 0);
  } finally { gm.destroy(); }
});
test("G6 rights impact runtime: fresh agreement payload, visibility and external additions invalidate stale catalog snapshot", async () => {
  for (const mode of ["payload", "visibility", "addition"]) {
    const f = fixture(), gm = f.make();
    try { await gm.initialize(); const w = await rightImpactWorld(gm), p: any = unwrap(await gm.diplomacy.previewTerritory(w.input)), row: any = await f.adapter.read("agreement", w.treaties[1].id);
      if (mode === "payload") row.data.state.agreement.terms[0].payload.grants = ["test:changed"];
      if (mode === "visibility") row.data.state.agreement.terms[0].visibility = "secret";
      if (mode === "addition") { row.id = "external-right-impact-treaty"; row.data.state.agreement.id = row.id; }
      await f.adapter.write(row); const before = await f.adapter.loadAll(), result = await gm.diplomacy.territory.modify({ ...w.input, previewSnapshot: p.previewSnapshot });
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "DM_TERRITORY_PREVIEW_STALE"); assert.deepEqual(await f.adapter.loadAll(), before);
      const fresh: any = unwrap(await gm.diplomacy.previewTerritory(w.input)); if (mode === "addition") assert.ok(fresh.rightInheritanceImpact.axes[0].territories[0].added.some((r: any) => r.origin.id === row.id));
    } finally { gm.destroy(); }
  }
});
test("G6 rights impact runtime: fenced, missing, corrupt or incoherent Agreement blocks incomplete review and confirmation", async () => {
  for (const mode of ["missing", "corrupt", "identity", "revision", "fence"]) {
    const f = fixture(), gm = f.make();
    try { await gm.initialize(); const w = await rightImpactWorld(gm), p: any = unwrap(await gm.diplomacy.previewTerritory(w.input));
      if (mode === "missing") await f.adapter.remove("agreement", w.treaties[0].id);
      else if (mode === "fence") { const { lockKey } = await import("../../src/mutations/lock-keys.js"); gm.recovery.fenceRegistry.installFence({ transactionId: "right-impact-fence", lockKeys: [lockKey.diplomacy("agreement", w.treaties[0].id)], reason: "Needs recovery" }); }
      else { const row: any = await f.adapter.read("agreement", w.treaties[0].id); if (mode === "corrupt") row.data.state.agreement.terms[0].payload.conditionRefs = 1;
        if (mode === "identity") row.data.state.agreement.id = "wrong"; if (mode === "revision") row.data.state.agreement.revision += 1; await f.adapter.write(row); }
      const before = await f.adapter.loadAll(); assert.equal((await gm.diplomacy.territory.modify({ ...w.input, previewSnapshot: p.previewSnapshot })).ok, false); assert.deepEqual(await f.adapter.loadAll(), before);
      if (mode !== "missing") assert.equal((await gm.diplomacy.previewTerritory(w.input)).ok, false);
    } finally { gm.destroy(); }
  }
});
test("G6 rights impact runtime: administrative-only changes and detach preserve independent physical derivation", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const w = await rightImpactWorld(gm), input = { ...w.input, action: { kind: "reparent", parents: { locatedInUuid: w.physical, administrativeParentUuid: null } } };
    const p: any = unwrap(await gm.diplomacy.previewTerritory(input)); assert.deepEqual(p.rightInheritanceImpact.axes[0].territories, []);
    assert.deepEqual(p.rightInheritanceImpact.axes[1].territories.map((r: any) => r.territoryUuid), [w.child, w.adminChild]);
    const physicalBefore = await rightsReport(gm, w.child); unwrap(await gm.diplomacy.territory.modify({ ...input, previewSnapshot: p.previewSnapshot }));
    assert.deepEqual((await rightsReport(gm, w.child)).entries.map((r: any) => [r.origin.id, r.rightId, r.inherited]), physicalBefore.entries.map((r: any) => [r.origin.id, r.rightId, r.inherited]));
  } finally { gm.destroy(); }
});
test("G6 rights impact runtime: pending amendments invalidate the snapshot without replacing current rights", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const w = await rightImpactWorld(gm), p: any = unwrap(await gm.diplomacy.previewTerritory(w.input));
    unwrap(await w.treaties[1].modify({ kind: "amend", proposalId: "pending-impact", partyId: "party-0", terms: [rightTerm(w.next, "not-active")], duration: { startsAtWorldTick: null, expiresAtWorldTick: 100 }, proposalExpiresAtWorldTick: null }));
    assert.equal((await gm.diplomacy.territory.modify({ ...w.input, previewSnapshot: p.previewSnapshot })).ok, false);
    const fresh: any = unwrap(await gm.diplomacy.previewTerritory(w.input)); assert.equal(fresh.rightInheritanceImpact.axes[0].territories[0].added.some((r: any) => r.rightId === "not-active"), false);
    assert.equal(fresh.rightInheritanceImpact.axes[0].territories[0].added.some((r: any) => r.rightId === "new"), true);
  } finally { gm.destroy(); }
});
test("G6 rights impact runtime: exact command retry after reload does not recompute or write another hierarchy event", async () => {
  let conditions = true; const f = fixture(undefined, undefined, () => conditions), first = f.make(); let ticket: any, child: string;
  try { await first.initialize(); const w = await rightImpactWorld(first, true), p: any = unwrap(await first.diplomacy.previewTerritory(w.input)); child = w.child;
    ticket = unwrap(first.diplomacy.commands.prepare("territory:modify", { ...w.input, previewSnapshot: p.previewSnapshot })); unwrap(await first.diplomacy.commands.execute(ticket));
  } finally { first.destroy(); }
  conditions = false; const reload = f.make();
  try { await reload.initialize(); const before = await f.adapter.loadAll(); assert.equal(unwrap(await reload.diplomacy.commands.retry(ticket)).status, "executed"); assert.deepEqual(await f.adapter.loadAll(), before);
    const d: any = unwrap(await reload.diplomacy.territory.query({ id: child! })); assert.equal(d.revision, 1); assert.equal(d.territory.hierarchyHistory.length, 1);
  } finally { reload.destroy(); }
});
test("G6 rights impact runtime: UI renders both reviews and confirms with the same bounded snapshot", async () => {
  const f = fixture(), gm = f.make();
  try { await gm.initialize(); const w = await rightImpactWorld(gm), c = new DiplomacyApplicationController(gm.diplomacy); c.selectTab("territory"); c.select(w.child); unwrap(await c.load());
    const fields = { kind: "reparent", physical: w.next, administrative: w.administrative, reason: w.input.reason }; unwrap(await c.change(fields, true));
    const html = c.actionForm(); assert.ok(html.includes("Impactos nos direitos herdados")); assert.ok(html.includes(w.treaties[0].id)); assert.ok(html.includes("Prévia da hierarquia"));
    const snapshot = c.preview.previewSnapshot; assert.equal(html.includes(snapshot.fingerprint), false); unwrap(await c.change(fields)); assert.equal(c.preview, null); unwrap(await c.load()); assert.equal(c.detail.revision, 1);
  } finally { gm.destroy(); }
});
test("G6 rights impact runtime: ordinary Player hierarchy proposal remains immutable and requires GM decision", async () => {
  const f = fixture(), gm = f.make(), player = f.make("player");
  try { await gm.initialize(); const w = await rightImpactWorld(gm), before: any = await f.adapter.read("territory", w.child);
    unwrap(await player.diplomacy.proposals.submit({ id: "right-impact-request", intent: { kind: "territory", mode: "modify", ...w.input } }));
    const proposal: any = unwrap(await player.diplomacy.proposals.query({ id: "right-impact-request" })); assert.equal(proposal.lifecycle, "pending"); assert.equal(proposal.original.previewSnapshot, undefined);
    assert.deepEqual(await f.adapter.read("territory", w.child), before); assert.equal(JSON.stringify(proposal).includes("secret-right-marker"), false);
    unwrap(await gm.diplomacy.proposals.decide({ id: proposal.id, expectedRevision: 0, decision: "approve", reason: "GM reviewed" }));
    assert.equal((unwrap(await gm.diplomacy.territory.query({ id: w.child })) as any).revision, 1);
  } finally { player.destroy(); gm.destroy(); }
});
test("G6 rights impact runtime: Agreement writers wait until reviewed reparent commits under the shared catalog lock", { timeout: 5000 }, async () => {
  let reached!: () => void, release!: () => void;
  const paused = new Promise<void>(resolve => reached = resolve), gate = new Promise<void>(resolve => release = resolve);
  class PausedRead extends InMemoryDiplomacyStorageAdapter {
    pauseId: string | null = null;
    override async read(kind: import("../../src/diplomacy/diplomacy-store.js").DiplomacyKind, id: string) {
      if (kind === "territory" && id === this.pauseId) { this.pauseId = null; reached(); await gate; }
      return super.read(kind, id);
    }
  }
  const adapter = new PausedRead(), f = fixture(adapter), gm = f.make();
  try { await gm.initialize(); const w = await rightImpactWorld(gm), p: any = unwrap(await gm.diplomacy.previewTerritory(w.input)); adapter.pauseId = w.child;
    const confirmation = gm.diplomacy.territory.modify({ ...w.input, previewSnapshot: p.previewSnapshot }); await paused;
    let agreementFinished = false; const suspension = w.treaties[1].modify({ kind: "suspend" }).then(r => { agreementFinished = true; return r; });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(agreementFinished, false); release();
    unwrap(await confirmation); unwrap(await suspension);
    assert.equal((unwrap(await gm.diplomacy.territory.query({ id: w.child })) as any).revision, 1);
    const source = (await rightsReport(gm, w.child)).entries.find((r: any) => r.origin.id === w.treaties[1].id); assert.equal(source.status, "source-inactive");
  } finally { release(); gm.destroy(); }
});
