import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, type Result } from "../core/contracts/result.js";
import type { CommandId } from "../commands/command-envelope.js";
import {
  isFinalTransactionState,
  transitionTransactionState,
  type TransactionRecord,
  type TransactionState
} from "./transaction-record.js";
import {
  TRANSACTION_STORAGE_SCHEMA_VERSION,
  type TransactionSnapshot,
  type TransactionStorageAdapter
} from "./transaction-storage-adapter.js";

export interface TransactionStoreOptions {
  readonly storageAdapter?: TransactionStorageAdapter;
}

/**
 * Storage for transaction records with lifecycle transition enforcement and durable persistence.
 * (Master Spec §11.7, DEC-649–660, G4-AUD-002).
 */
export class TransactionStore {
  readonly #records = new Map<string, TransactionRecord>();
  readonly #byCommandId = new Map<CommandId, string>();
  readonly #storageAdapter?: TransactionStorageAdapter;
  #pendingPersist: Promise<void> | null = null;
  #lastPersistError: Error | null = null;

  constructor(options: TransactionStoreOptions = {}) {
    this.#storageAdapter = options.storageAdapter;
  }

  async rehydrate(): Promise<void> {
    if (!this.#storageAdapter) return;
    const snapshot = await this.#storageAdapter.loadSnapshot();
    if (snapshot) {
      this.#records.clear();
      this.#byCommandId.clear();
      for (const record of snapshot.records) {
        this.#records.set(record.transactionId, record);
        this.#byCommandId.set(record.commandId, record.transactionId);
      }
    }
  }

  save(record: TransactionRecord): void {
    this.#records.set(record.transactionId, record);
    this.#byCommandId.set(record.commandId, record.transactionId);
    this.#schedulePersist();
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

  listAll(): readonly TransactionRecord[] {
    return Object.freeze(Array.from(this.#records.values()));
  }

  get count(): number {
    return this.#records.size;
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

  async flush(): Promise<void> {
    if (this.#pendingPersist) {
      await this.#pendingPersist;
    }
    if (this.#lastPersistError) {
      const err = this.#lastPersistError;
      this.#lastPersistError = null;
      throw err;
    }
  }

  clear(): void {
    this.#records.clear();
    this.#byCommandId.clear();
    this.#schedulePersist();
  }

  #schedulePersist(): void {
    if (!this.#storageAdapter) return;
    this.#pendingPersist = this.#persist().catch((err: unknown) => {
      this.#lastPersistError = err instanceof Error ? err : new Error(String(err));
    });
  }

  async #persist(): Promise<void> {
    if (!this.#storageAdapter) return;
    const snapshot: TransactionSnapshot = {
      schemaVersion: TRANSACTION_STORAGE_SCHEMA_VERSION,
      records: Array.from(this.#records.values()),
      updatedAt: Date.now()
    };
    await this.#storageAdapter.saveSnapshot(snapshot);
  }
}
