import type { PublicError } from "../core/contracts/public-error.js";
import type { Result } from "../core/contracts/result.js";
import type { ChildReceipt } from "../projects/plans/project-plan-types.js";

export type ReconcileOutcome = "applied" | "not-applied" | "unknown";

/**
 * TransactionalChildHandler — Standard contract for child and custom side effect handlers
 * participating in CompositeMutationSession (Master Remediation §7, §8).
 */
export interface TransactionalChildHandler<TInput = unknown, TReceipt = ChildReceipt> {
  execute(input: TInput, operationRef: string): Promise<Result<TReceipt, PublicError> | ChildReceipt>;
  reconcile?(operationRef: string): Promise<Result<ReconcileOutcome, PublicError>>;
  compensate?(operationRef: string, receipt?: unknown): Promise<Result<void, PublicError>>;
}

/**
 * Registry of stable child and custom transactional handlers surviving restarts and failovers.
 */
export interface TransactionalChildHandlerRegistry {
  register(handlerKey: string, handler: TransactionalChildHandler): void;
  get(handlerKey: string): TransactionalChildHandler | undefined;
  has(handlerKey: string): boolean;
  clear(): void;
}

export class DefaultTransactionalChildHandlerRegistry implements TransactionalChildHandlerRegistry {
  readonly #handlers = new Map<string, TransactionalChildHandler>();

  register(handlerKey: string, handler: TransactionalChildHandler): void {
    this.#handlers.set(handlerKey, handler);
  }

  get(handlerKey: string): TransactionalChildHandler | undefined {
    return this.#handlers.get(handlerKey);
  }

  has(handlerKey: string): boolean {
    return this.#handlers.has(handlerKey);
  }

  clear(): void {
    this.#handlers.clear();
  }
}
