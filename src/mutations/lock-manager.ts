import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";

export interface LockHandle {
  readonly handleId: string;
  readonly ownerId: string;
  readonly keys: readonly string[];
  readonly acquiredAt: number;
  release(): void;
}

export interface AcquireLocksOptions {
  readonly ownerId: string;
  readonly keys: readonly string[];
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface LockDiagnosticsInfo {
  readonly key: string;
  readonly currentOwnerId: string | null;
  readonly reentrantDepth: number;
  readonly waitingCount: number;
  readonly heldSince?: number;
}

interface QueuedLockRequest {
  readonly handleId: string;
  readonly ownerId: string;
  readonly keys: readonly string[];
  readonly resolve: (handle: LockHandle) => void;
  readonly reject: (error: PublicError) => void;
  timer: ReturnType<typeof setTimeout> | null;
  cleanupAbortListener?: () => void;
}

interface SingleKeyLockState {
  currentOwnerId: string | null;
  reentrantDepth: number;
  acquiredAt?: number;
  readonly queue: QueuedLockRequest[];
}

/**
 * Normalizes, deduplicates, and deterministically sorts lock keys lexically.
 *
 * INVARIANT DEC-603–612: Keys are ordered deterministically before acquisition,
 * preventing AB-BA deadlocks between concurrent multi-key commands.
 */
export function canonicalizeLockKeys(keys: readonly string[]): readonly string[] {
  const unique = new Set<string>();
  for (const key of keys) {
    if (typeof key === "string") {
      const trimmed = key.trim();
      if (trimmed.length > 0) {
        unique.add(trimmed);
      }
    }
  }
  return Object.freeze(Array.from(unique).sort());
}

/**
 * Central ordered multi-key LockManager (Master Spec §11.5, DEC-603–620, DEC-759–765).
 *
 * Enforces:
 * 1. Deterministic lexical key ordering (deadlock-free).
 * 2. Independent lock sets execute in parallel without mutual contention.
 * 3. Reentrancy support for the same ownerId.
 * 4. Queue timeout watchdog (DM_LOCK_TIMEOUT).
 * 5. Cancellation while waiting in queue via AbortSignal (DM_COMMAND_CANCELLED).
 * 6. Diagnostics on active locks and waiting queues.
 */
export class LockManager {
  readonly #locks = new Map<string, SingleKeyLockState>();
  readonly #defaultTimeoutMs: number;
  #nextHandleSeq = 1;

  constructor(options?: { defaultTimeoutMs?: number }) {
    this.#defaultTimeoutMs = options?.defaultTimeoutMs ?? 10000;
  }

  /**
   * Acquires all specified keys in deterministic order.
   */
  async acquireLocks(
    options: AcquireLocksOptions
  ): Promise<Result<LockHandle, PublicError>> {
    const ownerId = options.ownerId;
    if (!ownerId || ownerId.trim().length === 0) {
      return err(
        createPublicError({
          code: "DM_LOCK_INVALID_OWNER",
          category: "validation",
          message: "ownerId must be a non-empty identifier"
        })
      );
    }

    const orderedKeys = canonicalizeLockKeys(options.keys);
    if (orderedKeys.length === 0) {
      // No keys to lock: returns no-op handle
      return ok({
        handleId: `handle_noop_${this.#nextHandleSeq++}`,
        ownerId,
        keys: Object.freeze([]),
        acquiredAt: Date.now(),
        release: () => {}
      });
    }

    // Check if AbortSignal is already aborted
    if (options.signal?.aborted) {
      return err(
        createPublicError({
          code: "DM_COMMAND_CANCELLED",
          category: "busy",
          message: "Lock acquisition was aborted before start"
        })
      );
    }

    const handleId = `lock_h_${this.#nextHandleSeq++}_${Date.now()}`;
    const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;

    // Fast path: if all keys are free or already owned by ownerId, acquire immediately
    if (this.#canAcquireAllImmediately(ownerId, orderedKeys)) {
      this.#grantKeys(ownerId, orderedKeys);
      return ok(this.#createHandle(handleId, ownerId, orderedKeys));
    }

    // Otherwise, queue the request until all keys can be acquired atomically in order
    return new Promise<Result<LockHandle, PublicError>>((resolve) => {
      let request: QueuedLockRequest;

      let timer: ReturnType<typeof setTimeout> | null = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.#removeFromQueues(request);
          resolve(
            err(
              createPublicError({
                code: "DM_LOCK_TIMEOUT",
                category: "busy",
                message: `Timed out waiting for locks on keys: [${orderedKeys.join(", ")}] after ${timeoutMs}ms`
              })
            )
          );
        }, timeoutMs);
      }

      let cleanupAbortListener: (() => void) | undefined;
      if (options.signal) {
        const onAbort = () => {
          if (timer) clearTimeout(timer);
          this.#removeFromQueues(request);
          resolve(
            err(
              createPublicError({
                code: "DM_COMMAND_CANCELLED",
                category: "busy",
                message: `Lock acquisition on [${orderedKeys.join(", ")}] was cancelled while waiting in queue`
              })
            )
          );
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
        cleanupAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
      }

      request = {
        handleId,
        ownerId,
        keys: orderedKeys,
        resolve: (handle) => {
          if (timer) clearTimeout(timer);
          if (cleanupAbortListener) cleanupAbortListener();
          resolve(ok(handle));
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
          if (cleanupAbortListener) cleanupAbortListener();
          resolve(err(error));
        },
        timer,
        cleanupAbortListener
      };

      this.#enqueue(request);
    });
  }

  isLocked(key: string): boolean {
    const state = this.#locks.get(key);
    return state !== undefined && state.currentOwnerId !== null;
  }

  getLockOwner(key: string): string | null {
    return this.#locks.get(key)?.currentOwnerId ?? null;
  }

  getDiagnostics(): readonly LockDiagnosticsInfo[] {
    const info: LockDiagnosticsInfo[] = [];
    for (const [key, state] of this.#locks) {
      info.push({
        key,
        currentOwnerId: state.currentOwnerId,
        reentrantDepth: state.reentrantDepth,
        waitingCount: state.queue.length,
        heldSince: state.acquiredAt
      });
    }
    return Object.freeze(info);
  }

  #getOrCreateLockState(key: string): SingleKeyLockState {
    let state = this.#locks.get(key);
    if (!state) {
      state = {
        currentOwnerId: null,
        reentrantDepth: 0,
        queue: []
      };
      this.#locks.set(key, state);
    }
    return state;
  }

  #canAcquireAllImmediately(ownerId: string, keys: readonly string[]): boolean {
    for (const key of keys) {
      const state = this.#locks.get(key);
      if (state && state.currentOwnerId !== null && state.currentOwnerId !== ownerId) {
        return false;
      }
      // If there are other waiting requests ahead in the queue, enforce strict FIFO
      if (state && state.queue.length > 0) {
        return false;
      }
    }
    return true;
  }

  #grantKeys(ownerId: string, keys: readonly string[]): void {
    const now = Date.now();
    for (const key of keys) {
      const state = this.#getOrCreateLockState(key);
      if (state.currentOwnerId === ownerId) {
        state.reentrantDepth++;
      } else {
        state.currentOwnerId = ownerId;
        state.reentrantDepth = 1;
        state.acquiredAt = now;
      }
    }
  }

  #releaseKeys(ownerId: string, keys: readonly string[]): void {
    for (const key of keys) {
      const state = this.#locks.get(key);
      if (!state || state.currentOwnerId !== ownerId) {
        continue;
      }

      state.reentrantDepth--;
      if (state.reentrantDepth <= 0) {
        state.currentOwnerId = null;
        state.reentrantDepth = 0;
        state.acquiredAt = undefined;
      }
    }

    // Process queues across all affected keys
    this.#processQueues();
  }

  #enqueue(request: QueuedLockRequest): void {
    for (const key of request.keys) {
      const state = this.#getOrCreateLockState(key);
      state.queue.push(request);
    }
    this.#processQueues();
  }

  #processingQueues = false;

  #removeFromQueues(request: QueuedLockRequest): void {
    for (const key of request.keys) {
      const state = this.#locks.get(key);
      if (state) {
        const idx = state.queue.indexOf(request);
        if (idx !== -1) {
          state.queue.splice(idx, 1);
        }
      }
    }
    this.#processQueues();
  }

  #processQueues(): void {
    if (this.#processingQueues) return;
    this.#processingQueues = true;
    try {
      let madeProgress = true;
      while (madeProgress) {
        madeProgress = false;
        const candidateRequests = new Set<QueuedLockRequest>();
        for (const state of this.#locks.values()) {
          if (state.queue.length > 0) {
            candidateRequests.add(state.queue[0]);
          }
        }

        for (const request of candidateRequests) {
          if (this.#canAcquireRequest(request)) {
            // Remove from queues without re-entering processQueues
            for (const key of request.keys) {
              const state = this.#locks.get(key);
              if (state) {
                const idx = state.queue.indexOf(request);
                if (idx !== -1) {
                  state.queue.splice(idx, 1);
                }
              }
            }
            this.#grantKeys(request.ownerId, request.keys);
            request.resolve(this.#createHandle(request.handleId, request.ownerId, request.keys));
            madeProgress = true;
            break; // Restart evaluation with updated state
          }
        }
      }
    } finally {
      this.#processingQueues = false;
    }
  }

  #canAcquireRequest(request: QueuedLockRequest): boolean {
    for (const key of request.keys) {
      const state = this.#locks.get(key);
      if (!state) continue;

      if (state.currentOwnerId !== null && state.currentOwnerId !== request.ownerId) {
        return false;
      }

      // Must be at the front of this key's queue
      if (state.queue.length > 0 && state.queue[0] !== request) {
        return false;
      }
    }
    return true;
  }

  #createHandle(handleId: string, ownerId: string, keys: readonly string[]): LockHandle {
    let released = false;
    return Object.freeze({
      handleId,
      ownerId,
      keys,
      acquiredAt: Date.now(),
      release: () => {
        if (!released) {
          released = true;
          this.#releaseKeys(ownerId, keys);
        }
      }
    });
  }
}
