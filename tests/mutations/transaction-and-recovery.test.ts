import assert from "node:assert/strict";
import test from "node:test";
import { LockManager } from "../../src/mutations/lock-manager.js";
import {
  createTransactionRecord,
  isValidTransactionTransition,
  transitionTransactionState,
  isFinalTransactionState
} from "../../src/mutations/transaction-record.js";
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { RecoveryService } from "../../src/mutations/recovery-service.js";
import { createCommandId } from "../../src/commands/command-envelope.js";
import { ok, err } from "../../src/core/contracts/result.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";

test("TransactionRecord enforces valid lifecycle transitions and rejects invalid state jumps", () => {
  const record = createTransactionRecord({
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: ["domain:alpha"]
  });

  assert.equal(record.state, "planned");
  assert.equal(isFinalTransactionState(record.state), false);
  assert.equal(isValidTransactionTransition("planned", "claimed"), true);
  assert.equal(isValidTransactionTransition("planned", "committed"), false);

  // Valid: planned -> claimed
  const claimedRes = transitionTransactionState(record, "claimed", 1);
  assert.equal(claimedRes.ok, true);
  if (!claimedRes.ok) return;

  // Valid: claimed -> prepared -> committing -> committed
  const prepRes = transitionTransactionState(claimedRes.value, "prepared", 1);
  assert.equal(prepRes.ok, true);
  if (!prepRes.ok) return;

  const commitRes = transitionTransactionState(prepRes.value, "committing", 1);
  assert.equal(commitRes.ok, true);
  if (!commitRes.ok) return;

  const finalRes = transitionTransactionState(commitRes.value, "committed", 1);
  assert.equal(finalRes.ok, true);
  if (!finalRes.ok) return;

  assert.equal(isFinalTransactionState(finalRes.value.state), true);

  // Invalid: cannot transition from committed to planned
  const invalidRes = transitionTransactionState(finalRes.value, "planned", 1);
  assert.equal(invalidRes.ok, false);
  if (!invalidRes.ok) {
    assert.equal(invalidRes.error.code, "DM_TRANSACTION_INVALID_TRANSITION");
  }
});

test("RecoveryService startup scan detects uncommitted transaction from previous session and isolates keys", async () => {
  const store = new TransactionStore();
  const lockManager = new LockManager();
  const recoveryService = new RecoveryService({
    transactionStore: store,
    lockManager
  });

  // Simulate an old transaction left in "committing" during previous crash
  const oldTx = createTransactionRecord({
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: ["domain:damaged-realm"]
  });

  const claimed = transitionTransactionState(oldTx, "claimed", 1);
  assert.equal(claimed.ok, true);
  const prepared = transitionTransactionState(claimed.value!, "prepared", 1);
  assert.equal(prepared.ok, true);
  const committing = transitionTransactionState(prepared.value!, "committing", 1);
  assert.equal(committing.ok, true);

  store.save(committing.value!);

  // Authority restarts in epoch 2
  const unresolved = await recoveryService.scanOnStartup(2);
  assert.equal(unresolved.length, 1);

  const scannedRecord = store.get(oldTx.transactionId);
  assert.ok(scannedRecord);
  assert.equal(scannedRecord.state, "needs-recovery");
  assert.equal(scannedRecord.authorityEpoch, 2);

  // Affected keys must be locked by recovery
  assert.equal(lockManager.isLocked("domain:damaged-realm"), true);

  // Independent domains remain operable and can acquire locks
  const independentLock = await lockManager.acquireLocks({
    ownerId: "cmd-healthy",
    keys: ["domain:healthy-realm"]
  });
  assert.equal(independentLock.ok, true);
  if (independentLock.ok) {
    independentLock.value.release();
  }

  recoveryService.clear();
});

test("RecoveryService supports idempotent repeated recovery execution", async () => {
  const store = new TransactionStore();
  const lockManager = new LockManager();
  const recoveryService = new RecoveryService({
    transactionStore: store,
    lockManager
  });

  const tx = createTransactionRecord({
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: ["domain:recoverable"]
  });
  const claimed = transitionTransactionState(tx, "claimed", 1);
  assert.equal(claimed.ok, true);
  const prep = transitionTransactionState(claimed.value!, "prepared", 1);
  assert.equal(prep.ok, true);
  const needsRec = transitionTransactionState(prep.value!, "needs-recovery", 1);
  assert.equal(needsRec.ok, true);
  store.save(needsRec.value!);

  let compensatorCalls = 0;
  const compensator = async () => {
    compensatorCalls++;
    return ok(undefined);
  };

  // 1. First recovery attempt
  const recResult1 = await recoveryService.recoverTransaction(
    tx.transactionId,
    2,
    compensator
  );
  assert.equal(recResult1.ok, true);
  if (recResult1.ok) {
    assert.equal(recResult1.value.state, "compensated");
  }
  assert.equal(compensatorCalls, 1);
  // Lock should be released
  assert.equal(lockManager.isLocked("domain:recoverable"), false);

  // 2. Second recovery attempt on already-compensated transaction (IDEMPOTENCE)
  const recResult2 = await recoveryService.recoverTransaction(
    tx.transactionId,
    2,
    compensator
  );
  assert.equal(recResult2.ok, true);
  if (recResult2.ok) {
    assert.equal(recResult2.value.state, "compensated");
  }
  // Compensator must NOT run a second time
  assert.equal(compensatorCalls, 1);
});

test("RecoveryService keeps transaction in needs-recovery when compensation fails", async () => {
  const store = new TransactionStore();
  const lockManager = new LockManager();
  const recoveryService = new RecoveryService({
    transactionStore: store,
    lockManager
  });

  const tx = createTransactionRecord({
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: ["domain:failing-recovery"]
  });
  const claimed = transitionTransactionState(tx, "claimed", 1);
  assert.equal(claimed.ok, true);
  const prep = transitionTransactionState(claimed.value!, "prepared", 1);
  assert.equal(prep.ok, true);
  const needsRec = transitionTransactionState(prep.value!, "needs-recovery", 1);
  assert.equal(needsRec.ok, true);
  store.save(needsRec.value!);

  const failingCompensator = async () => {
    return err(
      createPublicError({
        code: "DM_EXTERNAL_API_UNREACHABLE",
        category: "provider",
        message: "Item piles service failed during rollback"
      })
    );
  };

  const recResult = await recoveryService.recoverTransaction(
    tx.transactionId,
    2,
    failingCompensator
  );

  assert.equal(recResult.ok, false);
  if (!recResult.ok) {
    assert.equal(recResult.error.code, "DM_RECOVERY_COMPENSATION_FAILED");
  }

  // Record must still be in needs-recovery state, NOT compensated
  const record = store.get(tx.transactionId);
  assert.ok(record);
  assert.equal(record.state, "needs-recovery");
});
