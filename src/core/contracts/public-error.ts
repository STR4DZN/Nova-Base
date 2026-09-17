export type PublicErrorCategory =
  | "validation"
  | "permission"
  | "conflict"
  | "not-found"
  | "busy"
  | "provider"
  | "timeout"
  | "integrity"
  | "recovery"
  | "internal";

export const PUBLIC_ERROR_CATEGORIES: readonly PublicErrorCategory[] = [
  "validation", "permission", "conflict", "not-found", "busy",
  "provider", "timeout", "integrity", "recovery", "internal"
];

export function isPublicErrorCategory(value: unknown): value is PublicErrorCategory {
  return typeof value === "string" && PUBLIC_ERROR_CATEGORIES.includes(value as PublicErrorCategory);
}

export interface PublicError {
  readonly code: `DM_${string}`;
  readonly category: PublicErrorCategory;
  readonly message: string;
  readonly details?: unknown;
  readonly retryable?: boolean;
  readonly userActionRequired?: boolean;
  readonly correlationId?: string;
}

export interface Warning {
  readonly code: `DM_${string}`;
  readonly message: string;
  readonly details?: unknown;
}

export function createPublicError(
  error: PublicError
): PublicError {
  return Object.freeze({ ...error });
}

export function isPublicError(value: unknown): value is PublicError {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<PublicError>;
  return (
    typeof candidate.code === "string" &&
    candidate.code.startsWith("DM_") &&
    isPublicErrorCategory(candidate.category) &&
    typeof candidate.message === "string" &&
    (candidate.retryable === undefined || typeof candidate.retryable === "boolean") &&
    (candidate.userActionRequired === undefined || typeof candidate.userActionRequired === "boolean") &&
    (candidate.correlationId === undefined || typeof candidate.correlationId === "string")
  );
}
