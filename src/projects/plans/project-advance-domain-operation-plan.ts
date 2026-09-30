import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createCommandId, type CommandId } from "../../commands/command-envelope.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { ProjectDefinitionRegistry } from "../definitions/project-registry.js";
import type { ProjectInstance } from "../types/project-types.js";
import { getDomainProjectsData, withDomainProjectsData } from "../project-data.js";
import {
  evaluateProjectAdvancePlan,
  commitProjectAdvance
} from "./project-advance-plan-service.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import { createTransactionRecord } from "../../mutations/transaction-record.js";
import { compensateProjectAdvance } from "../services/project-recovery-compensators.js";
import { lockKey } from "../../mutations/lock-keys.js";
import {
  CompositeMutationSession,
  type TransactionExecutionContext
} from "../../mutations/composite-mutation-session.js";

export interface ProjectAdvanceDomainOperationParams {
  readonly domainUuid: string;
  readonly projectId: string;
  readonly unitsToAdvance?: number;
  readonly expectedRevision?: number;
  readonly notes?: string;
  readonly userId?: string | null;
  readonly commandId?: string;
  readonly authorityEpoch?: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly lockKeys?: readonly string[];
  readonly transactionContext?: TransactionExecutionContext;
}

export interface ProjectAdvanceDomainOperationContext {
  readonly domains: DomainRepositoryContract;
  readonly projectRegistry: ProjectDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly transactionStore?: TransactionStore;
}

export interface ProjectAdvanceRecoveryData {
  readonly type: "projects:advance";
  readonly projectId: string;
  readonly domainUuid: string;
  readonly debitedCosts: readonly { resourceId: string; amountMinor: number }[];
  readonly deltaUnits: number;
  readonly expectedWorkCompleted?: number;
  readonly expectedRevision?: number;
  readonly previousWorkCompleted?: number;
  readonly previousRevision?: number;
  readonly authorityEpoch: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly status: "prepared" | "executing" | "completed" | "needs-recovery" | "failed";
}

/**
 * ProjectAdvanceDomainOperationPlan — Atomic composite operation plan for advancing a Project.
 * (Master Remediation §22.2, INV-01 to INV-11)
 *
 * Enforces:
 * 1. TransactionRecord prepared in TransactionStore BEFORE child writes via CompositeMutationSession.
 * 2. Canonical lock set: domain + project.
 * 3. Progressive cost debits via EconomyService with reverse refund compensation on any failure.
 * 4. Canonical state transitions: prepared -> committing -> committed.
 * 5. Fail-closed transition to "needs-recovery" if compensation refund fails.
 */
export async function executeProjectAdvanceDomainOperationPlan(
  context: ProjectAdvanceDomainOperationContext,
  params: ProjectAdvanceDomainOperationParams
): Promise<Result<{ readonly project: ProjectInstance; readonly deltaApplied: number }, PublicError>> {
  const cleanDomainUuid = normalizeJournalEntryId(params.domainUuid);
  const docRes = await context.domains.read(cleanDomainUuid);
  if (!docRes.ok) return docRes;

  if (
    params.expectedRevision !== undefined &&
    docRes.value.record.revision !== params.expectedRevision
  ) {
    return err(
      createPublicError({
        code: "DM_REVISION_CONFLICT",
        category: "conflict",
        message: `Expected revision ${params.expectedRevision}, but found ${docRes.value.record.revision}`
      })
    );
  }

  const projectsData = getDomainProjectsData(docRes.value.record);
  const project = projectsData.projects.find((p) => p.id === params.projectId);
  if (!project) {
    return err(
      createPublicError({
        code: "DM_PROJECT_NOT_FOUND",
        category: "not-found",
        message: `Project '${params.projectId}' not found in domain '${params.domainUuid}'`
      })
    );
  }

  const definition = context.projectRegistry.get(project.definitionId);
  if (!definition) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_NOT_FOUND",
        category: "not-found",
        message: `Project definition '${project.definitionId}' not found in registry`
      })
    );
  }

  const plan = evaluateProjectAdvancePlan({
    project,
    definition,
    domain: docRes.value.record,
    proposedDelta: params.unitsToAdvance,
    expectedRevision: params.expectedRevision
  });

  if (!plan.isSatisfied) {
    const firstErr = plan.blockers?.[0];
    return err(
      createPublicError({
        code: (firstErr?.code as any) ?? "DM_PROJECT_CANNOT_ADVANCE",
        category: "conflict",
        message: firstErr?.message ?? `Project '${project.id}' cannot be advanced`,
        details: { errors: plan.blockers }
      })
    );
  }

  const advanceRes = commitProjectAdvance(plan, project, {
    userId: params.userId,
    note: params.notes
  });
  if (!advanceRes.ok) return advanceRes;

  const deltaUnits = advanceRes.value.receipt.unitsDelta;
  const updatedProject = advanceRes.value.updatedProject;

  const cmdId: CommandId = params.commandId
    ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  const canonicalAdvanceLocks = [lockKey.domain(cleanDomainUuid), lockKey.project(project.id)];
  const sessionLockKeys = params.transactionContext?.lockKeys ?? params.lockKeys ?? canonicalAdvanceLocks;

  const sessionRes = await CompositeMutationSession.prepare({
    transactionContext: params.transactionContext,
    transactionStore: context.transactionStore,
    commandId: cmdId,
    authorityEpoch: epoch,
    lockKeys: sessionLockKeys,
    expectedLockKeys: canonicalAdvanceLocks,
    planLockKeys: canonicalAdvanceLocks,
    recoveryType: "projects:advance",
    parentRef: `project:${project.id}`,
    initialRecoveryData: {
      projectId: project.id,
      domainUuid: cleanDomainUuid,
      deltaUnits,
      expectedWorkCompleted: updatedProject.workCompleted,
      expectedRevision: updatedProject.revision,
      previousWorkCompleted: project.workCompleted,
      previousRevision: project.revision,
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
  const debitedCosts: Array<{ resourceId: string; amountMinor: number }> = [];

  const runCompensator = async (s: CompositeMutationSession, _error: PublicError) => {
    const tx = context.transactionStore?.get(s.transactionId) ?? createTransactionRecord({
      transactionId: s.transactionId,
      commandId: cmdId,
      authorityEpoch: epoch,
      lockKeys: sessionLockKeys,
      safeAutoRecovery: false,
      recoveryData: {
        type: "projects:advance",
        projectId: project.id,
        domainUuid: cleanDomainUuid,
        debitedCosts: Object.freeze([...debitedCosts]),
        deltaUnits,
        expectedWorkCompleted: updatedProject.workCompleted,
        expectedRevision: updatedProject.revision,
        previousWorkCompleted: project.workCompleted,
        previousRevision: project.revision,
        authorityEpoch: epoch,
        status: "needs-recovery"
      }
    });
    return compensateProjectAdvance(
      tx,
      {
        domains: context.domains,
        economyService: context.economyService,
        transactionStore: context.transactionStore
      },
      { lockOwner: params.commandId, skipReconciliation: true }
    );
  };

  // 2. Progressive costs consumption with deterministic cumulative delta (G5-REVAL2-003, G5-REVAL4-007)
  if (context.economyService && deltaUnits > 0) {
    const unitsBefore = project.workCompleted;
    const unitsAfter = Math.min(project.workRequired, updatedProject.workCompleted);
    let costIdx = 0;
    for (const cost of definition.costs) {
      if (cost.timing === "progressive") {
        const dueBefore = Number(BigInt(unitsBefore) * BigInt(cost.amountMinor) / BigInt(project.workRequired));
        const dueAfter = Number(BigInt(unitsAfter) * BigInt(cost.amountMinor) / BigInt(project.workRequired));
        const toDebit = dueAfter - dueBefore;
        if (toDebit > 0) {
          const stepId = `project-advance:cost:${cost.resourceId}:${costIdx++}`;
          const stepRes = await session.runChildStep({
            stepId,
            subsystem: "economy",
            operation: "adjust",
            targetRef: cleanDomainUuid,
            idempotencyKey: `${session.transactionId}:${stepId}`,
            intent: { resourceId: cost.resourceId, deltaMinor: -toDebit },
            execute: async () => {
              return context.economyService!.commitAdjust({
                domainUuid: cleanDomainUuid,
                resourceId: cost.resourceId,
                deltaMinor: -toDebit,
                reason: `Progressive cost for project ${project.name}`,
                lockOwner: params.commandId,
                idempotencyKey: `${session.transactionId}:${stepId}`,
                parentTransactionId: session.transactionId,
                recoveryOwner: "parent"
              });
            }
          });
          if (!stepRes.ok) {
            const errToPropagate = stepRes.error.code === "DM_DOMAIN_STORAGE_ERROR"
              ? stepRes.error
              : createPublicError({
                  code: "DM_PROJECT_ADVANCE_BLOCKED",
                  category: "conflict",
                  message: `Insufficient funds for progressive cost '${cost.resourceId}': ${stepRes.error.message}`,
                  details: stepRes.error
                });
            return session.failAndCompensate(errToPropagate, runCompensator);
          }
          debitedCosts.push({ resourceId: cost.resourceId, amountMinor: toDebit });
          const checkRes = await session.checkpointRecoveryData({
            debitedCosts: Object.freeze([...debitedCosts]),
            status: "executing"
          });
          if (!checkRes.ok) {
            return session.failAndCompensate(checkRes.error, runCompensator);
          }
        }
      }
    }
  }

  // 3. Re-read fresh domain document after progressive cost debits to avoid revision conflict
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    return session.failAndCompensate(freshDocRes.error, runCompensator);
  }

  const freshProjectsData = getDomainProjectsData(freshDocRes.value.record);
  const updatedProjects = freshProjectsData.projects.map((p) =>
    p.id === params.projectId ? updatedProject : p
  );

  const updatedRecord = withDomainProjectsData(freshDocRes.value.record, {
    ...freshProjectsData,
    projects: Object.freeze(updatedProjects)
  });

  // 4. Transition to committing before save
  const committingRes = await session.enterCommitting({
    expectedWorkCompleted: updatedProject.workCompleted,
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

  // 5. Final transition to committed
  const commitRes = await session.commitDurably({
    project: updatedProject,
    deltaApplied: deltaUnits
  });
  if (!commitRes.ok) {
    return commitRes;
  }

  return ok({
    project: updatedProject,
    deltaApplied: deltaUnits
  });
}
