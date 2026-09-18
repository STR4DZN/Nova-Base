import test from "node:test";
import assert from "node:assert/strict";
import { composeDomainManagerRuntime } from "../../src/bootstrap/domain-manager-runtime.js";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { InMemoryLedgerStorageAdapter } from "../../src/economy/storage/ledger-storage-adapter.js";
import { InMemoryReservationStorageAdapter } from "../../src/economy/storage/reservation-storage-adapter.js";
import { InMemoryTransactionStorageAdapter } from "../../src/mutations/transaction-storage-adapter.js";

const testRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Isolation Test Domain", description: "" },
    classification: { kind: "base", scale: "small", tags: [] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function createMockAuthority() {
  const users = [{ id: "user-1", isGM: true, active: true }];
  return {
    service: {
      isCurrentUser: () => true,
      getStatus: () => ({
        authorityUserId: "user-1",
        isPrimaryAuthority: true,
        authorityEpoch: 1,
        mode: "elected",
        available: true
      }),
      resolve: async () => ({
        authorityUserId: "user-1",
        isPrimaryAuthority: true,
        authorityEpoch: 1,
        mode: "elected",
        available: true
      }),
      getUsers: () => users,
      getCurrentUserId: () => "user-1"
    }
  };
}

function createMockTransport() {
  return {
    send: async () => ({ ok: true }),
    registerInboundHandler: () => () => {},
    onReceive: () => () => {},
    isAvailable: () => true,
    destroy: () => {}
  };
}

test("G4-AUD-004: Public module API isolates internal stores and protects against bypass", async () => {
  let docFlags: Record<string, unknown> = {
    "domain-manager": JSON.parse(JSON.stringify(testRecord))
  };

  const doc: IdentifiedJournalEntryDocumentLike = {
    id: "dom-iso-1",
    uuid: "JournalEntry.dom-iso-1",
    get name() { return "Isolation Test"; },
    get flags() { return docFlags; },
    get ownership() { return { default: 3 }; },
    update: async (data: Record<string, unknown>) => {
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        docFlags = { ...docFlags, "domain-manager": payload };
      }
    }
  };

  const store: DomainDocumentStore = {
    get: (idOrUuid: string) => (idOrUuid.includes("dom-iso-1") ? doc : undefined),
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: store as any,
    authority: createMockAuthority() as any,
    transport: createMockTransport() as any,
    ledgerStorageAdapter: new InMemoryLedgerStorageAdapter(),
    reservationStorageAdapter: new InMemoryReservationStorageAdapter(),
    transactionStorageAdapter: new InMemoryTransactionStorageAdapter()
  });

  await runtime.initialize();

  const publicApi = runtime.publicApi;

  // 1. Check top-level contract of publicApi
  assert.ok(publicApi.version);
  assert.ok(publicApi.domains);
  assert.ok(publicApi.economy);
  assert.ok(publicApi.diagnostics);

  // 2. Ensure internal stores are NOT exposed on publicApi
  assert.equal((publicApi as any).ledgerStore, undefined, "ledgerStore must not be exposed on publicApi");
  assert.equal((publicApi as any).reservationStore, undefined, "reservationStore must not be exposed on publicApi");
  assert.equal((publicApi as any).transactionStore, undefined, "transactionStore must not be exposed on publicApi");
  assert.equal((publicApi as any).lockManager, undefined, "lockManager must not be exposed on publicApi");
  assert.equal((publicApi as any).recovery, undefined, "recoveryService must not be exposed on publicApi");

  // 3. Ensure internal mutation methods are NOT exposed on publicApi.economy
  const economyApi = publicApi.economy;
  assert.equal((economyApi as any).commitTransfer, undefined, "commitTransfer must not be directly callable on publicApi.economy");
  assert.equal((economyApi as any).commitConvert, undefined, "commitConvert must not be directly callable on publicApi.economy");
  assert.equal((economyApi as any).commitAdjust, undefined, "commitAdjust must not be directly callable on publicApi.economy");
  assert.equal((economyApi as any).ledgerStore, undefined, "ledgerStore must not be exposed on publicApi.economy");
  assert.equal((economyApi as any).reservationStore, undefined, "reservationStore must not be exposed on publicApi.economy");

  // 4. Ensure queryLedger on publicApi returns paged results
  const pagedRes = await economyApi.queryLedger({ domainUuid: doc.uuid });
  assert.equal(pagedRes.ok, true);
  assert.equal(Array.isArray(pagedRes.value.entries), true);
  assert.equal(typeof pagedRes.value.totalCount, "number");
  assert.equal(typeof pagedRes.value.hasMore, "boolean");

  // 5. G4-REVAL4-002: Ensure mutable threshold bypass is eliminated from PublicEconomyApi
  assert.equal(
    (economyApi as any).registerThreshold,
    undefined,
    "registerThreshold mutable bypass must NOT exist on PublicEconomyApi"
  );
  assert.equal(
    (economyApi as any).thresholds,
    undefined,
    "direct thresholds getter must NOT exist on PublicEconomyApi"
  );
  assert.equal(
    typeof economyApi.setThreshold,
    "function",
    "setThreshold must be exposed as a secure CommandBus dispatcher"
  );
});

test("G4-REVAL4-003: PublicEconomyApi.queryLedger hides secret resources from totalCount and entries for non-GM viewers", async () => {
  const testRecordWithSecret: DomainRecord = {
    schemaVersion: 1,
    revision: 0,
    definition: {
      identity: { aliases: [], summary: "Secret Test Domain", description: "" },
      classification: { kind: "base", scale: "small", tags: [] },
      hierarchy: { parentDomainUuid: null },
      capabilities: {
        enabled: ["domain-manager:domain", "domain-manager:economy"],
        config: {
          "domain-manager:economy": {
            schemaVersion: 1,
            accounts: [
              { mode: "native", domainUuid: "JournalEntry.dom-sec-ledger", resourceId: "domain-manager:treasury", balanceMinor: 1000, baseCapacityMinor: 5000, visibility: "public" },
              { mode: "native", domainUuid: "JournalEntry.dom-sec-ledger", resourceId: "domain-manager:materials", balanceMinor: 500, baseCapacityMinor: 5000, visibility: "secret" }
            ]
          }
        }
      }
    },
    state: { lifecycle: "active" },
    metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
  };

  let docFlags: Record<string, unknown> = {
    "domain-manager": JSON.parse(JSON.stringify(testRecordWithSecret))
  };

  const doc: IdentifiedJournalEntryDocumentLike = {
    id: "dom-sec-ledger",
    uuid: "JournalEntry.dom-sec-ledger",
    get name() { return "Secret Ledger Domain"; },
    get flags() { return docFlags; },
    get ownership() { return { default: 1 }; }, // observer
    update: async (data: Record<string, unknown>) => {
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        docFlags = { ...docFlags, "domain-manager": payload };
      }
    }
  };

  const store: DomainDocumentStore = {
    get: (idOrUuid: string) => (idOrUuid.includes("dom-sec-ledger") ? doc : undefined),
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  };

  const ledgerAdapter = new InMemoryLedgerStorageAdapter();
  const runtime = composeDomainManagerRuntime({
    domainStore: store as any,
    authority: createMockAuthority() as any,
    transport: createMockTransport() as any,
    ledgerStorageAdapter: ledgerAdapter,
    reservationStorageAdapter: new InMemoryReservationStorageAdapter(),
    transactionStorageAdapter: new InMemoryTransactionStorageAdapter()
  });

  await runtime.initialize();

  // Populate 3 public treasury entries and 7 secret materials entries
  for (let i = 1; i <= 3; i++) {
    runtime.ledgerStore.append({
      domainUuid: doc.uuid,
      resourceId: "domain-manager:treasury",
      deltaMinor: 100 * i,
      kind: "adjustment",
      source: { type: "manual" }
    });
  }
  for (let i = 1; i <= 7; i++) {
    runtime.ledgerStore.append({
      domainUuid: doc.uuid,
      resourceId: "domain-manager:materials",
      deltaMinor: 50 * i,
      kind: "adjustment",
      source: { type: "manual" }
    });
  }

  // Non-GM query: should see ONLY the 3 treasury entries, totalCount must be 3
  const playerResult = await runtime.publicApi.economy.queryLedger(
    { domainUuid: doc.uuid },
    { isGm: false, userId: "player-guest" }
  );

  assert.equal(playerResult.ok, true);
  if (playerResult.ok) {
    assert.equal(playerResult.value.totalCount, 3, "Non-GM totalCount must only count public entries");
    assert.equal(playerResult.value.entries.length, 3);
    assert.equal(playerResult.value.hasMore, false);
    for (const entry of playerResult.value.entries) {
      assert.equal(entry.resourceId, "domain-manager:treasury");
    }
  }

  // GM query: sees all 10 entries
  const gmResult = await runtime.publicApi.economy.queryLedger(
    { domainUuid: doc.uuid },
    { isGm: true, userId: "user-1" }
  );
  assert.equal(gmResult.ok, true);
  if (gmResult.ok) {
    assert.equal(gmResult.value.totalCount, 10, "GM totalCount must include all entries");
  }
});

test("G4-REVAL4-004: PublicEconomyApi transaction inspection (getTransaction and listTransactions) enforces access control", async () => {
  let docFlags: Record<string, unknown> = {
    "domain-manager": JSON.parse(JSON.stringify(testRecord))
  };

  const doc: IdentifiedJournalEntryDocumentLike = {
    id: "dom-tx-test",
    uuid: "JournalEntry.dom-tx-test",
    get name() { return "Tx Test Domain"; },
    get flags() { return docFlags; },
    get ownership() { return { default: 0 }; }, // no access for default
    update: async () => {}
  };

  const store: DomainDocumentStore = {
    get: (idOrUuid: string) => (idOrUuid.includes("dom-tx-test") ? doc : undefined),
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: store as any,
    authority: createMockAuthority() as any,
    transport: createMockTransport() as any,
    ledgerStorageAdapter: new InMemoryLedgerStorageAdapter(),
    reservationStorageAdapter: new InMemoryReservationStorageAdapter(),
    transactionStorageAdapter: new InMemoryTransactionStorageAdapter()
  });

  await runtime.initialize();

  const { createTransactionRecord } = await import("../../src/mutations/transaction-record.js");
  const tx = createTransactionRecord({
    transactionId: "tx-test-inspect-1",
    commandId: "cmd-tx-1" as any,
    authorityEpoch: 1,
    lockKeys: [doc.uuid],
    recoveryData: {
      type: "economy:provider-adjust",
      domainUuid: doc.uuid,
      resourceId: "domain-manager:treasury",
      deltaMinor: 500
    }
  });

  runtime.transactionStore.save(tx);
  runtime.transactionStore.transition(tx.transactionId, "claimed", 1);
  runtime.transactionStore.transition(tx.transactionId, "prepared", 1);
  runtime.transactionStore.transition(tx.transactionId, "committing", 1);
  runtime.transactionStore.transition(tx.transactionId, "committed", 1);

  // 1. GM viewer can get transaction
  const gmTxRes = await runtime.publicApi.economy.getTransaction(tx.transactionId, { isGm: true });
  assert.equal(gmTxRes.ok, true);
  if (gmTxRes.ok) {
    assert.equal(gmTxRes.value.transactionId, "tx-test-inspect-1");
    assert.equal(gmTxRes.value.state, "committed");
    assert.ok(gmTxRes.value.lockKeys.includes(doc.uuid));
  }

  // 2. Non-GM viewer without domain access is rejected with DM_SECURITY_PERMISSION_DENIED
  const playerTxRes = await runtime.publicApi.economy.getTransaction(tx.transactionId, { isGm: false, userId: "player-stranger" });
  assert.equal(playerTxRes.ok, false);
  if (!playerTxRes.ok) {
    assert.equal(playerTxRes.error.code, "DM_SECURITY_PERMISSION_DENIED");
  }

  // 3. GM lists transactions for domain
  const listRes = await runtime.publicApi.economy.listTransactions({ domainUuid: doc.uuid }, { isGm: true });
  assert.equal(listRes.ok, true);
  if (listRes.ok) {
    assert.equal(listRes.value.length, 1);
    assert.equal(listRes.value[0].transactionId, "tx-test-inspect-1");
  }
});

test("G4-REVAL5-003: PublicEconomyApi and EconomyPresenter sanitize transactions for non-GM viewers (secret resources, cross-domain locks, failure reasons)", async () => {
  const docAFlags: Record<string, unknown> = {
    "domain-manager": {
      schemaVersion: 1,
      revision: 0,
      definition: {
        identity: { aliases: [], summary: "Domain A", description: "" },
        classification: { kind: "base", scale: "small", tags: [] },
        hierarchy: { parentDomainUuid: null },
        capabilities: {
          enabled: ["domain-manager:domain", "domain-manager:economy"],
          config: {
            "domain-manager:economy": {
              schemaVersion: 1,
              accounts: [
                {
                  mode: "native",
                  domainUuid: "JournalEntry.dom-sec-a",
                  resourceId: "domain-manager:treasury",
                  balanceMinor: 1000,
                  baseCapacityMinor: 10000,
                  visibility: "public"
                },
                {
                  mode: "native",
                  domainUuid: "JournalEntry.dom-sec-a",
                  resourceId: "domain-manager:materials",
                  balanceMinor: 500,
                  baseCapacityMinor: 10000,
                  visibility: "secret"
                }
              ]
            }
          }
        }
      },
      state: { lifecycle: "active" },
      metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
    }
  };

  const docBFlags: Record<string, unknown> = {
    "domain-manager": {
      schemaVersion: 1,
      revision: 0,
      definition: {
        identity: { aliases: [], summary: "Domain B", description: "" },
        classification: { kind: "base", scale: "small", tags: [] },
        hierarchy: { parentDomainUuid: null },
        capabilities: {
          enabled: ["domain-manager:domain", "domain-manager:economy"],
          config: {
            "domain-manager:economy": {
              schemaVersion: 1,
              accounts: [
                {
                  mode: "native",
                  domainUuid: "JournalEntry.dom-sec-b",
                  resourceId: "domain-manager:treasury",
                  balanceMinor: 2000,
                  baseCapacityMinor: 10000,
                  visibility: "public"
                }
              ]
            }
          }
        }
      },
      state: { lifecycle: "active" },
      metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
    }
  };

  const docA: IdentifiedJournalEntryDocumentLike = {
    id: "dom-sec-a",
    uuid: "JournalEntry.dom-sec-a",
    get name() { return "Domain A"; },
    get flags() { return docAFlags; },
    get ownership() { return { default: 2, "player-1": 3 }; }, // player-1 has access
    update: async () => {}
  };

  const docB: IdentifiedJournalEntryDocumentLike = {
    id: "dom-sec-b",
    uuid: "JournalEntry.dom-sec-b",
    get name() { return "Domain B"; },
    get flags() { return docBFlags; },
    get ownership() { return { default: 0 }; }, // player-1 has NO access to Domain B
    update: async () => {}
  };

  const store: DomainDocumentStore = {
    get: (idOrUuid: string) => {
      if (idOrUuid.includes("dom-sec-a")) return docA;
      if (idOrUuid.includes("dom-sec-b")) return docB;
      return undefined;
    },
    list: () => [docA, docB],
    create: async () => { throw new Error("not used"); }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: store as any,
    authority: createMockAuthority() as any,
    transport: createMockTransport() as any,
    ledgerStorageAdapter: new InMemoryLedgerStorageAdapter(),
    reservationStorageAdapter: new InMemoryReservationStorageAdapter(),
    transactionStorageAdapter: new InMemoryTransactionStorageAdapter()
  });

  await runtime.initialize();

  const { createTransactionRecord } = await import("../../src/mutations/transaction-record.js");

  // 1. Transaction involving public treasury in Domain A
  const txPublic = createTransactionRecord({
    transactionId: "tx-proj-public",
    commandId: "cmd-p-1" as any,
    authorityEpoch: 1,
    lockKeys: [docA.uuid],
    recoveryData: {
      type: "economy:provider-adjust",
      domainUuid: docA.uuid,
      resourceId: "domain-manager:treasury",
      deltaMinor: 100
    }
  });

  // 2. Transaction involving secret materials in Domain A
  const txSecret = createTransactionRecord({
    transactionId: "tx-proj-secret",
    commandId: "cmd-s-1" as any,
    authorityEpoch: 1,
    lockKeys: [docA.uuid],
    recoveryData: {
      type: "economy:provider-adjust",
      domainUuid: docA.uuid,
      resourceId: "domain-manager:materials",
      deltaMinor: 50
    }
  });

  // 3. Cross-domain transfer between Domain A and Domain B that failed with internal reason
  const txTransfer = createTransactionRecord({
    transactionId: "tx-proj-transfer",
    commandId: "cmd-t-1" as any,
    authorityEpoch: 1,
    lockKeys: [docA.uuid, docB.uuid, "system:internal-lock"],
    recoveryData: {
      type: "economy:transfer",
      sourceDomainUuid: docA.uuid,
      targetDomainUuid: docB.uuid,
      fromResourceId: "domain-manager:treasury",
      toResourceId: "domain-manager:treasury",
      amountMinor: 200
    }
  });

  runtime.transactionStore.save(txPublic);
  runtime.transactionStore.transition(txPublic.transactionId, "claimed", 1);
  runtime.transactionStore.transition(txPublic.transactionId, "prepared", 1);
  runtime.transactionStore.transition(txPublic.transactionId, "committing", 1);
  runtime.transactionStore.transition(txPublic.transactionId, "committed", 1);

  runtime.transactionStore.save(txSecret);
  runtime.transactionStore.transition(txSecret.transactionId, "claimed", 1);
  runtime.transactionStore.transition(txSecret.transactionId, "prepared", 1);
  runtime.transactionStore.transition(txSecret.transactionId, "committing", 1);
  runtime.transactionStore.transition(txSecret.transactionId, "committed", 1);

  runtime.transactionStore.save(txTransfer);
  runtime.transactionStore.transition(txTransfer.transactionId, "claimed", 1);
  runtime.transactionStore.transition(txTransfer.transactionId, "prepared", 1);
  runtime.transactionStore.transition(txTransfer.transactionId, "failed", 1, "Internal deadlock on DB cluster node 4");

  const playerContext = { isGm: false, userId: "player-1" };
  const gmContext = { isGm: true, userId: "user-1" };

  // Verification 1: listTransactions for player omits secret-resource transaction
  const playerListRes = await runtime.publicApi.economy.listTransactions({ domainUuid: docA.uuid }, playerContext);
  assert.equal(playerListRes.ok, true);
  if (playerListRes.ok) {
    const ids = playerListRes.value.map(t => t.transactionId);
    assert.ok(ids.includes("tx-proj-public"), "Public transaction must be visible to player");
    assert.ok(!ids.includes("tx-proj-secret"), "Secret resource transaction must be hidden from player");
    assert.ok(ids.includes("tx-proj-transfer"), "Transfer involving player domain must be visible");
  }

  // Verification 2: getTransaction on secret-resource transaction returns DM_SECURITY_PERMISSION_DENIED for player
  const playerSecretRes = await runtime.publicApi.economy.getTransaction("tx-proj-secret", playerContext);
  assert.equal(playerSecretRes.ok, false);
  if (!playerSecretRes.ok) {
    assert.equal(playerSecretRes.error.code, "DM_SECURITY_PERMISSION_DENIED");
  }

  // GM can access secret transaction
  const gmSecretRes = await runtime.publicApi.economy.getTransaction("tx-proj-secret", gmContext);
  assert.equal(gmSecretRes.ok, true);

  // Verification 3: Cross-domain transfer sanitizes remote domain lockKeys and failureReason for player
  const playerTransferRes = await runtime.publicApi.economy.getTransaction("tx-proj-transfer", playerContext);
  assert.equal(playerTransferRes.ok, true);
  if (playerTransferRes.ok) {
    // Only docA.uuid should be in lockKeys
    assert.ok(playerTransferRes.value.lockKeys.includes(docA.uuid), "Authorized domain lock key should remain");
    assert.ok(!playerTransferRes.value.lockKeys.includes(docB.uuid), "Unauthorized remote domain lock key must be sanitized");
    assert.ok(!playerTransferRes.value.lockKeys.includes("system:internal-lock"), "Internal system lock key must be sanitized");
    // failureReason masked
    assert.equal(playerTransferRes.value.failureReason, "Transaction failed", "Internal failure details must be sanitized for non-GM");
  }

  // GM sees full failureReason and all lockKeys
  const gmTransferRes = await runtime.publicApi.economy.getTransaction("tx-proj-transfer", gmContext);
  assert.equal(gmTransferRes.ok, true);
  if (gmTransferRes.ok) {
    assert.ok(gmTransferRes.value.lockKeys.includes(docB.uuid));
    assert.equal(gmTransferRes.value.failureReason, "Internal deadlock on DB cluster node 4");
  }

  // Verification 4: EconomyPresenter viewModel applies same filtering
  const { buildEconomyViewModel } = await import("../../src/ui/domain-patterns/economy/economy-presenter.js");
  const { createDefaultResourceRegistry } = await import("../../src/economy/definitions/resource-registry.js");

  const playerVm = buildEconomyViewModel(docA, {
    viewer: playerContext,
    resourceRegistry: createDefaultResourceRegistry(),
    transactionStore: runtime.transactionStore
  });
  const vmTxIds = playerVm.transactions.map(t => t.transactionId);
  assert.ok(vmTxIds.includes("tx-proj-public"));
  assert.ok(!vmTxIds.includes("tx-proj-secret"), "Presenter must omit secret-resource transactions for player");
  const vmTransfer = playerVm.transactions.find(t => t.transactionId === "tx-proj-transfer");
  assert.ok(vmTransfer);
  if (vmTransfer) {
    assert.equal(vmTransfer.failureReason, "Transaction failed");
    assert.ok(!vmTransfer.lockKeys.includes(docB.uuid));
  }
});



