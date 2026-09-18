import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { isNamespacedResourceId } from "../definitions/resource-definition-types.js";

export type LedgerEntryKind =
  | "opening-balance"
  | "adjustment"
  | "transfer-debit"
  | "transfer-credit"
  | "consumption"
  | "production"
  | "income"
  | "upkeep"
  | "fee"
  | "waste"
  | "decay"
  | "conversion-debit"
  | "conversion-credit"
  | "reversal"
  | "migration";

export const CANONICAL_LEDGER_KINDS: readonly LedgerEntryKind[] = Object.freeze([
  "opening-balance",
  "adjustment",
  "transfer-debit",
  "transfer-credit",
  "consumption",
  "production",
  "income",
  "upkeep",
  "fee",
  "waste",
  "decay",
  "conversion-debit",
  "conversion-credit",
  "reversal",
  "migration"
]);

export interface LedgerEntrySource {
  readonly type: string;
  readonly ref?: string;
  readonly reason?: string;
  readonly userId?: string;
}

export interface LedgerEntry {
  readonly id: string; // led_*
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly deltaMinor: number; // safe integer, non-zero
  readonly kind: LedgerEntryKind;
  readonly timestampReal: number;
  readonly timestampWorld?: number | null;
  readonly transactionId?: string;
  readonly reservationId?: string;
  readonly reversesEntryId?: string;
  readonly source: LedgerEntrySource;
  readonly sequence: number;
}

/**
 * Preview intent before commit. Used by EconomyPlan to compute before/after projections.
 */
export interface LedgerIntent {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly deltaMinor: number;
  readonly kind: LedgerEntryKind;
  readonly source: LedgerEntrySource;
  readonly reservationId?: string;
}

export function validateLedgerEntry(raw: unknown): Result<LedgerEntry, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. ID (led_*)
  if (typeof candidate.id !== "string" || !candidate.id.startsWith("led_")) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: `LedgerEntry ID must start with 'led_': received '${String(candidate.id)}'`
      })
    );
  }

  // 2. domainUuid
  if (typeof candidate.domainUuid !== "string" || candidate.domainUuid.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry domainUuid must be a non-empty string"
      })
    );
  }

  // 3. resourceId
  if (!isNamespacedResourceId(candidate.resourceId)) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: `LedgerEntry resourceId must be namespaced: received '${String(candidate.resourceId)}'`
      })
    );
  }

  // 4. deltaMinor (safe integer, non-zero per DEC-17114)
  const delta = candidate.deltaMinor;
  if (typeof delta !== "number" || !Number.isSafeInteger(delta) || delta === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: `LedgerEntry deltaMinor must be a non-zero safe integer: received '${String(delta)}'`
      })
    );
  }

  // 5. kind
  const kind = candidate.kind as LedgerEntryKind;
  if (!CANONICAL_LEDGER_KINDS.includes(kind)) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: `Invalid LedgerEntry kind: received '${String(kind)}'`
      })
    );
  }

  // 6. sequence
  const sequence = candidate.sequence;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry sequence must be a positive safe integer >= 1"
      })
    );
  }

  // 7. timestampReal
  const timestampReal = candidate.timestampReal;
  if (typeof timestampReal !== "number" || !Number.isFinite(timestampReal)) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry timestampReal must be a finite number"
      })
    );
  }

  // 8. source
  if (!candidate.source || typeof candidate.source !== "object") {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry source must be an object"
      })
    );
  }
  const rawSource = candidate.source as Record<string, unknown>;
  if (typeof rawSource.type !== "string" || rawSource.type.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry source.type must be a non-empty string"
      })
    );
  }

  const source: LedgerEntrySource = {
    type: rawSource.type.trim(),
    ...(typeof rawSource.ref === "string" ? { ref: rawSource.ref.trim() } : {}),
    ...(typeof rawSource.reason === "string" ? { reason: rawSource.reason.trim() } : {}),
    ...(typeof rawSource.userId === "string" ? { userId: rawSource.userId.trim() } : {})
  };

  return ok({
    id: candidate.id,
    domainUuid: candidate.domainUuid.trim(),
    resourceId: candidate.resourceId,
    deltaMinor: delta,
    kind,
    timestampReal,
    ...(typeof candidate.timestampWorld === "number" ? { timestampWorld: candidate.timestampWorld } : {}),
    ...(typeof candidate.transactionId === "string" ? { transactionId: candidate.transactionId } : {}),
    ...(typeof candidate.reservationId === "string" ? { reservationId: candidate.reservationId } : {}),
    ...(typeof candidate.reversesEntryId === "string" ? { reversesEntryId: candidate.reversesEntryId } : {}),
    source,
    sequence
  });
}
