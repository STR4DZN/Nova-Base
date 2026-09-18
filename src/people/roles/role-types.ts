import { createPublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { isOpaqueId } from "../../core/identity/ids.js";

export type RoleVisibility = "public" | "restricted" | "secret";
export const ROLE_VISIBILITIES: readonly RoleVisibility[] = Object.freeze([
  "public",
  "restricted",
  "secret"
]);

export function isRoleVisibility(value: unknown): value is RoleVisibility {
  return typeof value === "string" && ROLE_VISIBILITIES.includes(value as RoleVisibility);
}

export interface RoleOccupancyRule {
  readonly min: number;
  readonly max: number | null;
}

export interface RoleDefinition {
  readonly id: string; // namespaced e.g. "domain-manager:leader" or "custom:steward"
  readonly version: number;
  readonly label: string;
  readonly description?: string;
  readonly occupancy: RoleOccupancyRule;
  readonly grants?: readonly string[];
  readonly prerequisites?: readonly string[];
}

export interface DomainRole {
  readonly id: string; // role_<UUID>
  readonly definitionId: string;
  readonly customLabel?: string;
  readonly occupants: readonly string[]; // notable IDs (not_<UUID>)
  readonly visibility: RoleVisibility;
  readonly notes?: string;
  readonly tags: readonly string[];
}

export interface RoleEvaluation {
  readonly role: DomainRole;
  readonly definition?: RoleDefinition;
  readonly effectiveLabel: string;
  readonly isVacant: boolean;
  readonly isFilled: boolean;
  readonly isUnderstaffed: boolean;
  readonly isRequirementSatisfied: boolean;
  readonly missingCount: number;
}

export const DEFAULT_ROLE_DEFINITIONS: readonly RoleDefinition[] = Object.freeze([
  {
    id: "domain-manager:leader",
    version: 1,
    label: "Leader",
    description: "Primary leader or ruler of the domain",
    occupancy: { min: 1, max: 1 }
  },
  {
    id: "domain-manager:administrator",
    version: 1,
    label: "Administrator",
    description: "Manages day-to-day operations and civil affairs",
    occupancy: { min: 0, max: 2 }
  },
  {
    id: "domain-manager:commander",
    version: 1,
    label: "Military Commander",
    description: "Directs defenses and garrison forces",
    occupancy: { min: 0, max: 1 }
  },
  {
    id: "domain-manager:treasurer",
    version: 1,
    label: "Treasurer",
    description: "Oversees revenue, vaults, and fiscal planning",
    occupancy: { min: 0, max: 1 }
  },
  {
    id: "domain-manager:councilor",
    version: 1,
    label: "Councilor",
    description: "Advises leadership on policy and external relations",
    occupancy: { min: 0, max: null }
  }
]);

export function validateRoleOccupancy(raw: unknown): Result<RoleOccupancyRule> {
  if (!raw || typeof raw !== "object") {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_OCCUPANCY",
        category: "validation",
        message: "occupancy must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (
    typeof candidate.min !== "number" ||
    !Number.isSafeInteger(candidate.min) ||
    candidate.min < 0
  ) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_OCCUPANCY",
        category: "validation",
        message: "occupancy.min must be a non-negative safe integer"
      })
    );
  }

  let max: number | null = null;
  if (candidate.max !== null && candidate.max !== undefined) {
    if (
      typeof candidate.max !== "number" ||
      !Number.isSafeInteger(candidate.max) ||
      candidate.max < candidate.min
    ) {
      return err(
        createPublicError({
          code: "DM_ROLE_INVALID_OCCUPANCY",
          category: "validation",
          message: "occupancy.max must be null or an integer >= occupancy.min"
        })
      );
    }
    max = candidate.max;
  }

  return ok({
    min: candidate.min,
    max
  });
}

export function validateRoleDefinition(candidate: unknown): Result<RoleDefinition> {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_ROLE_DEF_INVALID",
        category: "validation",
        message: "RoleDefinition must be an object"
      })
    );
  }

  const raw = candidate as Record<string, unknown>;

  if (typeof raw.id !== "string" || !raw.id.includes(":")) {
    return err(
      createPublicError({
        code: "DM_ROLE_DEF_INVALID_ID",
        category: "validation",
        message: "RoleDefinition id must be namespaced (e.g. 'domain-manager:leader')"
      })
    );
  }

  if (
    typeof raw.version !== "number" ||
    !Number.isSafeInteger(raw.version) ||
    raw.version < 1
  ) {
    return err(
      createPublicError({
        code: "DM_ROLE_DEF_INVALID_VERSION",
        category: "validation",
        message: "RoleDefinition version must be a positive integer"
      })
    );
  }

  if (typeof raw.label !== "string" || raw.label.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ROLE_DEF_INVALID_LABEL",
        category: "validation",
        message: "RoleDefinition label must be a non-empty string"
      })
    );
  }

  const occupancyRes = validateRoleOccupancy(raw.occupancy);
  if (!occupancyRes.ok) {
    return occupancyRes;
  }

  const grants = Array.isArray(raw.grants) ? Object.freeze([...raw.grants]) : undefined;
  const prerequisites = Array.isArray(raw.prerequisites)
    ? Object.freeze([...raw.prerequisites])
    : undefined;

  return ok({
    id: raw.id.trim(),
    version: raw.version,
    label: raw.label.trim(),
    description: typeof raw.description === "string" ? raw.description.trim() : undefined,
    occupancy: occupancyRes.value,
    grants,
    prerequisites
  });
}

export function validateDomainRole(
  candidate: unknown,
  definitions: readonly RoleDefinition[] = DEFAULT_ROLE_DEFINITIONS
): Result<DomainRole> {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID",
        category: "validation",
        message: "DomainRole must be an object"
      })
    );
  }

  const raw = candidate as Record<string, unknown>;

  if (!isOpaqueId(raw.id, "role")) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_ID",
        category: "validation",
        message: `DomainRole id must be an opaque ID with prefix 'role_', received: '${String(raw.id)}'`
      })
    );
  }

  if (typeof raw.definitionId !== "string" || raw.definitionId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_DEFINITION_ID",
        category: "validation",
        message: "DomainRole definitionId is required"
      })
    );
  }

  const definition = definitions.find((d) => d.id === raw.definitionId);

  if (raw.customLabel !== undefined && raw.customLabel !== null) {
    if (typeof raw.customLabel !== "string" || raw.customLabel.trim().length === 0) {
      return err(
        createPublicError({
          code: "DM_ROLE_INVALID_LABEL",
          category: "validation",
          message: "DomainRole customLabel must be a non-empty string if provided"
        })
      );
    }
  }
  const customLabel = raw.customLabel ? (raw.customLabel as string).trim() : undefined;

  if (!Array.isArray(raw.occupants) || raw.occupants.some((o) => !isOpaqueId(o, "not"))) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_OCCUPANTS",
        category: "validation",
        message: "DomainRole occupants must be an array of notable IDs (not_*)"
      })
    );
  }

  // Check duplicate occupants in same role
  const occupantSet = new Set(raw.occupants);
  if (occupantSet.size !== raw.occupants.length) {
    return err(
      createPublicError({
        code: "DM_ROLE_DUPLICATE_OCCUPANT",
        category: "validation",
        message: "Duplicate notable occupant found in role"
      })
    );
  }

  // Check max occupancy limit if definition is known (DEC-1005: Role acima do max não pode ser salvo)
  if (definition && definition.occupancy.max !== null && raw.occupants.length > definition.occupancy.max) {
    return err(
      createPublicError({
        code: "DM_ROLE_OCCUPANCY_EXCEEDED",
        category: "validation",
        message: `Role occupants count (${raw.occupants.length}) exceeds maximum allowed (${definition.occupancy.max})`
      })
    );
  }

  const visibility: RoleVisibility =
    raw.visibility === undefined ? "public" : (raw.visibility as RoleVisibility);

  if (!isRoleVisibility(visibility)) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_VISIBILITY",
        category: "validation",
        message: `Invalid role visibility: '${String(raw.visibility)}'. Must be one of: ${ROLE_VISIBILITIES.join(", ")}`
      })
    );
  }

  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== "string") {
      return err(
        createPublicError({
          code: "DM_ROLE_INVALID_NOTES",
          category: "validation",
          message: "Role notes must be a string"
        })
      );
    }
    if (raw.notes.length > 2000) {
      return err(
        createPublicError({
          code: "DM_ROLE_NOTES_TOO_LONG",
          category: "validation",
          message: "Role notes must not exceed 2000 characters"
        })
      );
    }
  }
  const notes = raw.notes ? (raw.notes as string).trim() : undefined;

  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== "string"))) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_TAGS",
        category: "validation",
        message: "Role tags must be an array of strings"
      })
    );
  }
  const tags = Object.freeze(Array.isArray(raw.tags) ? [...raw.tags] : []);

  return ok({
    id: raw.id,
    definitionId: raw.definitionId.trim(),
    customLabel,
    occupants: Object.freeze([...raw.occupants]),
    visibility,
    notes,
    tags
  });
}

export function evaluateRole(
  role: DomainRole,
  definitions: readonly RoleDefinition[] = DEFAULT_ROLE_DEFINITIONS
): RoleEvaluation {
  const definition = definitions.find((d) => d.id === role.definitionId);
  const effectiveLabel = role.customLabel ?? definition?.label ?? role.definitionId;

  const occupantsCount = role.occupants.length;
  const isVacant = occupantsCount === 0;
  const isFilled = occupantsCount > 0;

  const minOccupancy = definition?.occupancy.min ?? 0;
  const isUnderstaffed = occupantsCount < minOccupancy;
  const isRequirementSatisfied = !isUnderstaffed;
  const missingCount = Math.max(0, minOccupancy - occupantsCount);

  return {
    role,
    definition,
    effectiveLabel,
    isVacant,
    isFilled,
    isUnderstaffed,
    isRequirementSatisfied,
    missingCount
  };
}

