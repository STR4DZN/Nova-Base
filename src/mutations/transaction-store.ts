import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, type Result } from "../core/contracts/result.js";
import type { CommandId } from "../commands/command-envelope.js";
import {
  isFinalTransactionState,
  transitionTransactionState,
  type TransactionRecord,
  type TransactionState
} from "./transaction-record.js";

/**
 * Storage for transaction records with lifecycle transition enforcement.
 * (Master Spec §11.7, DEC-649–660).
 */
export class TransactionStore {
  readonly #records = new Map<string, TransactionRecord>();
  readonly #byCommandId = new Map<CommandId, string>();

  save(record: TransactionRecord): void {
    this.#records.set(record.transactionId, record);
    this.#byCommandId.set(record.commandId, record.transactionId);
  }

  get(transactionId: string): TransactionRecord | undefined {
    return this.#records.get(transactionId);
  }

  getByCommandId(commandId: CommandId): TransactionRecord | undefined {
    const txId = this.#byCommandId.get(commandId);
    return txId ? this.#records.get(txId) : undefined;
  }

  listUnresolved(): readonly TransactionRecord[] {
    const unresolved: TransactionRecord[] = [];
    for (const record of this.#records.values()) {
      if (!isFinalTransactionState(record.state)) {
        unresolved.push(record);
      }
    }
    return Object.freeze(unresolved);
  }

  transition(
    transactionId: string,
    toState: TransactionState,
    authorityEpoch: number,
    reason?: string,
    now: number = Date.now()
  ): Result<TransactionRecord, PublicError> {
    const existing = this.#records.get(transactionId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_TRANSACTION_NOT_FOUND",
          category: "not-found",
          message: `Transaction '${transactionId}' not found in TransactionStore`
        })
      );
    }

    const transitionRes = transitionTransactionState(
      existing,
      toState,
      authorityEpoch,
      reason,
      now
    );

    if (!transitionRes.ok) {
      return transitionRes;
    }

    this.save(transitionRes.value);
    return transitionRes;
  }

  clear(): void {
    this.#records.clear();
    this.#byCommandId.clear();
  }
}
