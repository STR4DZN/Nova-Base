import {
  type ResourceDefinition,
  validateResourceDefinition
} from "./resource-definition-types.js";
import type { IdentifiedJournalEntryDocumentLike } from "../../storage/repositories/domain-repository.js";
import { type Result, ok } from "../../core/contracts/result.js";
import type { PublicError } from "../../core/contracts/public-error.js";

export const CUSTOM_RESOURCE_STORAGE_SCHEMA_VERSION = 1;
export const CUSTOM_RESOURCE_DOCUMENT_NAME = "[Domain Manager] Custom Resources";
export const CUSTOM_RESOURCE_FLAG_NAMESPACE = "domain-manager-custom-resources";

export interface CustomResourceSnapshot {
  readonly schemaVersion: number;
  readonly definitions: readonly ResourceDefinition[];
  readonly updatedAt: number;
}

export interface CustomResourceStorageAdapter {
  loadSnapshot(): Promise<CustomResourceSnapshot | null>;
  saveSnapshot(snapshot: CustomResourceSnapshot): Promise<void>;
}

export interface InMemoryCustomResourceState {
  snapshot: CustomResourceSnapshot | null;
}

export class InMemoryCustomResourceStorageAdapter implements CustomResourceStorageAdapter {
  readonly #state: InMemoryCustomResourceState;

  constructor(state?: InMemoryCustomResourceState) {
    this.#state = state ?? { snapshot: null };
  }

  async loadSnapshot(): Promise<CustomResourceSnapshot | null> {
    return this.#state.snapshot ? structuredClone(this.#state.snapshot) : null;
  }

  async saveSnapshot(snapshot: CustomResourceSnapshot): Promise<void> {
    this.#state.snapshot = structuredClone(snapshot);
  }

  get state(): InMemoryCustomResourceState {
    return this.#state;
  }
}

export interface FoundryCustomResourceJournalRuntime {
  readonly journal: {
    readonly contents: readonly IdentifiedJournalEntryDocumentLike[];
    get(id: string): IdentifiedJournalEntryDocumentLike | undefined;
  };
  createJournalEntry(data: {
    readonly name: string;
    readonly flags: Readonly<Record<string, unknown>>;
  }): Promise<IdentifiedJournalEntryDocumentLike | null | undefined>;
}

function runtimeFromGlobals(): FoundryCustomResourceJournalRuntime | undefined {
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

export class FoundryJournalCustomResourceStorageAdapter implements CustomResourceStorageAdapter {
  readonly #runtime: FoundryCustomResourceJournalRuntime | undefined;
  #documentId?: string;

  constructor(runtime?: FoundryCustomResourceJournalRuntime) {
    this.#runtime = runtime ?? runtimeFromGlobals();
  }

  async loadSnapshot(): Promise<CustomResourceSnapshot | null> {
    if (!this.#runtime) {
      return null;
    }

    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }

    this.#documentId = doc.id;
    const rawFlag = (doc.flags as any)?.[CUSTOM_RESOURCE_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }

    return rawFlag as CustomResourceSnapshot;
  }

  async saveSnapshot(snapshot: CustomResourceSnapshot): Promise<void> {
    if (!this.#runtime) {
      return;
    }

    let doc = this.#findDocument();
    if (doc) {
      this.#documentId = doc.id;
      if (typeof doc.update === "function") {
        await doc.update({
          flags: {
            [CUSTOM_RESOURCE_FLAG_NAMESPACE]: snapshot
          }
        });
      }
    } else {
      const created = await this.#runtime.createJournalEntry({
        name: CUSTOM_RESOURCE_DOCUMENT_NAME,
        flags: {
          [CUSTOM_RESOURCE_FLAG_NAMESPACE]: snapshot
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
        d.name === CUSTOM_RESOURCE_DOCUMENT_NAME ||
        Boolean((d.flags as any)?.[CUSTOM_RESOURCE_FLAG_NAMESPACE])
    );
  }
}

export class CustomResourceDefinitionStore {
  readonly #adapter: CustomResourceStorageAdapter;
  readonly #definitions = new Map<string, ResourceDefinition>();

  constructor(adapter: CustomResourceStorageAdapter = new InMemoryCustomResourceStorageAdapter()) {
    this.#adapter = adapter;
  }

  async rehydrate(): Promise<readonly ResourceDefinition[]> {
    const snapshot = await this.#adapter.loadSnapshot();
    if (snapshot) {
      for (const def of snapshot.definitions) {
        this.#definitions.set(def.id, def);
      }
    }
    return this.list();
  }

  has(id: string): boolean {
    return this.#definitions.has(id);
  }

  register(definition: ResourceDefinition): Result<ResourceDefinition, PublicError> {
    const valRes = validateResourceDefinition(definition);
    if (!valRes.ok) return valRes;
    this.#definitions.set(valRes.value.id, valRes.value);
    void this.#persist().catch(() => {});
    return ok(valRes.value);
  }

  async save(definition: ResourceDefinition): Promise<void> {
    const previous = this.#definitions.get(definition.id);
    this.#definitions.set(definition.id, definition);
    try {
      await this.#persist();
    } catch (err) {
      if (previous) {
        this.#definitions.set(definition.id, previous);
      } else {
        this.#definitions.delete(definition.id);
      }
      throw err;
    }
  }

  get(id: string): ResourceDefinition | undefined {
    return this.#definitions.get(id);
  }

  list(): readonly ResourceDefinition[] {
    return Object.freeze(Array.from(this.#definitions.values()));
  }

  async #persist(): Promise<void> {
    const snapshot: CustomResourceSnapshot = {
      schemaVersion: CUSTOM_RESOURCE_STORAGE_SCHEMA_VERSION,
      definitions: Array.from(this.#definitions.values()),
      updatedAt: Date.now()
    };
    await this.#adapter.saveSnapshot(snapshot);
  }
}
