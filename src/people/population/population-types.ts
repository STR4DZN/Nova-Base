import type { OpaqueId } from "../../core/identity/ids.js";
import { isOpaqueId } from "../../core/identity/ids.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createPublicError } from "../../core/contracts/public-error.js";

export const POPULATION_MODES = ["manual", "sumGroups", "hybrid"] as const;
export type PopulationMode = (typeof POPULATION_MODES)[number];

export const POPULATION_PRECISIONS = ["exact", "estimated", "unknown"] as const;
export type PopulationPrecision = (typeof POPULATION_PRECISIONS)[number];

export interface PopulationState {
  readonly mode: PopulationMode;
  readonly total: number | null;
  readonly precision: PopulationPrecision;
}

export interface PopulationGroup {
  readonly id: OpaqueId;
  readonly name: string;
  readonly count: number | null;
  readonly precision?: PopulationPrecision;
  readonly includedInTotal: boolean;
  readonly tags: readonly string[];
  readonly notes?: string;
}

export interface PopulationResolution {
  readonly total: number | null;
  readonly precision: PopulationPrecision;
  readonly warnings: readonly string[];
}

export function isPopulationMode(value: unknown): value is PopulationMode {
  return typeof value === "string" && POPULATION_MODES.includes(value as PopulationMode);
}

export function isPopulationPrecision(value: unknown): value is PopulationPrecision {
  return typeof value === "string" && POPULATION_PRECISIONS.includes(value as PopulationPrecision);
}

export function validatePopulationState(state: unknown): Result<PopulationState> {
  if (!state || typeof state !== "object") {
    return err(
      createPublicError({
        code: "DM_POPULATION_INVALID_STATE",
        category: "validation",
        message: "PopulationState must be an object"
      })
    );
  }

  const candidate = state as Record<string, unknown>;

  if (!isPopulationMode(candidate.mode)) {
    return err(
      createPublicError({
        code: "DM_POPULATION_INVALID_MODE",
        category: "validation",
        message: `Invalid population mode: '${String(candidate.mode)}'. Must be one of: ${POPULATION_MODES.join(", ")}`
      })
    );
  }

  if (!isPopulationPrecision(candidate.precision)) {
    return err(
      createPublicError({
        code: "DM_POPULATION_INVALID_PRECISION",
        category: "validation",
        message: `Invalid population precision: '${String(candidate.precision)}'. Must be one of: ${POPULATION_PRECISIONS.join(", ")}`
      })
    );
  }

  if (candidate.total !== null && candidate.total !== undefined) {
    if (typeof candidate.total !== "number" || !Number.isSafeInteger(candidate.total) || candidate.total < 0) {
      return err(
        createPublicError({
          code: "DM_POPULATION_INVALID_TOTAL",
          category: "validation",
          message: "Population total must be a non-negative safe integer or null"
        })
      );
    }
  }

  const total = candidate.total === undefined ? null : (candidate.total as number | null);

  let precision = candidate.precision;
  if (total === null && precision !== "unknown") {
    precision = "unknown";
  }

  return ok({
    mode: candidate.mode,
    total,
    precision
  });
}

export function validatePopulationGroup(group: unknown): Result<PopulationGroup> {
  if (!group || typeof group !== "object") {
    return err(
      createPublicError({
        code: "DM_POPULATION_GROUP_INVALID",
        category: "validation",
        message: "PopulationGroup must be an object"
      })
    );
  }

  const candidate = group as Record<string, unknown>;

  if (!isOpaqueId(candidate.id, "pop")) {
    return err(
      createPublicError({
        code: "DM_POPULATION_GROUP_INVALID_ID",
        category: "validation",
        message: `PopulationGroup id must be an opaque ID with prefix 'pop_', received: '${String(candidate.id)}'`
      })
    );
  }

  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_POPULATION_GROUP_INVALID_NAME",
        category: "validation",
        message: "PopulationGroup name must be a non-empty string"
      })
    );
  }

  if (candidate.count !== null && candidate.count !== undefined) {
    if (typeof candidate.count !== "number" || !Number.isSafeInteger(candidate.count) || candidate.count < 0) {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_INVALID_COUNT",
          category: "validation",
          message: "PopulationGroup count must be a non-negative safe integer or null"
        })
      );
    }
  }

  if (typeof candidate.includedInTotal !== "boolean") {
    return err(
      createPublicError({
        code: "DM_POPULATION_GROUP_INVALID_INCLUDED",
        category: "validation",
        message: "PopulationGroup includedInTotal must be a boolean"
      })
    );
  }

  if (!Array.isArray(candidate.tags) || candidate.tags.some((t) => typeof t !== "string")) {
    return err(
      createPublicError({
        code: "DM_POPULATION_GROUP_INVALID_TAGS",
        category: "validation",
        message: "PopulationGroup tags must be an array of strings"
      })
    );
  }

  if (candidate.notes !== undefined && candidate.notes !== null) {
    if (typeof candidate.notes !== "string") {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_INVALID_NOTES",
          category: "validation",
          message: "PopulationGroup notes must be a string"
        })
      );
    }
    if (candidate.notes.length > 2000) {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_NOTES_TOO_LONG",
          category: "validation",
          message: "PopulationGroup notes must not exceed 2000 characters"
        })
      );
    }
  }

  if (candidate.precision !== undefined && candidate.precision !== null) {
    if (!isPopulationPrecision(candidate.precision)) {
      return err(
        createPublicError({
          code: "DM_POPULATION_INVALID_PRECISION",
          category: "validation",
          message: `Invalid population group precision: '${String(candidate.precision)}'. Must be one of: ${POPULATION_PRECISIONS.join(", ")}`
        })
      );
    }
  }

  return ok({
    id: candidate.id,
    name: candidate.name.trim(),
    count: candidate.count === undefined ? null : (candidate.count as number | null),
    precision: candidate.precision === undefined || candidate.precision === null ? undefined : (candidate.precision as PopulationPrecision),
    includedInTotal: candidate.includedInTotal,
    tags: Object.freeze([...candidate.tags]),
    notes: candidate.notes === undefined || candidate.notes === null ? undefined : candidate.notes
  });
}
