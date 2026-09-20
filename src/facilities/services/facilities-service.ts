import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { FacilityDefinitionRegistry } from "../definitions/facility-registry.js";
import { createDefaultFacilityRegistry } from "../definitions/facility-registry.js";
import type {
  FacilityDefinition,
  FacilityInstance,
  FacilityLifecycle,
  FacilityReadiness
} from "../types/facility-types.js";
import type { FacilityCondition } from "../types/facility-maintenance-types.js";
import {
  getDomainFacilitiesData,
  FACILITIES_CAPABILITY_ID,
  withDomainFacilitiesData
} from "../facility-data.js";
import {
  evaluateFacilityMaintenancePlan,
  commitFacilityMaintenance
} from "../plans/facility-maintenance-plan-service.js";
import {
  evaluateFacilityRepairPlan,
  commitFacilityRepair,
  applyFacilityDamage
} from "../plans/facility-repair-plan-service.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import { tryGetDomainEconomyData } from "../../economy/economy-data.js";

export interface FacilitiesServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly facilityRegistry?: FacilityDefinitionRegistry;
  readonly economyService?: EconomyService;
}

export interface CreateFacilityParams {
  readonly domainUuid: string;
  readonly definitionId: string;
  readonly name?: string;
  readonly level?: number;
  readonly initialLifecycle?: FacilityLifecycle;
  readonly userId?: string | null;
}

export interface MaintainFacilityParams {
  readonly domainUuid: string;
  readonly facilityId: string;
  readonly channelId?: string;
  readonly notes?: string;
  readonly userId?: string | null;
}

export interface RepairFacilityParams {
  readonly domainUuid: string;
  readonly facilityId: string;
  readonly restoreIntegrity?: number;
  readonly removeConditionIds?: readonly string[];
  readonly notes?: string;
  readonly userId?: string | null;
}

export interface ApplyDamageParams {
  readonly domainUuid: string;
  readonly facilityId: string;
  readonly damage: number;
  readonly conditionId?: string;
  readonly condition?: FacilityCondition;
  readonly reason?: string;
  readonly userId?: string | null;
}

export class FacilitiesService {
  readonly #domains: DomainRepositoryContract;
  readonly #facilityRegistry: FacilityDefinitionRegistry;
  readonly #economyService?: EconomyService;

  constructor(options: FacilitiesServiceOptions) {
    this.#domains = options.domains;
    this.#facilityRegistry = options.facilityRegistry ?? createDefaultFacilityRegistry();
    this.#economyService = options.economyService;
  }

  #cleanId(idOrUuid: string): string {
    return normalizeJournalEntryId(idOrUuid);
  }

  get registry(): FacilityDefinitionRegistry {
    return this.#facilityRegistry;
  }

  async getFacilities(domainUuid: string): Promise<Result<readonly FacilityInstance[]>> {
    const docRes = await this.#domains.read(this.#cleanId(domainUuid));
    if (!docRes.ok) return docRes;
    const data = getDomainFacilitiesData(docRes.value.record);
    return ok(data.facilities);
  }

  async getFacility(domainUuid: string, facilityId: string): Promise<Result<FacilityInstance>> {
    const cleanDomainUuid = this.#cleanId(domainUuid);
    const docRes = await this.#domains.read(cleanDomainUuid);
    if (!docRes.ok) return docRes;
    const data = getDomainFacilitiesData(docRes.value.record);
    const f = data.facilities.find((item) => item.id === facilityId);
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

  async createFacility(params: CreateFacilityParams): Promise<Result<{ readonly facility: FacilityInstance }>> {
    const cleanDomainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(cleanDomainUuid);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    if (!record.definition.capabilities.enabled.includes(FACILITIES_CAPABILITY_ID)) {
      return err(
        createPublicError({
          code: "DM_FACILITY_CAPABILITY_DISABLED",
          category: "conflict",
          message: `Facilities capability '${FACILITIES_CAPABILITY_ID}' is not enabled on domain ${params.domainUuid}`
        })
      );
    }

    const definition = this.#facilityRegistry.get(params.definitionId);
    if (!definition) {
      return err(
        createPublicError({
          code: "DM_FACILITY_DEFINITION_NOT_FOUND",
          category: "not-found",
          message: `Facility definition '${params.definitionId}' not found`
        })
      );
    }

    const currentFacilitiesData = getDomainFacilitiesData(record);
    const facilityId = `fac-${createOpaqueId("prj").slice("prj_".length)}`;
    const now = Date.now();

    const newFacility: FacilityInstance = {
      id: facilityId,
      definitionId: params.definitionId,
      domainUuid: cleanDomainUuid,
      name: params.name || definition.label,
      schemaVersion: 1,
      revision: 0,
      level: params.level ?? 1,
      lifecycle: params.initialLifecycle ?? "operational",
      readiness: "ready",
      installedModules: Object.freeze([]),
      activeUpgrades: Object.freeze([]),
      integrity: Object.freeze({ current: 100, max: 100 }),
      conditions: Object.freeze([]),
      maintenanceState: {
        status: "current",
        overdueTicks: 0,
        accumulatedTicks: 0
      },
      tags: Object.freeze([...(definition.tags ?? [])]),
      createdAt: now,
      updatedAt: now
    };

    const updatedFacilities = Object.freeze([...currentFacilitiesData.facilities, newFacility]);
    const updatedRecord = withDomainFacilitiesData(record, {
      ...currentFacilitiesData,
      facilities: updatedFacilities
    });

    const saveRes = await this.#domains.save({
      ...docRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ facility: newFacility });
  }

  async maintainFacility(params: MaintainFacilityParams): Promise<Result<{ readonly facility: FacilityInstance }>> {
    const cleanDomainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(cleanDomainUuid);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentFacilitiesData = getDomainFacilitiesData(record);
    const facility = currentFacilitiesData.facilities.find((f) => f.id === params.facilityId);
    if (!facility) {
      return err(
        createPublicError({
          code: "DM_FACILITY_NOT_FOUND",
          category: "not-found",
          message: `Facility ${params.facilityId} not found in domain ${params.domainUuid}`
        })
      );
    }

    const def = this.#facilityRegistry.get(facility.definitionId);
    if (!def) {
      return err(
        createPublicError({
          code: "DM_FACILITY_DEFINITION_NOT_FOUND",
          category: "not-found",
          message: `Facility definition '${facility.definitionId}' not found`
        })
      );
    }

    if (!def.maintenance) {
      return err(
        createPublicError({
          code: "DM_FACILITY_MAINTENANCE_NOT_CONFIGURED",
          category: "conflict",
          message: `Facility '${facility.name}' definition does not configure maintenance`
        })
      );
    }

    // Evaluate available balances from domain economy data (G5-REVAL-009)
    let availableBalances: Record<string, number> | undefined = undefined;
    const econDataRes = tryGetDomainEconomyData(record);
    if (econDataRes.ok) {
      availableBalances = {};
      for (const acct of econDataRes.value.accounts) {
        if (acct.mode === "native") {
          const balance = acct.balanceMinor;
          availableBalances[acct.resourceId] = (availableBalances[acct.resourceId] ?? 0) + balance;
        }
      }
    }

    const plan = evaluateFacilityMaintenancePlan({
      facility,
      definition: def,
      channelId: params.channelId,
      availableBalances
    });
    if (!plan.valid) {
      const firstErr = plan.errors?.[0];
      return err(
        firstErr ??
        createPublicError({
          code: "DM_FACILITY_MAINTENANCE_BLOCKED",
          category: "conflict",
          message: "Facility maintenance plan is invalid or blocked",
          details: { errors: plan.errors }
        })
      );
    }

    // Debit maintenance costs via economy service if configured (G5-REVAL-009)
    if (this.#economyService && plan.resourceCosts.length > 0) {
      for (const cost of plan.resourceCosts) {
        const debitRes = await this.#economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: -cost.amount,
          reason: `Maintenance cost for facility '${facility.name}'`
        });
        if (!debitRes.ok) {
          return debitRes;
        }
      }
    }

    const commitRes = commitFacilityMaintenance({
      plan,
      facility,
      note: params.notes
    });
    if (!commitRes.ok) return commitRes;

    const updatedFacility = commitRes.value.updatedFacility;

    // Re-read fresh domain document after economy adjustments to avoid revision conflict and preserve balance mutations
    const freshDocRes = await this.#domains.read(cleanDomainUuid);
    if (!freshDocRes.ok) return freshDocRes;

    const freshFacilitiesData = getDomainFacilitiesData(freshDocRes.value.record);
    const updatedFacilities = freshFacilitiesData.facilities.map((f) =>
      f.id === params.facilityId ? updatedFacility : f
    );

    const updatedRecord = withDomainFacilitiesData(freshDocRes.value.record, {
      ...freshFacilitiesData,
      facilities: Object.freeze(updatedFacilities)
    });

    const saveRes = await this.#domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ facility: updatedFacility });
  }

  async repairFacility(params: RepairFacilityParams): Promise<Result<{ readonly facility: FacilityInstance }>> {
    const cleanDomainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(cleanDomainUuid);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentFacilitiesData = getDomainFacilitiesData(record);
    const facility = currentFacilitiesData.facilities.find((f) => f.id === params.facilityId);
    if (!facility) {
      return err(
        createPublicError({
          code: "DM_FACILITY_NOT_FOUND",
          category: "not-found",
          message: `Facility ${params.facilityId} not found in domain ${params.domainUuid}`
        })
      );
    }

    const def = this.#facilityRegistry.get(facility.definitionId);
    if (!def) {
      return err(
        createPublicError({
          code: "DM_FACILITY_DEFINITION_NOT_FOUND",
          category: "not-found",
          message: `Facility definition '${facility.definitionId}' not found`
        })
      );
    }

    const plan = evaluateFacilityRepairPlan({
      facility,
      definition: def,
      targetIntegrityDelta: params.restoreIntegrity,
      conditionsToClear: params.removeConditionIds
    });

    if (!plan.valid) {
      const firstErr = plan.errors?.[0];
      return err(
        createPublicError({
          code: "DM_FACILITY_REPAIR_BLOCKED",
          category: "conflict",
          message: firstErr?.message ?? "Facility repair plan is invalid or blocked",
          details: { errors: plan.errors }
        })
      );
    }

    if (plan.requiresProject || !plan.isDirectRepairAllowed) {
      return err(
        createPublicError({
          code: "DM_FACILITY_REPAIR_REQUIRES_PROJECT",
          category: "conflict",
          message: "Facility damage requires an engineering project and cannot be repaired directly"
        })
      );
    }

    // Debit repair costs via economy service if configured
    if (this.#economyService && plan.resourceCosts.length > 0) {
      for (const cost of plan.resourceCosts) {
        const debitRes = await this.#economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: -cost.amount,
          reason: `Repair cost for facility '${facility.name}'`
        });
        if (!debitRes.ok) {
          return debitRes;
        }
      }
    }

    const commitRes = commitFacilityRepair({
      plan,
      facility,
      note: params.notes
    });
    if (!commitRes.ok) return commitRes;

    const updatedFacility = commitRes.value.updatedFacility;

    // Re-read fresh domain document after economy adjustments to avoid revision conflict and preserve balance mutations
    const freshDocRes = await this.#domains.read(cleanDomainUuid);
    if (!freshDocRes.ok) return freshDocRes;

    const freshFacilitiesData = getDomainFacilitiesData(freshDocRes.value.record);
    const updatedFacilities = freshFacilitiesData.facilities.map((f) =>
      f.id === params.facilityId ? updatedFacility : f
    );

    const updatedRecord = withDomainFacilitiesData(freshDocRes.value.record, {
      ...freshFacilitiesData,
      facilities: Object.freeze(updatedFacilities)
    });

    const saveRes = await this.#domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ facility: updatedFacility });
  }

  async applyDamage(params: ApplyDamageParams): Promise<Result<{ readonly facility: FacilityInstance }>> {
    const cleanDomainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(cleanDomainUuid);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentFacilitiesData = getDomainFacilitiesData(record);
    const facility = currentFacilitiesData.facilities.find((f) => f.id === params.facilityId);
    if (!facility) {
      return err(
        createPublicError({
          code: "DM_FACILITY_NOT_FOUND",
          category: "not-found",
          message: `Facility ${params.facilityId} not found in domain ${params.domainUuid}`
        })
      );
    }

    // Construct condition if only conditionId was provided
    let condition = params.condition;
    if (!condition && params.conditionId) {
      condition = {
        id: params.conditionId,
        type: `domain-manager:${params.conditionId}`,
        label: params.conditionId,
        severity: "major",
        appliedAtTimestamp: Date.now()
      };
    }

    // Delegate to canonical applyFacilityDamage (G5-REVAL-010)
    const damageRes = applyFacilityDamage({
      facility,
      deltaIntegrity: Math.abs(params.damage),
      condition,
      note: params.reason
    });
    if (!damageRes.ok) return damageRes;

    const updatedFacility = damageRes.value;
    const updatedFacilities = currentFacilitiesData.facilities.map((f) =>
      f.id === params.facilityId ? updatedFacility : f
    );

    const updatedRecord = withDomainFacilitiesData(record, {
      ...currentFacilitiesData,
      facilities: Object.freeze(updatedFacilities)
    });

    const saveRes = await this.#domains.save({
      ...docRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ facility: updatedFacility });
  }

  async decommissionFacility(params: { domainUuid: string; facilityId: string; reason?: string; userId?: string | null }): Promise<Result<{ readonly facility: FacilityInstance }>> {
    const cleanDomainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(cleanDomainUuid);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentFacilitiesData = getDomainFacilitiesData(record);
    const facility = currentFacilitiesData.facilities.find((f) => f.id === params.facilityId);
    if (!facility) {
      return err(
        createPublicError({
          code: "DM_FACILITY_NOT_FOUND",
          category: "not-found",
          message: `Facility ${params.facilityId} not found in domain ${params.domainUuid}`
        })
      );
    }

    const updatedFacility: FacilityInstance = {
      ...facility,
      lifecycle: "decommissioned",
      readiness: "unavailable",
      revision: facility.revision + 1,
      updatedAt: Date.now()
    };

    const updatedFacilities = currentFacilitiesData.facilities.map((f) =>
      f.id === params.facilityId ? updatedFacility : f
    );

    const updatedRecord = withDomainFacilitiesData(record, {
      ...currentFacilitiesData,
      facilities: Object.freeze(updatedFacilities)
    });

    const saveRes = await this.#domains.save({
      ...docRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ facility: updatedFacility });
  }
}
