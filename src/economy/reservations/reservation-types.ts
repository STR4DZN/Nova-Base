import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { isNamespacedResourceId } from "../definitions/resource-definition-types.js";

export type ReservationStatus =
  | "active"
  | "partially-consumed"
  | "consumed"
  | "released"
  | "expired";

export const CANONICAL_RESERVATION_STATUSES: readonly ReservationStatus[] = Object.freeze([
  "active",
  "partially-consumed",
  "consumed",
  "released",
  "expired"
]);

export type ReservationEventType =
  | "created"
  | "partially-consumed"
  | "consumed"
  | "released"
  | "expired"
  | "adjusted";

export const CANONICAL_RESERVATION_EVENT_TYPES: readonly ReservationEventType[] = Object.freeze([
  "created",
  "partially-consumed",
  "consumed",
  "released",
  "expired",
  "adjusted"
]);

export interface ReservationEvent {
  readonly id: string; // reve_*
  readonly reservationId: string;
  readonly type: ReservationEventType;
  readonly deltaMinor: number; // change to remainingAmountMinor
  readonly remainingAmountMinor: number;
  readonly timestampReal: number;
  readonly timestampWorld?: number | null;
  readonly reason?: string;
  readonly sourceRef?: string;
  readonly userId?: string;
}

export interface ReservationSource {
  readonly type: string;
  readonly ref?: string;
  readonly reason?: string;
  readonly userId?: string;
}

export interface Reservation {
  readonly id: string; // resv_*
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly originalAmountMinor: number; // safe integer > 0
  readonly remainingAmountMinor: number; // safe integer >= 0, <= originalAmountMinor
  readonly status: ReservationStatus;
  readonly source: ReservationSource;
  readonly createdAtReal: number;
  readonly createdAtWorld?: number | null;
  readonly expiresAtWorld?: number | null;
  readonly expiresAtReal?: number | null;
  readonly revision: number;
}

export function validateReservation(raw: unknown): Result<Reservation, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: "Reservation must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. ID (resv_*)
  if (typeof candidate.id !== "string" || !candidate.id.startsWith("resv_")) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `Reservation ID must start with 'resv_': received '${String(candidate.id)}'`
      })
    );
  }

  // 2. domainUuid
  if (typeof candidate.domainUuid !== "string" || candidate.domainUuid.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: "Reservation domainUuid must be a non-empty string"
      })
    );
  }

  // 3. resourceId
  if (!isNamespacedResourceId(candidate.resourceId)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `Reservation resourceId must be namespaced: received '${String(candidate.resourceId)}'`
      })
    );
  }

  // 4. originalAmountMinor (> 0 safe integer)
  const orig = candidate.originalAmountMinor;
  if (typeof orig !== "number" || !Number.isSafeInteger(orig) || orig <= 0) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `originalAmountMinor must be a positive safe integer (> 0): received '${String(orig)}'`
      })
    );
  }

  // 5. remainingAmountMinor (>= 0 safe integer, <= original)
  const remaining = candidate.remainingAmountMinor;
  if (
    typeof remaining !== "number" ||
    !Number.isSafeInteger(remaining) ||
    remaining < 0 ||
    remaining > orig
  ) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `remainingAmountMinor must be between 0 and originalAmountMinor (${orig}): received '${String(remaining)}'`
      })
    );
  }

  // 6. status
  const status = candidate.status as ReservationStatus;
  if (!CANONICAL_RESERVATION_STATUSES.includes(status)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `Invalid reservation status: received '${String(status)}'`
      })
    );
  }

  // Consistency between remaining and status
  if (remaining === 0 && (status === "active" || status === "partially-consumed")) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `Reservation with 0 remaining amount cannot have status '${status}'`
      })
    );
  }

  // 7. source
  if (!candidate.source || typeof candidate.source !== "object") {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: "Reservation source must be an object"
      })
    );
  }
  const rawSource = candidate.source as Record<string, unknown>;
  if (typeof rawSource.type !== "string" || rawSource.type.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: "Reservation source.type must be a non-empty string"
      })
    );
  }

  const source: ReservationSource = {
    type: rawSource.type.trim(),
    ...(typeof rawSource.ref === "string" ? { ref: rawSource.ref.trim() } : {}),
    ...(typeof rawSource.reason === "string" ? { reason: rawSource.reason.trim() } : {}),
    ...(typeof rawSource.userId === "string" ? { userId: rawSource.userId.trim() } : {})
  };

  // 8. revision
  const revision = typeof candidate.revision === "number" ? candidate.revision : 0;

  return ok({
    id: candidate.id,
    domainUuid: candidate.domainUuid.trim(),
    resourceId: candidate.resourceId,
    originalAmountMinor: orig,
    remainingAmountMinor: remaining,
    status,
    source,
    createdAtReal: typeof candidate.createdAtReal === "number" ? candidate.createdAtReal : Date.now(),
    ...(typeof candidate.createdAtWorld === "number" ? { createdAtWorld: candidate.createdAtWorld } : {}),
    ...(typeof candidate.expiresAtWorld === "number" ? { expiresAtWorld: candidate.expiresAtWorld } : {}),
    ...(typeof candidate.expiresAtReal === "number" ? { expiresAtReal: candidate.expiresAtReal } : {}),
    revision
  });
}
