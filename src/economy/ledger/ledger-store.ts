import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import {
  type LedgerEntry,
  type LedgerEntryKind,
  type LedgerEntrySource,
  validateLedgerEntry
} from "./ledger-types.js";
import {
  LEDGER_STORAGE_SCHEMA_VERSION,
  type LedgerSnapshot,
  type LedgerStorageAdapter
} from "../storage/ledger-storage-adapter.js";

export interface LedgerFilter {
  readonly domainUuid?: string;
  readonly resourceId?: string;
  readonly transactionId?: string;
  readonly reservationId?: string;
  readonly kind?: LedgerEntryKind;
  readonly sourceType?: string;
  readonly sourceRef?: string;
  readonly fromSequence?: number;
  readonly toSequence?: number;
  readonly beforeSequence?: number;
  readonly afterSequence?: number;
  readonly sinceRealTime?: number;
  readonly untilRealTime?: number;
  readonly sinceWorldTime?: number;
  readonly untilWorldTime?: number;
  readonly cursor?: string;
  readonly limit?: number;
  readonly direction?: "asc" | "desc";
  readonly recent?: boolean;
  readonly allowedResourceIds?: readonly string[];
  readonly allowedDomainResourceKeys?: readonly string[] | ReadonlySet<string>;
}

export interface PagedLedgerResult {
  readonly entries: readonly LedgerEntry[];
  readonly totalCount: number;
  readonly hasMore: boolean;
  readonly nextCursor?: string;
  readonly prevCursor?: string;
}

export interface LedgerStoreOptions {
  readonly storageAdapter?: LedgerStorageAdapter;
}

export class LedgerStore {
  readonly #entries = new Map<string, LedgerEntry>();
  readonly #reversedTargetIds = new Set<string>();
  readonly #sequenceIndex: LedgerEntry[] = [];
  #nextSequence = 1;
  readonly #storageAdapter?: LedgerStorageAdapter;
  #persistQueue: Promise<void> = Promise.resolve();
  #lastPersistError: Error | null = null;

  constructor(options: LedgerStoreOptions = {}) {
    this.#storageAdapter = options.storageAdapter;
  }

  async rehydrate(): Promise<void> {
    if (!this.#storageAdapter) return;
    const snapshot = await this.#storageAdapter.loadSnapshot();
    if (snapshot) {
      this.#entries.clear();
      this.#reversedTargetIds.clear();
      this.#sequenceIndex.length = 0;

      for (const id of snapshot.reversedTargetIds) {
        this.#reversedTargetIds.add(id);
      }

      const sorted = [...snapshot.entries].sort((a, b) => a.sequence - b.sequence);
      for (const entry of sorted) {
        this.#entries.set(entry.id, entry);
        this.#sequenceIndex.push(entry);
      }

      const maxSeq = sorted.length > 0 ? sorted[sorted.length - 1].sequence : 0;
      this.#nextSequence = Math.max(snapshot.nextSequence ?? 1, maxSeq + 1);
    }
  }

  append(
    input: Omit<LedgerEntry, "id" | "sequence" | "timestampReal"> & {
      readonly timestampReal?: number;
    }
  ): Result<LedgerEntry, PublicError> {
    const id = createOpaqueId("led");
    const sequence = this.#nextSequence;

    const fullEntry: LedgerEntry = {
      ...input,
      id,
      sequence,
      timestampReal: input.timestampReal ?? Date.now()
    };

    const valRes = validateLedgerEntry(fullEntry);
    if (!valRes.ok) {
      return valRes;
    }

    const entry = valRes.value;

    if (entry.reversesEntryId) {
      if (this.#reversedTargetIds.has(entry.reversesEntryId)) {
        return err(
          createPublicError({
            code: "DM_ECON_REVERSAL_ALREADY_EXISTS",
            category: "validation",
            message: `Entry '${entry.reversesEntryId}' has already been reversed`
          })
        );
      }
      this.#reversedTargetIds.add(entry.reversesEntryId);
    }

    this.#entries.set(entry.id, entry);
    this.#sequenceIndex.push(entry);
    this.#nextSequence++;

    this.#schedulePersist();

    return ok(entry);
  }

  get(id: string): LedgerEntry | undefined {
    return this.#entries.get(id);
  }

  query(filter?: LedgerFilter): readonly LedgerEntry[] {
    const paged = this.queryPaged(filter);
    return paged.entries;
  }

  queryPaged(filter?: LedgerFilter): PagedLedgerResult {
    let list = this.#sequenceIndex;

    if (!filter) {
      return {
        entries: Object.freeze([...list]),
        totalCount: list.length,
        hasMore: false
      };
    }

    let filtered = list;

    if (filter.domainUuid !== undefined) {
      filtered = filtered.filter((e) => e.domainUuid === filter.domainUuid);
    }
    if (filter.resourceId !== undefined) {
      filtered = filtered.filter((e) => e.resourceId === filter.resourceId);
    }
    if (filter.allowedResourceIds !== undefined) {
      filtered = filtered.filter((e) => filter.allowedResourceIds!.includes(e.resourceId));
    }
    if (filter.allowedDomainResourceKeys !== undefined) {
      const allowedSet =
        filter.allowedDomainResourceKeys instanceof Set
          ? filter.allowedDomainResourceKeys
          : new Set(filter.allowedDomainResourceKeys);
      filtered = filtered.filter((e) => {
        const cleanDom = e.domainUuid.startsWith("JournalEntry.")
          ? e.domainUuid.slice("JournalEntry.".length)
          : e.domainUuid;
        return (
          allowedSet.has(`${e.domainUuid}:${e.resourceId}`) ||
          allowedSet.has(`${cleanDom}:${e.resourceId}`) ||
          allowedSet.has(`JournalEntry.${cleanDom}:${e.resourceId}`)
        );
      });
    }
    if (filter.transactionId !== undefined) {
      filtered = filtered.filter((e) => e.transactionId === filter.transactionId);
    }
    if (filter.reservationId !== undefined) {
      filtered = filtered.filter((e) => e.reservationId === filter.reservationId);
    }
    if (filter.kind !== undefined) {
      filtered = filtered.filter((e) => e.kind === filter.kind);
    }
    if (filter.sourceType !== undefined) {
      filtered = filtered.filter((e) => e.source.type === filter.sourceType);
    }
    if (filter.sourceRef !== undefined) {
      filtered = filtered.filter((e) => e.source.ref === filter.sourceRef);
    }
    if (filter.fromSequence !== undefined) {
      filtered = filtered.filter((e) => e.sequence >= filter.fromSequence!);
    }
    if (filter.toSequence !== undefined) {
      filtered = filtered.filter((e) => e.sequence <= filter.toSequence!);
    }
    if (filter.afterSequence !== undefined) {
      filtered = filtered.filter((e) => e.sequence > filter.afterSequence!);
    }
    if (filter.beforeSequence !== undefined) {
      filtered = filtered.filter((e) => e.sequence < filter.beforeSequence!);
    }
    if (filter.sinceRealTime !== undefined) {
      filtered = filtered.filter((e) => e.timestampReal >= filter.sinceRealTime!);
    }
    if (filter.untilRealTime !== undefined) {
      filtered = filtered.filter((e) => e.timestampReal <= filter.untilRealTime!);
    }
    if (filter.sinceWorldTime !== undefined) {
      filtered = filtered.filter((e) => (e.timestampWorld ?? 0) >= filter.sinceWorldTime!);
    }
    if (filter.untilWorldTime !== undefined) {
      filtered = filtered.filter((e) => (e.timestampWorld ?? 0) <= filter.untilWorldTime!);
    }
    if (filter.cursor !== undefined) {
      const cursorSeq = parseInt(filter.cursor, 10);
      if (Number.isSafeInteger(cursorSeq)) {
        if (filter.direction === "desc") {
          filtered = filtered.filter((e) => e.sequence < cursorSeq);
        } else {
          filtered = filtered.filter((e) => e.sequence > cursorSeq);
        }
      }
    }

    const totalCount = filtered.length;
    const direction = filter.direction ?? (filter.recent ? "desc" : "asc");

    // Sorting
    const sorted = [...filtered];
    if (direction === "desc") {
      sorted.sort((a, b) => b.sequence - a.sequence);
    } else {
      sorted.sort((a, b) => a.sequence - b.sequence);
    }

    let resultEntries = sorted;
    let hasMore = false;
    if (filter.limit !== undefined && filter.limit > 0) {
      if (resultEntries.length > filter.limit) {
        hasMore = true;
        resultEntries = resultEntries.slice(0, filter.limit);
      }
    }

    const nextCursor =
      hasMore && resultEntries.length > 0
        ? String(resultEntries[resultEntries.length - 1].sequence)
        : undefined;
    const prevCursor =
      resultEntries.length > 0
        ? String(resultEntries[0].sequence)
        : undefined;

    return {
      entries: Object.freeze(resultEntries),
      totalCount,
      hasMore,
      nextCursor,
      prevCursor
    };
  }

  createReversal(
    targetEntryId: string,
    sourceOrReason: LedgerEntrySource | string,
    userId?: string
  ): Result<LedgerEntry, PublicError> {
    const source: LedgerEntrySource =
      typeof sourceOrReason === "string"
        ? { type: "reversal", reason: sourceOrReason, userId }
        : sourceOrReason;

    const target = this.#entries.get(targetEntryId);
    if (!target) {
      return err(
        createPublicError({
          code: "DM_ECON_LEDGER_ENTRY_NOT_FOUND",
          category: "validation",
          message: `Target LedgerEntry '${targetEntryId}' not found for reversal`
        })
      );
    }

    if (target.kind === "reversal") {
      return err(
        createPublicError({
          code: "DM_ECON_CANNOT_REVERSE_REVERSAL",
          category: "validation",
          message: `Cannot reverse entry '${targetEntryId}' because it is already a reversal`
        })
      );
    }

    if (this.#reversedTargetIds.has(targetEntryId)) {
      return err(
        createPublicError({
          code: "DM_ECON_REVERSAL_ALREADY_EXISTS",
          category: "validation",
          message: `Entry '${targetEntryId}' has already been reversed`
        })
      );
    }

    return this.append({
      domainUuid: target.domainUuid,
      resourceId: target.resourceId,
      deltaMinor: -target.deltaMinor, // opposing amount
      kind: "reversal",
      timestampReal: Date.now(),
      reversesEntryId: target.id,
      source
    });
  }

  isReversed(entryId: string): boolean {
    return this.#reversedTargetIds.has(entryId);
  }

  get count(): number {
    return this.#entries.size;
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
    const snapshot: LedgerSnapshot = {
      schemaVersion: LEDGER_STORAGE_SCHEMA_VERSION,
      entries: this.#sequenceIndex,
      reversedTargetIds: Array.from(this.#reversedTargetIds),
      nextSequence: this.#nextSequence,
      updatedAt: Date.now()
    };
    await this.#storageAdapter.saveSnapshot(snapshot);
  }
}
