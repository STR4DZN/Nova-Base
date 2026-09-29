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
import type { FacilitiesService } from "../../facilities/services/facilities-service.js";
import { PeopleService, type PublicPeopleApi } from "../../people/services/people-service.js";
import { getDomainProjectsData, withDomainProjectsData } from "../project-data.js";
import { getDomainFacilitiesData, withDomainFacilitiesData } from "../../facilities/facility-data.js";
import type {
  TransactionalChildHandler,
  TransactionalChildHandlerRegistry
} from "../../mutations/child-handler-contract.js";

export interface ProjectCompensatorContext {
  readonly domains: DomainRepositoryContract;
  readonly economyService?: EconomyService;
  readonly facilitiesService?: FacilitiesService;
  readonly peopleService?: PublicPeopleApi;
  readonly transactionStore?: TransactionStore;
  readonly childHandlerRegistry?: TransactionalChildHandlerRegistry;
  readonly sideEffectHandlers?: Record<string, any>;
}

export interface ProjectCompensationOptions {
  readonly lockOwner?: string;
  readonly skipReconciliation?: boolean;
}

/**
 * Unified, idempotent compensator for projects:start (G5-REVAL6-001, G5-REVAL6-002).
 * Shared by immediate plan rollback and RecoveryService.
 */
export async function compensateProjectStart(
  recordOrId: TransactionRecord | string,
  context: ProjectCompensatorContext,
  options?: ProjectCompensationOptions
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
  if (!data || data.type !== "projects:start") {
    return ok(undefined);
  }

  const effectiveLockOwner = options?.lockOwner ?? `recovery_${record.transactionId}`;
  const cleanDomainUuid = normalizeJournalEntryId(data.domainUuid);
  const peopleService = context.peopleService ?? new PeopleService(context.domains);

  // 1. Parent State Reconciliation (G5-REVAL5-002)
  if (!options?.skipReconciliation) {
    const reachedCommitting = record.history.some(
      (h) => h.toState === "committing" || h.toState === "committed"
    );
    if (reachedCommitting) {
      const docRes = await context.domains.read(cleanDomainUuid);
      if (!docRes.ok) return docRes;
      const prjData = getDomainProjectsData(docRes.value.record);
      const existingProject = prjData.projects.find((p) => p.id === data.projectId);
      if (existingProject) {
        if (context.transactionStore) {
          context.transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Parent state reconciliation: project already created on domain"
          );
          await context.transactionStore.flush();
        }
        return ok(undefined);
      }
    }
  }

  // 2. Refund debited upfront costs (Master Remediation §15, §19, INV-06)
  if (context.economyService) {
    if (Array.isArray(data.steps) && data.steps.length > 0) {
      for (const step of data.steps) {
        if (
          step.subsystem === "economy" &&
          step.operation === "adjust" &&
          (step.state === "applied" || step.state === "unknown" || step.state === "compensating" || step.state === "executing")
        ) {
          const stepId = step.stepId;
          if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
            const intent = step.intent as { resourceId: string; deltaMinor: number };
            if (intent && intent.deltaMinor < 0) {
              const opRef = step.operationRef ?? step.stepId;
              const idempotencyKey = `${record.transactionId}:compensation:${stepId}`;
              const refRes = await context.economyService.compensateAdjustment({
                domainUuid: data.domainUuid,
                resourceId: intent.resourceId,
                originalOperationRef: opRef,
                compensationOperationRef: idempotencyKey,
                originalDeltaMinor: intent.deltaMinor,
                reason: `Compensation: refund upfront cost for project ${data.projectId}`,
                lockOwner: effectiveLockOwner,
                parentTransactionId: record.transactionId
              });
              if (!refRes.ok) return refRes;
              await markCompensationStepCompleted(context.transactionStore, record, stepId);
            }
          }
        }
      }
    } else if (data.debitedCosts && Array.isArray(data.debitedCosts)) {
      for (let i = 0; i < data.debitedCosts.length; i++) {
        const cost = data.debitedCosts[i];
        const stepId = `refund_start_cost_${i}_${cost.resourceId}_${cost.amountMinor}`;
        const idempotencyKey = `${record.transactionId}:${stepId}`;
        if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
          const refRes = await context.economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cost.resourceId,
            deltaMinor: cost.amountMinor,
            reason: `Compensation: refund upfront cost for project ${data.projectId}`,
            lockOwner: effectiveLockOwner,
            idempotencyKey,
            parentTransactionId: record.transactionId,
            recoveryOwner: "parent"
          });
          if (!refRes.ok) return refRes;
          await markCompensationStepCompleted(context.transactionStore, record, stepId);
        }
      }
    }
  }

  // 3. Release economic reservations
  if (context.economyService) {
    if (Array.isArray(data.steps) && data.steps.length > 0) {
      for (const step of data.steps) {
        if (
          step.subsystem === "economy" &&
          step.operation === "reserve" &&
          (step.state === "applied" || step.state === "unknown" || step.state === "compensating" || step.state === "executing")
        ) {
          const stepId = step.stepId;
          if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
            const receipt = step.receipt as any;
            const resId =
              receipt?.id ??
              receipt?.reservationId ??
              (typeof receipt === "string" ? receipt : undefined) ??
              (step.intent as any)?.reservationId;
            if (resId) {
              const resObj = context.economyService.getReservation(resId);
              if (resObj && (resObj.status === "active" || resObj.status === "partially-consumed")) {
                const relRes = await context.economyService.releaseReservation({
                  domainUuid: data.domainUuid,
                  reservationId: resId,
                  reason: `Compensation: release reservation for project start ${data.projectId}`,
                  lockOwner: effectiveLockOwner
                });
                if (!relRes.ok) return relRes;
              }
            }
            await markCompensationStepCompleted(context.transactionStore, record, stepId);
          }
        }
      }
    } else if (data.createdReservationIds && Array.isArray(data.createdReservationIds)) {
      for (const resId of data.createdReservationIds) {
        const stepId = `release_res_${resId}`;
        if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
          const resObj = context.economyService.getReservation(resId);
          if (resObj && (resObj.status === "active" || resObj.status === "partially-consumed")) {
            const relRes = await context.economyService.releaseReservation({
              domainUuid: data.domainUuid,
              reservationId: resId,
              reason: `Compensation: release reservation for project start ${data.projectId}`,
              lockOwner: effectiveLockOwner
            });
            if (!relRes.ok) return relRes;
          }
          await markCompensationStepCompleted(context.transactionStore, record, stepId);
        }
      }
    }
  }

  // 4. Release allocated workforce reservation
  if (Array.isArray(data.steps) && data.steps.length > 0) {
    for (const step of data.steps) {
      if (
        step.subsystem === "people" &&
        (step.operation === "allocateWorkforceReservation" || step.operation === "reserve-workforce") &&
        (step.state === "applied" || step.state === "unknown" || step.state === "compensating" || step.state === "executing")
      ) {
        const stepId = step.stepId;
        if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
          const receipt = step.receipt as any;
          const resId =
            receipt?.reservationId ??
            receipt?.id ??
            (typeof receipt === "string" ? receipt : undefined) ??
            (step.intent as any)?.reservationId ??
            data.allocatedWorkforceReservationId;
          if (resId) {
            const relWf = await peopleService.releaseWorkforceReservation({
              domainUuid: data.domainUuid,
              projectId: data.projectId,
              reservationId: resId
            });
            if (!relWf.ok) return relWf;
          }
          await markCompensationStepCompleted(context.transactionStore, record, stepId);
        }
      }
    }
  } else if (data.allocatedWorkforceReservationId) {
    const stepId = `release_wf_${data.allocatedWorkforceReservationId}`;
    if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
      const relWf = await peopleService.releaseWorkforceReservation({
        domainUuid: data.domainUuid,
        projectId: data.projectId,
        reservationId: data.allocatedWorkforceReservationId
      });
      if (!relWf.ok) return relWf;
      await markCompensationStepCompleted(context.transactionStore, record, stepId);
    }
  }

  return ok(undefined);
}

/**
 * Unified, idempotent compensator for projects:advance (G5-REVAL6-001, G5-REVAL6-002).
 */
export async function compensateProjectAdvance(
  recordOrId: TransactionRecord | string,
  context: ProjectCompensatorContext,
  options?: ProjectCompensationOptions
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
  if (!data || data.type !== "projects:advance") {
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
      const prjData = getDomainProjectsData(docRes.value.record);
      const existingProject = prjData.projects.find((p) => p.id === data.projectId);
      if (
        existingProject &&
        data.expectedWorkCompleted !== undefined &&
        existingProject.workCompleted >= data.expectedWorkCompleted
      ) {
        if (context.transactionStore) {
          context.transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Parent state reconciliation: project work already advanced on domain"
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
        if (intent && intent.deltaMinor < 0) {
          const opRef = step.operationRef ?? step.stepId;
          const idempotencyKey = `${record.transactionId}:compensation:${stepId}`;
          const refRes = await context.economyService.compensateAdjustment({
            domainUuid: data.domainUuid,
            resourceId: intent.resourceId,
            originalOperationRef: opRef,
            compensationOperationRef: idempotencyKey,
            originalDeltaMinor: intent.deltaMinor,
            reason: `Compensation: refund progressive cost for project ${data.projectId}`,
            lockOwner: effectiveLockOwner,
            parentTransactionId: record.transactionId
          });
          if (!refRes.ok) return refRes;
        }
      }
      await markCompensationStepCompleted(context.transactionStore, record, stepId);
    }
  } else {
    // 2. Refund debited progressive costs (with stable idempotencyKey)
    if (context.economyService && data.debitedCosts && Array.isArray(data.debitedCosts)) {
      for (let i = 0; i < data.debitedCosts.length; i++) {
        const cost = data.debitedCosts[i];
        const stepId = `refund_advance_cost_${i}_${cost.resourceId}_${cost.amountMinor}`;
        const idempotencyKey = `${record.transactionId}:${stepId}`;
        if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
          const refRes = await context.economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cost.resourceId,
            deltaMinor: cost.amountMinor,
            reason: `Compensation: refund progressive cost for project ${data.projectId}`,
            lockOwner: effectiveLockOwner,
            idempotencyKey,
            parentTransactionId: record.transactionId,
            recoveryOwner: "parent"
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
 * Unified, idempotent compensator for projects:cancel (G5-REVAL6-001, G5-REVAL6-002).
 */
export async function compensateProjectCancel(
  recordOrId: TransactionRecord | string,
  context: ProjectCompensatorContext,
  options?: ProjectCompensationOptions
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
  if (!data || data.type !== "projects:cancel") {
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
      const prjData = getDomainProjectsData(docRes.value.record);
      const existingProject = prjData.projects.find((p) => p.id === data.projectId);
      if (existingProject && existingProject.lifecycle === "cancelled") {
        if (context.transactionStore) {
          context.transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Parent state reconciliation: project already cancelled on domain"
          );
          await context.transactionStore.flush();
        }
        return ok(undefined);
      }
    }
  }

  // 2. Restore released economic reservations
  if (context.economyService && data.releasedReservationSnapshots && Array.isArray(data.releasedReservationSnapshots)) {
    for (const snap of data.releasedReservationSnapshots) {
      const stepId = `restore_cancel_res_${snap.id}`;
      if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
        // Pre-reconciliation: check if reservation is already active
        const existing = context.economyService.getReservation(snap.id);
        if (!existing || existing.status !== "active") {
          const restRes = await context.economyService.restoreReservation({
            domainUuid: data.domainUuid,
            reservationSnapshot: snap,
            reason: `Compensation: restore cancelled reservation for project ${data.projectId}`,
            lockOwner: effectiveLockOwner
          });
          if (!restRes.ok) return restRes;
        }
        await markCompensationStepCompleted(context.transactionStore, record, stepId);
      }
    }
  }

  // 3. Restore released workforce reservations
  const peopleService = context.peopleService ?? new PeopleService(context.domains);
  if (data.releasedWorkforceSnapshots && Array.isArray(data.releasedWorkforceSnapshots)) {
    for (const wf of data.releasedWorkforceSnapshots) {
      const stepId = `restore_cancel_wf_${wf.reservationId}`;
      if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
        const restWf = await peopleService.restoreWorkforceReservation({
          domainUuid: data.domainUuid,
          projectId: data.projectId,
          reservationId: wf.reservationId
        });
        if (!restWf.ok) return restWf;
        await markCompensationStepCompleted(context.transactionStore, record, stepId);
      }
    }
  }

  return ok(undefined);
}

/**
 * Unified, idempotent compensator for projects:completion (G5-REVAL6-001, G5-REVAL6-002).
 */
export async function compensateProjectCompletion(
  recordOrId: TransactionRecord | string,
  context: ProjectCompensatorContext,
  options?: ProjectCompensationOptions
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
  if (!data || data.type !== "projects:completion") {
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
      const prjData = getDomainProjectsData(docRes.value.record);
      const existingProject = prjData.projects.find((p) => p.id === data.projectId);
      if (existingProject && existingProject.lifecycle === "completed") {
        if (context.transactionStore) {
          context.transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Parent state reconciliation: project completion already committed on domain"
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
      if (step.subsystem === "economy" && context.economyService) {
        if (step.operation === "adjust") {
          const intent = step.intent as { resourceId: string; deltaMinor: number };
          if (intent) {
            const opRef = step.operationRef ?? step.stepId;
            const idempotencyKey = `${record.transactionId}:compensation:${stepId}`;
            const refRes = await context.economyService.compensateAdjustment({
              domainUuid: data.domainUuid,
              resourceId: intent.resourceId,
              originalOperationRef: opRef,
              compensationOperationRef: idempotencyKey,
              originalDeltaMinor: intent.deltaMinor,
              reason: `Compensation: reverse completion adjustment for project ${data.projectId}`,
              lockOwner: effectiveLockOwner,
              parentTransactionId: record.transactionId
            });
            if (!refRes.ok) return refRes;
          }
        }
      }
      if ((step.subsystem === "facility" || step.subsystem === "facilities") && context.domains) {
        const receipt = step.receipt as any;
        const facId = receipt?.facility?.id ?? receipt?.id ?? (step.intent as any)?.facilityId;
        if (facId) {
          const docRes = await context.domains.read(cleanDomainUuid);
          if (docRes.ok) {
            const facData = getDomainFacilitiesData(docRes.value.record);
            const remaining = facData.facilities.filter((f) => f.id !== facId);
            if (remaining.length !== facData.facilities.length) {
              const updatedRecord = withDomainFacilitiesData(docRes.value.record, {
                ...facData,
                facilities: Object.freeze(remaining)
              });
              const saveRes = await context.domains.save({
                ...docRes.value,
                record: updatedRecord
              });
              if (!saveRes.ok) return saveRes;
            }
          }
        }
      }
      if (step.subsystem === "custom") {
        const handler: TransactionalChildHandler | undefined =
          context.childHandlerRegistry?.get(step.operation);

        if (!handler) {
          return err(
            createPublicError({
              code: "DM_RECOVERY_HANDLER_UNAVAILABLE",
              category: "conflict",
              message: `Recovery handler for custom operation '${step.operation}' is not available in registry`
            })
          );
        }

        const opRef = step.operationRef ?? step.stepId;
        const isUncertain = step.state === "unknown" || step.state === "executing";

        if (isUncertain) {
          if (typeof handler !== "object" || typeof (handler as any).reconcile !== "function") {
            return err(
              createPublicError({
                code: "DM_RECOVERY_HANDLER_CONTRACT_INSUFFICIENT",
                category: "conflict",
                message: `Recovery handler for custom operation '${step.operation}' must provide reconcile() for uncertain step '${step.stepId}'`
              })
            );
          }

          const recRes = await handler.reconcile!(opRef);
          if (!recRes.ok) return recRes;
          if (recRes.value === "not-applied") {
            await markCompensationStepCompleted(context.transactionStore, record, stepId);
            continue;
          }
          if (recRes.value === "unknown") {
            return err(
              createPublicError({
                code: "DM_RECOVERY_RECONCILIATION_UNCERTAIN",
                category: "conflict",
                message: `Reconciliation for custom operation '${step.operation}' returned unknown outcome`
              })
            );
          }
          // Reconcile is "applied" -> must have compensate
          if (typeof (handler as any).compensate !== "function") {
            return err(
              createPublicError({
                code: "DM_RECOVERY_HANDLER_CONTRACT_INSUFFICIENT",
                category: "conflict",
                message: `Recovery handler for custom operation '${step.operation}' must provide compensate() when reconcile returns applied`
              })
            );
          }
        }

        if (typeof handler === "object" && typeof (handler as any).compensate === "function") {
          const compRes = await handler.compensate!(opRef, step.receipt);
          if (compRes && !compRes.ok) return compRes;
        } else if (!isUncertain) {
          return err(
            createPublicError({
              code: "DM_RECOVERY_HANDLER_CONTRACT_INSUFFICIENT",
              category: "conflict",
              message: `Recovery handler for custom operation '${step.operation}' must provide compensate() for applied step '${step.stepId}'`
            })
          );
        }
      }
      await markCompensationStepCompleted(context.transactionStore, record, stepId);
    }
  } else {
    // 2. Revert credited rewards (with stable idempotencyKey)
    if (context.economyService && data.creditedResourceRefs && data.creditedResourceRefs.length > 0) {
      for (let i = 0; i < data.creditedResourceRefs.length; i++) {
        const cred = data.creditedResourceRefs[i];
        const stepId = `revert_credit_${i}_${cred.resourceId}_${cred.amountMinor}`;
        const idempotencyKey = `${record.transactionId}:${stepId}`;
        if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
          const adjRes = await context.economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cred.resourceId,
            deltaMinor: -cred.amountMinor,
            reason: `Compensation: reverse completion reward for project ${data.projectId}`,
            lockOwner: effectiveLockOwner,
            idempotencyKey,
            parentTransactionId: record.transactionId,
            recoveryOwner: "parent"
          });
          if (!adjRes.ok) return adjRes;
          await markCompensationStepCompleted(context.transactionStore, record, stepId);
        }
      }
    }

    // 3. Refund debited costs (with stable idempotencyKey)
    if (context.economyService && data.debitedCostRefs && data.debitedCostRefs.length > 0) {
      for (let i = 0; i < data.debitedCostRefs.length; i++) {
        const deb = data.debitedCostRefs[i];
        const stepId = `refund_debit_${i}_${deb.resourceId}_${deb.amountMinor}`;
        const idempotencyKey = `${record.transactionId}:${stepId}`;
        if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
          const refRes = await context.economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: deb.resourceId,
            deltaMinor: deb.amountMinor,
            reason: `Compensation: refund completion cost for project ${data.projectId}`,
            lockOwner: effectiveLockOwner,
            idempotencyKey,
            parentTransactionId: record.transactionId,
            recoveryOwner: "parent"
          });
          if (!refRes.ok) return refRes;
          await markCompensationStepCompleted(context.transactionStore, record, stepId);
        }
      }
    }
  }

  // 4. Restore consumed economic reservations
  if (context.economyService && data.consumedReservationSnapshots && data.consumedReservationSnapshots.length > 0) {
    for (const snap of data.consumedReservationSnapshots) {
      const stepId = `restore_res_${snap.reservation.id}`;
      if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
        // Pre-reconciliation check
        const existing = context.economyService.getReservation(snap.reservation.id);
        if (!existing || existing.status !== "active") {
          const restRes = await context.economyService.restoreReservation({
            domainUuid: data.domainUuid,
            reservationSnapshot: snap.reservation,
            consumedAmount: snap.consumedAmount,
            reason: `Compensation: restore consumed reservation ${snap.reservation.id} for project ${data.projectId}`,
            lockOwner: effectiveLockOwner
          });
          if (!restRes.ok) return restRes;
        }
        await markCompensationStepCompleted(context.transactionStore, record, stepId);
      }
    }
  }

  // 5. Restore released workforce reservations
  const peopleService = context.peopleService ?? new PeopleService(context.domains);
  if (data.releasedWorkforceSnapshots && data.releasedWorkforceSnapshots.length > 0) {
    for (const wf of data.releasedWorkforceSnapshots) {
      const stepId = `restore_wf_${wf.reservationId}`;
      if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
        const restWf = await peopleService.restoreWorkforceReservation({
          domainUuid: data.domainUuid,
          projectId: data.projectId,
          reservationId: wf.reservationId
        });
        if (!restWf.ok) return restWf;
        await markCompensationStepCompleted(context.transactionStore, record, stepId);
      }
    }
  }

  // 6. Rollback created facilities
  if (data.createdFacilityIds && data.createdFacilityIds.length > 0) {
    const stepId = `rollback_facilities_${data.createdFacilityIds.join("_")}`;
    if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
      const docRes = await context.domains.read(cleanDomainUuid);
      if (!docRes.ok) return docRes;
      const facData = getDomainFacilitiesData(docRes.value.record);
      const remainingFacilities = facData.facilities.filter(
        (f) => !data.createdFacilityIds.includes(f.id)
      );
      if (remainingFacilities.length !== facData.facilities.length) {
        const updatedRecord = withDomainFacilitiesData(docRes.value.record, {
          ...facData,
          facilities: Object.freeze(remainingFacilities)
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

  // 7. Restore project snapshot
  if (data.projectSnapshot) {
    const stepId = `restore_project_snapshot_${data.projectId}`;
    if (!isCompensationStepCompleted(record, stepId, context.transactionStore)) {
      const docRes = await context.domains.read(cleanDomainUuid);
      if (!docRes.ok) return docRes;
      const prjData = getDomainProjectsData(docRes.value.record);
      const restoredProjects = prjData.projects.map((p) =>
        p.id === data.projectId ? { ...data.projectSnapshot, updatedAt: Date.now() } : p
      );
      const updatedRecord = withDomainProjectsData(docRes.value.record, {
        ...prjData,
        projects: Object.freeze(restoredProjects)
      });
      const saveRes = await context.domains.save({
        ...docRes.value,
        record: updatedRecord
      });
      if (!saveRes.ok) return saveRes;
      await markCompensationStepCompleted(context.transactionStore, record, stepId);
    }
  }

  return ok(undefined);
}
