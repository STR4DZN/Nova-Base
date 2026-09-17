import type { CommandId, DomainCommand } from "./command-envelope.js";
import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";

export type QueuedCommandStatus =
  | "queued"
  | "running"
  | "committing"
  | "completed"
  | "cancelled"
  | "failed";

export interface QueuedCommandEntry<TPayload = unknown> {
  readonly commandId: CommandId;
  readonly type: string;
  readonly senderUserId: string | null;
  readonly enqueuedAt: number;
  readonly priority: number;
  status: QueuedCommandStatus;
  startedAt?: number;
  finishedAt?: number;
  cancelReason?: string;
  readonly abortController: AbortController;
}

export interface CommandQueueDiagnostics {
  readonly queuedCount: number;
  readonly runningCount: number;
  readonly cancelledCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly activeEntries: readonly {
    readonly commandId: CommandId;
    readonly type: string;
    readonly senderUserId: string | null;
    readonly status: QueuedCommandStatus;
    readonly enqueuedAt: number;
  }[];
}

export interface CommandQueueOptions {
  readonly maxConcurrency?: number;
}

interface CommandWaiter {
  readonly commandId: CommandId;
  readonly priority: number;
  readonly enqueuedAt: number;
  readonly resolve: () => void;
  readonly reject: (error: PublicError) => void;
}

/**
 * Authority Command Queue & Scheduler (Master Spec §11.2, §11.4, DEC-541–552, G2-AUD-015).
 *
 * Provides:
 * 1. Explicit FIFO command scheduling on the Primary Authority host.
 * 2. Internal policy priority support (system/recovery > user commands; user cannot forge high priority).
 * 3. Pre-commit authenticated command cancellation via AbortSignal.
 * 4. Diagnostics on queue length, running tasks, and cancellation state.
 */
export const DEFAULT_COMMAND_QUEUE_CONCURRENCY = 10;

export class CommandQueue {
  readonly #entries = new Map<CommandId, QueuedCommandEntry>();
  readonly #waitingQueue: CommandWaiter[] = [];
  readonly #maxConcurrency: number;
  #runningCount = 0;
  #cancelledCount = 0;
  #completedCount = 0;
  #failedCount = 0;

  constructor(options?: CommandQueueOptions) {
    this.#maxConcurrency = options?.maxConcurrency ?? DEFAULT_COMMAND_QUEUE_CONCURRENCY;
  }

  enqueue<TPayload>(
    command: DomainCommand<TPayload>,
    senderUserId: string | null,
    options?: { priority?: number }
  ): QueuedCommandEntry<TPayload> {
    const existing = this.#entries.get(command.commandId);
    if (existing) {
      return existing as QueuedCommandEntry<TPayload>;
    }

    const priority = options?.priority ?? 0;
    const entry: QueuedCommandEntry<TPayload> = {
      commandId: command.commandId,
      type: command.type,
      senderUserId,
      enqueuedAt: Date.now(),
      priority,
      status: "queued",
      abortController: new AbortController()
    };

    this.#entries.set(command.commandId, entry as QueuedCommandEntry<unknown>);
    return entry;
  }

  /**
   * Waits for scheduler permit before executing the command handler.
   *
   * Enforces FIFO within the same priority level, and processes higher priority
   * commands first. Unblocks immediately if concurrency slot is free.
   */
  async acquirePermit(commandId: CommandId): Promise<void> {
    const entry = this.#entries.get(commandId);
    if (!entry) {
      throw createPublicError({
        code: "DM_COMMAND_NOT_FOUND",
        category: "not-found",
        message: `Command '${commandId}' was not enqueued`
      });
    }

    if (entry.status === "cancelled") {
      throw createPublicError({
        code: "DM_COMMAND_CANCELLED",
        category: "busy",
        message: `Command was cancelled in queue: ${entry.cancelReason ?? "Unknown reason"}`
      });
    }

    if (this.#runningCount < this.#maxConcurrency) {
      this.#runningCount++;
      this.markRunning(commandId);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: CommandWaiter = {
        commandId,
        priority: entry.priority,
        enqueuedAt: entry.enqueuedAt,
        resolve: () => {
          this.markRunning(commandId);
          resolve();
        },
        reject
      };

      this.#insertWaiter(waiter);
    });
  }

  /**
   * Releases an execution permit after command finishes or fails, unblocking
   * the next waiting command in the queue.
   */
  releasePermit(commandId: CommandId): void {
    const entry = this.#entries.get(commandId);
    if (entry && (entry.status === "running" || entry.status === "committing")) {
      this.markFinished(commandId, false);
    }
    this.#runningCount = Math.max(0, this.#runningCount - 1);
    this.#processQueue();
  }

  #insertWaiter(waiter: CommandWaiter): void {
    // Sort order: higher priority first; if equal priority, earlier enqueuedAt first (FIFO)
    let idx = this.#waitingQueue.length;
    for (let i = 0; i < this.#waitingQueue.length; i++) {
      const other = this.#waitingQueue[i];
      if (
        waiter.priority > other.priority ||
        (waiter.priority === other.priority && waiter.enqueuedAt < other.enqueuedAt)
      ) {
        idx = i;
        break;
      }
    }
    this.#waitingQueue.splice(idx, 0, waiter);
  }

  #processQueue(): void {
    while (this.#runningCount < this.#maxConcurrency && this.#waitingQueue.length > 0) {
      const waiter = this.#waitingQueue.shift()!;
      const entry = this.#entries.get(waiter.commandId);

      if (entry && entry.status === "cancelled") {
        waiter.reject(
          createPublicError({
            code: "DM_COMMAND_CANCELLED",
            category: "busy",
            message: `Command was cancelled: ${entry.cancelReason ?? "Cancelled in queue"}`
          })
        );
        continue;
      }

      this.#runningCount++;
      waiter.resolve();
    }
  }

  get(commandId: CommandId): QueuedCommandEntry | undefined {
    return this.#entries.get(commandId);
  }

  markRunning(commandId: CommandId): boolean {
    const entry = this.#entries.get(commandId);
    if (!entry) return false;
    if (entry.status === "cancelled") return false;
    entry.status = "running";
    entry.startedAt = Date.now();
    return true;
  }

  markCommitting(commandId: CommandId): boolean {
    const entry = this.#entries.get(commandId);
    if (!entry) return false;
    if (entry.status === "cancelled") return false;
    entry.status = "committing";
    return true;
  }

  markFinished(commandId: CommandId, success: boolean): void {
    const entry = this.#entries.get(commandId);
    if (!entry) return;
    if (entry.status === "cancelled" || entry.status === "completed" || entry.status === "failed") return;

    entry.finishedAt = Date.now();
    if (success) {
      entry.status = "completed";
      this.#completedCount++;
    } else {
      entry.status = "failed";
      this.#failedCount++;
    }
  }

  cancel(
    commandId: CommandId,
    requesterUserId: string | null,
    isGM: boolean,
    reason = "Command cancelled by user"
  ): Result<void, PublicError> {
    const entry = this.#entries.get(commandId);
    if (!entry) {
      return err(
        createPublicError({
          code: "DM_COMMAND_NOT_FOUND",
          category: "not-found",
          message: `Cannot cancel: command '${commandId}' was not found in queue`
        })
      );
    }

    if (entry.status === "completed" || entry.status === "failed") {
      return err(
        createPublicError({
          code: "DM_COMMAND_ALREADY_FINISHED",
          category: "conflict",
          message: `Cannot cancel: command '${commandId}' has already finished with status '${entry.status}'`
        })
      );
    }

    if (entry.status === "committing") {
      return err(
        createPublicError({
          code: "DM_COMMAND_COMMITTING_NON_CANCELLABLE",
          category: "conflict",
          message: `Cannot cancel: command '${commandId}' is already past the commit boundary`
        })
      );
    }

    if (entry.status === "cancelled") {
      return ok(undefined); // Idempotent cancellation
    }

    // Permission check: only the sender who enqueued the command or a GM may cancel it
    if (!isGM && entry.senderUserId !== requesterUserId) {
      return err(
        createPublicError({
          code: "DM_PERMISSION_CANCEL_DENIED",
          category: "permission",
          message: `User '${requesterUserId}' is not authorized to cancel command owned by '${entry.senderUserId}'`
        })
      );
    }

    entry.status = "cancelled";
    entry.cancelReason = reason;
    entry.finishedAt = Date.now();
    this.#cancelledCount++;
    entry.abortController.abort();

    // If waiting in queue, remove waiter and reject it
    const waiterIdx = this.#waitingQueue.findIndex((w) => w.commandId === commandId);
    if (waiterIdx !== -1) {
      const waiter = this.#waitingQueue.splice(waiterIdx, 1)[0];
      waiter.reject(
        createPublicError({
          code: "DM_COMMAND_CANCELLED",
          category: "busy",
          message: reason
        })
      );
      this.#processQueue(); // Unblock next waiter immediately
    }

    return ok(undefined);
  }

  getDiagnostics(): CommandQueueDiagnostics {
    let queuedCount = 0;
    let runningCount = 0;
    const activeEntries: Array<{
      readonly commandId: CommandId;
      readonly type: string;
      readonly senderUserId: string | null;
      readonly status: QueuedCommandStatus;
      readonly enqueuedAt: number;
    }> = [];

    for (const entry of this.#entries.values()) {
      if (entry.status === "queued") queuedCount++;
      if (entry.status === "running" || entry.status === "committing") runningCount++;
      if (entry.status === "queued" || entry.status === "running" || entry.status === "committing") {
        activeEntries.push({
          commandId: entry.commandId,
          type: entry.type,
          senderUserId: entry.senderUserId,
          status: entry.status,
          enqueuedAt: entry.enqueuedAt
        });
      }
    }

    return Object.freeze({
      queuedCount,
      runningCount,
      cancelledCount: this.#cancelledCount,
      completedCount: this.#completedCount,
      failedCount: this.#failedCount,
      activeEntries: Object.freeze(activeEntries)
    });
  }

  clear(): void {
    for (const entry of this.#entries.values()) {
      if (entry.status === "queued" || entry.status === "running") {
        entry.abortController.abort();
      }
    }
    this.#entries.clear();
  }
}
