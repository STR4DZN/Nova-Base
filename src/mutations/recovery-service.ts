import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { canonicalizeLockKeys, type LockManager, type LockHandle } from "./lock-manager.js";
import { areLockSetsEqual } from "./lock-keys.js";
import {
  RecoveryFenceRegistry,
  type RecoveryFence
} from "./recovery-fence-registry.js";
import {
  isFinalTransactionState,
  type TransactionRecord,
  type TransactionState
} from "./transaction-record.js";
import type { TransactionStore } from "./transaction-store.js";

export interface RecoveryServiceOptions {
  readonly transactionStore: TransactionStore;
  readonly lockManager: LockManager;
  readonly fenceRegistry?: RecoveryFenceRegistry;
}

export type TransactionCompensator = (
  record: TransactionRecord
) => Promise<Result<void, PublicError>>;

export interface RecoveryServiceDiagnostics {
  readonly unresolvedTransactions: readonly {
    readonly transactionId: string;
    readonly state: TransactionState;
    readonly safeAutoRecovery: boolean;
    readonly lockKeys: readonly string[];
    readonly fenceActive: boolean;
    readonly physicalLockHeld: boolean;
    readonly recoveryType?: string;
    readonly lastError?: string;
  }[];
  readonly recoveryFences: readonly RecoveryFence[];
  readonly pendingRecoveryLockAcquisition: readonly string[];
  readonly lockSetDivergences: readonly unknown[];
  readonly lastRecoveryError?: PublicError;
}

/**
 * RecoveryService — Coordinates durable transaction recovery on startup and failover
 * (Master Spec §11.10, §35, Master Remediation §8, §10, §11, §13, §23, §24, §25).
 *
 * Enforces:
 * 1. Startup scan identifies unresolved transactions from prior crashes or failovers.
 * 2. Unresolved transactions left in "committing" or "compensating" transition to "needs-recovery".
 * 3. Recovery fences are installed for all unresolved transactions, preventing concurrent work.
 * 4. Lock transfer requires EXACT lock set equality: rejects partial/divergent handles (INV-01, INV-08).
 * 5. Recovery execution requires the complete lock set atomically before executing compensation (INV-08).
 * 6. Safe auto-recovery vs manual recovery enforcement.
 * 7. Recovery is strictly idempotent.
 */
export class RecoveryService {
  readonly #transactionStore: TransactionStore;
  readonly #lockManager: LockManager;
  readonly #fenceRegistry: RecoveryFenceRegistry;
  readonly #heldRecoveryLocks = new Map<string, LockHandle>();
  readonly #compensators = new Map<string, TransactionCompensator>();
  readonly #pendingLockAcquisitions = new Set<string>();
  readonly #lockSetDivergences: unknown[] = [];
  readonly #lockReleaseUnsubscribe?: () => void;
  #lastRecoveryError?: PublicError;

  constructor(
    options: RecoveryServiceOptions | TransactionStore,
    lockManager?: LockManager,
    fenceRegistry?: RecoveryFenceRegistry
  ) {
    if ("transactionStore" in options) {
      this.#transactionStore = options.transactionStore;
      this.#lockManager = options.lockManager;
      this.#fenceRegistry = options.fenceRegistry ?? new RecoveryFenceRegistry();
    } else {
      this.#transactionStore = options;
      this.#lockManager = lockManager!;
      this.#fenceRegistry = fenceRegistry ?? new RecoveryFenceRegistry();
    }

    if (
      this.#lockManager &&
      "onLockReleased" in this.#lockManager &&
      typeof (this.#lockManager as any).onLockReleased === "function"
    ) {
      this.#lockReleaseUnsubscribe = (this.#lockManager as any).onLockReleased(() => {
        void this.retryPendingLockAcquisitions();
      });
    }
  }

  get fenceRegistry(): RecoveryFenceRegistry {
    return this.#fenceRegistry;
  }

  registerCompensator(type: string, compensator: TransactionCompensator): void {
    this.#compensators.set(type, compensator);
  }

  getCompensator(type: string): TransactionCompensator | undefined {
    return this.#compensators.get(type);
  }

  /**
   * Scans for unresolved transactions at startup or after authority failover (Master Remediation §23).
   * Installs recovery fences and attempts to acquire physical locks.
   */
  async scanOnStartup(
    currentEpoch: number
  ): Promise<readonly TransactionRecord[]> {
    const unresolved = this.#transactionStore.listUnresolved();
    let transitionedAny = false;
    const originalRecords = new Map<string, TransactionRecord>();

    for (const record of unresolved) {
      // DEC-724–731: "committing após failover vira needs-recovery até reconciliation."
      // Also, interrupted prepared or compensating transactions from a previous crash must transition to needs-recovery
      // so a new recovery attempt can reconcile and compensate without invalid state jumps (INV-07, §10, §20, §23).
      if (record.state === "committing" || record.state === "compensating" || record.state === "prepared") {
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

      const currentTx = this.#transactionStore.get(record.transactionId) ?? record;

      // Master Remediation §23: Install logical recovery fence immediately for every unresolved transaction
      if (!isFinalTransactionState(currentTx.state) && currentTx.lockKeys.length > 0) {
        this.#fenceRegistry.install({
          transactionId: currentTx.transactionId,
          lockKeys: currentTx.lockKeys,
          createdAt: Date.now(),
          reason: "Startup unresolved transaction fence"
        });

        // Attempt physical lock acquisition
        if (this.#lockManager && !this.#heldRecoveryLocks.has(currentTx.transactionId)) {
          const requiredKeys = canonicalizeLockKeys(currentTx.lockKeys);
          const lockRes = await this.#lockManager.acquireLocks({
            ownerId: `recovery_${currentTx.transactionId}`,
            keys: requiredKeys,
            timeoutMs: 50
          });
          if (lockRes.ok) {
            this.#heldRecoveryLocks.set(currentTx.transactionId, lockRes.value);
            this.#pendingLockAcquisitions.delete(currentTx.transactionId);
          } else {
            // Lock occupied: mark pending physical isolation, fence remains active (Finding 5, §23)
            this.#pendingLockAcquisitions.add(currentTx.transactionId);
          }
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
   * (Master Remediation §8, §12, §13, INV-07).
   *
   * Rejects divergent lock sets fail-closed (Finding 4):
   * Existing handle MUST contain the exact same lock set as TransactionRecord.
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

    const requiredKeys = canonicalizeLockKeys(record.lockKeys);

    // Ensure unresolved transaction is marked needs-recovery (INV-07, §4, §10)
    if (!isFinalTransactionState(record.state) && record.state !== "needs-recovery") {
      this.#transactionStore.transition(
        record.transactionId,
        "needs-recovery",
        record.authorityEpoch,
        "Isolate transaction: transition unresolved state to needs-recovery"
      );
    }

    // Install recovery fence immediately regardless of physical lock status (INV-07)
    if (requiredKeys.length > 0) {
      this.#fenceRegistry.install({
        transactionId: record.transactionId,
        lockKeys: requiredKeys,
        createdAt: Date.now(),
        reason: "Runtime needs-recovery isolation"
      });
    }

    if (this.#heldRecoveryLocks.has(record.transactionId)) {
      return ok(undefined);
    }
    if (requiredKeys.length === 0) {
      return ok(undefined);
    }

    const recoveryOwnerId = `recovery_${record.transactionId}`;

    // If an existing lock handle is provided (e.g. from the currently running command):
    if (existingHandle && existingHandle.keys.length > 0) {
      const heldKeys = canonicalizeLockKeys(existingHandle.keys);

      // Master Remediation Finding 4 (§8): Exact lock-set equality required!
      if (!areLockSetsEqual(requiredKeys, heldKeys)) {
        const divergence = {
          transactionId: record.transactionId,
          requiredLockKeys: requiredKeys,
          heldLockKeys: heldKeys,
          detectedAt: Date.now()
        };
        this.#lockSetDivergences.push(divergence);
        return err(
          createPublicError({
            code: "DM_RECOVERY_LOCKSET_DIVERGENCE",
            category: "internal",
            message: `Cannot transfer lock for transaction '${record.transactionId}': lock set diverged. Required: [${requiredKeys.join(", ")}], Held: [${heldKeys.join(", ")}]`,
            details: divergence
          })
        );
      }

      const transferRes = this.#lockManager.transferLock(existingHandle, recoveryOwnerId);
      if (transferRes.ok) {
        this.#heldRecoveryLocks.set(record.transactionId, transferRes.value);
        this.#pendingLockAcquisitions.delete(record.transactionId);
        return ok(undefined);
      }
      return transferRes;
    }

    // Otherwise, acquire the complete lock set atomically
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: recoveryOwnerId,
      keys: requiredKeys,
      timeoutMs: 1000
    });

    if (!lockRes.ok) {
      this.#pendingLockAcquisitions.add(record.transactionId);
      return lockRes;
    }

    this.#heldRecoveryLocks.set(record.transactionId, lockRes.value);
    this.#pendingLockAcquisitions.delete(record.transactionId);
    return ok(undefined);
  }

  /**
   * Idempotently recovers an unresolved transaction (Master Remediation §8, §19, INV-08, INV-09).
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
      this.#fenceRegistry.remove(transactionId);
      this.#pendingLockAcquisitions.delete(transactionId);
      return ok(record);
    }

    // INV-08: Recovery must possess the complete lock set atomically before proceeding
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
        this.#pendingLockAcquisitions.add(transactionId);
        const lockErr = createPublicError({
          code: "DM_RECOVERY_LOCK_FAILED",
          category: "busy",
          message: `Cannot execute recovery for transaction '${transactionId}': lock set [${requiredKeys.join(", ")}] could not be fully acquired: ${lockRes.error.message}`
        });
        this.#lastRecoveryError = lockErr;
        return err(lockErr);
      }
      this.#heldRecoveryLocks.set(transactionId, lockRes.value);
      this.#pendingLockAcquisitions.delete(transactionId);
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
      this.#transactionStore.transition(
        transactionId,
        "needs-recovery",
        currentEpoch,
        "Recovery halted: No compensator provided for unresolved transaction"
      );
      const noCompErr = createPublicError({
        code: "DM_RECOVERY_COMPENSATION_UNAVAILABLE",
        category: "recovery",
        message: `Cannot compensate transaction '${transactionId}' without a verified compensator`,
        userActionRequired: true,
        retryable: false
      });
      this.#lastRecoveryError = noCompErr;
      return err(noCompErr);
    }

    try {
      // Master Remediation §19: Pass transactionId or latest record to compensator
      const compRes = await effectiveCompensator(compTransition.value);
      if (!compRes.ok) {
        this.#transactionStore.transition(
          transactionId,
          "needs-recovery",
          currentEpoch,
          `Compensation failed: ${compRes.error.message}`
        );
        this.#lastRecoveryError = compRes.error;
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
      const thrownErr = createPublicError({
        code: "DM_RECOVERY_COMPENSATION_FAILED",
        category: "recovery",
        message: `Compensation threw exception: ${error instanceof Error ? error.message : "Unknown error"}`
      });
      this.#lastRecoveryError = thrownErr;
      return err(thrownErr);
    }

    // Check if compensator already moved the transaction to a final state (e.g. committed during reconciliation)
    const currentTx = this.#transactionStore.get(transactionId);
    if (currentTx && isFinalTransactionState(currentTx.state)) {
      this.#releaseRecoveryLock(transactionId);
      this.#fenceRegistry.remove(transactionId);
      this.#pendingLockAcquisitions.delete(transactionId);
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
    this.#fenceRegistry.remove(transactionId);
    this.#pendingLockAcquisitions.delete(transactionId);
    return finalTransition;
  }

  #releaseRecoveryLock(transactionId: string): void {
    const handle = this.#heldRecoveryLocks.get(transactionId);
    if (handle) {
      handle.release();
      this.#heldRecoveryLocks.delete(transactionId);
    }
    void this.retryPendingLockAcquisitions();
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

  /**
   * Retries physical lock acquisition for pending unresolved transactions (Master Remediation §23).
   */
  async retryPendingLockAcquisitions(): Promise<void> {
    for (const txId of Array.from(this.#pendingLockAcquisitions)) {
      const tx = this.#transactionStore.get(txId);
      if (!tx || isFinalTransactionState(tx.state)) {
        this.#pendingLockAcquisitions.delete(txId);
        continue;
      }
      const requiredKeys = canonicalizeLockKeys(tx.lockKeys);
      const lockRes = await this.#lockManager.acquireLocks({
        ownerId: `recovery_${txId}`,
        keys: requiredKeys,
        timeoutMs: 50
      });
      if (lockRes.ok) {
        this.#heldRecoveryLocks.set(txId, lockRes.value);
        this.#pendingLockAcquisitions.delete(txId);
      }
    }
  }

  /**
   * Exposes structured recovery diagnostics (Master Remediation §25).
   */
  getDiagnostics(): RecoveryServiceDiagnostics {
    const unresolvedTxs = this.#transactionStore.listUnresolved();
    return Object.freeze({
      unresolvedTransactions: Object.freeze(
        unresolvedTxs.map((tx) =>
          Object.freeze({
            transactionId: tx.transactionId,
            state: tx.state,
            safeAutoRecovery: tx.safeAutoRecovery,
            lockKeys: tx.lockKeys,
            fenceActive: this.#fenceRegistry.hasFenceForKeys(tx.lockKeys),
            physicalLockHeld: this.#heldRecoveryLocks.has(tx.transactionId),
            recoveryType: (tx.recoveryData as any)?.type,
            lastError: (tx.recoveryData as any)?.lastError ?? this.#lastRecoveryError?.message
          })
        )
      ),
      recoveryFences: this.#fenceRegistry.getFences(),
      pendingRecoveryLockAcquisition: Object.freeze(Array.from(this.#pendingLockAcquisitions)),
      lockSetDivergences: Object.freeze([...this.#lockSetDivergences]),
      lastRecoveryError: this.#lastRecoveryError
    });
  }

  clear(): void {
    if (this.#lockReleaseUnsubscribe) {
      this.#lockReleaseUnsubscribe();
    }
    for (const handle of this.#heldRecoveryLocks.values()) {
      handle.release();
    }
    this.#heldRecoveryLocks.clear();
    this.#fenceRegistry.clear();
    this.#pendingLockAcquisitions.clear();
    this.#lockSetDivergences.length = 0;
    this.#lastRecoveryError = undefined;
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
  let updatedSteps = currentData.steps;
  if (Array.isArray(currentData.steps)) {
    updatedSteps = currentData.steps.map((s: any) =>
      s && s.stepId === stepId ? { ...s, state: "compensated" } : s
    );
  }
  const updatedRecord: TransactionRecord = {
    ...currentRecord,
    recoveryData: {
      ...currentData,
      completedCompensationSteps: Object.freeze(currentSteps),
      steps: updatedSteps ? Object.freeze(updatedSteps) : currentData.steps
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
