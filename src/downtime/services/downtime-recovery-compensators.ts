import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { TransactionRecord } from "../../mutations/transaction-record.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import {
  isCompensationStepCompleted,
  markCompensationStepCompleted
} from "../../mutations/recovery-service.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import { getDomainDowntimeData } from "../downtime-data.js";

export interface DowntimeCompensatorContext {
  readonly domains: DomainRepositoryContract;
  readonly economyService?: EconomyService;
  readonly transactionStore?: TransactionStore;
}

export interface DowntimeCompensationOptions {
  readonly lockOwner?: string;
  readonly skipReconciliation?: boolean;
}

/**
 * Unified, idempotent compensator for downtime:start (G5-REVAL6-001, G5-REVAL6-002).
 */
export async function compensateDowntimeStart(
  recordOrId: TransactionRecord | string,
  context: DowntimeCompensatorContext,
  options?: DowntimeCompensationOptions
): Promise<Result<void, PublicError>> {
  const record = typeof recordOrId === "string"
    ? context.transactionStore?.get(recordOrId)
    : (context.transactionStore?.get(recordOrId.transactionId) ?? recordOrId);
  if (!record) {
    return err(
      createPublicError({
        code: "DM_TRANSACTION_NOT_FOUND",
        category: "not-found",
        message: `Transaction record '${typeof recordOrId === "string" ? recordOrId : recordOrId.transactionId}' not found`
      })
    );
  }
  const data = record.recoveryData as Record<string, any> | undefined;
  if (!data || data.type !== "downtime:start") {
    return ok(undefined);
  }

  const effectiveLockOwner = options?.lockOwner ?? `recovery_${record.transactionId}`;
  const cleanDomainUuid = normalizeJournalEntryId(data.domainUuid);

  // 1. Parent State Reconciliation (G5-REVAL5-002)
  if (!options?.skipReconciliation) {
    const reachedCommitting = record.history.some(
      (h) => h.toState === "committing" || h.toState === "committed"
    );
    if (reachedCommitting) {
      const docRes = await context.domains.read(cleanDomainUuid);
      if (!docRes.ok) return docRes;
      const dtData = getDomainDowntimeData(docRes.value.record);
      const existingActivity = data.activityId
        ? dtData.activities.find((a) => a.id === data.activityId)
        : undefined;
      if (existingActivity) {
        if (context.transactionStore) {
          context.transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Parent state reconciliation: downtime activity already created on domain"
          );
          await context.transactionStore.flush();
        }
        return ok(undefined);
      }
    }
  }

  // 2. Journaled steps compensation (Master Remediation §15, §19, INV-06)
  if (Array.isArray(data.steps) && data.steps.length > 0) {
    const steps = [...data.steps].reverse();
    for (const step of steps) {
      if (step.state !== "applied" && step.state !== "unknown" && step.state !== "compensating") {
        continue;
      }
      const stepId = step.stepId;
      if (isCompensationStepCompleted(record, stepId, context.transactionStore)) {
        continue;
      }
      if (step.subsystem === "economy" && step.operation === "adjust" && context.economyService) {
        const intent = step.intent as { resourceId: string; deltaMinor: number };
        if (intent && intent.deltaMinor < 0) {
          const idempotencyKey = `${record.transactionId}:compensation:${stepId}`;
          const refRes = await context.economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: intent.resourceId,
            deltaMinor: Math.abs(intent.deltaMinor),
            reason: `Compensation: refund upfront cost for downtime activity ${data.definitionId}`,
            lockOwner: effectiveLockOwner,
            idempotencyKey
          });
          if (!refRes.ok) return refRes;
        }
      }
      await markCompensationStepCompleted(context.transactionStore, record, stepId);
    }
  } else {
    // 2. Refund upfront debited costs (with stable idempotencyKey)
    if (context.economyService && data.debitedCosts && Array.isArray(data.debitedCosts)) {
      for (let i = 0; i < data.debitedCosts.length; i++) {
        const cost = data.debitedCosts[i];
        const stepId = `refund_dt_start_${i}_${cost.resourceId}_${cost.amount}`;
        const idempotencyKey = `${record.transactionId}:${stepId}`;
        if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
          const refRes = await context.economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cost.resourceId,
            deltaMinor: cost.amount,
            reason: `Compensation: refund upfront cost for downtime activity ${data.definitionId}`,
            lockOwner: effectiveLockOwner,
            idempotencyKey
          });
          if (!refRes.ok) return refRes;
          await markCompensationStepCompleted(context.transactionStore, record, stepId);
        }
      }
    }
  }

  return ok(undefined);
}

/**
 * Unified, idempotent compensator for downtime:resolution (G5-REVAL6-001, G5-REVAL6-002).
 */
export async function compensateDowntimeResolution(
  recordOrId: TransactionRecord | string,
  context: DowntimeCompensatorContext,
  options?: DowntimeCompensationOptions
): Promise<Result<void, PublicError>> {
  const record = typeof recordOrId === "string"
    ? context.transactionStore?.get(recordOrId)
    : (context.transactionStore?.get(recordOrId.transactionId) ?? recordOrId);
  if (!record) {
    return err(
      createPublicError({
        code: "DM_TRANSACTION_NOT_FOUND",
        category: "not-found",
        message: `Transaction record '${typeof recordOrId === "string" ? recordOrId : recordOrId.transactionId}' not found`
      })
    );
  }
  const data = record.recoveryData as Record<string, any> | undefined;
  if (!data || data.type !== "downtime:resolution") {
    return ok(undefined);
  }

  const effectiveLockOwner = options?.lockOwner ?? `recovery_${record.transactionId}`;
  const cleanDomainUuid = normalizeJournalEntryId(data.domainUuid);

  // 1. Parent State Reconciliation (G5-REVAL5-002)
  if (!options?.skipReconciliation) {
    const reachedCommitting = record.history.some(
      (h) => h.toState === "committing" || h.toState === "committed"
    );
    if (reachedCommitting) {
      const docRes = await context.domains.read(cleanDomainUuid);
      if (!docRes.ok) return docRes;
      const dtData = getDomainDowntimeData(docRes.value.record);
      const existingActivity = dtData.activities.find((a) => a.id === data.activityId);
      if (existingActivity && existingActivity.lifecycle === "completed") {
        if (context.transactionStore) {
          context.transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Parent state reconciliation: downtime activity already completed on domain"
          );
          await context.transactionStore.flush();
        }
        return ok(undefined);
      }
    }
  }

  // 2. Journaled steps compensation (Master Remediation §15, §19, INV-06)
  if (Array.isArray(data.steps) && data.steps.length > 0) {
    const steps = [...data.steps].reverse();
    for (const step of steps) {
      if (step.state !== "applied" && step.state !== "unknown" && step.state !== "compensating" && step.state !== "executing") {
        continue;
      }
      const stepId = step.stepId;
      if (isCompensationStepCompleted(record, stepId, context.transactionStore)) {
        continue;
      }
      if (step.subsystem === "economy" && step.operation === "adjust" && context.economyService) {
        const intent = step.intent as { resourceId: string; deltaMinor: number };
        if (intent && intent.deltaMinor > 0) {
          const idempotencyKey = `${record.transactionId}:compensation:${stepId}`;
          const revRes = await context.economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: intent.resourceId,
            deltaMinor: -intent.deltaMinor,
            reason: `Compensation: reverse reward for downtime activity ${data.activityId}`,
            lockOwner: effectiveLockOwner,
            idempotencyKey
          });
          if (!revRes.ok) return revRes;
        }
      }
      if (step.subsystem === "custom" && (context as any).outcomeHandlers) {
        const handler = (context as any).outcomeHandlers[step.operation];
        if (handler && typeof handler === "object" && typeof handler.compensate === "function") {
          const compRes = await handler.compensate(step.operationRef ?? step.stepId, step.receipt);
          if (compRes && !compRes.ok) return compRes;
        }
      }
      await markCompensationStepCompleted(context.transactionStore, record, stepId);
    }
  } else {
    // 2. Revert credited rewards (with stable idempotencyKey)
    if (context.economyService && data.creditedRewards && Array.isArray(data.creditedRewards)) {
      for (let i = 0; i < data.creditedRewards.length; i++) {
        const reward = data.creditedRewards[i];
        const stepId = `revert_dt_reward_${i}_${reward.resourceId}_${reward.amount}`;
        const idempotencyKey = `${record.transactionId}:${stepId}`;
        if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
          const revRes = await context.economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: reward.resourceId,
            deltaMinor: -reward.amount,
            reason: `Compensation: reverse reward for downtime activity ${data.activityId}`,
            lockOwner: effectiveLockOwner,
            idempotencyKey
          });
          if (!revRes.ok) return revRes;
          await markCompensationStepCompleted(context.transactionStore, record, stepId);
        }
      }
    }
  }

  return ok(undefined);
}
