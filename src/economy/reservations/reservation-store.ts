import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import {
  type Reservation,
  type ReservationEvent,
  type ReservationEventType,
  type ReservationSource,
  type ReservationStatus,
  validateReservation
} from "./reservation-types.js";
import {
  RESERVATION_STORAGE_SCHEMA_VERSION,
  type ReservationSnapshot,
  type ReservationStorageAdapter
} from "../storage/reservation-storage-adapter.js";

export interface CreateReservationInput {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly originalAmountMinor: number;
  readonly source: ReservationSource;
  readonly createdAtWorld?: number | null;
  readonly expiresAtWorld?: number | null;
  readonly expiresAtReal?: number | null;
}

export interface ReservationFilter {
  readonly domainUuid?: string;
  readonly resourceId?: string;
  readonly status?: ReservationStatus;
  readonly sourceRef?: string;
}

export interface ReservationStoreOptions {
  readonly storageAdapter?: ReservationStorageAdapter;
}

export class ReservationStore {
  readonly #reservations = new Map<string, Reservation>();
  readonly #events: ReservationEvent[] = [];
  readonly #storageAdapter?: ReservationStorageAdapter;
  #persistQueue: Promise<void> = Promise.resolve();
  #lastPersistError: Error | null = null;

  constructor(options: ReservationStoreOptions = {}) {
    this.#storageAdapter = options.storageAdapter;
  }

  async rehydrate(): Promise<void> {
    if (!this.#storageAdapter) return;
    const snapshot = await this.#storageAdapter.loadSnapshot();
    if (snapshot) {
      this.#reservations.clear();
      this.#events.length = 0;
      for (const res of snapshot.reservations) {
        this.#reservations.set(res.id, res);
      }
      for (const evt of snapshot.events) {
        this.#events.push(evt);
      }
    }
  }

  create(input: CreateReservationInput): Result<Reservation, PublicError> {
    const id = createOpaqueId("resv");
    const raw: Reservation = {
      id,
      domainUuid: input.domainUuid,
      resourceId: input.resourceId,
      originalAmountMinor: input.originalAmountMinor,
      remainingAmountMinor: input.originalAmountMinor,
      status: "active",
      source: input.source,
      createdAtReal: Date.now(),
      ...(input.createdAtWorld !== undefined ? { createdAtWorld: input.createdAtWorld } : {}),
      ...(input.expiresAtWorld !== undefined ? { expiresAtWorld: input.expiresAtWorld } : {}),
      ...(input.expiresAtReal !== undefined ? { expiresAtReal: input.expiresAtReal } : {}),
      revision: 0
    };

    const valRes = validateReservation(raw);
    if (!valRes.ok) {
      return valRes;
    }

    const res = valRes.value;
    this.#reservations.set(res.id, res);

    this.#recordEvent({
      reservationId: res.id,
      type: "created",
      deltaMinor: res.originalAmountMinor,
      remainingAmountMinor: res.remainingAmountMinor,
      timestampReal: res.createdAtReal,
      timestampWorld: res.createdAtWorld,
      reason: res.source.reason,
      sourceRef: res.source.ref,
      userId: res.source.userId
    });

    this.#schedulePersist();
    return ok(res);
  }

  get(id: string): Reservation | undefined {
    return this.#reservations.get(id);
  }

  list(filter?: ReservationFilter): readonly Reservation[] {
    let all = Array.from(this.#reservations.values());
    if (!filter) {
      return Object.freeze(all);
    }

    if (filter.domainUuid !== undefined) {
      const cleanFilter = filter.domainUuid.startsWith("JournalEntry.")
        ? filter.domainUuid.slice("JournalEntry.".length)
        : filter.domainUuid;
      all = all.filter((r) => {
        if (r.domainUuid === filter.domainUuid) return true;
        const cleanR = r.domainUuid.startsWith("JournalEntry.")
          ? r.domainUuid.slice("JournalEntry.".length)
          : r.domainUuid;
        return cleanR === cleanFilter;
      });
    }
    if (filter.resourceId !== undefined) {
      all = all.filter((r) => r.resourceId === filter.resourceId);
    }
    if (filter.status !== undefined) {
      all = all.filter((r) => r.status === filter.status);
    }
    if (filter.sourceRef !== undefined) {
      all = all.filter((r) => r.source.ref === filter.sourceRef);
    }

    return Object.freeze(all);
  }

  listEvents(reservationId?: string): readonly ReservationEvent[] {
    if (reservationId) {
      return Object.freeze(this.#events.filter((e) => e.reservationId === reservationId));
    }
    return Object.freeze([...this.#events]);
  }

  getEvents(reservationId?: string): readonly ReservationEvent[] {
    return this.listEvents(reservationId);
  }

  getReservedTotal(domainUuid: string, resourceId: string): number {
    const cleanTarget = domainUuid.startsWith("JournalEntry.")
      ? domainUuid.slice("JournalEntry.".length)
      : domainUuid;
    let total = 0;
    for (const r of this.#reservations.values()) {
      const cleanR = r.domainUuid.startsWith("JournalEntry.")
        ? r.domainUuid.slice("JournalEntry.".length)
        : r.domainUuid;
      if (
        (r.domainUuid === domainUuid || cleanR === cleanTarget) &&
        r.resourceId === resourceId &&
        (r.status === "active" || r.status === "partially-consumed")
      ) {
        total += r.remainingAmountMinor;
      }
    }
    return total;
  }

  consume(
    reservationId: string,
    amountMinor: number,
    options?: { readonly reason?: string; readonly worldTime?: number | null; readonly userId?: string }
  ): Result<{ reservation: Reservation; consumedAmount: number }, PublicError> {
    const existing = this.#reservations.get(reservationId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "validation",
          message: `Reservation '${reservationId}' not found`
        })
      );
    }

    if (existing.status !== "active" && existing.status !== "partially-consumed") {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_ACTIVE",
          category: "validation",
          message: `Cannot consume from reservation in '${existing.status}' status`
        })
      );
    }

    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      return err(
        createPublicError({
          code: "DM_ECON_AMOUNT_INVALID",
          category: "validation",
          message: `Consumed amount must be a positive safe integer (> 0): received ${String(amountMinor)}`
        })
      );
    }

    if (amountMinor > existing.remainingAmountMinor) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_EXHAUSTED",
          category: "validation",
          message: `Requested consumption (${amountMinor}) exceeds remaining reserved amount (${existing.remainingAmountMinor})`
        })
      );
    }

    const newRemaining = existing.remainingAmountMinor - amountMinor;
    const newStatus: ReservationStatus = newRemaining === 0 ? "consumed" : "partially-consumed";

    const updated: Reservation = {
      ...existing,
      remainingAmountMinor: newRemaining,
      status: newStatus,
      revision: existing.revision + 1
    };

    this.#reservations.set(reservationId, updated);

    this.#recordEvent({
      reservationId,
      type: newStatus,
      deltaMinor: -amountMinor,
      remainingAmountMinor: newRemaining,
      timestampReal: Date.now(),
      timestampWorld: options?.worldTime,
      reason: options?.reason,
      userId: options?.userId
    });

    this.#schedulePersist();
    return ok({ reservation: updated, consumedAmount: amountMinor });
  }

  release(
    reservationId: string,
    amountMinor?: number,
    options?: { readonly reason?: string; readonly worldTime?: number | null; readonly userId?: string }
  ): Result<{ reservation: Reservation; releasedAmount: number }, PublicError> {
    const existing = this.#reservations.get(reservationId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "validation",
          message: `Reservation '${reservationId}' not found`
        })
      );
    }

    if (existing.status !== "active" && existing.status !== "partially-consumed") {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_ACTIVE",
          category: "validation",
          message: `Cannot release reservation in '${existing.status}' status`
        })
      );
    }

    const toRelease = amountMinor !== undefined ? amountMinor : existing.remainingAmountMinor;

    if (!Number.isSafeInteger(toRelease) || toRelease <= 0) {
      return err(
        createPublicError({
          code: "DM_ECON_AMOUNT_INVALID",
          category: "validation",
          message: `Released amount must be a positive safe integer (> 0): received ${String(toRelease)}`
        })
      );
    }

    if (toRelease > existing.remainingAmountMinor) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_EXHAUSTED",
          category: "validation",
          message: `Requested release amount (${toRelease}) exceeds remaining reserved amount (${existing.remainingAmountMinor})`
        })
      );
    }

    const newRemaining = existing.remainingAmountMinor - toRelease;
    const newStatus: ReservationStatus = newRemaining === 0 ? "released" : "partially-consumed";

    const updated: Reservation = {
      ...existing,
      remainingAmountMinor: newRemaining,
      status: newStatus,
      revision: existing.revision + 1
    };

    this.#reservations.set(reservationId, updated);

    this.#recordEvent({
      reservationId,
      type: "released",
      deltaMinor: -toRelease,
      remainingAmountMinor: newRemaining,
      timestampReal: Date.now(),
      timestampWorld: options?.worldTime,
      reason: options?.reason,
      userId: options?.userId
    });

    this.#schedulePersist();
    return ok({ reservation: updated, releasedAmount: toRelease });
  }

  expire(
    reservationId: string,
    options?: { readonly reason?: string; readonly worldTime?: number | null }
  ): Result<Reservation, PublicError> {
    const existing = this.#reservations.get(reservationId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "validation",
          message: `Reservation '${reservationId}' not found`
        })
      );
    }

    if (existing.status === "consumed" || existing.status === "released" || existing.status === "expired") {
      return ok(existing); // already final
    }

    const releasedAmount = existing.remainingAmountMinor;
    const updated: Reservation = {
      ...existing,
      remainingAmountMinor: 0,
      status: "expired",
      revision: existing.revision + 1
    };

    this.#reservations.set(reservationId, updated);

    this.#recordEvent({
      reservationId,
      type: "expired",
      deltaMinor: -releasedAmount,
      remainingAmountMinor: 0,
      timestampReal: Date.now(),
      timestampWorld: options?.worldTime,
      reason: options?.reason ?? "Reservation expired"
    });

    this.#schedulePersist();
    return ok(updated);
  }

  /**
   * Rolls back a consumed reservation to its pre-consumption state (G4-AUD-003, G4-AUD-002).
   * Restores remaining amount and status exactly as in snapshot, recording an 'adjusted' event.
   */
  rollbackConsume(
    snapshot: Reservation,
    consumedAmount: number,
    options?: { readonly reason?: string; readonly worldTime?: number | null; readonly userId?: string }
  ): Result<Reservation, PublicError> {
    const current = this.#reservations.get(snapshot.id);
    const restored: Reservation = {
      ...snapshot,
      revision: (current?.revision ?? snapshot.revision) + 1
    };

    this.#reservations.set(snapshot.id, restored);

    this.#recordEvent({
      reservationId: snapshot.id,
      type: "adjusted",
      deltaMinor: consumedAmount,
      remainingAmountMinor: restored.remainingAmountMinor,
      timestampReal: Date.now(),
      timestampWorld: options?.worldTime,
      reason: options?.reason ?? "Rollback consumed reservation",
      userId: options?.userId
    });

    this.#schedulePersist();
    return ok(restored);
  }

  /**
   * Restores a reservation to an exact prior snapshot with an audit adjustment event.
   */
  restore(
    snapshot: Reservation,
    reason: string,
    options?: { readonly worldTime?: number | null; readonly userId?: string }
  ): Result<Reservation, PublicError> {
    const current = this.#reservations.get(snapshot.id);
    const currentRemaining = current ? current.remainingAmountMinor : 0;
    const delta = snapshot.remainingAmountMinor - currentRemaining;

    const restored: Reservation = {
      ...snapshot,
      revision: (current?.revision ?? snapshot.revision) + 1
    };

    this.#reservations.set(snapshot.id, restored);

    this.#recordEvent({
      reservationId: snapshot.id,
      type: "adjusted",
      deltaMinor: delta,
      remainingAmountMinor: restored.remainingAmountMinor,
      timestampReal: Date.now(),
      timestampWorld: options?.worldTime,
      reason,
      userId: options?.userId
    });

    this.#schedulePersist();
    return ok(restored);
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

  #recordEvent(eventParams: {
    reservationId: string;
    type: ReservationEventType;
    deltaMinor: number;
    remainingAmountMinor: number;
    timestampReal: number;
    timestampWorld?: number | null;
    reason?: string;
    sourceRef?: string;
    userId?: string;
  }): void {
    const event: ReservationEvent = {
      id: createOpaqueId("reve"),
      ...eventParams
    };
    this.#events.push(event);
  }

  async #persist(): Promise<void> {
    if (!this.#storageAdapter) return;
    const snapshot: ReservationSnapshot = {
      schemaVersion: RESERVATION_STORAGE_SCHEMA_VERSION,
      reservations: Array.from(this.#reservations.values()),
      events: this.#events,
      updatedAt: Date.now()
    };
    await this.#storageAdapter.saveSnapshot(snapshot);
  }
}
