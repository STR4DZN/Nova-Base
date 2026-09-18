import { createPublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { isOpaqueId } from "../../core/identity/ids.js";

export type AssignmentStatus = "active" | "completed" | "cancelled";
export const ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = Object.freeze([
  "active",
  "completed",
  "cancelled"
]);

export function isAssignmentStatus(value: unknown): value is AssignmentStatus {
  return typeof value === "string" && ASSIGNMENT_STATUSES.includes(value as AssignmentStatus);
}

export interface Assignment {
  readonly id: string; // asg_<UUID>
  readonly sourceRef: string; // opg_*, pop_*, not_*
  readonly targetRef: string; // prj_*, fac_*, etc.
  readonly workforceTypeId: string;
  readonly amount: number; // >= 1
  readonly status: AssignmentStatus;
  readonly visibility?: "public" | "secret";
  readonly startedAtWorld?: number;
  readonly endsAtWorld?: number;
  readonly notes?: string;
}

export type ReservationStatus = "active" | "claimed" | "expired" | "released";
export const RESERVATION_STATUSES: readonly ReservationStatus[] = Object.freeze([
  "active",
  "claimed",
  "expired",
  "released"
]);

export function isReservationStatus(value: unknown): value is ReservationStatus {
  return typeof value === "string" && RESERVATION_STATUSES.includes(value as ReservationStatus);
}

export interface Reservation {
  readonly id: string; // resv_<UUID>
  readonly sourceRef: string; // opg_*, pop_*, not_*
  readonly targetRef: string;
  readonly workforceTypeId: string;
  readonly amount: number; // >= 1
  readonly status: ReservationStatus;
  readonly correlationId?: string;
  readonly visibility?: "public" | "secret";
  readonly expiresAtReal?: number;
  readonly expiresAtWorld?: number;
  readonly notes?: string;
}

export function validateAssignment(candidate: unknown): Result<Assignment> {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID",
        category: "validation",
        message: "Assignment must be an object"
      })
    );
  }

  const raw = candidate as Record<string, unknown>;

  if (!isOpaqueId(raw.id, "asg")) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_ID",
        category: "validation",
        message: `Assignment id must be an opaque ID with prefix 'asg_', received: '${String(raw.id)}'`
      })
    );
  }

  if (typeof raw.sourceRef !== "string" || raw.sourceRef.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_SOURCE",
        category: "validation",
        message: "sourceRef is required"
      })
    );
  }

  if (typeof raw.targetRef !== "string" || raw.targetRef.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_TARGET",
        category: "validation",
        message: "targetRef is required"
      })
    );
  }

  if (typeof raw.workforceTypeId !== "string" || raw.workforceTypeId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_WORKFORCE_TYPE",
        category: "validation",
        message: "workforceTypeId is required"
      })
    );
  }

  if (
    typeof raw.amount !== "number" ||
    !Number.isSafeInteger(raw.amount) ||
    raw.amount <= 0
  ) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_AMOUNT",
        category: "validation",
        message: "amount must be a positive safe integer"
      })
    );
  }

  const status: AssignmentStatus =
    raw.status === undefined ? "active" : (raw.status as AssignmentStatus);

  if (!isAssignmentStatus(status)) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_STATUS",
        category: "validation",
        message: `Invalid assignment status: '${String(raw.status)}'`
      })
    );
  }

  if (raw.visibility !== undefined && raw.visibility !== null) {
    if (raw.visibility !== "public" && raw.visibility !== "secret") {
      return err(
        createPublicError({
          code: "DM_ASSIGNMENT_INVALID_VISIBILITY",
          category: "validation",
          message: "Assignment visibility must be 'public' or 'secret'"
        })
      );
    }
  }

  let startedAtWorld: number | undefined;
  if (raw.startedAtWorld !== undefined && raw.startedAtWorld !== null) {
    if (typeof raw.startedAtWorld !== "number" || !Number.isFinite(raw.startedAtWorld)) {
      return err(
        createPublicError({
          code: "DM_ASSIGNMENT_INVALID_TIME",
          category: "validation",
          message: "startedAtWorld must be a finite number"
        })
      );
    }
    startedAtWorld = raw.startedAtWorld;
  }

  let endsAtWorld: number | undefined;
  if (raw.endsAtWorld !== undefined && raw.endsAtWorld !== null) {
    if (typeof raw.endsAtWorld !== "number" || !Number.isFinite(raw.endsAtWorld)) {
      return err(
        createPublicError({
          code: "DM_ASSIGNMENT_INVALID_TIME",
          category: "validation",
          message: "endsAtWorld must be a finite number"
        })
      );
    }
    endsAtWorld = raw.endsAtWorld;
  }

  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== "string") {
      return err(
        createPublicError({
          code: "DM_ASSIGNMENT_INVALID_NOTES",
          category: "validation",
          message: "notes must be a string"
        })
      );
    }
  }

  return ok({
    id: raw.id,
    sourceRef: raw.sourceRef.trim(),
    targetRef: raw.targetRef.trim(),
    workforceTypeId: raw.workforceTypeId.trim(),
    amount: raw.amount,
    status,
    visibility: raw.visibility === "secret" ? "secret" : "public",
    startedAtWorld,
    endsAtWorld,
    notes: typeof raw.notes === "string" ? raw.notes.trim() : undefined
  });
}

export function validateReservation(candidate: unknown): Result<Reservation> {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID",
        category: "validation",
        message: "Reservation must be an object"
      })
    );
  }

  const raw = candidate as Record<string, unknown>;

  if (!isOpaqueId(raw.id, "resv")) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_ID",
        category: "validation",
        message: `Reservation id must be an opaque ID with prefix 'resv_', received: '${String(raw.id)}'`
      })
    );
  }

  if (typeof raw.sourceRef !== "string" || raw.sourceRef.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_SOURCE",
        category: "validation",
        message: "sourceRef is required"
      })
    );
  }

  if (typeof raw.targetRef !== "string" || raw.targetRef.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_TARGET",
        category: "validation",
        message: "targetRef is required"
      })
    );
  }

  if (typeof raw.workforceTypeId !== "string" || raw.workforceTypeId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_WORKFORCE_TYPE",
        category: "validation",
        message: "workforceTypeId is required"
      })
    );
  }

  if (
    typeof raw.amount !== "number" ||
    !Number.isSafeInteger(raw.amount) ||
    raw.amount <= 0
  ) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_AMOUNT",
        category: "validation",
        message: "amount must be a positive safe integer"
      })
    );
  }

  const status: ReservationStatus =
    raw.status === undefined ? "active" : (raw.status as ReservationStatus);

  if (!isReservationStatus(status)) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_STATUS",
        category: "validation",
        message: `Invalid reservation status: '${String(raw.status)}'`
      })
    );
  }

  let expiresAtReal: number | undefined = undefined;
  if (raw.expiresAtReal !== undefined && raw.expiresAtReal !== null) {
    if (typeof raw.expiresAtReal !== "number" || !Number.isFinite(raw.expiresAtReal)) {
      return err(
        createPublicError({
          code: "DM_RESERVATION_INVALID_EXPIRY",
          category: "validation",
          message: "expiresAtReal must be a finite number"
        })
      );
    }
    expiresAtReal = raw.expiresAtReal;
  }

  let expiresAtWorld: number | undefined = undefined;
  if (raw.expiresAtWorld !== undefined && raw.expiresAtWorld !== null) {
    if (typeof raw.expiresAtWorld !== "number" || !Number.isFinite(raw.expiresAtWorld)) {
      return err(
        createPublicError({
          code: "DM_RESERVATION_INVALID_EXPIRY",
          category: "validation",
          message: "expiresAtWorld must be a finite number"
        })
      );
    }
    expiresAtWorld = raw.expiresAtWorld;
  }

  if (raw.visibility !== undefined && raw.visibility !== null) {
    if (raw.visibility !== "public" && raw.visibility !== "secret") {
      return err(
        createPublicError({
          code: "DM_RESERVATION_INVALID_VISIBILITY",
          category: "validation",
          message: "Reservation visibility must be 'public' or 'secret'"
        })
      );
    }
  }

  const correlationId = typeof raw.correlationId === "string" && raw.correlationId.trim().length > 0
    ? raw.correlationId.trim()
    : undefined;

  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== "string") {
      return err(
        createPublicError({
          code: "DM_RESERVATION_INVALID_NOTES",
          category: "validation",
          message: "notes must be a string"
        })
      );
    }
  }

  return ok({
    id: raw.id,
    sourceRef: raw.sourceRef.trim(),
    targetRef: raw.targetRef.trim(),
    workforceTypeId: raw.workforceTypeId.trim(),
    amount: raw.amount,
    status,
    correlationId,
    visibility: raw.visibility === "secret" ? "secret" : "public",
    expiresAtReal,
    expiresAtWorld,
    notes: typeof raw.notes === "string" ? raw.notes.trim() : undefined
  });
}
