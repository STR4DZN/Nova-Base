import test from "node:test";
import assert from "node:assert/strict";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import {
  ResourceDefinitionRegistry,
  createDefaultResourceRegistry
} from "../../src/economy/definitions/resource-registry.js";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";
import { ReservationStore } from "../../src/economy/reservations/reservation-store.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { EconomyService } from "../../src/economy/services/economy-service.js";

const defaultRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Concurrency Test Domain", description: "Testing" },
    classification: { kind: "base", scale: "small", tags: ["economy"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function document(
  id: string,
  name: string,
  value = defaultRecord,
  ownership: Record<string, number | string> = {}
): IdentifiedJournalEntryDocumentLike {
  let currentName = name;
  let currentFlags: Readonly<Record<string, unknown>> = { "domain-manager": JSON.parse(JSON.stringify(value)) };
  let currentOwnership: Record<string, number | string> = { ...ownership };
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return currentName; },
    get flags() { return currentFlags; },
    get ownership() { return currentOwnership; },
    update: async (data: Record<string, unknown>) => {
      // Micro-delay to stress concurrency
      await new Promise((r) => setTimeout(r, 2));
      if (typeof data.name === "string") currentName = data.name;
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": payload };
      }
      if (data.ownership !== undefined) {
        currentOwnership = { ...(data.ownership as any) };
      }
    }
  };
}

function createStore(initialDocs: IdentifiedJournalEntryDocumentLike[] = []): DomainDocumentStore {
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  let nextId = 1;

  function registerDoc(doc: IdentifiedJournalEntryDocumentLike) {
    byKey.set(doc.id, doc);
    byKey.set(doc.uuid, doc);
  }

  for (const doc of initialDocs) {
    registerDoc(doc);
  }

  return {
    get: (idOrUuid) => {
      const clean = idOrUuid.startsWith("JournalEntry.")
        ? idOrUuid.slice("JournalEntry.".length)
        : idOrUuid;
      return byKey.get(idOrUuid) ?? byKey.get(clean);
    },
    list: () => [...new Set(byKey.values())],
    create: async (data) => {
      const id = `je-${nextId++}`;
      const doc = document(id, data.name, data.flags["domain-manager"] as any, (data.ownership ?? {}) as any);
      registerDoc(doc);
      return doc;
    }
  };
}

test("G4.10 Concurrency: 10 parallel cross-transfers between Domain A and B conserve mass and do not deadlock", async () => {
  const docA = document("dom-concur-a", "Domain Alpha");
  const docB = document("dom-concur-b", "Domain Beta");
  const store = createStore([docA, docB]);
  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  const initialA = 100_000;
  const initialB = 100_000;
  const totalInitial = initialA + initialB;

  // Initialize accounts
  await economyService.createAccount({
    domainUuid: docA.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: initialA
  });

  await economyService.createAccount({
    domainUuid: docB.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: initialB
  });

  // Prepare 10 transfers A -> B (500 each) and 10 transfers B -> A (300 each)
  const transferPromises: Promise<any>[] = [];

  for (let i = 0; i < 10; i++) {
    // A -> B
    transferPromises.push(
      economyService.commitTransfer({
        sourceDomainUuid: docA.uuid,
        targetDomainUuid: docB.uuid,
        resourceId: "domain-manager:treasury",
        amountMinor: 500,
        reason: `Parallel A->B transfer #${i + 1}`
      })
    );

    // B -> A
    transferPromises.push(
      economyService.commitTransfer({
        sourceDomainUuid: docB.uuid,
        targetDomainUuid: docA.uuid,
        resourceId: "domain-manager:treasury",
        amountMinor: 300,
        reason: `Parallel B->A transfer #${i + 1}`
      })
    );
  }

  // Execute all 20 transfers concurrently
  const results = await Promise.all(transferPromises);

  // Assert all succeeded without errors or deadlocks
  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    assert.equal(res.ok, true, `Transfer #${i} failed: ${res.ok ? "" : res.error.message}`);
  }

  // Verify balances
  const accARes = await economyService.getAccount(docA.uuid, "domain-manager:treasury");
  const accBRes = await economyService.getAccount(docB.uuid, "domain-manager:treasury");

  assert.equal(accARes.ok, true);
  assert.equal(accBRes.ok, true);

  const accA = accARes.value!;
  const accB = accBRes.value!;

  assert.equal(accA.mode, "native");
  assert.equal(accB.mode, "native");

  if (accA.mode === "native" && accB.mode === "native") {
    // 100000 - (10 * 500) + (10 * 300) = 100000 - 5000 + 3000 = 98000
    assert.equal(accA.balanceMinor, 98_000, `Expected A to have 98,000, got ${accA.balanceMinor}`);
    // 100000 + (10 * 500) - (10 * 300) = 100000 + 5000 - 3000 = 102000
    assert.equal(accB.balanceMinor, 102_000, `Expected B to have 102,000, got ${accB.balanceMinor}`);

    // Strict conservation of mass
    assert.equal(
      accA.balanceMinor + accB.balanceMinor,
      totalInitial,
      "Conservation of mass violated! Total balance must equal totalInitial"
    );
  }

  // Verify ledger entries: 2 initial + (20 transfers * 2 entries each = 40) = 42 entries
  const allEntries = ledgerStore.query();
  assert.equal(allEntries.length, 42, `Expected 42 ledger entries, got ${allEntries.length}`);

  // Verify ledger sequence monotonicity and no holes
  for (let seq = 1; seq <= 42; seq++) {
    const entry = allEntries.find((e) => e.sequence === seq);
    assert.ok(entry, `Ledger sequence #${seq} missing!`);
  }
});

test("G4.10 Concurrency: 3-domain cycle transfers (A->B, B->C, C->A) avoid deadlock via deterministic lock ordering", async () => {
  const docA = document("dom-tri-a", "Domain Tri Alpha");
  const docB = document("dom-tri-b", "Domain Tri Beta");
  const docC = document("dom-tri-c", "Domain Tri Gamma");
  const store = createStore([docA, docB, docC]);
  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  const initial = 50_000;
  await economyService.createAccount({ domainUuid: docA.uuid, resourceId: "domain-manager:treasury", initialBalanceMinor: initial });
  await economyService.createAccount({ domainUuid: docB.uuid, resourceId: "domain-manager:treasury", initialBalanceMinor: initial });
  await economyService.createAccount({ domainUuid: docC.uuid, resourceId: "domain-manager:treasury", initialBalanceMinor: initial });

  const totalInitial = initial * 3;

  // Fire concurrent cyclic transfers
  const promises: Promise<any>[] = [];
  for (let i = 0; i < 5; i++) {
    promises.push(economyService.commitTransfer({
      sourceDomainUuid: docA.uuid,
      targetDomainUuid: docB.uuid,
      resourceId: "domain-manager:treasury",
      amountMinor: 1000,
      reason: `Cycle A->B #${i}`
    }));
    promises.push(economyService.commitTransfer({
      sourceDomainUuid: docB.uuid,
      targetDomainUuid: docC.uuid,
      resourceId: "domain-manager:treasury",
      amountMinor: 1000,
      reason: `Cycle B->C #${i}`
    }));
    promises.push(economyService.commitTransfer({
      sourceDomainUuid: docC.uuid,
      targetDomainUuid: docA.uuid,
      resourceId: "domain-manager:treasury",
      amountMinor: 1000,
      reason: `Cycle C->A #${i}`
    }));
  }

  const results = await Promise.all(promises);
  for (const r of results) {
    assert.equal(r.ok, true);
  }

  const accA = (await economyService.getAccount(docA.uuid, "domain-manager:treasury")).value!;
  const accB = (await economyService.getAccount(docB.uuid, "domain-manager:treasury")).value!;
  const accC = (await economyService.getAccount(docC.uuid, "domain-manager:treasury")).value!;

  if (accA.mode === "native" && accB.mode === "native" && accC.mode === "native") {
    // Each transferred 5000 out and received 5000 in, so net delta is 0
    assert.equal(accA.balanceMinor, initial);
    assert.equal(accB.balanceMinor, initial);
    assert.equal(accC.balanceMinor, initial);
    assert.equal(accA.balanceMinor + accB.balanceMinor + accC.balanceMinor, totalInitial);
  }
});

test("G4.10 Concurrency: concurrent adjustments on the same domain are atomic with no lost updates", async () => {
  const doc = document("dom-adj", "Domain Adjust");
  const store = createStore([doc]);
  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  await economyService.createAccount({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:materials",
    initialBalanceMinor: 0
  });

  // Fire 10 concurrent delta adjustments of +100 each
  const promises: Promise<any>[] = [];
  for (let i = 0; i < 10; i++) {
    promises.push(
      economyService.commitAdjust({
        domainUuid: doc.uuid,
        resourceId: "domain-manager:materials",
        deltaMinor: 100,
        reason: `Concurrent adjust #${i + 1}`
      })
    );
  }

  const results = await Promise.all(promises);
  for (const r of results) {
    assert.equal(r.ok, true);
  }

  const acc = (await economyService.getAccount(doc.uuid, "domain-manager:materials")).value!;
  assert.equal(acc.mode, "native");
  if (acc.mode === "native") {
    assert.equal(acc.balanceMinor, 1000, `Expected 1000, got ${acc.balanceMinor} (lost update occurred!)`);
  }
});

test("G4.10 Concurrency: competing concurrent reservations prevent over-reservation", async () => {
  const doc = document("dom-resv-race", "Domain Resv Race");
  const store = createStore([doc]);
  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  // Balance = 500
  const createRes = await economyService.createAccount({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:supplies",
    initialBalanceMinor: 500
  });
  assert.equal(createRes.ok, true);

  // Try to open 5 concurrent reservations of 200 each (total 1000 > 500)
  const promises: Promise<any>[] = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      economyService.reserve({
        domainUuid: doc.uuid,
        resourceId: "domain-manager:supplies",
        amountMinor: 200,
        source: { type: "project", ref: `proj-${i}` }
      })
    );
  }

  const results = await Promise.all(promises);
  const successful = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  // Exactly 2 reservations of 200 should succeed (200 + 200 = 400 <= 500). The 3rd would be 600 > 500 and fail.
  assert.equal(successful.length, 2, `Expected exactly 2 successful reservations, got ${successful.length}`);
  assert.equal(failed.length, 3, `Expected exactly 3 failed reservations, got ${failed.length}`);

  for (const f of failed) {
    assert.equal(f.error.code, "DM_ECON_INSUFFICIENT_AVAILABLE");
  }

  // Account state check: balance = 500, reserved = 400, available = 100
  const accState = (await economyService.getAccountAvailability(doc.uuid, "domain-manager:supplies")).value!;
  assert.equal(accState.balanceMinor, 500);
  assert.equal(accState.reservedMinor, 400);
  assert.equal(accState.availableMinor, 100);
});

test("G4.10 Concurrency: concurrent reversals of the same ledger entry allow exactly one reversal", async () => {
  const doc = document("dom-rev-race", "Domain Rev Race");
  const store = createStore([doc]);
  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  const createRes = await economyService.createAccount({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 1000
  });
  assert.equal(createRes.ok, true);

  // Make an adjustment to reverse
  const adjRes = await economyService.commitAdjust({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    deltaMinor: 500,
    reason: "Bonus"
  });
  assert.equal(adjRes.ok, true);
  const entryIdToReverse = adjRes.value.entry.id;

  // Race 2 concurrent reversals of the same entry
  const [rev1, rev2] = await Promise.all([
    economyService.reverseLedgerEntry({
      domainUuid: doc.uuid,
      entryId: entryIdToReverse,
      reason: "Concurrent reversal 1"
    }),
    economyService.reverseLedgerEntry({
      domainUuid: doc.uuid,
      entryId: entryIdToReverse,
      reason: "Concurrent reversal 2"
    })
  ]);

  const successCount = (rev1.ok ? 1 : 0) + (rev2.ok ? 1 : 0);
  const failCount = (!rev1.ok ? 1 : 0) + (!rev2.ok ? 1 : 0);

  assert.equal(successCount, 1, "Exactly one reversal must succeed");
  assert.equal(failCount, 1, "Exactly one reversal must fail");

  const failedRes = !rev1.ok ? rev1 : rev2;
  assert.equal(failedRes.error.code, "DM_ECON_REVERSAL_ALREADY_EXISTS");

  // Final balance must be back to 1000 (1000 + 500 - 500 = 1000)
  const acc = (await economyService.getAccount(doc.uuid, "domain-manager:treasury")).value!;
  if (acc.mode === "native") {
    assert.equal(acc.balanceMinor, 1000);
  }
});
