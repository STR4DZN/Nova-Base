import type { LedgerEntry } from "../ledger/ledger-types.js";
import type { IdentifiedJournalEntryDocumentLike } from "../../storage/repositories/domain-repository.js";

export const LEDGER_STORAGE_SCHEMA_VERSION = 1;
export const LEDGER_DOCUMENT_NAME = "[Domain Manager] Ledger Store";
export const LEDGER_FLAG_NAMESPACE = "domain-manager-ledger";

export interface LedgerSnapshot {
  readonly schemaVersion: number;
  readonly entries: readonly LedgerEntry[];
  readonly reversedTargetIds: readonly string[];
  readonly nextSequence: number;
  readonly updatedAt: number;
}

export interface LedgerStorageAdapter {
  loadSnapshot(): Promise<LedgerSnapshot | null>;
  saveSnapshot(snapshot: LedgerSnapshot): Promise<void>;
}

/**
 * Shared state container allowing tests to simulate process restarts
 * by creating new store/adapter instances pointing to the same state.
 */
export interface InMemoryLedgerState {
  snapshot: LedgerSnapshot | null;
}

export class InMemoryLedgerStorageAdapter implements LedgerStorageAdapter {
  readonly #state: InMemoryLedgerState;

  constructor(state?: InMemoryLedgerState) {
    this.#state = state ?? { snapshot: null };
  }

  async loadSnapshot(): Promise<LedgerSnapshot | null> {
    return this.#state.snapshot ? structuredClone(this.#state.snapshot) : null;
  }

  async saveSnapshot(snapshot: LedgerSnapshot): Promise<void> {
    this.#state.snapshot = structuredClone(snapshot);
  }

  get state(): InMemoryLedgerState {
    return this.#state;
  }
}

export interface FoundryLedgerJournalRuntime {
  readonly journal: {
    readonly contents: readonly IdentifiedJournalEntryDocumentLike[];
    get(id: string): IdentifiedJournalEntryDocumentLike | undefined;
  };
  createJournalEntry(data: {
    readonly name: string;
    readonly flags: Readonly<Record<string, unknown>>;
  }): Promise<IdentifiedJournalEntryDocumentLike | null | undefined>;
}

function runtimeFromGlobals(): FoundryLedgerJournalRuntime | undefined {
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

export class FoundryJournalLedgerStorageAdapter implements LedgerStorageAdapter {
  readonly #runtime: FoundryLedgerJournalRuntime | undefined;
  #documentId?: string;

  constructor(runtime?: FoundryLedgerJournalRuntime) {
    this.#runtime = runtime ?? runtimeFromGlobals();
  }

  async loadSnapshot(): Promise<LedgerSnapshot | null> {
    if (!this.#runtime) {
      return null;
    }

    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }

    this.#documentId = doc.id;
    const rawFlag = (doc.flags as any)?.[LEDGER_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }

    return rawFlag as LedgerSnapshot;
  }

  async saveSnapshot(snapshot: LedgerSnapshot): Promise<void> {
    if (!this.#runtime) {
      return;
    }

    let doc = this.#findDocument();
    if (doc) {
      this.#documentId = doc.id;
      if (typeof doc.update === "function") {
        await doc.update({
          flags: {
            [LEDGER_FLAG_NAMESPACE]: snapshot
          }
        });
      }
    } else {
      const created = await this.#runtime.createJournalEntry({
        name: LEDGER_DOCUMENT_NAME,
        flags: {
          [LEDGER_FLAG_NAMESPACE]: snapshot
        }
      });
      if (created) {
        this.#documentId = created.id;
      }
    }
  }

  #findDocument(): IdentifiedJournalEntryDocumentLike | undefined {
    if (!this.#runtime) return undefined;
    if (this.#documentId) {
      const found = this.#runtime.journal.get(this.#documentId);
      if (found) return found;
    }
    return this.#runtime.journal.contents.find(
      (d) =>
        d.name === LEDGER_DOCUMENT_NAME ||
        Boolean((d.flags as any)?.[LEDGER_FLAG_NAMESPACE])
    );
  }
}
