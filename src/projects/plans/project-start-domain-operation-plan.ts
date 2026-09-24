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
import { createTransactionRecord } from "../../mutations/transaction-record.js";

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
}

export interface ProjectStartDomainOperationContext {
  readonly domains: DomainRepositoryContract;
  readonly projectRegistry: ProjectDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly peopleService?: PublicPeopleApi;
  readonly transactionStore?: TransactionStore;
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

  // 1. Transaction preparation BEFORE child writes (G5-REVAL3-002, G5-REVAL4-001, G5-REVAL4-002)
  const txId = createOpaqueId("tx");
  const cmdId: CommandId = params.commandId
    ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  if (context.transactionStore) {
    const tx = createTransactionRecord({
      transactionId: txId,
      commandId: cmdId,
      authorityEpoch: epoch,
      lockKeys: [`domain:${cleanDomainUuid}`, `project:${draftProject.id}`],
      safeAutoRecovery: false,
      recoveryData: {
        type: "projects:start",
        projectId: draftProject.id,
        planId: plan.planId,
        domainUuid: cleanDomainUuid,
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

  const peopleService = context.peopleService ?? new PeopleService(context.domains);

  // Tracking for rollback / compensation on failure
  const debitedCosts: Array<{ resourceId: string; amountMinor: number }> = [];
  const createdReservationIds: string[] = [];
  let allocatedWorkforceReservationId: string | undefined;
  let compensationFailed = false;

  const buildRecoveryData = (status: "prepared" | "executing" | "completed" | "needs-recovery" | "failed") => ({
    type: "projects:start",
    projectId: draftProject.id,
    planId: plan.planId,
    domainUuid: cleanDomainUuid,
    debitedCosts: Object.freeze([...debitedCosts]),
    createdReservationIds: Object.freeze([...createdReservationIds]),
    allocatedWorkforceReservationId,
    status
  });

  // Compensation helper to cleanly roll back all prior child effects
  const compensate = async (reason: string) => {
    // 1. Release workforce reservation
    if (allocatedWorkforceReservationId) {
      const relWfRes = await peopleService.releaseWorkforceReservation({
        domainUuid: cleanDomainUuid,
        projectId: draftProject.id,
        reservationId: allocatedWorkforceReservationId,
        userId: params.userId
      });
      if (!relWfRes.ok) {
        compensationFailed = true;
      }
    }

    // 2. Release economic reservations
    if (context.economyService) {
      for (const resId of createdReservationIds) {
        const relRes = await context.economyService.releaseReservation({
          domainUuid: cleanDomainUuid,
          reservationId: resId,
          reason: `Compensation: ${reason}`,
          lockOwner: params.commandId
        });
        if (!relRes.ok) {
          compensationFailed = true;
        }
      }

      // 3. Refund debited costs
      for (const cost of debitedCosts) {
        const refundRes = await context.economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: cost.amountMinor,
          reason: `Compensation refund: ${reason}`,
          lockOwner: params.commandId
        });
        if (!refundRes.ok) {
          compensationFailed = true;
        }
      }
    }

    if (context.transactionStore) {
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      const tx = context.transactionStore.get(txId);
      if (tx) {
        context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData(targetState) });
      }
      context.transactionStore.transition(txId, targetState, epoch, reason);
    }
  };

  // Step 1 & 2: Execute upfront debits and reservations
  if (context.economyService) {
    for (const cost of definition.costs) {
      if (cost.timing === "upfront") {
        const debitRes = await context.economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: -cost.amountMinor,
          reason: `Upfront cost for project ${draftProject.name}`,
          lockOwner: params.commandId
        });
        if (!debitRes.ok) {
          await compensate(`Failed to debit upfront cost for '${cost.resourceId}': ${debitRes.error.message}`);
          return err(
            createPublicError({
              code: "DM_PROJECT_START_BLOCKED",
              category: "conflict",
              message: `Failed to debit upfront cost for '${cost.resourceId}': ${debitRes.error.message}`,
              details: debitRes.error
            })
          );
        }
        debitedCosts.push({ resourceId: cost.resourceId, amountMinor: cost.amountMinor });
        if (context.transactionStore) {
          const tx = context.transactionStore.get(txId);
          if (tx) {
            context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
            await context.transactionStore.flush();
          }
        }
      } else if (cost.timing === "reserved") {
        const reserveRes = await context.economyService.reserve({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          amountMinor: cost.amountMinor,
          source: { type: "project", ref: projectId },
          lockOwner: params.commandId
        });
        if (!reserveRes.ok) {
          await compensate(`Failed to create reservation for '${cost.resourceId}': ${reserveRes.error.message}`);
          return err(
            createPublicError({
              code: "DM_PROJECT_START_BLOCKED",
              category: "conflict",
              message: `Failed to create reservation for '${cost.resourceId}': ${reserveRes.error.message}`,
              details: reserveRes.error
            })
          );
        }
        createdReservationIds.push(reserveRes.value.id);
        if (context.transactionStore) {
          const tx = context.transactionStore.get(txId);
          if (tx) {
            context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
            await context.transactionStore.flush();
          }
        }
      }
    }
  }

  // Step 3: Allocate workforce reservation via People API (G5-REVAL3-001)
  const wfRequired =
    params.workforceRequired ??
    (params.workforceAllocations?.reduce((sum, a) => sum + a.count, 0) ?? 0);
  if (wfRequired > 0) {
    const wfRes = await peopleService.allocateWorkforceReservation({
      domainUuid: cleanDomainUuid,
      projectId: draftProject.id,
      amount: wfRequired,
      workforceTypeId: params.workforceAllocations?.[0]?.workforceTypeId ?? "general",
      userId: params.userId
    });
    if (!wfRes.ok) {
      await compensate(`Failed to allocate workforce reservation: ${wfRes.error.message}`);
      return err(
        createPublicError({
          code: "DM_PROJECT_START_BLOCKED",
          category: "conflict",
          message: `Failed to allocate workforce reservation: ${wfRes.error.message}`,
          details: wfRes.error
        })
      );
    }
    allocatedWorkforceReservationId = wfRes.value.reservationId;
    if (context.transactionStore) {
      const tx = context.transactionStore.get(txId);
      if (tx) {
        context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
        await context.transactionStore.flush();
      }
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
    await compensate(`commitProjectStartPlan failed: ${commitRes.error.message}`);
    return commitRes;
  }

  const startedProject = commitRes.value.project;

  // Re-read fresh document to avoid revision collision
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    await compensate(`Failed to re-read domain doc: ${freshDocRes.error.message}`);
    return freshDocRes;
  }

  const freshRecord = freshDocRes.value.record;
  const freshProjectsData = getDomainProjectsData(freshRecord);
  const updatedRecord = withDomainProjectsData(freshRecord, {
    ...freshProjectsData,
    projects: Object.freeze([...freshProjectsData.projects, startedProject])
  });

  if (context.transactionStore) {
    const committingRes = context.transactionStore.transition(txId, "committing", epoch);
    if (!committingRes.ok) {
      await compensate(`transition to committing failed: ${committingRes.error.message}`);
      return committingRes;
    }
  }

  const updateRes = await context.domains.save({
    ...freshDocRes.value,
    record: updatedRecord
  });

  if (!updateRes.ok) {
    await compensate(`Domain update failed during project start: ${updateRes.error.message}`);
    return updateRes;
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

  return ok({ project: startedProject });
}
