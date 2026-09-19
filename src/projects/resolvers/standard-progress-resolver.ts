import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type {
  ProgressResolver,
  ProjectProgressBreakdownStep,
  ProjectProgressContext,
  ProjectProgressResolution
} from "./progress-resolver-types.js";

export const STANDARD_PROGRESS_RESOLVER_ID = "domain-manager:standard" as const;

/**
 * Canonical ProgressResolver implementation (Master Spec §15.3, Anexo 07 §2.1).
 * Resolves progress strictly as a pure function without mutating the input project instance.
 */
export class StandardProgressResolver implements ProgressResolver {
  readonly id = STANDARD_PROGRESS_RESOLVER_ID;
  readonly label = "Standard Progress Resolver";
  readonly description = "Canonical progress resolver supporting explicit units, workforce efficiency, and parameter adjustments.";

  resolve(context: ProjectProgressContext): Result<ProjectProgressResolution, PublicError> {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const breakdown: ProjectProgressBreakdownStep[] = [];

    // 1. Determine requested/base units
    let baseUnits: number;
    if (context.requestedUnits !== undefined) {
      if (!Number.isSafeInteger(context.requestedUnits)) {
        return err(
          createPublicError({
            code: "DM_PROJECT_PROGRESS_INVALID_UNITS",
            category: "validation",
            message: `Requested progress units must be a safe integer: received ${context.requestedUnits}`
          })
        );
      }
      baseUnits = context.requestedUnits;
      reasons.push(`Explicit progress units requested: ${baseUnits}`);
      breakdown.push({ step: "requested_units", delta: baseUnits });
    } else if (
      context.parameters?.units !== undefined &&
      typeof context.parameters.units === "number" &&
      Number.isSafeInteger(context.parameters.units)
    ) {
      baseUnits = context.parameters.units;
      reasons.push(`Parameter progress units specified: ${baseUnits}`);
      breakdown.push({ step: "parameter_units", delta: baseUnits });
    } else if (
      context.parameters?.workforceUnits !== undefined &&
      typeof context.parameters.workforceUnits === "number" &&
      Number.isSafeInteger(context.parameters.workforceUnits)
    ) {
      baseUnits = Math.max(0, context.parameters.workforceUnits);
      reasons.push(`Workforce units applied: ${baseUnits}`);
      breakdown.push({ step: "workforce_units", delta: baseUnits });
    } else {
      // Default standard advance of 0 units when unspecified
      baseUnits = 0;
      reasons.push("No explicit or workforce units specified; progress delta is 0");
      breakdown.push({ step: "default_units", delta: 0 });
    }

    // 2. Efficiency modifier from parameters if provided
    let effectiveUnits = baseUnits;
    if (
      context.parameters?.efficiency !== undefined &&
      typeof context.parameters.efficiency === "number" &&
      Number.isFinite(context.parameters.efficiency) &&
      context.parameters.efficiency >= 0
    ) {
      const modifier = context.parameters.efficiency;
      const adjusted = Math.floor(baseUnits * modifier);
      const diff = adjusted - baseUnits;
      if (diff !== 0) {
        effectiveUnits = adjusted;
        breakdown.push({
          step: "efficiency_adjustment",
          delta: diff,
          note: `Efficiency factor: ${modifier}`
        });
        reasons.push(`Efficiency factor ${modifier} adjusted progress by ${diff} units`);
      }
    }

    // 3. Contributor note if provided
    if (context.contributor) {
      reasons.push(
        `Contributor ${context.contributor.type}:${context.contributor.ref}${context.contributor.label ? ` (${context.contributor.label})` : ""}`
      );
    }

    // 4. Determine reasonCode
    let reasonCode = "STANDARD_PROGRESS";
    if (effectiveUnits < 0) {
      reasonCode = "PROGRESS_SETBACK";
    } else if (effectiveUnits === 0) {
      reasonCode = "NO_PROGRESS";
    }

    const effectiveWorkforce = typeof context.parameters?.workforceUnits === "number"
      ? context.parameters.workforceUnits
      : undefined;

    const resolution: ProjectProgressResolution = Object.freeze({
      deltaWork: effectiveUnits,
      reasonCode,
      reasons: Object.freeze(reasons),
      warnings: Object.freeze(warnings),
      effectiveWorkforce,
      breakdown: Object.freeze(breakdown),
      metadata: context.parameters ? Object.freeze({ ...context.parameters }) : undefined
    });

    return ok(resolution);
  }
}
