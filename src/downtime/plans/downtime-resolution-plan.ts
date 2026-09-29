import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { createCommandId, type CommandId } from "../../commands/command-envelope.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DowntimeDefinitionRegistry } from "../definitions/downtime-registry.js";
import type {
  DowntimeDefinition,
  DowntimeInstance,
  DowntimeOutcomeDefinition
} from "../types/downtime-types.js";
import {
  getDomainDowntimeData,
  withDomainDowntimeData
} from "../downtime-data.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { FacilitiesService } from "../../facilities/services/facilities-service.js";
import type { ChildReceipt } from "../../projects/plans/project-plan-types.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import { createTransactionRecord } from "../../mutations/transaction-record.js";
import { compensateDowntimeResolution } from "../services/downtime-recovery-compensators.js";
import { lockKey } from "../../mutations/lock-keys.js";
import type { TransactionalChildHandler, TransactionalChildHandlerRegistry } from "../../mutations/child-handler-contract.js";
import {
  CompositeMutationSession,
  type TransactionExecutionContext
} from "../../mutations/composite-mutation-session.js";

export type DowntimeOutcomeHandler =
  | ((outcome: any, operationRef?: string) => Promise<ChildReceipt> | ChildReceipt)
  | TransactionalChildHandler;

export interface DowntimeResolutionPlanContext {
  readonly domains: DomainRepositoryContract;
  readonly downtimeRegistry: DowntimeDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly facilitiesService?: FacilitiesService;
  readonly transactionStore?: TransactionStore;
  readonly childHandlerRegistry?: TransactionalChildHandlerRegistry;
  readonly defaultOutcomeHandlers?: Readonly<Record<string, DowntimeOutcomeHandler>>;
}

export interface DowntimeResolutionPlanParams {
  readonly domainUuid: string;
  readonly activityId: string;
  readonly outcomeKey?: string;
  readonly notes?: string;
  readonly userId?: string | null;
  readonly outcomeHandlers?: Readonly<Record<string, DowntimeOutcomeHandler>>;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
  readonly lockKeys?: readonly string[];
  readonly transactionContext?: TransactionExecutionContext;
}

/**
 * DowntimeResolutionPlan — Coordinated domain operation plan for completing/resolving a Downtime Activity.
 * (Master Remediation §22.6, Finding 3, INV-01 to INV-11)
 *
 * Enforces:
 * 1. Progress and precondition check (elapsed ticks, valid inProgress state).
 * 2. TransactionRecord prepared in TransactionStore via CompositeMutationSession BEFORE child writes.
 * 3. Canonical lock set: domain + downtime:<activityId> (NEVER activity:<activityId>!).
 * 4. Classifies outcomes as MANDATORY vs OPTIONAL (outcome.optional === true).
 * 5. Fails closed and blocks completion if any mandatory outcome fails (never silently marks completed).
 * 6. Explicitly compensates/rolls back executed outcome credits if mandatory outcome or persistence fails.
 */
export async function executeDowntimeResolutionPlan(
  context: DowntimeResolutionPlanContext,
  params: DowntimeResolutionPlanParams
): Promise<
  Result<
    {
      readonly activity: DowntimeInstance;
      readonly outcomes: readonly DowntimeOutcomeDefinition[];
      readonly outcomesApplied: readonly ChildReceipt[];
    },
    PublicError
  >
> {
  const cleanDomainUuid = normalizeJournalEntryId(params.domainUuid);
  const docRes = await context.domains.read(cleanDomainUuid);
  if (!docRes.ok) return docRes;

  const record = docRes.value.record;
  const currentDowntimeData = getDomainDowntimeData(record);
  const activity = currentDowntimeData.activities.find((a) => a.id === params.activityId);

  if (!activity) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_NOT_FOUND",
        category: "not-found",
        message: `Downtime activity '${params.activityId}' not found in domain ${params.domainUuid}`
      })
    );
  }

  if (activity.lifecycle !== "inProgress") {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INVALID_LIFECYCLE_TRANSITION",
        category: "conflict",
        message: `Cannot complete activity '${params.activityId}' with lifecycle '${activity.lifecycle}'. Must be 'inProgress'`
      })
    );
  }

  const definition = context.downtimeRegistry.get(activity.definitionId);
  const outcomesToExecute: readonly DowntimeOutcomeDefinition[] =
    definition?.outcomeDefinitions ?? [];

  const cmdId: CommandId = params.commandId
    ? params.commandId.startsWith("cmd_")
      ? (params.commandId as CommandId)
      : (`cmd_${params.commandId}` as CommandId)
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  // Master Remediation Finding 3 & §22.6: Canonical lock set is domain + downtime:<activityId>
  const canonicalLocks = [lockKey.domain(cleanDomainUuid), lockKey.downtime(activity.id)];
  const sessionLockKeys = params.transactionContext?.lockKeys ?? params.lockKeys ?? canonicalLocks;

  const sessionRes = await CompositeMutationSession.prepare({
    transactionContext: params.transactionContext,
    transactionStore: context.transactionStore,
    commandId: cmdId,
    authorityEpoch: epoch,
    lockKeys: sessionLockKeys,
    expectedLockKeys: canonicalLocks,
    planLockKeys: canonicalLocks,
    recoveryType: "downtime:resolution",
    parentRef: `downtime:${activity.id}`,
    initialRecoveryData: {
      type: "downtime:resolution",
      domainUuid: cleanDomainUuid,
      activityId: activity.id,
      definitionId: activity.definitionId,
      correlationId: params.correlationId,
      causationId: params.causationId,
      status: "prepared"
    }
  });

  if (!sessionRes.ok) {
    return sessionRes;
  }

  const session = sessionRes.value;

  const creditedResources: { resourceId: string; amount: number }[] = [];
  const outcomesApplied: ChildReceipt[] = [];

  const runCompensator = async (s: CompositeMutationSession, _error: PublicError) => {
    const effectiveCredited = [...creditedResources];
    for (const step of s.steps) {
      if (step.subsystem === "economy" && (step.state === "applied" || step.state === "unknown")) {
        const intent = step.intent as { resourceId: string; deltaMinor: number };
        if (intent && intent.deltaMinor > 0) {
          if (!effectiveCredited.some((c) => c.resourceId === intent.resourceId && c.amount === intent.deltaMinor)) {
            effectiveCredited.push({ resourceId: intent.resourceId, amount: intent.deltaMinor });
          }
        }
      }
    }

    const currentTx = context.transactionStore?.get(s.transactionId);
    const existingRecData = (currentTx?.recoveryData as Record<string, unknown>) ?? {};
    const updatedRecData = {
      ...existingRecData,
      type: "downtime:resolution",
      activityId: params.activityId,
      domainUuid: cleanDomainUuid,
      creditedResources: Object.freeze([...effectiveCredited]),
      status: "needs-recovery"
    };

    const tx = currentTx
      ? { ...currentTx, recoveryData: updatedRecData }
      : createTransactionRecord({
          transactionId: s.transactionId,
          commandId: cmdId,
          authorityEpoch: epoch,
          lockKeys: sessionLockKeys,
          safeAutoRecovery: false,
          recoveryData: updatedRecData
        });

    if (context.transactionStore) {
      context.transactionStore.save(tx);
    }

    return compensateDowntimeResolution(
      tx,
      {
        domains: context.domains,
        economyService: context.economyService,
        transactionStore: context.transactionStore
      },
      { lockOwner: params.commandId, skipReconciliation: true }
    );
  };

  // Execute outcomes with mandatory vs optional classification (G5-REVAL3-005)
  for (const outcome of outcomesToExecute) {
    const isOptional = outcome.optional === true;

    if (outcome.type === "economy:grant-resource") {
      const resourceId = (outcome.parameters as any)?.resourceId ?? "credits";
      const amount = Number((outcome.parameters as any)?.amount ?? 0);

      if (context.economyService && amount > 0) {
        const stepId = `downtime-resolution:reward:${outcome.id}`;
        const stepRes = await session.runChildStep({
          stepId,
          subsystem: "economy",
          operation: "adjust",
          targetRef: cleanDomainUuid,
          idempotencyKey: `${session.transactionId}:${stepId}`,
          intent: { resourceId, deltaMinor: amount },
          execute: async () => {
            return context.economyService!.commitAdjust({
              domainUuid: cleanDomainUuid,
              resourceId,
              deltaMinor: amount,
              reason: `Outcome of downtime activity '${activity.name}': ${outcome.label}`,
              lockOwner: params.commandId,
              idempotencyKey: `${session.transactionId}:${stepId}`
            });
          }
        });

        if (stepRes.ok) {
          creditedResources.push({ resourceId, amount });
          const checkRes = await session.checkpointRecoveryData({
            creditedResources: Object.freeze([...creditedResources]),
            status: "executing"
          });
          if (!checkRes.ok) {
            return session.failAndCompensate(checkRes.error, runCompensator);
          }
          outcomesApplied.push({
            childReceiptId: createOpaqueId("rep"),
            subsystem: "economy",
            action: "grant_resource",
            targetRef: cleanDomainUuid,
            payload: { resourceId, amount },
            success: true,
            appliedAt: Date.now()
          });
        } else {
          if (!isOptional) {
            const errToPropagate = stepRes.error.code === "DM_DOMAIN_STORAGE_ERROR"
              ? stepRes.error
              : createPublicError({
                  code: "DM_DOWNTIME_MANDATORY_OUTCOME_FAILED",
                  category: "conflict",
                  message: `Mandatory outcome '${outcome.label}' failed: ${stepRes.error.message}`,
                  details: stepRes.error
                });
            return session.failAndCompensate(errToPropagate, runCompensator);
          }
          outcomesApplied.push({
            childReceiptId: createOpaqueId("rep"),
            subsystem: "economy",
            action: "grant_resource",
            targetRef: cleanDomainUuid,
            payload: { resourceId, amount },
            success: false,
            error: stepRes.error.message,
            appliedAt: Date.now()
          });
        }
      }
    } else {
      const registeredHandler = context.childHandlerRegistry?.get(outcome.type);
      const handler =
        registeredHandler ??
        context.defaultOutcomeHandlers?.[outcome.type] ??
        params.outcomeHandlers?.[outcome.type];
      if (handler) {
        const stepId = `downtime-resolution:custom:${outcome.id}`;
        const opRef = `${session.transactionId}:${stepId}`;
        const stepRes = await session.runChildStep<Record<string, unknown>, ChildReceipt>({
          stepId,
          subsystem: "custom",
          operation: outcome.type,
          targetRef: cleanDomainUuid,
          idempotencyKey: `${session.transactionId}:${stepId}`,
          operationRef: opRef,
          intent: {
            outcomeId: outcome.id,
            outcomeType: outcome.type,
            parameters: outcome.parameters,
            optional: isOptional,
            operationRef: opRef
          },
          execute: async () => {
            let handlerRes: any;
            if (typeof handler === "object" && handler !== null && "execute" in handler) {
              handlerRes = await (handler as TransactionalChildHandler).execute(outcome, opRef);
            } else if (typeof handler === "function") {
              handlerRes = await handler(outcome, opRef);
            } else {
              return err(
                createPublicError({
                  code: "DM_HANDLER_NOT_FOUND",
                  category: "internal",
                  message: `Invalid handler for outcome type '${outcome.type}'`
                })
              );
            }

            if (typeof handlerRes === "object" && handlerRes !== null && "ok" in handlerRes) {
              if (handlerRes.ok) {
                return ok(handlerRes.value);
              }
              return err(handlerRes.error);
            }
            const rec = handlerRes as ChildReceipt;
            if (!rec.success && !isOptional) {
              return err(
                createPublicError({
                  code: "DM_DOWNTIME_MANDATORY_OUTCOME_FAILED",
                  category: "conflict",
                  message: `Mandatory outcome '${outcome.label}' failed: ${rec.error ?? "handler failed"}`,
                  details: rec
                })
              );
            }
            return ok(rec);
          }
        });

        if (stepRes.ok) {
          outcomesApplied.push(stepRes.value);
        } else {
          const isUnknown =
            (stepRes.error.details as any)?.outcome === "unknown" ||
            (stepRes.error as any).outcome === "unknown" ||
            stepRes.error.code === "DM_DOMAIN_STORAGE_ERROR";

          if (isUnknown) {
            return session.failAndCompensate(stepRes.error, runCompensator);
          }

          if (!isOptional) {
            return session.failAndCompensate(
              createPublicError({
                code: "DM_DOWNTIME_MANDATORY_OUTCOME_FAILED",
                category: "conflict",
                message: `Mandatory outcome '${outcome.label}' failed: ${stepRes.error.message}`,
                details: stepRes.error
              }),
              runCompensator
            );
          }

          outcomesApplied.push({
            childReceiptId: createOpaqueId("rep"),
            subsystem: "custom",
            action: outcome.type,
            targetRef: cleanDomainUuid,
            payload: outcome.parameters,
            success: false,
            error: stepRes.error.message,
            appliedAt: Date.now()
          });
        }
      } else if (outcome.type === "narrative:event") {
        // Built-in handling for canonical narrative events / logs
        const stepId = `downtime-resolution:narrative:${outcome.id}`;
        const opRef = `${session.transactionId}:${stepId}`;
        const narrativeRes = await session.runChildStep<Record<string, unknown>, ChildReceipt>({
          stepId,
          subsystem: "custom",
          operation: outcome.type,
          targetRef: outcome.id ?? cleanDomainUuid,
          idempotencyKey: `${session.transactionId}:${stepId}`,
          operationRef: opRef,
          intent: { outcomeId: outcome.id, parameters: outcome.parameters, operationRef: opRef },
          execute: async () =>
            ok<ChildReceipt>({
              childReceiptId: createOpaqueId("rep"),
              subsystem: "custom",
              action: outcome.type,
              targetRef: outcome.id ?? cleanDomainUuid,
              payload: outcome.parameters,
              success: true,
              appliedAt: Date.now()
            })
        });
        if (narrativeRes.ok) {
          outcomesApplied.push(narrativeRes.value);
        }
      } else {
        if (!isOptional) {
          return session.failAndCompensate(
            createPublicError({
              code: "DM_DOWNTIME_MANDATORY_OUTCOME_FAILED",
              category: "conflict",
              message: `No handler registered for mandatory outcome type '${outcome.type}' (${outcome.label})`
            }),
            runCompensator
          );
        }
        outcomesApplied.push({
          childReceiptId: createOpaqueId("rep"),
          subsystem: "custom",
          action: outcome.type,
          targetRef: cleanDomainUuid,
          payload: outcome.parameters,
          success: false,
          error: `No handler registered for optional outcome type '${outcome.type}'`,
          appliedAt: Date.now()
        });
      }
    }
  }

  // 3. Mark completed and update domain document
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    return session.failAndCompensate(freshDocRes.error, runCompensator);
  }

  const updatedActivity: DowntimeInstance = {
    ...activity,
    lifecycle: "completed",
    updatedAt: Date.now(),
    revision: activity.revision + 1
  };

  const freshDowntimeData = getDomainDowntimeData(freshDocRes.value.record);
  const updatedActivities = freshDowntimeData.activities.map((a) =>
    a.id === activity.id ? updatedActivity : a
  );
  const updatedRecord = withDomainDowntimeData(freshDocRes.value.record, {
    ...freshDowntimeData,
    activities: Object.freeze(updatedActivities)
  });

  const committingRes = await session.enterCommitting({
    activityId: activity.id,
    expectedLifecycle: "completed",
    expectedRevision: (freshDocRes.value.record.revision ?? 0) + 1
  });
  if (!committingRes.ok) {
    return session.failAndCompensate(committingRes.error, runCompensator);
  }

  const saveRes = await session.commitParent(async () => {
    return context.domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    });
  });

  if (!saveRes.ok) {
    return session.failAndCompensate(saveRes.error, runCompensator);
  }

  const commitDurableRes = await session.commitDurably({
    activity: updatedActivity,
    outcomes: outcomesToExecute,
    outcomesApplied
  });
  if (!commitDurableRes.ok) {
    return commitDurableRes;
  }

  return ok({
    activity: updatedActivity,
    outcomes: outcomesToExecute,
    outcomesApplied
  });
}
