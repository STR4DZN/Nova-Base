import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { createCommandId } from "../../commands/command-envelope.js";
import type { DomainRepositoryContract, DomainReadRepository } from "../../storage/repositories/domain-repository.js";
import type { ProjectDefinitionRegistry } from "../definitions/project-registry.js";
import { createDefaultProjectRegistry } from "../definitions/project-registry.js";
import type {
  ProjectDefinition,
  ProjectInstance,
  ProjectLifecycle
} from "../types/project-types.js";
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
import { createTransactionRecord } from "../../mutations/transaction-record.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { PublicEconomyApi } from "../../economy/services/public-economy-api.js";
import type { FacilitiesService } from "../../facilities/services/facilities-service.js";
import { getDomainEconomyData } from "../../economy/economy-data.js";

export interface ProjectsServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly projectRegistry?: ProjectDefinitionRegistry;
  readonly economyService?: EconomyService | PublicEconomyApi;
  readonly facilitiesService?: FacilitiesService;
  readonly transactionStore?: TransactionStore;
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
}

export interface AdvanceProjectParams {
  readonly domainUuid: string;
  readonly projectId: string;
  readonly delta: number;
  readonly notes?: string;
  readonly userId?: string | null;
  readonly expectedRevision?: number;
}

export interface CompleteProjectParams {
  readonly domainUuid: string;
  readonly projectId: string;
  readonly options?: ProjectCompletionCommitOptions;
  readonly userId?: string | null;
  readonly expectedRevision?: number;
}

export class ProjectsService {
  readonly #domains: DomainRepositoryContract;
  readonly #projectRegistry: ProjectDefinitionRegistry;
  readonly #economyService?: EconomyService | PublicEconomyApi;
  readonly #facilitiesService?: FacilitiesService;
  readonly #transactionStore?: TransactionStore;

  constructor(options: ProjectsServiceOptions) {
    this.#domains = options.domains;
    this.#projectRegistry = options.projectRegistry ?? createDefaultProjectRegistry();
    this.#economyService = options.economyService;
    this.#facilitiesService = options.facilitiesService;
    this.#transactionStore = options.transactionStore;
  }

  get registry(): ProjectDefinitionRegistry {
    return this.#projectRegistry;
  }

  async getProjects(domainUuid: string): Promise<Result<readonly ProjectInstance[]>> {
    const docRes = await this.#domains.read(domainUuid);
    if (!docRes.ok) return docRes;
    const data = getDomainProjectsData(docRes.value.record);
    return ok(data.projects);
  }

  async getProject(domainUuid: string, projectId: string): Promise<Result<ProjectInstance>> {
    const docRes = await this.#domains.read(domainUuid);
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
    const docRes = await this.#domains.read(params.domainUuid);
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

    const definition = this.#projectRegistry.get(params.definitionId);
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
    const projectId = `proj-${createOpaqueId("prj")}`;
    const now = Date.now();

    // Draft instance to evaluate start plan
    const draftProject: ProjectInstance = {
      id: projectId,
      domainUuid: params.domainUuid,
      definitionId: params.definitionId,
      name: params.name ?? definition.label,
      schemaVersion: 1,
      revision: 0,
      lifecycle: "draft",
      workRequired: params.workRequired ?? definition.defaultWorkRequired,
      workCompleted: 0,
      clampProgress: true,
      tags: Object.freeze([...(definition.tags ?? [])]),
      createdAt: now,
      updatedAt: now,
      metadata: params.targetRef ? { targetRef: params.targetRef } : undefined
    };

    const plan = evaluateProjectStartPlan({
      project: draftProject,
      definition,
      domain: record,
      expectedRevision: params.expectedRevision ?? 0,
      targetLifecycle: (params.initialState === "initializing" ? "initializing" : "active")
    });

    // Check Economy availability: availableMinor = balanceMinor - reservedMinor
    const econData = getDomainEconomyData(record);
    for (const resIntent of plan.economicReservations) {
      const account = econData.accounts.find(
        (a) => a.resourceId === resIntent.resourceId && a.mode === "native"
      );
      const balanceMinor = account && "balanceMinor" in account ? account.balanceMinor : 0;
      let reservedMinor = 0;
      if (this.#economyService && "getAccountAvailability" in this.#economyService) {
        const availRes = await (this.#economyService as any).getAccountAvailability(
          params.domainUuid,
          resIntent.resourceId
        );
        if (availRes && availRes.ok && availRes.value) {
          reservedMinor = availRes.value.reservedMinor ?? 0;
        }
      }
      const availableMinor = balanceMinor - reservedMinor;

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

    if (!plan.isSatisfied) {
      const firstBlocker = plan.blockers[0];
      return err(
        createPublicError({
          code: "DM_PROJECT_START_BLOCKED",
          category: "conflict",
          message: firstBlocker?.message ?? "Project start preconditions unsatisfied",
          details: { blockers: plan.blockers }
        })
      );
    }

    const commitRes = commitProjectStartPlan(plan, draftProject, {
      userId: params.userId
    });
    if (!commitRes.ok) return commitRes;

    const startedProject = commitRes.value.project;

    // Persist to domain
    const updatedRecord = withDomainProjectsData(record, {
      ...currentProjectsData,
      projects: Object.freeze([...currentProjectsData.projects, startedProject])
    });

    const saveRes = await this.#domains.save({
      ...docRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ project: startedProject });
  }

  async advanceProject(params: AdvanceProjectParams): Promise<Result<{ readonly project: ProjectInstance; readonly deltaApplied: number }>> {
    const docRes = await this.#domains.read(params.domainUuid);
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

    const updatedProject = advanceRes.value.updatedProject;
    const updatedProjects = currentProjectsData.projects.map((p) =>
      p.id === params.projectId ? updatedProject : p
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

    return ok({
      project: updatedProject,
      deltaApplied: advanceRes.value.receipt.unitsDelta
    });
  }

  async pauseProject(params: { domainUuid: string; projectId: string; reason?: string; userId?: string | null; expectedRevision?: number }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planPauseProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async resumeProject(params: { domainUuid: string; projectId: string; reason?: string; userId?: string | null; expectedRevision?: number }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planResumeProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async cancelProject(params: { domainUuid: string; projectId: string; reason?: string; userId?: string | null; expectedRevision?: number }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planCancelProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async blockProject(params: { domainUuid: string; projectId: string; reason: string; userId?: string | null; expectedRevision?: number }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planBlockProject(p, { reason: params.reason, userId: params.userId, expectedRevision: params.expectedRevision })
    );
  }

  async unblockProject(params: { domainUuid: string; projectId: string; reason?: string; userId?: string | null; expectedRevision?: number }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planUnblockProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async completeProject(params: CompleteProjectParams): Promise<Result<{ readonly project: ProjectInstance; readonly childReceipts: readonly ChildReceipt[] }>> {
    const docRes = await this.#domains.read(params.domainUuid);
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

    const plan = evaluateProjectCompletionPlan({
      project,
      definition,
      domain: record,
      expectedRevision: params.expectedRevision
    });

    if (!plan.isSatisfied) {
      const firstBlocker = plan.blockers[0];
      return err(
        createPublicError({
          code: "DM_PROJECT_COMPLETION_BLOCKED",
          category: "conflict",
          message: firstBlocker?.message ?? "Project completion preconditions unsatisfied",
          details: { blockers: plan.blockers }
        })
      );
    }

    // Build real coordinated side effect handlers
    const sideEffectHandlers: Record<string, SideEffectHandler> = {
      ...(params.options?.sideEffectHandlers ?? {})
    };

    // Auto-wire facility creation side effect if facilitiesService is provided
    if (!sideEffectHandlers.facility && this.#facilitiesService) {
      const facService = this.#facilitiesService;
      sideEffectHandlers.facility = (effect) => {
        const facId = effect.targetRef;
        return {
          childReceiptId: createOpaqueId("rep"),
          subsystem: "facility",
          action: "create_facility",
          targetRef: facId,
          payload: effect.value,
          success: true,
          appliedAt: Date.now()
        };
      };
    }

    // Auto-wire economy side effect if economyService is provided
    if (!sideEffectHandlers.resource && this.#economyService) {
      const econService = this.#economyService;
      sideEffectHandlers.resource = (effect) => {
        return {
          childReceiptId: createOpaqueId("rep"),
          subsystem: "economy",
          action: "credit_resource",
          targetRef: effect.targetRef,
          payload: { amountMinor: effect.value },
          success: true,
          appliedAt: Date.now()
        };
      };
    }

    // G4/G5 Transaction integration
    const txId = createOpaqueId("tx");
    if (this.#transactionStore) {
      const tx = createTransactionRecord({
        transactionId: txId,
        commandId: createCommandId(),
        authorityEpoch: 1,
        lockKeys: [`domain:${params.domainUuid}`, `project:${project.id}`],
        safeAutoRecovery: false,
        recoveryData: { projectId: project.id, planId: plan.planId }
      });
      this.#transactionStore.save(tx);
      this.#transactionStore.transition(txId, "claimed", 1);
      this.#transactionStore.transition(txId, "prepared", 1);
    }

    const commitRes = commitProjectCompletion(plan, project, {
      ...params.options,
      userId: params.userId,
      sideEffectHandlers
    });

    if (!commitRes.ok) {
      if (this.#transactionStore) {
        this.#transactionStore.transition(txId, "failed", 1, commitRes.error.message);
      }
      return commitRes;
    }

    const { updatedProject, childReceipts, partialFailure } = commitRes.value;

    if (this.#transactionStore) {
      if (partialFailure) {
        this.#transactionStore.transition(txId, "needs-recovery", 1, "Coordinated side effects experienced partial failure");
      } else {
        this.#transactionStore.transition(txId, "committing", 1);
      }
    }

    const updatedProjects = currentProjectsData.projects.map((p) =>
      p.id === params.projectId ? updatedProject : p
    );

    const updatedRecord = withDomainProjectsData(record, {
      ...currentProjectsData,
      projects: Object.freeze(updatedProjects)
    });

    const saveRes = await this.#domains.save({
      ...docRes.value,
      record: updatedRecord
    });

    if (!saveRes.ok) {
      if (this.#transactionStore) {
        this.#transactionStore.transition(txId, "failed", 1, saveRes.error.message);
      }
      return saveRes;
    }

    if (this.#transactionStore && !partialFailure) {
      this.#transactionStore.transition(txId, "committed", 1);
    }

    return ok({
      project: updatedProject,
      childReceipts
    });
  }

  async #mutateLifecycle(
    domainUuid: string,
    projectId: string,
    expectedRevision: number | undefined,
    mutator: (p: ProjectInstance) => Result<{ readonly updatedProject: ProjectInstance }>
  ): Promise<Result<{ readonly project: ProjectInstance }>> {
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
          message: `Project ${projectId} not found in domain ${domainUuid}`
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
}
