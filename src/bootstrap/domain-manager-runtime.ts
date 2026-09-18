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
import { registerPopulationCommandHandlers } from "../people/commands/population-commands.js";
import { registerNotableCommandHandlers } from "../people/commands/notable-commands.js";
import { registerRoleCommandHandlers } from "../people/commands/role-commands.js";
import { registerOperationalGroupCommandHandlers } from "../people/commands/operational-group-commands.js";
import { registerAssignmentCommandHandlers } from "../people/commands/assignment-commands.js";
import { registerRepairCommandHandlers } from "../people/commands/repair-commands.js";
import { PeopleService, type PublicPeopleApi } from "../people/services/people-service.js";
import { PeopleRepairTool } from "../people/services/people-repair-tool.js";
import { PeopleApplication, PeopleApplicationController } from "../ui/domain-patterns/people/people-app.js";
import {
  DefaultDomainControllerProvider,
  type DomainControllerProvider
} from "../domains/domain-controller-provider.js";
import { registerDomainControllerPolicy } from "../people/commands/people-permissions.js";
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
 * - Complete Gate G2 and G3 verticals are composed and reachable from production entrypoint.
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
  readonly people: PublicPeopleApi;
  readonly repairTool: PeopleRepairTool;
  readonly controllerProvider: DomainControllerProvider;
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
  readonly controllerProvider?: DomainControllerProvider;
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
  registerPopulationCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerNotableCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerRoleCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerOperationalGroupCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerAssignmentCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerRepairCommandHandlers(registry, coordinator, mutableDomainRepo);
  registry.freeze();

  const commandQueue = options.commandQueue ?? new CommandQueue({ maxConcurrency: 10 });
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
    transport,
    rateLimiter
  });

  // G2-AUD-008: Physical read-only facade for domains, preventing any mutable operations in runtime
  const readOnlyDomains: DomainReadRepository = Object.freeze({
    read: (id: string) => mutableDomainRepo.read(id),
    load: (id: string) => mutableDomainRepo.load(id),
    query: (query?: any) => mutableDomainRepo.query(query),
    checkIntegrity: () => mutableDomainRepo.checkIntegrity(),
    getIndex: () => {
      const liveIndex = mutableDomainRepo.getIndex();
      return Object.freeze({
        get: (id: string) => liveIndex.get(id),
        list: () => liveIndex.list(),
        query: (q?: any) => liveIndex.query(q)
      }) as any;
    }
  });

  const controllerProvider = options.controllerProvider ?? new DefaultDomainControllerProvider();

  // Wire canonical DomainControllerPolicy for the runtime
  const unregisterPolicy = registerDomainControllerPolicy((domainId, userId, context) => {
    return controllerProvider.isDomainController(domainId, userId, context);
  });

  const people = new PeopleService(readOnlyDomains, { commandBus });
  const repairTool = new PeopleRepairTool(commandBus);

  return Object.freeze({
    // G2-AUD-008: Read-only facade exposed publicly
    domains: readOnlyDomains,
    authority,
    commandBus,
    registry,
    transport,
    lockManager,
    coordinator,
    recovery,
    transactionStore,
    diagnostics,
    people,
    repairTool,
    controllerProvider,
    destroy: () => {
      unregisterPolicy();
      commandBus.destroy();
      if ("destroy" in transport && typeof (transport as any).destroy === "function") {
        (transport as any).destroy();
      }
      recovery.clear();
    }
  });
}

export {
  DefaultDomainControllerProvider,
  type DomainControllerProvider,
  type DomainControllerEvaluationContext
} from "../domains/domain-controller-provider.js";
export { PeopleRepairTool } from "../people/services/people-repair-tool.js";
export { PeopleApplication, PeopleApplicationController } from "../ui/domain-patterns/people/people-app.js";
export { PeopleService, type PublicPeopleApi } from "../people/services/people-service.js";

