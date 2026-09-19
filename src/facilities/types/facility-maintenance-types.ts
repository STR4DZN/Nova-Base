import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { FacilityReadiness } from "./facility-types.js";

/**
 * Canonical Condition Identifiers (Master Spec §16, DEC-2601-2750 §3.6, §3.7).
 */
export const CONDITION_MAINTENANCE_DUE = "domain-manager:maintenance-due";
export const CONDITION_DAMAGED = "domain-manager:damaged";
export const CONDITION_NEGLECTED = "domain-manager:neglected";

export type FacilityConditionSeverity = "minor" | "moderate" | "major" | "critical";

export const FACILITY_CONDITION_SEVERITIES: readonly FacilityConditionSeverity[] = Object.freeze([
  "minor",
  "moderate",
  "major",
  "critical"
]);

/**
 * Generic, namespaced condition affecting a Facility instance (Master Spec §3.7).
 */
export interface FacilityCondition {
  readonly id: string;
  readonly type: string; // namespaced, e.g. "domain-manager:maintenance-due"
  readonly label: string;
  readonly severity: FacilityConditionSeverity;
  readonly description?: string;
  readonly appliedAtTick?: number | null;
  readonly appliedAtTimestamp?: number;
  readonly durationTicks?: number | null; // null/undefined means indefinite until repaired/cleared
  readonly suppressedCapabilities?: readonly string[];
  readonly readinessPenalty?: FacilityReadiness;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function isNamespacedConditionType(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value)
  );
}

export function validateFacilityCondition(raw: unknown): Result<FacilityCondition, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_CONDITION_INVALID",
        category: "validation",
        message: "FacilityCondition must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_FACILITY_CONDITION_INVALID",
        category: "validation",
        message: "FacilityCondition id is required and must be non-empty"
      })
    );
  }

  if (!isNamespacedConditionType(candidate.type)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_CONDITION_INVALID",
        category: "validation",
        message: `FacilityCondition type must be namespaced: received '${String(candidate.type)}'`
      })
    );
  }

  if (typeof candidate.label !== "string" || candidate.label.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_FACILITY_CONDITION_INVALID",
        category: "validation",
        message: "FacilityCondition label is required and must be non-empty"
      })
    );
  }

  if (
    typeof candidate.severity !== "string" ||
    !FACILITY_CONDITION_SEVERITIES.includes(candidate.severity as FacilityConditionSeverity)
  ) {
    return err(
      createPublicError({
        code: "DM_FACILITY_CONDITION_INVALID",
        category: "validation",
        message: `Invalid condition severity: '${String(candidate.severity)}'`
      })
    );
  }

  let durationTicks: number | null = null;
  if (candidate.durationTicks !== undefined && candidate.durationTicks !== null) {
    if (
      typeof candidate.durationTicks !== "number" ||
      !Number.isSafeInteger(candidate.durationTicks) ||
      candidate.durationTicks < 0
    ) {
      return err(
        createPublicError({
          code: "DM_FACILITY_CONDITION_INVALID",
          category: "validation",
          message: "FacilityCondition durationTicks must be a non-negative safe integer or null"
        })
      );
    }
    durationTicks = candidate.durationTicks;
  }

  const suppressedCapabilities: string[] = [];
  if (candidate.suppressedCapabilities !== undefined) {
    if (!Array.isArray(candidate.suppressedCapabilities)) {
      return err(
        createPublicError({
          code: "DM_FACILITY_CONDITION_INVALID",
          category: "validation",
          message: "suppressedCapabilities must be an array of strings"
        })
      );
    }
    for (const cap of candidate.suppressedCapabilities) {
      if (typeof cap !== "string" || !cap.trim()) {
        return err(
          createPublicError({
            code: "DM_FACILITY_CONDITION_INVALID",
            category: "validation",
            message: "All items in suppressedCapabilities must be non-empty strings"
          })
        );
      }
      suppressedCapabilities.push(cap.trim());
    }
  }

  const validated: FacilityCondition = {
    id: candidate.id.trim(),
    type: candidate.type.trim(),
    label: candidate.label.trim(),
    severity: candidate.severity as FacilityConditionSeverity,
    description: typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    appliedAtTick: typeof candidate.appliedAtTick === "number" ? candidate.appliedAtTick : null,
    appliedAtTimestamp: typeof candidate.appliedAtTimestamp === "number" ? candidate.appliedAtTimestamp : Date.now(),
    durationTicks,
    suppressedCapabilities: Object.freeze(suppressedCapabilities),
    readinessPenalty: typeof candidate.readinessPenalty === "string" ? (candidate.readinessPenalty as FacilityReadiness) : undefined,
    metadata: candidate.metadata && typeof candidate.metadata === "object"
      ? Object.freeze({ ...(candidate.metadata as Record<string, unknown>) })
      : undefined
  };

  return ok(validated);
}

/**
 * Canonical entry type for damage/repair/maintenance/condition history (Master Spec §3.7).
 */
export type FacilityConditionHistoryEntryType =
  | "condition_applied"
  | "condition_removed"
  | "condition_cleared"
  | "damaged"
  | "repaired"
  | "maintained";

export interface FacilityConditionHistoryEntry {
  readonly id: string;
  readonly entryType: FacilityConditionHistoryEntryType;
  readonly timestamp: number;
  readonly tick?: number | null;
  readonly conditionId?: string;
  readonly conditionType?: string;
  readonly deltaIntegrity?: number;
  readonly previousIntegrity?: number;
  readonly newIntegrity?: number;
  readonly note?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Canonical Facility Maintenance status states.
 * Note: 'maintenanceDue' is an operational condition, NOT a lifecycle state (Master Spec §3.6).
 */
export type FacilityMaintenanceStatus = "current" | "due" | "overdue" | "exempt";

export const FACILITY_MAINTENANCE_STATUSES: readonly FacilityMaintenanceStatus[] = Object.freeze([
  "current",
  "due",
  "overdue",
  "exempt"
]);

/**
 * Policy applied when maintenance interval is exceeded and overdue.
 */
export type FacilityOverduePolicy =
  | "flag_due"
  | "degrade_readiness"
  | "apply_condition"
  | "degrade_integrity";

export interface FacilityMaintenanceCost {
  readonly resourceId: string;
  readonly amount: number;
}

export interface FacilityMaintenanceChannelDefinition {
  readonly id: string;
  readonly label: string;
  readonly intervalTicks: number;
  readonly costs: readonly FacilityMaintenanceCost[];
  readonly overduePolicy?: FacilityOverduePolicy;
}

/**
 * Maintenance requirements defined on a FacilityDefinition (Master Spec §3.6).
 * Optional per definition.
 */
export interface FacilityMaintenanceDefinition {
  readonly optional?: boolean;
  readonly intervalTicks: number;
  readonly costs?: readonly FacilityMaintenanceCost[];
  readonly overduePolicy?: FacilityOverduePolicy;
  readonly channels?: readonly FacilityMaintenanceChannelDefinition[];
}

/**
 * Concrete maintenance state tracked on a FacilityInstance.
 */
export interface FacilityMaintenanceState {
  readonly status: FacilityMaintenanceStatus;
  readonly lastMaintainedTick?: number | null;
  readonly lastMaintainedTimestamp?: number | null;
  readonly overdueTicks: number;
  readonly accumulatedTicks: number;
  readonly channels?: Readonly<Record<string, {
    readonly lastMaintainedTick?: number | null;
    readonly overdueTicks: number;
  }>>;
}
