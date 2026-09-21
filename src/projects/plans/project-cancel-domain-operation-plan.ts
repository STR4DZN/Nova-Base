import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { createCommandId, type CommandId } from "../../commands/command-envelope.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { ProjectInstance } from "../types/project-types.js";
import { getDomainProjectsData, withDomainProjectsData } from "../project-data.js";
import { cancelProject as planCancelProject } from "./project-advance-plan-service.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { Reservation } from "../../economy/reservations/reservation-types.js";
import type { PublicPeopleApi } from "../../people/services/people-service.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import { createTransactionRecord } from "../../mutations/transaction-record.js";

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
}

export interface ProjectCancelDomainOperationContext {
  readonly domains: DomainRepositoryContract;
  readonly economyService?: EconomyService;
  readonly peopleService?: PublicPeopleApi;
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
 * (Master Spec §15, §11.2, G5-REVAL2-002, G5-REVAL3-003, G5-REVAL4-008)
 *
 * Enforces:
 * 1. TransactionRecord prepared in TransactionStore BEFORE child writes.
 * 2. Durable flush barrier prior to releasing reservations.
 * 3. Snapshotting of active economic and workforce reservations.
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

  // 1. Transaction preparation BEFORE child writes (G5-REVAL4-002, G5-REVAL4-008)
  const txId = createOpaqueId("tx");
  const cmdId: CommandId = params.commandId
    ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  const releasedReservationSnapshots: Reservation[] = [];
  const releasedWorkforceSnapshots: Array<{ reservationId: string; amount: number; workforceTypeId: string }> = [];

  const buildRecoveryData = (status: ProjectCancelRecoveryData["status"]): ProjectCancelRecoveryData => ({
    type: "projects:cancel",
    projectId: project.id,
    domainUuid: cleanDomainUuid,
    releasedReservationSnapshots: Object.freeze([...releasedReservationSnapshots]),
    releasedWorkforceSnapshots: Object.freeze([...releasedWorkforceSnapshots]),
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

  // 2. Snapshot and release active economy reservations
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

  if (context.economyService) {
    for (const resId of activeReservationIds) {
      const resObj = context.economyService.getReservation(resId);
      if (resObj && (resObj.status === "active" || resObj.status === "partially-consumed")) {
        releasedReservationSnapshots.push({ ...resObj });
      }
    }
  }

  // 3. Snapshot workforce reservations
  if (context.peopleService && "getReservations" in context.peopleService) {
    const pRes = await context.peopleService.getReservations(cleanDomainUuid);
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

  let restoreFailed = false;
  const restoreReleased = async (reason: string) => {
    // Restore economic reservations
    if (context.economyService && releasedReservationSnapshots.length > 0) {
      for (const snap of releasedReservationSnapshots) {
        const restRes = await context.economyService.restoreReservation({
          domainUuid: cleanDomainUuid,
          reservationSnapshot: snap,
          reason: `Compensation: ${reason}`,
          lockOwner: params.commandId
        });
        if (!restRes.ok) {
          restoreFailed = true;
        }
      }
    }
    // Restore workforce reservations
    if (context.peopleService && releasedWorkforceSnapshots.length > 0) {
      for (const wf of releasedWorkforceSnapshots) {
        const restWf = await context.peopleService.restoreWorkforceReservation({
          domainUuid: cleanDomainUuid,
          projectId: project.id,
          reservationId: wf.reservationId,
          userId: params.userId
        });
        if (!restWf.ok) {
          restoreFailed = true;
        }
      }
    }
  };

  // 4. Release economy reservations with fail-closed validation
  if (context.economyService) {
    for (const resId of activeReservationIds) {
      const releaseRes = await context.economyService.releaseReservation({
        domainUuid: cleanDomainUuid,
        reservationId: resId,
        reason: params.reason ?? "Project cancelled",
        lockOwner: params.commandId
      });
      if (!releaseRes.ok) {
        await restoreReleased(`rollback after failed release of reservation '${resId}'`);
        if (context.transactionStore) {
          const targetState = restoreFailed ? "needs-recovery" : "failed";
          context.transactionStore.transition(txId, targetState, epoch, releaseRes.error.message);
        }
        return releaseRes;
      }
    }
  }

  // 5. Release workforce reservation via public People API
  if (context.peopleService) {
    const releaseWfRes = await context.peopleService.releaseWorkforceReservation({
      domainUuid: cleanDomainUuid,
      projectId: params.projectId,
      userId: params.userId
    });
    if (!releaseWfRes.ok) {
      await restoreReleased(`rollback after failed release of workforce: ${releaseWfRes.error.message}`);
      if (context.transactionStore) {
        const targetState = restoreFailed ? "needs-recovery" : "failed";
        context.transactionStore.transition(txId, targetState, epoch, releaseWfRes.error.message);
      }
      return releaseWfRes;
    }
  }

  // 6. Re-read fresh domain document and save cancellation
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    await restoreReleased(`domain read failed after reservation release: ${freshDocRes.error.message}`);
    if (context.transactionStore) {
      const targetState = restoreFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, freshDocRes.error.message);
    }
    return freshDocRes;
  }

  const freshProjectsData = getDomainProjectsData(freshDocRes.value.record);
  const updatedProjects = freshProjectsData.projects.map((p) =>
    p.id === params.projectId ? cancelledProject : p
  );

  const updatedRecord = withDomainProjectsData(freshDocRes.value.record, {
    ...freshProjectsData,
    projects: Object.freeze(updatedProjects)
  });

  // 7. Transition to committing before save
  if (context.transactionStore) {
    const committingRes = context.transactionStore.transition(txId, "committing", epoch);
    if (!committingRes.ok) {
      await restoreReleased(`transition to committing failed: ${committingRes.error.message}`);
      const targetState = restoreFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, committingRes.error.message);
      return committingRes;
    }
  }

  const saveRes = await context.domains.save({
    ...freshDocRes.value,
    record: updatedRecord
  });

  if (!saveRes.ok) {
    await restoreReleased(`domain save failed during project cancellation: ${saveRes.error.message}`);
    if (context.transactionStore) {
      const targetState = restoreFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, saveRes.error.message);
    }
    return saveRes;
  }

  // 8. Final transition to committed
  if (context.transactionStore) {
    const committedRes = context.transactionStore.transition(txId, "committed", epoch);
    if (!committedRes.ok) return committedRes;
    try {
      await context.transactionStore.flush();
    } catch {
      // already committed
    }
  }

  return ok({ project: cancelledProject });
}
