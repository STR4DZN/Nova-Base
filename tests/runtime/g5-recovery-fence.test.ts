import test from "node:test";
import assert from "node:assert/strict";
import { RecoveryFenceRegistry } from "../../src/mutations/recovery-fence-registry.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { InMemoryTransactionStorageAdapter } from "../../src/mutations/transaction-storage-adapter.js";
import { RecoveryService } from "../../src/mutations/recovery-service.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { createTransactionRecord } from "../../src/mutations/transaction-record.js";
import { createCommandId } from "../../src/commands/command-envelope.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import { lockKey } from "../../src/mutations/lock-keys.js";
import { createMutationPlan } from "../../src/mutations/plans/plan-contract.js";
import { ok, err } from "../../src/core/contracts/result.js";

test("G5-FENCE-D1: Runtime fence blocks overlapping mutation immediately with DM_RECOVERY_SCOPE_BLOCKED", async () => {
  const fenceRegistry = new RecoveryFenceRegistry();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore,
    fenceRegistry
  });

  const coordinator = new MutationCoordinator({
    lockManager,
    transactionStore,
    recoveryService,
    fenceRegistry
  });

  const domainUuid = "domain-alpha";
  const projectLock = lockKey.project("prj-1");
  const domainLock = lockKey.domain(domainUuid);

  // Install fence on domain
  fenceRegistry.installFence({
    transactionId: "tx-fenced-1",
    lockKeys: [domainLock, projectLock],
    reason: "Transaction entered needs-recovery in runtime"
  });

  assert.equal(fenceRegistry.isScopeBlocked([domainLock]), true);
  assert.equal(fenceRegistry.isScopeBlocked([projectLock]), true);

  // Independent domain is not blocked
  const otherDomainLock = lockKey.domain("domain-beta");
  assert.equal(fenceRegistry.isScopeBlocked([otherDomainLock]), false);

  // Attempt mutation on fenced domain via coordinator
  const cmdContext = {
    command: {
      commandId: createCommandId(),
      commandType: "projects:advance-project",
      payload: { domainUuid }
    },
    senderUserId: "user-1",
    authorityEpoch: 1
  };

  const mutationDef = {
    getLockKeys: () => [domainLock, projectLock],
    freshRead: async () => ok({ revision: 1 }),
    buildPlan: async () => ok(createMutationPlan({
      commandId: cmdContext.command.commandId,
      lockKeys: [domainLock, projectLock],
      writeSet: [],
      summary: "test"
    })),
    commit: async () => ok({ changed: true, summary: "ok" })
  };

  const execRes = await coordinator.execute(cmdContext as any, mutationDef as any);
  assert.equal(execRes.ok, true);
  assert.equal(execRes.value.status, "rejected");
  assert.equal(execRes.value.error?.code, "DM_RECOVERY_SCOPE_BLOCKED");

  // Mutation on independent domain succeeds
  const otherContext = {
    command: {
      commandId: createCommandId(),
      commandType: "projects:advance-project",
      payload: { domainUuid: "domain-beta" }
    },
    senderUserId: "user-1",
    authorityEpoch: 1
  };

  const otherMutationDef = {
    getLockKeys: () => [otherDomainLock],
    freshRead: async () => ok({ revision: 1 }),
    buildPlan: async () => ok(createMutationPlan({
      commandId: otherContext.command.commandId,
      lockKeys: [otherDomainLock],
      writeSet: [],
      summary: "test-beta"
    })),
    commit: async () => ok({ changed: true, summary: "ok-beta" })
  };

  const otherRes = await coordinator.execute(otherContext as any, otherMutationDef as any);
  assert.equal(otherRes.ok, true);
  assert.equal(otherRes.value.status, "executed");

  // Removing fence unblocks the domain
  fenceRegistry.removeFence("tx-fenced-1");
  assert.equal(fenceRegistry.isScopeBlocked([domainLock]), false);

  const retryRes = await coordinator.execute(cmdContext as any, mutationDef as any);
  assert.equal(retryRes.ok, true);
  assert.equal(retryRes.value.status, "executed");
});

test("G5-FENCE-E1: scanOnStartup installs fence and acquires lock for unsafe transaction", async () => {
  const fenceRegistry = new RecoveryFenceRegistry();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore(new InMemoryTransactionStorageAdapter());

  const txId = createOpaqueId("tx");
  const domainLock = lockKey.domain("domain-e1");
  const tx = createTransactionRecord({
    transactionId: txId,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainLock],
    safeAutoRecovery: false,
    recoveryData: { type: "test", domainUuid: "domain-e1" }
  });
  transactionStore.save(tx);
  transactionStore.transition(txId, "claimed", 1, "claim");
  transactionStore.transition(txId, "needs-recovery", 1, "Crash before recovery");
  await transactionStore.flush();

  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore,
    fenceRegistry
  });

  const scanList = await recoveryService.scanOnStartup(1);
  assert.equal(scanList.length, 1);

  // Fence MUST be active for domain-e1
  assert.equal(fenceRegistry.isScopeBlocked([domainLock]), true);

  // Diagnostics reflects fence and held lock
  const diag = recoveryService.getDiagnostics();
  assert.equal(diag.recoveryFences.length, 1);
  assert.equal(diag.unresolvedTransactions.length, 1);
  assert.equal(diag.unresolvedTransactions[0].fenceActive, true);
  assert.equal(diag.unresolvedTransactions[0].physicalLockHeld, true);
});

test("G5-FENCE-E2: scanOnStartup installs fence even when physical lock is temporarily occupied", async () => {
  const fenceRegistry = new RecoveryFenceRegistry();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore(new InMemoryTransactionStorageAdapter());

  const txId = createOpaqueId("tx");
  const domainLock = lockKey.domain("domain-e2");
  const tx = createTransactionRecord({
    transactionId: txId,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainLock],
    safeAutoRecovery: false,
    recoveryData: { type: "test", domainUuid: "domain-e2" }
  });
  transactionStore.save(tx);
  transactionStore.transition(txId, "claimed", 1, "claim");
  transactionStore.transition(txId, "needs-recovery", 1, "Crash before recovery");
  await transactionStore.flush();

  // Occupy domainLock externally
  const occupant = await lockManager.acquireLocks({
    ownerId: "external-occupant",
    keys: [domainLock],
    timeoutMs: 50
  });
  assert.equal(occupant.ok, true);

  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore,
    fenceRegistry
  });
  recoveryService.registerCompensator("test", async () => ok(undefined));

  const scanList = await recoveryService.scanOnStartup(1);
  assert.equal(scanList.length, 1);

  // Even though physical lock acquisition failed, fence MUST be installed (INV-07, Master §10, §23)
  assert.equal(fenceRegistry.isScopeBlocked([domainLock]), true);

  const diag = recoveryService.getDiagnostics();
  assert.equal(diag.recoveryFences.length, 1);
  assert.equal(diag.unresolvedTransactions[0].fenceActive, true);
  assert.equal(diag.unresolvedTransactions[0].physicalLockHeld, false);
  assert.equal(diag.pendingRecoveryLockAcquisition.length, 1);

  // Release occupant lock
  await occupant.value.release();

  // After releasing, recovering transaction can now acquire full lock
  const recoverRes = await recoveryService.recoverTransaction(txId);
  // Reconciled / compensated cleanly
  assert.equal(recoverRes.ok, true);
  assert.equal(fenceRegistry.isScopeBlocked([domainLock]), false);
});

test("G5-FENCE-E3: scanOnStartup + recoverAll auto-recovers safe transaction with fence and physical lock", async () => {
  const fenceRegistry = new RecoveryFenceRegistry();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore(new InMemoryTransactionStorageAdapter());

  const txId = createOpaqueId("tx");
  const domainLock = lockKey.domain("domain-e3");
  const tx = createTransactionRecord({
    transactionId: txId,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainLock],
    safeAutoRecovery: true,
    recoveryData: { type: "test:safe-auto", domainUuid: "domain-e3" }
  });
  transactionStore.save(tx);
  transactionStore.transition(txId, "claimed", 1, "claim");
  transactionStore.transition(txId, "prepared", 1, "prepared");
  transactionStore.transition(txId, "committing", 1, "committing");
  await transactionStore.flush();

  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore,
    fenceRegistry
  });

  let compensatorCalled = false;
  recoveryService.registerCompensator("test:safe-auto", async (_txRecord) => {
    compensatorCalled = true;
    return ok(undefined);
  });

  // 1. scanOnStartup: installs fence, transitions committing to needs-recovery, acquires physical lock
  const scanList = await recoveryService.scanOnStartup(1);
  assert.equal(scanList.length, 1);
  assert.equal(scanList[0].state, "needs-recovery");
  assert.equal(fenceRegistry.isScopeBlocked([domainLock]), true, "Fence must be installed during scan");
  assert.equal(recoveryService.hasHeldRecoveryLock(txId), true, "Physical lock must be acquired");

  // 2. recoverAll: auto-recovers safeAutoRecovery: true transactions
  const results = await recoveryService.recoverAll(1);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(compensatorCalled, true, "Compensator must have run");

  // 3. Post-recovery assertions: fence removed, lock released, transaction compensated
  const finalTx = transactionStore.get(txId)!;
  assert.equal(finalTx.state, "compensated");
  assert.equal(fenceRegistry.isScopeBlocked([domainLock]), false, "Fence must be removed after successful recovery");
  assert.equal(recoveryService.hasHeldRecoveryLock(txId), false, "Physical lock must be released");

  const diag = recoveryService.getDiagnostics();
  assert.equal(diag.unresolvedTransactions.length, 0);
  assert.equal(diag.recoveryFences.length, 0);
});

test("G5-FENCE-I1: MutationCoordinator isolation failure keeps fence active and flags diagnostics", async () => {
  const fenceRegistry = new RecoveryFenceRegistry();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore(new InMemoryTransactionStorageAdapter());

  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore,
    fenceRegistry
  });

  const coordinator = new MutationCoordinator({
    lockManager,
    transactionStore,
    recoveryService,
    fenceRegistry
  });

  const domainLock = lockKey.domain("domain-i1");
  const projectLock = lockKey.project("prj-i1");

  // Create a context where command locks = [domainLock], but transaction record inside uses [domainLock, projectLock]
  const cmdContext = {
    command: {
      commandId: createCommandId(),
      commandType: "projects:start-project",
      payload: { domainUuid: "domain-i1" }
    },
    senderUserId: "user-1",
    authorityEpoch: 1
  };

  const mutationDef = {
    getLockKeys: () => [domainLock],
    freshRead: async () => ok({ revision: 1 }),
    buildPlan: async () => ok(createMutationPlan({
      commandId: cmdContext.command.commandId,
      lockKeys: [domainLock],
      writeSet: [],
      summary: "divergent"
    })),
    commit: async () => {
      // Simulate transaction recording diverging lock keys and entering needs-recovery
      const tx = createTransactionRecord({
        transactionId: "tx-divergent-1",
        commandId: cmdContext.command.commandId,
        authorityEpoch: 1,
        lockKeys: [domainLock, projectLock], // Divergent from command's [domainLock]
        safeAutoRecovery: false,
        recoveryData: { type: "test" }
      });
      transactionStore.save(tx);
      transactionStore.transition("tx-divergent-1", "claimed", 1, "claim");
      transactionStore.transition("tx-divergent-1", "needs-recovery", 1, "Simulated crash");
      return err(
        createPublicError({
          code: "DM_TEST_FAILURE" as any,
          category: "internal" as any,
          message: "Simulated domain write failure"
        })
      );
    }
  };

  const res = await coordinator.execute(cmdContext as any, mutationDef as any);
  assert.equal(res.ok, true);
  assert.equal(res.value.status, "rejected");

  // Coordinator should detect isolation divergence and report DM_RECOVERY_ISOLATION_FAILED
  assert.equal(res.value.error?.code, "DM_RECOVERY_ISOLATION_FAILED");

  // Fence MUST remain installed on the divergent keys
  assert.equal(fenceRegistry.isScopeBlocked([domainLock]), true);
  assert.equal(fenceRegistry.isScopeBlocked([projectLock]), true);
});
