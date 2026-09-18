import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { isNamespacedResourceId } from "./resource-definition-types.js";

export type ThresholdOperator = "below" | "at-or-below" | "above" | "at-or-above";
export type ThresholdSeverity = "info" | "warning" | "critical";

export interface ResourceThreshold {
  readonly id: string;
  readonly resourceId: string;
  readonly label: string;
  readonly operator: ThresholdOperator;
  readonly valueMinor: number;
  readonly severity: ThresholdSeverity;
  readonly message?: string;
}

export interface ThresholdCrossing {
  readonly threshold: ResourceThreshold;
  readonly previousMinor: number;
  readonly currentMinor: number;
  readonly crossedAt: string; // ISO 8601
}

const VALID_OPERATORS: readonly ThresholdOperator[] = Object.freeze([
  "below",
  "at-or-below",
  "above",
  "at-or-above"
]);

const VALID_SEVERITIES: readonly ThresholdSeverity[] = Object.freeze([
  "info",
  "warning",
  "critical"
]);

export function validateResourceThreshold(raw: unknown): Result<ResourceThreshold, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_THRESHOLD_INVALID",
        category: "validation",
        message: "ResourceThreshold must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_THRESHOLD_INVALID",
        category: "validation",
        message: "ResourceThreshold id must be a non-empty string"
      })
    );
  }

  if (!isNamespacedResourceId(candidate.resourceId)) {
    return err(
      createPublicError({
        code: "DM_ECON_THRESHOLD_INVALID",
        category: "validation",
        message: `ResourceThreshold resourceId must be namespaced: received '${String(candidate.resourceId)}'`
      })
    );
  }

  if (typeof candidate.label !== "string" || candidate.label.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_THRESHOLD_INVALID",
        category: "validation",
        message: "ResourceThreshold label must be a non-empty string"
      })
    );
  }

  if (!VALID_OPERATORS.includes(candidate.operator as ThresholdOperator)) {
    return err(
      createPublicError({
        code: "DM_ECON_THRESHOLD_INVALID",
        category: "validation",
        message: `Invalid threshold operator: received '${String(candidate.operator)}'`
      })
    );
  }

  if (typeof candidate.valueMinor !== "number" || !Number.isSafeInteger(candidate.valueMinor)) {
    return err(
      createPublicError({
        code: "DM_ECON_THRESHOLD_INVALID",
        category: "validation",
        message: `Threshold valueMinor must be a safe integer: received '${String(candidate.valueMinor)}'`
      })
    );
  }

  if (!VALID_SEVERITIES.includes(candidate.severity as ThresholdSeverity)) {
    return err(
      createPublicError({
        code: "DM_ECON_THRESHOLD_INVALID",
        category: "validation",
        message: `Invalid threshold severity: received '${String(candidate.severity)}'`
      })
    );
  }

  return ok({
    id: candidate.id.trim(),
    resourceId: candidate.resourceId,
    label: candidate.label.trim(),
    operator: candidate.operator as ThresholdOperator,
    valueMinor: candidate.valueMinor,
    severity: candidate.severity as ThresholdSeverity,
    ...(typeof candidate.message === "string" && candidate.message.trim().length > 0
      ? { message: candidate.message.trim() }
      : {})
  });
}

export function isThresholdActive(threshold: ResourceThreshold, currentMinor: number): boolean {
  switch (threshold.operator) {
    case "below":
      return currentMinor < threshold.valueMinor;
    case "at-or-below":
      return currentMinor <= threshold.valueMinor;
    case "above":
      return currentMinor > threshold.valueMinor;
    case "at-or-above":
      return currentMinor >= threshold.valueMinor;
  }
}

export function detectThresholdCrossings(
  thresholds: readonly ResourceThreshold[],
  previousMinor: number,
  currentMinor: number,
  nowIso: string = new Date().toISOString()
): readonly ThresholdCrossing[] {
  if (previousMinor === currentMinor) {
    return Object.freeze([]);
  }

  const crossings: ThresholdCrossing[] = [];

  for (const t of thresholds) {
    const wasActive = isThresholdActive(t, previousMinor);
    const isActive = isThresholdActive(t, currentMinor);

    // Crossing into active state
    if (!wasActive && isActive) {
      crossings.push({
        threshold: t,
        previousMinor,
        currentMinor,
        crossedAt: nowIso
      });
    }
  }

  return Object.freeze(crossings);
}
