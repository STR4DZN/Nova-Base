import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { CommandBus } from "../../commands/command-bus.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../commands/command-envelope.js";
import type { DomainReadRepository } from "../../storage/repositories/domain-repository.js";
import { resolveCurrentViewer, type ViewerIdentity } from "../../projection/viewer-identity.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRecord } from "../../domains/domain-schema.js";
import type { DowntimeInstance } from "../types/downtime-types.js";
import type { DowntimeDefinitionRegistry } from "../definitions/downtime-registry.js";
import { createDefaultDowntimeRegistry } from "../definitions/downtime-registry.js";
import { getDomainDowntimeData } from "../downtime-data.js";
import {
  buildDowntimeViewModel,
  type DowntimePresenterOptions,
  type DowntimeSubsystemViewModel
} from "../../ui/domain-patterns/downtime/downtime-presenter.js";
import type {
  StartActivityParams,
  AdvanceActivityParams,
  CompleteActivityParams,
  DowntimeService
} from "../services/downtime-service.js";

function makeCommand<T>(type: string, payload: T): DomainCommand<T> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

export interface PublicDowntimeApi {
  getActivities(domainUuid: string, viewer?: Partial<ViewerIdentity>): Promise<Result<readonly DowntimeInstance[]>>;
  getActivity(domainUuid: string, activityId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<DowntimeInstance>>;
  buildViewModel(domainInput: { record: DomainRecord } | DomainRecord, options?: Partial<DowntimePresenterOptions>): DowntimeSubsystemViewModel;
  startActivity(params: StartActivityParams): Promise<Result<unknown>>;
  advanceActivity(params: AdvanceActivityParams): Promise<Result<unknown>>;
  completeActivity(params: CompleteActivityParams): Promise<Result<unknown>>;
  pauseActivity(params: { domainUuid: string; activityId: string; reason?: string }): Promise<Result<unknown>>;
  resumeActivity(params: { domainUuid: string; activityId: string; reason?: string }): Promise<Result<unknown>>;
  cancelActivity(params: { domainUuid: string; activityId: string; reason?: string }): Promise<Result<unknown>>;
}

export interface DefaultPublicDowntimeApiOptions {
  readonly domains: DomainReadRepository;
  readonly commandBus: CommandBus;
  readonly downtimeRegistry?: DowntimeDefinitionRegistry;
  readonly downtimeService?: DowntimeService;
}

export class DefaultPublicDowntimeApi implements PublicDowntimeApi {
  readonly #domains: DomainReadRepository;
  readonly #commandBus: CommandBus;
  readonly #downtimeRegistry: DowntimeDefinitionRegistry;
  readonly #downtimeService?: DowntimeService;

  constructor(options: DefaultPublicDowntimeApiOptions) {
    this.#domains = options.domains;
    this.#commandBus = options.commandBus;
    this.#downtimeRegistry = options.downtimeRegistry ?? createDefaultDowntimeRegistry();
    this.#downtimeService = options.downtimeService;
  }

  async getActivities(domainUuid: string, viewer?: Partial<ViewerIdentity>): Promise<Result<readonly DowntimeInstance[]>> {
    const cleanId = normalizeJournalEntryId(domainUuid);
    const docRes = await this.#domains.read(cleanId);
    if (!docRes.ok) return docRes;
    const data = getDomainDowntimeData(docRes.value.record);
    const isGm = resolveCurrentViewer(viewer).isGm;
    if (isGm) return ok(data.activities);
    return ok(data.activities.filter((a) => !a.tags.includes("secret")));
  }

  async getActivity(domainUuid: string, activityId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<DowntimeInstance>> {
    const listRes = await this.getActivities(domainUuid, viewer);
    if (!listRes.ok) return listRes;
    const a = listRes.value.find((item) => item.id === activityId);
    if (!a) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_NOT_FOUND",
          category: "not-found",
          message: `Downtime activity ${activityId} not found in domain ${domainUuid}`
        })
      );
    }
    return ok(a);
  }

  buildViewModel(
    domainInput: { record: DomainRecord } | DomainRecord,
    options?: Partial<DowntimePresenterOptions>
  ): DowntimeSubsystemViewModel {
    const record: DomainRecord = "record" in domainInput ? domainInput.record : domainInput;
    return buildDowntimeViewModel(record, {
      downtimeRegistry: this.#downtimeRegistry,
      ...options
    });
  }

  async startActivity(params: StartActivityParams): Promise<Result<unknown>> {
    const cmd = makeCommand("downtime:start-activity", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async advanceActivity(params: AdvanceActivityParams): Promise<Result<unknown>> {
    const cmd = makeCommand("downtime:advance-activity", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async completeActivity(params: CompleteActivityParams): Promise<Result<unknown>> {
    const cmd = makeCommand("downtime:complete-activity", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async pauseActivity(params: { domainUuid: string; activityId: string; reason?: string }): Promise<Result<unknown>> {
    const cmd = makeCommand("downtime:pause-activity", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async resumeActivity(params: { domainUuid: string; activityId: string; reason?: string }): Promise<Result<unknown>> {
    const cmd = makeCommand("downtime:resume-activity", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async cancelActivity(params: { domainUuid: string; activityId: string; reason?: string }): Promise<Result<unknown>> {
    const cmd = makeCommand("downtime:cancel-activity", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }
}
