import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createCommandId, type CommandId } from "../../commands/command-envelope.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { ProjectInstance } from "../types/project-types.js";
import { getDomainProjectsData, withDomainProjectsData } from "../project-data.js";
import { cancelProject as planCancelProject } from "./project-advance-plan-service.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { Reservation } from "../../economy/reservations/reservation-types.js";
import type { WorkforceReservationPort } from "../../people/services/workforce-reservation-port.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import { createTransactionRecord } from "../../mutations/transaction-record.js";
import { compensateProjectCancel } from "../services/project-recovery-compensators.js";
import { lockKey } from "../../mutations/lock-keys.js";
import {
  CompositeMutationSession,
  type TransactionExecutionContext
} from "../../mutations/composite-mutation-session.js";

export interface ProjectCancelDomainOperationParams {
  readonly domainUuid: string;
  readonly projectId: string;
  readonly reason?: string;
  readonly expectedRevision?: number;
  readonly userId?: string | null;
  readonly commandId?: string;
  readonly authorityEpoch?: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly lockKeys?: readonly string[];
  readonly transactionContext?: TransactionExecutionContext;
}

export interface ProjectCancelDomainOperationContext {
  readonly domains: DomainRepositoryContract;
  readonly economyService?: EconomyService;
  readonly workforceReservations?: WorkforceReservationPort;
  readonly transactionStore?: TransactionStore;
}

export interface ProjectCancelRecoveryData {
  readonly type: "projects:cancel";
  readonly projectId: string;
  readonly domainUuid: string;
  readonly releasedReservationSnapshots: readonly Reservation[];
  readonly releasedWorkforceSnapshots: readonly { reservationId: string; amount: number; workforceTypeId: string }[];
  readonly authorityEpoch: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly status: "prepared" | "executing" | "completed" | "needs-recovery" | "failed";
}

/**
 * ProjectCancelDomainOperationPlan — Atomic composite operation plan for cancelling a Project.
 * (Master Remediation §22.3, INV-01 to INV-11)
 *
 * Enforces:
 * 1. TransactionRecord prepared in TransactionStore BEFORE child writes via CompositeMutationSession.
 * 2. Canonical lock set: domain + project.
 * 3. Snapshotting of active economic and workforce reservations before release.
 * 4. Fail-closed restoration of reservations on save failure.
 * 5. Canonical state transitions: prepared -> committing -> committed.
 * 6. Routing to "needs-recovery" if reservation restoration fails.
 */
export async function executeProjectCancelDomainOperationPlan(
  context: ProjectCancelDomainOperationContext,
  params: ProjectCancelDomainOperationParams
): Promise<Result<{ readonly project: ProjectInstance }, PublicError>> {
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

  const cancelRes = planCancelProject(project, { note: params.reason, userId: params.userId });
  if (!cancelRes.ok) return cancelRes;
  const cancelledProject = cancelRes.value.updatedProject;

  const cmdId: CommandId = params.commandId
    ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  // 1. Snapshot active economy and workforce reservations before any release
  const activeReservationIds: string[] = [];
  if (project.metadata?.reservationIds && Array.isArray(project.metadata.reservationIds)) {
    activeReservationIds.push(...(project.metadata.reservationIds as string[]));
  }
  if (context.economyService && "listReservations" in context.economyService) {
    const matching = context.economyService.listReservations({
      domainUuid: cleanDomainUuid,
      sourceRef: params.projectId,
      status: "active"
    });
    for (const m of matching) {
      if (!activeReservationIds.includes(m.id)) {
        activeReservationIds.push(m.id);
      }
    }
  }

  const releasedReservationSnapshots: Reservation[] = [];
  if (context.economyService) {
    for (const resId of activeReservationIds) {
      const resObj = context.economyService.getReservation(resId);
      if (resObj && (resObj.status === "active" || resObj.status === "partially-consumed")) {
        releasedReservationSnapshots.push({ ...resObj });
      }
    }
  }

  const releasedWorkforceSnapshots: Array<{ reservationId: string; amount: number; workforceTypeId: string }> = [];
  if (context.workforceReservations && "getReservations" in context.workforceReservations) {
    const pRes = await context.workforceReservations.getReservations(cleanDomainUuid);
    if (pRes.ok) {
      for (const r of pRes.value) {
        if (r.targetRef === `project:${project.id}` && r.status === "active") {
          releasedWorkforceSnapshots.push({
            reservationId: r.id,
            amount: r.amount,
            workforceTypeId: r.workforceTypeId
          });
        }
      }
    }
  }

  const canonicalCancelLocks = [lockKey.domain(cleanDomainUuid), lockKey.project(project.id)];
  const sessionLockKeys = params.transactionContext?.lockKeys ?? params.lockKeys ?? canonicalCancelLocks;

  const sessionRes = await CompositeMutationSession.prepare({
    transactionContext: params.transactionContext,
    transactionStore: context.transactionStore,
    commandId: cmdId,
    authorityEpoch: epoch,
    lockKeys: sessionLockKeys,
    expectedLockKeys: canonicalCancelLocks,
    planLockKeys: canonicalCancelLocks,
    recoveryType: "projects:cancel",
    parentRef: `project:${project.id}`,
    initialRecoveryData: {
      projectId: project.id,
      domainUuid: cleanDomainUuid,
      releasedReservationSnapshots: Object.freeze([...releasedReservationSnapshots]),
      releasedWorkforceSnapshots: Object.freeze([...releasedWorkforceSnapshots]),
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

  const runCompensator = async (s: CompositeMutationSession, _error: PublicError) => {
    const tx = context.transactionStore?.get(s.transactionId) ?? createTransactionRecord({
      transactionId: s.transactionId,
      commandId: cmdId,
      authorityEpoch: epoch,
      lockKeys: sessionLockKeys,
      safeAutoRecovery: false,
      recoveryData: {
        type: "projects:cancel",
        projectId: project.id,
        domainUuid: cleanDomainUuid,
        releasedReservationSnapshots: Object.freeze([...releasedReservationSnapshots]),
        releasedWorkforceSnapshots: Object.freeze([...releasedWorkforceSnapshots]),
        authorityEpoch: epoch,
        status: "needs-recovery"
      }
    });
    return compensateProjectCancel(
      tx,
      {
        domains: context.domains,
        economyService: context.economyService,
        workforceReservations: context.workforceReservations,
        transactionStore: context.transactionStore
      },
      { lockOwner: params.commandId, skipReconciliation: true }
    );
  };

  // 2. Release economy reservations with fail-closed validation
  if (context.economyService) {
    for (const resId of activeReservationIds) {
      const stepId = `project-cancel:release-reservation:${resId}`;
      const stepRes = await session.runChildStep({
        stepId,
        subsystem: "economy",
        operation: "release",
        targetRef: resId,
        idempotencyKey: `${session.transactionId}:${stepId}`,
        intent: { reservationId: resId },
        execute: async () => {
          return context.economyService!.releaseReservation({
            domainUuid: cleanDomainUuid,
            reservationId: resId,
            reason: params.reason ?? "Project cancelled",
            lockOwner: params.commandId
          });
        }
      });
      if (!stepRes.ok) {
        return session.failAndCompensate(stepRes.error, runCompensator);
      }
    }
  }

  // 3. Release workforce reservation via the internal workforce port
  if (context.workforceReservations) {
    const stepId = `project-cancel:release-workforce:${project.id}`;
    const wfStepRes = await session.runChildStep({
      stepId,
      subsystem: "people",
      operation: "release",
      targetRef: `project:${project.id}`,
      idempotencyKey: `${session.transactionId}:${stepId}`,
      intent: { projectId: params.projectId },
      execute: async () => {
        return context.workforceReservations!.releaseWorkforceReservation({
          domainUuid: cleanDomainUuid,
          projectId: params.projectId,
          userId: params.userId
        });
      }
    });
    if (!wfStepRes.ok) {
      return session.failAndCompensate(wfStepRes.error, runCompensator);
    }
  }

  // 4. Re-read fresh domain document and save cancellation
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    return session.failAndCompensate(freshDocRes.error, runCompensator);
  }

  const freshProjectsData = getDomainProjectsData(freshDocRes.value.record);
  const updatedProjects = freshProjectsData.projects.map((p) =>
    p.id === params.projectId ? cancelledProject : p
  );

  const updatedRecord = withDomainProjectsData(freshDocRes.value.record, {
    ...freshProjectsData,
    projects: Object.freeze(updatedProjects)
  });

  // 5. Transition to committing before save
  const committingRes = await session.enterCommitting({
    expectedLifecycle: "cancelled",
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

  // 6. Final transition to committed
  const commitRes = await session.commitDurably({ project: cancelledProject });
  if (!commitRes.ok) {
    return commitRes;
  }

  return ok({ project: cancelledProject });
}
