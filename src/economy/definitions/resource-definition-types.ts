import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";

export type CapacityPolicy = "block" | "allow-with-warning" | "overflow" | "provider";

export type ResourceLifecycle = "active" | "archived";

export interface DisplayUnit {
  readonly singular?: string;
  readonly plural?: string;
  readonly abbreviation?: string;
}

export interface ResourceDefinition {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly categoryId?: string | null;
  readonly tags: readonly string[];
  readonly precision: number;
  readonly displayUnit?: DisplayUnit;
  readonly minimumMinor?: number | null;
  readonly maximumMinor?: number | null;
  readonly allowNegative: boolean;
  readonly defaultCapacityPolicy: CapacityPolicy;
  readonly lifecycle: ResourceLifecycle;
}

export function isNamespacedResourceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value)
  );
}

export function validateResourceDefinition(raw: unknown): Result<ResourceDefinition, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: "ResourceDefinition must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. ID
  if (!isNamespacedResourceId(candidate.id)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID_ID",
        category: "validation",
        message: `ResourceDefinition ID must be namespaced (e.g. 'domain-manager:treasury' or 'world:gold'): received '${String(candidate.id)}'`
      })
    );
  }

  // 2. Version
  const version = typeof candidate.version === "number" ? candidate.version : 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: "ResourceDefinition version must be a positive safe integer >= 1"
      })
    );
  }

  // 3. Label
  if (typeof candidate.label !== "string" || candidate.label.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: "ResourceDefinition label must be a non-empty string"
      })
    );
  }

  // 4. Precision (0..4 initially per §14.2 and DEC-16718)
  const precision = candidate.precision;
  if (
    typeof precision !== "number" ||
    !Number.isSafeInteger(precision) ||
    precision < 0 ||
    precision > 4
  ) {
    return err(
      createPublicError({
        code: "DM_ECON_PRECISION_INVALID",
        category: "validation",
        message: `Resource precision must be an integer between 0 and 4: received '${String(precision)}'`
      })
    );
  }

  // 5. AllowNegative
  const allowNegative = Boolean(candidate.allowNegative);

  // 6. Minimum & Maximum Minor Units
  let minimumMinor: number | null = null;
  if (candidate.minimumMinor !== undefined && candidate.minimumMinor !== null) {
    if (
      typeof candidate.minimumMinor !== "number" ||
      !Number.isSafeInteger(candidate.minimumMinor)
    ) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_INVALID",
          category: "validation",
          message: "minimumMinor must be a safe integer or null"
        })
      );
    }
    minimumMinor = candidate.minimumMinor;
  } else if (!allowNegative) {
    // allowNegative=false implies default minimum 0 (DEC-16737)
    minimumMinor = 0;
  }

  let maximumMinor: number | null = null;
  if (candidate.maximumMinor !== undefined && candidate.maximumMinor !== null) {
    if (
      typeof candidate.maximumMinor !== "number" ||
      !Number.isSafeInteger(candidate.maximumMinor)
    ) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_INVALID",
          category: "validation",
          message: "maximumMinor must be a safe integer or null"
        })
      );
    }
    maximumMinor = candidate.maximumMinor;
  }

  if (minimumMinor !== null && maximumMinor !== null && minimumMinor > maximumMinor) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: `minimumMinor (${minimumMinor}) cannot exceed maximumMinor (${maximumMinor})`
      })
    );
  }

  if (!allowNegative && minimumMinor !== null && minimumMinor < 0) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: "minimumMinor cannot be negative when allowNegative is false"
      })
    );
  }

  // 7. Capacity policy
  const validPolicies: CapacityPolicy[] = ["block", "allow-with-warning", "overflow", "provider"];
  const capacityPolicy = (candidate.defaultCapacityPolicy as CapacityPolicy) || "block";
  if (!validPolicies.includes(capacityPolicy)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: `Invalid defaultCapacityPolicy: received '${String(capacityPolicy)}'`
      })
    );
  }

  // 8. Lifecycle
  const lifecycle = (candidate.lifecycle as ResourceLifecycle) || "active";
  if (lifecycle !== "active" && lifecycle !== "archived") {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: `Invalid lifecycle: received '${String(lifecycle)}'`
      })
    );
  }

  // 9. Tags
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.filter((t): t is string => typeof t === "string")
    : [];

  // 10. Display unit
  let displayUnit: DisplayUnit | undefined = undefined;
  if (candidate.displayUnit && typeof candidate.displayUnit === "object") {
    const rawUnit = candidate.displayUnit as Record<string, unknown>;
    displayUnit = {
      ...(typeof rawUnit.singular === "string" ? { singular: rawUnit.singular } : {}),
      ...(typeof rawUnit.plural === "string" ? { plural: rawUnit.plural } : {}),
      ...(typeof rawUnit.abbreviation === "string" ? { abbreviation: rawUnit.abbreviation } : {})
    };
  }

  return ok({
    id: candidate.id as string,
    version,
    label: candidate.label.trim(),
    ...(typeof candidate.description === "string" ? { description: candidate.description } : {}),
    ...(typeof candidate.icon === "string" ? { icon: candidate.icon } : {}),
    categoryId: typeof candidate.categoryId === "string" ? candidate.categoryId : null,
    tags: Object.freeze(tags),
    precision,
    ...(displayUnit ? { displayUnit } : {}),
    minimumMinor,
    maximumMinor,
    allowNegative,
    defaultCapacityPolicy: capacityPolicy,
    lifecycle
  });
}
