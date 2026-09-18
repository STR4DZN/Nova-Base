import type { TransactionRecord } from "./transaction-record.js";
import type { IdentifiedJournalEntryDocumentLike } from "../storage/repositories/domain-repository.js";

export const TRANSACTION_STORAGE_SCHEMA_VERSION = 1;
export const TRANSACTION_DOCUMENT_NAME = "[Domain Manager] Transaction Store";
export const TRANSACTION_FLAG_NAMESPACE = "domain-manager-transactions";

export interface TransactionSnapshot {
  readonly schemaVersion: number;
  readonly records: readonly TransactionRecord[];
  readonly updatedAt: number;
}

export interface TransactionStorageAdapter {
  loadSnapshot(): Promise<TransactionSnapshot | null>;
  saveSnapshot(snapshot: TransactionSnapshot): Promise<void>;
}

export interface InMemoryTransactionState {
  snapshot: TransactionSnapshot | null;
}

export class InMemoryTransactionStorageAdapter implements TransactionStorageAdapter {
  readonly #state: InMemoryTransactionState;

  constructor(state?: InMemoryTransactionState) {
    this.#state = state ?? { snapshot: null };
  }

  async loadSnapshot(): Promise<TransactionSnapshot | null> {
    return this.#state.snapshot ? structuredClone(this.#state.snapshot) : null;
  }

  async saveSnapshot(snapshot: TransactionSnapshot): Promise<void> {
    this.#state.snapshot = structuredClone(snapshot);
  }

  get state(): InMemoryTransactionState {
    return this.#state;
  }
}

export interface FoundryTransactionJournalRuntime {
  readonly journal: {
    readonly contents: readonly IdentifiedJournalEntryDocumentLike[];
    get(id: string): IdentifiedJournalEntryDocumentLike | undefined;
  };
  createJournalEntry(data: {
    readonly name: string;
    readonly flags: Readonly<Record<string, unknown>>;
  }): Promise<IdentifiedJournalEntryDocumentLike | null | undefined>;
}

function runtimeFromGlobals(): FoundryTransactionJournalRuntime | undefined {
  const globals = globalThis as unknown as {
    game?: {
      journal?: {
        readonly contents: readonly IdentifiedJournalEntryDocumentLike[];
        get(id: string): IdentifiedJournalEntryDocumentLike | undefined;
      };
    };
    JournalEntry?: {
      create(data: {
        readonly name: string;
        readonly flags: Readonly<Record<string, unknown>>;
      }): Promise<IdentifiedJournalEntryDocumentLike | null | undefined>;
    };
  };

  const journal = globals.game?.journal;
  const JournalEntry = globals.JournalEntry;
  if (!journal || !JournalEntry || typeof JournalEntry.create !== "function") {
    return undefined;
  }

  return {
    journal,
    createJournalEntry: (data) => JournalEntry.create(data)
  };
}

export class FoundryJournalTransactionStorageAdapter implements TransactionStorageAdapter {
  readonly #runtime: FoundryTransactionJournalRuntime | undefined;
  #documentId?: string;

  constructor(runtime?: FoundryTransactionJournalRuntime) {
    this.#runtime = runtime ?? runtimeFromGlobals();
  }

  async loadSnapshot(): Promise<TransactionSnapshot | null> {
    if (!this.#runtime) {
      return null;
    }

    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }

    this.#documentId = doc.id;
    const rawFlag = (doc.flags as any)?.[TRANSACTION_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }

    return rawFlag as TransactionSnapshot;
  }

  async saveSnapshot(snapshot: TransactionSnapshot): Promise<void> {
    if (!this.#runtime) {
      return;
    }

    let doc = this.#findDocument();
    if (!doc) {
      const created = await this.#runtime.createJournalEntry({
        name: TRANSACTION_DOCUMENT_NAME,
        flags: {
          [TRANSACTION_FLAG_NAMESPACE]: snapshot
        }
      });
      if (created) {
        this.#documentId = created.id;
      }
      return;
    }

    this.#documentId = doc.id;
    await doc.update({
      [`flags.${TRANSACTION_FLAG_NAMESPACE}`]: snapshot
    });
  }

  #findDocument(): IdentifiedJournalEntryDocumentLike | undefined {
    if (!this.#runtime) return undefined;
    if (this.#documentId) {
      const doc = this.#runtime.journal.get(this.#documentId);
      if (doc) return doc;
    }
    return this.#runtime.journal.contents.find((d) => d.name === TRANSACTION_DOCUMENT_NAME);
  }
}
