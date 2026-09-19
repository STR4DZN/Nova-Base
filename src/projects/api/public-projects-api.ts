import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { CommandBus } from "../../commands/command-bus.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../commands/command-envelope.js";
import type { DomainReadRepository } from "../../storage/repositories/domain-repository.js";
import type { ViewerIdentity } from "../../projection/viewer-identity.js";
import type { DomainRecord } from "../../domains/domain-schema.js";
import type { ProjectInstance } from "../types/project-types.js";
import type { ProjectDefinitionRegistry } from "../definitions/project-registry.js";
import { createDefaultProjectRegistry } from "../definitions/project-registry.js";
import { getDomainProjectsData } from "../project-data.js";
import {
  buildProjectsViewModel,
  type ProjectsPresenterOptions,
  type ProjectsSubsystemViewModel
} from "../../ui/domain-patterns/projects/project-presenter.js";
import type {
  StartProjectParams,
  AdvanceProjectParams,
  CompleteProjectParams,
  ProjectsService
} from "../services/projects-service.js";

function makeCommand<T>(type: string, payload: T): DomainCommand<T> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

export interface PublicProjectsApi {
  getProjects(domainUuid: string, viewer?: Partial<ViewerIdentity>): Promise<Result<readonly ProjectInstance[]>>;
  getProject(domainUuid: string, projectId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<ProjectInstance>>;
  buildViewModel(domainInput: { record: DomainRecord } | DomainRecord, options?: Partial<ProjectsPresenterOptions>): ProjectsSubsystemViewModel;
  startProject(params: StartProjectParams): Promise<Result<unknown>>;
  advanceProject(params: AdvanceProjectParams): Promise<Result<unknown>>;
  pauseProject(params: { domainUuid: string; projectId: string; reason?: string }): Promise<Result<unknown>>;
  resumeProject(params: { domainUuid: string; projectId: string; reason?: string }): Promise<Result<unknown>>;
  cancelProject(params: { domainUuid: string; projectId: string; reason?: string }): Promise<Result<unknown>>;
  completeProject(params: CompleteProjectParams): Promise<Result<unknown>>;
}

export interface DefaultPublicProjectsApiOptions {
  readonly domains: DomainReadRepository;
  readonly commandBus: CommandBus;
  readonly projectRegistry?: ProjectDefinitionRegistry;
  readonly projectsService?: ProjectsService;
}

export class DefaultPublicProjectsApi implements PublicProjectsApi {
  readonly #domains: DomainReadRepository;
  readonly #commandBus: CommandBus;
  readonly #projectRegistry: ProjectDefinitionRegistry;
  readonly #projectsService?: ProjectsService;

  constructor(options: DefaultPublicProjectsApiOptions) {
    this.#domains = options.domains;
    this.#commandBus = options.commandBus;
    this.#projectRegistry = options.projectRegistry ?? createDefaultProjectRegistry();
    this.#projectsService = options.projectsService;
  }

  async getProjects(domainUuid: string, viewer?: Partial<ViewerIdentity>): Promise<Result<readonly ProjectInstance[]>> {
    const cleanId = domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
    const docRes = await this.#domains.read(cleanId);
    if (!docRes.ok) return docRes;
    const data = getDomainProjectsData(docRes.value.record);
    const isGm = viewer?.isGm ?? false;
    if (isGm) return ok(data.projects);
    // Non-GM filters out secret projects
    return ok(data.projects.filter((p) => !p.tags.includes("secret")));
  }

  async getProject(domainUuid: string, projectId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<ProjectInstance>> {
    const listRes = await this.getProjects(domainUuid, viewer);
    if (!listRes.ok) return listRes;
    const p = listRes.value.find((item) => item.id === projectId);
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

  buildViewModel(
    domainInput: { record: DomainRecord } | DomainRecord,
    options?: Partial<ProjectsPresenterOptions>
  ): ProjectsSubsystemViewModel {
    const record: DomainRecord = "record" in domainInput ? domainInput.record : domainInput;
    return buildProjectsViewModel(record, {
      projectRegistry: this.#projectRegistry,
      ...options
    });
  }

  async startProject(params: StartProjectParams): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:start-project", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async advanceProject(params: AdvanceProjectParams): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:advance-project", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async pauseProject(params: { domainUuid: string; projectId: string; reason?: string }): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:pause-project", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async resumeProject(params: { domainUuid: string; projectId: string; reason?: string }): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:resume-project", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async cancelProject(params: { domainUuid: string; projectId: string; reason?: string }): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:cancel-project", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async completeProject(params: CompleteProjectParams): Promise<Result<unknown>> {
    const cmd = makeCommand("projects:complete-project", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }
}
