import type { IdentifiedJournalEntryDocumentLike } from "../../storage/repositories/domain-repository.js";

export const MANUAL_CURRENCY_STORAGE_SCHEMA_VERSION = 1;
export const MANUAL_CURRENCY_DOCUMENT_NAME = "[Domain Manager] Manual Currency Store";
export const MANUAL_CURRENCY_FLAG_NAMESPACE = "domain-manager-manual-currency";

export interface ManualCurrencySnapshot {
  readonly schemaVersion: number;
  readonly balances: Readonly<Record<string, number>>;
  readonly operations?: Readonly<Record<string, { deltaMinor: number; timestamp: number }>>;
  readonly updatedAt: number;
}

export interface ManualCurrencyStorageAdapter {
  loadSnapshot(): Promise<ManualCurrencySnapshot | null>;
  saveSnapshot(snapshot: ManualCurrencySnapshot): Promise<void>;
}

export interface InMemoryManualCurrencyState {
  snapshot: ManualCurrencySnapshot | null;
}

export class InMemoryManualCurrencyStorageAdapter implements ManualCurrencyStorageAdapter {
  readonly #state: InMemoryManualCurrencyState;

  constructor(state?: InMemoryManualCurrencyState) {
    this.#state = state ?? { snapshot: null };
  }

  async loadSnapshot(): Promise<ManualCurrencySnapshot | null> {
    return this.#state.snapshot ? structuredClone(this.#state.snapshot) : null;
  }

  async saveSnapshot(snapshot: ManualCurrencySnapshot): Promise<void> {
    this.#state.snapshot = structuredClone(snapshot);
  }

  get state(): InMemoryManualCurrencyState {
    return this.#state;
  }
}

export interface FoundryManualCurrencyJournalRuntime {
  readonly journal: {
    readonly contents: readonly IdentifiedJournalEntryDocumentLike[];
    get(id: string): IdentifiedJournalEntryDocumentLike | undefined;
  };
  createJournalEntry(data: {
    readonly name: string;
    readonly flags: Readonly<Record<string, unknown>>;
  }): Promise<IdentifiedJournalEntryDocumentLike | null | undefined>;
}

function runtimeFromGlobals(): FoundryManualCurrencyJournalRuntime | undefined {
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

export class FoundryJournalManualCurrencyStorageAdapter implements ManualCurrencyStorageAdapter {
  readonly #runtime: FoundryManualCurrencyJournalRuntime | undefined;
  #documentId?: string;

  constructor(runtime?: FoundryManualCurrencyJournalRuntime) {
    this.#runtime = runtime ?? runtimeFromGlobals();
  }

  async loadSnapshot(): Promise<ManualCurrencySnapshot | null> {
    if (!this.#runtime) {
      return null;
    }

    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }

    this.#documentId = doc.id;
    const rawFlag = (doc.flags as any)?.[MANUAL_CURRENCY_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }

    return rawFlag as ManualCurrencySnapshot;
  }

  async saveSnapshot(snapshot: ManualCurrencySnapshot): Promise<void> {
    if (!this.#runtime) {
      return;
    }

    let doc = this.#findDocument();
    if (doc) {
      this.#documentId = doc.id;
      if (typeof doc.update === "function") {
        await doc.update({
          flags: {
            [MANUAL_CURRENCY_FLAG_NAMESPACE]: snapshot
          }
        });
      }
    } else {
      const created = await this.#runtime.createJournalEntry({
        name: MANUAL_CURRENCY_DOCUMENT_NAME,
        flags: {
          [MANUAL_CURRENCY_FLAG_NAMESPACE]: snapshot
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
        d.name === MANUAL_CURRENCY_DOCUMENT_NAME ||
        Boolean((d.flags as any)?.[MANUAL_CURRENCY_FLAG_NAMESPACE])
    );
  }
}
