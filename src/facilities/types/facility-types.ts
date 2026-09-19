import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type {
  FacilityCondition,
  FacilityConditionHistoryEntry,
  FacilityMaintenanceCost,
  FacilityMaintenanceDefinition,
  FacilityMaintenanceState
} from "./facility-maintenance-types.js";
import { validateFacilityCondition } from "./facility-maintenance-types.js";

export * from "./facility-maintenance-types.js";

/**
 * Canonical Facility Lifecycle states (Master Spec §16, DEC-2601-2750 §3.2).
 * Physical/administrative status of the facility.
 */
export type FacilityLifecycle =
  | "planned"
  | "underConstruction"
  | "inactive"
  | "operational"
  | "degraded"
  | "disabled"
  | "decommissioned"
  | "destroyed";

export const FACILITY_LIFECYCLE_STATES: readonly FacilityLifecycle[] = Object.freeze([
  "planned",
  "underConstruction",
  "inactive",
  "operational",
  "degraded",
  "disabled",
  "decommissioned",
  "destroyed"
]);

/**
 * Permitted facility lifecycle transitions (Master Spec Anexo 07 §3.2).
 */
const LEGAL_FACILITY_TRANSITIONS: Readonly<Record<FacilityLifecycle, readonly FacilityLifecycle[]>> = Object.freeze({
  planned: Object.freeze<FacilityLifecycle[]>(["underConstruction", "inactive", "operational", "decommissioned"]),
  underConstruction: Object.freeze<FacilityLifecycle[]>(["operational", "inactive", "disabled", "decommissioned", "destroyed"]),
  inactive: Object.freeze<FacilityLifecycle[]>(["operational", "underConstruction", "degraded", "disabled", "decommissioned", "destroyed"]),
  operational: Object.freeze<FacilityLifecycle[]>(["degraded", "disabled", "inactive", "underConstruction", "decommissioned", "destroyed"]),
  degraded: Object.freeze<FacilityLifecycle[]>(["operational", "disabled", "inactive", "underConstruction", "decommissioned", "destroyed"]),
  disabled: Object.freeze<FacilityLifecycle[]>(["operational", "degraded", "inactive", "underConstruction", "decommissioned", "destroyed"]),
  decommissioned: Object.freeze<FacilityLifecycle[]>(["destroyed", "inactive"]),
  destroyed: Object.freeze<FacilityLifecycle[]>(["underConstruction", "inactive"])
});

/**
 * Validates a proposed lifecycle state transition for a Facility.
 */
export function validateFacilityLifecycleTransition(
  from: FacilityLifecycle,
  to: FacilityLifecycle
): Result<void, PublicError> {
  if (from === to) {
    return ok(undefined);
  }

  const allowed = LEGAL_FACILITY_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INVALID_LIFECYCLE_TRANSITION",
        category: "validation",
        message: `Illegal facility lifecycle transition from '${from}' to '${to}'`
      })
    );
  }

  return ok(undefined);
}

/**
 * Canonical Facility Readiness states (Master Spec §16, DEC-2601-2750 §3.2).
 * Operational capacity / capability readiness (lifecycle ≠ readiness).
 */
export type FacilityReadiness = "ready" | "limited" | "blocked" | "unavailable";

export const FACILITY_READINESS_STATES: readonly FacilityReadiness[] = Object.freeze([
  "ready",
  "limited",
  "blocked",
  "unavailable"
]);

/**
 * Validates a proposed readiness transition for a Facility.
 */
export function validateFacilityReadinessTransition(
  from: FacilityReadiness,
  to: FacilityReadiness
): Result<void, PublicError> {
  if (from === to) {
    return ok(undefined);
  }

  if (!FACILITY_READINESS_STATES.includes(to)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INVALID_READINESS",
        category: "validation",
        message: `Invalid facility readiness state: '${String(to)}'`
      })
    );
  }

  return ok(undefined);
}

export interface FacilityUpgradeDefinition {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly levelRequired?: number;
  readonly capabilitiesGranted?: readonly string[];
  readonly exclusiveWith?: readonly string[];
}

export interface FacilitySlotDefinition {
  readonly id: string;
  readonly label: string;
  readonly allowedModuleTags?: readonly string[];
  readonly maxCapacity?: number;
}

export interface FacilityModuleDefinition {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly capabilitiesGranted?: readonly string[];
  readonly capacityConsumed?: number;
}

export interface FacilityModuleInstance {
  readonly id: string;
  readonly slotId: string;
  readonly definitionId: string;
  readonly name: string;
  readonly active: boolean;
  readonly installedAt: number;
}

/**
 * Reusable Facility template / definition (Master Spec §16, DEC-2601-2750 §3.1).
 */
export interface FacilityDefinition {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly scale?: string;
  readonly maxLevel?: number;
  readonly capabilitiesGranted: readonly string[];
  readonly slots?: readonly FacilitySlotDefinition[];
  readonly upgrades?: readonly FacilityUpgradeDefinition[];
  readonly defaultReadiness?: FacilityReadiness;
  readonly maintenance?: FacilityMaintenanceDefinition;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function isNamespacedFacilityId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value)
  );
}

export function validateFacilityDefinition(raw: unknown): Result<FacilityDefinition, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_DEFINITION_INVALID",
        category: "validation",
        message: "FacilityDefinition must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. ID (namespaced)
  if (!isNamespacedFacilityId(candidate.id)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INVALID_ID",
        category: "validation",
        message: `FacilityDefinition ID must be namespaced (e.g. 'domain-manager:storehouse'): received '${String(candidate.id)}'`
      })
    );
  }

  // 2. Version
  const version = typeof candidate.version === "number" ? candidate.version : 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    return err(
      createPublicError({
        code: "DM_FACILITY_DEFINITION_INVALID",
        category: "validation",
        message: "FacilityDefinition version must be a positive safe integer >= 1"
      })
    );
  }

  // 3. Label
  if (typeof candidate.label !== "string" || candidate.label.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_FACILITY_DEFINITION_INVALID",
        category: "validation",
        message: "FacilityDefinition label is required and must be non-empty"
      })
    );
  }

  // 4. Tags
  if (candidate.tags !== undefined && !Array.isArray(candidate.tags)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_DEFINITION_INVALID",
        category: "validation",
        message: "FacilityDefinition tags must be an array of strings"
      })
    );
  }

  // 5. Capabilities granted
  const capabilitiesGranted: string[] = [];
  if (candidate.capabilitiesGranted !== undefined) {
    if (!Array.isArray(candidate.capabilitiesGranted)) {
      return err(
        createPublicError({
          code: "DM_FACILITY_DEFINITION_INVALID",
          category: "validation",
          message: "FacilityDefinition capabilitiesGranted must be an array of strings"
        })
      );
    }
    for (const cap of candidate.capabilitiesGranted) {
      if (typeof cap !== "string" || !cap.trim()) {
        return err(
          createPublicError({
            code: "DM_FACILITY_DEFINITION_INVALID",
            category: "validation",
            message: "All items in capabilitiesGranted must be non-empty strings"
          })
        );
      }
      capabilitiesGranted.push(cap.trim());
    }
  }

  // 6. Max level
  if (
    candidate.maxLevel !== undefined &&
    (!Number.isSafeInteger(candidate.maxLevel) || (candidate.maxLevel as number) < 1)
  ) {
    return err(
      createPublicError({
        code: "DM_FACILITY_DEFINITION_INVALID",
        category: "validation",
        message: "FacilityDefinition maxLevel must be a positive safe integer >= 1"
      })
    );
  }

  // 7. Default readiness
  const defaultReadiness = candidate.defaultReadiness !== undefined
    ? (candidate.defaultReadiness as FacilityReadiness)
    : "ready";
  if (!FACILITY_READINESS_STATES.includes(defaultReadiness)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INVALID_READINESS",
        category: "validation",
        message: `Invalid defaultReadiness: '${String(candidate.defaultReadiness)}'`
      })
    );
  }

  // 8. Maintenance definition if present
  let maintenance: FacilityMaintenanceDefinition | undefined;
  if (candidate.maintenance !== undefined && candidate.maintenance !== null) {
    if (typeof candidate.maintenance !== "object" || Array.isArray(candidate.maintenance)) {
      return err(
        createPublicError({
          code: "DM_FACILITY_DEFINITION_INVALID",
          category: "validation",
          message: "FacilityDefinition maintenance must be an object"
        })
      );
    }
    const cMaint = candidate.maintenance as Record<string, unknown>;
    if (
      typeof cMaint.intervalTicks !== "number" ||
      !Number.isSafeInteger(cMaint.intervalTicks) ||
      cMaint.intervalTicks < 1
    ) {
      return err(
        createPublicError({
          code: "DM_FACILITY_DEFINITION_INVALID",
          category: "validation",
          message: "FacilityDefinition maintenance intervalTicks must be a positive safe integer >= 1"
        })
      );
    }

    const costs: FacilityMaintenanceCost[] = [];
    if (cMaint.costs !== undefined) {
      if (!Array.isArray(cMaint.costs)) {
        return err(
          createPublicError({
            code: "DM_FACILITY_DEFINITION_INVALID",
            category: "validation",
            message: "FacilityDefinition maintenance costs must be an array"
          })
        );
      }
      for (const cost of cMaint.costs) {
        if (!cost || typeof cost !== "object" || typeof cost.resourceId !== "string" || !cost.resourceId.trim() || typeof cost.amount !== "number" || cost.amount < 1 || !Number.isSafeInteger(cost.amount)) {
          return err(
            createPublicError({
              code: "DM_FACILITY_DEFINITION_INVALID",
              category: "validation",
              message: "FacilityDefinition maintenance cost items must specify resourceId and positive integer amount"
            })
          );
        }
        costs.push({ resourceId: cost.resourceId.trim(), amount: cost.amount });
      }
    }

    maintenance = {
      optional: Boolean(cMaint.optional),
      intervalTicks: cMaint.intervalTicks,
      costs: Object.freeze(costs),
      overduePolicy: typeof cMaint.overduePolicy === "string" ? (cMaint.overduePolicy as any) : undefined,
      channels: cMaint.channels && Array.isArray(cMaint.channels) ? Object.freeze([...(cMaint.channels as any)]) : undefined
    };
  }

  const validated: FacilityDefinition = {
    id: candidate.id.trim(),
    version,
    label: candidate.label.trim(),
    description: typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    category: typeof candidate.category === "string" ? candidate.category.trim() : undefined,
    tags: Object.freeze([...((candidate.tags as string[]) ?? []).map((t) => String(t).trim())]),
    scale: typeof candidate.scale === "string" ? candidate.scale.trim() : undefined,
    maxLevel: typeof candidate.maxLevel === "number" ? candidate.maxLevel : undefined,
    capabilitiesGranted: Object.freeze(capabilitiesGranted),
    slots: candidate.slots && Array.isArray(candidate.slots)
      ? Object.freeze([...(candidate.slots as FacilitySlotDefinition[])])
      : undefined,
    upgrades: candidate.upgrades && Array.isArray(candidate.upgrades)
      ? Object.freeze([...(candidate.upgrades as FacilityUpgradeDefinition[])])
      : undefined,
    defaultReadiness,
    maintenance,
    metadata: candidate.metadata && typeof candidate.metadata === "object"
      ? Object.freeze({ ...(candidate.metadata as Record<string, unknown>) })
      : undefined
  };

  return ok(validated);
}

/**
 * Concrete Facility instance running on a Domain (Master Spec §16, DEC-2601-2750 §3.1).
 */
export interface FacilityInstance {
  readonly id: string;
  readonly domainUuid?: string | null;
  readonly locationRef?: string | null;
  readonly definitionId: string;
  readonly customDefinition?: FacilityDefinition | null;
  readonly name: string;
  readonly description?: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly lifecycle: FacilityLifecycle;
  readonly readiness: FacilityReadiness;
  readonly readinessReason?: string | null;
  readonly level: number;
  readonly installedModules: readonly FacilityModuleInstance[];
  readonly activeUpgrades: readonly string[];
  readonly integrity?: { readonly current: number; readonly max: number };
  readonly conditions?: readonly FacilityCondition[];
  readonly history?: readonly FacilityConditionHistoryEntry[];
  readonly maintenanceState?: FacilityMaintenanceState;
  readonly tags: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function validateFacilityInstance(raw: unknown): Result<FacilityInstance, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INSTANCE_INVALID",
        category: "validation",
        message: "FacilityInstance must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. ID
  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INSTANCE_INVALID",
        category: "validation",
        message: "FacilityInstance id is required and must be non-empty"
      })
    );
  }

  // 2. Definition ID
  if (typeof candidate.definitionId !== "string" || candidate.definitionId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INSTANCE_INVALID",
        category: "validation",
        message: "FacilityInstance definitionId is required and must be non-empty"
      })
    );
  }

  // 3. Name
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INSTANCE_INVALID",
        category: "validation",
        message: "FacilityInstance name is required and must be non-empty"
      })
    );
  }

  // 4. SchemaVersion
  const schemaVersion = typeof candidate.schemaVersion === "number" ? candidate.schemaVersion : 1;
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INSTANCE_INVALID",
        category: "validation",
        message: "FacilityInstance schemaVersion must be a positive safe integer >= 1"
      })
    );
  }

  // 5. Revision
  const revision = typeof candidate.revision === "number" ? candidate.revision : 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INSTANCE_INVALID",
        category: "validation",
        message: "FacilityInstance revision must be a safe integer >= 0"
      })
    );
  }

  // 6. Lifecycle
  if (
    typeof candidate.lifecycle !== "string" ||
    !FACILITY_LIFECYCLE_STATES.includes(candidate.lifecycle as FacilityLifecycle)
  ) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INVALID_LIFECYCLE",
        category: "validation",
        message: `FacilityInstance lifecycle '${String(candidate.lifecycle)}' is invalid`
      })
    );
  }

  // 7. Readiness
  if (
    typeof candidate.readiness !== "string" ||
    !FACILITY_READINESS_STATES.includes(candidate.readiness as FacilityReadiness)
  ) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INVALID_READINESS",
        category: "validation",
        message: `FacilityInstance readiness '${String(candidate.readiness)}' is invalid`
      })
    );
  }

  // 8. Level
  const level = typeof candidate.level === "number" ? candidate.level : 1;
  if (!Number.isSafeInteger(level) || level < 1) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INSTANCE_INVALID",
        category: "validation",
        message: "FacilityInstance level must be a positive safe integer >= 1"
      })
    );
  }

  // 9. Integrity if present
  let integrity: { readonly current: number; readonly max: number } | undefined;
  if (candidate.integrity !== undefined && candidate.integrity !== null) {
    if (typeof candidate.integrity !== "object") {
      return err(
        createPublicError({
          code: "DM_FACILITY_INSTANCE_INVALID",
          category: "validation",
          message: "FacilityInstance integrity must be an object { current, max }"
        })
      );
    }
    const cInteg = candidate.integrity as Record<string, unknown>;
    if (
      typeof cInteg.current !== "number" ||
      !Number.isSafeInteger(cInteg.current) ||
      typeof cInteg.max !== "number" ||
      !Number.isSafeInteger(cInteg.max) ||
      cInteg.max < 1 ||
      cInteg.current < 0 ||
      cInteg.current > cInteg.max
    ) {
      return err(
        createPublicError({
          code: "DM_FACILITY_INTEGRITY_INVALID",
          category: "validation",
          message: "FacilityInstance integrity values must be safe integers with 0 <= current <= max and max >= 1"
        })
      );
    }
    integrity = Object.freeze({ current: cInteg.current, max: cInteg.max });
  }

  // 10. Conditions if present
  let conditions: readonly FacilityCondition[] | undefined;
  if (candidate.conditions !== undefined && candidate.conditions !== null) {
    if (!Array.isArray(candidate.conditions)) {
      return err(
        createPublicError({
          code: "DM_FACILITY_INSTANCE_INVALID",
          category: "validation",
          message: "FacilityInstance conditions must be an array"
        })
      );
    }
    const validatedConditions: FacilityCondition[] = [];
    for (const cond of candidate.conditions) {
      const vCond = validateFacilityCondition(cond);
      if (!vCond.ok) {
        return err(vCond.error);
      }
      validatedConditions.push(vCond.value);
    }
    conditions = Object.freeze(validatedConditions);
  }

  // 11. History if present
  let history: readonly FacilityConditionHistoryEntry[] | undefined;
  if (candidate.history !== undefined && candidate.history !== null) {
    if (!Array.isArray(candidate.history)) {
      return err(
        createPublicError({
          code: "DM_FACILITY_INSTANCE_INVALID",
          category: "validation",
          message: "FacilityInstance history must be an array"
        })
      );
    }
    history = Object.freeze([...(candidate.history as FacilityConditionHistoryEntry[])]);
  }

  // 12. Maintenance state if present
  let maintenanceState: FacilityMaintenanceState | undefined;
  if (candidate.maintenanceState !== undefined && candidate.maintenanceState !== null) {
    if (typeof candidate.maintenanceState !== "object" || Array.isArray(candidate.maintenanceState)) {
      return err(
        createPublicError({
          code: "DM_FACILITY_INSTANCE_INVALID",
          category: "validation",
          message: "FacilityInstance maintenanceState must be an object"
        })
      );
    }
    const cMState = candidate.maintenanceState as Record<string, unknown>;
    if (
      typeof cMState.status !== "string" ||
      !["current", "due", "overdue", "exempt"].includes(cMState.status)
    ) {
      return err(
        createPublicError({
          code: "DM_FACILITY_INSTANCE_INVALID",
          category: "validation",
          message: `Invalid maintenanceState status: '${String(cMState.status)}'`
        })
      );
    }
    maintenanceState = {
      status: cMState.status as any,
      lastMaintainedTick: typeof cMState.lastMaintainedTick === "number" ? cMState.lastMaintainedTick : null,
      lastMaintainedTimestamp: typeof cMState.lastMaintainedTimestamp === "number" ? cMState.lastMaintainedTimestamp : null,
      overdueTicks: typeof cMState.overdueTicks === "number" ? cMState.overdueTicks : 0,
      accumulatedTicks: typeof cMState.accumulatedTicks === "number" ? cMState.accumulatedTicks : 0,
      channels: cMState.channels && typeof cMState.channels === "object" ? Object.freeze({ ...(cMState.channels as any) }) : undefined
    };
  }

  // 13. Timestamps
  const createdAt = typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now();
  const updatedAt = typeof candidate.updatedAt === "number" ? candidate.updatedAt : createdAt;

  const instance: FacilityInstance = {
    id: candidate.id.trim(),
    domainUuid: typeof candidate.domainUuid === "string" ? candidate.domainUuid.trim() : null,
    locationRef: typeof candidate.locationRef === "string" ? candidate.locationRef.trim() : null,
    definitionId: candidate.definitionId.trim(),
    customDefinition: candidate.customDefinition ? (candidate.customDefinition as FacilityDefinition) : null,
    name: candidate.name.trim(),
    description: typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    schemaVersion,
    revision,
    lifecycle: candidate.lifecycle as FacilityLifecycle,
    readiness: candidate.readiness as FacilityReadiness,
    readinessReason: typeof candidate.readinessReason === "string" ? candidate.readinessReason.trim() : null,
    level,
    installedModules: candidate.installedModules && Array.isArray(candidate.installedModules)
      ? Object.freeze([...(candidate.installedModules as FacilityModuleInstance[])])
      : Object.freeze([]),
    activeUpgrades: candidate.activeUpgrades && Array.isArray(candidate.activeUpgrades)
      ? Object.freeze([...(candidate.activeUpgrades as string[]).map((u) => String(u).trim())])
      : Object.freeze([]),
    integrity,
    conditions,
    history,
    maintenanceState,
    tags: Object.freeze([...((candidate.tags as string[]) ?? []).map((t) => String(t).trim())]),
    createdAt,
    updatedAt,
    metadata: candidate.metadata && typeof candidate.metadata === "object"
      ? Object.freeze({ ...(candidate.metadata as Record<string, unknown>) })
      : undefined
  };

  return ok(instance);
}

/**
 * Pure calculation of effective capabilities granted by a facility to a domain (Master Spec §16, DEC-2601-2750 §3.2, §3.8).
 * Enforces: Facility lifecycle ≠ readiness.
 * - Under construction, planned, inactive, disabled, decommissioned, or destroyed facilities provide NO capabilities.
 * - Facilities with readiness 'blocked' or 'unavailable' provide NO capabilities.
 * - Operational or degraded facilities with readiness 'ready' or 'limited' provide base capabilities,
 *   plus active upgrades and active modules capabilities.
 * - Conditions may suppress specific capabilities or impose readiness penalties (Master Spec §3.7).
 */
export function calculateFacilityEffectiveCapabilities(
  facility: FacilityInstance,
  definitionOrCapabilities: FacilityDefinition | readonly string[]
): readonly string[] {
  // 1. Lifecycle filter: only operational or degraded provide capabilities
  if (facility.lifecycle !== "operational" && facility.lifecycle !== "degraded") {
    return Object.freeze([]);
  }

  // 2. Readiness filter: blocked or unavailable provide NO capabilities
  if (facility.readiness === "blocked" || facility.readiness === "unavailable") {
    return Object.freeze([]);
  }

  // 3. Condition readiness penalty: if any active condition imposes blocked or unavailable, provide NO capabilities
  if (facility.conditions && facility.conditions.length > 0) {
    for (const cond of facility.conditions) {
      if (cond.readinessPenalty === "blocked" || cond.readinessPenalty === "unavailable") {
        return Object.freeze([]);
      }
    }
  }

  const caps = new Set<string>();

  if ("capabilitiesGranted" in definitionOrCapabilities) {
    for (const cap of definitionOrCapabilities.capabilitiesGranted) {
      caps.add(cap);
    }

    // Upgrades capabilities
    if (definitionOrCapabilities.upgrades) {
      const activeUpgradeSet = new Set(facility.activeUpgrades);
      for (const upg of definitionOrCapabilities.upgrades) {
        if (activeUpgradeSet.has(upg.id) && upg.capabilitiesGranted) {
          for (const cap of upg.capabilitiesGranted) {
            caps.add(cap);
          }
        }
      }
    }
  } else {
    for (const cap of definitionOrCapabilities) {
      caps.add(cap);
    }
  }

  // 4. Suppress capabilities from active conditions (Master Spec §3.7: "Dano pode atingir capabilities/módulos específicos")
  if (facility.conditions && facility.conditions.length > 0) {
    for (const cond of facility.conditions) {
      if (cond.suppressedCapabilities) {
        for (const suppressed of cond.suppressedCapabilities) {
          caps.delete(suppressed);
        }
      }
    }
  }

  return Object.freeze(Array.from(caps));
}
