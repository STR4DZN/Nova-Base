import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { canonicalizeLockKeys } from "./lock-manager.js";

/**
 * RecoveryFence — Lightweight logical barrier installed when an unresolved transaction
 * enters needs-recovery (Master Remediation §10, §11, §23, §24, INV-07).
 *
 * Prevents any new conflicting mutations from executing in the same scope,
 * even when physical lock acquisition is pending, delayed, or during restart.
 */
export interface RecoveryFence {
  readonly transactionId: string;
  readonly lockKeys: readonly string[];
  readonly createdAt: number;
  readonly reason: string;
}

export class RecoveryFenceRegistry {
  readonly #fences = new Map<string, RecoveryFence>();

  install(fence: RecoveryFence): void {
    const canonical = canonicalizeLockKeys(fence.lockKeys);
    this.#fences.set(fence.transactionId, {
      ...fence,
      lockKeys: canonical
    });
  }

  installFence(fence: Omit<RecoveryFence, "createdAt"> & { createdAt?: number }): void {
    this.install({
      createdAt: fence.createdAt ?? Date.now(),
      ...fence
    });
  }

  remove(transactionId: string): void {
    this.#fences.delete(transactionId);
  }

  removeFence(transactionId: string): void {
    this.remove(transactionId);
  }

  isScopeBlocked(keys: readonly string[]): boolean {
    return this.hasFenceForKeys(keys);
  }

  hasFenceForKeys(keys: readonly string[]): boolean {
    const canonical = canonicalizeLockKeys(keys);
    const keySet = new Set(canonical);
    for (const fence of this.#fences.values()) {
      for (const k of fence.lockKeys) {
        if (keySet.has(k)) {
          return true;
        }
      }
    }
    return false;
  }

  getFenceForKeys(keys: readonly string[]): RecoveryFence | undefined {
    const canonical = canonicalizeLockKeys(keys);
    const keySet = new Set(canonical);
    for (const fence of this.#fences.values()) {
      for (const k of fence.lockKeys) {
        if (keySet.has(k)) {
          return fence;
        }
      }
    }
    return undefined;
  }

  getFenceForTransaction(transactionId: string): RecoveryFence | undefined {
    return this.#fences.get(transactionId);
  }

  getFences(): readonly RecoveryFence[] {
    return Object.freeze(Array.from(this.#fences.values()));
  }

  get count(): number {
    return this.#fences.size;
  }

  assertKeysAvailable(keys: readonly string[]): Result<void, PublicError> {
    const conflict = this.getFenceForKeys(keys);
    if (conflict) {
      return err(
        createPublicError({
          code: "DM_RECOVERY_SCOPE_BLOCKED",
          category: "busy",
          message: `Operation scope is blocked by active recovery fence for transaction '${conflict.transactionId}' on keys: [${conflict.lockKeys.join(", ")}] (reason: ${conflict.reason})`,
          details: {
            conflictingTransactionId: conflict.transactionId,
            fenceKeys: conflict.lockKeys,
            requestedKeys: canonicalizeLockKeys(keys),
            reason: conflict.reason,
            createdAt: conflict.createdAt
          }
        })
      );
    }
    return ok(undefined);
  }

  clear(): void {
    this.#fences.clear();
  }
}
