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
});
