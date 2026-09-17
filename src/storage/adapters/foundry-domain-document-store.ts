import { DOMAIN_FLAG_NAMESPACE } from "../codecs/domain-codec.js";
import type {
  DomainDocumentStore,
  IdentifiedJournalEntryDocumentLike
} from "../repositories/domain-repository.js";

export interface FoundryJournalCollectionLike {
  readonly contents: readonly IdentifiedJournalEntryDocumentLike[];
  get(id: string): IdentifiedJournalEntryDocumentLike | undefined;
}

export interface FoundryDomainStoreRuntime {
  readonly journal: FoundryJournalCollectionLike;
  createJournalEntry(data: {
    readonly name: string;
    readonly flags: Readonly<Record<string, unknown>>;
  }): Promise<IdentifiedJournalEntryDocumentLike | null | undefined>;
}

function runtimeFromGlobals(): FoundryDomainStoreRuntime {
  const globals = globalThis as unknown as {
    game?: { journal?: FoundryJournalCollectionLike };
    JournalEntry?: {
      create(data: {
        readonly name: string;
        readonly flags: Readonly<Record<string, unknown>>;
      }): Promise<IdentifiedJournalEntryDocumentLike | null | undefined>;
    };
  };

  const journal = globals.game?.journal;
  const JournalEntry = globals.JournalEntry;
  if (journal === undefined || JournalEntry === undefined || typeof JournalEntry.create !== "function") {
    throw new Error("Foundry JournalEntry runtime is not available");
  }

  return {
    journal,
    createJournalEntry: (data) => JournalEntry.create(data)
  };
}

/**
 * Production storage boundary for canonical Domain JournalEntries.
 *
 * The runtime is injectable so unit tests do not require Foundry. With no
 * argument it resolves `game.journal` and `JournalEntry.create` at call time.
 */
function isDomainDocument(document: IdentifiedJournalEntryDocumentLike | undefined): document is IdentifiedJournalEntryDocumentLike {
  return document !== undefined && Object.prototype.hasOwnProperty.call(document.flags ?? {}, DOMAIN_FLAG_NAMESPACE);
}

export class FoundryDomainDocumentStore implements DomainDocumentStore {
  private readonly runtime: FoundryDomainStoreRuntime;

  constructor(runtime: FoundryDomainStoreRuntime = runtimeFromGlobals()) {
    this.runtime = runtime;
  }

  get(id: string): IdentifiedJournalEntryDocumentLike | undefined {
    const document = this.runtime.journal.get(id);
    return isDomainDocument(document) ? document : undefined;
  }

  list(): readonly IdentifiedJournalEntryDocumentLike[] {
    return this.runtime.journal.contents.filter(isDomainDocument);
  }

  async create(data: {
    readonly name: string;
    readonly flags: Readonly<Record<string, unknown>>;
  }): Promise<IdentifiedJournalEntryDocumentLike> {
    const created = await this.runtime.createJournalEntry(data);
    if (created === null || created === undefined) {
      throw new Error("Foundry did not return the created JournalEntry");
    }
    return created;
  }
}
