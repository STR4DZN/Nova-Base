import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";

export interface RateLimitRule {
  readonly windowMs: number;
  readonly maxRequests: number;
}

export interface RateLimiterOptions {
  readonly defaultRule?: RateLimitRule;
  readonly commandRules?: Readonly<Record<string, RateLimitRule>>;
  /**
   * Maximum loop protection limit for system/internal callers (null userId).
   */
  readonly systemMaxRequestsPerSecond?: number;
}

interface UserRequestBucket {
  timestamps: number[];
}

/**
 * Defensive rate limiter for the CommandBus (Master Spec §11.2, DEC-787–793).
 *
 * Enforces sliding window limits per authenticated user to prevent flood/abuse
 * and recursive loops, while allowing specific limits per command type.
 */
export class RateLimiter {
  readonly #defaultRule: RateLimitRule;
  readonly #commandRules: Map<string, RateLimitRule>;
  readonly #systemMaxPerSecond: number;
  readonly #buckets = new Map<string, UserRequestBucket>();

  constructor(options?: RateLimiterOptions) {
    this.#defaultRule = options?.defaultRule ?? {
      windowMs: 1000,
      maxRequests: 50
    };

    this.#commandRules = new Map();
    if (options?.commandRules) {
      for (const [type, rule] of Object.entries(options.commandRules)) {
        this.#commandRules.set(type, rule);
      }
    }

    this.#systemMaxPerSecond = options?.systemMaxRequestsPerSecond ?? 1000;
  }

  checkAndConsume(
    userId: string | null,
    commandType: string,
    now: number = Date.now()
  ): Result<boolean, PublicError> {
    const key = userId ? `${userId}:${commandType}` : `__system__:${commandType}`;
    const rule = this.#commandRules.get(commandType) ?? (
      userId === null
        ? { windowMs: 1000, maxRequests: this.#systemMaxPerSecond }
        : this.#defaultRule
    );

    let bucket = this.#buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.#buckets.set(key, bucket);
    }

    const cutoff = now - rule.windowMs;
    // Evict expired timestamps
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

    if (bucket.timestamps.length >= rule.maxRequests) {
      return err(
        createPublicError({
          code: "DM_RATE_LIMIT_EXCEEDED",
          category: "busy",
          message: `Rate limit exceeded for ${userId ? `user '${userId}'` : "system"} on command '${commandType}'. Maximum ${rule.maxRequests} requests per ${rule.windowMs}ms.`
        })
      );
    }

    bucket.timestamps.push(now);

    // Bounded memory protection: prune expired buckets when map size exceeds 500
    if (this.#buckets.size > 500) {
      for (const [bKey, b] of this.#buckets) {
        if (b.timestamps.length === 0 || (b.timestamps[b.timestamps.length - 1] ?? 0) <= cutoff) {
          this.#buckets.delete(bKey);
        }
      }
    }

    return ok(true);
  }

  reset(): void {
    this.#buckets.clear();
  }
}
