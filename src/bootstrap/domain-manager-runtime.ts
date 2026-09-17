import {
  FoundryPrimaryAuthorityAdapter,
  type PrimaryAuthorityHost
} from "../authority/foundry-primary-authority-adapter.js";
import { FoundryDomainDocumentStore } from "../storage/adapters/foundry-domain-document-store.js";
import {
  DomainRepository,
  type DomainDocumentStore,
  type DomainReadRepository,
  type DomainRepositoryContract
} from "../storage/repositories/domain-repository.js";
import { CommandRegistry } from "../commands/command-registry.js";
import { CommandBus } from "../commands/command-bus.js";
import { CommandQueue } from "../commands/command-queue.js";
import { CommandDedupeStore } from "../commands/command-dedupe-store.js";
import { RateLimiter } from "../commands/rate-limiter.js";
import type { CommandTransport } from "../commands/command-transport.js";
import { FoundryCommandTransportAdapter } from "../commands/foundry-command-transport-adapter.js";
import { LockManager } from "../mutations/lock-manager.js";
import { MutationCoordinator } from "../mutations/mutation-coordinator.js";
import { TransactionStore } from "../mutations/transaction-store.js";
import { RecoveryService } from "../mutations/recovery-service.js";
import { registerDomainCommandHandlers } from "../domains/domain-command-handlers.js";
import {
  G2DiagnosticsProvider,
  type G2DiagnosticsSnapshot
} from "../diagnostics/g2-diagnostics-provider.js";

/**
 * Runtime services owned by the Domain Manager composition root.
 *
 * Implements Master Spec §11.1, §11.2, G2-AUD-001, G2-AUD-008:
 * - Public UI/services only see read operations via `domains: DomainReadRepository`.
 * - State mutations must strictly be dispatched via `commandBus`.
 * - Complete Gate G2 vertical is composed and reachable from production entrypoint.
 */
export interface DomainManagerRuntime {
  readonly domains: DomainReadRepository;
  readonly authority: PrimaryAuthorityHost;
  readonly commandBus: CommandBus;
  readonly registry: CommandRegistry;
  readonly transport: CommandTransport;
  readonly lockManager: LockManager;
  readonly coordinator: MutationCoordinator;
  readonly recovery: RecoveryService;
  readonly transactionStore: TransactionStore;
  readonly diagnostics: G2DiagnosticsProvider;
  destroy(): void;
}

export interface DomainManagerRuntimeOptions {
  readonly domainStore?: DomainDocumentStore;
  readonly authority?: PrimaryAuthorityHost;
  readonly transport?: CommandTransport;
  readonly lockManager?: LockManager;
  readonly transactionStore?: TransactionStore;
  readonly rateLimiter?: RateLimiter;
  readonly dedupeStore?: CommandDedupeStore;
  readonly commandQueue?: CommandQueue;
}

/**
 * Composes the complete Gate G1 and G2 runtime.
 */
export function composeDomainManagerRuntime(
  options: DomainManagerRuntimeOptions = {}
): DomainManagerRuntime {
  const domainStore = options.domainStore ?? new FoundryDomainDocumentStore();
  const mutableDomainRepo: DomainRepositoryContract = new DomainRepository(domainStore);

  const authority = options.authority ?? new FoundryPrimaryAuthorityAdapter();
  const lockManager = options.lockManager ?? new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });
  const transactionStore = options.transactionStore ?? new TransactionStore();
  const recovery = new RecoveryService({ transactionStore, lockManager });

  const registry = new CommandRegistry();
  registerDomainCommandHandlers(registry, coordinator, mutableDomainRepo);
  registry.freeze();

  const commandQueue = options.commandQueue ?? new CommandQueue();
  const dedupeStore = options.dedupeStore ?? new CommandDedupeStore();
  const rateLimiter = options.rateLimiter ?? new RateLimiter();

  const transport =
    options.transport ??
    new FoundryCommandTransportAdapter({
      authorityService: authority.service
    });

  const commandBus = new CommandBus({
    registry,
    authorityService: authority.service,
    coordinator,
    transport,
    rateLimiter,
    dedupeStore,
    commandQueue
  });

  const diagnostics = new G2DiagnosticsProvider({
    authorityService: authority.service,
    lockManager,
    commandQueue,
    transactionStore,
    registry,
    transport
  });

  return Object.freeze({
    // G2-AUD-008: Read-only facade exposed publicly
    domains: mutableDomainRepo as DomainReadRepository,
    authority,
    commandBus,
    registry,
    transport,
    lockManager,
    coordinator,
    recovery,
    transactionStore,
    diagnostics,
    destroy: () => {
      commandBus.destroy();
      if ("destroy" in transport && typeof (transport as any).destroy === "function") {
        (transport as any).destroy();
      }
      recovery.clear();
    }
  });
}
