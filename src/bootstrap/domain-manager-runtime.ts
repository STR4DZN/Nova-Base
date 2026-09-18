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
import { BUILD_METADATA } from "../core/versioning/build-metadata.js";
import {
  ResourceDefinitionRegistry,
  createDefaultResourceRegistry
} from "../economy/definitions/resource-registry.js";
import { LedgerStore } from "../economy/ledger/ledger-store.js";
import {
  FoundryJournalLedgerStorageAdapter,
  type LedgerStorageAdapter
} from "../economy/storage/ledger-storage-adapter.js";
import { ReservationStore } from "../economy/reservations/reservation-store.js";
import {
  FoundryJournalReservationStorageAdapter,
  type ReservationStorageAdapter
} from "../economy/storage/reservation-storage-adapter.js";
import {
  FoundryJournalTransactionStorageAdapter,
  type TransactionStorageAdapter
} from "../mutations/transaction-storage-adapter.js";
import {
  CustomResourceDefinitionStore,
  FoundryJournalCustomResourceStorageAdapter,
  type CustomResourceStorageAdapter
} from "../economy/definitions/custom-resource-store.js";
import { EconomyService } from "../economy/services/economy-service.js";
import {
  DefaultPublicEconomyApi,
  type PublicEconomyApi
} from "../economy/services/public-economy-api.js";
import { registerEconomyCommands } from "../economy/commands/economy-commands.js";
import {
  ProviderRegistry,
  createDefaultProviderRegistry
} from "../economy/providers/provider-registry.js";
import { ThresholdService } from "../economy/thresholds/threshold-service.js";
import { EconomyApplication, EconomyApplicationController } from "../ui/domain-patterns/economy/economy-app.js";

/**
 * Public API exposed to external modules / users via module.api.
 *
 * Implements G4-AUD-004:
 * Strict isolation between internal stores/mutators and public query/dispatch facades.
 */
export interface PublicModuleApi {
  readonly version: string;
  readonly domains: DomainReadRepository;
  readonly economy: PublicEconomyApi;
  readonly people: PublicPeopleApi;
  readonly diagnostics: G2DiagnosticsProvider;
}

/**
 * Runtime services owned by the Domain Manager composition root.
 *
 * Implements Master Spec §11.1, §11.2, G2-AUD-001, G2-AUD-008, G4-AUD-004:
 * - Public UI/services only see read operations and sanitized DTOs via read-only facades.
 * - State mutations must strictly be dispatched via `commandBus`.
 * - Complete Gate G2, G3, and G4 verticals are composed and reachable from production entrypoint.
 */
export interface DomainManagerRuntime {
  readonly publicApi: PublicModuleApi;
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
  readonly economy: PublicEconomyApi;
  readonly resourceRegistry: ResourceDefinitionRegistry;
  readonly ledgerStore: LedgerStore;
  readonly reservationStore: ReservationStore;
  readonly providerRegistry: ProviderRegistry;
  readonly customResourceStore: CustomResourceDefinitionStore;
  readonly thresholds: ThresholdService;
  initialize(): Promise<void>;
  destroy(): void;
}

export interface DomainManagerRuntimeOptions {
  readonly domainStore?: DomainDocumentStore;
  readonly authority?: PrimaryAuthorityHost;
  readonly transport?: CommandTransport;
  readonly lockManager?: LockManager;
  readonly transactionStore?: TransactionStore;
  readonly transactionStorageAdapter?: TransactionStorageAdapter;
  readonly rateLimiter?: RateLimiter;
  readonly dedupeStore?: CommandDedupeStore;
  readonly commandQueue?: CommandQueue;
  readonly controllerProvider?: DomainControllerProvider;
  readonly resourceRegistry?: ResourceDefinitionRegistry;
  readonly ledgerStore?: LedgerStore;
  readonly ledgerStorageAdapter?: LedgerStorageAdapter;
  readonly reservationStore?: ReservationStore;
  readonly reservationStorageAdapter?: ReservationStorageAdapter;
  readonly providerRegistry?: ProviderRegistry;
  readonly customResourceStore?: CustomResourceDefinitionStore;
  readonly customResourceStorageAdapter?: CustomResourceStorageAdapter;
  readonly thresholdService?: ThresholdService;
}

/**
 * Composes the complete Domain Manager runtime.
 */
export function composeDomainManagerRuntime(
  options: DomainManagerRuntimeOptions = {}
): DomainManagerRuntime {
  const domainStore = options.domainStore ?? new FoundryDomainDocumentStore();
  const mutableDomainRepo: DomainRepositoryContract = new DomainRepository(domainStore);

  const authority = options.authority ?? new FoundryPrimaryAuthorityAdapter();
  const lockManager = options.lockManager ?? new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });
  const transactionStore =
    options.transactionStore ??
    new TransactionStore({
      storageAdapter:
        options.transactionStorageAdapter ?? new FoundryJournalTransactionStorageAdapter()
    });
  const recovery = new RecoveryService({ transactionStore, lockManager });

  const resourceRegistry = options.resourceRegistry ?? createDefaultResourceRegistry();
  const ledgerStore =
    options.ledgerStore ??
    new LedgerStore({
      storageAdapter:
        options.ledgerStorageAdapter ?? new FoundryJournalLedgerStorageAdapter()
    });
  const reservationStore =
    options.reservationStore ??
    new ReservationStore({
      storageAdapter:
        options.reservationStorageAdapter ?? new FoundryJournalReservationStorageAdapter()
    });
  const customResourceStore =
    options.customResourceStore ??
    new CustomResourceDefinitionStore(
      options.customResourceStorageAdapter ?? new FoundryJournalCustomResourceStorageAdapter()
    );
  const providerRegistry =
    options.providerRegistry ?? createDefaultProviderRegistry(mutableDomainRepo);

  const thresholdService = options.thresholdService ?? new ThresholdService();

  const economyService = new EconomyService({
    domains: mutableDomainRepo,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    recoveryService: recovery,
    providerRegistry,
    thresholdService
  });

  // G4-AUD-005: Instantiate canonical DomainControllerProvider BEFORE registering economy commands
  const controllerProvider = options.controllerProvider ?? new DefaultDomainControllerProvider();

  const registry = new CommandRegistry();
  registerDomainCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerPopulationCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerNotableCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerRoleCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerOperationalGroupCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerAssignmentCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerRepairCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerEconomyCommands({
    registry,
    economyService,
    domains: mutableDomainRepo,
    controllerProvider
  });
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

  // Wire canonical DomainControllerPolicy for the runtime
  const unregisterPolicy = registerDomainControllerPolicy((domainId, userId, context) => {
    return controllerProvider.isDomainController(domainId, userId, context);
  });

  const people = new PeopleService(readOnlyDomains, { commandBus });
  const repairTool = new PeopleRepairTool(commandBus);

  // G4-AUD-004: Public Economy API facade prevents raw mutable store access
  const publicEconomy = new DefaultPublicEconomyApi({
    domains: readOnlyDomains,
    commandBus,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    providerRegistry,
    thresholdService
  });

  const publicApi: PublicModuleApi = Object.freeze({
    version: BUILD_METADATA.moduleVersion,
    domains: readOnlyDomains,
    economy: publicEconomy,
    people,
    diagnostics
  });

  return Object.freeze({
    publicApi,
    // G2-AUD-008 & G4-AUD-004: Read-only facades exposed publicly
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
    economy: publicEconomy,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    providerRegistry,
    customResourceStore,
    thresholds: thresholdService,
    initialize: async () => {
      await transactionStore.rehydrate();
      await ledgerStore.rehydrate();
      await reservationStore.rehydrate();
      const customDefs = await customResourceStore.rehydrate();
      for (const def of customDefs) {
        if (!resourceRegistry.get(def.id)) {
          resourceRegistry.register(def);
        }
      }
    },
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
export {
  ResourceDefinitionRegistry,
  createDefaultResourceRegistry
} from "../economy/definitions/resource-registry.js";
export { LedgerStore } from "../economy/ledger/ledger-store.js";
export { ReservationStore } from "../economy/reservations/reservation-store.js";
export { EconomyService } from "../economy/services/economy-service.js";
export {
  DefaultPublicEconomyApi,
  type PublicEconomyApi
} from "../economy/services/public-economy-api.js";
export {
  ProviderRegistry,
  createDefaultProviderRegistry
} from "../economy/providers/provider-registry.js";
export { EconomyApplication, EconomyApplicationController } from "../ui/domain-patterns/economy/economy-app.js";
