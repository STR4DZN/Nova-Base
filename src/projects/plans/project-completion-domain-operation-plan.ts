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
  type SideEffectHandler
} from "./project-completion-plan-service.js";
import type { ChildReceipt } from "./project-plan-types.js";
import type { Reservation } from "../../economy/reservations/reservation-types.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { FacilitiesService } from "../../facilities/services/facilities-service.js";
import { PeopleService, type PublicPeopleApi } from "../../people/services/people-service.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import { createTransactionRecord } from "../../mutations/transaction-record.js";
import { compensateProjectCompletion } from "../services/project-recovery-compensators.js";
import { lockKey } from "../../mutations/lock-keys.js";
import {
  CompositeMutationSession,
  type TransactionExecutionContext
} from "../../mutations/composite-mutation-session.js";

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
  readonly lockKeys?: readonly string[];
  readonly transactionContext?: TransactionExecutionContext;
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
 * (Master Remediation §22.4, INV-01 to INV-11)
 *
 * Enforces:
 * 1. TransactionRecord prepared in TransactionStore BEFORE child writes via CompositeMutationSession.
 * 2. Canonical lock set: domain + project.
 * 3. Individual child steps with durable receipts for costs, reservations, workforce, facilities, rewards.
 * 4. Automatic transition to "needs-recovery" on partial failure or persistence error.
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
        message: `Expected revision ${params.expectedRevision}, found ${project.revision}`
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
    const code: `DM_${string}` =
      firstBlocker?.code && firstBlocker.code.startsWith("DM_")
        ? (firstBlocker.code as `DM_${string}`)
        : "DM_PROJECT_COMPLETION_BLOCKED";
    return err(
      createPublicError({
        code,
        category: "conflict",
        message: firstBlocker?.message ?? "Project completion preconditions unsatisfied",
        details: { blockers: plan.blockers }
      })
    );
  }

  const cmdId: CommandId = params.commandId
    ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  const canonicalCompletionLocks = [lockKey.domain(cleanDomainUuid), lockKey.project(project.id)];
  const sessionLockKeys = params.transactionContext?.lockKeys ?? params.lockKeys ?? canonicalCompletionLocks;

  const sessionRes = await CompositeMutationSession.prepare({
    transactionContext: params.transactionContext,
    transactionStore: context.transactionStore,
    commandId: cmdId,
    authorityEpoch: epoch,
    lockKeys: sessionLockKeys,
    planLockKeys: params.transactionContext?.lockKeys ?? params.lockKeys ?? canonicalCompletionLocks,
    recoveryType: "projects:completion",
    parentRef: `project:${project.id}`,
    initialRecoveryData: {
      projectId: project.id,
      planId: plan.planId,
      domainUuid: cleanDomainUuid,
      projectSnapshot: project,
      authorityEpoch: epoch,
      correlationId: params.correlationId,
      causationId: params.causationId,
      status: "prepared"
    }
  });

  if (!sessionRes.ok) {
    return sessionRes;
  }

  const session = sessionRes.value;

  const createdFacilityIds: string[] = [];
  const debitedCostRefs: Array<{ resourceId: string; amountMinor: number }> = [];
  const creditedResourceRefs: Array<{ resourceId: string; amountMinor: number }> = [];
  const consumedReservationIds: string[] = [];
  const consumedReservationSnapshots: Array<{ reservation: Reservation; consumedAmount: number }> = [];
  const releasedWorkforceSnapshots: Array<{ reservationId: string; amount: number; workforceTypeId: string }> = [];

  const runCompensator = async (s: CompositeMutationSession, _error: PublicError) => {
    const effectiveFacilityIds = [...createdFacilityIds];
    for (const step of s.steps) {
      if (step.subsystem === "facility" && (step.state === "applied" || step.state === "unknown")) {
        const receipt = step.receipt as any;
        const id = receipt?.facility?.id ?? (typeof receipt === "string" ? receipt : undefined);
        if (id && !effectiveFacilityIds.includes(id)) {
          effectiveFacilityIds.push(id);
        }
      }
    }

    const effectiveDebited = [...debitedCostRefs];
    for (const step of s.steps) {
      if (step.subsystem === "economy" && step.operation === "adjust" && (step.state === "applied" || step.state === "unknown")) {
        const intent = step.intent as { resourceId: string; deltaMinor: number };
        if (intent && intent.deltaMinor < 0) {
          const amt = Math.abs(intent.deltaMinor);
          if (!effectiveDebited.some((d) => d.resourceId === intent.resourceId && d.amountMinor === amt)) {
            effectiveDebited.push({ resourceId: intent.resourceId, amountMinor: amt });
          }
        }
      }
    }

    const effectiveCredited = [...creditedResourceRefs];
    for (const step of s.steps) {
      if (step.subsystem === "economy" && (step.state === "applied" || step.state === "unknown")) {
        const intent = step.intent as { resourceId: string; deltaMinor: number };
        if (intent && intent.deltaMinor > 0) {
          if (!effectiveCredited.some((c) => c.resourceId === intent.resourceId && c.amountMinor === intent.deltaMinor)) {
            effectiveCredited.push({ resourceId: intent.resourceId, amountMinor: intent.deltaMinor });
          }
        }
      }
    }

    const currentTx = context.transactionStore?.get(s.transactionId);
    const existingRecData = (currentTx?.recoveryData as Record<string, unknown>) ?? {};
    const updatedRecData = {
      ...existingRecData,
      type: "projects:completion",
      projectId: project.id,
      planId: plan.planId,
      domainUuid: cleanDomainUuid,
      projectSnapshot: project,
      createdFacilityIds: Object.freeze([...effectiveFacilityIds]),
      debitedCostRefs: Object.freeze([...effectiveDebited]),
      creditedResourceRefs: Object.freeze([...effectiveCredited]),
      consumedReservationIds: Object.freeze([...consumedReservationIds]),
      consumedReservationSnapshots: Object.freeze([...consumedReservationSnapshots]),
      releasedWorkforceSnapshots: Object.freeze([...releasedWorkforceSnapshots]),
      expectedRevision: project.revision + 1,
      authorityEpoch: epoch,
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

    return compensateProjectCompletion(
      tx,
      {
        domains: context.domains,
        economyService: context.economyService,
        facilitiesService: context.facilitiesService,
        peopleService: context.peopleService,
        transactionStore: context.transactionStore
      },
      { lockOwner: params.commandId, skipReconciliation: true }
    );
  };

  // 1. Execute onCompletion costs with fail-closed validation
  if (context.economyService) {
    let costIdx = 0;
    for (const cost of definition.costs) {
      if (cost.timing === "onCompletion") {
        const stepId = `project-complete:cost:${cost.resourceId}:${costIdx++}`;
        const stepRes = await session.runChildStep({
          stepId,
          subsystem: "economy",
          operation: "adjust",
          targetRef: cleanDomainUuid,
          idempotencyKey: `${session.transactionId}:${stepId}`,
          intent: { resourceId: cost.resourceId, deltaMinor: -cost.amountMinor },
          execute: async () => {
            return context.economyService!.commitAdjust({
              domainUuid: cleanDomainUuid,
              resourceId: cost.resourceId,
              deltaMinor: -cost.amountMinor,
              reason: `OnCompletion cost for project ${project.name}`,
              lockOwner: params.commandId,
              idempotencyKey: `${session.transactionId}:${stepId}`
            });
          }
        });
        if (!stepRes.ok) {
          const errToPropagate = stepRes.error.code === "DM_DOMAIN_STORAGE_ERROR"
            ? stepRes.error
            : createPublicError({
                code: "DM_PROJECT_COMPLETION_BLOCKED",
                category: "conflict",
                message: `Failed to debit onCompletion cost for '${cost.resourceId}': ${stepRes.error.message}`,
                details: stepRes.error
              });
          return session.failAndCompensate(errToPropagate, runCompensator);
        }
        debitedCostRefs.push({ resourceId: cost.resourceId, amountMinor: cost.amountMinor });
        const checkRes = await session.checkpointRecoveryData({
          debitedCostRefs: Object.freeze([...debitedCostRefs]),
          status: "executing"
        });
        if (!checkRes.ok) {
          return session.failAndCompensate(checkRes.error, runCompensator);
        }
      }
    }
  }

  // 2. Consume active reservations with fail-closed checking
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
        const stepId = `project-complete:consume-reservation:${resId}`;
        const stepRes = await session.runChildStep({
          stepId,
          subsystem: "economy",
          operation: "consumeReservation",
          targetRef: resId,
          idempotencyKey: `${session.transactionId}:${stepId}`,
          intent: { reservationId: resId, amountMinor: consumedAmount },
          execute: async () => {
            return context.economyService!.consumeReservation({
              domainUuid: cleanDomainUuid,
              reservationId: resId,
              amountMinor: consumedAmount,
              reason: `Project ${project.name} completed`,
              lockOwner: params.commandId
            });
          }
        });
        if (!stepRes.ok) {
          const errToPropagate = stepRes.error.code === "DM_DOMAIN_STORAGE_ERROR"
            ? stepRes.error
            : createPublicError({
                code: "DM_PROJECT_COMPLETION_BLOCKED",
                category: "conflict",
                message: `Failed to consume reservation '${resId}': ${stepRes.error.message}`,
                details: stepRes.error
              });
          return session.failAndCompensate(errToPropagate, runCompensator);
        }
        consumedReservationIds.push(resId);
        consumedReservationSnapshots.push({ reservation: snapshotCopy, consumedAmount });
        const checkRes = await session.checkpointRecoveryData({
          consumedReservationIds: Object.freeze([...consumedReservationIds]),
          consumedReservationSnapshots: Object.freeze([...consumedReservationSnapshots]),
          status: "executing"
        });
        if (!checkRes.ok) {
          return session.failAndCompensate(checkRes.error, runCompensator);
        }
      }
    }
  }

  // 3. Release workforce reservations via People API
  if (context.peopleService) {
    let hasActiveReservations = false;
    if ("getReservations" in context.peopleService) {
      const pRes = await context.peopleService.getReservations(cleanDomainUuid);
      if (!pRes.ok) {
        return session.failAndCompensate(
          createPublicError({
            code: "DM_PROJECT_COMPLETION_BLOCKED",
            category: "conflict",
            message: `Failed to inspect workforce reservations for project '${project.id}': ${pRes.error.message}`,
            details: pRes.error
          }),
          runCompensator
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

    if (hasActiveReservations) {
      const stepId = `project-complete:release-workforce:${project.id}`;
      const wfStepRes = await session.runChildStep({
        stepId,
        subsystem: "people",
        operation: "releaseWorkforceReservation",
        targetRef: cleanDomainUuid,
        idempotencyKey: `${session.transactionId}:${stepId}`,
        intent: { projectId: project.id },
        execute: async () => {
          return context.peopleService!.releaseWorkforceReservation({
            domainUuid: cleanDomainUuid,
            projectId: project.id,
            userId: params.userId
          });
        }
      });
      if (!wfStepRes.ok) {
        const errToPropagate = wfStepRes.error.code === "DM_DOMAIN_STORAGE_ERROR"
          ? wfStepRes.error
          : createPublicError({
              code: "DM_PROJECT_COMPLETION_BLOCKED",
              category: "conflict",
              message: `Failed to release workforce reservation for project '${project.id}': ${wfStepRes.error.message}`,
              details: wfStepRes.error
            });
        return session.failAndCompensate(errToPropagate, runCompensator);
      }
      const checkRes = await session.checkpointRecoveryData({
        releasedWorkforceSnapshots: Object.freeze([...releasedWorkforceSnapshots]),
        status: "executing"
      });
      if (!checkRes.ok) {
        return session.failAndCompensate(checkRes.error, runCompensator);
      }
    }
  }

  // 4. Execute coordinated side effects
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

    const stepId = `project-complete:facility:${effect.id}`;
    const facStepRes = await session.runChildStep({
      stepId,
      subsystem: "facility",
      operation: "createFacility",
      targetRef: effect.targetRef,
      idempotencyKey: `${session.transactionId}:${stepId}`,
      intent: { definitionId: effect.targetRef, name: effect.description },
      execute: async () => {
        return context.facilitiesService!.createFacility({
          domainUuid: cleanDomainUuid,
          definitionId: effect.targetRef!,
          name: effect.description
        });
      }
    });

    if (facStepRes.ok) {
      createdFacilityIds.push(facStepRes.value.facility.id);
      const checkRes = await session.checkpointRecoveryData({
        createdFacilityIds: Object.freeze([...createdFacilityIds]),
        status: "executing"
      });
      if (!checkRes.ok) {
        return session.failAndCompensate(checkRes.error, runCompensator);
      }
      executedReceipts[effect.id] = {
        childReceiptId: createOpaqueId("rep"),
        subsystem: "facility",
        action: "create_facility",
        targetRef: facStepRes.value.facility.id,
        payload: { definitionId: effect.targetRef, facilityId: facStepRes.value.facility.id },
        success: true,
        appliedAt: Date.now()
      };
    } else {
      if (facStepRes.error.code === "DM_DOMAIN_STORAGE_ERROR") {
        return session.failAndCompensate(facStepRes.error, runCompensator);
      }
      partialFailure = true;
      executedReceipts[effect.id] = {
        childReceiptId: createOpaqueId("rep"),
        subsystem: "facility",
        action: "create_facility",
        targetRef: effect.targetRef,
        payload: effect.value,
        success: false,
        error: facStepRes.error.message,
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
    const stepId = `project-complete:reward:${effect.id}`;
    const econStepRes = await session.runChildStep({
      stepId,
      subsystem: "economy",
      operation: "adjust",
      targetRef: effect.targetRef,
      idempotencyKey: `${session.transactionId}:${stepId}`,
      intent: { resourceId: effect.targetRef, deltaMinor },
      execute: async () => {
        return context.economyService!.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: effect.targetRef!,
          deltaMinor,
          reason: `Project completion reward: ${effect.description ?? project.name}`,
          lockOwner: params.commandId,
          idempotencyKey: `${session.transactionId}:${stepId}`
        });
      }
    });

    if (econStepRes.ok) {
      creditedResourceRefs.push({ resourceId: effect.targetRef, amountMinor: deltaMinor });
      const checkRes = await session.checkpointRecoveryData({
        creditedResourceRefs: Object.freeze([...creditedResourceRefs]),
        status: "executing"
      });
      if (!checkRes.ok) {
        return session.failAndCompensate(checkRes.error, runCompensator);
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
      if (econStepRes.error.code === "DM_DOMAIN_STORAGE_ERROR") {
        return session.failAndCompensate(econStepRes.error, runCompensator);
      }
      partialFailure = true;
      executedReceipts[effect.id] = {
        childReceiptId: createOpaqueId("rep"),
        subsystem: "economy",
        action: "credit_resource",
        targetRef: effect.targetRef,
        payload: { amountMinor: effect.value },
        success: false,
        error: econStepRes.error.message,
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
    return session.failAndCompensate(commitRes.error, runCompensator);
  }

  if (commitRes.value.partialFailure) {
    partialFailure = true;
  }

  const completedProject = commitRes.value.updatedProject;

  // Re-read fresh document AFTER child effects and workforce release to avoid revision collision
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    return session.failAndCompensate(freshDocRes.error, runCompensator);
  }

  const freshProjectsData = getDomainProjectsData(freshDocRes.value.record);
  const updatedProjects = freshProjectsData.projects.map((p) =>
    p.id === project.id ? completedProject : p
  );

  const updatedRecord = withDomainProjectsData(freshDocRes.value.record, {
    ...freshProjectsData,
    projects: Object.freeze(updatedProjects)
  });

  const committingRes = await session.enterCommitting({
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
    if (context.transactionStore) {
      const currentTx = context.transactionStore.get(session.transactionId);
      if (currentTx) {
        context.transactionStore.save({
          ...currentTx,
          recoveryData: {
            ...((currentTx.recoveryData as Record<string, unknown>) ?? {}),
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
            status: "needs-recovery"
          }
        });
      }
    }
    await session.markNeedsRecovery(saveRes.error.message);
    return saveRes;
  }

  if (partialFailure) {
    await session.markNeedsRecovery(
      "Project completed with one or more child side effect failures"
    );
  } else {
    const commitDurableRes = await session.commitDurably({
      project: completedProject,
      childReceipts: commitRes.value.childReceipts
    });
    if (!commitDurableRes.ok) {
      return commitDurableRes;
    }
  }

  return ok({
    project: completedProject,
    childReceipts: commitRes.value.childReceipts
  });
}
