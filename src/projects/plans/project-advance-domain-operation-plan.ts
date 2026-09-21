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
  evaluateProjectAdvancePlan,
  commitProjectAdvance
} from "./project-advance-plan-service.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import { createTransactionRecord } from "../../mutations/transaction-record.js";

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
  readonly authorityEpoch: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly status: "prepared" | "executing" | "completed" | "needs-recovery" | "failed";
}

/**
 * ProjectAdvanceDomainOperationPlan — Atomic composite operation plan for advancing a Project.
 * (Master Spec §15, §11.2, G5-REVAL4-007)
 *
 * Enforces:
 * 1. TransactionRecord prepared in TransactionStore BEFORE child writes.
 * 2. Durable flush barrier prior to progressive cost debits.
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

  // 1. Transaction preparation BEFORE child writes (G5-REVAL4-002, G5-REVAL4-007)
  const txId = createOpaqueId("tx");
  const cmdId: CommandId = params.commandId
    ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  const debitedCosts: Array<{ resourceId: string; amountMinor: number }> = [];

  const buildRecoveryData = (status: ProjectAdvanceRecoveryData["status"]): ProjectAdvanceRecoveryData => ({
    type: "projects:advance",
    projectId: project.id,
    domainUuid: cleanDomainUuid,
    debitedCosts: Object.freeze([...debitedCosts]),
    deltaUnits,
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

    // G5-REVAL4-002: Durable flush barrier BEFORE child mutations
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
  const compensateDebits = async (reason: string) => {
    if (!context.economyService || debitedCosts.length === 0) return;
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
  };

  // 2. Progressive costs consumption with deterministic cumulative delta (G5-REVAL2-003, G5-REVAL4-007)
  if (context.economyService && deltaUnits > 0) {
    const unitsBefore = project.workCompleted;
    const unitsAfter = Math.min(project.workRequired, unitsBefore + deltaUnits);
    for (const cost of definition.costs) {
      if (cost.timing === "progressive") {
        const dueBefore = Math.floor((unitsBefore / project.workRequired) * cost.amountMinor);
        const dueAfter = Math.floor((unitsAfter / project.workRequired) * cost.amountMinor);
        const toDebit = dueAfter - dueBefore;
        if (toDebit > 0) {
          const debitRes = await context.economyService.commitAdjust({
            domainUuid: cleanDomainUuid,
            resourceId: cost.resourceId,
            deltaMinor: -toDebit,
            reason: `Progressive cost for project ${project.name}`,
            lockOwner: params.commandId
          });
          if (!debitRes.ok) {
            await compensateDebits(`debit failed for progressive cost '${cost.resourceId}'`);
            if (context.transactionStore) {
              const targetState = compensationFailed ? "needs-recovery" : "failed";
              context.transactionStore.transition(txId, targetState, epoch, debitRes.error.message);
            }
            return err(
              createPublicError({
                code: "DM_PROJECT_ADVANCE_BLOCKED",
                category: "conflict",
                message: `Insufficient funds for progressive cost '${cost.resourceId}': ${debitRes.error.message}`,
                details: debitRes.error
              })
            );
          }
          debitedCosts.push({ resourceId: cost.resourceId, amountMinor: toDebit });
          if (context.transactionStore) {
            const tx = context.transactionStore.get(txId);
            if (tx) {
              context.transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
            }
          }
        }
      }
    }
  }

  // 3. Re-read fresh domain document after progressive cost debits to avoid revision conflict
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    await compensateDebits(`domain read failed after progressive debits: ${freshDocRes.error.message}`);
    if (context.transactionStore) {
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, freshDocRes.error.message);
    }
    return freshDocRes;
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
  if (context.transactionStore) {
    const committingRes = context.transactionStore.transition(txId, "committing", epoch);
    if (!committingRes.ok) {
      await compensateDebits(`transition to committing failed: ${committingRes.error.message}`);
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
    await compensateDebits(`domain save failed for project advance: ${saveRes.error.message}`);
    if (context.transactionStore) {
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, saveRes.error.message);
    }
    return saveRes;
  }

  // 5. Final transition to committed
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
    project: updatedProject,
    deltaApplied: deltaUnits
  });
}
