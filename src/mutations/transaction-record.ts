import type { CommandId } from "../commands/command-envelope.js";
import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";

/**
 * Normative Transaction states as defined by Master Spec §11.7, DEC-655–660.
 */
export type TransactionState =
  | "planned"
  | "claimed"
  | "prepared"
  | "committing"
  | "committed"
  | "needs-recovery"
  | "compensating"
  | "compensated"
  | "failed";

export const FINAL_TRANSACTION_STATES: ReadonlySet<TransactionState> = new Set([
  "committed",
  "compensated",
  "failed"
]);

export interface TransactionTransitionEntry {
  readonly fromState: TransactionState;
  readonly toState: TransactionState;
  readonly timestamp: number;
  readonly authorityEpoch: number;
  readonly reason?: string;
}

export interface TransactionRecord {
  readonly transactionId: string;
  readonly commandId: CommandId;
  readonly authorityEpoch: number;
  readonly state: TransactionState;
  readonly lockKeys: readonly string[];
  readonly safeAutoRecovery: boolean;
  readonly recoveryData?: unknown;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly history: readonly TransactionTransitionEntry[];
}

const VALID_TRANSITIONS: Readonly<Record<TransactionState, ReadonlySet<TransactionState>>> = {
  planned: new Set(["claimed", "failed"]),
  claimed: new Set(["prepared", "failed", "needs-recovery"]),
  prepared: new Set(["committing", "compensating", "failed", "needs-recovery"]),
  committing: new Set(["committed", "needs-recovery", "compensating", "failed"]),
  committed: new Set([]), // Final
  "needs-recovery": new Set(["compensating", "committing", "compensated", "failed"]),
  compensating: new Set(["compensated", "committed", "needs-recovery", "failed"]),
  compensated: new Set([]), // Final
  failed: new Set([]) // Final
};

export function isFinalTransactionState(state: TransactionState): boolean {
  return FINAL_TRANSACTION_STATES.has(state);
}

export function isValidTransactionTransition(
  from: TransactionState,
  to: TransactionState
): boolean {
  return VALID_TRANSITIONS[from]?.has(to) ?? false;
}

export function createTransactionRecord(params: {
  transactionId?: string;
  commandId: CommandId;
  authorityEpoch: number;
  lockKeys: readonly string[];
  safeAutoRecovery?: boolean;
  recoveryData?: unknown;
  now?: number;
}): TransactionRecord {
  const now = params.now ?? Date.now();
  const transactionId =
    params.transactionId ?? `tx_${params.commandId}_${now}`;

  return Object.freeze({
    transactionId,
    commandId: params.commandId,
    authorityEpoch: params.authorityEpoch,
    state: "planned",
    lockKeys: Object.freeze([...params.lockKeys]),
    safeAutoRecovery: params.safeAutoRecovery ?? false,
    recoveryData: params.recoveryData,
    createdAt: now,
    updatedAt: now,
    history: Object.freeze([])
  });
}

export function transitionTransactionState(
  record: TransactionRecord,
  toState: TransactionState,
  authorityEpoch: number,
  reason?: string,
  now: number = Date.now()
): Result<TransactionRecord, PublicError> {
  if (!isValidTransactionTransition(record.state, toState)) {
    return err(
      createPublicError({
        code: "DM_TRANSACTION_INVALID_TRANSITION",
        category: "internal",
        message: `Invalid transaction transition from '${record.state}' to '${toState}' for transaction '${record.transactionId}'`
      })
    );
  }

  const transition: TransactionTransitionEntry = {
    fromState: record.state,
    toState,
    timestamp: now,
    authorityEpoch,
    reason
  };

  const updated: TransactionRecord = Object.freeze({
    ...record,
    authorityEpoch,
    state: toState,
    updatedAt: now,
    history: Object.freeze([...record.history, transition])
  });

  return ok(updated);
}
