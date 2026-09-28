import { normalizeJournalEntryId } from "../core/identity/refs.js";
import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { canonicalizeLockKeys } from "./lock-manager.js";

/**
 * Canonical Lock Key Factory for Domain Manager (Master Remediation §7, INV-01).
 * Single source of truth for all lock namespaces across commands, plans, transaction records, and recovery.
 */
export const lockKey = {
  domain(domainId: string): string {
    return `domain:${normalizeJournalEntryId(domainId)}`;
  },

  project(projectId: string): string {
    return `project:${projectId}`;
  },

  downtime(activityId: string): string {
    return `downtime:${activityId}`;
  },

  facility(facilityId: string): string {
    return `facility:${facilityId}`;
  }
} as const;

/**
 * Checks whether two collections of lock keys are identical after canonicalization.
 */
export function areLockSetsEqual(
  a: readonly string[],
  b: readonly string[]
): boolean {
  const canonA = canonicalizeLockKeys(a);
  const canonB = canonicalizeLockKeys(b);
  if (canonA.length !== canonB.length) return false;
  for (let i = 0; i < canonA.length; i++) {
    if (canonA[i] !== canonB[i]) return false;
  }
  return true;
}

/**
 * Asserts that two collections of lock keys match exactly after canonicalization (Master Remediation §8, §9).
 * Fails closed with DM_TX_LOCKSET_DIVERGENCE if any divergence is found.
 */
export function assertSameCanonicalLockSet(
  actual: readonly string[],
  expected: readonly string[],
  contextDescription?: string
): Result<void, PublicError> {
  const canonActual = canonicalizeLockKeys(actual);
  const canonExpected = canonicalizeLockKeys(expected);

  if (!areLockSetsEqual(canonActual, canonExpected)) {
    return err(
      createPublicError({
        code: "DM_TX_LOCKSET_DIVERGENCE",
        category: "internal",
        message: `Lock-set divergence${contextDescription ? ` in ${contextDescription}` : ""}: expected [${canonExpected.join(", ")}], received [${canonActual.join(", ")}]`,
        details: {
          expected: canonExpected,
          actual: canonActual,
          context: contextDescription
        }
      })
    );
  }

  return ok(undefined);
}

/**
 * Validates that no forbidden lock namespaces (such as legacy 'activity:') are used (Master Remediation §6, §7).
 */
export function assertNoForbiddenLockKeys(
  keys: readonly string[]
): Result<void, PublicError> {
  for (const k of keys) {
    if (typeof k === "string" && k.startsWith("activity:")) {
      return err(
        createPublicError({
          code: "DM_TX_LOCKSET_DIVERGENCE",
          category: "internal",
          message: `Forbidden lock namespace 'activity:' found in key '${k}'. Downtime activities MUST use 'downtime:' namespace (Master Remediation §6).`,
          details: { key: k }
        })
      );
    }
  }
  return ok(undefined);
}
