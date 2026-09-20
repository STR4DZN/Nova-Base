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
import { createTransactionRecord } from "../../mutations/transaction-record.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { FacilitiesService } from "../../facilities/services/facilities-service.js";
import { getDomainEconomyData, tryGetDomainEconomyData } from "../../economy/economy-data.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import { tryGetDomainPeopleData } from "../../people/people-data.js";
import { calculateWorkforce } from "../../people/workforce/workforce-calculator.js";

export interface ProjectsServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly projectRegistry?: ProjectDefinitionRegistry;
  readonly economyService?: EconomyService;
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
    const domainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(domainUuid);
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

    // Workforce check against domain people data (G5-REVAL-006)
    let availableWorkforce = 0;
    const peopleDataRes = tryGetDomainPeopleData(record);
    if (peopleDataRes.ok) {
      const wfReport = calculateWorkforce(peopleDataRes.value);
      const generalWf = wfReport.types["general"];
      availableWorkforce = generalWf?.available ?? 0;
    }

    if (params.workforceRequired !== undefined && params.workforceRequired > 0) {
      if (availableWorkforce < params.workforceRequired) {
        return err(
          createPublicError({
            code: "DM_PROJECT_WORKFORCE_INSUFFICIENT",
            category: "conflict",
            message: `Insufficient workforce for project '${params.name ?? definition.label}': required ${params.workforceRequired}, available ${availableWorkforce}`,
            details: { required: params.workforceRequired, available: availableWorkforce }
          })
        );
      }
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

    const mappedContributors: readonly ProjectContributorRef[] | undefined = params.contributors?.map((c) =>
      typeof c === "string" ? { type: "notable" as const, ref: c } : c
    );

    const plan = evaluateProjectStartPlan({
      project: draftProject,
      definition,
      domain: record,
      expectedRevision: params.expectedRevision ?? 0,
      targetLifecycle: (params.initialState === "initializing" ? "initializing" : "active"),
      contributors: mappedContributors,
      parameters: params.workforceRequired !== undefined ? { workforceRequired: params.workforceRequired } : undefined
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

    // Execute upfront debit and reservation creation (G5-REVAL-005)
    if (this.#economyService) {
      for (const cost of definition.costs) {
        if (cost.timing === "upfront") {
          const debitRes = await this.#economyService.commitAdjust({
            domainUuid: params.domainUuid,
            resourceId: cost.resourceId,
            deltaMinor: -cost.amountMinor,
            reason: `Upfront cost for project ${draftProject.name}`
          });
          if (!debitRes.ok) {
            return err(
              createPublicError({
                code: "DM_PROJECT_START_BLOCKED",
                category: "conflict",
                message: `Failed to debit upfront cost for '${cost.resourceId}': ${debitRes.error.message}`,
                details: debitRes.error
              })
            );
          }
        } else if (cost.timing === "reserved") {
          const reserveRes = await this.#economyService.reserve({
            domainUuid: params.domainUuid,
            resourceId: cost.resourceId,
            amountMinor: cost.amountMinor,
            source: { type: "project", ref: projectId }
          });
          if (!reserveRes.ok) {
            return err(
              createPublicError({
                code: "DM_PROJECT_START_BLOCKED",
                category: "conflict",
                message: `Failed to create reservation for '${cost.resourceId}': ${reserveRes.error.message}`,
                details: reserveRes.error
              })
            );
          }
        }
      }
    }

    const commitRes = commitProjectStartPlan(plan, draftProject, {
      userId: params.userId
    });
    if (!commitRes.ok) return commitRes;

    const startedProject = commitRes.value.project;

    // Re-read fresh domain document after upfront debits/reservations to avoid revision conflict
    const freshDocRes = await this.#domains.read(domainUuid);
    if (!freshDocRes.ok) return freshDocRes;
    const freshProjectsData = getDomainProjectsData(freshDocRes.value.record);

    const updatedRecord = withDomainProjectsData(freshDocRes.value.record, {
      ...freshProjectsData,
      projects: Object.freeze([...freshProjectsData.projects, startedProject])
    });

    const saveRes = await this.#domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ project: startedProject });
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

    // Progressive costs consumption (G5-REVAL-005)
    if (this.#economyService && advanceRes.value.receipt.unitsDelta > 0) {
      for (const cost of definition.costs) {
        if (cost.timing === "progressive") {
          const progAmount = Math.max(
            0,
            Math.floor((advanceRes.value.receipt.unitsDelta / project.workRequired) * cost.amountMinor)
          );
          if (progAmount > 0) {
            await this.#economyService.commitAdjust({
              domainUuid: params.domainUuid,
              resourceId: cost.resourceId,
              deltaMinor: -progAmount,
              reason: `Progressive cost for project ${project.name}`
            });
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

  async pauseProject(params: { domainUuid: string; projectId: string; reason?: string; userId?: string | null; expectedRevision?: number; commandId?: string; authorityEpoch?: number }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planPauseProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async resumeProject(params: { domainUuid: string; projectId: string; reason?: string; userId?: string | null; expectedRevision?: number; commandId?: string; authorityEpoch?: number }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planResumeProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async cancelProject(params: CancelProjectParams): Promise<Result<{ readonly project: ProjectInstance }>> {
    // Release any active reservations for this project (G5-REVAL-005)
    if (this.#economyService && "releaseReservation" in this.#economyService) {
      try {
        const resList = await (this.#economyService as any).getReservations?.(params.domainUuid);
        if (resList && resList.ok && Array.isArray(resList.value)) {
          for (const r of resList.value) {
            if (r.source?.ref === params.projectId || r.source?.type === "project") {
              await this.#economyService.releaseReservation({
                domainUuid: params.domainUuid,
                reservationId: r.id,
                reason: params.reason ?? "Project cancelled"
              });
            }
          }
        }
      } catch {
        // best-effort reservation release
      }
    }

    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planCancelProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async blockProject(params: { domainUuid: string; projectId: string; reason: string; userId?: string | null; expectedRevision?: number; commandId?: string; authorityEpoch?: number }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planBlockProject(p, { reason: params.reason, userId: params.userId, expectedRevision: params.expectedRevision })
    );
  }

  async unblockProject(params: { domainUuid: string; projectId: string; reason?: string; userId?: string | null; expectedRevision?: number; commandId?: string; authorityEpoch?: number }): Promise<Result<{ readonly project: ProjectInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.projectId, params.expectedRevision, (p) =>
      planUnblockProject(p, { note: params.reason, userId: params.userId })
    );
  }

  async completeProject(params: CompleteProjectParams): Promise<Result<{ readonly project: ProjectInstance; readonly childReceipts: readonly ChildReceipt[] }>> {
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

    // Execute onCompletion costs (G5-REVAL-005)
    if (this.#economyService) {
      for (const cost of definition.costs) {
        if (cost.timing === "onCompletion") {
          await this.#economyService.commitAdjust({
            domainUuid: params.domainUuid,
            resourceId: cost.resourceId,
            deltaMinor: -cost.amountMinor,
            reason: `OnCompletion cost for project ${project.name}`
          });
        }
      }
    }

    // Execute real coordinated side effects (G5-REVAL-003)
    const executedReceipts: Record<string, ChildReceipt> = {};
    if (this.#facilitiesService) {
      for (const effect of plan.sideEffects.filter((e) => e.type === "facility")) {
        if (!effect.targetRef) continue;
        const facRes = await this.#facilitiesService.createFacility({
          domainUuid: params.domainUuid,
          definitionId: effect.targetRef,
          name: effect.description
        });
        if (facRes.ok) {
          executedReceipts[effect.id] = {
            childReceiptId: createOpaqueId("rep"),
            subsystem: "facility",
            action: "create_facility",
            targetRef: facRes.value.facility.id,
            payload: { definitionId: effect.targetRef, facilityId: facRes.value.facility.id },
            success: true,
            appliedAt: Date.now()
          };
        } else {
          executedReceipts[effect.id] = {
            childReceiptId: createOpaqueId("rep"),
            subsystem: "facility",
            action: "create_facility",
            targetRef: effect.targetRef,
            payload: effect.value,
            success: false,
            error: facRes.error.message,
            appliedAt: Date.now()
          };
        }
      }
    }

    if (this.#economyService) {
      for (const effect of plan.sideEffects.filter((e) => e.type === "resource")) {
        if (!effect.targetRef) continue;
        const econRes = await this.#economyService.commitAdjust({
          domainUuid: params.domainUuid,
          resourceId: effect.targetRef,
          deltaMinor: Number(effect.value),
          reason: `Project completion reward: ${effect.description ?? project.name}`
        });
        if (econRes.ok) {
          executedReceipts[effect.id] = {
            childReceiptId: createOpaqueId("rep"),
            subsystem: "economy",
            action: "credit_resource",
            targetRef: effect.targetRef,
            payload: { amountMinor: effect.value },
            success: true,
            appliedAt: Date.now()
          };
        } else {
          executedReceipts[effect.id] = {
            childReceiptId: createOpaqueId("rep"),
            subsystem: "economy",
            action: "credit_resource",
            targetRef: effect.targetRef,
            payload: { amountMinor: effect.value },
            success: false,
            error: econRes.error.message,
            appliedAt: Date.now()
          };
        }
      }
    }

    // Build side effect handlers delivering executed real receipts
    const sideEffectHandlers: Record<string, SideEffectHandler> = {
      ...(params.options?.sideEffectHandlers ?? {})
    };

    if (!sideEffectHandlers.facility) {
      sideEffectHandlers.facility = (effect) => {
        return (
          executedReceipts[effect.id] ?? {
            childReceiptId: createOpaqueId("rep"),
            subsystem: "facility",
            action: "create_facility",
            targetRef: effect.targetRef,
            payload: effect.value,
            success: !this.#facilitiesService,
            appliedAt: Date.now()
          }
        );
      };
    }

    if (!sideEffectHandlers.resource) {
      sideEffectHandlers.resource = (effect) => {
        return (
          executedReceipts[effect.id] ?? {
            childReceiptId: createOpaqueId("rep"),
            subsystem: "economy",
            action: "credit_resource",
            targetRef: effect.targetRef,
            payload: { amountMinor: effect.value },
            success: !this.#economyService,
            appliedAt: Date.now()
          }
        );
      };
    }

    // G4/G5 Transaction integration with REAL command context & epoch (G5-REVAL-011)
    const txId = createOpaqueId("tx");
    const cmdId: CommandId = params.commandId
      ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
      : createCommandId();
    const epoch = params.authorityEpoch ?? 1;

    if (this.#transactionStore) {
      const tx = createTransactionRecord({
        transactionId: txId,
        commandId: cmdId,
        authorityEpoch: epoch,
        lockKeys: [`domain:${domainUuid}`, `project:${project.id}`],
        safeAutoRecovery: false,
        recoveryData: {
          projectId: project.id,
          planId: plan.planId,
          correlationId: params.correlationId,
          causationId: params.causationId
        }
      });
      this.#transactionStore.save(tx);
      this.#transactionStore.transition(txId, "claimed", epoch);
      this.#transactionStore.transition(txId, "prepared", epoch);
    }

    const commitRes = commitProjectCompletion(plan, project, {
      ...params.options,
      userId: params.userId,
      sideEffectHandlers
    });

    if (!commitRes.ok) {
      if (this.#transactionStore) {
        this.#transactionStore.transition(txId, "failed", epoch, commitRes.error.message);
      }
      return commitRes;
    }

    const { updatedProject, childReceipts, partialFailure } = commitRes.value;

    if (this.#transactionStore) {
      if (partialFailure) {
        this.#transactionStore.transition(
          txId,
          "needs-recovery",
          epoch,
          "Coordinated side effects experienced partial failure"
        );
      } else {
        this.#transactionStore.transition(txId, "committing", epoch);
      }
    }

    // Re-read fresh domain document after onCompletion costs and coordinated side effects
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

    if (!saveRes.ok) {
      if (this.#transactionStore) {
        this.#transactionStore.transition(txId, "failed", epoch, saveRes.error.message);
      }
      return saveRes;
    }

    if (this.#transactionStore && !partialFailure) {
      this.#transactionStore.transition(txId, "committed", epoch);
    }

    return ok({
      project: updatedProject,
      childReceipts
    });
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
}
