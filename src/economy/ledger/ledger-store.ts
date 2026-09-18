import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import {
  type LedgerEntry,
  type LedgerEntryKind,
  type LedgerEntrySource,
  validateLedgerEntry
} from "./ledger-types.js";

export interface LedgerFilter {
  readonly domainUuid?: string;
  readonly resourceId?: string;
  readonly transactionId?: string;
  readonly reservationId?: string;
  readonly kind?: LedgerEntryKind;
  readonly sourceRef?: string;
  readonly fromSequence?: number;
  readonly toSequence?: number;
  readonly limit?: number;
}

export class LedgerStore {
  readonly #entries = new Map<string, LedgerEntry>();
  readonly #reversedTargetIds = new Set<string>();
  #nextSequence = 1;

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
    this.#nextSequence++;
    return ok(entry);
  }

  get(id: string): LedgerEntry | undefined {
    return this.#entries.get(id);
  }

  query(filter?: LedgerFilter): readonly LedgerEntry[] {
    let list = Array.from(this.#entries.values());

    if (!filter) {
      return Object.freeze(list);
    }

    if (filter.domainUuid !== undefined) {
      list = list.filter((e) => e.domainUuid === filter.domainUuid);
    }
    if (filter.resourceId !== undefined) {
      list = list.filter((e) => e.resourceId === filter.resourceId);
    }
    if (filter.transactionId !== undefined) {
      list = list.filter((e) => e.transactionId === filter.transactionId);
    }
    if (filter.reservationId !== undefined) {
      list = list.filter((e) => e.reservationId === filter.reservationId);
    }
    if (filter.kind !== undefined) {
      list = list.filter((e) => e.kind === filter.kind);
    }
    if (filter.sourceRef !== undefined) {
      list = list.filter((e) => e.source.ref === filter.sourceRef);
    }
    if (filter.fromSequence !== undefined) {
      list = list.filter((e) => e.sequence >= filter.fromSequence!);
    }
    if (filter.toSequence !== undefined) {
      list = list.filter((e) => e.sequence <= filter.toSequence!);
    }

    // Default sorting by sequence ascending
    list.sort((a, b) => a.sequence - b.sequence);

    if (filter.limit !== undefined && filter.limit > 0) {
      list = list.slice(0, filter.limit);
    }

    return Object.freeze(list);
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

  get count(): number {
    return this.#entries.size;
  }
}
