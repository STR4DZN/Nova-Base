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
import type { FacilityInstance } from "../types/facility-types.js";
import type { FacilityDefinitionRegistry } from "../definitions/facility-registry.js";
import { createDefaultFacilityRegistry } from "../definitions/facility-registry.js";
import { getDomainFacilitiesData } from "../facility-data.js";
import {
  buildFacilitiesViewModel,
  type FacilitiesPresenterOptions,
  type FacilitiesSubsystemViewModel
} from "../../ui/domain-patterns/facilities/facility-presenter.js";
import type {
  CreateFacilityParams,
  MaintainFacilityParams,
  RepairFacilityParams,
  ApplyDamageParams,
  FacilitiesService
} from "../services/facilities-service.js";

function makeCommand<T>(type: string, payload: T): DomainCommand<T> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

export interface PublicFacilitiesApi {
  getFacilities(domainUuid: string, viewer?: Partial<ViewerIdentity>): Promise<Result<readonly FacilityInstance[]>>;
  getFacility(domainUuid: string, facilityId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<FacilityInstance>>;
  buildViewModel(domainInput: { record: DomainRecord } | DomainRecord, options?: Partial<FacilitiesPresenterOptions>): FacilitiesSubsystemViewModel;
  createFacility(params: CreateFacilityParams): Promise<Result<unknown>>;
  maintainFacility(params: MaintainFacilityParams): Promise<Result<unknown>>;
  repairFacility(params: RepairFacilityParams): Promise<Result<unknown>>;
  applyDamage(params: ApplyDamageParams): Promise<Result<unknown>>;
  decommissionFacility(params: { domainUuid: string; facilityId: string; reason?: string }): Promise<Result<unknown>>;
}

export interface DefaultPublicFacilitiesApiOptions {
  readonly domains: DomainReadRepository;
  readonly commandBus: CommandBus;
  readonly facilityRegistry?: FacilityDefinitionRegistry;
  readonly facilitiesService?: FacilitiesService;
}

export class DefaultPublicFacilitiesApi implements PublicFacilitiesApi {
  readonly #domains: DomainReadRepository;
  readonly #commandBus: CommandBus;
  readonly #facilityRegistry: FacilityDefinitionRegistry;
  readonly #facilitiesService?: FacilitiesService;

  constructor(options: DefaultPublicFacilitiesApiOptions) {
    this.#domains = options.domains;
    this.#commandBus = options.commandBus;
    this.#facilityRegistry = options.facilityRegistry ?? createDefaultFacilityRegistry();
    this.#facilitiesService = options.facilitiesService;
  }

  async getFacilities(domainUuid: string, viewer?: Partial<ViewerIdentity>): Promise<Result<readonly FacilityInstance[]>> {
    const cleanId = domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
    const docRes = await this.#domains.read(cleanId);
    if (!docRes.ok) return docRes;
    const data = getDomainFacilitiesData(docRes.value.record);
    const isGm = viewer?.isGm ?? false;
    if (isGm) return ok(data.facilities);
    return ok(data.facilities.filter((f) => !f.tags.includes("secret")));
  }

  async getFacility(domainUuid: string, facilityId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<FacilityInstance>> {
    const listRes = await this.getFacilities(domainUuid, viewer);
    if (!listRes.ok) return listRes;
    const f = listRes.value.find((item) => item.id === facilityId);
    if (!f) {
      return err(
        createPublicError({
          code: "DM_FACILITY_NOT_FOUND",
          category: "not-found",
          message: `Facility ${facilityId} not found in domain ${domainUuid}`
        })
      );
    }
    return ok(f);
  }

  buildViewModel(
    domainInput: { record: DomainRecord } | DomainRecord,
    options?: Partial<FacilitiesPresenterOptions>
  ): FacilitiesSubsystemViewModel {
    const record: DomainRecord = "record" in domainInput ? domainInput.record : domainInput;
    return buildFacilitiesViewModel(record, {
      facilityRegistry: this.#facilityRegistry,
      ...options
    });
  }

  async createFacility(params: CreateFacilityParams): Promise<Result<unknown>> {
    const cmd = makeCommand("facilities:create-facility", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async maintainFacility(params: MaintainFacilityParams): Promise<Result<unknown>> {
    const cmd = makeCommand("facilities:maintain-facility", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async repairFacility(params: RepairFacilityParams): Promise<Result<unknown>> {
    const cmd = makeCommand("facilities:repair-facility", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async applyDamage(params: ApplyDamageParams): Promise<Result<unknown>> {
    const cmd = makeCommand("facilities:apply-damage", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }

  async decommissionFacility(params: { domainUuid: string; facilityId: string; reason?: string }): Promise<Result<unknown>> {
    const cmd = makeCommand("facilities:decommission-facility", params);
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(res.value.error ?? createPublicError({ code: "DM_COMMAND_REJECTED", category: "internal", message: "Command rejected" }));
    }
    return ok(res.value.result);
  }
}
