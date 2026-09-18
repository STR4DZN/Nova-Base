import { createPublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";

export interface WorkforceType {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export const DEFAULT_WORKFORCE_TYPES: readonly WorkforceType[] = Object.freeze([
  {
    id: "general",
    label: "General Labor",
    description: "Unspecialized physical, maintenance, and civil labor"
  },
  {
    id: "military",
    label: "Military Forces",
    description: "Trained garrison guards, levies, and defense personnel"
  },
  {
    id: "craftsmen",
    label: "Craftsmen & Builders",
    description: "Skilled artisans, construction workers, and technicians"
  },
  {
    id: "scholars",
    label: "Scholars & Administrators",
    description: "Clerks, researchers, scribes, and administrative staff"
  }
]);

export interface WorkforceContribution {
  readonly workforceTypeId: string;
  readonly amount: number;
}

export interface WorkforceContributionProvenance {
  readonly sourceId: string;
  readonly sourceType: "population-group" | "operational-group" | "notable";
  readonly sourceName: string;
  readonly amount: number;
  readonly deductedFromLinked?: boolean;
}

export interface WorkforceTypeResolution {
  readonly workforceTypeId: string;
  readonly capacity: number;
  readonly committed: number;
  readonly reserved: number;
  readonly available: number;
  readonly isOvercommitted: boolean;
  readonly contributions: readonly WorkforceContributionProvenance[];
}

export interface WorkforceReport {
  readonly types: Readonly<Record<string, WorkforceTypeResolution>>;
  readonly totalCapacity: number;
  readonly totalCommitted: number;
  readonly totalReserved: number;
  readonly totalAvailable: number;
  readonly isAnyOvercommitted: boolean;
  readonly warnings: readonly string[];
}

export function validateWorkforceContribution(candidate: unknown): Result<WorkforceContribution> {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_WORKFORCE_INVALID_CONTRIBUTION",
        category: "validation",
        message: "WorkforceContribution must be an object"
      })
    );
  }

  const raw = candidate as Record<string, unknown>;

  if (typeof raw.workforceTypeId !== "string" || raw.workforceTypeId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_WORKFORCE_INVALID_TYPE",
        category: "validation",
        message: "workforceTypeId must be a non-empty string"
      })
    );
  }

  if (
    typeof raw.amount !== "number" ||
    !Number.isSafeInteger(raw.amount) ||
    raw.amount < 0
  ) {
    return err(
      createPublicError({
        code: "DM_WORKFORCE_INVALID_AMOUNT",
        category: "validation",
        message: "amount must be a non-negative safe integer"
      })
    );
  }

  return ok({
    workforceTypeId: raw.workforceTypeId.trim(),
    amount: raw.amount
  });
}
