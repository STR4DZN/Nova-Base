import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { CapacityPolicy, ResourceDefinition } from "../definitions/resource-definition-types.js";

export interface CapacityModifier {
  readonly id: string;
  readonly source: string;
  readonly label: string;
  readonly deltaMinor: number;
  readonly active: boolean;
}

export interface EffectiveCapacity {
  readonly effectiveCapacityMinor: number | null;
  readonly baseCapacityMinor: number | null;
  readonly modifiers: readonly CapacityModifier[];
  readonly hardLimitClamped: boolean;
}

export interface CapacityEvaluation {
  readonly allowed: boolean;
  readonly effectiveCapacityMinor: number | null;
  readonly proposedBalanceMinor: number;
  readonly excessMinor: number;
  readonly policy: CapacityPolicy;
  readonly warning?: string;
  readonly error?: PublicError;
}

export function validateCapacityModifier(raw: unknown): Result<CapacityModifier, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_MODIFIER_INVALID",
        category: "validation",
        message: "CapacityModifier must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_MODIFIER_INVALID",
        category: "validation",
        message: "CapacityModifier id must be a non-empty string"
      })
    );
  }

  if (typeof candidate.source !== "string" || candidate.source.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_MODIFIER_INVALID",
        category: "validation",
        message: "CapacityModifier source must be a non-empty string"
      })
    );
  }

  if (typeof candidate.label !== "string" || candidate.label.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_MODIFIER_INVALID",
        category: "validation",
        message: "CapacityModifier label must be a non-empty string"
      })
    );
  }

  if (typeof candidate.deltaMinor !== "number" || !Number.isSafeInteger(candidate.deltaMinor)) {
    return err(
      createPublicError({
        code: "DM_ECON_MODIFIER_INVALID",
        category: "validation",
        message: `CapacityModifier deltaMinor must be a safe integer: received '${String(candidate.deltaMinor)}'`
      })
    );
  }

  return ok({
    id: candidate.id.trim(),
    source: candidate.source.trim(),
    label: candidate.label.trim(),
    deltaMinor: candidate.deltaMinor,
    active: Boolean(candidate.active)
  });
}

/**
 * Resolves effective capacity combining base capacity with active modifiers.
 * Enforces DEC-16824 (broken source/inactive modifier contributes 0)
 * and DEC-16741 (account capacity never exceeds hard definition maximum).
 */
export function resolveEffectiveCapacity(
  baseCapacityMinor: number | null,
  modifiers: readonly CapacityModifier[] = [],
  resourceDef?: ResourceDefinition
): EffectiveCapacity {
  if (baseCapacityMinor === null) {
    return {
      effectiveCapacityMinor: null,
      baseCapacityMinor: null,
      modifiers: Object.freeze([...modifiers]),
      hardLimitClamped: false
    };
  }

  if (!Number.isSafeInteger(baseCapacityMinor) || baseCapacityMinor < 0) {
    throw new Error(
      `baseCapacityMinor must be a non-negative safe integer or null, got: ${String(baseCapacityMinor)}`
    );
  }

  let totalCapacity = baseCapacityMinor;

  for (const mod of modifiers) {
    // Only active modifiers contribute capacity (DEC-16824: broken source produces no ghost capacity)
    if (mod.active) {
      totalCapacity += mod.deltaMinor;
    }
  }

  // Capacity cannot be negative
  if (totalCapacity < 0) {
    totalCapacity = 0;
  }

  if (!Number.isSafeInteger(totalCapacity)) {
    throw new Error(
      `Effective capacity overflowed safe integer bounds: ${totalCapacity}`
    );
  }

  let hardLimitClamped = false;
  if (resourceDef?.maximumMinor !== null && resourceDef?.maximumMinor !== undefined) {
    if (totalCapacity > resourceDef.maximumMinor) {
      totalCapacity = resourceDef.maximumMinor;
      hardLimitClamped = true;
    }
  }

  return {
    effectiveCapacityMinor: totalCapacity,
    baseCapacityMinor,
    modifiers: Object.freeze([...modifiers]),
    hardLimitClamped
  };
}

/**
 * Evaluates whether a proposed balance is allowed under the effective capacity and policy.
 * Also verifies ResourceDefinition absolute limits (minimumMinor, maximumMinor, allowNegative).
 */
export function evaluateCapacity(
  proposedBalanceMinor: number,
  effectiveCapacityMinor: number | null,
  policy: CapacityPolicy,
  resourceDef?: ResourceDefinition
): CapacityEvaluation {
  if (!Number.isSafeInteger(proposedBalanceMinor)) {
    return {
      allowed: false,
      effectiveCapacityMinor,
      proposedBalanceMinor,
      excessMinor: 0,
      policy,
      error: createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `Proposed balance must be a safe integer: received '${String(proposedBalanceMinor)}'`
      })
    };
  }

  // 1. Definition Hard Bounds (Absolute limits override local policies per DEC-16739 & DEC-16744)
  if (resourceDef) {
    if (!resourceDef.allowNegative && proposedBalanceMinor < 0) {
      return {
        allowed: false,
        effectiveCapacityMinor,
        proposedBalanceMinor,
        excessMinor: 0,
        policy,
        error: createPublicError({
          code: "DM_ECON_NEGATIVE_NOT_ALLOWED",
          category: "validation",
          message: `Resource '${resourceDef.id}' does not permit negative balance: proposed ${proposedBalanceMinor}`
        })
      };
    }

    if (resourceDef.minimumMinor !== null && resourceDef.minimumMinor !== undefined) {
      if (proposedBalanceMinor < resourceDef.minimumMinor) {
        return {
          allowed: false,
          effectiveCapacityMinor,
          proposedBalanceMinor,
          excessMinor: 0,
          policy,
          error: createPublicError({
            code: "DM_ECON_MINIMUM_EXCEEDED",
            category: "validation",
            message: `Proposed balance ${proposedBalanceMinor} is below absolute minimum ${resourceDef.minimumMinor}`
          })
        };
      }
    }

    if (resourceDef.maximumMinor !== null && resourceDef.maximumMinor !== undefined) {
      if (proposedBalanceMinor > resourceDef.maximumMinor) {
        return {
          allowed: false,
          effectiveCapacityMinor,
          proposedBalanceMinor,
          excessMinor: proposedBalanceMinor - resourceDef.maximumMinor,
          policy,
          error: createPublicError({
            code: "DM_ECON_CAPACITY_EXCEEDED",
            category: "validation",
            message: `Proposed balance ${proposedBalanceMinor} exceeds definition absolute maximum ${resourceDef.maximumMinor}`
          })
        };
      }
    }
  }

  // 2. Capacity Check
  if (effectiveCapacityMinor === null) {
    return {
      allowed: true,
      effectiveCapacityMinor: null,
      proposedBalanceMinor,
      excessMinor: 0,
      policy
    };
  }

  if (proposedBalanceMinor <= effectiveCapacityMinor) {
    return {
      allowed: true,
      effectiveCapacityMinor,
      proposedBalanceMinor,
      excessMinor: 0,
      policy
    };
  }

  const excessMinor = proposedBalanceMinor - effectiveCapacityMinor;

  switch (policy) {
    case "block":
      return {
        allowed: false,
        effectiveCapacityMinor,
        proposedBalanceMinor,
        excessMinor,
        policy,
        error: createPublicError({
          code: "DM_ECON_CAPACITY_EXCEEDED",
          category: "validation",
          message: `Proposed balance ${proposedBalanceMinor} exceeds effective capacity ${effectiveCapacityMinor} by ${excessMinor} minor units`
        })
      };

    case "allow-with-warning":
      return {
        allowed: true,
        effectiveCapacityMinor,
        proposedBalanceMinor,
        excessMinor,
        policy,
        warning: `Capacity exceeded by ${excessMinor} minor units (capacity: ${effectiveCapacityMinor}, proposed: ${proposedBalanceMinor})`
      };

    case "overflow":
      return {
        allowed: true,
        effectiveCapacityMinor,
        proposedBalanceMinor,
        excessMinor,
        policy,
        warning: `Overflow detected: ${excessMinor} minor units exceed storage capacity`
      };

    case "provider":
      return {
        allowed: true,
        effectiveCapacityMinor,
        proposedBalanceMinor,
        excessMinor,
        policy
      };
  }
}
