import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
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
  #persistQueue: Promise<void> = Promise.resolve();
  #lastPersistError: Error | null = null;

  constructor(options: TransactionStoreOptions | TransactionStorageAdapter = {}) {
    if ("storageAdapter" in options) {
      this.#storageAdapter = options.storageAdapter;
    } else if ("saveSnapshot" in options) {
      this.#storageAdapter = options as TransactionStorageAdapter;
    }
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

  /**
   * Persists a transaction record and confirms flush to durable storage (Master Remediation §18).
   */
  async saveDurable(record: TransactionRecord): Promise<Result<TransactionRecord, PublicError>> {
    this.save(record);
    try {
      await this.flush();
      return ok(this.get(record.transactionId) ?? record);
    } catch (flushErr) {
      return err(
        createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: `Failed to persist transaction '${record.transactionId}': ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
          details: flushErr
        })
      );
    }
  }

  /**
   * Applies an in-place patch to an existing transaction record with atomic durable persistence (Master Remediation §18).
   * Reverts in-memory change on flush failure.
   */
  async patchDurable(
    transactionId: string,
    patcher: (current: TransactionRecord) => TransactionRecord
  ): Promise<Result<TransactionRecord, PublicError>> {
    const current = this.get(transactionId);
    if (!current) {
      return err(
        createPublicError({
          code: "DM_TRANSACTION_NOT_FOUND",
          category: "not-found",
          message: `Transaction '${transactionId}' not found in TransactionStore`
        })
      );
    }
    const patched = patcher(current);
    this.save(patched);
    try {
      await this.flush();
      return ok(this.get(transactionId) ?? patched);
    } catch (flushErr) {
      this.save(current);
      return err(
        createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: `Failed to flush patched transaction '${transactionId}': ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
          details: flushErr
        })
      );
    }
  }

  /**
   * Executes a state transition and confirms durable persistence (Master Remediation §18).
   * Reverts in-memory state on flush failure.
   */
  async transitionDurable(
    transactionId: string,
    toState: TransactionState,
    authorityEpoch: number,
    reason?: string,
    now: number = Date.now()
  ): Promise<Result<TransactionRecord, PublicError>> {
    const current = this.get(transactionId);
    if (!current) {
      return err(
        createPublicError({
          code: "DM_TRANSACTION_NOT_FOUND",
          category: "not-found",
          message: `Transaction '${transactionId}' not found in TransactionStore`
        })
      );
    }

    const transitionRes = this.transition(transactionId, toState, authorityEpoch, reason, now);
    if (!transitionRes.ok) {
      return transitionRes;
    }

    try {
      await this.flush();
      return ok(this.get(transactionId) ?? transitionRes.value);
    } catch (flushErr) {
      this.save(current);
      return err(
        createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: `Failed to flush transaction transition from '${current.state}' to '${toState}' for '${transactionId}': ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
          details: flushErr
        })
      );
    }
  }

  async flush(): Promise<void> {
    if (!this.#storageAdapter) return;
    this.#schedulePersist();
    await this.#persistQueue;
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
    this.#persistQueue = this.#persistQueue
      .then(async () => {
        await this.#persist();
      })
      .catch((err: unknown) => {
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
