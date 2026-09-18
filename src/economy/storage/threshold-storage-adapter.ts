import type { IdentifiedJournalEntryDocumentLike } from "../../storage/repositories/domain-repository.js";
import type { ThresholdDefinition } from "../thresholds/threshold-service.js";

export const THRESHOLD_STORAGE_SCHEMA_VERSION = 1;
export const THRESHOLD_DOCUMENT_NAME = "[Domain Manager] Threshold Store";
export const THRESHOLD_FLAG_NAMESPACE = "domain-manager-thresholds";

export interface ThresholdSnapshot {
  readonly schemaVersion: number;
  readonly thresholds: readonly ThresholdDefinition[];
  readonly crossedStates?: Readonly<Record<string, boolean>>;
  readonly updatedAt: number;
}

export interface ThresholdStorageAdapter {
  loadSnapshot(): Promise<ThresholdSnapshot | null>;
  saveSnapshot(snapshot: ThresholdSnapshot): Promise<void>;
}

export interface InMemoryThresholdState {
  snapshot: ThresholdSnapshot | null;
}

export class InMemoryThresholdStorageAdapter implements ThresholdStorageAdapter {
  readonly #state: InMemoryThresholdState;

  constructor(state?: InMemoryThresholdState) {
    this.#state = state ?? { snapshot: null };
  }

  async loadSnapshot(): Promise<ThresholdSnapshot | null> {
    return this.#state.snapshot ? structuredClone(this.#state.snapshot) : null;
  }

  async saveSnapshot(snapshot: ThresholdSnapshot): Promise<void> {
    this.#state.snapshot = structuredClone(snapshot);
  }

  get state(): InMemoryThresholdState {
    return this.#state;
  }
}

export interface FoundryThresholdJournalRuntime {
  readonly journal: {
    readonly contents: readonly IdentifiedJournalEntryDocumentLike[];
    get(id: string): IdentifiedJournalEntryDocumentLike | undefined;
  };
  createJournalEntry(data: {
    readonly name: string;
    readonly flags: Readonly<Record<string, unknown>>;
  }): Promise<IdentifiedJournalEntryDocumentLike | null | undefined>;
}

function runtimeFromGlobals(): FoundryThresholdJournalRuntime | undefined {
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

export class FoundryJournalThresholdStorageAdapter implements ThresholdStorageAdapter {
  readonly #runtime: FoundryThresholdJournalRuntime | undefined;
  #documentId?: string;

  constructor(runtime?: FoundryThresholdJournalRuntime) {
    this.#runtime = runtime ?? runtimeFromGlobals();
  }

  async loadSnapshot(): Promise<ThresholdSnapshot | null> {
    if (!this.#runtime) {
      return null;
    }

    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }

    this.#documentId = doc.id;
    const rawFlag = (doc.flags as any)?.[THRESHOLD_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }

    const snap = rawFlag as Partial<ThresholdSnapshot>;
    if (snap.schemaVersion !== THRESHOLD_STORAGE_SCHEMA_VERSION || !Array.isArray(snap.thresholds)) {
      return null;
    }

    return {
      schemaVersion: snap.schemaVersion,
      thresholds: snap.thresholds,
      crossedStates: snap.crossedStates ?? {},
      updatedAt: snap.updatedAt ?? Date.now()
    };
  }

  async saveSnapshot(snapshot: ThresholdSnapshot): Promise<void> {
    if (!this.#runtime) {
      return;
    }

    const doc = this.#findDocument();
    if (doc) {
      this.#documentId = doc.id;
      await doc.update({
        [`flags.${THRESHOLD_FLAG_NAMESPACE}`]: snapshot
      });
    } else {
      const created = await this.#runtime.createJournalEntry({
        name: THRESHOLD_DOCUMENT_NAME,
        flags: {
          [THRESHOLD_FLAG_NAMESPACE]: snapshot
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
        d.name === THRESHOLD_DOCUMENT_NAME ||
        Boolean((d.flags as any)?.[THRESHOLD_FLAG_NAMESPACE])
    );
  }
}
