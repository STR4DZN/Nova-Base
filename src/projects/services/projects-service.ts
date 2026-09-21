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
import { getDomainPeopleData, tryGetDomainPeopleData, withDomainPeopleData } from "../../people/people-data.js";
import { executeProjectStartDomainOperationPlan } from "../plans/project-start-domain-operation-plan.js";
import {
  executeProjectCompletionDomainOperationPlan,
  type ProjectCompletionRecoveryData
} from "../plans/project-completion-domain-operation-plan.js";
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
    const domainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(domainUuid);
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

    const definition = this.#projectRegistry.get(project.definitionId);
    if (!definition) {
      return err(
        createPublicError({
          code: "DM_PROJECT_DEFINITION_NOT_FOUND",
          category: "not-found",
          message: `Project definition ${project.definitionId} not found`
        })
      );
    }

    const plan = evaluateProjectAdvancePlan({
      project,
      definition,
      domain: record,
      proposedDelta: params.delta,
      expectedRevision: params.expectedRevision
    });

    if (!plan.isSatisfied) {
      const firstBlocker = plan.blockers[0];
      return err(
        createPublicError({
          code: "DM_PROJECT_ADVANCE_BLOCKED",
          category: "conflict",
          message: firstBlocker?.message ?? "Project advance blocked",
          details: { blockers: plan.blockers }
        })
      );
    }

    const advanceRes = commitProjectAdvance(plan, project, {
      userId: params.userId,
      note: params.notes
    });
    if (!advanceRes.ok) return advanceRes;

    // Progressive costs consumption with deterministic cumulative delta (G5-REVAL2-003, G5-REVAL2-004)
    if (this.#economyService && advanceRes.value.receipt.unitsDelta > 0) {
      const unitsBefore = project.workCompleted;
      const unitsAfter = Math.min(project.workRequired, unitsBefore + advanceRes.value.receipt.unitsDelta);
      for (const cost of definition.costs) {
        if (cost.timing === "progressive") {
          const dueBefore = Math.floor((unitsBefore / project.workRequired) * cost.amountMinor);
          const dueAfter = Math.floor((unitsAfter / project.workRequired) * cost.amountMinor);
          const toDebit = dueAfter - dueBefore;
          if (toDebit > 0) {
            const debitRes = await this.#economyService.commitAdjust({
              domainUuid: params.domainUuid,
              resourceId: cost.resourceId,
              deltaMinor: -toDebit,
              reason: `Progressive cost for project ${project.name}`,
              lockOwner: params.commandId
            });
            if (!debitRes.ok) {
              return err(
                createPublicError({
                  code: "DM_PROJECT_ADVANCE_BLOCKED",
                  category: "conflict",
                  message: `Insufficient funds for progressive cost '${cost.resourceId}': ${debitRes.error.message}`,
                  details: debitRes.error
                })
              );
            }
          }
        }
      }
    }

    const updatedProject = advanceRes.value.updatedProject;

    // Re-read fresh domain document after progressive cost debits to avoid revision conflict
    const freshDocRes = await this.#domains.read(domainUuid);
    if (!freshDocRes.ok) return freshDocRes;
    const freshProjectsData = getDomainProjectsData(freshDocRes.value.record);

    const updatedProjects = freshProjectsData.projects.map((p) =>
      p.id === params.projectId ? updatedProject : p
    );

    const updatedRecord = withDomainProjectsData(freshDocRes.value.record, {
      ...freshProjectsData,
      projects: Object.freeze(updatedProjects)
    });

    const saveRes = await this.#domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({
      project: updatedProject,
      deltaApplied: advanceRes.value.receipt.unitsDelta
    });
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
    const domainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(domainUuid);
    if (!docRes.ok) return docRes;
    const project = getDomainProjectsData(docRes.value.record).projects.find((p) => p.id === params.projectId);

    // 1. Release active economy reservations for this project with fail-closed validation (G5-REVAL2-002, G5-REVAL3-003)
    if (this.#economyService) {
      const activeReservations: string[] = [];
      if (project?.metadata?.reservationIds && Array.isArray(project.metadata.reservationIds)) {
        activeReservations.push(...(project.metadata.reservationIds as string[]));
      }
      if ("listReservations" in this.#economyService) {
        const matching = this.#economyService.listReservations({
          domainUuid: params.domainUuid,
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
        const releaseRes = await this.#economyService.releaseReservation({
          domainUuid,
          reservationId: resId,
          reason: params.reason ?? "Project cancelled",
          lockOwner: params.commandId
        });
        if (!releaseRes.ok) {
          return releaseRes;
        }
      }
    }

    // 2. Release people workforce reservation via public People API (G5-REVAL2-009, G5-REVAL3-001, G5-REVAL3-003)
    if (this.#peopleService) {
      const releaseWfRes = await this.#peopleService.releaseWorkforceReservation({
        domainUuid,
        projectId: params.projectId,
        userId: params.userId
      });
      if (!releaseWfRes.ok) {
        return releaseWfRes;
      }
    } else {
      // Fallback for tests running ProjectsService without peopleService dependency
      const freshDocRes = await this.#domains.read(domainUuid);
      if (freshDocRes.ok) {
        const peopleDataRes = tryGetDomainPeopleData(freshDocRes.value.record);
        if (peopleDataRes.ok) {
          const peopleData = peopleDataRes.value;
          const hasWorkforceRes = peopleData.reservations.some(
            (r) => r.targetRef === `project:${params.projectId}` && r.status === "active"
          );
          if (hasWorkforceRes) {
            const updatedReservations = peopleData.reservations.map((r) =>
              r.targetRef === `project:${params.projectId}` && r.status === "active"
                ? { ...r, status: "released" as const }
                : r
            );
            const updatedRecord = withDomainPeopleData(freshDocRes.value.record, {
              ...peopleData,
              reservations: Object.freeze(updatedReservations)
            });
            await this.#domains.save({ ...freshDocRes.value, record: updatedRecord });
          }
        }
      }
    }

    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planCancelProject(p, { note: params.reason, userId: params.userId })
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

      // 1. Revert credited resources (debit them back)
      if (this.#economyService && data.creditedResourceRefs && data.creditedResourceRefs.length > 0) {
        for (const cred of data.creditedResourceRefs) {
          await this.#economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cred.resourceId,
            deltaMinor: -cred.amountMinor,
            reason: `Recovery: reverse completion reward for project ${data.projectId}`,
            lockOwner: record.transactionId
          });
        }
      }

      // 2. Refund debited costs (credit them back)
      if (this.#economyService && data.debitedCostRefs && data.debitedCostRefs.length > 0) {
        for (const deb of data.debitedCostRefs) {
          await this.#economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: deb.resourceId,
            deltaMinor: deb.amountMinor,
            reason: `Recovery: refund completion cost for project ${data.projectId}`,
            lockOwner: record.transactionId
          });
        }
      }

      // 3. Rollback created facilities
      if (data.createdFacilityIds && data.createdFacilityIds.length > 0) {
        const cleanDomainUuid = normalizeJournalEntryId(data.domainUuid);
        const docRes = await this.#domains.read(cleanDomainUuid);
        if (docRes.ok) {
          const facData = getDomainFacilitiesData(docRes.value.record);
          const remainingFacilities = facData.facilities.filter(
            (f) => !data.createdFacilityIds.includes(f.id)
          );
          if (remainingFacilities.length !== facData.facilities.length) {
            const updatedRecord = withDomainFacilitiesData(docRes.value.record, {
              ...facData,
              facilities: Object.freeze(remainingFacilities)
            });
            await this.#domains.save({
              ...docRes.value,
              record: updatedRecord
            });
          }
        }
      }

      // 4. Restore project snapshot
      if (data.projectSnapshot) {
        const cleanDomainUuid = normalizeJournalEntryId(data.domainUuid);
        const docRes = await this.#domains.read(cleanDomainUuid);
        if (docRes.ok) {
          const prjData = getDomainProjectsData(docRes.value.record);
          const restoredProjects = prjData.projects.map((p) =>
            p.id === data.projectId ? { ...data.projectSnapshot, updatedAt: Date.now() } : p
          );
          const updatedRecord = withDomainProjectsData(docRes.value.record, {
            ...prjData,
            projects: Object.freeze(restoredProjects)
          });
          await this.#domains.save({
            ...docRes.value,
            record: updatedRecord
          });
        }
      }

      return ok(undefined);
    });
  }
}
