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
import {
  type RecoveryService,
  isCompensationStepCompleted,
  markCompensationStepCompleted
} from "../../mutations/recovery-service.js";
import {
  compensateProjectCompletion,
  compensateProjectAdvance,
  compensateProjectCancel,
  compensateProjectStart
} from "./project-recovery-compensators.js";
import type { TransactionalChildHandlerRegistry } from "../../mutations/child-handler-contract.js";

export interface ProjectsServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly projectRegistry?: ProjectDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly facilitiesService?: FacilitiesService;
  readonly peopleService?: PublicPeopleApi;
  readonly transactionStore?: TransactionStore;
  readonly recoveryService?: RecoveryService;
  readonly childHandlerRegistry?: TransactionalChildHandlerRegistry;
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
  readonly #childHandlerRegistry?: TransactionalChildHandlerRegistry;

  constructor(options: ProjectsServiceOptions) {
    this.#domains = options.domains;
    this.#projectRegistry = options.projectRegistry ?? createDefaultProjectRegistry();
    this.#economyService = options.economyService;
    this.#facilitiesService = options.facilitiesService;
    this.#peopleService = options.peopleService ?? new PeopleService(this.#domains);
    this.#transactionStore = options.transactionStore;
    this.#recoveryService = options.recoveryService;
    this.#childHandlerRegistry = options.childHandlerRegistry;
    if (this.#recoveryService) {
      this.registerRecoveryCompensators(this.#recoveryService);
    }
  }

  get childHandlerRegistry(): TransactionalChildHandlerRegistry | undefined {
    return this.#childHandlerRegistry;
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
        transactionStore: this.#transactionStore,
        childHandlerRegistry: this.#childHandlerRegistry
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
      return compensateProjectCompletion(
        record,
        {
          domains: this.#domains,
          economyService: this.#economyService,
          facilitiesService: this.#facilitiesService,
          peopleService: this.#peopleService,
          transactionStore: this.#transactionStore,
          childHandlerRegistry: this.#childHandlerRegistry
        }
      );
    });


    // Compensator for projects:advance (G5-REVAL4-007)
    recovery.registerCompensator("projects:advance", async (record) => {
      return compensateProjectAdvance(
        record,
        {
          domains: this.#domains,
          economyService: this.#economyService,
          transactionStore: this.#transactionStore
        }
      );
    });


    // Compensator for projects:cancel (G5-REVAL4-008)
    recovery.registerCompensator("projects:cancel", async (record) => {
      return compensateProjectCancel(
        record,
        {
          domains: this.#domains,
          economyService: this.#economyService,
          peopleService: this.#peopleService,
          transactionStore: this.#transactionStore
        }
      );
    });

    // Compensator for projects:start
    recovery.registerCompensator("projects:start", async (record) => {
      return compensateProjectStart(
        record,
        {
          domains: this.#domains,
          economyService: this.#economyService,
          peopleService: this.#peopleService,
          transactionStore: this.#transactionStore
        }
      );
    });
  }

}
