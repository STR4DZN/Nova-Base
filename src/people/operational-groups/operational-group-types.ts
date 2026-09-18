import { createPublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { isOpaqueId } from "../../core/identity/ids.js";

export type OperationalGroupLifecycle = "active" | "inactive" | "disbanded";
export const OPERATIONAL_GROUP_LIFECYCLES: readonly OperationalGroupLifecycle[] = Object.freeze([
  "active",
  "inactive",
  "disbanded"
]);

export function isOperationalGroupLifecycle(value: unknown): value is OperationalGroupLifecycle {
  return typeof value === "string" && OPERATIONAL_GROUP_LIFECYCLES.includes(value as OperationalGroupLifecycle);
}

export type OperationalGroupMembershipMode = "abstract" | "partial" | "explicit";
export const OPERATIONAL_GROUP_MEMBERSHIP_MODES: readonly OperationalGroupMembershipMode[] = Object.freeze([
  "abstract",
  "partial",
  "explicit"
]);

export function isOperationalGroupMembershipMode(value: unknown): value is OperationalGroupMembershipMode {
  return (
    typeof value === "string" &&
    OPERATIONAL_GROUP_MEMBERSHIP_MODES.includes(value as OperationalGroupMembershipMode)
  );
}

export type OperationalGroupVisibility = "public" | "restricted" | "secret";
export const OPERATIONAL_GROUP_VISIBILITIES: readonly OperationalGroupVisibility[] = Object.freeze([
  "public",
  "restricted",
  "secret"
]);

export function isOperationalGroupVisibility(value: unknown): value is OperationalGroupVisibility {
  return (
    typeof value === "string" &&
    OPERATIONAL_GROUP_VISIBILITIES.includes(value as OperationalGroupVisibility)
  );
}

export interface OperationalGroupDefinition {
  readonly id: string; // namespaced e.g. "domain-manager:militia"
  readonly version: number;
  readonly label: string;
  readonly description?: string;
  readonly defaultMembershipMode?: OperationalGroupMembershipMode;
  readonly tags?: readonly string[];
  readonly grants?: readonly string[];
  readonly keepGrantWhenInactive?: boolean;
}

export interface OperationalGroup {
  readonly id: string; // opg_<UUID>
  readonly name: string;
  readonly definitionId: string;
  readonly membershipMode: OperationalGroupMembershipMode;
  readonly size: number;
  readonly members: readonly string[]; // notable IDs (not_<UUID>)
  readonly lifecycle: OperationalGroupLifecycle;
  readonly visibility: OperationalGroupVisibility;
  readonly populationGroupId?: string; // pop_<UUID>
  readonly notes?: string;
  readonly tags: readonly string[];
}

export const DEFAULT_OPERATIONAL_GROUP_DEFINITIONS: readonly OperationalGroupDefinition[] = Object.freeze([
  {
    id: "domain-manager:militia",
    version: 1,
    label: "Local Militia",
    description: "Basic garrison and defensive force",
    defaultMembershipMode: "partial"
  },
  {
    id: "domain-manager:labor-squad",
    version: 1,
    label: "Labor Squad",
    description: "Organized civilian workforce for infrastructure and projects",
    defaultMembershipMode: "abstract"
  },
  {
    id: "domain-manager:scout-patrol",
    version: 1,
    label: "Scout Patrol",
    description: "Mobile reconnaissance unit operating on domain frontiers",
    defaultMembershipMode: "explicit"
  }
]);

export function validateOperationalGroup(candidate: unknown): Result<OperationalGroup> {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID",
        category: "validation",
        message: "OperationalGroup must be an object"
      })
    );
  }

  const raw = candidate as Record<string, unknown>;

  if (!isOpaqueId(raw.id, "opg")) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_ID",
        category: "validation",
        message: `OperationalGroup id must be an opaque ID with prefix 'opg_', received: '${String(raw.id)}'`
      })
    );
  }

  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_NAME",
        category: "validation",
        message: "OperationalGroup name must be a non-empty string"
      })
    );
  }
  const name = raw.name.trim();

  if (typeof raw.definitionId !== "string" || raw.definitionId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_DEFINITION_ID",
        category: "validation",
        message: "OperationalGroup definitionId is required"
      })
    );
  }
  const definitionId = raw.definitionId.trim();

  const membershipMode: OperationalGroupMembershipMode =
    raw.membershipMode === undefined ? "abstract" : (raw.membershipMode as OperationalGroupMembershipMode);

  if (!isOperationalGroupMembershipMode(membershipMode)) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_MEMBERSHIP_MODE",
        category: "validation",
        message: `Invalid membershipMode: '${String(raw.membershipMode)}'. Must be one of: ${OPERATIONAL_GROUP_MEMBERSHIP_MODES.join(", ")}`
      })
    );
  }

  // Members array validation
  const rawMembers = raw.members === undefined ? [] : raw.members;
  if (!Array.isArray(rawMembers) || rawMembers.some((m) => !isOpaqueId(m, "not"))) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_MEMBERS",
        category: "validation",
        message: "OperationalGroup members must be an array of notable IDs (not_*)"
      })
    );
  }

  // Anti-duplicate members in same operational group
  const memberSet = new Set(rawMembers);
  if (memberSet.size !== rawMembers.length) {
    return err(
      createPublicError({
        code: "DM_OPG_DUPLICATE_MEMBER",
        category: "validation",
        message: "Duplicate notable member found in OperationalGroup"
      })
    );
  }

  // DEC-1075: abstract = nenhum roster individual
  if (membershipMode === "abstract" && rawMembers.length > 0) {
    return err(
      createPublicError({
        code: "DM_OPG_ABSTRACT_CANNOT_HAVE_MEMBERS",
        category: "validation",
        message: "OperationalGroup in 'abstract' membership mode cannot have individual members in roster"
      })
    );
  }

  // Size calculation & derivation (DEC-1078, DEC-1079)
  let size: number;
  if (membershipMode === "explicit") {
    // In explicit mode, size is strictly derived from members length
    size = rawMembers.length;
  } else {
    // In abstract or partial mode, size is provided directly
    if (
      typeof raw.size !== "number" ||
      !Number.isSafeInteger(raw.size) ||
      raw.size < 0
    ) {
      return err(
        createPublicError({
          code: "DM_OPG_INVALID_SIZE",
          category: "validation",
          message: "OperationalGroup size must be a non-negative integer for abstract/partial modes"
        })
      );
    }
    size = raw.size;

    // In partial mode, roster must not exceed size (DEC-1076)
    if (membershipMode === "partial" && rawMembers.length > size) {
      return err(
        createPublicError({
          code: "DM_OPG_PARTIAL_MEMBERS_EXCEED_SIZE",
          category: "validation",
          message: `OperationalGroup roster length (${rawMembers.length}) cannot exceed declared size (${size}) in partial mode`
        })
      );
    }
  }

  const lifecycle: OperationalGroupLifecycle =
    raw.lifecycle === undefined ? "active" : (raw.lifecycle as OperationalGroupLifecycle);

  if (!isOperationalGroupLifecycle(lifecycle)) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_LIFECYCLE",
        category: "validation",
        message: `Invalid lifecycle: '${String(raw.lifecycle)}'. Must be one of: ${OPERATIONAL_GROUP_LIFECYCLES.join(", ")}`
      })
    );
  }

  const visibility: OperationalGroupVisibility =
    raw.visibility === undefined ? "public" : (raw.visibility as OperationalGroupVisibility);

  if (!isOperationalGroupVisibility(visibility)) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_VISIBILITY",
        category: "validation",
        message: `Invalid visibility: '${String(raw.visibility)}'. Must be one of: ${OPERATIONAL_GROUP_VISIBILITIES.join(", ")}`
      })
    );
  }

  let populationGroupId: string | undefined = undefined;
  if (raw.populationGroupId !== undefined && raw.populationGroupId !== null) {
    if (!isOpaqueId(raw.populationGroupId, "pop")) {
      return err(
        createPublicError({
          code: "DM_OPG_INVALID_POPULATION_GROUP_ID",
          category: "validation",
          message: `populationGroupId must have prefix 'pop_', received: '${String(raw.populationGroupId)}'`
        })
      );
    }
    populationGroupId = raw.populationGroupId;
  }

  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== "string") {
      return err(
        createPublicError({
          code: "DM_OPG_INVALID_NOTES",
          category: "validation",
          message: "OperationalGroup notes must be a string"
        })
      );
    }
    if (raw.notes.length > 2000) {
      return err(
        createPublicError({
          code: "DM_OPG_NOTES_TOO_LONG",
          category: "validation",
          message: "OperationalGroup notes must not exceed 2000 characters"
        })
      );
    }
  }
  const notes = raw.notes ? (raw.notes as string).trim() : undefined;

  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== "string"))) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_TAGS",
        category: "validation",
        message: "OperationalGroup tags must be an array of strings"
      })
    );
  }
  const tags = Object.freeze(Array.isArray(raw.tags) ? [...raw.tags] : []);

  return ok({
    id: raw.id,
    name,
    definitionId,
    membershipMode,
    size,
    members: Object.freeze([...rawMembers]),
    lifecycle,
    visibility,
    populationGroupId,
    notes,
    tags
  });
}

export function validateOperationalGroupDefinition(candidate: unknown): Result<OperationalGroupDefinition> {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_OPG_DEF_INVALID",
        category: "validation",
        message: "OperationalGroupDefinition must be an object"
      })
    );
  }
  const raw = candidate as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.includes(":")) {
    return err(
      createPublicError({
        code: "DM_OPG_DEF_INVALID_ID",
        category: "validation",
        message: "OperationalGroupDefinition id must be namespaced (e.g. 'domain-manager:militia')"
      })
    );
  }
  if (typeof raw.version !== "number" || !Number.isSafeInteger(raw.version) || raw.version < 1) {
    return err(
      createPublicError({
        code: "DM_OPG_DEF_INVALID_VERSION",
        category: "validation",
        message: "OperationalGroupDefinition version must be a positive integer"
      })
    );
  }
  if (typeof raw.label !== "string" || raw.label.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_OPG_DEF_INVALID_LABEL",
        category: "validation",
        message: "OperationalGroupDefinition label must be a non-empty string"
      })
    );
  }
  const defaultMembershipMode = raw.defaultMembershipMode !== undefined ? (raw.defaultMembershipMode as OperationalGroupMembershipMode) : undefined;
  if (defaultMembershipMode !== undefined && !isOperationalGroupMembershipMode(defaultMembershipMode)) {
    return err(
      createPublicError({
        code: "DM_OPG_DEF_INVALID_MEMBERSHIP_MODE",
        category: "validation",
        message: `Invalid defaultMembershipMode: '${String(raw.defaultMembershipMode)}'`
      })
    );
  }
  const tags = Array.isArray(raw.tags) ? Object.freeze([...raw.tags]) : undefined;
  const grants = Array.isArray(raw.grants) ? Object.freeze([...raw.grants]) : undefined;
  const keepGrantWhenInactive = typeof raw.keepGrantWhenInactive === "boolean" ? raw.keepGrantWhenInactive : false;

  return ok({
    id: raw.id.trim(),
    version: raw.version,
    label: raw.label.trim(),
    description: typeof raw.description === "string" ? raw.description.trim() : undefined,
    defaultMembershipMode,
    tags,
    grants,
    keepGrantWhenInactive
  });
}

