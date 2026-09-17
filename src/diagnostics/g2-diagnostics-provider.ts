import type { PrimaryAuthorityService } from "../authority/primary-authority-service.js";
import type { AuthorityElectionUser } from "../authority/primary-authority-election.js";
import type { LockManager, LockDiagnosticsInfo } from "../mutations/lock-manager.js";
import type { CommandQueue, CommandQueueDiagnostics } from "../commands/command-queue.js";
import type { TransactionStore } from "../mutations/transaction-store.js";
import type { TransactionRecord } from "../mutations/transaction-record.js";
import type { CommandRegistry } from "../commands/command-registry.js";
import type { CommandTransport } from "../commands/command-transport.js";
import type { RateLimiter, AbuseIncident } from "../commands/rate-limiter.js";

export interface G2DiagnosticsSnapshot {
  readonly authority: {
    readonly available: boolean;
    readonly authorityUserId: string | null;
    readonly authorityEpoch: number;
    readonly isCurrentClientAuthority: boolean;
  };
  readonly transport: {
    readonly name: string;
    readonly isAvailable: boolean;
  };
  readonly registry: {
    readonly totalCommands: number;
    readonly isFrozen: boolean;
    readonly registeredTypes: readonly string[];
  };
  readonly locks: {
    readonly activeCount: number;
    readonly waitingCount: number;
    readonly items: readonly LockDiagnosticsInfo[];
  };
  readonly queue: CommandQueueDiagnostics;
  readonly recovery: {
    readonly unresolvedCount: number;
    readonly unresolvedTransactions: readonly {
      readonly transactionId: string;
      readonly commandId: string;
      readonly state: string;
      readonly authorityEpoch: number;
      readonly lockKeys: readonly string[];
    }[];
  };
  readonly abuse: {
    readonly totalIncidents: number;
    readonly records: readonly AbuseIncident[];
  };
  readonly collectedAtReal: number;
}

export interface G2DiagnosticsProviderOptions {
  readonly authorityService: PrimaryAuthorityService<AuthorityElectionUser>;
  readonly lockManager: LockManager;
  readonly commandQueue: CommandQueue;
  readonly transactionStore: TransactionStore;
  readonly registry: CommandRegistry;
  readonly transport: CommandTransport;
  readonly rateLimiter?: RateLimiter;
}

/**
 * Composite G2 Diagnostics Provider (Master Spec §11.2, G2-AUD-024).
 *
 * Exposes a deep read-only operational snapshot of:
 * - Primary Authority election state & epoch
 * - Transport connection status
 * - CommandRegistry catalog
 * - Active locks and lock queue contention
 * - Command scheduling queue
 * - Unresolved transactions requiring recovery
 */
export class G2DiagnosticsProvider {
  readonly #authorityService: PrimaryAuthorityService<AuthorityElectionUser>;
  readonly #lockManager: LockManager;
  readonly #commandQueue: CommandQueue;
  readonly #transactionStore: TransactionStore;
  readonly #registry: CommandRegistry;
  readonly #transport: CommandTransport;
  readonly #rateLimiter: RateLimiter | null;

  constructor(options: G2DiagnosticsProviderOptions) {
    this.#authorityService = options.authorityService;
    this.#lockManager = options.lockManager;
    this.#commandQueue = options.commandQueue;
    this.#transactionStore = options.transactionStore;
    this.#registry = options.registry;
    this.#transport = options.transport;
    this.#rateLimiter = options.rateLimiter ?? null;
  }

  getSnapshot(): G2DiagnosticsSnapshot {
    const authStatus = this.#authorityService.getStatus();
    const lockDiags = this.#lockManager.getDiagnostics();
    const activeLockCount = lockDiags.filter((d) => d.currentOwnerId !== null).length;
    const waitingLockCount = lockDiags.reduce((acc, d) => acc + d.waitingCount, 0);

    const queueDiags = this.#commandQueue.getDiagnostics();
    const unresolvedTxs = this.#transactionStore.listUnresolved();

    const abuseRecords = this.#rateLimiter?.getAbuseRecords() ?? [];
    const totalAbuseIncidents = abuseRecords.reduce((acc, r) => acc + r.count, 0);

    return Object.freeze({
      authority: Object.freeze({
        available: authStatus.available,
        authorityUserId: authStatus.authorityUserId,
        authorityEpoch: authStatus.authorityEpoch,
        isCurrentClientAuthority: this.#authorityService.isCurrentUser()
      }),
      transport: Object.freeze({
        name: this.#transport.name,
        isAvailable: this.#transport.isAvailable
      }),
      registry: Object.freeze({
        totalCommands: this.#registry.listRegisteredTypes().length,
        isFrozen: this.#registry.isFrozen,
        registeredTypes: this.#registry.listRegisteredTypes()
      }),
      locks: Object.freeze({
        activeCount: activeLockCount,
        waitingCount: waitingLockCount,
        items: lockDiags
      }),
      queue: queueDiags,
      recovery: Object.freeze({
        unresolvedCount: unresolvedTxs.length,
        unresolvedTransactions: Object.freeze(
          unresolvedTxs.map((tx) =>
            Object.freeze({
              transactionId: tx.transactionId,
              commandId: tx.commandId,
              state: tx.state,
              authorityEpoch: tx.authorityEpoch,
              lockKeys: tx.lockKeys
            })
          )
        )
      }),
      abuse: Object.freeze({
        totalIncidents: totalAbuseIncidents,
        records: Object.freeze(abuseRecords.map((r) => Object.freeze({ ...r })))
      }),
      collectedAtReal: Date.now()
    });
  }
}
