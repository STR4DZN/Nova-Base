import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import type {
  FacilityDefinition,
  FacilityInstance,
  FacilityReadiness
} from "../types/facility-types.js";
import {
  CONDITION_MAINTENANCE_DUE,
  type FacilityCondition,
  type FacilityConditionHistoryEntry,
  type FacilityMaintenanceCost,
  type FacilityMaintenanceState,
  type FacilityMaintenanceStatus
} from "../types/facility-maintenance-types.js";

/**
 * Result of advancing abstract time/ticks on a facility's maintenance lifecycle.
 * Time-agnostic scheduling contract (Master Spec §16, DEC-2601-2750 §3.6).
 */
export function advanceFacilityMaintenanceTicks(params: {
  readonly facility: FacilityInstance;
  readonly definition: FacilityDefinition;
  readonly deltaTicks: number;
  readonly currentTick?: number;
  readonly timestamp?: number;
}): Result<FacilityInstance, PublicError> {
  const { facility, definition, deltaTicks } = params;

  if (!Number.isSafeInteger(deltaTicks) || deltaTicks < 0) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INVALID_TICKS",
        category: "validation",
        message: `deltaTicks must be a non-negative safe integer: received ${deltaTicks}`
      })
    );
  }

  const now = params.timestamp ?? Date.now();
  const currentTick = params.currentTick ?? null;

  // 1. Tick conditions (expiration check)
  const updatedConditions: FacilityCondition[] = [];
  const newHistoryEntries: FacilityConditionHistoryEntry[] = facility.history
    ? [...facility.history]
    : [];

  if (facility.conditions && facility.conditions.length > 0) {
    for (const cond of facility.conditions) {
      if (cond.durationTicks !== null && cond.durationTicks !== undefined) {
        const remainingTicks = cond.durationTicks - deltaTicks;
        if (remainingTicks <= 0) {
          // Condition expired and is cleared
          newHistoryEntries.push({
            id: createOpaqueId("prj"),
            entryType: "condition_cleared",
            timestamp: now,
            tick: currentTick,
            conditionId: cond.id,
            conditionType: cond.type,
            note: `Condition '${cond.label}' expired after duration elapsed.`
          });
        } else {
          updatedConditions.push({
            ...cond,
            durationTicks: remainingTicks
          });
        }
      } else {
        updatedConditions.push(cond);
      }
    }
  }

  // 2. Evaluate maintenance ticks if maintenance is defined
  let newMaintenanceState: FacilityMaintenanceState | undefined = facility.maintenanceState;
  let newReadiness: FacilityReadiness = facility.readiness;
  let newReadinessReason: string | null = facility.readinessReason ?? null;
  let newIntegrity = facility.integrity ? { ...facility.integrity } : undefined;

  if (definition.maintenance) {
    const prevAccumulated = facility.maintenanceState?.accumulatedTicks ?? 0;
    const accumulatedTicks = prevAccumulated + deltaTicks;
    const interval = definition.maintenance.intervalTicks;

    let status: FacilityMaintenanceStatus = "current";
    let overdueTicks = 0;

    if (accumulatedTicks >= interval) {
      overdueTicks = accumulatedTicks - interval;
      status = overdueTicks > 0 ? "overdue" : "due";

      const policy = definition.maintenance.overduePolicy ?? "flag_due";

      if (policy === "apply_condition") {
        const hasDueCondition = updatedConditions.some((c) => c.type === CONDITION_MAINTENANCE_DUE);
        if (!hasDueCondition) {
          const conditionId = createOpaqueId("prj");
          const dueCondition: FacilityCondition = {
            id: conditionId,
            type: CONDITION_MAINTENANCE_DUE,
            label: "Maintenance Due",
            severity: overdueTicks > interval ? "moderate" : "minor",
            description: `Scheduled maintenance is overdue by ${overdueTicks} ticks.`,
            appliedAtTick: currentTick,
            appliedAtTimestamp: now,
            readinessPenalty: overdueTicks > interval * 2 ? "limited" : undefined
          };
          updatedConditions.push(dueCondition);
          newHistoryEntries.push({
            id: createOpaqueId("prj"),
            entryType: "condition_applied",
            timestamp: now,
            tick: currentTick,
            conditionId,
            conditionType: CONDITION_MAINTENANCE_DUE,
            note: `Maintenance overdue policy applied condition '${dueCondition.label}'`
          });
        }
      } else if (policy === "degrade_readiness") {
        if (newReadiness === "ready") {
          newReadiness = "limited";
          newReadinessReason = "Maintenance overdue";
        } else if (newReadiness === "limited" && overdueTicks > interval * 2) {
          newReadiness = "blocked";
          newReadinessReason = "Maintenance critically overdue";
        }
      } else if (policy === "degrade_integrity") {
        if (newIntegrity && newIntegrity.current > 0) {
          const degradeAmount = Math.max(1, Math.floor(overdueTicks / interval));
          const prev = newIntegrity.current;
          newIntegrity.current = Math.max(0, newIntegrity.current - degradeAmount);
          if (prev !== newIntegrity.current) {
            newHistoryEntries.push({
              id: createOpaqueId("prj"),
              entryType: "damaged",
              timestamp: now,
              tick: currentTick,
              deltaIntegrity: -(prev - newIntegrity.current),
              previousIntegrity: prev,
              newIntegrity: newIntegrity.current,
              note: "Integrity degraded due to overdue maintenance"
            });
          }
        }
      }
    }

    newMaintenanceState = {
      status,
      lastMaintainedTick: facility.maintenanceState?.lastMaintainedTick ?? null,
      lastMaintainedTimestamp: facility.maintenanceState?.lastMaintainedTimestamp ?? null,
      accumulatedTicks,
      overdueTicks,
      channels: facility.maintenanceState?.channels
    };
  }

  const updatedInstance: FacilityInstance = {
    ...facility,
    readiness: newReadiness,
    readinessReason: newReadinessReason,
    integrity: newIntegrity ? Object.freeze(newIntegrity) : undefined,
    conditions: Object.freeze(updatedConditions),
    history: Object.freeze(newHistoryEntries),
    maintenanceState: newMaintenanceState,
    revision: facility.revision + 1,
    updatedAt: now
  };

  return ok(updatedInstance);
}

/**
 * Plan describing scheduled or routine facility maintenance (Master Spec §3.6).
 */
export interface FacilityMaintenancePlan {
  readonly planId: string;
  readonly facilityId: string;
  readonly channelId?: string;
  readonly valid: boolean;
  readonly canAfford: boolean;
  readonly resourceCosts: readonly FacilityMaintenanceCost[];
  readonly plannedStatus: FacilityMaintenanceStatus;
  readonly conditionsToClear: readonly string[];
  readonly readinessRestoration?: FacilityReadiness;
  readonly errors?: readonly PublicError[];
}

/**
 * Pure evaluation of a FacilityMaintenancePlan before committing (plan → commit).
 */
export function evaluateFacilityMaintenancePlan(params: {
  readonly facility: FacilityInstance;
  readonly definition: FacilityDefinition;
  readonly currentTick?: number;
  readonly channelId?: string;
  readonly availableBalances?: Readonly<Record<string, number>>;
}): FacilityMaintenancePlan {
  const { facility, definition, channelId, availableBalances } = params;
  const errors: PublicError[] = [];

  // 1. Eligibility: destroyed or decommissioned facilities cannot undergo routine maintenance
  if (facility.lifecycle === "destroyed" || facility.lifecycle === "decommissioned") {
    errors.push(
      createPublicError({
        code: "DM_FACILITY_NOT_MAINTAINABLE",
        category: "conflict",
        message: `Facility '${facility.id}' in lifecycle '${facility.lifecycle}' cannot undergo maintenance`
      })
    );
  }

  // 2. Definition maintenance check
  if (!definition.maintenance) {
    errors.push(
      createPublicError({
        code: "DM_FACILITY_NO_MAINTENANCE_REQUIRED",
        category: "validation",
        message: `Facility definition '${definition.id}' does not require maintenance`
      })
    );
  }

  // 3. Resolve costs
  const costs: FacilityMaintenanceCost[] = [];
  if (channelId && definition.maintenance?.channels) {
    const channel = definition.maintenance.channels.find((c) => c.id === channelId);
    if (!channel) {
      errors.push(
        createPublicError({
          code: "DM_FACILITY_CHANNEL_NOT_FOUND",
          category: "not-found",
          message: `Maintenance channel '${channelId}' not found on definition '${definition.id}'`
        })
      );
    } else {
      costs.push(...channel.costs);
    }
  } else if (definition.maintenance?.costs) {
    costs.push(...definition.maintenance.costs);
  }

  // 4. Resource affordability check
  let canAfford = true;
  if (availableBalances && costs.length > 0) {
    for (const cost of costs) {
      const balance = availableBalances[cost.resourceId] ?? 0;
      if (balance < cost.amount) {
        canAfford = false;
        errors.push(
          createPublicError({
            code: "DM_FACILITY_INSUFFICIENT_RESOURCES",
            category: "conflict",
            message: `Insufficient resource '${cost.resourceId}' for maintenance: required ${cost.amount}, available ${balance}`
          })
        );
      }
    }
  }

  // 5. Conditions to clear (maintenance-due conditions)
  const conditionsToClear: string[] = [];
  if (facility.conditions) {
    for (const cond of facility.conditions) {
      if (cond.type === CONDITION_MAINTENANCE_DUE) {
        conditionsToClear.push(cond.id);
      }
    }
  }

  // 6. Readiness restoration if limited due to maintenance
  let readinessRestoration: FacilityReadiness | undefined;
  if (facility.readiness === "limited" && (facility.readinessReason?.includes("Maintenance") || conditionsToClear.length > 0)) {
    readinessRestoration = "ready";
  }

  const valid = errors.length === 0;

  return {
    planId: createOpaqueId("plan"),
    facilityId: facility.id,
    channelId,
    valid,
    canAfford,
    resourceCosts: Object.freeze(costs),
    plannedStatus: "current",
    conditionsToClear: Object.freeze(conditionsToClear),
    readinessRestoration,
    errors: errors.length > 0 ? Object.freeze(errors) : undefined
  };
}

/**
 * Receipt produced upon committing a facility maintenance plan (Master Spec §3.6).
 */
export interface FacilityMaintenanceReceipt {
  readonly planId: string;
  readonly facilityId: string;
  readonly channelId?: string;
  readonly timestamp: number;
  readonly tick?: number | null;
  readonly resourcesConsumed: readonly FacilityMaintenanceCost[];
  readonly conditionsCleared: readonly string[];
  readonly newStatus: FacilityMaintenanceStatus;
  readonly note?: string;
}

/**
 * Commits an evaluated FacilityMaintenancePlan to update the facility's state.
 */
export function commitFacilityMaintenance(params: {
  readonly plan: FacilityMaintenancePlan;
  readonly facility: FacilityInstance;
  readonly currentTick?: number;
  readonly timestamp?: number;
  readonly note?: string;
}): Result<{ readonly updatedFacility: FacilityInstance; readonly receipt: FacilityMaintenanceReceipt }, PublicError> {
  const { plan, facility } = params;

  if (!plan.valid) {
    return err(
      createPublicError({
        code: "DM_FACILITY_MAINTENANCE_PLAN_INVALID",
        category: "validation",
        message: `Cannot commit invalid maintenance plan '${plan.planId}'`
      })
    );
  }

  if (plan.facilityId !== facility.id) {
    return err(
      createPublicError({
        code: "DM_FACILITY_ID_MISMATCH",
        category: "conflict",
        message: `Plan facilityId '${plan.facilityId}' does not match facility '${facility.id}'`
      })
    );
  }

  const now = params.timestamp ?? Date.now();
  const currentTick = params.currentTick ?? null;

  // Filter cleared conditions
  const conditionsToClearSet = new Set(plan.conditionsToClear);
  const remainingConditions = (facility.conditions ?? []).filter(
    (c) => !conditionsToClearSet.has(c.id) && !conditionsToClearSet.has(c.type)
  );

  // Build history entries
  const newHistory: FacilityConditionHistoryEntry[] = facility.history ? [...facility.history] : [];
  for (const condId of plan.conditionsToClear) {
    newHistory.push({
      id: createOpaqueId("prj"),
      entryType: "condition_cleared",
      timestamp: now,
      tick: currentTick,
      conditionId: condId,
      conditionType: CONDITION_MAINTENANCE_DUE,
      note: "Cleared on scheduled maintenance completion"
    });
  }

  newHistory.push({
    id: createOpaqueId("prj"),
    entryType: "maintained",
    timestamp: now,
    tick: currentTick,
    note: params.note ?? "Facility routine maintenance executed"
  });

  // Reset maintenance state
  const updatedMaintenanceState: FacilityMaintenanceState = {
    status: "current",
    lastMaintainedTick: currentTick ?? facility.maintenanceState?.lastMaintainedTick ?? 0,
    lastMaintainedTimestamp: now,
    accumulatedTicks: 0,
    overdueTicks: 0,
    channels: facility.maintenanceState?.channels
  };

  const updatedFacility: FacilityInstance = {
    ...facility,
    readiness: plan.readinessRestoration ?? facility.readiness,
    readinessReason: plan.readinessRestoration ? null : facility.readinessReason,
    conditions: Object.freeze(remainingConditions),
    history: Object.freeze(newHistory),
    maintenanceState: updatedMaintenanceState,
    revision: facility.revision + 1,
    updatedAt: now
  };

  const receipt: FacilityMaintenanceReceipt = {
    planId: plan.planId,
    facilityId: facility.id,
    channelId: plan.channelId,
    timestamp: now,
    tick: currentTick,
    resourcesConsumed: plan.resourceCosts,
    conditionsCleared: plan.conditionsToClear,
    newStatus: "current",
    note: params.note
  };

  return ok({ updatedFacility, receipt });
}

/**
 * Aggregated preview for batch facility maintenance (Master Spec §3.6).
 */
export interface BatchFacilityMaintenancePlan {
  readonly individualPlans: readonly FacilityMaintenancePlan[];
  readonly aggregatedCosts: readonly FacilityMaintenanceCost[];
  readonly allValid: boolean;
  readonly eligibleFacilityCount: number;
  readonly ineligibleFacilityCount: number;
}

/**
 * Evaluates batch maintenance across multiple facilities.
 */
export function evaluateBatchFacilityMaintenancePlan(params: {
  readonly items: readonly {
    readonly facility: FacilityInstance;
    readonly definition: FacilityDefinition;
    readonly channelId?: string;
  }[];
  readonly totalAvailableBalances?: Readonly<Record<string, number>>;
  readonly currentTick?: number;
}): BatchFacilityMaintenancePlan {
  const individualPlans: FacilityMaintenancePlan[] = [];
  const costMap = new Map<string, number>();

  let eligibleCount = 0;
  let ineligibleCount = 0;

  for (const item of params.items) {
    const plan = evaluateFacilityMaintenancePlan({
      facility: item.facility,
      definition: item.definition,
      currentTick: params.currentTick,
      channelId: item.channelId
    });

    individualPlans.push(plan);
    if (plan.valid) {
      eligibleCount++;
      for (const cost of plan.resourceCosts) {
        const current = costMap.get(cost.resourceId) ?? 0;
        costMap.set(cost.resourceId, current + cost.amount);
      }
    } else {
      ineligibleCount++;
    }
  }

  const aggregatedCosts: FacilityMaintenanceCost[] = [];
  for (const [resourceId, amount] of costMap.entries()) {
    aggregatedCosts.push({ resourceId, amount });
  }

  let allValid = ineligibleCount === 0;
  if (params.totalAvailableBalances) {
    for (const cost of aggregatedCosts) {
      const balance = params.totalAvailableBalances[cost.resourceId] ?? 0;
      if (balance < cost.amount) {
        allValid = false;
        break;
      }
    }
  }

  return {
    individualPlans: Object.freeze(individualPlans),
    aggregatedCosts: Object.freeze(aggregatedCosts),
    allValid,
    eligibleFacilityCount: eligibleCount,
    ineligibleFacilityCount: ineligibleCount
  };
}

/**
 * Commits a batch maintenance plan.
 */
export function commitBatchFacilityMaintenance(params: {
  readonly batchPlan: BatchFacilityMaintenancePlan;
  readonly facilities: readonly FacilityInstance[];
  readonly currentTick?: number;
  readonly timestamp?: number;
}): Result<{ readonly updatedFacilities: readonly FacilityInstance[]; readonly receipts: readonly FacilityMaintenanceReceipt[] }, PublicError> {
  const facilityMap = new Map(params.facilities.map((f) => [f.id, f]));
  const updatedFacilities: FacilityInstance[] = [];
  const receipts: FacilityMaintenanceReceipt[] = [];

  for (const plan of params.batchPlan.individualPlans) {
    if (!plan.valid) continue;
    const facility = facilityMap.get(plan.facilityId);
    if (!facility) {
      return err(
        createPublicError({
          code: "DM_FACILITY_NOT_FOUND",
          category: "not-found",
          message: `Facility '${plan.facilityId}' from batch plan not found in facilities list`
        })
      );
    }

    const commitRes = commitFacilityMaintenance({
      plan,
      facility,
      currentTick: params.currentTick,
      timestamp: params.timestamp
    });

    if (!commitRes.ok) {
      return err(commitRes.error);
    }

    updatedFacilities.push(commitRes.value.updatedFacility);
    receipts.push(commitRes.value.receipt);
  }

  return ok({
    updatedFacilities: Object.freeze(updatedFacilities),
    receipts: Object.freeze(receipts)
  });
}
