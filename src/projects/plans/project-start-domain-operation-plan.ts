import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { createCommandId, type CommandId } from "../../commands/command-envelope.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { ProjectDefinitionRegistry } from "../definitions/project-registry.js";
import type { ProjectDefinition, ProjectInstance, ProjectLifecycle } from "../types/project-types.js";
import type { ProjectContributorRef } from "../types/project-entry-types.js";
import { getDomainProjectsData, PROJECTS_CAPABILITY_ID, withDomainProjectsData } from "../project-data.js";
import { evaluateProjectStartPlan, commitProjectStartPlan } from "./project-start-plan-service.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import { PeopleService, type PublicPeopleApi } from "../../people/services/people-service.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import { createTransactionRecord, type TransactionRecord } from "../../mutations/transaction-record.js";
import { compensateProjectStart } from "../services/project-recovery-compensators.js";
import { lockKey } from "../../mutations/lock-keys.js";
import type { RecoveryFenceRegistry } from "../../mutations/recovery-fence-registry.js";
import {
  CompositeMutationSession,
  type TransactionExecutionContext
} from "../../mutations/composite-mutation-session.js";

export interface ProjectStartDomainOperationParams {
  readonly domainUuid: string;
  readonly definitionId: string;
  readonly name?: string;
  readonly workRequired?: number;
  readonly targetRef?: string;
  readonly initialState?: ProjectLifecycle;
  readonly userId?: string | null;
  readonly expectedRevision?: number;
  readonly workforceRequired?: number;
  readonly workforceAllocations?: readonly { readonly workforceTypeId?: string; readonly count: number }[];
  readonly contributors?: readonly (string | ProjectContributorRef)[];
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
  readonly lockKeys?: readonly string[];
  readonly transactionContext?: TransactionExecutionContext;
}

export interface ProjectStartDomainOperationContext {
  readonly domains: DomainRepositoryContract;
  readonly projectRegistry: ProjectDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly peopleService?: PublicPeopleApi;
  readonly transactionStore?: TransactionStore;
  readonly recoveryFenceRegistry?: RecoveryFenceRegistry;
}

/**
 * ProjectStartDomainOperationPlan — Canonical composite operation plan for starting a Project.
 * (Master Spec §15, §11.2, G5-REVAL3-001, G5-REVAL3-002)
 *
 * Enforces:
 * 1. Preconditions check via subsystem APIs (Economy availability, People workforce availability).
 * 2. Transaction preparation in TransactionStore before external writes.
 * 3. Step-by-step child execution with fault tracking.
 * 4. Explicit compensation on ANY failure: refunds debited costs, releases reservations, releases workforce.
 */
export async function executeProjectStartDomainOperationPlan(
  context: ProjectStartDomainOperationContext,
  params: ProjectStartDomainOperationParams
): Promise<Result<{ readonly project: ProjectInstance }, PublicError>> {
  const cleanDomainUuid = normalizeJournalEntryId(params.domainUuid);
  const docRes = await context.domains.read(cleanDomainUuid);
  if (!docRes.ok) return docRes;

  const record = docRes.value.record;
  if (!record.definition.capabilities.enabled.includes(PROJECTS_CAPABILITY_ID)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_CAPABILITY_DISABLED",
        category: "conflict",
        message: `Projects capability '${PROJECTS_CAPABILITY_ID}' is not enabled on domain ${params.domainUuid}`
      })
    );
  }

  const definition = context.projectRegistry.get(params.definitionId);
  if (!definition) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_NOT_FOUND",
        category: "not-found",
        message: `Project definition '${params.definitionId}' not found`
      })
    );
  }

  const currentProjectsData = getDomainProjectsData(record);
  const projectId = `prj-${createOpaqueId("prj").slice("prj_".length)}`;
  const now = Date.now();

  const draftProject: ProjectInstance = {
    id: projectId,
    definitionId: params.definitionId,
    domainUuid: cleanDomainUuid,
    name: params.name || definition.label,
    workRequired: params.workRequired ?? definition.defaultWorkRequired,
    workCompleted: 0,
    lifecycle: "draft",
    clampProgress: true,
    tags: Object.freeze([...(definition.tags ?? [])]),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    schemaVersion: 1,
    metadata: params.targetRef ? { targetRef: params.targetRef } : undefined
  };

  const targetLifecycle = params.initialState === "initializing" ? "initializing" : "active";

  // Evaluate pure start plan
  const plan = evaluateProjectStartPlan({
    project: draftProject,
    definition,
    domain: record,
    targetLifecycle,
    expectedRevision: params.expectedRevision,
    parameters: params.workforceRequired !== undefined ? { workforceRequired: params.workforceRequired } : undefined
  });

  if (!plan.isSatisfied) {
    const firstBlocker = plan.blockers[0];
    const code: `DM_${string}` =
      firstBlocker?.code && firstBlocker.code.startsWith("DM_")
        ? (firstBlocker.code as `DM_${string}`)
        : "DM_PROJECT_START_BLOCKED";
    return err(
      createPublicError({
        code,
        category: "conflict",
        message: firstBlocker?.message ?? "Project start preconditions unsatisfied",
        details: { blockers: plan.blockers }
      })
    );
  }

  // Pre-validate economic availability via EconomyService contract if available
  if (context.economyService) {
    for (const resIntent of plan.economicReservations) {
      if ("getAccountAvailability" in context.economyService) {
        const availRes = await (context.economyService as any).getAccountAvailability(
          cleanDomainUuid,
          resIntent.resourceId
        );
        if (availRes && availRes.ok && availRes.value) {
          const availableMinor = (availRes.value.balanceMinor ?? 0) - (availRes.value.reservedMinor ?? 0);
          if (availableMinor < resIntent.amountMinor) {
            return err(
              createPublicError({
                code: "DM_PROJECT_START_BLOCKED",
                category: "conflict",
                message: `Insufficient economic resources for project '${draftProject.name}'. Required: ${resIntent.amountMinor}, Available: ${availableMinor} on resource '${resIntent.resourceId}'`,
                details: {
                  resourceId: resIntent.resourceId,
                  requiredMinor: resIntent.amountMinor,
                  availableMinor
                }
              })
            );
          }
        }
      }
    }
  }

  // 1. Transaction preparation BEFORE child writes (Master Remediation §14, INV-02)
  const cmdId: CommandId = params.commandId
    ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  const peopleService = context.peopleService ?? new PeopleService(context.domains);

  // Finding 2: Lock set for Project Start is domain-only!
  const canonicalStartLock = lockKey.domain(cleanDomainUuid);
  const sessionLockKeys = params.transactionContext?.lockKeys ?? params.lockKeys ?? [canonicalStartLock];

  const sessionRes = await CompositeMutationSession.prepare({
    transactionContext: params.transactionContext,
    transactionStore: context.transactionStore,
    recoveryFenceRegistry: context.recoveryFenceRegistry,
    commandId: cmdId,
    authorityEpoch: epoch,
    lockKeys: sessionLockKeys,
    expectedLockKeys: [canonicalStartLock],
    planLockKeys: [canonicalStartLock],
    recoveryType: "projects:start",
    parentRef: `domain:${cleanDomainUuid}`,
    initialRecoveryData: {
      projectId: draftProject.id,
      planId: plan.planId,
      domainUuid: cleanDomainUuid,
      status: "prepared"
    }
  });

  if (!sessionRes.ok) {
    return sessionRes;
  }

  const session = sessionRes.value;
  const debitedCosts: Array<{ resourceId: string; amountMinor: number }> = [];
  const createdReservationIds: string[] = [];
  let allocatedWorkforceReservationId: string | undefined;

  const runCompensator = (s: CompositeMutationSession, primaryError: PublicError) => {
    const effectiveDebited = [...debitedCosts];
    for (const step of s.steps) {
      if (step.subsystem === "economy" && step.operation === "adjust" && (step.state === "applied" || step.state === "unknown")) {
        const intent = step.intent as { resourceId: string; deltaMinor: number };
        if (intent && intent.deltaMinor < 0) {
          const amount = Math.abs(intent.deltaMinor);
          if (!effectiveDebited.some((d) => d.resourceId === intent.resourceId && d.amountMinor === amount)) {
            effectiveDebited.push({ resourceId: intent.resourceId, amountMinor: amount });
          }
        }
      }
    }
    const effectiveReservations = [...createdReservationIds];
    for (const step of s.steps) {
      if (step.subsystem === "economy" && step.operation === "reserve" && (step.state === "applied" || step.state === "unknown")) {
        const receipt = step.receipt as any;
        const resId = receipt?.id ?? (typeof receipt === "string" ? receipt : undefined);
        if (resId && !effectiveReservations.includes(resId)) {
          effectiveReservations.push(resId);
        }
      }
    }

    const currentTx = context.transactionStore?.get(s.transactionId);
    const existingRecData = (currentTx?.recoveryData as Record<string, unknown>) ?? {};
    const updatedRecData = {
      ...existingRecData,
      type: "projects:start",
      projectId: draftProject.id,
      planId: plan.planId,
      domainUuid: cleanDomainUuid,
      debitedCosts: Object.freeze([...effectiveDebited]),
      createdReservationIds: Object.freeze([...effectiveReservations]),
      allocatedWorkforceReservationId,
      status: "needs-recovery"
    };

    const txToCompensate = currentTx
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
      context.transactionStore.save(txToCompensate);
    }

    return compensateProjectStart(
      txToCompensate,
      {
        domains: context.domains,
        economyService: context.economyService,
        peopleService,
        transactionStore: context.transactionStore
      },
      { lockOwner: params.commandId, skipReconciliation: true }
    );
  };

  // Step 1 & 2: Execute upfront debits and reservations
  if (context.economyService) {
    let costIdx = 0;
    for (const cost of definition.costs) {
      if (cost.timing === "upfront") {
        const stepId = `project-start:upfront:${cost.resourceId}:${costIdx++}`;
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
              reason: `Upfront cost for project ${draftProject.name}`,
              lockOwner: params.commandId,
              idempotencyKey: `${session.transactionId}:${stepId}`
            });
          }
        });
        if (!stepRes.ok) {
          const errToPropagate = stepRes.error.code === "DM_DOMAIN_STORAGE_ERROR"
            ? stepRes.error
            : createPublicError({
                code: "DM_PROJECT_START_BLOCKED",
                category: "conflict",
                message: `Failed to debit upfront cost for '${cost.resourceId}': ${stepRes.error.message}`,
                details: stepRes.error
              });
          return session.failAndCompensate(errToPropagate, runCompensator);
        }
        debitedCosts.push({ resourceId: cost.resourceId, amountMinor: cost.amountMinor });
        const checkRes = await session.checkpointRecoveryData({
          debitedCosts: Object.freeze([...debitedCosts]),
          status: "executing"
        });
        if (!checkRes.ok) {
          return session.failAndCompensate(checkRes.error, runCompensator);
        }
      } else if (cost.timing === "reserved") {
        const stepId = `project-start:reservation:${cost.resourceId}:${costIdx++}`;
        const anticipatedReservationId = createOpaqueId("resv");
        const stepRes = await session.runChildStep({
          stepId,
          subsystem: "economy",
          operation: "reserve",
          targetRef: cleanDomainUuid,
          idempotencyKey: `${session.transactionId}:${stepId}`,
          operationRef: stepId,
          intent: {
            resourceId: cost.resourceId,
            amountMinor: cost.amountMinor,
            reservationId: anticipatedReservationId,
            operationRef: stepId
          },
          execute: async () => {
            return context.economyService!.reserve({
              domainUuid: cleanDomainUuid,
              resourceId: cost.resourceId,
              amountMinor: cost.amountMinor,
              source: { type: "project", ref: projectId },
              lockOwner: params.commandId,
              reservationId: anticipatedReservationId,
              operationRef: stepId
            });
          }
        });
        if (!stepRes.ok) {
          const errToPropagate = stepRes.error.code === "DM_DOMAIN_STORAGE_ERROR"
            ? stepRes.error
            : createPublicError({
                code: "DM_PROJECT_START_BLOCKED",
                category: "conflict",
                message: `Failed to create reservation for '${cost.resourceId}': ${stepRes.error.message}`,
                details: stepRes.error
              });
          return session.failAndCompensate(errToPropagate, runCompensator);
        }
        createdReservationIds.push(stepRes.value.id);
        const checkRes = await session.checkpointRecoveryData({
          createdReservationIds: Object.freeze([...createdReservationIds]),
          status: "executing"
        });
        if (!checkRes.ok) {
          return session.failAndCompensate(checkRes.error, runCompensator);
        }
      }
    }
  }

  // Step 3: Allocate workforce reservation via People API (G5-REVAL3-001)
  const wfRequired =
    params.workforceRequired ??
    (params.workforceAllocations?.reduce((sum, a) => sum + a.count, 0) ?? 0);
  if (wfRequired > 0) {
    const stepId = `project-start:workforce:${params.workforceAllocations?.[0]?.workforceTypeId ?? "general"}`;
    const anticipatedWfReservationId = createOpaqueId("resv");
    const wfStepRes = await session.runChildStep({
      stepId,
      subsystem: "people",
      operation: "allocateWorkforceReservation",
      targetRef: cleanDomainUuid,
      idempotencyKey: `${session.transactionId}:${stepId}`,
      operationRef: stepId,
      intent: {
        amount: wfRequired,
        projectId: draftProject.id,
        reservationId: anticipatedWfReservationId,
        operationRef: stepId
      },
      execute: async () =>
        peopleService.allocateWorkforceReservation({
          domainUuid: cleanDomainUuid,
          projectId: draftProject.id,
          amount: wfRequired,
          workforceTypeId: params.workforceAllocations?.[0]?.workforceTypeId ?? "general",
          userId: params.userId,
          reservationId: anticipatedWfReservationId,
          operationRef: stepId
        })
    });
    if (!wfStepRes.ok) {
      const errToPropagate = wfStepRes.error.code === "DM_DOMAIN_STORAGE_ERROR"
        ? wfStepRes.error
        : createPublicError({
            code: "DM_PROJECT_START_BLOCKED",
            category: "conflict",
            message: `Failed to allocate workforce reservation: ${wfStepRes.error.message}`,
            details: wfStepRes.error
          });
      return session.failAndCompensate(errToPropagate, runCompensator);
    }
    allocatedWorkforceReservationId = wfStepRes.value.reservationId;
    const checkRes = await session.checkpointRecoveryData({
      allocatedWorkforceReservationId,
      status: "executing"
    });
    if (!checkRes.ok) {
      return session.failAndCompensate(checkRes.error, runCompensator);
    }
  }

  // Step 4: Commit project start plan
  const projectToCommit: ProjectInstance =
    createdReservationIds.length > 0
      ? {
          ...draftProject,
          metadata: {
            ...(draftProject.metadata ?? {}),
            reservationIds: Object.freeze(createdReservationIds)
          }
        }
      : draftProject;

  const commitRes = commitProjectStartPlan(plan, projectToCommit, {
    userId: params.userId
  });
  if (!commitRes.ok) {
    return session.failAndCompensate(commitRes.error, runCompensator);
  }

  const startedProject = commitRes.value.project;

  // Re-read fresh document to avoid revision collision
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    return session.failAndCompensate(freshDocRes.error, runCompensator);
  }

  const freshRecord = freshDocRes.value.record;
  const freshProjectsData = getDomainProjectsData(freshRecord);
  const updatedRecord = withDomainProjectsData(freshRecord, {
    ...freshProjectsData,
    projects: Object.freeze([...freshProjectsData.projects, startedProject])
  });

  const committingPrep = await session.enterCommitting();
  if (!committingPrep.ok) {
    return session.failAndCompensate(committingPrep.error, runCompensator);
  }

  const updateRes = await session.commitParent(async () =>
    context.domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    })
  );

  if (!updateRes.ok) {
    return session.failAndCompensate(updateRes.error, runCompensator);
  }

  return session.commitDurably({ project: startedProject });
}
