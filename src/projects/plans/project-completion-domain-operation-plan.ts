import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { createCommandId, type CommandId } from "../../commands/command-envelope.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { ProjectDefinitionRegistry } from "../definitions/project-registry.js";
import type { ProjectInstance } from "../types/project-types.js";
import { getDomainProjectsData, withDomainProjectsData } from "../project-data.js";
import {
  evaluateProjectCompletionPlan,
  commitProjectCompletion,
  type ProjectCompletionCommitOptions,
  type SideEffectHandler
} from "./project-completion-plan-service.js";
import type { ChildReceipt } from "./project-plan-types.js";
import type { Reservation } from "../../economy/reservations/reservation-types.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { FacilitiesService } from "../../facilities/services/facilities-service.js";
import { getDomainFacilitiesData, withDomainFacilitiesData } from "../../facilities/facility-data.js";
import { PeopleService, type PublicPeopleApi } from "../../people/services/people-service.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import { createTransactionRecord } from "../../mutations/transaction-record.js";

export interface ProjectCompletionDomainOperationParams {
  readonly domainUuid: string;
  readonly projectId: string;
  readonly expectedRevision?: number;
  readonly userId?: string | null;
  readonly commandId?: string;
  readonly authorityEpoch?: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly sideEffectHandlers?: Readonly<Record<string, SideEffectHandler>>;
}

export interface ProjectCompletionDomainOperationContext {
  readonly domains: DomainRepositoryContract;
  readonly projectRegistry: ProjectDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly facilitiesService?: FacilitiesService;
  readonly peopleService?: PublicPeopleApi;
  readonly transactionStore?: TransactionStore;
}

export interface ProjectCompletionRecoveryData {
  readonly type: "projects:completion";
  readonly projectId: string;
  readonly planId: string;
  readonly domainUuid: string;
  readonly projectSnapshot: ProjectInstance;
  readonly createdFacilityIds: readonly string[];
  readonly debitedCostRefs: readonly { resourceId: string; amountMinor: number }[];
  readonly creditedResourceRefs: readonly { resourceId: string; amountMinor: number }[];
  readonly consumedReservationIds: readonly string[];
  readonly consumedReservationSnapshots?: readonly { reservation: Reservation; consumedAmount: number }[];
  readonly releasedWorkforceSnapshots?: readonly { reservationId: string; amount: number; workforceTypeId: string }[];
  readonly expectedRevision?: number;
  readonly authorityEpoch: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly status: "prepared" | "executing" | "completed" | "needs-recovery" | "failed";
}

/**
 * ProjectCompletionDomainOperationPlan — Canonical composite operation plan for completing a Project.
 * (Master Spec §15, §11.2, G5-REVAL3-001, G5-REVAL3-003, G5-REVAL3-004)
 *
 * Enforces:
 * 1. TransactionRecord prepared in TransactionStore BEFORE child writes.
 * 2. Child writes executed with strict Result checking (consumption, debits, facilities, rewards).
 * 3. Durable recoveryData capturing project snapshot, created facility IDs, and ledger refs.
 * 4. Automatic transition to "needs-recovery" on any partial failure or persistence error.
 */
export async function executeProjectCompletionDomainOperationPlan(
  context: ProjectCompletionDomainOperationContext,
  params: ProjectCompletionDomainOperationParams
): Promise<Result<{ readonly project: ProjectInstance; readonly childReceipts: readonly ChildReceipt[] }, PublicError>> {
  const cleanDomainUuid = normalizeJournalEntryId(params.domainUuid);
  const docRes = await context.domains.read(cleanDomainUuid);
  if (!docRes.ok) return docRes;

  const record = docRes.value.record;
  const currentProjectsData = getDomainProjectsData(record);
  const project = currentProjectsData.projects.find((p) => p.id === params.projectId);
  if (!project) {
    return err(
      createPublicError({
        code: "DM_PROJECT_NOT_FOUND",
        category: "not-found",
        message: `Project ${params.projectId} not found in domain ${params.domainUuid}`
      })
    );
  }

  if (params.expectedRevision !== undefined && project.revision !== params.expectedRevision) {
    return err(
      createPublicError({
        code: "DM_PROJECT_REVISION_MISMATCH",
        category: "conflict",
        message: `Project revision mismatch: expected ${params.expectedRevision}, found ${project.revision}`
      })
    );
  }

  const definition = context.projectRegistry.get(project.definitionId);
  if (!definition) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_NOT_FOUND",
        category: "not-found",
        message: `Project definition ${project.definitionId} not found`
      })
    );
  }

  const plan = evaluateProjectCompletionPlan({
    project,
    definition,
    domain: record,
    expectedRevision: params.expectedRevision
  });

  if (!plan.isSatisfied) {
    const firstBlocker = plan.blockers[0];
    return err(
      createPublicError({
        code: "DM_PROJECT_COMPLETION_BLOCKED",
        category: "conflict",
        message: firstBlocker?.message ?? "Project completion preconditions unsatisfied",
        details: { blockers: plan.blockers }
      })
    );
  }

  // 1. Transaction preparation BEFORE child effects (G5-REVAL2-005, G5-REVAL3-004)
  const txId = createOpaqueId("tx");
  const cmdId: CommandId = params.commandId
    ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  const createdFacilityIds: string[] = [];
  const debitedCostRefs: Array<{ resourceId: string; amountMinor: number }> = [];
  const creditedResourceRefs: Array<{ resourceId: string; amountMinor: number }> = [];
  const consumedReservationIds: string[] = [];
  const consumedReservationSnapshots: Array<{ reservation: Reservation; consumedAmount: number }> = [];
  const releasedWorkforceSnapshots: Array<{ reservationId: string; amount: number; workforceTypeId: string }> = [];

  const buildRecoveryData = (status: ProjectCompletionRecoveryData["status"]): ProjectCompletionRecoveryData => ({
    type: "projects:completion",
    projectId: project.id,
    planId: plan.planId,
    domainUuid: cleanDomainUuid,
    projectSnapshot: project,
    createdFacilityIds: Object.freeze([...createdFacilityIds]),
    debitedCostRefs: Object.freeze([...debitedCostRefs]),
    creditedResourceRefs: Object.freeze([...creditedResourceRefs]),
    consumedReservationIds: Object.freeze([...consumedReservationIds]),
    consumedReservationSnapshots: Object.freeze([...consumedReservationSnapshots]),
    releasedWorkforceSnapshots: Object.freeze([...releasedWorkforceSnapshots]),
    expectedRevision: project.revision + 1,
    authorityEpoch: epoch,
    correlationId: params.correlationId,
    causationId: params.causationId,
    status
  });

  if (context.transactionStore) {
    const tx = createTransactionRecord({
      transactionId: txId,
      commandId: cmdId,
      authorityEpoch: epoch,
      lockKeys: [`domain:${cleanDomainUuid}`, `project:${project.id}`],
      safeAutoRecovery: false,
      recoveryData: buildRecoveryData("prepared")
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

  let compensationFailed = false;
  const compensatePriorSteps = async (reason: string) => {
    // 1. Revert credited resources
    if (context.economyService && creditedResourceRefs.length > 0) {
      for (const cred of creditedResourceRefs) {
        const revRes = await context.economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cred.resourceId,
          deltaMinor: -cred.amountMinor,
          reason: `Compensation: ${reason}`,
          lockOwner: params.commandId
        });
        if (!revRes.ok) {
          compensationFailed = true;
        }
      }
    }
    // 2. Refund debited costs (G5-REVAL5-006)
    if (context.economyService && debitedCostRefs.length > 0) {
      for (const cost of debitedCostRefs) {
        const refRes = await context.economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: cost.amountMinor,
          reason: `Compensation: ${reason}`,
          lockOwner: params.commandId
        });
        if (!refRes.ok) {
          compensationFailed = true;
        }
      }
    }
    // 3. Restore consumed reservations
    if (context.economyService && consumedReservationSnapshots.length > 0) {
      for (const snap of consumedReservationSnapshots) {
        const restRes = await context.economyService.restoreReservation({
          domainUuid: cleanDomainUuid,
          reservationSnapshot: snap.reservation,
          consumedAmount: snap.consumedAmount,
          reason: `Compensation: ${reason}`,
          lockOwner: params.commandId
        });
        if (!restRes.ok) {
          compensationFailed = true;
        }
      }
    }
    // 4. Restore released workforce reservations
    const peopleService = context.peopleService ?? new PeopleService(context.domains);
    if (releasedWorkforceSnapshots.length > 0) {
      for (const wf of releasedWorkforceSnapshots) {
        const restWf = await peopleService.restoreWorkforceReservation({
          domainUuid: cleanDomainUuid,
          projectId: project.id,
          reservationId: wf.reservationId,
          userId: params.userId
        });
        if (!restWf.ok) {
          compensationFailed = true;
        }
      }
    }
    // 5. Rollback created facilities
    if (context.facilitiesService && createdFacilityIds.length > 0) {
      const freshDoc = await context.domains.read(cleanDomainUuid);
      if (freshDoc.ok) {
        const facData = getDomainFacilitiesData(freshDoc.value.record);
        const remaining = facData.facilities.filter((f) => !createdFacilityIds.includes(f.id));
        if (remaining.length !== facData.facilities.length) {
          const updatedRec = withDomainFacilitiesData(freshDoc.value.record, {
            ...facData,
            facilities: Object.freeze(remaining)
          });
          const sRes = await context.domains.save({ ...freshDoc.value, record: updatedRec });
          if (!sRes.ok) {
            compensationFailed = true;
          }
        }
      } else {
        compensationFailed = true;
      }
    }
  };

  // 2. Execute onCompletion costs with fail-closed validation (G5-REVAL2-003, G5-REVAL3-002, G5-REVAL5-006)
  if (context.economyService) {
    for (const cost of definition.costs) {
      if (cost.timing === "onCompletion") {
        const debitRes = await context.economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: -cost.amountMinor,
          reason: `OnCompletion cost for project ${project.name}`,
          lockOwner: params.commandId
        });
        if (!debitRes.ok) {
          await compensatePriorSteps(`Failed to debit onCompletion cost for '${cost.resourceId}': ${debitRes.error.message}`);
          if (context.transactionStore) {
            const targetState = compensationFailed ? "needs-recovery" : "failed";
            const tx = context.transactionStore.get(txId);
            if (tx) {
              context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData(targetState) });
            }
            context.transactionStore.transition(txId, targetState, epoch, debitRes.error.message);
          }
          return err(
            createPublicError({
              code: "DM_PROJECT_COMPLETION_BLOCKED",
              category: "conflict",
              message: `Failed to debit onCompletion cost for '${cost.resourceId}': ${debitRes.error.message}`,
              details: debitRes.error
            })
          );
        }
        debitedCostRefs.push({ resourceId: cost.resourceId, amountMinor: cost.amountMinor });
        if (context.transactionStore) {
          const tx = context.transactionStore.get(txId);
          if (tx) {
            context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
            try {
              await context.transactionStore.flush();
            } catch (flushErr) {
              await compensatePriorSteps(`Persistence flush failed after onCompletion debit: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
              if (context.transactionStore) {
                const targetState = compensationFailed ? "needs-recovery" : "failed";
                const curTx = context.transactionStore.get(txId);
                if (curTx) {
                  context.transactionStore.save({ ...curTx, recoveryData: buildRecoveryData(targetState) });
                }
                context.transactionStore.transition(txId, targetState, epoch, String(flushErr));
              }
              return err(
                createPublicError({
                  code: "DM_DOMAIN_STORAGE_ERROR",
                  category: "internal",
                  message: `Failed to flush transaction update after onCompletion debit: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
                  details: flushErr
                })
              );
            }
          }
        }
      }
    }
  }

  // 3. Consume active reservations with fail-closed checking (G5-REVAL3-003)
  if (context.economyService) {
    const activeReservations: string[] = [];
    if (project?.metadata?.reservationIds && Array.isArray(project.metadata.reservationIds)) {
      activeReservations.push(...(project.metadata.reservationIds as string[]));
    }
    if ("listReservations" in context.economyService) {
      const matching = context.economyService.listReservations({
        domainUuid: cleanDomainUuid,
        sourceRef: params.projectId,
        status: "active"
      });
      for (const m of matching) {
        if (!activeReservations.includes(m.id)) {
          activeReservations.push(m.id);
        }
      }
    }
    for (const resId of activeReservations) {
      const resObj = context.economyService.getReservation(resId);
      if (resObj && (resObj.status === "active" || resObj.status === "partially-consumed")) {
        const consumedAmount = resObj.remainingAmountMinor;
        const snapshotCopy: Reservation = { ...resObj };
        const consumeRes = await context.economyService.consumeReservation({
          domainUuid: cleanDomainUuid,
          reservationId: resId,
          amountMinor: consumedAmount,
          reason: `Project ${project.name} completed`,
          lockOwner: params.commandId
        });
        if (!consumeRes.ok) {
          // G5-REVAL3-003: Consume failure MUST NOT be silently ignored!
          await compensatePriorSteps(`Failed to consume reservation '${resId}': ${consumeRes.error.message}`);
          if (context.transactionStore) {
            const tx = context.transactionStore.get(txId);
            if (tx) {
              context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("needs-recovery") });
            }
            context.transactionStore.transition(txId, "needs-recovery", epoch, consumeRes.error.message);
          }
          return err(
            createPublicError({
              code: "DM_PROJECT_COMPLETION_BLOCKED",
              category: "conflict",
              message: `Failed to consume reservation '${resId}': ${consumeRes.error.message}`,
              details: consumeRes.error
            })
          );
        }
        consumedReservationIds.push(resId);
        consumedReservationSnapshots.push({ reservation: snapshotCopy, consumedAmount });
        if (context.transactionStore) {
          const tx = context.transactionStore.get(txId);
          if (tx) {
            context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
            try {
              await context.transactionStore.flush();
            } catch (flushErr) {
              await compensatePriorSteps(`Persistence flush failed after reservation consume: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
              if (context.transactionStore) {
                const targetState = compensationFailed ? "needs-recovery" : "failed";
                context.transactionStore.transition(txId, targetState, epoch, String(flushErr));
              }
              return err(
                createPublicError({
                  code: "DM_DOMAIN_STORAGE_ERROR",
                  category: "internal",
                  message: `Failed to flush transaction update after reservation consume: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
                  details: flushErr
                })
              );
            }
          }
        }
      }
    }
  }

  // 4. Release workforce reservations via People API (G5-REVAL3-001, G5-REVAL3-003, G5-REVAL4-006, G5-REVAL5-007)
  if (context.peopleService) {
    let hasActiveReservations = false;
    if ("getReservations" in context.peopleService) {
      const pRes = await context.peopleService.getReservations(cleanDomainUuid);
      if (!pRes.ok) {
        await compensatePriorSteps(`Failed to inspect workforce reservations: ${pRes.error.message}`);
        if (context.transactionStore) {
          const targetState = compensationFailed ? "needs-recovery" : "failed";
          const tx = context.transactionStore.get(txId);
          if (tx) {
            context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData(targetState) });
          }
          context.transactionStore.transition(txId, targetState, epoch, pRes.error.message);
        }
        return err(
          createPublicError({
            code: "DM_PROJECT_COMPLETION_BLOCKED",
            category: "conflict",
            message: `Failed to inspect workforce reservations for project '${project.id}': ${pRes.error.message}`,
            details: pRes.error
          })
        );
      }
      for (const r of pRes.value) {
        if (r.targetRef === `project:${project.id}` && r.status === "active") {
          hasActiveReservations = true;
          releasedWorkforceSnapshots.push({
            reservationId: r.id,
            amount: r.amount,
            workforceTypeId: r.workforceTypeId
          });
        }
      }
    } else {
      hasActiveReservations = true;
    }

    // G5-REVAL5-007: Only release if there were active workforce reservations. Real errors fail-closed.
    if (hasActiveReservations) {
      const wfRelRes = await context.peopleService.releaseWorkforceReservation({
        domainUuid: cleanDomainUuid,
        projectId: project.id,
        userId: params.userId
      });
      if (!wfRelRes.ok) {
        await compensatePriorSteps(`Failed to release workforce reservation: ${wfRelRes.error.message}`);
        if (context.transactionStore) {
          const targetState = compensationFailed ? "needs-recovery" : "failed";
          const tx = context.transactionStore.get(txId);
          if (tx) {
            context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData(targetState) });
          }
          context.transactionStore.transition(txId, targetState, epoch, wfRelRes.error.message);
        }
        return err(
          createPublicError({
            code: "DM_PROJECT_COMPLETION_BLOCKED",
            category: "conflict",
            message: `Failed to release workforce reservation for project '${project.id}': ${wfRelRes.error.message}`,
            details: wfRelRes.error
          })
        );
      }
      if (context.transactionStore) {
        const tx = context.transactionStore.get(txId);
        if (tx) {
          context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
          try {
            await context.transactionStore.flush();
          } catch (flushErr) {
            await compensatePriorSteps(`Persistence flush failed after workforce release: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
            if (context.transactionStore) {
              const targetState = compensationFailed ? "needs-recovery" : "failed";
              const curTx = context.transactionStore.get(txId);
              if (curTx) {
                context.transactionStore.save({ ...curTx, recoveryData: buildRecoveryData(targetState) });
              }
              context.transactionStore.transition(txId, targetState, epoch, String(flushErr));
            }
            return err(
              createPublicError({
                code: "DM_DOMAIN_STORAGE_ERROR",
                category: "internal",
                message: `Failed to flush transaction update after workforce release: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
                details: flushErr
              })
            );
          }
        }
      }
    }
  }

  // 5. Execute coordinated side effects
  let partialFailure = false;
  const executedReceipts: Record<string, ChildReceipt> = {};

  for (const effect of plan.sideEffects.filter((e) => e.type === "facility" || e.type === "facility:create")) {
    if (!effect.targetRef) continue;
    if (!context.facilitiesService) {
      partialFailure = true;
      executedReceipts[effect.id] = {
        childReceiptId: createOpaqueId("rep"),
        subsystem: "facility",
        action: "create_facility",
        targetRef: effect.targetRef,
        payload: effect.value,
        success: false,
        error: "FacilitiesService not available",
        appliedAt: Date.now()
      };
      continue;
    }
    const facRes = await context.facilitiesService.createFacility({
      domainUuid: cleanDomainUuid,
      definitionId: effect.targetRef,
      name: effect.description
    });
    if (facRes.ok) {
      createdFacilityIds.push(facRes.value.facility.id);
      if (context.transactionStore) {
        const tx = context.transactionStore.get(txId);
        if (tx) {
          context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
          try {
            await context.transactionStore.flush();
          } catch (flushErr) {
            await compensatePriorSteps(`Persistence flush failed after facility creation: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
            const targetState = compensationFailed ? "needs-recovery" : "failed";
            const curTx = context.transactionStore.get(txId);
            if (curTx) {
              context.transactionStore.save({ ...curTx, recoveryData: buildRecoveryData(targetState) });
            }
            context.transactionStore.transition(txId, targetState, epoch, String(flushErr));
            return err(
              createPublicError({
                code: "DM_DOMAIN_STORAGE_ERROR",
                category: "internal",
                message: `Failed to flush transaction update after facility creation: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
                details: flushErr
              })
            );
          }
        }
      }
      executedReceipts[effect.id] = {
        childReceiptId: createOpaqueId("rep"),
        subsystem: "facility",
        action: "create_facility",
        targetRef: facRes.value.facility.id,
        payload: { definitionId: effect.targetRef, facilityId: facRes.value.facility.id },
        success: true,
        appliedAt: Date.now()
      };
    } else {
      partialFailure = true;
      executedReceipts[effect.id] = {
        childReceiptId: createOpaqueId("rep"),
        subsystem: "facility",
        action: "create_facility",
        targetRef: effect.targetRef,
        payload: effect.value,
        success: false,
        error: facRes.error.message,
        appliedAt: Date.now()
      };
    }
  }

  for (const effect of plan.sideEffects.filter((e) => e.type === "resource" || e.type === "resource:credit")) {
    if (!effect.targetRef) continue;
    if (!context.economyService) {
      partialFailure = true;
      executedReceipts[effect.id] = {
        childReceiptId: createOpaqueId("rep"),
        subsystem: "economy",
        action: "credit_resource",
        targetRef: effect.targetRef,
        payload: { amountMinor: effect.value },
        success: false,
        error: "EconomyService not available",
        appliedAt: Date.now()
      };
      continue;
    }
    const deltaMinor = Number(effect.value);
    const econRes = await context.economyService.commitAdjust({
      domainUuid: cleanDomainUuid,
      resourceId: effect.targetRef,
      deltaMinor,
      reason: `Project completion reward: ${effect.description ?? project.name}`,
      lockOwner: params.commandId
    });
    if (econRes.ok) {
      creditedResourceRefs.push({ resourceId: effect.targetRef, amountMinor: deltaMinor });
      if (context.transactionStore) {
        const tx = context.transactionStore.get(txId);
        if (tx) {
          context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
          try {
            await context.transactionStore.flush();
          } catch (flushErr) {
            await compensatePriorSteps(`Persistence flush failed after resource credit: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
            const targetState = compensationFailed ? "needs-recovery" : "failed";
            const curTx = context.transactionStore.get(txId);
            if (curTx) {
              context.transactionStore.save({ ...curTx, recoveryData: buildRecoveryData(targetState) });
            }
            context.transactionStore.transition(txId, targetState, epoch, String(flushErr));
            return err(
              createPublicError({
                code: "DM_DOMAIN_STORAGE_ERROR",
                category: "internal",
                message: `Failed to flush transaction update after resource credit: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
                details: flushErr
              })
            );
          }
        }
      }
      executedReceipts[effect.id] = {
        childReceiptId: createOpaqueId("rep"),
        subsystem: "economy",
        action: "credit_resource",
        targetRef: effect.targetRef,
        payload: { amountMinor: effect.value },
        success: true,
        appliedAt: Date.now()
      };
    } else {
      partialFailure = true;
      executedReceipts[effect.id] = {
        childReceiptId: createOpaqueId("rep"),
        subsystem: "economy",
        action: "credit_resource",
        targetRef: effect.targetRef,
        payload: { amountMinor: effect.value },
        success: false,
        error: econRes.error.message,
        appliedAt: Date.now()
      };
    }
  }

  // Handle custom side effects
  for (const effect of plan.sideEffects.filter((e) => e.type !== "facility" && e.type !== "facility:create" && e.type !== "resource" && e.type !== "resource:credit")) {
    if (params.sideEffectHandlers && params.sideEffectHandlers[effect.type]) {
      try {
        const handlerRes = await params.sideEffectHandlers[effect.type](effect, {
          domain: record,
          project
        });
        if (typeof handlerRes === "object" && handlerRes !== null && "ok" in handlerRes) {
          if ((handlerRes as any).ok) {
            executedReceipts[effect.id] = (handlerRes as any).value;
          } else {
            partialFailure = true;
            executedReceipts[effect.id] = {
              childReceiptId: createOpaqueId("rep"),
              subsystem: "custom",
              action: "custom_side_effect",
              targetRef: effect.targetRef ?? effect.id,
              payload: effect.value,
              success: false,
              error: (handlerRes as any).error.message,
              appliedAt: Date.now()
            };
          }
        } else {
          const rec = handlerRes as ChildReceipt;
          executedReceipts[effect.id] = rec;
          if (!rec.success) {
            partialFailure = true;
          }
        }
      } catch (err) {
        partialFailure = true;
        executedReceipts[effect.id] = {
          childReceiptId: createOpaqueId("rep"),
          subsystem: "custom",
          action: "custom_side_effect",
          targetRef: effect.targetRef ?? effect.id,
          payload: effect.value,
          success: false,
          error: err instanceof Error ? err.message : "Side effect handler threw",
          appliedAt: Date.now()
        };
      }
    } else if (params.sideEffectHandlers !== undefined) {
      partialFailure = true;
      executedReceipts[effect.id] = {
        childReceiptId: createOpaqueId("rep"),
        subsystem: "custom",
        action: "custom_side_effect",
        targetRef: effect.targetRef ?? effect.id,
        payload: effect.value,
        success: false,
        error: `No handler registered for side effect type '${effect.type}'`,
        appliedAt: Date.now()
      };
    }
  }

  // Update recoveryData with all accumulated side effect state (G5-REVAL5-003)
  if (context.transactionStore) {
    const tx = context.transactionStore.get(txId);
    if (tx) {
      context.transactionStore.save({
        ...tx,
        recoveryData: buildRecoveryData(partialFailure ? "needs-recovery" : "executing")
      });
      try {
        await context.transactionStore.flush();
      } catch (flushErr) {
        await compensatePriorSteps(`Persistence flush failed at side effects checkpoint: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
        const targetState = compensationFailed ? "needs-recovery" : "failed";
        const curTx = context.transactionStore.get(txId);
        if (curTx) {
          context.transactionStore.save({ ...curTx, recoveryData: buildRecoveryData(targetState) });
        }
        context.transactionStore.transition(txId, targetState, epoch, String(flushErr));
        return err(
          createPublicError({
            code: "DM_DOMAIN_STORAGE_ERROR",
            category: "internal",
            message: `Failed to flush transaction update at side effects checkpoint: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
            details: flushErr
          })
        );
      }
    }
  }

  // Build side effect handlers delivering executed real receipts
  const sideEffectHandlers: Record<string, SideEffectHandler> = {
    ...(params.sideEffectHandlers ?? {})
  };

  if (!sideEffectHandlers.facility) {
    sideEffectHandlers.facility = (effect) => {
      return (
        executedReceipts[effect.id] ?? {
          childReceiptId: createOpaqueId("rep"),
          subsystem: "facility",
          action: "create_facility",
          targetRef: effect.targetRef,
          payload: effect.value,
          success: false,
          error: "No facility receipt generated",
          appliedAt: Date.now()
        }
      );
    };
  }
  if (!sideEffectHandlers["facility:create"]) {
    sideEffectHandlers["facility:create"] = sideEffectHandlers.facility;
  }

  if (!sideEffectHandlers.resource) {
    sideEffectHandlers.resource = (effect) => {
      return (
        executedReceipts[effect.id] ?? {
          childReceiptId: createOpaqueId("rep"),
          subsystem: "economy",
          action: "credit_resource",
          targetRef: effect.targetRef,
          payload: { amountMinor: effect.value },
          success: false,
          error: "No resource receipt generated",
          appliedAt: Date.now()
        }
      );
    };
  }
  if (!sideEffectHandlers["resource:credit"]) {
    sideEffectHandlers["resource:credit"] = sideEffectHandlers.resource;
  }

  const commitRes = commitProjectCompletion(plan, project, {
    userId: params.userId,
    sideEffectHandlers
  });
  if (!commitRes.ok) {
    if (context.transactionStore) {
      context.transactionStore.transition(txId, "needs-recovery", epoch, commitRes.error.message);
    }
    return commitRes;
  }

  if (commitRes.value.partialFailure) {
    partialFailure = true;
  }

  const completedProject = commitRes.value.updatedProject;

  // Re-read fresh document AFTER child effects and workforce release to avoid revision collision
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    if (context.transactionStore) {
      const tx = context.transactionStore.get(txId);
      if (tx) {
        context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("needs-recovery") });
      }
      context.transactionStore.transition(txId, "needs-recovery", epoch, freshDocRes.error.message);
    }
    return freshDocRes;
  }

  // Read latest projects data and update project in array
  const freshProjectsData = getDomainProjectsData(freshDocRes.value.record);
  const updatedProjects = freshProjectsData.projects.map((p) =>
    p.id === project.id ? completedProject : p
  );

  const updatedRecord = withDomainProjectsData(freshDocRes.value.record, {
    ...freshProjectsData,
    projects: Object.freeze(updatedProjects)
  });

  if (context.transactionStore) {
    const committingRes = context.transactionStore.transition(txId, "committing", epoch);
    if (!committingRes.ok) {
      const tx = context.transactionStore.get(txId);
      if (tx) {
        context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("needs-recovery") });
      }
      context.transactionStore.transition(txId, "needs-recovery", epoch, committingRes.error.message);
      return committingRes;
    }
    try {
      await context.transactionStore.flush();
    } catch (flushErr) {
      await compensatePriorSteps(`Persistence flush failed while entering committing state: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      const tx = context.transactionStore.get(txId);
      if (tx) {
        context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData(targetState) });
      }
      context.transactionStore.transition(txId, targetState, epoch, String(flushErr));
      return err(
        createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: `Failed to persist committing state before domain update: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
          details: flushErr
        })
      );
    }
  }

  const updateRes = await context.domains.save({
    ...freshDocRes.value,
    record: updatedRecord
  });

  if (!updateRes.ok) {
    if (context.transactionStore) {
      const tx = context.transactionStore.get(txId);
      if (tx) {
        context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("needs-recovery") });
      }
      context.transactionStore.transition(txId, "needs-recovery", epoch, updateRes.error.message);
    }
    return updateRes;
  }

  // Final transaction state: needs-recovery if any partial failure occurred, else committed
  if (context.transactionStore) {
    if (partialFailure) {
      const tx = context.transactionStore.get(txId);
      if (tx) {
        context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("needs-recovery") });
      }
      context.transactionStore.transition(
        txId,
        "needs-recovery",
        epoch,
        "Project completed with one or more child side effect failures"
      );
    } else {
      const committedRes = context.transactionStore.transition(txId, "committed", epoch);
      if (!committedRes.ok) return committedRes;
      try {
        await context.transactionStore.flush();
      } catch (flushErr) {
        context.transactionStore.transition(
          txId,
          "needs-recovery",
          epoch,
          "Final commit flush failed to persist to durable storage"
        );
        return err(
          createPublicError({
            code: "DM_TRANSACTION_COMMIT_UNCONFIRMED",
            category: "recovery",
            message: `Project completion succeeded on domain but durable transaction commit marker failed to flush: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}. Requires reconciliation.`,
            details: flushErr,
            userActionRequired: true,
            retryable: false
          })
        );
      }
    }
  }

  return ok({
    project: completedProject,
    childReceipts: commitRes.value.childReceipts
  });
}
