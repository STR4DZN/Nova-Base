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
import type { TransactionStore } from "../../mutations/transaction-store.js";
import { createTransactionRecord } from "../../mutations/transaction-record.js";
import type { RecoveryService } from "../../mutations/recovery-service.js";
import { createCommandId, type CommandId } from "../../commands/command-envelope.js";

export interface FacilitiesServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly facilityRegistry?: FacilityDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly transactionStore?: TransactionStore;
  readonly recoveryService?: RecoveryService;
}

export interface CreateFacilityParams {
  readonly domainUuid: string;
  readonly definitionId: string;
  readonly name?: string;
  readonly level?: number;
  readonly initialLifecycle?: FacilityLifecycle;
  readonly initialReadiness?: FacilityReadiness;
  readonly userId?: string | null;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export interface MaintainFacilityParams {
  readonly domainUuid: string;
  readonly facilityId: string;
  readonly channelId?: string;
  readonly notes?: string;
  readonly userId?: string | null;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export interface RepairFacilityParams {
  readonly domainUuid: string;
  readonly facilityId: string;
  readonly restoreIntegrity?: number;
  readonly removeConditionIds?: readonly string[];
  readonly notes?: string;
  readonly userId?: string | null;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export interface ApplyDamageParams {
  readonly domainUuid: string;
  readonly facilityId: string;
  readonly damage: number;
  readonly conditionId?: string;
  readonly condition?: FacilityCondition;
  readonly reason?: string;
  readonly userId?: string | null;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export interface FacilityOperationRecoveryData {
  readonly type: "facilities:maintenance" | "facilities:repair";
  readonly facilityId: string;
  readonly domainUuid: string;
  readonly debitedCosts: readonly { readonly resourceId: string; readonly amount: number }[];
  readonly authorityEpoch: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly status: "prepared" | "executing" | "completed" | "needs-recovery" | "failed";
}

export class FacilitiesService {
  readonly #domains: DomainRepositoryContract;
  readonly #facilityRegistry: FacilityDefinitionRegistry;
  readonly #economyService?: EconomyService;
  readonly #transactionStore?: TransactionStore;
  readonly #recoveryService?: RecoveryService;

  constructor(options: FacilitiesServiceOptions) {
    this.#domains = options.domains;
    this.#facilityRegistry = options.facilityRegistry ?? createDefaultFacilityRegistry();
    this.#economyService = options.economyService;
    this.#transactionStore = options.transactionStore;
    this.#recoveryService = options.recoveryService;
    if (this.#recoveryService) {
      this.registerRecoveryCompensators(this.#recoveryService);
    }
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
      readiness: params.initialReadiness ?? "ready",
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

    // 1. Transaction preparation BEFORE child writes (G5-REVAL4-002, G5-REVAL4-010)
    const txId = createOpaqueId("tx");
    const cmdId: CommandId = params.commandId
      ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
      : createCommandId();
    const epoch = params.authorityEpoch ?? 1;

    const debitedCosts: { resourceId: string; amount: number }[] = [];

    const buildRecoveryData = (status: FacilityOperationRecoveryData["status"]): FacilityOperationRecoveryData => ({
      type: "facilities:maintenance",
      facilityId: facility.id,
      domainUuid: cleanDomainUuid,
      debitedCosts: Object.freeze([...debitedCosts]),
      authorityEpoch: epoch,
      correlationId: params.correlationId,
      causationId: params.causationId,
      status
    });

    if (this.#transactionStore) {
      const tx = createTransactionRecord({
        transactionId: txId,
        commandId: cmdId,
        authorityEpoch: epoch,
        lockKeys: [`domain:${cleanDomainUuid}`, `facility:${facility.id}`],
        safeAutoRecovery: false,
        recoveryData: buildRecoveryData("prepared")
      });
      this.#transactionStore.save(tx);
      const claimRes = this.#transactionStore.transition(txId, "claimed", epoch);
      if (!claimRes.ok) return claimRes;
      const prepRes = this.#transactionStore.transition(txId, "prepared", epoch);
      if (!prepRes.ok) return prepRes;

      // G5-REVAL4-002: Durable flush barrier BEFORE child mutations
      try {
        await this.#transactionStore.flush();
      } catch (flushErr) {
        this.#transactionStore.transition(txId, "failed", epoch, "Persistence flush failed");
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

    let compensationFailed = false;
    const compensateDebits = async (reason: string) => {
      if (!this.#economyService || debitedCosts.length === 0) return;
      for (const cost of debitedCosts) {
        const refundRes = await this.#economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: cost.amount,
          reason: `Compensation: ${reason}`,
          lockOwner: params.commandId
        });
        if (!refundRes.ok) {
          compensationFailed = true;
        }
      }
    };

    if (this.#economyService && plan.resourceCosts.length > 0) {
      for (const cost of plan.resourceCosts) {
        const debitRes = await this.#economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: -cost.amount,
          reason: `Maintenance cost for facility '${facility.name}'`,
          lockOwner: params.commandId
        });
        if (!debitRes.ok) {
          await compensateDebits(`maintenance cost debit failed for facility '${facility.name}'`);
          if (this.#transactionStore) {
            const targetState = compensationFailed ? "needs-recovery" : "failed";
            this.#transactionStore.transition(txId, targetState, epoch, debitRes.error.message);
          }
          return debitRes;
        }
        debitedCosts.push({ resourceId: cost.resourceId, amount: cost.amount });
        if (this.#transactionStore) {
          const tx = this.#transactionStore.get(txId);
          if (tx) {
            this.#transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
          }
        }
      }
    }

    const commitRes = commitFacilityMaintenance({
      plan,
      facility,
      note: params.notes
    });
    if (!commitRes.ok) {
      await compensateDebits(`maintenance commit failed for facility '${facility.name}'`);
      if (this.#transactionStore) {
        const targetState = compensationFailed ? "needs-recovery" : "failed";
        this.#transactionStore.transition(txId, targetState, epoch, commitRes.error.message);
      }
      return commitRes;
    }

    const updatedFacility = commitRes.value.updatedFacility;

    // Re-read fresh domain document after economy adjustments to avoid revision conflict and preserve balance mutations
    const freshDocRes = await this.#domains.read(cleanDomainUuid);
    if (!freshDocRes.ok) {
      await compensateDebits(`domain read failed after maintenance costs for facility '${facility.name}'`);
      if (this.#transactionStore) {
        const targetState = compensationFailed ? "needs-recovery" : "failed";
        this.#transactionStore.transition(txId, targetState, epoch, freshDocRes.error.message);
      }
      return freshDocRes;
    }

    const freshFacilitiesData = getDomainFacilitiesData(freshDocRes.value.record);
    const updatedFacilities = freshFacilitiesData.facilities.map((f) =>
      f.id === params.facilityId ? updatedFacility : f
    );

    const updatedRecord = withDomainFacilitiesData(freshDocRes.value.record, {
      ...freshFacilitiesData,
      facilities: Object.freeze(updatedFacilities)
    });

    // Transition to committing before save
    if (this.#transactionStore) {
      const committingRes = this.#transactionStore.transition(txId, "committing", epoch);
      if (!committingRes.ok) {
        await compensateDebits(`transition to committing failed: ${committingRes.error.message}`);
        const targetState = compensationFailed ? "needs-recovery" : "failed";
        this.#transactionStore.transition(txId, targetState, epoch, committingRes.error.message);
        return committingRes;
      }
    }

    const saveRes = await this.#domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) {
      await compensateDebits(`domain save failed after maintenance for facility '${facility.name}': ${saveRes.error.message}`);
      if (this.#transactionStore) {
        const targetState = compensationFailed ? "needs-recovery" : "failed";
        this.#transactionStore.transition(txId, targetState, epoch, saveRes.error.message);
      }
      return saveRes;
    }

    // Final transition to committed
    if (this.#transactionStore) {
      const committedRes = this.#transactionStore.transition(txId, "committed", epoch);
      if (!committedRes.ok) return committedRes;
      try {
        await this.#transactionStore.flush();
      } catch {
        // already committed
      }
    }

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

    // 1. Transaction preparation BEFORE child writes (G5-REVAL4-002, G5-REVAL4-010)
    const txId = createOpaqueId("tx");
    const cmdId: CommandId = params.commandId
      ? (params.commandId.startsWith("cmd_") ? (params.commandId as CommandId) : (`cmd_${params.commandId}` as CommandId))
      : createCommandId();
    const epoch = params.authorityEpoch ?? 1;

    const debitedCosts: { resourceId: string; amount: number }[] = [];

    const buildRecoveryData = (status: FacilityOperationRecoveryData["status"]): FacilityOperationRecoveryData => ({
      type: "facilities:repair",
      facilityId: facility.id,
      domainUuid: cleanDomainUuid,
      debitedCosts: Object.freeze([...debitedCosts]),
      authorityEpoch: epoch,
      correlationId: params.correlationId,
      causationId: params.causationId,
      status
    });

    if (this.#transactionStore) {
      const tx = createTransactionRecord({
        transactionId: txId,
        commandId: cmdId,
        authorityEpoch: epoch,
        lockKeys: [`domain:${cleanDomainUuid}`, `facility:${facility.id}`],
        safeAutoRecovery: false,
        recoveryData: buildRecoveryData("prepared")
      });
      this.#transactionStore.save(tx);
      const claimRes = this.#transactionStore.transition(txId, "claimed", epoch);
      if (!claimRes.ok) return claimRes;
      const prepRes = this.#transactionStore.transition(txId, "prepared", epoch);
      if (!prepRes.ok) return prepRes;

      // G5-REVAL4-002: Durable flush barrier BEFORE child mutations
      try {
        await this.#transactionStore.flush();
      } catch (flushErr) {
        this.#transactionStore.transition(txId, "failed", epoch, "Persistence flush failed");
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

    let compensationFailed = false;
    const compensateDebits = async (reason: string) => {
      if (!this.#economyService || debitedCosts.length === 0) return;
      for (const cost of debitedCosts) {
        const refundRes = await this.#economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: cost.amount,
          reason: `Compensation: ${reason}`,
          lockOwner: params.commandId
        });
        if (!refundRes.ok) {
          compensationFailed = true;
        }
      }
    };

    if (this.#economyService && plan.resourceCosts.length > 0) {
      for (const cost of plan.resourceCosts) {
        const debitRes = await this.#economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: -cost.amount,
          reason: `Repair cost for facility '${facility.name}'`,
          lockOwner: params.commandId
        });
        if (!debitRes.ok) {
          await compensateDebits(`repair cost debit failed for facility '${facility.name}'`);
          if (this.#transactionStore) {
            const targetState = compensationFailed ? "needs-recovery" : "failed";
            this.#transactionStore.transition(txId, targetState, epoch, debitRes.error.message);
          }
          return debitRes;
        }
        debitedCosts.push({ resourceId: cost.resourceId, amount: cost.amount });
        if (this.#transactionStore) {
          const tx = this.#transactionStore.get(txId);
          if (tx) {
            this.#transactionStore.save({ ...tx, recoveryData: buildRecoveryData("executing") });
          }
        }
      }
    }

    const commitRes = commitFacilityRepair({
      plan,
      facility,
      note: params.notes
    });
    if (!commitRes.ok) {
      await compensateDebits(`repair commit failed for facility '${facility.name}'`);
      if (this.#transactionStore) {
        const targetState = compensationFailed ? "needs-recovery" : "failed";
        this.#transactionStore.transition(txId, targetState, epoch, commitRes.error.message);
      }
      return commitRes;
    }

    const updatedFacility = commitRes.value.updatedFacility;

    // Re-read fresh domain document after economy adjustments to avoid revision conflict and preserve balance mutations
    const freshDocRes = await this.#domains.read(cleanDomainUuid);
    if (!freshDocRes.ok) {
      await compensateDebits(`domain read failed after repair costs for facility '${facility.name}'`);
      if (this.#transactionStore) {
        const targetState = compensationFailed ? "needs-recovery" : "failed";
        this.#transactionStore.transition(txId, targetState, epoch, freshDocRes.error.message);
      }
      return freshDocRes;
    }

    const freshFacilitiesData = getDomainFacilitiesData(freshDocRes.value.record);
    const updatedFacilities = freshFacilitiesData.facilities.map((f) =>
      f.id === params.facilityId ? updatedFacility : f
    );

    const updatedRecord = withDomainFacilitiesData(freshDocRes.value.record, {
      ...freshFacilitiesData,
      facilities: Object.freeze(updatedFacilities)
    });

    // Transition to committing before save
    if (this.#transactionStore) {
      const committingRes = this.#transactionStore.transition(txId, "committing", epoch);
      if (!committingRes.ok) {
        await compensateDebits(`transition to committing failed: ${committingRes.error.message}`);
        const targetState = compensationFailed ? "needs-recovery" : "failed";
        this.#transactionStore.transition(txId, targetState, epoch, committingRes.error.message);
        return committingRes;
      }
    }

    const saveRes = await this.#domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) {
      await compensateDebits(`domain save failed after repair for facility '${facility.name}': ${saveRes.error.message}`);
      if (this.#transactionStore) {
        const targetState = compensationFailed ? "needs-recovery" : "failed";
        this.#transactionStore.transition(txId, targetState, epoch, saveRes.error.message);
      }
      return saveRes;
    }

    // Final transition to committed
    if (this.#transactionStore) {
      const committedRes = this.#transactionStore.transition(txId, "committed", epoch);
      if (!committedRes.ok) return committedRes;
      try {
        await this.#transactionStore.flush();
      } catch {
        // already committed
      }
    }

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

  async decommissionFacility(params: {
    readonly domainUuid: string;
    readonly facilityId: string;
    readonly reason?: string;
    readonly userId?: string | null;
    readonly commandId?: string;
    readonly correlationId?: string;
    readonly causationId?: string;
    readonly authorityEpoch?: number;
  }): Promise<Result<{ readonly facility: FacilityInstance }>> {
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

  registerRecoveryCompensators(recoveryService?: RecoveryService): void {
    const recovery = recoveryService ?? this.#recoveryService;
    if (!recovery) return;

    recovery.registerCompensator("facilities:maintenance", async (record) => {
      const data = record.recoveryData as Record<string, any> | undefined;
      if (!data || data.type !== "facilities:maintenance") {
        return ok(undefined);
      }
      const recoveryLockOwner = `recovery_${record.transactionId}`;
      if (this.#economyService && data.debitedCosts && Array.isArray(data.debitedCosts)) {
        for (const cost of data.debitedCosts) {
          const refRes = await this.#economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cost.resourceId,
            deltaMinor: cost.amount,
            reason: `Recovery: refund maintenance cost for facility ${data.facilityId}`,
            lockOwner: recoveryLockOwner
          });
          if (!refRes.ok) return refRes;
        }
      }
      return ok(undefined);
    });

    recovery.registerCompensator("facilities:repair", async (record) => {
      const data = record.recoveryData as Record<string, any> | undefined;
      if (!data || data.type !== "facilities:repair") {
        return ok(undefined);
      }
      const recoveryLockOwner = `recovery_${record.transactionId}`;
      if (this.#economyService && data.debitedCosts && Array.isArray(data.debitedCosts)) {
        for (const cost of data.debitedCosts) {
          const refRes = await this.#economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cost.resourceId,
            deltaMinor: cost.amount,
            reason: `Recovery: refund repair cost for facility ${data.facilityId}`,
            lockOwner: recoveryLockOwner
          });
          if (!refRes.ok) return refRes;
        }
      }
      return ok(undefined);
    });
  }
}
