import type { Reservation, ReservationEvent } from "../reservations/reservation-types.js";
import type { IdentifiedJournalEntryDocumentLike } from "../../storage/repositories/domain-repository.js";

export const RESERVATION_STORAGE_SCHEMA_VERSION = 1;
export const RESERVATION_DOCUMENT_NAME = "[Domain Manager] Reservation Store";
export const RESERVATION_FLAG_NAMESPACE = "domain-manager-reservations";

export interface ReservationSnapshot {
  readonly schemaVersion: number;
  readonly reservations: readonly Reservation[];
  readonly events: readonly ReservationEvent[];
  readonly updatedAt: number;
}

export interface ReservationStorageAdapter {
  loadSnapshot(): Promise<ReservationSnapshot | null>;
  saveSnapshot(snapshot: ReservationSnapshot): Promise<void>;
}

export interface InMemoryReservationState {
  snapshot: ReservationSnapshot | null;
}

export class InMemoryReservationStorageAdapter implements ReservationStorageAdapter {
  readonly #state: InMemoryReservationState;

  constructor(state?: InMemoryReservationState) {
    this.#state = state ?? { snapshot: null };
  }

  async loadSnapshot(): Promise<ReservationSnapshot | null> {
    return this.#state.snapshot ? structuredClone(this.#state.snapshot) : null;
  }

  async saveSnapshot(snapshot: ReservationSnapshot): Promise<void> {
    this.#state.snapshot = structuredClone(snapshot);
  }

  get state(): InMemoryReservationState {
    return this.#state;
  }
}

export interface FoundryReservationJournalRuntime {
  readonly journal: {
    readonly contents: readonly IdentifiedJournalEntryDocumentLike[];
    get(id: string): IdentifiedJournalEntryDocumentLike | undefined;
  };
  createJournalEntry(data: {
    readonly name: string;
    readonly flags: Readonly<Record<string, unknown>>;
  }): Promise<IdentifiedJournalEntryDocumentLike | null | undefined>;
}

function runtimeFromGlobals(): FoundryReservationJournalRuntime | undefined {
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

export class FoundryJournalReservationStorageAdapter implements ReservationStorageAdapter {
  readonly #runtime: FoundryReservationJournalRuntime | undefined;
  #documentId?: string;

  constructor(runtime?: FoundryReservationJournalRuntime) {
    this.#runtime = runtime ?? runtimeFromGlobals();
  }

  async loadSnapshot(): Promise<ReservationSnapshot | null> {
    if (!this.#runtime) {
      return null;
    }

    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }

    this.#documentId = doc.id;
    const rawFlag = (doc.flags as any)?.[RESERVATION_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }

    return rawFlag as ReservationSnapshot;
  }

  async saveSnapshot(snapshot: ReservationSnapshot): Promise<void> {
    if (!this.#runtime) {
      return;
    }

    let doc = this.#findDocument();
    if (doc) {
      this.#documentId = doc.id;
      if (typeof doc.update === "function") {
        await doc.update({
          flags: {
            [RESERVATION_FLAG_NAMESPACE]: snapshot
          }
        });
      }
    } else {
      const created = await this.#runtime.createJournalEntry({
        name: RESERVATION_DOCUMENT_NAME,
        flags: {
          [RESERVATION_FLAG_NAMESPACE]: snapshot
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
        d.name === RESERVATION_DOCUMENT_NAME ||
        Boolean((d.flags as any)?.[RESERVATION_FLAG_NAMESPACE])
    );
  }
}
