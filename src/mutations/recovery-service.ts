import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { canonicalizeLockKeys, type LockManager, type LockHandle } from "./lock-manager.js";
import {
  isFinalTransactionState,
  type TransactionRecord
} from "./transaction-record.js";
import type { TransactionStore } from "./transaction-store.js";

export interface RecoveryServiceOptions {
  readonly transactionStore: TransactionStore;
  readonly lockManager: LockManager;
}

export type TransactionCompensator = (
  record: TransactionRecord
) => Promise<Result<void, PublicError>>;

/**
 * RecoveryService — Coordinates durable transaction recovery on startup and failover
 * (Master Spec §11.10, §35, DEC-681–696, DEC-724–731, DEC-827–834).
 *
 * Enforces:
 * 1. Startup scan identifies unresolved transactions from prior crashes or failovers.
 * 2. Unresolved transactions left in "committing" are transitioned to "needs-recovery".
 * 3. Affected lock keys are blocked during recovery while independent domains remain operational.
 * 4. Recovery is strictly idempotent: executing recovery multiple times on the same transaction is safe.
 * 5. Manual / auto-recovery transition flow: needs-recovery -> compensating -> compensated (or remains needs-recovery if compensation fails).
 */
export class RecoveryService {
  readonly #transactionStore: TransactionStore;
  readonly #lockManager: LockManager;
  readonly #heldRecoveryLocks = new Map<string, LockHandle>();
  readonly #compensators = new Map<string, TransactionCompensator>();

  constructor(options: RecoveryServiceOptions | TransactionStore, lockManager?: LockManager) {
    if ("transactionStore" in options) {
      this.#transactionStore = options.transactionStore;
      this.#lockManager = options.lockManager;
    } else {
      this.#transactionStore = options;
      this.#lockManager = lockManager!;
    }
  }

  registerCompensator(type: string, compensator: TransactionCompensator): void {
    this.#compensators.set(type, compensator);
  }

  getCompensator(type: string): TransactionCompensator | undefined {
    return this.#compensators.get(type);
  }

  /**
   * Scans for unresolved transactions at startup or after authority failover.
   */
  async scanOnStartup(
    currentEpoch: number
  ): Promise<readonly TransactionRecord[]> {
    const unresolved = this.#transactionStore.listUnresolved();
    let transitionedAny = false;
    const originalRecords = new Map<string, TransactionRecord>();

    for (const record of unresolved) {
      // DEC-724–731: "committing após failover vira needs-recovery até reconciliation."
      // Also, interrupted compensations from a previous crash must transition back to needs-recovery
      // so a new recovery attempt can transition needs-recovery -> compensating without invalid state jump.
      if (record.state === "committing" || record.state === "compensating") {
        originalRecords.set(record.transactionId, { ...record });
        this.#transactionStore.transition(
          record.transactionId,
          "needs-recovery",
          currentEpoch,
          `Startup recovery scan: transition ${record.state} transaction to needs-recovery`
        );
        transitionedAny = true;
      } else if (record.state === "claimed" || record.state === "planned") {
        originalRecords.set(record.transactionId, { ...record });
        this.#transactionStore.transition(
          record.transactionId,
          "failed",
          currentEpoch,
          `Startup recovery scan: transaction abandoned in ${record.state} state during failover`
        );
        transitionedAny = true;
      }

      // Block affected lock keys atomically (G5-REVAL6-003: NEVER partial keys!)
      const currentTx = this.#transactionStore.get(record.transactionId) ?? record;
      if (
        !isFinalTransactionState(currentTx.state) &&
        currentTx.lockKeys.length > 0 &&
        this.#lockManager &&
        !this.#heldRecoveryLocks.has(currentTx.transactionId)
      ) {
        const requiredKeys = canonicalizeLockKeys(currentTx.lockKeys);
        const lockRes = await this.#lockManager.acquireLocks({
          ownerId: `recovery_${currentTx.transactionId}`,
          keys: requiredKeys,
          timeoutMs: 50
        });
        if (lockRes.ok) {
          this.#heldRecoveryLocks.set(currentTx.transactionId, lockRes.value);
        }
      }
    }

    if (transitionedAny) {
      try {
        await this.#transactionStore.flush();
      } catch (flushErr) {
        // G5-REVAL6-004: Fail-closed if recovery transitions cannot be persisted:
        // Revert in-memory transitions so unpersisted states do not trigger premature recovery
        for (const [txId, orig] of originalRecords.entries()) {
          this.#transactionStore.save(orig);
        }
        throw createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: `Failed to persist recovery transitions during startup scan: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`
        });
      }
    }

    return this.#transactionStore.listUnresolved();
  }

  hasHeldRecoveryLock(transactionId: string): boolean {
    return this.#heldRecoveryLocks.has(transactionId);
  }

  getHeldRecoveryLock(transactionId: string): LockHandle | undefined {
    return this.#heldRecoveryLocks.get(transactionId);
  }

  /**
   * Immediately isolates affected lock keys for a transaction that entered needs-recovery in runtime
   * (G5-REVAL6-003). If an active lockHandle is provided (e.g. from the current command), atomically transfers
   * ownership to recovery_<txId> so no other mutation can slip in. Otherwise, acquires all lockKeys atomically.
   */
  async isolateTransaction(
    recordOrId: TransactionRecord | string,
    existingHandle?: LockHandle
  ): Promise<Result<void, PublicError>> {
    const record =
      typeof recordOrId === "string" ? this.#transactionStore.get(recordOrId) : recordOrId;
    if (!record) {
      return ok(undefined);
    }
    if (this.#heldRecoveryLocks.has(record.transactionId)) {
      return ok(undefined);
    }
    if (record.lockKeys.length === 0) {
      return ok(undefined);
    }

    const recoveryOwnerId = `recovery_${record.transactionId}`;

    // If an existing lock handle is provided (e.g. from the currently running command),
    // atomically transfer it so no other mutation can slip in.
    if (existingHandle && existingHandle.keys.length > 0) {
      const transferRes = this.#lockManager.transferLock(existingHandle, recoveryOwnerId);
      if (transferRes.ok) {
        this.#heldRecoveryLocks.set(record.transactionId, transferRes.value);
        return ok(undefined);
      }
    }

    // Otherwise, acquire the complete lock set atomically
    const requiredKeys = canonicalizeLockKeys(record.lockKeys);
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: recoveryOwnerId,
      keys: requiredKeys,
      timeoutMs: 1000
    });
    if (!lockRes.ok) {
      return lockRes;
    }
    this.#heldRecoveryLocks.set(record.transactionId, lockRes.value);
    return ok(undefined);
  }

  /**
   * Idempotently recovers an unresolved transaction.
   */
  async recoverTransaction(
    transactionId: string,
    currentEpoch: number = 1,
    compensator?: TransactionCompensator
  ): Promise<Result<TransactionRecord, PublicError>> {
    const record = this.#transactionStore.get(transactionId);
    if (!record) {
      return err(
        createPublicError({
          code: "DM_RECOVERY_TX_NOT_FOUND",
          category: "not-found",
          message: `Transaction '${transactionId}' does not exist`
        })
      );
    }

    // IDEMPOTENCE (DEC-845–858): If already in a final state, repeated recovery is a safe no-op
    if (isFinalTransactionState(record.state)) {
      this.#releaseRecoveryLock(transactionId);
      return ok(record);
    }

    // G5-REVAL6-003: Recovery must possess the complete lock set atomically before proceeding
    const requiredKeys = canonicalizeLockKeys(record.lockKeys);
    let heldHandle = this.#heldRecoveryLocks.get(transactionId);
    const isFullLockHeld =
      heldHandle &&
      requiredKeys.every((k) => heldHandle!.keys.includes(k));

    if (!isFullLockHeld && requiredKeys.length > 0) {
      if (heldHandle) {
        heldHandle.release();
        this.#heldRecoveryLocks.delete(transactionId);
      }
      const lockRes = await this.#lockManager.acquireLocks({
        ownerId: `recovery_${transactionId}`,
        keys: requiredKeys,
        timeoutMs: 2000
      });
      if (!lockRes.ok) {
        return err(
          createPublicError({
            code: "DM_RECOVERY_LOCK_FAILED",
            category: "busy",
            message: `Cannot execute recovery for transaction '${transactionId}': lock set [${requiredKeys.join(", ")}] could not be fully acquired: ${lockRes.error.message}`
          })
        );
      }
      this.#heldRecoveryLocks.set(transactionId, lockRes.value);
    }

    // Transition to compensating
    const compTransition = this.#transactionStore.transition(
      transactionId,
      "compensating",
      currentEpoch,
      "Starting compensation attempt"
    );

    if (!compTransition.ok) {
      return compTransition;
    }

    const recoveryType = (record.recoveryData as any)?.type;
    const effectiveCompensator =
      compensator ?? (recoveryType ? this.#compensators.get(recoveryType) : undefined);

    if (!effectiveCompensator) {
      // G2-AUD-011: Without a verified compensation/reconciliation strategy,
      // transaction must NOT be marked 'compensated'. It remains in 'needs-recovery'.
      this.#transactionStore.transition(
        transactionId,
        "needs-recovery",
        currentEpoch,
        "Recovery halted: No compensator provided for unresolved transaction"
      );
      return err(
        createPublicError({
          code: "DM_RECOVERY_COMPENSATION_UNAVAILABLE",
          category: "recovery",
          message: `Cannot compensate transaction '${transactionId}' without a verified compensator`,
          userActionRequired: true,
          retryable: false
        })
      );
    }

    try {
      const compRes = await effectiveCompensator(compTransition.value);
      if (!compRes.ok) {
        // Compensation failed: remains in needs-recovery
        this.#transactionStore.transition(
          transactionId,
          "needs-recovery",
          currentEpoch,
          `Compensation failed: ${compRes.error.message}`
        );
        return err(
          createPublicError({
            code: "DM_RECOVERY_COMPENSATION_FAILED",
            category: "recovery",
            message: `Compensation failed during recovery: ${compRes.error.message}`
          })
        );
      }
    } catch (error) {
      this.#transactionStore.transition(
        transactionId,
        "needs-recovery",
        currentEpoch,
        `Compensation threw exception: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      return err(
        createPublicError({
          code: "DM_RECOVERY_COMPENSATION_FAILED",
          category: "recovery",
          message: `Compensation threw exception: ${error instanceof Error ? error.message : "Unknown error"}`
        })
      );
    }

    // Check if compensator already moved the transaction to a final state (e.g. committed during reconciliation)
    const currentTx = this.#transactionStore.get(transactionId);
    if (currentTx && isFinalTransactionState(currentTx.state)) {
      this.#releaseRecoveryLock(transactionId);
      return ok(currentTx);
    }

    // Successfully compensated
    const finalTransition = this.#transactionStore.transition(
      transactionId,
      "compensated",
      currentEpoch,
      "Transaction successfully compensated during recovery"
    );

    if (finalTransition.ok) {
      try {
        await this.#transactionStore.flush();
      } catch (flushErr) {
        this.#transactionStore.transition(
          transactionId,
          "needs-recovery",
          currentEpoch,
          `Failed to flush compensated state: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`
        );
        return err(
          createPublicError({
            code: "DM_DOMAIN_STORAGE_ERROR",
            category: "internal",
            message: `Transaction compensated in memory but failed to flush to storage: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`
          })
        );
      }
    }

    this.#releaseRecoveryLock(transactionId);
    return finalTransition;
  }

  #releaseRecoveryLock(transactionId: string): void {
    const handle = this.#heldRecoveryLocks.get(transactionId);
    if (handle) {
      handle.release();
      this.#heldRecoveryLocks.delete(transactionId);
    }
  }

  /**
   * Recovers unresolved transactions using registered compensators.
   * Auto-recovers ONLY transactions where safeAutoRecovery === true unless includeUnsafe is explicitly requested
   * (Master Spec §11.10, G5-REVAL5-001). Transactions left without auto-recovery remain in needs-recovery.
   */
  async recoverAll(
    currentEpoch: number,
    options?: { readonly includeUnsafe?: boolean }
  ): Promise<readonly Result<TransactionRecord, PublicError>[]> {
    let unresolved: readonly TransactionRecord[];
    try {
      unresolved = await this.scanOnStartup(currentEpoch);
    } catch (scanErr) {
      return Object.freeze([
        err(
          scanErr && typeof scanErr === "object" && "code" in scanErr
            ? (scanErr as unknown as PublicError)
            : createPublicError({
                code: "DM_DOMAIN_STORAGE_ERROR",
                category: "internal",
                message: `Startup recovery scan failed: ${scanErr instanceof Error ? scanErr.message : String(scanErr)}`
              })
        )
      ]);
    }
    const results: Result<TransactionRecord, PublicError>[] = [];
    for (const tx of unresolved) {
      if (!isFinalTransactionState(tx.state)) {
        if (!tx.safeAutoRecovery && !options?.includeUnsafe) {
          continue;
        }
        const res = await this.recoverTransaction(tx.transactionId, currentEpoch);
        results.push(res);
      }
    }
    return Object.freeze(results);
  }

  clear(): void {
    for (const handle of this.#heldRecoveryLocks.values()) {
      handle.release();
    }
    this.#heldRecoveryLocks.clear();
  }
}

/**
 * Checks whether a compensation step has already been completed during a prior recovery attempt
 * (G5-REVAL5-005: Idempotency under partial compensation failure and retry).
 */
export function isCompensationStepCompleted(
  record: TransactionRecord,
  stepId: string,
  transactionStore?: TransactionStore
): boolean {
  const currentRecord = transactionStore?.get(record.transactionId) ?? record;
  const data = currentRecord.recoveryData as Record<string, any> | undefined;
  const steps = data?.completedCompensationSteps;
  return Array.isArray(steps) && steps.includes(stepId);
}

/**
 * Persists progress of an individual compensation step to ensure idempotency across recovery retries
 * (G5-REVAL5-005).
 */
export async function markCompensationStepCompleted(
  transactionStore: TransactionStore | undefined,
  record: TransactionRecord,
  stepId: string
): Promise<TransactionRecord> {
  const currentRecord = transactionStore?.get(record.transactionId) ?? record;
  const currentData = (currentRecord.recoveryData as Record<string, any>) ?? {};
  const currentSteps: string[] = Array.isArray(currentData.completedCompensationSteps)
    ? [...currentData.completedCompensationSteps]
    : [];
  if (!currentSteps.includes(stepId)) {
    currentSteps.push(stepId);
  }
  const updatedRecord: TransactionRecord = {
    ...currentRecord,
    recoveryData: {
      ...currentData,
      completedCompensationSteps: Object.freeze(currentSteps)
    },
    updatedAt: Date.now()
  };
  if (transactionStore) {
    transactionStore.save(updatedRecord);
    try {
      await transactionStore.flush();
    } catch (flushErr) {
      // Revert in-memory save on flush failure so unconfirmed checkpoints are not falsely retained
      transactionStore.save(currentRecord);
      throw flushErr;
    }
  }
  return updatedRecord;
}
