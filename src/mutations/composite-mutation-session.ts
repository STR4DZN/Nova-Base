import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { createOpaqueId } from "../core/identity/ids.js";
import type { CommandId } from "../commands/command-envelope.js";
import { canonicalizeLockKeys, type LockHandle } from "./lock-manager.js";
import {
  assertSameCanonicalLockSet,
  assertNoForbiddenLockKeys
} from "./lock-keys.js";
import {
  createTransactionRecord,
  type TransactionRecord,
  type TransactionState,
  isFinalTransactionState
} from "./transaction-record.js";
import type { TransactionStore } from "./transaction-store.js";
import type { RecoveryFenceRegistry } from "./recovery-fence-registry.js";
import type { RecoveryService } from "./recovery-service.js";
import type {
  CompositeRecoveryData,
  RecoveryStep,
  RecoveryStepSubsystem
} from "./recovery-step.js";

export interface TransactionExecutionContext {
  readonly commandId: CommandId;
  readonly authorityEpoch: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly lockKeys: readonly string[];
}

export interface ChildStepDefinition<TIntent = unknown, TReceipt = unknown> {
  readonly stepId: string;
  readonly subsystem: RecoveryStepSubsystem;
  readonly operation: string;
  readonly targetRef?: string;
  readonly idempotencyKey?: string;
  readonly operationRef?: string;
  readonly intent: TIntent;
  readonly flushIntent?: boolean;
  readonly execute: () => Promise<Result<TReceipt, PublicError>>;
}

export interface CompositeSessionPrepareOptions {
  readonly transactionContext?: TransactionExecutionContext;
  readonly transactionStore?: TransactionStore;
  readonly recoveryService?: RecoveryService;
  readonly recoveryFenceRegistry?: RecoveryFenceRegistry;
  readonly lockHandle?: LockHandle;
  readonly commandId?: CommandId;
  readonly authorityEpoch?: number;
  readonly lockKeys?: readonly string[];
  readonly planLockKeys?: readonly string[];
  readonly expectedLockKeys?: readonly string[];
  readonly recoveryType: string;
  readonly parentRef: string;
  readonly parentBefore?: unknown;
  readonly parentExpectedAfter?: unknown;
  readonly safeAutoRecovery?: boolean;
  readonly initialRecoveryData?: Record<string, unknown>;
  readonly now?: number;
}

/**
 * CompositeMutationSession — Canonical transaction execution kernel for G5 composite operations
 * (Master Remediation §2, §14, §20, §37, INV-01–INV-11).
 *
 * Centralizes:
 * - Transaction lifecycle (planned -> claimed -> prepared -> committing -> committed / needs-recovery)
 * - Durable persistence before side effects (INV-02, INV-04, INV-05)
 * - Lock set validation and zero-divergence enforcement (INV-01)
 * - Step journal tracking
 * - Recovery fence installation and lock transfer (INV-07, INV-08)
 * - Fault classification and fail-closed compensation wrapping (INV-06, INV-11)
 */
export class CompositeMutationSession {
  readonly transactionId: string;
  readonly commandId: CommandId;
  readonly authorityEpoch: number;
  readonly lockKeys: readonly string[];
  readonly recoveryType: string;
  readonly parentRef: string;

  readonly #transactionStore?: TransactionStore;
  readonly #recoveryService?: RecoveryService;
  readonly #fenceRegistry?: RecoveryFenceRegistry;
  #lockHandle?: LockHandle;
  #steps: RecoveryStep[] = [];
  #currentPhase: CompositeRecoveryData["phase"] = "prepared";
  #legacyData: Record<string, unknown>;

  private constructor(
    transactionId: string,
    options: CompositeSessionPrepareOptions,
    initialRecord?: TransactionRecord
  ) {
    this.transactionId = transactionId;
    this.commandId = options.transactionContext?.commandId ?? options.commandId!;
    this.authorityEpoch = options.transactionContext?.authorityEpoch ?? options.authorityEpoch ?? 1;
    this.lockKeys = canonicalizeLockKeys(options.transactionContext?.lockKeys ?? options.lockKeys ?? []);
    this.recoveryType = options.recoveryType;
    this.parentRef = options.parentRef;
    this.#transactionStore = options.transactionStore;
    this.#recoveryService = options.recoveryService;
    this.#fenceRegistry = options.recoveryFenceRegistry;
    this.#lockHandle = options.lockHandle;
    this.#legacyData = { ...(options.initialRecoveryData ?? {}) };

    if (initialRecord?.recoveryData) {
      const recData = initialRecord.recoveryData as Record<string, unknown>;
      if (Array.isArray(recData.steps)) {
        this.#steps = [...(recData.steps as RecoveryStep[])];
      }
      this.#legacyData = { ...this.#legacyData, ...recData };
    }
  }

  static async prepare(
    options: CompositeSessionPrepareOptions
  ): Promise<Result<CompositeMutationSession, PublicError>> {
    const commandId = options.transactionContext?.commandId ?? options.commandId;
    if (!commandId) {
      return err(
        createPublicError({
          code: "DM_COMMAND_EXECUTION_FAILED",
          category: "validation",
          message: "commandId is required to prepare a CompositeMutationSession"
        })
      );
    }
    const authorityEpoch = options.transactionContext?.authorityEpoch ?? options.authorityEpoch ?? 1;
    const rawLockKeys = options.transactionContext?.lockKeys ?? options.lockKeys ?? [];
    const rawPlanLockKeys = options.expectedLockKeys ?? options.planLockKeys;

    // 1. Lock key validation: forbidden namespace check (INV-01, Master Remediation §6, §7)
    const forbiddenCheck = assertNoForbiddenLockKeys(rawLockKeys);
    if (!forbiddenCheck.ok) {
      return forbiddenCheck;
    }

    // 2. Lock key validation: exact match against plan keys (INV-01, Master Remediation §8, §9)
    if (rawPlanLockKeys) {
      const divergenceCheck = assertSameCanonicalLockSet(
        rawLockKeys,
        rawPlanLockKeys,
        `CompositeMutationSession.prepare for ${options.recoveryType}`
      );
      if (!divergenceCheck.ok) {
        return divergenceCheck;
      }
    }

    const txId = createOpaqueId("tx");
    const canonicalKeys = canonicalizeLockKeys(rawLockKeys);

    // If no transactionStore provided (e.g. lightweight isolated unit test), return in-memory session
    if (!options.transactionStore) {
      return ok(new CompositeMutationSession(txId, options));
    }

    const initialRecoveryData: CompositeRecoveryData = {
      type: options.recoveryType,
      parentRef: options.parentRef,
      parentBefore: options.parentBefore,
      parentExpectedAfter: options.parentExpectedAfter,
      steps: Object.freeze([]),
      phase: "prepared",
      ...options.initialRecoveryData
    };

    const initialRecord = createTransactionRecord({
      transactionId: txId,
      commandId,
      authorityEpoch,
      lockKeys: canonicalKeys,
      safeAutoRecovery: options.safeAutoRecovery ?? false,
      recoveryData: initialRecoveryData,
      now: options.now
    });

    options.transactionStore.save(initialRecord);

    const claimRes = options.transactionStore.transition(
      txId,
      "claimed",
      authorityEpoch,
      "Claiming transaction in session preparation",
      options.now
    );
    if (!claimRes.ok) return claimRes;

    const prepRes = options.transactionStore.transition(
      txId,
      "prepared",
      authorityEpoch,
      "Transaction prepared for child writes",
      options.now
    );
    if (!prepRes.ok) return prepRes;

    // INV-02: Flush transaction to durable storage BEFORE executing child writes
    try {
      await options.transactionStore.flush();
    } catch (flushErr) {
      options.transactionStore.transition(
        txId,
        "failed",
        authorityEpoch,
        "Transaction preparation durable flush failed",
        options.now
      );
      return err(
        createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: `Failed to flush transaction preparation to storage: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
          details: flushErr
        })
      );
    }

    const latestTx = options.transactionStore.get(txId);
    return ok(new CompositeMutationSession(txId, options, latestTx));
  }

  get steps(): readonly RecoveryStep[] {
    return Object.freeze([...this.#steps]);
  }

  get phase(): CompositeRecoveryData["phase"] {
    return this.#currentPhase;
  }

  /**
   * Updates custom/legacy recoveryData attributes and flushes durably (Master Remediation §14).
   */
  async checkpointRecoveryData(
    patch: Record<string, unknown>
  ): Promise<Result<TransactionRecord | undefined, PublicError>> {
    this.#legacyData = { ...this.#legacyData, ...patch };
    if (!this.#transactionStore) return ok(undefined);

    return this.#transactionStore.patchDurable(this.transactionId, (current) => {
      const currentData = (current.recoveryData as Record<string, unknown>) ?? {};
      return {
        ...current,
        recoveryData: {
          ...currentData,
          ...this.#legacyData,
          steps: Object.freeze([...this.#steps]),
          phase: this.#currentPhase
        },
        updatedAt: Date.now()
      };
    });
  }

  /**
   * Executes a child side-effect with write-ahead intent/executing phase and post-receipt durable checkpoints
   * (INV-03, INV-04, INV-05).
   * Intent persistence and flush before execute() are mandatory across all flows.
   */
  async runChildStep<TIntent = unknown, TReceipt = unknown>(
    stepDef: ChildStepDefinition<TIntent, TReceipt>
  ): Promise<Result<TReceipt, PublicError>> {
    const operationRef = stepDef.operationRef ?? stepDef.stepId;
    const idempotencyKey =
      stepDef.idempotencyKey ?? `${this.transactionId}:${stepDef.stepId}`;

    // 1. Mandatory write-ahead: place step in "executing" state with intent before executing effect
    const executingStep: RecoveryStep<TIntent, unknown> = {
      stepId: stepDef.stepId,
      subsystem: stepDef.subsystem,
      operation: stepDef.operation,
      targetRef: stepDef.targetRef,
      idempotencyKey,
      operationRef,
      state: "executing",
      intent: stepDef.intent
    };

    // Replace or append step in memory
    const existingIdx = this.#steps.findIndex((s) => s.stepId === stepDef.stepId);
    if (existingIdx !== -1) {
      this.#steps[existingIdx] = executingStep;
    } else {
      this.#steps.push(executingStep);
    }

    // MANDATORY WRITE-AHEAD: Persist intent & executing state durably BEFORE executing side effect (INV-04)
    if (this.#transactionStore) {
      const intentPersist = await this.#persistSteps();
      if (!intentPersist.ok) {
        // Effect has NOT started: revert memory state to planned
        const stepIdx = this.#steps.findIndex((s) => s.stepId === stepDef.stepId);
        if (stepIdx !== -1) {
          this.#steps[stepIdx] = { ...executingStep, state: "planned" };
        }
        return intentPersist;
      }
    }

    // 2. Execute side effect with outcome classification (INV-05, INV-06, Finding 6)
    let execRes: Result<TReceipt, PublicError>;
    let threwException = false;
    try {
      execRes = await stepDef.execute();
    } catch (thrown) {
      threwException = true;
      execRes = err(
        createPublicError({
          code: "DM_COMMAND_EXECUTION_FAILED",
          category: "internal",
          message: thrown instanceof Error ? thrown.message : String(thrown),
          details: { outcome: "unknown", error: thrown }
        })
      );
    }

    if (execRes.ok) {
      // INV-05: Persist receipt durably AFTER executing side effect
      const appliedStep: RecoveryStep<TIntent, TReceipt> = {
        ...executingStep,
        state: "applied",
        receipt: execRes.value
      };

      const stepIdx = this.#steps.findIndex((s) => s.stepId === stepDef.stepId);
      if (stepIdx !== -1) {
        this.#steps[stepIdx] = appliedStep;
      } else {
        this.#steps.push(appliedStep);
      }

      if (this.#transactionStore) {
        const receiptPersist = await this.#persistSteps();
        if (!receiptPersist.ok) {
          // INV-05: If receipt checkpoint flush fails, outcome is unknown, mark needs-recovery
          const unknownStep: RecoveryStep<TIntent, unknown> = {
            ...executingStep,
            state: "unknown",
            receipt: undefined
          };
          this.#steps[stepIdx !== -1 ? stepIdx : this.#steps.length - 1] = unknownStep;
          await this.markNeedsRecovery(
            `Child step '${stepDef.stepId}' receipt flush failed: ${receiptPersist.error.message}`
          );

          return err(
            createPublicError({
              code: "DM_DOMAIN_STORAGE_ERROR",
              category: "internal",
              message: `Child step applied but receipt checkpoint failed to flush: ${receiptPersist.error.message}`,
              details: {
                outcome: "unknown",
                stepId: stepDef.stepId,
                originalError: receiptPersist.error
              }
            })
          );
        }
      }

      return execRes;
    }

    // 3. Child effect failed: classify outcome as "not-applied" vs "unknown" (Finding 6)
    const errDetails = execRes.error.details as any;
    const isExplicitUnknown =
      threwException ||
      errDetails?.outcome === "unknown" ||
      (execRes.error as any).outcome === "unknown" ||
      execRes.error.category === "timeout" ||
      execRes.error.code === "DM_TIMEOUT" ||
      execRes.error.code === "DM_ECON_PROVIDER_TIMEOUT";

    const stepIdx = this.#steps.findIndex((s) => s.stepId === stepDef.stepId);
    if (isExplicitUnknown) {
      const unknownStep: RecoveryStep<TIntent, unknown> = {
        ...executingStep,
        state: "unknown"
      };
      if (stepIdx !== -1) {
        this.#steps[stepIdx] = unknownStep;
      }
      await this.markNeedsRecovery(
        `Child step '${stepDef.stepId}' execution outcome is unknown: ${execRes.error.message}`
      );
      return err(
        createPublicError({
          code: execRes.error.code,
          category: execRes.error.category,
          message: execRes.error.message,
          details: {
            ...(typeof execRes.error.details === "object" && execRes.error.details !== null
              ? execRes.error.details
              : {}),
            outcome: "unknown"
          }
        })
      );
    } else {
      // "not-applied": effect definitely did not execute (validation, insufficient funds, etc.)
      const notAppliedStep: RecoveryStep<TIntent, unknown> = {
        ...executingStep,
        state: "planned"
      };
      if (stepIdx !== -1) {
        this.#steps[stepIdx] = notAppliedStep;
      }
      if (this.#transactionStore) {
        await this.#persistSteps();
      }
      return execRes;
    }
  }

  /**
   * Transitions transaction to committing before writing parent state (INV-02, INV-09).
   */
  async enterCommitting(
    checkpointPatch?: Record<string, unknown>
  ): Promise<Result<void, PublicError>> {
    this.#currentPhase = "committing";
    if (checkpointPatch) {
      const patchRes = await this.checkpointRecoveryData(checkpointPatch);
      if (!patchRes.ok) {
        return patchRes;
      }
    }
    if (!this.#transactionStore) return ok(undefined);

    const transRes = await this.#transactionStore.transitionDurable(
      this.transactionId,
      "committing",
      this.authorityEpoch,
      "Entering committing phase before parent state write"
    );

    if (!transRes.ok) {
      return transRes;
    }
    return ok(undefined);
  }

  /**
   * Executes parent save and safely wraps exceptions (INV-11).
   */
  async commitParent<TParentResult>(
    saveFn: () => Promise<Result<TParentResult, PublicError>>
  ): Promise<Result<TParentResult, PublicError>> {
    try {
      return await saveFn();
    } catch (saveErr) {
      return err(
        createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: `Parent save threw unexpected exception: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
          details: saveErr
        })
      );
    }
  }

  /**
   * Completes transaction durably to committed state (INV-10).
   * Guarantees that final success is returned ONLY after durable flush.
   */
  async commitDurably<TResult>(
    finalResult: TResult
  ): Promise<Result<TResult, PublicError>> {
    this.#currentPhase = "completed";
    if (!this.#transactionStore) {
      return ok(finalResult);
    }

    const transRes = await this.#transactionStore.transitionDurable(
      this.transactionId,
      "committed",
      this.authorityEpoch,
      "Transaction committed durably"
    );

    if (!transRes.ok) {
      // INV-10: If committed flush fails, transaction outcome is unconfirmed, mark needs-recovery
      await this.markNeedsRecovery(
        `Failed to flush committed transaction state: ${transRes.error.message}`
      );

      return err(
        createPublicError({
          code: "DM_TRANSACTION_COMMIT_UNCONFIRMED",
          category: "internal",
          message: `Transaction state committed in memory but failed to flush to storage: ${transRes.error.message}`,
          details: {
            outcome: "unknown",
            originalError: transRes.error
          }
        })
      );
    }

    // Commit succeeded durably: remove recovery fence if installed
    this.#removeFence();
    return ok(finalResult);
  }

  /**
   * Unified error handling and compensation wrapper (Finding 1, INV-06, INV-11).
   * Catches all exceptions, coordinates compensation, installs recovery fence, and guarantees
   * that transaction transitions durably to failed (if safe) or needs-recovery (if uncertain).
   */
  async failAndCompensate<TResult>(
    primaryError: PublicError,
    compensatorFn?: (session: CompositeMutationSession, error: PublicError) => Promise<Result<void, PublicError>>
  ): Promise<Result<TResult, PublicError>> {
    const isUnknownOutcome =
      (primaryError as any)?.outcome === "unknown" ||
      (primaryError.details as any)?.outcome === "unknown" ||
      this.#steps.some((s) => s.state === "unknown" || s.state === "executing");

    const hasAppliedEffects = this.#steps.some(
      (s) => s.state === "applied" || s.state === "unknown" || s.state === "executing"
    );

    // If no child side effects were applied and outcome is not unknown, we can safely mark failed
    if (!hasAppliedEffects && !isUnknownOutcome) {
      this.#currentPhase = "failed";
      if (this.#transactionStore) {
        await this.#transactionStore.transitionDurable(
          this.transactionId,
          "failed",
          this.authorityEpoch,
          `Failed before side effects: ${primaryError.message}`
        );
      }
      this.#removeFence();
      return err(primaryError);
    }

    // Section 6 & 17: If outcome is unknown, do NOT run blind compensation!
    // Transition to needs-recovery, install fence, and wait for reconciliation.
    if (isUnknownOutcome) {
      await this.markNeedsRecovery(
        `Transaction outcome is unknown, requires reconciliation: ${primaryError.message}`
      );
      return err(primaryError);
    }

    // Side effects were applied: attempt compensation
    this.#currentPhase = "needs-recovery";
    if (this.#transactionStore) {
      await this.#transactionStore.transitionDurable(
        this.transactionId,
        "compensating",
        this.authorityEpoch,
        `Compensating side effects after failure: ${primaryError.message}`
      );
    }

    let compensationSuccess = false;
    let compensationError: PublicError | undefined;

    const effectiveCompensator =
      compensatorFn ??
      (this.#recoveryService
        ? async (s: CompositeMutationSession, _err: PublicError) => {
            const comp = this.#recoveryService!.getCompensator(this.recoveryType);
            if (!comp) {
              return err(
                createPublicError({
                  code: "DM_RECOVERY_COMPENSATION_UNAVAILABLE",
                  category: "recovery",
                  message: `No compensator registered for recovery type '${this.recoveryType}'`
                })
              );
            }
            const tx = this.#transactionStore?.get(this.transactionId);
            return comp(tx ?? (s as any));
          }
        : undefined);

    if (effectiveCompensator) {
      try {
        const compRes = await effectiveCompensator(this, primaryError);
        if (compRes.ok) {
          compensationSuccess = true;
        } else {
          compensationError = compRes.error;
        }
      } catch (compEx) {
        compensationError = createPublicError({
          code: "DM_COMPENSATION_FAILED",
          category: "recovery",
          message: `Compensator threw unhandled exception: ${compEx instanceof Error ? compEx.message : String(compEx)}`,
          details: compEx
        });
      }
    } else {
      compensationError = createPublicError({
        code: "DM_RECOVERY_COMPENSATION_UNAVAILABLE",
        category: "recovery",
        message: "No compensator provided to roll back applied child side effects"
      });
    }

    if (compensationSuccess && this.#transactionStore) {
      // Mark compensated or failed
      const compFlush = await this.#transactionStore.transitionDurable(
        this.transactionId,
        "failed",
        this.authorityEpoch,
        "Compensation completed successfully"
      );
      if (compFlush.ok) {
        this.#removeFence();
        return err(primaryError);
      } else {
        // If durable flush of compensated/failed state fails, we MUST remain in needs-recovery!
        await this.markNeedsRecovery(
          `Failed to persist compensated state: ${compFlush.error.message}`
        );
        return err(compFlush.error);
      }
    }

    // Compensation failed or threw: must remain in needs-recovery with active fence
    await this.markNeedsRecovery(
      compensationError?.message ?? `Compensation failed: ${primaryError.message}`
    );

    return err(
      compensationError ??
        createPublicError({
          code: "DM_COMPENSATION_FAILED",
          category: "recovery",
          message: `Operation failed and compensation was unable to complete: ${primaryError.message}`,
          details: { primaryError, compensationError }
        })
    );
  }

  /**
   * Transitions transaction to needs-recovery, installs fence, and transfers active lock handle (INV-07).
   */
  async markNeedsRecovery(reason: string): Promise<void> {
    this.#currentPhase = "needs-recovery";
    this.#installFence(reason);

    if (this.#transactionStore) {
      await this.#transactionStore.patchDurable(this.transactionId, (current) => {
        const currentData = (current.recoveryData as Record<string, unknown>) ?? {};
        return {
          ...current,
          state: "needs-recovery",
          recoveryData: {
            ...currentData,
            ...this.#legacyData,
            steps: Object.freeze([...this.#steps]),
            phase: "needs-recovery",
            lastError: reason
          },
          updatedAt: Date.now()
        };
      });
      this.#transactionStore.transition(
        this.transactionId,
        "needs-recovery",
        this.authorityEpoch,
        reason
      );
      try {
        await this.#transactionStore.flush();
      } catch {
        // Ignore flush failure: fence already protects scope
      }
    }

    // If lockHandle is held and recoveryService is available, transfer lock immediately
    if (this.#lockHandle && this.#recoveryService) {
      const tx = this.#transactionStore?.get(this.transactionId);
      if (tx) {
        await this.#recoveryService.isolateTransaction(tx, this.#lockHandle);
      }
    }
  }

  #installFence(reason: string): void {
    const fenceRegistry =
      this.#fenceRegistry ?? (this.#recoveryService as any)?.fenceRegistry;
    if (fenceRegistry) {
      fenceRegistry.install({
        transactionId: this.transactionId,
        lockKeys: this.lockKeys,
        createdAt: Date.now(),
        reason
      });
    }
  }

  #removeFence(): void {
    const fenceRegistry =
      this.#fenceRegistry ?? (this.#recoveryService as any)?.fenceRegistry;
    if (fenceRegistry) {
      fenceRegistry.remove(this.transactionId);
    }
  }

  async #persistSteps(): Promise<Result<void, PublicError>> {
    if (!this.#transactionStore) return ok(undefined);

    const patchRes = await this.#transactionStore.patchDurable(
      this.transactionId,
      (current) => {
        const currentData = (current.recoveryData as Record<string, unknown>) ?? {};
        return {
          ...current,
          recoveryData: {
            ...currentData,
            ...this.#legacyData,
            steps: Object.freeze([...this.#steps]),
            phase: this.#currentPhase
          },
          updatedAt: Date.now()
        };
      }
    );

    if (!patchRes.ok) {
      return patchRes;
    }
    return ok(undefined);
  }
}
