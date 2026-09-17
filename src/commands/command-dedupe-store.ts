import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import type { CommandId, DomainCommand } from "./command-envelope.js";
import type { TransportReceipt } from "./command-transport.js";

/**
 * Deterministically canonicalizes any JSON-safe structure by sorting object keys recursively.
 */
export function canonicalizeJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson(obj[key]);
  }
  return result;
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

/**
 * Computes a deterministic 64-bit canonical fingerprint of a value.
 */
export function computeFingerprint(value: unknown): string {
  const json = canonicalJsonStringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch >> 8), 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `fp_${hex1}${hex2}`;
}

/**
 * Computes the canonical fingerprint representing the intent of a DomainCommand.
 * INVARIANT G2-AUD-021: Includes type, payload, targetRefs (canonicalized), and expected revisions.
 */
export function computeCommandFingerprint(command: DomainCommand<unknown>): string {
  return computeFingerprint({
    type: command.type,
    payload: command.payload,
    targetRefs: command.targetRefs ? [...command.targetRefs].sort() : null,
    expectedRevision: command.expectedRevision ?? null,
    expectedRevisions: command.expectedRevisions ?? null
  });
}

export type DedupeEntryState = "pending" | "completed" | "rejected";

export type CommandExecutionState =
  | "unknown"
  | "received"
  | "processing"
  | "completed"
  | "rejected";

export interface CommandStatusReport<TResult = unknown> {
  readonly commandId: CommandId;
  readonly state: CommandExecutionState;
  readonly receipt?: TransportReceipt<TResult>;
  readonly createdAt?: number;
}

export interface DedupeEntry<TResult = unknown> {
  readonly commandId: CommandId;
  readonly fingerprint: string;
  readonly createdAt: number;
  state: DedupeEntryState;
  receipt?: TransportReceipt<TResult>;
  inFlightPromise?: Promise<TransportReceipt<TResult>>;
  resolveInFlight?: (receipt: TransportReceipt<TResult>) => void;
}

export interface ClaimResult<TResult = unknown> {
  readonly isReplay: boolean;
  readonly receipt?: TransportReceipt<TResult>;
  readonly inFlightPromise?: Promise<TransportReceipt<TResult>>;
}

export interface DedupeStoreOptions {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
}

/**
 * In-memory Dedupe Store implementing Master Spec §11.2, §11.3, DEC-593–602.
 *
 * Provides:
 * 1. Fingerprint validation on replay: same commandId + same fingerprint returns cached receipt or awaits in-flight execution.
 * 2. Security conflict detection: same commandId + different fingerprint is strictly rejected with DM_COMMAND_ID_REUSE_MISMATCH.
 * 3. Simultaneous same-commandId resolution: concurrent requests for the same commandId share the same in-flight execution.
 * 4. LRU eviction and TTL retention policy.
 */
export class CommandDedupeStore {
  readonly #maxEntries: number;
  readonly #ttlMs: number;
  readonly #entries = new Map<CommandId, DedupeEntry<any>>();

  constructor(options?: DedupeStoreOptions) {
    this.#maxEntries = options?.maxEntries ?? 5000;
    this.#ttlMs = options?.ttlMs ?? 10 * 60 * 1000; // 10 minutes
  }

  get size(): number {
    return this.#entries.size;
  }

  get capacity(): number {
    return this.#maxEntries;
  }

  claim<TResult = unknown>(
    commandId: CommandId,
    fingerprint: string,
    now: number = Date.now()
  ): Result<ClaimResult<TResult>, PublicError> {
    this.#evictExpired(now);

    const existing = this.#entries.get(commandId);
    if (existing) {
      // INVARIANT DEC-593–602: mesmo commandId + fingerprint diferente = conflict/security error
      if (existing.fingerprint !== fingerprint) {
        return err(
          createPublicError({
            code: "DM_COMMAND_ID_REUSE_MISMATCH",
            category: "conflict",
            message: `Command ID '${commandId}' was previously registered with a different command payload or fingerprint`
          })
        );
      }

      // Move key to end for LRU refresh
      this.#entries.delete(commandId);
      this.#entries.set(commandId, existing);

      if (existing.state === "completed" || existing.state === "rejected") {
        return ok({
          isReplay: true,
          receipt: existing.receipt as TransportReceipt<TResult>
        });
      }

      // In-flight simultaneous request
      return ok({
        isReplay: true,
        inFlightPromise: existing.inFlightPromise as Promise<TransportReceipt<TResult>>
      });
    }

    // Capacity check and oldest eviction (LRU)
    if (this.#entries.size >= this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey) {
        this.#entries.delete(oldestKey);
      }
    }

    let resolveInFlight!: (receipt: TransportReceipt<TResult>) => void;
    const inFlightPromise = new Promise<TransportReceipt<TResult>>((resolve) => {
      resolveInFlight = resolve;
    });

    const newEntry: DedupeEntry<TResult> = {
      commandId,
      fingerprint,
      createdAt: now,
      state: "pending",
      inFlightPromise,
      resolveInFlight
    };

    this.#entries.set(commandId, newEntry);

    return ok({
      isReplay: false
    });
  }

  recordResult<TResult = unknown>(
    commandId: CommandId,
    receipt: TransportReceipt<TResult>
  ): void {
    const entry = this.#entries.get(commandId);
    if (!entry) return;

    entry.state =
      receipt.status === "executed" ||
      receipt.status === "acknowledged" ||
      receipt.status === "delivered"
        ? "completed"
        : "rejected";
    entry.receipt = receipt;

    if (entry.resolveInFlight) {
      entry.resolveInFlight(receipt);
      entry.resolveInFlight = undefined;
      entry.inFlightPromise = undefined;
    }
  }

  get<TResult = unknown>(commandId: CommandId): DedupeEntry<TResult> | undefined {
    return this.#entries.get(commandId);
  }

  has(commandId: CommandId): boolean {
    return this.#entries.has(commandId);
  }

  getStatus<TResult = unknown>(commandId: CommandId): CommandStatusReport<TResult> {
    const entry = this.#entries.get(commandId);
    if (!entry) {
      return { commandId, state: "unknown" };
    }
    const state: CommandExecutionState =
      entry.state === "pending"
        ? "processing"
        : entry.state === "completed"
          ? "completed"
          : "rejected";

    return {
      commandId,
      state,
      receipt: entry.receipt as TransportReceipt<TResult> | undefined,
      createdAt: entry.createdAt
    };
  }

  clear(): void {
    this.#entries.clear();
  }

  #evictExpired(now: number): void {
    const cutoff = now - this.#ttlMs;
    for (const [id, entry] of this.#entries) {
      // Unresolved pending transactions are never auto-collected (Master §11.10, DEC-593)
      if (entry.state !== "pending" && entry.createdAt < cutoff) {
        this.#entries.delete(id);
      }
    }
  }
}
