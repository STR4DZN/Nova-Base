import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import type {
  FacilityDefinition,
  FacilityInstance,
  FacilityLifecycle,
  FacilityReadiness
} from "../types/facility-types.js";
import {
  CONDITION_DAMAGED,
  type FacilityCondition,
  type FacilityConditionHistoryEntry,
  type FacilityMaintenanceCost
} from "../types/facility-maintenance-types.js";

export const CANONICAL_MAINTENANCE_PROJECT_ID = "domain-manager:facility-maintenance";
export const DEFAULT_DIRECT_REPAIR_THRESHOLD_PERCENT = 0.5; // Up to 50% integrity repair can be done directly

/**
 * Applies physical/structural damage to a facility (Master Spec §16, DEC-2601-2750 §3.7).
 * Enforces:
 * - "damage não implica ownership change" (preserves domainUuid)
 * - "módulos não são apagados automaticamente por dano" (preserves installedModules)
 * - "damage e repair produzem histórico" (records append-only history)
 */
export function applyFacilityDamage(params: {
  readonly facility: FacilityInstance;
  readonly deltaIntegrity: number;
  readonly condition?: FacilityCondition;
  readonly note?: string;
  readonly tick?: number;
  readonly timestamp?: number;
}): Result<FacilityInstance, PublicError> {
  const { facility, deltaIntegrity } = params;

  if (!Number.isSafeInteger(deltaIntegrity) || deltaIntegrity < 0) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INVALID_DAMAGE",
        category: "validation",
        message: `deltaIntegrity must be a non-negative safe integer: received ${deltaIntegrity}`
      })
    );
  }

  const now = params.timestamp ?? Date.now();
  const tick = params.tick ?? null;

  let updatedIntegrity = facility.integrity ? { ...facility.integrity } : undefined;
  let newLifecycle: FacilityLifecycle = facility.lifecycle;
  let newReadiness: FacilityReadiness = facility.readiness;
  let newReadinessReason: string | null = facility.readinessReason ?? null;

  const newHistory: FacilityConditionHistoryEntry[] = facility.history
    ? [...facility.history]
    : [];

  if (updatedIntegrity) {
    const prevIntegrity = updatedIntegrity.current;
    const newCurrent = Math.max(0, prevIntegrity - deltaIntegrity);
    updatedIntegrity.current = newCurrent;

    newHistory.push({
      id: createOpaqueId("prj"),
      entryType: "damaged",
      timestamp: now,
      tick,
      deltaIntegrity: -(prevIntegrity - newCurrent),
      previousIntegrity: prevIntegrity,
      newIntegrity: newCurrent,
      note: params.note ?? "Facility sustained damage"
    });

    if (newCurrent === 0) {
      // Total loss of integrity degrades or disables facility
      if (facility.lifecycle === "operational") {
        newLifecycle = "degraded";
      }
      newReadiness = "limited";
      newReadinessReason = "Integrity depleted";
    } else if (newCurrent < updatedIntegrity.max * 0.5) {
      if (newReadiness === "ready") {
        newReadiness = "limited";
        newReadinessReason = "Severe structural damage";
      }
    }
  }

  const updatedConditions: FacilityCondition[] = facility.conditions
    ? [...facility.conditions]
    : [];

  if (params.condition) {
    updatedConditions.push(params.condition);
    newHistory.push({
      id: createOpaqueId("prj"),
      entryType: "condition_applied",
      timestamp: now,
      tick,
      conditionId: params.condition.id,
      conditionType: params.condition.type,
      note: `Applied condition '${params.condition.label}'`
    });
  }

  const damagedInstance: FacilityInstance = {
    ...facility,
    // Ownership and modules preserved strictly (Master Spec §16, §3.7)
    domainUuid: facility.domainUuid,
    installedModules: facility.installedModules,
    lifecycle: newLifecycle,
    readiness: newReadiness,
    readinessReason: newReadinessReason,
    integrity: updatedIntegrity ? Object.freeze(updatedIntegrity) : undefined,
    conditions: Object.freeze(updatedConditions),
    history: Object.freeze(newHistory),
    revision: facility.revision + 1,
    updatedAt: now
  };

  return ok(damagedInstance);
}

/**
 * Plan describing direct small repair vs major project repair (Master Spec §3.7).
 */
export interface FacilityRepairPlan {
  readonly planId: string;
  readonly facilityId: string;
  readonly valid: boolean;
  readonly isDirectRepairAllowed: boolean;
  readonly requiresProject: boolean;
  readonly suggestedProjectId?: string;
  readonly repairedIntegrityDelta: number;
  readonly targetIntegrity: number;
  readonly conditionsToClear: readonly string[];
  readonly resourceCosts: readonly FacilityMaintenanceCost[];
  readonly errors?: readonly PublicError[];
}

/**
 * Evaluates a repair plan for a facility (Master Spec §3.7).
 * Small repairs may be executed directly; significant repairs or destroyed facilities require a Project.
 */
export function evaluateFacilityRepairPlan(params: {
  readonly facility: FacilityInstance;
  readonly definition: FacilityDefinition;
  readonly targetIntegrityDelta?: number;
  readonly conditionsToClear?: readonly string[];
  readonly directRepairThresholdPercent?: number;
  readonly costPerIntegrityPoint?: { readonly resourceId: string; readonly amount: number };
  readonly availableBalances?: Readonly<Record<string, number>>;
}): FacilityRepairPlan {
  const { facility, definition, availableBalances } = params;
  const errors: PublicError[] = [];

  // 1. Destroyed check: destroyed facilities CANNOT be repaired directly; requires Project reconstruction
  if (facility.lifecycle === "destroyed") {
    return {
      planId: createOpaqueId("plan"),
      facilityId: facility.id,
      valid: false,
      isDirectRepairAllowed: false,
      requiresProject: true,
      suggestedProjectId: CANONICAL_MAINTENANCE_PROJECT_ID,
      repairedIntegrityDelta: 0,
      targetIntegrity: 0,
      conditionsToClear: Object.freeze([]),
      resourceCosts: Object.freeze([]),
      errors: Object.freeze([
        createPublicError({
          code: "DM_FACILITY_DESTROYED_REQUIRES_PROJECT",
          category: "conflict",
          message: `Facility '${facility.id}' is destroyed and cannot be repaired directly. A Project must be launched.`
        })
      ])
    };
  }

  // 2. Decommissioned check
  if (facility.lifecycle === "decommissioned") {
    errors.push(
      createPublicError({
        code: "DM_FACILITY_DECOMMISSIONED",
        category: "conflict",
        message: `Facility '${facility.id}' is decommissioned and cannot be repaired`
      })
    );
  }

  // 3. Integrity calculations
  let repairedIntegrityDelta = 0;
  let targetIntegrity = 0;
  const maxIntegrity = facility.integrity?.max ?? 100;
  const currentIntegrity = facility.integrity?.current ?? maxIntegrity;

  if (facility.integrity) {
    const missing = maxIntegrity - currentIntegrity;
    if (params.targetIntegrityDelta !== undefined) {
      repairedIntegrityDelta = Math.min(missing, Math.max(0, params.targetIntegrityDelta));
    } else {
      repairedIntegrityDelta = missing;
    }
    targetIntegrity = currentIntegrity + repairedIntegrityDelta;
  }

  // 4. Check policy threshold: small direct repair vs significant repair (Master Spec §3.7)
  const thresholdPercent = params.directRepairThresholdPercent ?? DEFAULT_DIRECT_REPAIR_THRESHOLD_PERCENT;
  const maxDirectDelta = Math.ceil(maxIntegrity * thresholdPercent);

  let isDirectRepairAllowed = true;
  let requiresProject = false;
  let suggestedProjectId: string | undefined;

  // Has critical condition
  const hasCriticalCondition = (facility.conditions ?? []).some((c) => c.severity === "critical");

  if (repairedIntegrityDelta > maxDirectDelta || hasCriticalCondition) {
    isDirectRepairAllowed = false;
    requiresProject = true;
    suggestedProjectId = CANONICAL_MAINTENANCE_PROJECT_ID;
  }

  // 5. Conditions to clear
  const conditionsToClear: string[] = [];
  if (params.conditionsToClear) {
    conditionsToClear.push(...params.conditionsToClear);
  } else if (facility.conditions) {
    // Default clears damaged conditions if full repair
    for (const cond of facility.conditions) {
      if (cond.type === CONDITION_DAMAGED && isDirectRepairAllowed) {
        conditionsToClear.push(cond.id);
      }
    }
  }

  // 6. Costs calculation
  const resourceCosts: FacilityMaintenanceCost[] = [];
  const costUnit = params.costPerIntegrityPoint ?? { resourceId: "domain-manager:materials", amount: 1 };
  if (repairedIntegrityDelta > 0) {
    resourceCosts.push({
      resourceId: costUnit.resourceId,
      amount: repairedIntegrityDelta * costUnit.amount
    });
  }

  // 7. Balance check if balances provided
  if (availableBalances && resourceCosts.length > 0) {
    for (const cost of resourceCosts) {
      const balance = availableBalances[cost.resourceId] ?? 0;
      if (balance < cost.amount) {
        errors.push(
          createPublicError({
            code: "DM_FACILITY_INSUFFICIENT_RESOURCES",
            category: "conflict",
            message: `Insufficient resource '${cost.resourceId}' for repair: required ${cost.amount}, available ${balance}`
          })
        );
      }
    }
  }

  const valid = errors.length === 0;

  return {
    planId: createOpaqueId("plan"),
    facilityId: facility.id,
    valid,
    isDirectRepairAllowed,
    requiresProject,
    suggestedProjectId,
    repairedIntegrityDelta,
    targetIntegrity,
    conditionsToClear: Object.freeze(conditionsToClear),
    resourceCosts: Object.freeze(resourceCosts),
    errors: errors.length > 0 ? Object.freeze(errors) : undefined
  };
}

/**
 * Receipt produced upon committing a direct facility repair (Master Spec §3.7).
 */
export interface FacilityRepairReceipt {
  readonly planId: string;
  readonly facilityId: string;
  readonly timestamp: number;
  readonly tick?: number | null;
  readonly integrityRestored: number;
  readonly newIntegrity: number;
  readonly resourcesConsumed: readonly FacilityMaintenanceCost[];
  readonly conditionsCleared: readonly string[];
  readonly note?: string;
}

/**
 * Commits a small direct repair for a facility.
 * Rejects with DM_FACILITY_REPAIR_REQUIRES_PROJECT if repair is significant or requires a Project.
 */
export function commitFacilityRepair(params: {
  readonly plan: FacilityRepairPlan;
  readonly facility: FacilityInstance;
  readonly currentTick?: number;
  readonly timestamp?: number;
  readonly note?: string;
}): Result<{ readonly updatedFacility: FacilityInstance; readonly receipt: FacilityRepairReceipt }, PublicError> {
  const { plan, facility } = params;

  if (!plan.valid) {
    return err(
      createPublicError({
        code: "DM_FACILITY_REPAIR_PLAN_INVALID",
        category: "validation",
        message: `Cannot commit invalid repair plan '${plan.planId}'`
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

  if (!plan.isDirectRepairAllowed || plan.requiresProject) {
    return err(
      createPublicError({
        code: "DM_FACILITY_REPAIR_REQUIRES_PROJECT",
        category: "conflict",
        message: `Repair requires a Project (suggested: '${plan.suggestedProjectId ?? CANONICAL_MAINTENANCE_PROJECT_ID}'). Direct repair disallowed.`
      })
    );
  }

  const now = params.timestamp ?? Date.now();
  const tick = params.currentTick ?? null;

  // 1. Update integrity
  let updatedIntegrity = facility.integrity ? { ...facility.integrity } : undefined;
  if (updatedIntegrity) {
    updatedIntegrity.current = plan.targetIntegrity;
  }

  // 2. Clear conditions
  const conditionsToClearSet = new Set(plan.conditionsToClear);
  const remainingConditions = (facility.conditions ?? []).filter(
    (c) => !conditionsToClearSet.has(c.id) && !conditionsToClearSet.has(c.type)
  );

  // 3. Build history
  const newHistory: FacilityConditionHistoryEntry[] = facility.history ? [...facility.history] : [];
  for (const condId of plan.conditionsToClear) {
    newHistory.push({
      id: createOpaqueId("prj"),
      entryType: "condition_cleared",
      timestamp: now,
      tick,
      conditionId: condId,
      note: "Cleared on direct facility repair"
    });
  }

  newHistory.push({
    id: createOpaqueId("prj"),
    entryType: "repaired",
    timestamp: now,
    tick,
    deltaIntegrity: plan.repairedIntegrityDelta,
    previousIntegrity: facility.integrity?.current,
    newIntegrity: plan.targetIntegrity,
    note: params.note ?? "Facility direct repair executed"
  });

  // 4. Restore readiness and lifecycle if repaired
  let newLifecycle = facility.lifecycle;
  let newReadiness = facility.readiness;
  let newReadinessReason = facility.readinessReason;

  if (updatedIntegrity && updatedIntegrity.current >= updatedIntegrity.max) {
    if (facility.lifecycle === "degraded") {
      newLifecycle = "operational";
    }
    const hasRemainingBlockingCondition = remainingConditions.some(
      (c) => c.readinessPenalty === "limited" || c.readinessPenalty === "blocked"
    );
    if (!hasRemainingBlockingCondition) {
      newReadiness = "ready";
      newReadinessReason = null;
    }
  }

  const updatedFacility: FacilityInstance = {
    ...facility,
    lifecycle: newLifecycle,
    readiness: newReadiness,
    readinessReason: newReadinessReason,
    integrity: updatedIntegrity ? Object.freeze(updatedIntegrity) : undefined,
    conditions: Object.freeze(remainingConditions),
    history: Object.freeze(newHistory),
    revision: facility.revision + 1,
    updatedAt: now
  };

  const receipt: FacilityRepairReceipt = {
    planId: plan.planId,
    facilityId: facility.id,
    timestamp: now,
    tick,
    integrityRestored: plan.repairedIntegrityDelta,
    newIntegrity: plan.targetIntegrity,
    resourcesConsumed: plan.resourceCosts,
    conditionsCleared: plan.conditionsToClear,
    note: params.note
  };

  return ok({ updatedFacility, receipt });
}
