import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { LockManager, LockHandle } from "./lock-manager.js";
import type { MutationPlan } from "./plans/plan-contract.js";
import {
  createMutationReceipt,
  type MutationReceipt
} from "./receipt-contract.js";

export interface FreshStateWithRevision {
  readonly revision?: number;
  readonly entityRevisions?: Readonly<Record<string, number>>;
}

export type CommitOutcome = "committed" | "failed-known-safe" | "unknown";

export interface CommitResult<TResult = unknown> {
  readonly result: TResult;
  readonly resultingRevisions: Record<string, number>;
  readonly changed: boolean;
  readonly summary?: string;
  readonly outcome?: CommitOutcome;
}

export interface MutationDefinition<
  TPayload = unknown,
  TResult = unknown,
  TFreshState extends FreshStateWithRevision = FreshStateWithRevision
> {
  readonly getLockKeys: (
    context: AuthenticatedCommandContext<TPayload>
  ) => readonly string[];

  readonly freshRead: (
    context: AuthenticatedCommandContext<TPayload>
  ) => Promise<Result<TFreshState, PublicError>>;

  readonly buildPlan: (
    context: AuthenticatedCommandContext<TPayload>,
    freshState: TFreshState
  ) => Promise<Result<MutationPlan, PublicError>>;

  readonly commit: (
    plan: MutationPlan,
    freshState: TFreshState
  ) => Promise<Result<CommitResult<TResult>, PublicError>>;

  readonly compensate?: (
    plan: MutationPlan,
    freshState: TFreshState,
    error: PublicError
  ) => Promise<Result<void, PublicError>>;
}

export interface MutationCoordinatorOptions {
  readonly lockManager: LockManager;
  readonly defaultLockTimeoutMs?: number;
}

/**
 * MutationCoordinator — Coordinates transactional multi-step mutations (Master Spec §11.2, §11.5, §11.6, DEC-621–648, DEC-803–807).
 *
 * Enforces:
 * 1. Ordered multi-key lock planning and acquisition.
 * 2. Fresh read strictly AFTER lock acquisition.
 * 3. Client-provided derived values are ignored; authoritative costs/states are computed from fresh read.
 * 4. Expected revision verification (DM_REVISION_CONFLICT) fail-closed.
 * 5. Plan building, blocker checks, and atomic commit.
 * 6. Guaranteed release of locks in all outcome branches.
 */
export class MutationCoordinator {
  readonly #lockManager: LockManager;
  readonly #defaultLockTimeoutMs: number;

  constructor(options: MutationCoordinatorOptions) {
    this.#lockManager = options.lockManager;
    this.#defaultLockTimeoutMs = options.defaultLockTimeoutMs ?? 10000;
  }

  async execute<
    TPayload = unknown,
    TResult = unknown,
    TFreshState extends FreshStateWithRevision = FreshStateWithRevision
  >(
    context: AuthenticatedCommandContext<TPayload>,
    definition: MutationDefinition<TPayload, TResult, TFreshState>,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<Result<MutationReceipt<TResult>, PublicError>> {
    const command = context.command;
    const now = Date.now();

    // 1. Lock Planning
    const lockKeys = definition.getLockKeys(context);

    // 2. Ordered Lock Acquisition
    const lockResult = await this.#lockManager.acquireLocks({
      ownerId: command.commandId,
      keys: lockKeys,
      timeoutMs: options?.timeoutMs ?? this.#defaultLockTimeoutMs,
      signal: options?.signal
    });

    if (!lockResult.ok) {
      return ok(
        createMutationReceipt<TResult>({
          commandId: command.commandId,
          status: "rejected",
          changed: false,
          error: lockResult.error,
          executedAt: now
        })
      );
    }

    const lockHandle: LockHandle = lockResult.value;

    try {
      // 3. Fresh Read AFTER Lock Acquisition (Master DEC-621–628)
      const freshReadResult = await definition.freshRead(context);
      if (!freshReadResult.ok) {
        return ok(
          createMutationReceipt<TResult>({
            commandId: command.commandId,
            status: "rejected",
            changed: false,
            error: freshReadResult.error,
            executedAt: now
          })
        );
      }

      const freshState = freshReadResult.value;

      // 4. Expected Revision Verification (Master DEC-583–592)
      if (command.expectedRevision !== undefined) {
        if (freshState.revision !== command.expectedRevision) {
          return ok(
            createMutationReceipt<TResult>({
              commandId: command.commandId,
              status: "rejected",
              changed: false,
              resultingRevisions:
                freshState.revision !== undefined && freshState.revision !== null
                  ? { current: freshState.revision }
                  : {},
              error: createPublicError({
                code: "DM_REVISION_CONFLICT",
                category: "conflict",
                message: `Revision conflict on command '${command.commandId}'. Expected revision: ${command.expectedRevision}, current repository revision: ${freshState.revision !== undefined && freshState.revision !== null ? freshState.revision : "missing"}`,
                details: {
                  expectedRevision: command.expectedRevision,
                  currentRevision:
                    freshState.revision !== undefined && freshState.revision !== null
                      ? freshState.revision
                      : null
                }
              }),
              executedAt: now
            })
          );
        }
      }

      if (command.expectedRevisions) {
        const entityRevisions = freshState.entityRevisions ?? {};
        for (const [ref, expected] of Object.entries(command.expectedRevisions)) {
          const current = entityRevisions[ref];
          if (current !== expected) {
            return ok(
              createMutationReceipt<TResult>({
                commandId: command.commandId,
                status: "rejected",
                changed: false,
                resultingRevisions: { ...entityRevisions },
                error: createPublicError({
                  code: "DM_REVISION_CONFLICT",
                  category: "conflict",
                  message: `Revision conflict on entity '${ref}'. Expected: ${expected}, Current: ${current !== undefined && current !== null ? current : "missing"}`,
                  details: {
                    targetRef: ref,
                    expectedRevision: expected,
                    currentRevision:
                      current !== undefined && current !== null ? current : null
                  }
                }),
                executedAt: now
              })
            );
          }
        }
      }

      // 5. Build Plan
      let plan: MutationPlan;
      try {
        const planResult = await definition.buildPlan(context, freshState);
        if (!planResult.ok) {
          return ok(
            createMutationReceipt<TResult>({
              commandId: command.commandId,
              status: "rejected",
              changed: false,
              error: planResult.error,
              executedAt: now
            })
          );
        }
        plan = planResult.value;
      } catch (buildErr) {
        return ok(
          createMutationReceipt<TResult>({
            commandId: command.commandId,
            status: "rejected",
            changed: false,
            error: createPublicError({
              code: "DM_COMMAND_EXECUTION_FAILED",
              category: "internal",
              message: buildErr instanceof Error ? buildErr.message : "buildPlan threw an unexpected exception"
            }),
            executedAt: now
          })
        );
      }

      // Check blockers (Master DEC-629)
      if (!plan.isExecutable || plan.blockers.length > 0) {
        return ok(
          createMutationReceipt<TResult>({
            commandId: command.commandId,
            status: "rejected",
            changed: false,
            warnings: plan.warnings,
            error: createPublicError({
              code: "DM_PLAN_BLOCKED",
              category: "validation",
              message: `Mutation plan is blocked: ${plan.blockers.join("; ")}`
            }),
            executedAt: now
          })
        );
      }

      // 6. Commit Stateful Writes
      let commitResult: Result<CommitResult<TResult>, PublicError>;
      try {
        commitResult = await definition.commit(plan, freshState);
      } catch (commitErr) {
        const isUnknownOutcome =
          typeof commitErr === "object" &&
          commitErr !== null &&
          ((commitErr as any).outcome === "unknown" ||
            (commitErr as any).details?.outcome === "unknown");
        commitResult = err(
          createPublicError({
            code: "DM_COMMIT_FAILED",
            category: "internal",
            message: commitErr instanceof Error ? commitErr.message : "Unexpected exception during commit",
            details: isUnknownOutcome ? { outcome: "unknown" } : undefined
          })
        );
      }

      if (!commitResult.ok) {
        const errorDetails =
          typeof commitResult.error.details === "object" && commitResult.error.details !== null
            ? (commitResult.error.details as Record<string, unknown>)
            : {};
        const outcome = errorDetails.outcome as CommitOutcome | undefined;

        // G2-AUD-012: If outcome is "unknown" (timeout, provider crash, uncertain write application):
        // 1. DO NOT automatically compensate, as that could mutate an already-committed or partially-written state!
        // 2. Return needs-recovery receipt with DM_RECOVERY_UNKNOWN_OUTCOME
        if (outcome === "unknown") {
          return ok(
            createMutationReceipt<TResult>({
              commandId: command.commandId,
              status: "rejected",
              changed: false,
              error: createPublicError({
                code: "DM_RECOVERY_UNKNOWN_OUTCOME",
                category: "recovery",
                message: `Commit outcome is unknown; automatic compensation withheld to prevent corrupting state: ${commitResult.error.message}`,
                details: {
                  originalError: commitResult.error,
                  needsRecovery: true,
                  userActionRequired: true
                },
                userActionRequired: true,
                retryable: false
              }),
              executedAt: now
            })
          );
        }

        // Optional compensation attempt if defined and outcome is known safe
        if (definition.compensate) {
          try {
            const compRes = await definition.compensate(plan, freshState, commitResult.error);
            if (!compRes.ok) {
              return ok(
                createMutationReceipt<TResult>({
                  commandId: command.commandId,
                  status: "rejected",
                  changed: false,
                  error: createPublicError({
                    code: "DM_COMPENSATION_FAILED",
                    category: "recovery",
                    message: `Commit failed and compensation failed: ${compRes.error.message}`
                  }),
                  executedAt: now
                })
              );
            }
          } catch (compErr) {
            return ok(
              createMutationReceipt<TResult>({
                commandId: command.commandId,
                status: "rejected",
                changed: false,
                error: createPublicError({
                  code: "DM_COMPENSATION_FAILED",
                  category: "recovery",
                  message: `Commit failed and compensation threw exception: ${compErr instanceof Error ? compErr.message : "Unknown error"}`
                }),
                executedAt: now
              })
            );
          }
        }

        return ok(
          createMutationReceipt<TResult>({
            commandId: command.commandId,
            status: "rejected",
            changed: false,
            error: commitResult.error,
            executedAt: now
          })
        );
      }

      const committed = commitResult.value;

      // 7. Successful Receipt
      return ok(
        createMutationReceipt<TResult>({
          commandId: command.commandId,
          status: committed.changed ? "executed" : "no_op",
          changed: committed.changed,
          resultingRevisions: committed.resultingRevisions,
          summary: committed.summary ?? plan.summary,
          result: committed.result,
          executedAt: now
        })
      );
    } finally {
      // Guaranteed lock release
      lockHandle.release();
    }
  }
}
