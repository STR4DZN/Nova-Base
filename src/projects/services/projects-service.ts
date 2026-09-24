import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { createCommandId, type CommandId } from "../../commands/command-envelope.js";
import type { DomainRepositoryContract, DomainReadRepository } from "../../storage/repositories/domain-repository.js";
import type { ProjectDefinitionRegistry } from "../definitions/project-registry.js";
import { createDefaultProjectRegistry } from "../definitions/project-registry.js";
import type {
  ProjectDefinition,
  ProjectInstance,
  ProjectLifecycle
} from "../types/project-types.js";
import type { ProjectContributorRef } from "../types/project-entry-types.js";
import {
  getDomainProjectsData,
  PROJECTS_CAPABILITY_ID,
  withDomainProjectsData
} from "../project-data.js";
import {
  evaluateProjectStartPlan,
  commitProjectStartPlan
} from "../plans/project-start-plan-service.js";
import {
  evaluateProjectAdvancePlan,
  commitProjectAdvance,
  pauseProject as planPauseProject,
  resumeProject as planResumeProject,
  cancelProject as planCancelProject,
  blockProject as planBlockProject,
  unblockProject as planUnblockProject
} from "../plans/project-advance-plan-service.js";
import {
  evaluateProjectCompletionPlan,
  commitProjectCompletion,
  type SideEffectHandler
} from "../plans/project-completion-plan-service.js";
import type { ProjectCompletionCommitOptions } from "../plans/project-completion-plan-service.js";
import type { ChildReceipt } from "../plans/project-plan-types.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { FacilitiesService } from "../../facilities/services/facilities-service.js";
import { getDomainFacilitiesData, withDomainFacilitiesData } from "../../facilities/facility-data.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import { executeProjectStartDomainOperationPlan } from "../plans/project-start-domain-operation-plan.js";
import {
  executeProjectCompletionDomainOperationPlan,
  type ProjectCompletionRecoveryData
} from "../plans/project-completion-domain-operation-plan.js";
import { executeProjectAdvanceDomainOperationPlan } from "../plans/project-advance-domain-operation-plan.js";
import { executeProjectCancelDomainOperationPlan } from "../plans/project-cancel-domain-operation-plan.js";
import { PeopleService, type PublicPeopleApi } from "../../people/services/people-service.js";
import type { RecoveryService } from "../../mutations/recovery-service.js";

export interface ProjectsServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly projectRegistry?: ProjectDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly facilitiesService?: FacilitiesService;
  readonly peopleService?: PublicPeopleApi;
  readonly transactionStore?: TransactionStore;
  readonly recoveryService?: RecoveryService;
}

export interface StartProjectParams {
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

export interface AdvanceProjectParams {
  readonly domainUuid: string;
  readonly projectId: string;
  readonly delta: number;
  readonly notes?: string;
  readonly userId?: string | null;
  readonly expectedRevision?: number;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export interface CompleteProjectParams {
  readonly domainUuid: string;
  readonly projectId: string;
  readonly options?: ProjectCompletionCommitOptions;
  readonly userId?: string | null;
  readonly expectedRevision?: number;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export interface CancelProjectParams {
  readonly domainUuid: string;
  readonly projectId: string;
  readonly reason?: string;
  readonly userId?: string | null;
  readonly expectedRevision?: number;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export class ProjectsService {
  readonly #domains: DomainRepositoryContract;
  readonly #projectRegistry: ProjectDefinitionRegistry;
  readonly #economyService?: EconomyService;
  readonly #facilitiesService?: FacilitiesService;
  readonly #peopleService?: PublicPeopleApi;
  readonly #transactionStore?: TransactionStore;
  readonly #recoveryService?: RecoveryService;

  constructor(options: ProjectsServiceOptions) {
    this.#domains = options.domains;
    this.#projectRegistry = options.projectRegistry ?? createDefaultProjectRegistry();
    this.#economyService = options.economyService;
    this.#facilitiesService = options.facilitiesService;
    this.#peopleService = options.peopleService ?? new PeopleService(this.#domains);
    this.#transactionStore = options.transactionStore;
    this.#recoveryService = options.recoveryService;
    if (this.#recoveryService) {
      this.registerRecoveryCompensators(this.#recoveryService);
    }
  }

  get registry(): ProjectDefinitionRegistry {
    return this.#projectRegistry;
  }

  #cleanId(domainUuid: string): string {
    return normalizeJournalEntryId(domainUuid);
  }

  async getProjects(domainUuid: string): Promise<Result<readonly ProjectInstance[]>> {
    const docRes = await this.#domains.read(this.#cleanId(domainUuid));
    if (!docRes.ok) return docRes;
    const data = getDomainProjectsData(docRes.value.record);
    return ok(data.projects);
  }

  async getProject(domainUuid: string, projectId: string): Promise<Result<ProjectInstance>> {
    const docRes = await this.#domains.read(this.#cleanId(domainUuid));
    if (!docRes.ok) return docRes;
    const data = getDomainProjectsData(docRes.value.record);
    const p = data.projects.find((item) => item.id === projectId);
    if (!p) {
      return err(
        createPublicError({
          code: "DM_PROJECT_NOT_FOUND",
          category: "not-found",
          message: `Project ${projectId} not found in domain ${domainUuid}`
        })
      );
    }
    return ok(p);
  }

  async startProject(params: StartProjectParams): Promise<Result<{ readonly project: ProjectInstance }>> {
    return executeProjectStartDomainOperationPlan(
      {
        domains: this.#domains,
        projectRegistry: this.#projectRegistry,
        economyService: this.#economyService,
        peopleService: this.#peopleService,
        transactionStore: this.#transactionStore
      },
      params
    );
  }

  async advanceProject(params: AdvanceProjectParams): Promise<Result<{ readonly project: ProjectInstance; readonly deltaApplied: number }>> {
    return executeProjectAdvanceDomainOperationPlan(
      {
        domains: this.#domains,
        projectRegistry: this.#projectRegistry,
        economyService: this.#economyService,
        transactionStore: this.#transactionStore
      },
      {
        domainUuid: params.domainUuid,
        projectId: params.projectId,
        unitsToAdvance: params.delta,
        expectedRevision: params.expectedRevision,
        notes: params.notes,
        userId: params.userId,
        commandId: params.commandId,
        authorityEpoch: params.authorityEpoch,
        correlationId: params.correlationId,
        causationId: params.causationId
      }
    );
  }

  async pauseProject(params: {
    domainUuid: string;
    projectId: string;
    reason?: string;
    userId?: string | null;
    expectedRevision?: number;
    commandId?: string;
    authorityEpoch?: number;
    correlationId?: string;
    causationId?: string;
  }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planPauseProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async resumeProject(params: {
    domainUuid: string;
    projectId: string;
    reason?: string;
    userId?: string | null;
    expectedRevision?: number;
    commandId?: string;
    authorityEpoch?: number;
    correlationId?: string;
    causationId?: string;
  }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planResumeProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async cancelProject(params: CancelProjectParams): Promise<Result<{ readonly project: ProjectInstance }>> {
    return executeProjectCancelDomainOperationPlan(
      {
        domains: this.#domains,
        economyService: this.#economyService,
        peopleService: this.#peopleService,
        transactionStore: this.#transactionStore
      },
      params
    );
  }

  async blockProject(params: {
    domainUuid: string;
    projectId: string;
    reason: string;
    userId?: string | null;
    expectedRevision?: number;
    commandId?: string;
    authorityEpoch?: number;
    correlationId?: string;
    causationId?: string;
  }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planBlockProject(p, { reason: params.reason, userId: params.userId, expectedRevision: params.expectedRevision })
    );
  }

  async unblockProject(params: {
    domainUuid: string;
    projectId: string;
    reason?: string;
    userId?: string | null;
    expectedRevision?: number;
    commandId?: string;
    authorityEpoch?: number;
    correlationId?: string;
    causationId?: string;
  }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planUnblockProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async completeProject(params: CompleteProjectParams): Promise<Result<{ readonly project: ProjectInstance; readonly childReceipts: readonly ChildReceipt[] }>> {
    return executeProjectCompletionDomainOperationPlan(
      {
        domains: this.#domains,
        projectRegistry: this.#projectRegistry,
        economyService: this.#economyService,
        facilitiesService: this.#facilitiesService,
        peopleService: this.#peopleService,
        transactionStore: this.#transactionStore
      },
      params
    );
  }

  async #mutateLifecycle(
    rawDomainUuid: string,
    projectId: string,
    expectedRevision: number | undefined,
    mutator: (p: ProjectInstance) => Result<{ readonly updatedProject: ProjectInstance }>
  ): Promise<Result<{ readonly project: ProjectInstance }>> {
    const domainUuid = this.#cleanId(rawDomainUuid);
    const docRes = await this.#domains.read(domainUuid);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentProjectsData = getDomainProjectsData(record);
    const project = currentProjectsData.projects.find((p) => p.id === projectId);
    if (!project) {
      return err(
        createPublicError({
          code: "DM_PROJECT_NOT_FOUND",
          category: "not-found",
          message: `Project ${projectId} not found in domain ${rawDomainUuid}`
        })
      );
    }

    if (expectedRevision !== undefined && project.revision !== expectedRevision) {
      return err(
        createPublicError({
          code: "DM_PROJECT_REVISION_MISMATCH",
          category: "conflict",
          message: `Project revision mismatch: expected ${expectedRevision}, found ${project.revision}`
        })
      );
    }

    const mutateRes = mutator(project);
    if (!mutateRes.ok) return mutateRes;

    const updatedProject = mutateRes.value.updatedProject;
    const updatedProjects = currentProjectsData.projects.map((p) =>
      p.id === projectId ? updatedProject : p
    );

    const updatedRecord = withDomainProjectsData(record, {
      ...currentProjectsData,
      projects: Object.freeze(updatedProjects)
    });

    const saveRes = await this.#domains.save({
      ...docRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ project: updatedProject });
  }

  registerRecoveryCompensators(recoveryService?: RecoveryService): void {
    const recovery = recoveryService ?? this.#recoveryService;
    if (!recovery) return;

    recovery.registerCompensator("projects:completion", async (record) => {
      const data = record.recoveryData as unknown as ProjectCompletionRecoveryData | undefined;
      if (!data || data.type !== "projects:completion") {
        return ok(undefined);
      }

      const recoveryLockOwner = `recovery_${record.transactionId}`;

      // 1. Revert credited resources (debit them back)
      if (this.#economyService && data.creditedResourceRefs && data.creditedResourceRefs.length > 0) {
        for (const cred of data.creditedResourceRefs) {
          const adjRes = await this.#economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cred.resourceId,
            deltaMinor: -cred.amountMinor,
            reason: `Recovery: reverse completion reward for project ${data.projectId}`,
            lockOwner: recoveryLockOwner
          });
          if (!adjRes.ok) return adjRes;
        }
      }

      // 2. Refund debited costs (credit them back)
      if (this.#economyService && data.debitedCostRefs && data.debitedCostRefs.length > 0) {
        for (const deb of data.debitedCostRefs) {
          const refRes = await this.#economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: deb.resourceId,
            deltaMinor: deb.amountMinor,
            reason: `Recovery: refund completion cost for project ${data.projectId}`,
            lockOwner: recoveryLockOwner
          });
          if (!refRes.ok) return refRes;
        }
      }

      // 3. Restore consumed economic reservations (G5-REVAL4-006)
      if (this.#economyService && data.consumedReservationSnapshots && data.consumedReservationSnapshots.length > 0) {
        for (const snap of data.consumedReservationSnapshots) {
          const restRes = await this.#economyService.restoreReservation({
            domainUuid: data.domainUuid,
            reservationSnapshot: snap.reservation,
            consumedAmount: snap.consumedAmount,
            reason: `Recovery: restore consumed reservation ${snap.reservation.id} for project ${data.projectId}`,
            lockOwner: recoveryLockOwner
          });
          if (!restRes.ok) return restRes;
        }
      }

      // 4. Restore released workforce reservations (G5-REVAL4-006)
      if (this.#peopleService && data.releasedWorkforceSnapshots && data.releasedWorkforceSnapshots.length > 0) {
        for (const wf of data.releasedWorkforceSnapshots) {
          const restWf = await this.#peopleService.restoreWorkforceReservation({
            domainUuid: data.domainUuid,
            projectId: data.projectId,
            reservationId: wf.reservationId
          });
          if (!restWf.ok) return restWf;
        }
      }

      // 5. Rollback created facilities
      if (data.createdFacilityIds && data.createdFacilityIds.length > 0) {
        const cleanDomainUuid = normalizeJournalEntryId(data.domainUuid);
        const docRes = await this.#domains.read(cleanDomainUuid);
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
          const saveRes = await this.#domains.save({
            ...docRes.value,
            record: updatedRecord
          });
          if (!saveRes.ok) return saveRes;
        }
      }

      // 6. Restore project snapshot
      if (data.projectSnapshot) {
        const cleanDomainUuid = normalizeJournalEntryId(data.domainUuid);
        const docRes = await this.#domains.read(cleanDomainUuid);
        if (!docRes.ok) return docRes;
        const prjData = getDomainProjectsData(docRes.value.record);
        const restoredProjects = prjData.projects.map((p) =>
          p.id === data.projectId ? { ...data.projectSnapshot, updatedAt: Date.now() } : p
        );
        const updatedRecord = withDomainProjectsData(docRes.value.record, {
          ...prjData,
          projects: Object.freeze(restoredProjects)
        });
        const saveRes = await this.#domains.save({
          ...docRes.value,
          record: updatedRecord
        });
        if (!saveRes.ok) return saveRes;
      }

      return ok(undefined);
    });

    // Compensator for projects:advance (G5-REVAL4-007)
    recovery.registerCompensator("projects:advance", async (record) => {
      const data = record.recoveryData as Record<string, any> | undefined;
      if (!data || data.type !== "projects:advance") {
        return ok(undefined);
      }
      const recoveryLockOwner = `recovery_${record.transactionId}`;
      if (this.#economyService && data.debitedCosts && Array.isArray(data.debitedCosts)) {
        for (const cost of data.debitedCosts) {
          const refRes = await this.#economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cost.resourceId,
            deltaMinor: cost.amountMinor,
            reason: `Recovery: refund progressive cost for project ${data.projectId}`,
            lockOwner: recoveryLockOwner
          });
          if (!refRes.ok) return refRes;
        }
      }
      return ok(undefined);
    });

    // Compensator for projects:cancel (G5-REVAL4-008)
    recovery.registerCompensator("projects:cancel", async (record) => {
      const data = record.recoveryData as Record<string, any> | undefined;
      if (!data || data.type !== "projects:cancel") {
        return ok(undefined);
      }
      const recoveryLockOwner = `recovery_${record.transactionId}`;
      if (this.#economyService && data.releasedReservationSnapshots && Array.isArray(data.releasedReservationSnapshots)) {
        for (const snap of data.releasedReservationSnapshots) {
          const restRes = await this.#economyService.restoreReservation({
            domainUuid: data.domainUuid,
            reservationSnapshot: snap,
            reason: `Recovery: restore cancelled reservation for project ${data.projectId}`,
            lockOwner: recoveryLockOwner
          });
          if (!restRes.ok) return restRes;
        }
      }
      if (this.#peopleService && data.releasedWorkforceSnapshots && Array.isArray(data.releasedWorkforceSnapshots)) {
        for (const wf of data.releasedWorkforceSnapshots) {
          const restWf = await this.#peopleService.restoreWorkforceReservation({
            domainUuid: data.domainUuid,
            projectId: data.projectId,
            reservationId: wf.reservationId
          });
          if (!restWf.ok) return restWf;
        }
      }
      return ok(undefined);
    });
  }
}
