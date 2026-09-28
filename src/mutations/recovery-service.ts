import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import type { LockManager, LockHandle } from "./lock-manager.js";
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

    for (const record of unresolved) {
      // DEC-724–731: "committing após failover vira needs-recovery até reconciliation."
      // Also, interrupted compensations from a previous crash must transition back to needs-recovery
      // so a new recovery attempt can transition needs-recovery -> compensating without invalid state jump.
      if (record.state === "committing" || record.state === "compensating") {
        this.#transactionStore.transition(
          record.transactionId,
          "needs-recovery",
          currentEpoch,
          `Startup recovery scan: transition ${record.state} transaction to needs-recovery`
        );
        transitionedAny = true;
      } else if (record.state === "claimed" || record.state === "planned") {
        this.#transactionStore.transition(
          record.transactionId,
          "failed",
          currentEpoch,
          `Startup recovery scan: transaction abandoned in ${record.state} state during failover`
        );
        transitionedAny = true;
      }

      // Block affected lock keys so damaged domains are protected while independent domains continue
      const currentTx = this.#transactionStore.get(record.transactionId) ?? record;
      if (
        !isFinalTransactionState(currentTx.state) &&
        currentTx.lockKeys.length > 0 &&
        this.#lockManager &&
        !this.#heldRecoveryLocks.has(currentTx.transactionId)
      ) {
        const freeKeys = currentTx.lockKeys.filter((k) => !this.#lockManager!.isLocked(k));
        if (freeKeys.length > 0) {
          const lockRes = await this.#lockManager.acquireLocks({
            ownerId: `recovery_${currentTx.transactionId}`,
            keys: freeKeys,
            timeoutMs: 50
          });
          if (lockRes.ok) {
            this.#heldRecoveryLocks.set(currentTx.transactionId, lockRes.value);
          }
        }
      }
    }

    if (transitionedAny) {
      try {
        await this.#transactionStore.flush();
      } catch {
        // Startup scan best-effort flush; unresolved list is re-queried below
      }
    }

    return this.#transactionStore.listUnresolved();
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
    const unresolved = await this.scanOnStartup(currentEpoch);
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
    await transactionStore.flush();
  }
  return updatedRecord;
}
