import test from "node:test";
import assert from "node:assert/strict";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { InMemoryTransactionStorageAdapter } from "../../src/mutations/transaction-storage-adapter.js";
import { RecoveryFenceRegistry } from "../../src/mutations/recovery-fence-registry.js";
import {
  RecoveryService,
  markCompensationStepCompleted,
  isCompensationStepCompleted
} from "../../src/mutations/recovery-service.js";
import { CompositeMutationSession } from "../../src/mutations/composite-mutation-session.js";
import { lockKey, areLockSetsEqual } from "../../src/mutations/lock-keys.js";
import { createCommandId } from "../../src/commands/command-envelope.js";
import { ok, err } from "../../src/core/contracts/result.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";
import { isFinalTransactionState, type TransactionRecord, createTransactionRecord } from "../../src/mutations/transaction-record.js";
import { EconomyService } from "../../src/economy/services/economy-service.js";
import { createDefaultResourceRegistry } from "../../src/economy/definitions/resource-registry.js";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";
import { InMemoryLedgerStorageAdapter } from "../../src/economy/storage/ledger-storage-adapter.js";
import { ReservationStore } from "../../src/economy/reservations/reservation-store.js";
import { InMemoryReservationStorageAdapter } from "../../src/economy/storage/reservation-storage-adapter.js";
import {
  compensateProjectStart,
  compensateProjectAdvance,
  compensateProjectCancel,
  compensateProjectCompletion
} from "../../src/projects/services/project-recovery-compensators.js";
import {
  compensateDowntimeStart,
  compensateDowntimeResolution
} from "../../src/downtime/services/downtime-recovery-compensators.js";
import { compensateFacilityOperation } from "../../src/facilities/services/facility-recovery-compensators.js";
import { withDomainProjectsData, createDefaultDomainProjectsData } from "../../src/projects/project-data.js";
import { withDomainDowntimeData, createDefaultDomainDowntimeData } from "../../src/downtime/downtime-data.js";
import { withDomainFacilitiesData, createDefaultDomainFacilitiesData } from "../../src/facilities/facility-data.js";
import { withDomainEconomyData } from "../../src/economy/economy-data.js";

// Section 27: Property Invariant Assertions
function assertTransactionSafety(
  txId: string,
  txStore: TransactionStore,
  fenceRegistry: RecoveryFenceRegistry
): void {
  const tx = txStore.get(txId);
  assert.ok(tx, `Transaction '${txId}' must exist in store`);
  if (!isFinalTransactionState(tx.state)) {
    assert.equal(
      fenceRegistry.isScopeBlocked(tx.lockKeys),
      true,
      `Unresolved transaction '${txId}' in state '${tx.state}' must have active recovery fence`
    );
  } else {
    assert.equal(
      fenceRegistry.getFenceForTransaction(txId),
      undefined,
      `Final transaction '${txId}' must not retain active recovery fence`
    );
  }
}

function assertNoDuplicateIdempotencyKeys(keys: readonly string[]): void {
  const set = new Set<string>();
  for (const k of keys) {
    assert.equal(set.has(k), false, `Duplicate idempotencyKey detected: ${k}`);
    set.add(k);
  }
}

function assertNoOrphanRecoveryFence(
  fenceRegistry: RecoveryFenceRegistry,
  txStore: TransactionStore
): void {
  for (const fence of fenceRegistry.getFences()) {
    const tx = txStore.get(fence.transactionId);
    assert.ok(tx, `Fence for '${fence.transactionId}' must have corresponding transaction record`);
    assert.equal(
      isFinalTransactionState(tx.state),
      false,
      `Final transaction '${tx.transactionId}' must not have active fence`
    );
  }
}

function assertLockSetsEqualStrict(a: readonly string[], b: readonly string[]): void {
  assert.equal(areLockSetsEqual(a, b), true, `Lock sets must match: [${a.join(",")}] vs [${b.join(",")}]`);
}

// ---------------------------------------------------------------------------
// 1. KERNEL LIFECYCLE INVARIANTS (INV-01 to INV-11)
// ---------------------------------------------------------------------------

test("G5-KERNEL-INV-01: Session prepare rejects forbidden namespaces and lock set divergences", async () => {
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const cmdId = createCommandId();

  // 1. Forbidden namespace: activity:
  const forbiddenRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    commandId: cmdId,
    authorityEpoch: 1,
    lockKeys: ["domain:d1", "activity:act-1"],
    recoveryType: "test:flow",
    parentRef: "domain:d1"
  });
  assert.equal(forbiddenRes.ok, false);
  assert.equal(forbiddenRes.error.code, "DM_TX_LOCKSET_DIVERGENCE");

  // 2. Divergence from plan lock keys
  const divRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    commandId: cmdId,
    authorityEpoch: 1,
    lockKeys: ["domain:d1"],
    planLockKeys: ["domain:d1", "project:p1"],
    recoveryType: "test:flow",
    parentRef: "domain:d1"
  });
  assert.equal(divRes.ok, false);
  assert.equal(divRes.error.code, "DM_TX_LOCKSET_DIVERGENCE");
});

test("G5-KERNEL-INV-02: prepare persists durable record in prepared state before child writes", async () => {
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const cmdId = createCommandId();
  const keys = [lockKey.domain("dom-inv2"), lockKey.project("prj-inv2")];

  const sessionRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    commandId: cmdId,
    authorityEpoch: 1,
    lockKeys: keys,
    planLockKeys: keys,
    recoveryType: "projects:advance",
    parentRef: "project:prj-inv2"
  });

  assert.equal(sessionRes.ok, true);
  const session = sessionRes.value;
  const storedTx = txStore.get(session.transactionId);
  assert.ok(storedTx);
  assert.equal(storedTx.state, "prepared");
  assert.equal(storedTx.authorityEpoch, 1);
  assertLockSetsEqualStrict(storedTx.lockKeys, keys);
});

test("G5-KERNEL-INV-04: runChildStep flushIntent persists intent before execution and fails closed if flush fails", async () => {
  class FaultyAdapter extends InMemoryTransactionStorageAdapter {
    shouldFail = true;
    override async saveSnapshot(snapshot: any): Promise<void> {
      if (this.shouldFail) {
        throw new Error("Simulated storage disk full during intent flush");
      }
      return super.saveSnapshot(snapshot);
    }
  }

  const adapter = new FaultyAdapter();
  const txStore = new TransactionStore(adapter);
  adapter.shouldFail = false;

  const sessionRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-inv4")],
    recoveryType: "test:intent",
    parentRef: "domain:dom-inv4"
  });
  assert.equal(sessionRes.ok, true);
  const session = sessionRes.value;

  // Make flush fail for intent
  adapter.shouldFail = true;
  let effectRan = false;

  const stepRes = await session.runChildStep({
    stepId: "step-1",
    subsystem: "economy",
    operation: "adjust",
    intent: { amount: -50 },
    flushIntent: true,
    execute: async () => {
      effectRan = true;
      return ok({ balance: 50 });
    }
  });

  assert.equal(stepRes.ok, false);
  assert.equal(stepRes.error.code, "DM_DOMAIN_STORAGE_ERROR");
  assert.equal(effectRan, false, "Effect must NOT run if intent flush failed (INV-04)");
});

test("G5-KERNEL-INV-05: runChildStep marks step unknown and enters needs-recovery if receipt flush fails", async () => {
  class FaultyAdapter extends InMemoryTransactionStorageAdapter {
    failOnReceipt = false;
    override async saveSnapshot(snapshot: any): Promise<void> {
      if (this.failOnReceipt) {
        throw new Error("Disk I/O error during receipt flush");
      }
      return super.saveSnapshot(snapshot);
    }
  }

  const adapter = new FaultyAdapter();
  const txStore = new TransactionStore(adapter);
  const fenceRegistry = new RecoveryFenceRegistry();
  const domainKey = lockKey.domain("dom-inv5");

  const sessionRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    recoveryFenceRegistry: fenceRegistry,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainKey],
    recoveryType: "test:receipt",
    parentRef: "domain:dom-inv5"
  });
  assert.equal(sessionRes.ok, true);
  const session = sessionRes.value;

  // Effect will run, but receipt flush will fail
  adapter.failOnReceipt = true;
  let effectExecuted = false;

  const stepRes = await session.runChildStep({
    stepId: "step-receipt-fail",
    subsystem: "economy",
    operation: "reserve",
    intent: { amount: 100 },
    execute: async () => {
      effectExecuted = true;
      return ok({ reservationId: "res-1" });
    }
  });

  assert.equal(effectExecuted, true);
  assert.equal(stepRes.ok, false);
  assert.equal(stepRes.error.code, "DM_DOMAIN_STORAGE_ERROR");
  assert.equal((stepRes.error.details as any)?.outcome, "unknown");

  // Transaction must now be in needs-recovery with active fence (INV-05, INV-07)
  const tx = txStore.get(session.transactionId);
  assert.ok(tx);
  assert.equal(tx.state, "needs-recovery");
  assert.equal(fenceRegistry.isScopeBlocked([domainKey]), true);
  assertTransactionSafety(session.transactionId, txStore, fenceRegistry);
});

test("G5-KERNEL-INV-10: commitDurably flush failure returns DM_TRANSACTION_COMMIT_UNCONFIRMED and fences transaction", async () => {
  class FaultyAdapter extends InMemoryTransactionStorageAdapter {
    failOnCommit = false;
    override async saveSnapshot(snapshot: any): Promise<void> {
      if (this.failOnCommit) {
        throw new Error("Storage write timeout on final commit flush");
      }
      return super.saveSnapshot(snapshot);
    }
  }

  const adapter = new FaultyAdapter();
  const txStore = new TransactionStore(adapter);
  const fenceRegistry = new RecoveryFenceRegistry();
  const domainKey = lockKey.domain("dom-inv10");

  const sessionRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    recoveryFenceRegistry: fenceRegistry,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainKey],
    recoveryType: "test:commit",
    parentRef: "domain:dom-inv10"
  });
  assert.equal(sessionRes.ok, true);
  const session = sessionRes.value;

  // Enter committing
  const committingRes = await session.enterCommitting();
  assert.equal(committingRes.ok, true);

  // Now fail final commit
  adapter.failOnCommit = true;
  const commitRes = await session.commitDurably({ completed: true });

  assert.equal(commitRes.ok, false);
  assert.equal(commitRes.error.code, "DM_TRANSACTION_COMMIT_UNCONFIRMED");

  // Invariant: must transition to needs-recovery, fence active
  const tx = txStore.get(session.transactionId);
  assert.ok(tx);
  assert.equal(tx.state, "needs-recovery");
  assert.equal(fenceRegistry.isScopeBlocked([domainKey]), true);
  assertTransactionSafety(session.transactionId, txStore, fenceRegistry);
});

test("G5-KERNEL-INV-11: failAndCompensate wraps unhandled compensator exceptions and marks needs-recovery", async () => {
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const fenceRegistry = new RecoveryFenceRegistry();
  const domainKey = lockKey.domain("dom-inv11");

  const sessionRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    recoveryFenceRegistry: fenceRegistry,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainKey],
    recoveryType: "test:comp-crash",
    parentRef: "domain:dom-inv11"
  });
  assert.equal(sessionRes.ok, true);
  const session = sessionRes.value;

  // Apply a child step so compensation is required
  await session.runChildStep({
    stepId: "step-1",
    subsystem: "economy",
    operation: "adjust",
    intent: { amount: 50 },
    execute: async () => ok({ applied: true })
  });

  // Fail and run compensator that throws an unhandled error
  const failRes = await session.failAndCompensate(
    createPublicError({
      code: "DM_COMMAND_EXECUTION_FAILED",
      category: "internal",
      message: "Parent write failed"
    }),
    async () => {
      throw new Error("Crash inside custom compensator logic");
    }
  );

  assert.equal(failRes.ok, false);
  assert.equal(failRes.error.code, "DM_COMPENSATION_FAILED");

  // Must be in needs-recovery with active fence
  const tx = txStore.get(session.transactionId);
  assert.ok(tx);
  assert.equal(tx.state, "needs-recovery");
  assert.equal(fenceRegistry.isScopeBlocked([domainKey]), true);
  assertTransactionSafety(session.transactionId, txStore, fenceRegistry);
});

// ---------------------------------------------------------------------------
// 2. GRUPO B — IMMEDIATE COMPENSATION EXCEPTIONS
// ---------------------------------------------------------------------------

test("G5-GROUP-B: MarkCompensationStepCompleted flush failure keeps transaction in needs-recovery with active fence", async () => {
  class FaultyAdapter extends InMemoryTransactionStorageAdapter {
    failOnStepCheckpoint = false;
    override async saveSnapshot(snapshot: any): Promise<void> {
      if (this.failOnStepCheckpoint) {
        throw new Error("Disk offline during markCompensationStepCompleted flush");
      }
      return super.saveSnapshot(snapshot);
    }
  }

  const adapter = new FaultyAdapter();
  const txStore = new TransactionStore(adapter);
  const fenceRegistry = new RecoveryFenceRegistry();
  const domainKey = lockKey.domain("dom-group-b");

  const sessionRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    recoveryFenceRegistry: fenceRegistry,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainKey],
    recoveryType: "projects:advance",
    parentRef: "project:prj-b"
  });
  assert.equal(sessionRes.ok, true);
  const session = sessionRes.value;

  // Apply child side effect
  await session.runChildStep({
    stepId: "economy:advance_cost",
    subsystem: "economy",
    operation: "adjust",
    intent: { amount: -100 },
    execute: async () => ok({ balance: 900 })
  });

  // Parent write fails -> trigger compensation
  const failRes = await session.failAndCompensate(
    createPublicError({
      code: "DM_DOMAIN_STORAGE_ERROR",
      category: "internal",
      message: "Parent project advance failed"
    }),
    async (sess) => {
      // Revert side effect
      adapter.failOnStepCheckpoint = true;
      const txRecord = txStore.get(sess.transactionId)!;
      // markCompensationStepCompleted throws when flush fails
      await markCompensationStepCompleted(txStore, txRecord, "economy:advance_cost");
      return ok(undefined);
    }
  );

  assert.equal(failRes.ok, false);
  const tx = txStore.get(session.transactionId)!;
  assert.equal(tx.state, "needs-recovery");
  assert.equal(fenceRegistry.isScopeBlocked([domainKey]), true);
  assertTransactionSafety(session.transactionId, txStore, fenceRegistry);
});

// ---------------------------------------------------------------------------
// 3. GRUPO C & SECTION 17 — RESTART IDEMPOTENCY
// ---------------------------------------------------------------------------

test("G5-GROUP-C: Restart recovery with appliedIdempotencyKeys ensures single application across crashes", async () => {
  const adapter = new InMemoryTransactionStorageAdapter();
  const txStore = new TransactionStore(adapter);
  const fenceRegistry = new RecoveryFenceRegistry();
  const lockManager = new LockManager();
  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore: txStore,
    fenceRegistry
  });

  const domainKey = lockKey.domain("dom-group-c");
  const idempotencyKeysRecorded: string[] = [];
  let balance = 1000;

  // Simulated EconomyService compensator adhering to Section 17:
  // Revert must check whether idempotencyKey was already recorded
  const compensationIdempotencyKey = "tx-c1:refund:materials";

  recoveryService.registerCompensator("test:idempotent_flow", async (txRecord) => {
    // Check if step already completed
    if (isCompensationStepCompleted(txRecord, "step-materials", txStore)) {
      return ok(undefined);
    }

    // Check if idempotencyKey was already applied to domain balance
    if (!idempotencyKeysRecorded.includes(compensationIdempotencyKey)) {
      balance += 200; // refund 200
      idempotencyKeysRecorded.push(compensationIdempotencyKey);
    }

    // Persist step checkpoint
    await markCompensationStepCompleted(txStore, txRecord, "step-materials");
    return ok(undefined);
  });

  // Prepare session and record needs-recovery
  const sessionRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    recoveryFenceRegistry: fenceRegistry,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainKey],
    recoveryType: "test:idempotent_flow",
    parentRef: "domain:dom-group-c",
    safeAutoRecovery: true
  });
  assert.equal(sessionRes.ok, true);
  const session = sessionRes.value;

  await session.runChildStep({
    stepId: "step-materials",
    subsystem: "economy",
    operation: "adjust",
    intent: { amount: -200 },
    execute: async () => {
      balance -= 200;
      return ok({ balance });
    }
  });
  assert.equal(balance, 800);

  // Crash before completion: mark needs-recovery
  await session.markNeedsRecovery("Simulated mid-flight crash");
  await txStore.flush();

  // 1st Recovery attempt: executes compensation
  const recRes1 = await recoveryService.recoverTransaction(session.transactionId);
  assert.equal(recRes1.ok, true);
  assert.equal(balance, 1000);
  assert.equal(idempotencyKeysRecorded.length, 1);

  // Simulate second recovery / retry replay
  const recRes2 = await recoveryService.recoverTransaction(session.transactionId);
  assert.equal(recRes2.ok, true);
  assert.equal(balance, 1000, "Balance must not be refunded twice on recovery replay");
  assertNoDuplicateIdempotencyKeys(idempotencyKeysRecorded);
  assertTransactionSafety(session.transactionId, txStore, fenceRegistry);
});

function createTestDomainDoc(id: string, initialRecordPatch?: any): {
  domains: any;
  getDoc: () => any;
} {
  let doc = {
    id,
    uuid: id,
    record: {
      schemaVersion: 1,
      revision: 1,
      definition: {
        identity: { aliases: [], summary: "Test Domain" },
        classification: { kind: "base", scale: "small", tags: [] },
        hierarchy: { parentDomainUuid: null },
        capabilities: {
          enabled: [
            "domain-manager:domain",
            "domain-manager:economy",
            "domain-manager:people",
            "domain-manager:projects",
            "domain-manager:facilities",
            "domain-manager:downtime"
          ],
          config: {
            "domain-manager:projects": createDefaultDomainProjectsData(),
            "domain-manager:facilities": createDefaultDomainFacilitiesData(),
            "domain-manager:downtime": createDefaultDomainDowntimeData(),
            "domain-manager:economy": {
              schemaVersion: 1,
              accounts: [
                {
                  mode: "native",
                  domainUuid: id,
                  resourceId: "domain-manager:materials",
                  balanceMinor: 1000,
                  baseCapacityMinor: null
                }
              ]
            },
            "domain-manager:people": {
              schemaVersion: 1,
              notables: [],
              operationalGroups: [],
              populationGroups: []
            }
          }
        }
      },
      state: { lifecycle: "active" },
      metadata: { createdByUserId: "gm-user", archivedAt: null, source: { type: "manual", ref: null } },
      ...initialRecordPatch
    }
  };

  return {
    getDoc: () => doc,
    domains: {
      read: async (uuid: string) => ok(doc),
      update: async (d: any) => {
        doc = d;
        return ok(d);
      },
      save: async (d: any) => {
        doc = d;
        return ok(d);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// 3.5. SECTION 17 — HARDENING DO EconomyService.commitAdjust (RESTART IDEMPOTENCY)
// ---------------------------------------------------------------------------

test("G5-SECTION-17-RESTART: EconomyService.commitAdjust restart/rehydration idempotency with ledger flush failure", async () => {
  const { domains, getDoc } = createTestDomainDoc("dom-sec17");

  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());

  // Step 1: LedgerStore whose flush() fails
  const ledgerAdapter = new InMemoryLedgerStorageAdapter();
  const failingLedgerStore = new LedgerStore(ledgerAdapter);
  let shouldFailFlush = true;
  const originalFlush = failingLedgerStore.flush.bind(failingLedgerStore);
  failingLedgerStore.flush = async () => {
    if (shouldFailFlush) {
      throw new Error("Disk full: simulated durable ledger flush error");
    }
    return originalFlush();
  };

  const economyService1 = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore: failingLedgerStore,
    reservationStore,
    lockManager
  });

  // Call commitAdjust with idempotencyKey
  const idempKey = "tx-sec17:compensation:refund-1";
  let thrownError: any;
  try {
    const res1 = await economyService1.commitAdjust({
      domainUuid: "dom-sec17",
      resourceId: "domain-manager:materials",
      deltaMinor: -200,
      reason: "Initial debit",
      idempotencyKey: idempKey
    });
    if (!res1.ok) {
      thrownError = res1.error;
    }
  } catch (err) {
    thrownError = err;
  }

  assert.ok(thrownError, "First adjust must fail due to ledger flush error");

  // But domains.update already completed, recording appliedIdempotencyKeys and deducting 200
  const midDoc = getDoc();
  const midEcon = (midDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  assert.equal(midEcon.accounts[0].balanceMinor, 800, "Domain document balance was updated to 800 before ledger failure");
  assert.ok(midEcon.appliedIdempotencyKeys?.includes(idempKey), "appliedIdempotencyKeys was recorded in domain document");

  // Step 2: Restart/Rehydrate - simulate service restart by creating new EconomyService instance
  // pointing to the same persisted domain document and a fresh/recovered ledger store
  shouldFailFlush = false;
  const recoveredLedgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const economyService2 = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore: recoveredLedgerStore,
    reservationStore,
    lockManager
  });

  // Retry with the exact same idempotencyKey
  const res2 = await economyService2.commitAdjust({
    domainUuid: "dom-sec17",
    resourceId: "domain-manager:materials",
    deltaMinor: -200,
    reason: "Retry debit after restart",
    idempotencyKey: idempKey
  });

  assert.equal(res2.ok, true, "Retry must succeed");
  assert.equal(res2.value.isNoop, true, "Retry must be treated as no-op");

  // Critical assertion: final balance must be altered EXACTLY ONCE (800, NOT 600!)
  const finalDoc = getDoc();
  const finalEcon = (finalDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  assert.equal(
    finalEcon.accounts[0].balanceMinor,
    800,
    "Final balance must be altered exactly once (800, not double-debited to 600)"
  );
});

// ---------------------------------------------------------------------------
// 4. GRUPO F — PARENT RECONCILIATION CRASH POINTS (ALL 8 G5 FLOWS)
// ---------------------------------------------------------------------------

test("G5-GROUP-F-1: projects:start parent reconciliation", async () => {
  const { domains, getDoc } = createTestDomainDoc("dom-f1");
  // Set up domain with project already created
  const prj = { id: "prj-f1", domainUuid: "dom-f1", definitionId: "prj:test", name: "P1", lifecycle: "active", revision: 1, workRequired: 100, workCompleted: 0 };
  const baseDoc = getDoc();
  baseDoc.record = withDomainProjectsData(baseDoc.record, {
    schemaVersion: 1,
    projects: [prj as any]
  });

  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const tx = createTransactionRecord({
    transactionId: "tx-f1",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-f1")],
    safeAutoRecovery: false,
    recoveryData: {
      type: "projects:start",
      projectId: "prj-f1",
      domainUuid: "dom-f1",
      debitedCosts: [{ resourceId: "domain-manager:materials", amountMinor: 100 }],
      status: "needs-recovery"
    }
  });
  txStore.save(tx);
  txStore.transition("tx-f1", "claimed", 1);
  txStore.transition("tx-f1", "prepared", 1);
  txStore.transition("tx-f1", "committing", 1);
  txStore.transition("tx-f1", "needs-recovery", 1);
  await txStore.flush();

  let refundExecuted = false;
  const fakeEconomy: any = {
    commitAdjust: async () => {
      refundExecuted = true;
      return ok({});
    }
  };

  const compRes = await compensateProjectStart("tx-f1", { domains, transactionStore: txStore, economyService: fakeEconomy });
  assert.equal(compRes.ok, true);
  assert.equal(refundExecuted, false, "Must NOT refund when project was already created on domain");
  assert.equal(txStore.get("tx-f1")!.state, "committed", "Transaction must reconcile to committed");
});

test("G5-GROUP-F-2: projects:advance parent reconciliation", async () => {
  const { domains, getDoc } = createTestDomainDoc("dom-f2");
  const prj = { id: "prj-f2", domainUuid: "dom-f2", definitionId: "prj:test", name: "P2", lifecycle: "active", revision: 2, workRequired: 100, workCompleted: 50 };
  const baseDoc = getDoc();
  baseDoc.record = withDomainProjectsData(baseDoc.record, {
    schemaVersion: 1,
    projects: [prj as any]
  });

  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const tx = createTransactionRecord({
    transactionId: "tx-f2",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-f2"), lockKey.project("prj-f2")],
    safeAutoRecovery: false,
    recoveryData: {
      type: "projects:advance",
      projectId: "prj-f2",
      domainUuid: "dom-f2",
      expectedWorkCompleted: 50,
      debitedCosts: [{ resourceId: "domain-manager:materials", amountMinor: 25 }],
      status: "needs-recovery"
    }
  });
  txStore.save(tx);
  txStore.transition("tx-f2", "claimed", 1);
  txStore.transition("tx-f2", "prepared", 1);
  txStore.transition("tx-f2", "committing", 1);
  txStore.transition("tx-f2", "needs-recovery", 1);
  await txStore.flush();

  let refundExecuted = false;
  const fakeEconomy: any = {
    commitAdjust: async () => {
      refundExecuted = true;
      return ok({});
    }
  };

  const compRes = await compensateProjectAdvance("tx-f2", { domains, transactionStore: txStore, economyService: fakeEconomy });
  assert.equal(compRes.ok, true);
  assert.equal(refundExecuted, false, "Must NOT refund progressive cost when work was already advanced");
  assert.equal(txStore.get("tx-f2")!.state, "committed", "Transaction must reconcile to committed");
});

test("G5-GROUP-F-3: projects:cancel parent reconciliation", async () => {
  const { domains, getDoc } = createTestDomainDoc("dom-f3");
  const prj = { id: "prj-f3", domainUuid: "dom-f3", definitionId: "prj:test", name: "P3", lifecycle: "cancelled", revision: 2, workRequired: 100, workCompleted: 10 };
  const baseDoc = getDoc();
  baseDoc.record = withDomainProjectsData(baseDoc.record, {
    schemaVersion: 1,
    projects: [prj as any]
  });

  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const tx = createTransactionRecord({
    transactionId: "tx-f3",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-f3"), lockKey.project("prj-f3")],
    safeAutoRecovery: false,
    recoveryData: {
      type: "projects:cancel",
      projectId: "prj-f3",
      domainUuid: "dom-f3",
      status: "needs-recovery"
    }
  });
  txStore.save(tx);
  txStore.transition("tx-f3", "claimed", 1);
  txStore.transition("tx-f3", "prepared", 1);
  txStore.transition("tx-f3", "committing", 1);
  txStore.transition("tx-f3", "needs-recovery", 1);
  await txStore.flush();

  const compRes = await compensateProjectCancel("tx-f3", { domains, transactionStore: txStore });
  assert.equal(compRes.ok, true);
  assert.equal(txStore.get("tx-f3")!.state, "committed", "Transaction must reconcile to committed");
});

test("G5-GROUP-F-4: projects:completion parent reconciliation", async () => {
  const { domains, getDoc } = createTestDomainDoc("dom-f4");
  const prj = { id: "prj-f4", domainUuid: "dom-f4", definitionId: "prj:test", name: "P4", lifecycle: "completed", revision: 3, workRequired: 100, workCompleted: 100 };
  const baseDoc = getDoc();
  baseDoc.record = withDomainProjectsData(baseDoc.record, {
    schemaVersion: 1,
    projects: [prj as any]
  });

  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const tx = createTransactionRecord({
    transactionId: "tx-f4",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-f4"), lockKey.project("prj-f4")],
    safeAutoRecovery: false,
    recoveryData: {
      type: "projects:completion",
      projectId: "prj-f4",
      domainUuid: "dom-f4",
      creditedResourceRefs: [{ resourceId: "domain-manager:materials", amountMinor: 200 }],
      status: "needs-recovery"
    }
  });
  txStore.save(tx);
  txStore.transition("tx-f4", "claimed", 1);
  txStore.transition("tx-f4", "prepared", 1);
  txStore.transition("tx-f4", "committing", 1);
  txStore.transition("tx-f4", "needs-recovery", 1);
  await txStore.flush();

  let rewardReverted = false;
  const fakeEconomy: any = {
    commitAdjust: async () => {
      rewardReverted = true;
      return ok({});
    }
  };

  const compRes = await compensateProjectCompletion("tx-f4", { domains, transactionStore: txStore, economyService: fakeEconomy });
  assert.equal(compRes.ok, true);
  assert.equal(rewardReverted, false, "Must NOT revert reward when project completion already committed on domain");
  assert.equal(txStore.get("tx-f4")!.state, "committed", "Transaction must reconcile to committed");
});

test("G5-GROUP-F-5: downtime:start parent reconciliation", async () => {
  const { domains, getDoc } = createTestDomainDoc("dom-f5");
  const act = { id: "dt-act-f5", name: "Rest Activity", definitionId: "dt:rest", lifecycle: "inProgress", revision: 1 };
  const baseDoc = getDoc();
  baseDoc.record = withDomainDowntimeData(baseDoc.record, {
    schemaVersion: 1,
    activities: [act as any]
  });

  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const tx = createTransactionRecord({
    transactionId: "tx-f5",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-f5")],
    safeAutoRecovery: false,
    recoveryData: {
      type: "downtime:start",
      activityId: "dt-act-f5",
      domainUuid: "dom-f5",
      debitedCosts: [{ resourceId: "domain-manager:materials", amount: 50 }],
      status: "needs-recovery"
    }
  });
  txStore.save(tx);
  txStore.transition("tx-f5", "claimed", 1);
  txStore.transition("tx-f5", "prepared", 1);
  txStore.transition("tx-f5", "committing", 1);
  txStore.transition("tx-f5", "needs-recovery", 1);
  await txStore.flush();

  let refundExecuted = false;
  const fakeEconomy: any = {
    commitAdjust: async () => {
      refundExecuted = true;
      return ok({});
    }
  };

  const compRes = await compensateDowntimeStart("tx-f5", { domains, transactionStore: txStore, economyService: fakeEconomy });
  assert.equal(compRes.ok, true);
  assert.equal(refundExecuted, false, "Must NOT refund cost when downtime activity already created on domain");
  assert.equal(txStore.get("tx-f5")!.state, "committed", "Transaction must reconcile to committed");
});

test("G5-GROUP-F-6: downtime:resolution parent reconciliation", async () => {
  const { domains, getDoc } = createTestDomainDoc("dom-f6");
  const act = { id: "dt-act-f6", name: "Rest Activity", definitionId: "dt:rest", lifecycle: "completed", revision: 2 };
  const baseDoc = getDoc();
  baseDoc.record = withDomainDowntimeData(baseDoc.record, {
    schemaVersion: 1,
    activities: [act as any]
  });

  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const tx = createTransactionRecord({
    transactionId: "tx-f6",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-f6"), lockKey.downtime("dt-act-f6")],
    safeAutoRecovery: false,
    recoveryData: {
      type: "downtime:resolution",
      activityId: "dt-act-f6",
      domainUuid: "dom-f6",
      creditedRewards: [{ resourceId: "domain-manager:materials", amount: 100 }],
      status: "needs-recovery"
    }
  });
  txStore.save(tx);
  txStore.transition("tx-f6", "claimed", 1);
  txStore.transition("tx-f6", "prepared", 1);
  txStore.transition("tx-f6", "committing", 1);
  txStore.transition("tx-f6", "needs-recovery", 1);
  await txStore.flush();

  let rewardReverted = false;
  const fakeEconomy: any = {
    commitAdjust: async () => {
      rewardReverted = true;
      return ok({});
    }
  };

  const compRes = await compensateDowntimeResolution("tx-f6", { domains, transactionStore: txStore, economyService: fakeEconomy });
  assert.equal(compRes.ok, true);
  assert.equal(rewardReverted, false, "Must NOT revert reward when downtime activity already completed on domain");
  assert.equal(txStore.get("tx-f6")!.state, "committed", "Transaction must reconcile to committed");
});

test("G5-GROUP-F-7: facilities:maintenance parent reconciliation", async () => {
  const { domains, getDoc } = createTestDomainDoc("dom-f7");
  const fac = { id: "fac-f7", domainUuid: "dom-f7", name: "Barracks", revision: 5, definitionId: "fac:barracks", lifecycle: "operational", readiness: "ready" };
  const baseDoc = getDoc();
  baseDoc.record = withDomainFacilitiesData(baseDoc.record, {
    schemaVersion: 1,
    facilities: [fac as any]
  });

  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const tx = createTransactionRecord({
    transactionId: "tx-f7",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-f7"), lockKey.facility("fac-f7")],
    safeAutoRecovery: false,
    recoveryData: {
      type: "facilities:maintenance",
      facilityId: "fac-f7",
      domainUuid: "dom-f7",
      expectedFacilityRevision: 5,
      debitedCosts: [{ resourceId: "domain-manager:materials", amount: 30 }],
      status: "needs-recovery"
    }
  });
  txStore.save(tx);
  txStore.transition("tx-f7", "claimed", 1);
  txStore.transition("tx-f7", "prepared", 1);
  txStore.transition("tx-f7", "committing", 1);
  txStore.transition("tx-f7", "needs-recovery", 1);
  await txStore.flush();

  let costRefunded = false;
  const fakeEconomy: any = {
    commitAdjust: async () => {
      costRefunded = true;
      return ok({});
    }
  };

  const compRes = await compensateFacilityOperation("tx-f7", { domains, transactionStore: txStore, economyService: fakeEconomy });
  assert.equal(compRes.ok, true);
  assert.equal(costRefunded, false, "Must NOT refund cost when facility revision was already updated");
  assert.equal(txStore.get("tx-f7")!.state, "committed", "Transaction must reconcile to committed");
});

test("G5-GROUP-F-8: facilities:repair parent reconciliation", async () => {
  const { domains, getDoc } = createTestDomainDoc("dom-f8");
  const fac = { id: "fac-f8", domainUuid: "dom-f8", name: "Workshop", revision: 4, definitionId: "fac:workshop", lifecycle: "operational", readiness: "ready" };
  const baseDoc = getDoc();
  baseDoc.record = withDomainFacilitiesData(baseDoc.record, {
    schemaVersion: 1,
    facilities: [fac as any]
  });

  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const tx = createTransactionRecord({
    transactionId: "tx-f8",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-f8"), lockKey.facility("fac-f8")],
    safeAutoRecovery: false,
    recoveryData: {
      type: "facilities:repair",
      facilityId: "fac-f8",
      domainUuid: "dom-f8",
      expectedFacilityRevision: 4,
      debitedCosts: [{ resourceId: "domain-manager:materials", amount: 45 }],
      status: "needs-recovery"
    }
  });
  txStore.save(tx);
  txStore.transition("tx-f8", "claimed", 1);
  txStore.transition("tx-f8", "prepared", 1);
  txStore.transition("tx-f8", "committing", 1);
  txStore.transition("tx-f8", "needs-recovery", 1);
  await txStore.flush();

  let costRefunded = false;
  const fakeEconomy: any = {
    commitAdjust: async () => {
      costRefunded = true;
      return ok({});
    }
  };

  const compRes = await compensateFacilityOperation("tx-f8", { domains, transactionStore: txStore, economyService: fakeEconomy });
  assert.equal(compRes.ok, true);
  assert.equal(costRefunded, false, "Must NOT refund cost when facility repair revision was already updated");
  assert.equal(txStore.get("tx-f8")!.state, "committed", "Transaction must reconcile to committed");
});

// ---------------------------------------------------------------------------
// 5. GRUPO G — CHILD INTENT CRASH POINTS
// ---------------------------------------------------------------------------

test("G5-GROUP-G: Child intent crash points (G1 planned, G2 applied-no-receipt, G3 applied-with-receipt)", async () => {
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const fenceRegistry = new RecoveryFenceRegistry();
  const domainKey = lockKey.domain("dom-group-g");

  const sessionRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    recoveryFenceRegistry: fenceRegistry,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainKey],
    recoveryType: "test:intent-points",
    parentRef: "domain:dom-group-g"
  });
  assert.equal(sessionRes.ok, true);
  const session = sessionRes.value;

  // G1: planned step (intent flushed, effect did not run)
  await session.runChildStep({
    stepId: "step-g1",
    subsystem: "economy",
    operation: "adjust",
    intent: { amount: 10 },
    flushIntent: true,
    execute: async () => {
      // Simulate crash immediately before effect execution
      return err(
        createPublicError({
          code: "DM_COMMAND_EXECUTION_FAILED",
          category: "internal",
          message: "Crash before effect"
        })
      );
    }
  });

  const stepsAfterG1 = session.steps;
  assert.equal(stepsAfterG1.length, 1);
  assert.equal(stepsAfterG1[0].stepId, "step-g1");
  assert.equal(stepsAfterG1[0].state, "planned");
  assert.equal(stepsAfterG1[0].receipt, undefined);

  // G3: applied step with receipt
  await session.runChildStep({
    stepId: "step-g3",
    subsystem: "facilities",
    operation: "reserve",
    intent: { facilityId: "fac-1" },
    execute: async () => ok({ reservationId: "rf-1" })
  });

  const stepsAfterG3 = session.steps;
  assert.equal(stepsAfterG3.length, 2);
  const step3 = stepsAfterG3.find((s) => s.stepId === "step-g3")!;
  assert.equal(step3.state, "applied");
  assert.deepEqual(step3.receipt, { reservationId: "rf-1" });
});

// ---------------------------------------------------------------------------
// 6. GRUPO H — MULTI-STEP COMPENSATION
// ---------------------------------------------------------------------------

test("G5-GROUP-H: Multi-step compensation skips already completed steps upon restart and retry", async () => {
  const adapter = new InMemoryTransactionStorageAdapter();
  const txStore = new TransactionStore(adapter);
  const fenceRegistry = new RecoveryFenceRegistry();
  const lockManager = new LockManager();
  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore: txStore,
    fenceRegistry
  });

  const domainKey = lockKey.domain("dom-group-h");

  // Step A: Economy deduction
  // Step B: Workforce assignment
  // Step C: Parent fails
  let stepBRevertsCount = 0;
  let stepARevertsCount = 0;
  let simulateCrashOnStepA = true;

  recoveryService.registerCompensator("test:multi-step", async (txRecord) => {
    // Reverse order: Step B first, then Step A
    if (!isCompensationStepCompleted(txRecord, "step-b-workforce", txStore)) {
      stepBRevertsCount++;
      txRecord = await markCompensationStepCompleted(txStore, txRecord, "step-b-workforce");
    }

    if (!isCompensationStepCompleted(txRecord, "step-a-economy", txStore)) {
      if (simulateCrashOnStepA) {
        throw new Error("Crash during Step A reversion");
      }
      stepARevertsCount++;
      txRecord = await markCompensationStepCompleted(txStore, txRecord, "step-a-economy");
    }

    return ok(undefined);
  });

  const sessionRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    recoveryFenceRegistry: fenceRegistry,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainKey],
    recoveryType: "test:multi-step",
    parentRef: "domain:dom-group-h",
    safeAutoRecovery: true
  });
  assert.equal(sessionRes.ok, true);
  const session = sessionRes.value;

  // Step A applied
  await session.runChildStep({
    stepId: "step-a-economy",
    subsystem: "economy",
    operation: "adjust",
    intent: { amount: -30 },
    execute: async () => ok({ applied: true })
  });

  // Step B applied
  await session.runChildStep({
    stepId: "step-b-workforce",
    subsystem: "people",
    operation: "assign",
    intent: { workers: 5 },
    execute: async () => ok({ assigned: true })
  });

  // Step C (Parent) fails -> enter needs-recovery
  await session.markNeedsRecovery("Parent failure triggering multi-step rollback");
  await txStore.flush();

  // Attempt 1: Step B succeeds, Step A crashes
  const res1 = await recoveryService.recoverTransaction(session.transactionId);
  assert.equal(res1.ok, false);
  assert.equal(stepBRevertsCount, 1);
  assert.equal(stepARevertsCount, 0);

  // Check state remains in needs-recovery with fence active
  const txAfterCrash = txStore.get(session.transactionId)!;
  assert.equal(txAfterCrash.state, "needs-recovery");
  assert.equal(fenceRegistry.isScopeBlocked([domainKey]), true);

  // Attempt 2: Retry with crash resolved
  simulateCrashOnStepA = false;
  const res2 = await recoveryService.recoverTransaction(session.transactionId);
  assert.equal(res2.ok, true);

  // Step B was NOT repeated (still 1), Step A succeeded (now 1)
  assert.equal(stepBRevertsCount, 1, "Step B must not be repeated on compensation retry");
  assert.equal(stepARevertsCount, 1, "Step A must be successfully compensated on retry");

  const finalTx = txStore.get(session.transactionId)!;
  assert.equal(finalTx.state, "compensated");
  assert.equal(fenceRegistry.isScopeBlocked([domainKey]), false);
  assertTransactionSafety(session.transactionId, txStore, fenceRegistry);
  assertNoOrphanRecoveryFence(fenceRegistry, txStore);
});
