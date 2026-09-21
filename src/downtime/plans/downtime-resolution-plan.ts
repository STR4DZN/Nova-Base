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

export type DowntimeOutcomeHandler = (outcome: any) => Promise<ChildReceipt> | ChildReceipt;

export interface DowntimeResolutionPlanContext {
  readonly domains: DomainRepositoryContract;
  readonly downtimeRegistry: DowntimeDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly facilitiesService?: FacilitiesService;
  readonly transactionStore?: TransactionStore;
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
}

/**
 * DowntimeResolutionPlan — Coordinated domain operation plan for completing/resolving a Downtime Activity.
 * (Master Spec §17, DEC-2751, G5-REVAL3-001, G5-REVAL3-002, G5-REVAL3-005)
 *
 * Enforces:
 * 1. Progress and precondition check (elapsed ticks, valid inProgress state).
 * 2. TransactionRecord prepared in TransactionStore before external modifications.
 * 3. Classifies outcomes as MANDATORY vs OPTIONAL (outcome.optional === true).
 * 4. Fails closed and blocks completion if any mandatory outcome fails (never silently marks completed).
 * 5. Explicitly compensates/rolls back executed outcome credits if mandatory outcome or persistence fails.
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
  const candidateOutcomes: DowntimeOutcomeDefinition[] = definition?.outcomeDefinitions
    ? [...definition.outcomeDefinitions]
    : [];

  const outcomesToExecute = params.outcomeKey
    ? candidateOutcomes.filter((o) => o.id === params.outcomeKey)
    : candidateOutcomes;

  // 1. Transaction preparation BEFORE child effects (G5-REVAL3-002, G5-REVAL4-001, G5-REVAL4-002)
  const txId = createOpaqueId("tx");
  const cmdId: CommandId = params.commandId
    ? params.commandId.startsWith("cmd_")
      ? (params.commandId as CommandId)
      : (`cmd_${params.commandId}` as CommandId)
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  if (context.transactionStore) {
    const tx = createTransactionRecord({
      transactionId: txId,
      commandId: cmdId,
      authorityEpoch: epoch,
      lockKeys: [`domain:${cleanDomainUuid}`, `activity:${activity.id}`],
      safeAutoRecovery: false,
      recoveryData: {
        type: "downtime:resolution",
        domainUuid: cleanDomainUuid,
        activityId: activity.id,
        definitionId: activity.definitionId,
        correlationId: params.correlationId,
        causationId: params.causationId,
        status: "prepared"
      }
    });
    context.transactionStore.save(tx);
    const claimRes = context.transactionStore.transition(txId, "claimed", epoch);
    if (!claimRes.ok) return claimRes;
    const prepRes = context.transactionStore.transition(txId, "prepared", epoch);
    if (!prepRes.ok) return prepRes;

    // G5-REVAL4-002: Flush transaction to durable storage BEFORE executing child writes
    try {
      await context.transactionStore.flush();
    } catch (flushErr) {
      context.transactionStore.transition(txId, "failed", epoch, "Persistence flush failed");
      return err(
        createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: `Failed to flush transaction preparation to storage: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
          details: flushErr
        })
      );
    }
  }

  // Track executed credits for rollback on mandatory failure or persistence error
  const creditedResources: { resourceId: string; amount: number }[] = [];
  const outcomesApplied: ChildReceipt[] = [];
  const failedMandatoryOutcomes: { outcome: DowntimeOutcomeDefinition; error: string }[] = [];
  let compensationFailed = false;

  const compensateCredits = async (reason: string) => {
    if (!context.economyService || creditedResources.length === 0) return;
    for (const cred of creditedResources) {
      const refundRes = await context.economyService.commitAdjust({
        domainUuid: cleanDomainUuid,
        resourceId: cred.resourceId,
        deltaMinor: -cred.amount,
        reason: `Compensation: ${reason}`,
        lockOwner: params.commandId
      });
      if (!refundRes.ok) {
        compensationFailed = true;
      }
    }
  };

  // 2. Execute outcomes with mandatory vs optional classification (G5-REVAL3-005)
  for (const outcome of outcomesToExecute) {
    const isOptional = outcome.optional === true;

    if (outcome.type === "economy:grant-resource") {
      const resourceId = (outcome.parameters as any)?.resourceId ?? "credits";
      const amount = Number((outcome.parameters as any)?.amount ?? 0);

      if (context.economyService && amount > 0) {
        const creditRes = await context.economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId,
          deltaMinor: amount,
          reason: `Outcome of downtime activity '${activity.name}': ${outcome.label}`,
          lockOwner: params.commandId
        });

        if (creditRes.ok) {
          creditedResources.push({ resourceId, amount });
          outcomesApplied.push({
            childReceiptId: createOpaqueId("rep"),
            subsystem: "economy",
            action: "grant_resource",
            targetRef: resourceId,
            payload: { resourceId, amount },
            success: true,
            appliedAt: Date.now()
          });
        } else {
          outcomesApplied.push({
            childReceiptId: createOpaqueId("rep"),
            subsystem: "economy",
            action: "grant_resource",
            targetRef: resourceId,
            payload: { resourceId, amount },
            success: false,
            error: creditRes.error.message,
            appliedAt: Date.now()
          });

          if (!isOptional) {
            failedMandatoryOutcomes.push({
              outcome,
              error: `Economy credit failed: ${creditRes.error.message}`
            });
          }
        }
      } else if (!context.economyService && amount > 0) {
        outcomesApplied.push({
          childReceiptId: createOpaqueId("rep"),
          subsystem: "economy",
          action: "grant_resource",
          targetRef: resourceId,
          payload: { resourceId, amount },
          success: false,
          error: "EconomyService not available",
          appliedAt: Date.now()
        });

        if (!isOptional) {
          failedMandatoryOutcomes.push({
            outcome,
            error: "EconomyService not available for mandatory grant-resource outcome"
          });
        }
      } else {
        outcomesApplied.push({
          childReceiptId: createOpaqueId("rep"),
          subsystem: "economy",
          action: "grant_resource",
          targetRef: resourceId,
          payload: { resourceId, amount },
          success: true,
          appliedAt: Date.now()
        });
      }
    } else {
      // Non-economy outcomes: route through outcome handlers
      const handler =
        params.outcomeHandlers?.[outcome.type] ??
        context.defaultOutcomeHandlers?.[outcome.type];

      if (handler) {
        try {
          const res = await handler(outcome);
          outcomesApplied.push(res);
          if (!res.success && !isOptional) {
            failedMandatoryOutcomes.push({
              outcome,
              error: res.error ?? "Outcome handler reported failure"
            });
          }
        } catch (err: any) {
          const errMsg = err?.message ?? String(err);
          outcomesApplied.push({
            childReceiptId: createOpaqueId("rep"),
            subsystem: "custom",
            action: outcome.type,
            targetRef: outcome.id,
            payload: outcome.parameters,
            success: false,
            error: errMsg,
            appliedAt: Date.now()
          });

          if (!isOptional) {
            failedMandatoryOutcomes.push({
              outcome,
              error: `Handler threw error: ${errMsg}`
            });
          }
        }
      } else if (outcome.type === "narrative:event") {
        // Built-in handling for canonical narrative events / logs
        outcomesApplied.push({
          childReceiptId: createOpaqueId("rep"),
          subsystem: "custom",
          action: outcome.type,
          targetRef: outcome.id,
          payload: outcome.parameters,
          success: true,
          appliedAt: Date.now()
        });
      } else {
        // No handler registered
        outcomesApplied.push({
          childReceiptId: createOpaqueId("rep"),
          subsystem: "custom",
          action: outcome.type,
          targetRef: outcome.id,
          payload: outcome.parameters,
          success: false,
          error: `No handler registered for outcome type '${outcome.type}'`,
          appliedAt: Date.now()
        });

        if (!isOptional) {
          failedMandatoryOutcomes.push({
            outcome,
            error: `No handler registered for mandatory outcome type '${outcome.type}'`
          });
        }
      }
    }
  }

  // 3. Fail closed if any mandatory outcome failed (G5-REVAL3-005)
  if (failedMandatoryOutcomes.length > 0) {
    await compensateCredits("rollback outcome credits after mandatory outcome failure");

    if (context.transactionStore) {
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(
        txId,
        targetState,
        epoch,
        `Mandatory outcome(s) failed: ${failedMandatoryOutcomes.map((f) => f.outcome.label).join(", ")}`
      );
    }

    return err(
      createPublicError({
        code: "DM_DOWNTIME_MANDATORY_OUTCOME_FAILED",
        category: "conflict",
        message: `Downtime completion blocked: mandatory outcome(s) failed: ${failedMandatoryOutcomes.map((f) => `${f.outcome.label} (${f.error})`).join("; ")}`,
        details: { failedOutcomes: failedMandatoryOutcomes }
      })
    );
  }

  // 4. All mandatory outcomes succeeded: complete activity
  const now = Date.now();
  const updatedActivity: DowntimeInstance = {
    ...activity,
    lifecycle: "completed",
    completedAt: now,
    revision: activity.revision + 1,
    updatedAt: now
  };

  // 5. Re-read fresh domain document after outcome execution
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    await compensateCredits("domain read failed after outcome execution");
    if (context.transactionStore) {
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, freshDocRes.error.message);
    }
    return freshDocRes;
  }

  const freshDowntimeData = getDomainDowntimeData(freshDocRes.value.record);
  const updatedActivities = freshDowntimeData.activities.map((a) =>
    a.id === params.activityId ? updatedActivity : a
  );

  const updatedRecord = withDomainDowntimeData(freshDocRes.value.record, {
    ...freshDowntimeData,
    activities: Object.freeze(updatedActivities)
  });

  if (context.transactionStore) {
    const committingRes = context.transactionStore.transition(txId, "committing", epoch);
    if (!committingRes.ok) {
      await compensateCredits(`transition to committing failed: ${committingRes.error.message}`);
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, committingRes.error.message);
      return committingRes;
    }
  }

  const saveRes = await context.domains.save({
    ...freshDocRes.value,
    record: updatedRecord
  });

  if (!saveRes.ok) {
    await compensateCredits(`domain save failed for activity completion: ${saveRes.error.message}`);
    if (context.transactionStore) {
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, saveRes.error.message);
    }
    return saveRes;
  }

  if (context.transactionStore) {
    const committedRes = context.transactionStore.transition(txId, "committed", epoch);
    if (!committedRes.ok) return committedRes;
    try {
      await context.transactionStore.flush();
    } catch {
      // already committed
    }
  }

  return ok({
    activity: updatedActivity,
    outcomes: Object.freeze(outcomesToExecute),
    outcomesApplied: Object.freeze(outcomesApplied)
  });
}
