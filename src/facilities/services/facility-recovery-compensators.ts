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
import { getDomainFacilitiesData, withDomainFacilitiesData } from "../facility-data.js";
import type { FacilityInstance } from "../types/facility-types.js";
import type { FacilityOperationRecoveryData } from "./facilities-service.js";

export interface FacilityCompensatorContext {
  readonly domains: DomainRepositoryContract;
  readonly economyService?: EconomyService;
  readonly transactionStore?: TransactionStore;
}

export interface FacilityCompensationOptions {
  readonly lockOwner?: string;
  readonly skipReconciliation?: boolean;
}

/**
 * Unified, idempotent compensator for facilities:maintenance and facilities:repair (G5-REVAL6-001, G5-REVAL6-002).
 */
export async function compensateFacilityOperation(
  recordOrId: TransactionRecord | string,
  context: FacilityCompensatorContext,
  options?: FacilityCompensationOptions
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
  const data = record.recoveryData as (FacilityOperationRecoveryData & Record<string, any>) | undefined;
  if (!data || (data.type !== "facilities:maintenance" && data.type !== "facilities:repair")) {
    return ok(undefined);
  }

  const effectiveLockOwner = options?.lockOwner ?? `recovery_${record.transactionId}`;
  const cleanDomainUuid = normalizeJournalEntryId(data.domainUuid);

  // 1. Parent State Reconciliation (G5-REVAL5-002, G5-REVAL5-008)
  if (!options?.skipReconciliation) {
    const reachedCommitting = record.history.some(
      (h) => h.toState === "committing" || h.toState === "committed"
    );
    if (reachedCommitting) {
      const docRes = await context.domains.read(cleanDomainUuid);
      if (!docRes.ok) return docRes;
      const facData = getDomainFacilitiesData(docRes.value.record);
      const currentFacility = facData.facilities.find((f) => f.id === data.facilityId);
      if (
        currentFacility &&
        data.expectedFacilityRevision !== undefined &&
        currentFacility.revision >= data.expectedFacilityRevision
      ) {
        if (context.transactionStore) {
          context.transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            `Parent state reconciliation: ${data.type} already updated on domain`
          );
          await context.transactionStore.flush();
        }
        return ok(undefined);
      }
    }
  }

  // 2. Restore facility snapshot if needed
  if (data.facilitySnapshot) {
    const stepId = `restore_facility_snapshot_${data.facilityId}`;
    if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
      const docRes = await context.domains.read(cleanDomainUuid);
      if (!docRes.ok) return docRes;
      const facData = getDomainFacilitiesData(docRes.value.record);
      const currentFacility = facData.facilities.find((f) => f.id === data.facilityId);
      if (currentFacility && currentFacility.revision !== data.facilitySnapshot.revision) {
        const restoredFacility: FacilityInstance = {
          ...(data.facilitySnapshot as FacilityInstance),
          id: data.facilityId,
          updatedAt: Date.now()
        };
        const restoredFacilities = facData.facilities.map((f) =>
          f.id === data.facilityId ? restoredFacility : f
        );
        const updatedRecord = withDomainFacilitiesData(docRes.value.record, {
          ...facData,
          facilities: Object.freeze(restoredFacilities)
        });
        const saveRes = await context.domains.save({
          ...docRes.value,
          record: updatedRecord
        });
        if (!saveRes.ok) return saveRes;
      }
      await markCompensationStepCompleted(context.transactionStore, record, stepId);
    }
  }

  // 3. Refund debited costs with stable idempotencyKey (Master Remediation §15, §19, INV-06)
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
            reason: `Compensation: refund ${data.type} cost for facility ${data.facilityId}`,
            lockOwner: effectiveLockOwner,
            idempotencyKey
          });
          if (!refRes.ok) return refRes;
        }
      }
      await markCompensationStepCompleted(context.transactionStore, record, stepId);
    }
  } else if (context.economyService && data.debitedCosts && Array.isArray(data.debitedCosts)) {
    for (let i = 0; i < data.debitedCosts.length; i++) {
      const cost = data.debitedCosts[i];
      const stepId = `refund_fac_cost_${i}_${cost.resourceId}_${cost.amount}`;
      const idempotencyKey = `${record.transactionId}:${stepId}`;
      if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
        const refRes = await context.economyService.commitAdjust({
          domainUuid: data.domainUuid,
          resourceId: cost.resourceId,
          deltaMinor: cost.amount,
          reason: `Compensation: refund ${data.type} cost for facility ${data.facilityId}`,
          lockOwner: effectiveLockOwner,
          idempotencyKey
        });
        if (!refRes.ok) return refRes;
        await markCompensationStepCompleted(context.transactionStore, record, stepId);
      }
    }
  }

  return ok(undefined);
}
