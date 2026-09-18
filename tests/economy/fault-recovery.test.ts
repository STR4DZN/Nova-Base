import test from "node:test";
import assert from "node:assert/strict";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import {
  getDomainEconomyData,
  withDomainEconomyData,
  type DomainEconomyData
} from "../../src/economy/economy-data.js";
import { createDefaultResourceRegistry } from "../../src/economy/definitions/resource-registry.js";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";
import { ReservationStore } from "../../src/economy/reservations/reservation-store.js";
import { EconomyService } from "../../src/economy/services/economy-service.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { RecoveryService } from "../../src/mutations/recovery-service.js";
import { createTransactionRecord } from "../../src/mutations/transaction-record.js";
import { InMemoryTransactionStorageAdapter } from "../../src/mutations/transaction-storage-adapter.js";

const testRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Fault Test Domain", description: "" },
    classification: { kind: "base", scale: "small", tags: [] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function createFaultInjectableDoc(
  id: string,
  name: string,
  failOnUpdate: { shouldFail: boolean }
): IdentifiedJournalEntryDocumentLike {
  let currentFlags: Readonly<Record<string, unknown>> = {
    "domain-manager": JSON.parse(JSON.stringify(testRecord))
  };
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return name; },
    get flags() { return currentFlags; },
    get ownership() { return { default: 3 }; },
    update: async (data: Record<string, unknown>) => {
      if (failOnUpdate.shouldFail) {
        throw new Error(`Injected simulated disk/network write failure on ${id}`);
      }
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": payload };
      }
    }
  };
}

test("G4-AUD-002: Transfer step-2 failure triggers complete automatic rollback (atomic conservation)", async () => {
  const failControl = { shouldFail: false };
  const docSource = createFaultInjectableDoc("dom-src", "Source Domain", { shouldFail: false });
  const docDest = createFaultInjectableDoc("dom-dst", "Destination Domain", failControl);

  const docMap = new Map<string, IdentifiedJournalEntryDocumentLike>([
    [docSource.id, docSource],
    [docSource.uuid, docSource],
    [docDest.id, docDest],
    [docDest.uuid, docDest]
  ]);

  const store: DomainDocumentStore = {
    get: (idOrUuid: string) => {
      const clean = idOrUuid.startsWith("JournalEntry.") ? idOrUuid.slice("JournalEntry.".length) : idOrUuid;
      return docMap.get(idOrUuid) ?? docMap.get(clean);
    },
    list: () => [...new Set(docMap.values())],
    create: async () => { throw new Error("not used"); }
  };

  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore();
  const recoveryService = new RecoveryService(transactionStore, lockManager);

  const economy = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    recoveryService
  });

  // Setup initial accounts
  await economy.createAccount({
    domainUuid: docSource.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 10_000
  });

  await economy.createAccount({
    domainUuid: docDest.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 2_000
  });

  // Enable fault on destination update
  failControl.shouldFail = true;

  // Execute transfer that will fail at step 2
  const transferRes = await economy.commitTransfer({
    sourceDomainUuid: docSource.uuid,
    targetDomainUuid: docDest.uuid,
    resourceId: "domain-manager:treasury",
    amountMinor: 3_000,
    reason: "Transfer with injected failure"
  });

  // Must report failure
  assert.equal(transferRes.ok, false);

  // Both accounts must retain their EXACT initial balances (no money created or destroyed)
  const srcAcc = (await economy.getAccount(docSource.uuid, "domain-manager:treasury")).value!;
  const dstAcc = (await economy.getAccount(docDest.uuid, "domain-manager:treasury")).value!;

  assert.equal(srcAcc.mode === "native" ? srcAcc.balanceMinor : null, 10_000, "Source balance must be rolled back to 10,000");
  assert.equal(dstAcc.mode === "native" ? dstAcc.balanceMinor : null, 2_000, "Destination balance must remain 2,000");

  // No phantom transfer entries should remain in the ledger
  const transferEntries = ledgerStore.query({ resourceId: "domain-manager:treasury" })
    .filter((e) => e.kind === "transfer-debit" || e.kind === "transfer-credit");
  assert.equal(transferEntries.length, 0, "No transfer entries should be committed on aborted transaction");

  // Now disable fault and retry: transfer succeeds completely
  failControl.shouldFail = false;

  const retryRes = await economy.commitTransfer({
    sourceDomainUuid: docSource.uuid,
    targetDomainUuid: docDest.uuid,
    resourceId: "domain-manager:treasury",
    amountMinor: 3_000,
    reason: "Retried transfer after issue resolution"
  });

  assert.equal(retryRes.ok, true);

  const finalSrc = (await economy.getAccount(docSource.uuid, "domain-manager:treasury")).value!;
  const finalDst = (await economy.getAccount(docDest.uuid, "domain-manager:treasury")).value!;

  assert.equal(finalSrc.mode === "native" ? finalSrc.balanceMinor : null, 7_000);
  assert.equal(finalDst.mode === "native" ? finalDst.balanceMinor : null, 5_000);
  assert.equal((finalSrc.mode === "native" ? finalSrc.balanceMinor : 0) + (finalDst.mode === "native" ? finalDst.balanceMinor : 0), 12_000);
});

test("G4-AUD-002: RecoveryService.recoverAll rolls back dangling uncommitted transactions on startup", async () => {
  const docSource = createFaultInjectableDoc("dom-rec-src", "Recovery Source", { shouldFail: false });
  const docDest = createFaultInjectableDoc("dom-rec-dst", "Recovery Dest", { shouldFail: false });

  const docMap = new Map<string, IdentifiedJournalEntryDocumentLike>([
    [docSource.id, docSource],
    [docSource.uuid, docSource],
    [docDest.id, docDest],
    [docDest.uuid, docDest]
  ]);

  const store: DomainDocumentStore = {
    get: (idOrUuid: string) => {
      const clean = idOrUuid.startsWith("JournalEntry.") ? idOrUuid.slice("JournalEntry.".length) : idOrUuid;
      return docMap.get(idOrUuid) ?? docMap.get(clean);
    },
    list: () => [...new Set(docMap.values())],
    create: async () => { throw new Error("not used"); }
  };

  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore();
  const recoveryService = new RecoveryService(transactionStore, lockManager);

  const economy = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    recoveryService
  });

  // Setup accounts
  await economy.createAccount({
    domainUuid: docSource.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 10_000
  });

  // Simulate a dangling transaction left in 'committing' state recorded before a crash occurred
  const tx = createTransactionRecord({
    commandId: "cmd_simulated_crash" as any,
    authorityEpoch: 1,
    lockKeys: [docSource.uuid, docDest.uuid],
    safeAutoRecovery: true,
    recoveryData: {
      type: "economy:transfer",
      sourceDomainUuid: docSource.uuid,
      targetDomainUuid: docDest.uuid,
      resourceId: "domain-manager:treasury",
      amountMinor: 2_500,
      sourceInitialBalance: 10_000
    }
  });

  // Put in 'committing' state (unresolved at time of crash)
  transactionStore.save(tx);
  transactionStore.transition(tx.transactionId, "claimed", 1, "test");
  transactionStore.transition(tx.transactionId, "prepared", 1, "test");
  transactionStore.transition(tx.transactionId, "committing", 1, "test");

  assert.equal(transactionStore.get(tx.transactionId)?.state, "committing");

  // Call recoverAll() (as happens during startup / bootstrap)
  const recoveryResults = await recoveryService.recoverAll(1);
  assert.equal(recoveryResults.length, 1);
  assert.equal(recoveryResults[0].ok, true);
  assert.equal(recoveryResults[0].value.state, "compensated");

  const recoveredTx = transactionStore.get(tx.transactionId);
  assert.equal(recoveredTx?.state, "compensated");
});

test("G4-AUD-003: Partial and full reservation consume rollback on injected domain update failure", async () => {
  const failControl = { shouldFail: false };
  const doc = createFaultInjectableDoc("dom-consume-fault", "Consume Domain", failControl);

  const docMap = new Map<string, IdentifiedJournalEntryDocumentLike>([
    [doc.id, doc],
    [doc.uuid, doc]
  ]);

  const store: DomainDocumentStore = {
    get: (idOrUuid: string) => {
      const clean = idOrUuid.startsWith("JournalEntry.") ? idOrUuid.slice("JournalEntry.".length) : idOrUuid;
      return docMap.get(idOrUuid) ?? docMap.get(clean);
    },
    list: () => [...docMap.values()],
    create: async () => { throw new Error("not used"); }
  };

  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore();
  const recoveryService = new RecoveryService(transactionStore, lockManager);

  const economy = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    recoveryService
  });

  // Setup account with 1,000 treasury
  await economy.createAccount({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 1_000
  });

  // Create reservation of 400
  const reserveRes = await economy.reserve({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    amountMinor: 400,
    source: { type: "project", ref: "proj_1" }
  });
  assert.equal(reserveRes.ok, true);
  const reservationId = reserveRes.value.id;

  // Verify initial reservation state
  assert.equal(reservationStore.get(reservationId)?.remainingAmountMinor, 400);
  assert.equal(reservationStore.get(reservationId)?.status, "active");

  // Injected failure on domain document update
  failControl.shouldFail = true;

  // 1. Attempt partial consume of 150 with domain write failure
  const partialConsumeFail = await economy.consumeReservation({
    domainUuid: doc.uuid,
    reservationId,
    amountMinor: 150,
    reason: "Partial consume test"
  });
  assert.equal(partialConsumeFail.ok, false);

  // CRITICAL G4-AUD-003: Reservation must NOT be reduced further. It must be restored to exactly 400!
  const resvAfterPartialFail = reservationStore.get(reservationId)!;
  assert.equal(resvAfterPartialFail.remainingAmountMinor, 400, "Rollback must restore exact remaining minor");
  assert.equal(resvAfterPartialFail.status, "active", "Rollback must restore active status");

  // Domain balance must remain untouched at 1,000
  const accAfterPartialFail = (await economy.getAccount(doc.uuid, "domain-manager:treasury")).value!;
  assert.equal(accAfterPartialFail.mode === "native" ? accAfterPartialFail.balanceMinor : null, 1_000);

  // 2. Attempt full consume of 400 with domain write failure
  const fullConsumeFail = await economy.consumeReservation({
    domainUuid: doc.uuid,
    reservationId,
    amountMinor: 400,
    reason: "Full consume test"
  });
  assert.equal(fullConsumeFail.ok, false);

  // CRITICAL: Full consume failure must NOT lock status to 'consumed'
  const resvAfterFullFail = reservationStore.get(reservationId)!;
  assert.equal(resvAfterFullFail.remainingAmountMinor, 400, "Full consume rollback must restore exact remaining minor");
  assert.equal(resvAfterFullFail.status, "active", "Full consume rollback must restore active status");

  // Now disable fault and perform successful partial consume of 150
  failControl.shouldFail = false;
  const partialOk = await economy.consumeReservation({
    domainUuid: doc.uuid,
    reservationId,
    amountMinor: 150,
    reason: "Successful partial consume"
  });
  assert.equal(partialOk.ok, true);
  assert.equal(partialOk.value.reservation.remainingAmountMinor, 250);
  assert.equal(partialOk.value.reservation.status, "partially-consumed");

  const accAfterPartialOk = (await economy.getAccount(doc.uuid, "domain-manager:treasury")).value!;
  assert.equal(accAfterPartialOk.mode === "native" ? accAfterPartialOk.balanceMinor : null, 850);

  // Injected fault on remaining full consume (250)
  failControl.shouldFail = true;
  const fullFail2 = await economy.consumeReservation({
    domainUuid: doc.uuid,
    reservationId,
    amountMinor: 250,
    reason: "Failing full consume of remaining"
  });
  assert.equal(fullFail2.ok, false);

  // Must restore to 250 and status partially-consumed
  const resvRestored = reservationStore.get(reservationId)!;
  assert.equal(resvRestored.remainingAmountMinor, 250);
  assert.equal(resvRestored.status, "partially-consumed");

  // Disable fault: full consume cleanly succeeds
  failControl.shouldFail = false;
  const fullOk = await economy.consumeReservation({
    domainUuid: doc.uuid,
    reservationId,
    amountMinor: 250,
    reason: "Final successful consume"
  });
  assert.equal(fullOk.ok, true);
  assert.equal(fullOk.value.reservation.remainingAmountMinor, 0);
  assert.equal(fullOk.value.reservation.status, "consumed");

  const accFinal = (await economy.getAccount(doc.uuid, "domain-manager:treasury")).value!;
  assert.equal(accFinal.mode === "native" ? accFinal.balanceMinor : null, 600);
});

test("G4-AUD-002: Durable TransactionStore survives crash restart and repeated recovery is idempotent", async () => {
  const adapter = new InMemoryTransactionStorageAdapter();
  const store1 = new TransactionStore({ storageAdapter: adapter });
  const lockManager = new LockManager();

  const docSource = createFaultInjectableDoc("dom-restart-src", "Restart Source", { shouldFail: false });
  const docDest = createFaultInjectableDoc("dom-restart-dst", "Restart Dest", { shouldFail: false });

  const docMap = new Map<string, IdentifiedJournalEntryDocumentLike>([
    [docSource.id, docSource],
    [docSource.uuid, docSource],
    [docDest.id, docDest],
    [docDest.uuid, docDest]
  ]);

  const store: DomainDocumentStore = {
    get: (idOrUuid: string) => {
      const clean = idOrUuid.startsWith("JournalEntry.") ? idOrUuid.slice("JournalEntry.".length) : idOrUuid;
      return docMap.get(idOrUuid) ?? docMap.get(clean);
    },
    list: () => [...docMap.values()],
    create: async () => { throw new Error("not used"); }
  };

  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const recoveryService1 = new RecoveryService(store1, lockManager);

  const economy1 = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore: store1,
    recoveryService: recoveryService1
  });

  // Setup initial accounts
  await economy1.createAccount({
    domainUuid: docSource.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 10_000
  });
  await economy1.createAccount({
    domainUuid: docDest.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 2_000
  });

  // Simulate partial mutation where source domain was updated to 7,000 before a crash occurred
  const srcDoc = (await domains.read(docSource.uuid)).value!;
  const srcEcon = getDomainEconomyData(srcDoc.record);
  const updatedSrcAccounts = srcEcon.accounts.map((a) =>
    a.resourceId === "domain-manager:treasury" ? { ...a, balanceMinor: 7_000 } : a
  );
  await domains.update({
    ...srcDoc,
    record: withDomainEconomyData(srcDoc.record, {
      ...srcEcon,
      accounts: Object.freeze(updatedSrcAccounts)
    })
  });

  // Save transaction in committing state and flush to adapter
  const tx = createTransactionRecord({
    commandId: "cmd_uncommitted_transfer" as any,
    authorityEpoch: 1,
    lockKeys: [docSource.uuid, docDest.uuid],
    safeAutoRecovery: true,
    recoveryData: {
      type: "economy:transfer",
      sourceDomainUuid: docSource.uuid,
      targetDomainUuid: docDest.uuid,
      resourceId: "domain-manager:treasury",
      amountMinor: 3_000,
      sourceInitialBalance: 10_000,
      targetInitialBalance: 2_000
    }
  });

  store1.save(tx);
  store1.transition(tx.transactionId, "claimed", 1);
  store1.transition(tx.transactionId, "prepared", 1);
  store1.transition(tx.transactionId, "committing", 1);
  await store1.flush();

  // === RESTART SIMULATION ===
  // Fresh TransactionStore rehydrating from the persistent storage adapter
  const store2 = new TransactionStore({ storageAdapter: adapter });
  await store2.rehydrate();

  // The uncommitted transaction must have survived restart
  assert.equal(store2.count, 1);
  const reloadedTx = store2.get(tx.transactionId);
  assert.ok(reloadedTx, "Transaction must survive reload via storage adapter");
  assert.equal(reloadedTx.state, "committing");

  // Fresh RecoveryService and EconomyService composed on startup
  const recoveryService2 = new RecoveryService(store2, lockManager);
  new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore: store2,
    recoveryService: recoveryService2
  });

  // Execute startup recovery
  const recoveryResults = await recoveryService2.recoverAll(1);
  assert.equal(recoveryResults.length, 1);
  assert.equal(recoveryResults[0].ok, true);
  assert.equal(recoveryResults[0].value.state, "compensated");

  // Verify source balance was restored to 10,000
  const srcAccRestored = (await domains.read(docSource.uuid)).value!;
  const srcEconRestored = getDomainEconomyData(srcAccRestored.record);
  const restoredBalance = (srcEconRestored.accounts[0] as any).balanceMinor;
  assert.equal(restoredBalance, 10_000, "Source balance must be restored by compensator");

  // Verify compensating ledger entry was appended
  const recoveryLedgerEntries = ledgerStore.query({ domainUuid: docSource.uuid })
    .filter((e) => e.transactionId === tx.transactionId);
  assert.equal(recoveryLedgerEntries.length, 1);
  assert.equal(recoveryLedgerEntries[0].deltaMinor, 3_000);

  // Repeated recovery execution must be strictly idempotent
  const repeatedResults = await recoveryService2.recoverAll(1);
  assert.equal(repeatedResults.length, 0, "Second recoverAll must find 0 pending transactions");

  // Balance and ledger must not be duplicated
  const srcAccSecond = (await domains.read(docSource.uuid)).value!;
  const srcEconSecond = getDomainEconomyData(srcAccSecond.record);
  assert.equal((srcEconSecond.accounts[0] as any).balanceMinor, 10_000);
  assert.equal(
    ledgerStore.query({ domainUuid: docSource.uuid }).filter((e) => e.transactionId === tx.transactionId).length,
    1
  );
});

test("G4-AUD-002: Conversion recovery compensation restores from and to balances on partial commit failure", async () => {
  const doc = createFaultInjectableDoc("dom-convert-fault", "Convert Domain", { shouldFail: false });
  const docMap = new Map<string, IdentifiedJournalEntryDocumentLike>([
    [doc.id, doc],
    [doc.uuid, doc]
  ]);

  const store: DomainDocumentStore = {
    get: (idOrUuid: string) => {
      const clean = idOrUuid.startsWith("JournalEntry.") ? idOrUuid.slice("JournalEntry.".length) : idOrUuid;
      return docMap.get(idOrUuid) ?? docMap.get(clean);
    },
    list: () => [...docMap.values()],
    create: async () => { throw new Error("not used"); }
  };

  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore();
  const recoveryService = new RecoveryService(transactionStore, lockManager);

  new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    recoveryService
  });

  // Setup initial accounts: 1,000 treasury, 500 supplies
  const initialDoc = (await domains.read(doc.uuid)).value!;
  const initialEcon: DomainEconomyData = {
    schemaVersion: 1,
    accounts: Object.freeze([
      { mode: "native", domainUuid: doc.uuid, resourceId: "domain-manager:treasury", balanceMinor: 700, baseCapacityMinor: null, visibility: "public", status: "active" },
      { mode: "native", domainUuid: doc.uuid, resourceId: "domain-manager:supplies", balanceMinor: 650, baseCapacityMinor: null, visibility: "public", status: "active" }
    ])
  };
  await domains.update({ ...initialDoc, record: withDomainEconomyData(initialDoc.record, initialEcon) });

  // Dangling conversion: 300 treasury converted to 150 supplies, was interrupted before ledger append
  const tx = createTransactionRecord({
    commandId: "cmd_failed_convert" as any,
    authorityEpoch: 1,
    lockKeys: [`domain:${doc.uuid}`],
    safeAutoRecovery: true,
    recoveryData: {
      type: "economy:convert",
      domainUuid: doc.uuid,
      fromResourceId: "domain-manager:treasury",
      toResourceId: "domain-manager:supplies",
      fromAmountMinor: 300,
      toAmountMinor: 150,
      fromInitialBalance: 1_000,
      toInitialBalance: 500
    }
  });

  transactionStore.save(tx);
  transactionStore.transition(tx.transactionId, "claimed", 1);
  transactionStore.transition(tx.transactionId, "prepared", 1);
  transactionStore.transition(tx.transactionId, "committing", 1);

  // Recover
  const recoveryResults = await recoveryService.recoverAll(1);
  assert.equal(recoveryResults.length, 1);
  assert.equal(recoveryResults[0].ok, true);
  assert.equal(recoveryResults[0].value.state, "compensated");

  // Balances must be restored: treasury 1,000 and supplies 500
  const finalDoc = (await domains.read(doc.uuid)).value!;
  const finalEcon = getDomainEconomyData(finalDoc.record);
  const treasuryAcc = finalEcon.accounts.find((a) => a.resourceId === "domain-manager:treasury")!;
  const suppliesAcc = finalEcon.accounts.find((a) => a.resourceId === "domain-manager:supplies")!;

  assert.equal((treasuryAcc as any).balanceMinor, 1_000, "Treasury balance must be restored to 1,000");
  assert.equal((suppliesAcc as any).balanceMinor, 500, "Supplies balance must be restored to 500");

  // Compensating ledger entries
  const compEntries = ledgerStore.query({ domainUuid: doc.uuid }).filter((e) => e.transactionId === tx.transactionId);
  assert.equal(compEntries.length, 2);
  assert.equal(compEntries.find((e) => e.resourceId === "domain-manager:treasury")?.deltaMinor, 300);
  assert.equal(compEntries.find((e) => e.resourceId === "domain-manager:supplies")?.deltaMinor, -150);
});


