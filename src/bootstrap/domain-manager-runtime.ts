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
import { WorkforceReservationService } from "../people/services/workforce-reservation-service.js";
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
import { MANUAL_CURRENCY_PROVIDER_ID } from "../economy/providers/manual-currency-provider.js";
import { ThresholdService } from "../economy/thresholds/threshold-service.js";
import {
  FoundryJournalThresholdStorageAdapter,
  type ThresholdStorageAdapter
} from "../economy/storage/threshold-storage-adapter.js";
import { EconomyApplication, EconomyApplicationController } from "../ui/domain-patterns/economy/economy-app.js";
import {
  ProjectDefinitionRegistry,
  createDefaultProjectRegistry
} from "../projects/definitions/project-registry.js";
import { ProjectsService } from "../projects/services/projects-service.js";
import {
  DefaultPublicProjectsApi,
  type PublicProjectsApi
} from "../projects/api/public-projects-api.js";
import { registerProjectCommands } from "../projects/commands/project-commands.js";
import {
  FacilityDefinitionRegistry,
  createDefaultFacilityRegistry
} from "../facilities/definitions/facility-registry.js";
import { FacilitiesService } from "../facilities/services/facilities-service.js";
import {
  DefaultPublicFacilitiesApi,
  type PublicFacilitiesApi
} from "../facilities/api/public-facilities-api.js";
import { registerFacilityCommands } from "../facilities/commands/facility-commands.js";
import {
  DowntimeDefinitionRegistry,
  createDefaultDowntimeRegistry
} from "../downtime/definitions/downtime-registry.js";
import { DowntimeService } from "../downtime/services/downtime-service.js";
import {
  DefaultPublicDowntimeApi,
  type PublicDowntimeApi
} from "../downtime/api/public-downtime-api.js";
import { registerDowntimeCommands } from "../downtime/commands/downtime-commands.js";
import {
  type TransactionalChildHandlerRegistry,
  DefaultTransactionalChildHandlerRegistry
} from "../mutations/child-handler-contract.js";
import { DiplomacyEntityStore, FoundryDiplomacyStorageAdapter, type DiplomacyStorageAdapter } from "../diplomacy/diplomacy-store.js";
import { createPublicDiplomacyApi, type PublicDiplomacyApi } from "../diplomacy/public-diplomacy-api.js";
import { registerDiplomacyOverview } from "../diplomacy/diplomacy-overview.js";
import { registerOwnerCommands, DIPLOMACY_OWNERS } from "../diplomacy/owner-commands.js";
import { registerDiplomacyRecovery } from "../diplomacy/diplomacy-mutation.js";
import { registerDiplomacyCapabilityCommand } from "../diplomacy/capability-command.js";
import { registerDiplomacyProposals, validateDiplomacyProposal } from "../diplomacy/diplomacy-proposals.js";
import { validateTerritoryGraph } from "../territory/territory-hierarchy.js";
import { AgreementEffectOwnerRegistry } from "../agreements/agreement-owner-operations.js";
import { createEconomyAgreementEffectOwner } from "../agreements/economy-effect-owner.js";
import type { TerritoryState } from "../territory/territory-state.js";

/**
 * Public API exposed to external modules / users via module.api.
 *
 * Implements G4-AUD-004 & G5-AUD-001:
 * Strict isolation between internal stores/mutators and public query/dispatch facades.
 */
export interface PublicModuleApi {
  readonly diplomacy: PublicDiplomacyApi;
  readonly version: string;
  readonly domains: DomainReadRepository;
  readonly economy: PublicEconomyApi;
  readonly people: PublicPeopleApi;
  readonly projects: PublicProjectsApi;
  readonly facilities: PublicFacilitiesApi;
  readonly downtime: PublicDowntimeApi;
  readonly diagnostics: G2DiagnosticsProvider;
}

/**
 * Runtime services owned by the Domain Manager composition root.
 *
 * Implements Master Spec §11.1, §11.2, G2-AUD-001, G2-AUD-008, G4-AUD-004, G5-AUD-001:
 * - Public UI/services only see read operations and sanitized DTOs via read-only facades.
 * - State mutations must strictly be dispatched via `commandBus`.
 * - Complete Gate G2, G3, G4, and G5 verticals are composed and reachable from production entrypoint.
 */
export interface DomainManagerRuntime {
  readonly diplomacy: PublicDiplomacyApi;
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
  readonly projects: PublicProjectsApi;
  readonly facilities: PublicFacilitiesApi;
  readonly downtime: PublicDowntimeApi;
  readonly projectRegistry: ProjectDefinitionRegistry;
  readonly facilityRegistry: FacilityDefinitionRegistry;
  readonly downtimeRegistry: DowntimeDefinitionRegistry;
  readonly childHandlerRegistry: TransactionalChildHandlerRegistry;
  handleAuthorityTransition(): Promise<void>;
  initialize(): Promise<void>;
  destroy(): void;
}

export interface DomainManagerRuntimeOptions {
  readonly diplomacyStorageAdapter?: DiplomacyStorageAdapter;
  readonly worldTick?: () => number;
  readonly diplomacyConditionSatisfied?: (ref: import("../core/identity/refs.js").TypedRef) => boolean;
  readonly domainStore?: DomainDocumentStore;
  readonly authority?: PrimaryAuthorityHost;
  readonly transport?: CommandTransport;
  readonly lockManager?: LockManager;
  readonly transactionStore?: TransactionStore;
  readonly transactionStorageAdapter?: TransactionStorageAdapter;
  readonly transactionStoreAdapter?: TransactionStorageAdapter;
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
  readonly thresholdStorageAdapter?: ThresholdStorageAdapter;
  readonly projectRegistry?: ProjectDefinitionRegistry;
  readonly facilityRegistry?: FacilityDefinitionRegistry;
  readonly downtimeRegistry?: DowntimeDefinitionRegistry;
  readonly childHandlerRegistry?: TransactionalChildHandlerRegistry;
}

/**
 * Composes the complete Domain Manager runtime.
 */
export function composeDomainManagerRuntime(
  options: DomainManagerRuntimeOptions = {}
): DomainManagerRuntime {
  const domainStore = options.domainStore ?? new FoundryDomainDocumentStore();
  const mutableDomainRepo: DomainRepositoryContract = new DomainRepository(domainStore);

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

  const people = new PeopleService(readOnlyDomains);
  const workforceReservations = new WorkforceReservationService(mutableDomainRepo);

  const authority = options.authority ?? new FoundryPrimaryAuthorityAdapter();
  const lockManager = options.lockManager ?? new LockManager();
  const transactionStore =
    options.transactionStore ??
    new TransactionStore({
      storageAdapter:
        options.transactionStorageAdapter ??
        options.transactionStoreAdapter ??
        new FoundryJournalTransactionStorageAdapter()
    });
  const recovery = new RecoveryService({ transactionStore, lockManager });
  const coordinator = new MutationCoordinator({ lockManager, recoveryService: recovery, transactionStore });

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

  const thresholdService =
    options.thresholdService ??
    new ThresholdService(
      options.thresholdStorageAdapter ?? new FoundryJournalThresholdStorageAdapter()
    );

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
  const diplomacyStore = new DiplomacyEntityStore(options.diplomacyStorageAdapter ?? new FoundryDiplomacyStorageAdapter());
  const agreementEffectOwners = new AgreementEffectOwnerRegistry();
  agreementEffectOwners.register(createEconomyAgreementEffectOwner(economyService));
  agreementEffectOwners.freeze();
  const worldTick = options.worldTick ?? (() => Math.max(0, Math.floor((globalThis as any).game?.time?.worldTime ?? 0)));

  const projectRegistry = options.projectRegistry ?? createDefaultProjectRegistry();
  const facilityRegistry = options.facilityRegistry ?? createDefaultFacilityRegistry();
  const downtimeRegistry = options.downtimeRegistry ?? createDefaultDowntimeRegistry();

  const childHandlerRegistry =
    options.childHandlerRegistry ?? new DefaultTransactionalChildHandlerRegistry();

  const facilitiesService = new FacilitiesService({
    domains: mutableDomainRepo,
    facilityRegistry,
    economyService,
    transactionStore,
    recoveryService: recovery
  });
  const projectsService = new ProjectsService({
    domains: mutableDomainRepo,
    projectRegistry,
    economyService,
    facilitiesService,
    workforceReservations,
    transactionStore,
    recoveryService: recovery,
    childHandlerRegistry
  });
  const downtimeService = new DowntimeService({
    domains: mutableDomainRepo,
    downtimeRegistry,
    economyService,
    facilitiesService,
    transactionStore,
    recoveryService: recovery,
    childHandlerRegistry
  });

  let authorityTransitionLock = Promise.resolve();
  let authorityTransitionSequence = 0;
  const handleAuthorityTransition = async (): Promise<void> => {
    const currentSequence = ++authorityTransitionSequence;
    const previousLock = authorityTransitionLock;
    let releaseLock: () => void = () => {};
    authorityTransitionLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // 1. Immediately disable mutating commands synchronously
    commandBus.setMutationsEnabled(false);

    try {
      await previousLock;

      // Re-disable mutations when entering critical section
      commandBus.setMutationsEnabled(false);

      // 2. Await authority reconciliation
      let reconcileFailed = false;
      if (authority && typeof (authority as any).reconcile === "function") {
        try {
          await (authority as any).reconcile();
        } catch {
          reconcileFailed = true;
        }
      }

      if (reconcileFailed) {
        // Reconciliation failure leaves safe mode active
        commandBus.setMutationsEnabled(false);
        return;
      }

      // 3. If local host is elected Primary Authority, scan unresolved, install fences, and recover
      if (authority.service.isCurrentUser()) {
        const currentEpoch = authority.service.getStatus().authorityEpoch;
        try {
          await diplomacyStore.rehydrate();
          await recovery.scanOnStartup(currentEpoch);
          await recovery.recoverAll(currentEpoch);
          if (currentSequence === authorityTransitionSequence) {
            commandBus.setMutationsEnabled(true);
          }
        } catch {
          commandBus.setMutationsEnabled(false);
        }
      } else {
        if (currentSequence === authorityTransitionSequence) {
          commandBus.setMutationsEnabled(true);
        }
      }
    } finally {
      releaseLock();
    }

    if (currentSequence !== authorityTransitionSequence) {
      await authorityTransitionLock;
    }
  };

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
    controllerProvider,
    thresholdService,
    customResourceStore,
    resourceRegistry
  });
  registerProjectCommands({
    registry,
    projectsService,
    domains: mutableDomainRepo,
    controllerProvider,
    coordinator
  });
  registerFacilityCommands({
    registry,
    facilitiesService,
    domains: mutableDomainRepo,
    controllerProvider,
    coordinator
  });
  registerDowntimeCommands({
    registry,
    downtimeService,
    domains: mutableDomainRepo,
    controllerProvider,
    coordinator
  });

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
  const diplomacyOptions = { store: diplomacyStore, effectOwners: agreementEffectOwners, transactions: transactionStore, recovery, coordinator,
    conditionSatisfied: options.diplomacyConditionSatisfied,
    registry, domains: readOnlyDomains, controllers: controllerProvider, worldTick };
  registerOwnerCommands(diplomacyOptions);
  registerDiplomacyOverview(diplomacyOptions);
  registerDiplomacyRecovery(diplomacyOptions);
  registerDiplomacyCapabilityCommand(diplomacyOptions);
  registerDiplomacyProposals(diplomacyOptions);
  registry.freeze();
  const publicDiplomacy = createPublicDiplomacyApi(commandBus);

  const diagnostics = new G2DiagnosticsProvider({
    authorityService: authority.service,
    lockManager,
    commandQueue,
    transactionStore,
    registry,
    transport,
    rateLimiter
  });

  // Wire canonical DomainControllerPolicy for the runtime
  const unregisterPolicy = registerDomainControllerPolicy((domainId, userId, context) => {
    return controllerProvider.isDomainController(domainId, userId, context);
  });

  people.setCommandBus(commandBus);
  const repairTool = new PeopleRepairTool(commandBus);

  // G4-AUD-004: Public Economy API facade prevents raw mutable store access
  const publicEconomy = new DefaultPublicEconomyApi({
    domains: readOnlyDomains,
    commandBus,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    providerRegistry,
    thresholdService,
    transactionStore
  });

  // G5-AUD-001: Public Projects, Facilities, and Downtime API facades
  const publicProjects = new DefaultPublicProjectsApi({
    domains: readOnlyDomains,
    commandBus,
    projectRegistry,
    projectsService
  });

  const publicFacilities = new DefaultPublicFacilitiesApi({
    domains: readOnlyDomains,
    commandBus,
    facilityRegistry,
    facilitiesService
  });

  const publicDowntime = new DefaultPublicDowntimeApi({
    domains: readOnlyDomains,
    commandBus,
    downtimeRegistry,
    downtimeService
  });

  const publicApi: PublicModuleApi = Object.freeze({
    diplomacy: publicDiplomacy,
    version: BUILD_METADATA.moduleVersion,
    domains: readOnlyDomains,
    economy: publicEconomy,
    people,
    projects: publicProjects,
    facilities: publicFacilities,
    downtime: publicDowntime,
    diagnostics
  });

  return Object.freeze({
    diplomacy: publicDiplomacy,
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
    recoveryService: recovery,
    recoveryFenceRegistry: recovery.fenceRegistry,
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
    projects: publicProjects,
    facilities: publicFacilities,
    downtime: publicDowntime,
    projectRegistry,
    facilityRegistry,
    downtimeRegistry,
    childHandlerRegistry,
    handleAuthorityTransition,
    initialize: async () => {
      try {
        await diplomacyStore.rehydrate();
        const territories = diplomacyStore.list("territory").map(e => e.data as TerritoryState);
        const graph = validateTerritoryGraph(territories.map(t => t.territory)); if (!graph.ok) throw new Error(graph.error.code);
        for (const entity of diplomacyStore.list("proposal")) {
          const valid = validateDiplomacyProposal(entity.data);
          if (!valid.ok || valid.value.id !== entity.id || valid.value.revision !== entity.revision) throw new Error("DM_DIPLOMACY_STORAGE_CORRUPT");
        }
        for (const [kind, owner] of Object.entries(DIPLOMACY_OWNERS)) for (const entity of diplomacyStore.list(kind as any)) {
          const valid = owner.validate(entity.data, territories);
          if (!valid.ok || owner.identity(valid.value).id !== entity.id || owner.identity(valid.value).revision !== entity.revision)
            throw new Error("DM_DIPLOMACY_STORAGE_CORRUPT");
        }
        await transactionStore.rehydrate();
        await ledgerStore.rehydrate();
        await reservationStore.rehydrate();
        await thresholdService.rehydrate();
        const customDefs = await customResourceStore.rehydrate();
        for (const def of customDefs) {
          if (!resourceRegistry.get(def.id)) {
            resourceRegistry.register(def);
          }
        }
        const manualCurrency = providerRegistry.get(MANUAL_CURRENCY_PROVIDER_ID);
        if (manualCurrency && "rehydrate" in manualCurrency && typeof (manualCurrency as any).rehydrate === "function") {
          await (manualCurrency as any).rehydrate();
        }

        // Listen for authority failover during session and trigger recovery barrier (Blocker 4)
        if (authority && authority.service && typeof authority.service.onChanged === "function") {
          authority.service.onChanged(() => {
            void handleAuthorityTransition();
          });
        }
      } catch (initErr) {
        commandBus.setMutationsEnabled(false);
        throw initErr;
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

// G5 exports
export {
  ProjectsService,
  type StartProjectParams,
  type AdvanceProjectParams,
  type CompleteProjectParams
} from "../projects/services/projects-service.js";
export {
  DefaultPublicProjectsApi,
  type PublicProjectsApi
} from "../projects/api/public-projects-api.js";
export {
  ProjectDefinitionRegistry,
  createDefaultProjectRegistry
} from "../projects/definitions/project-registry.js";
export {
  ProjectsApplication,
  ProjectsApplicationController
} from "../ui/domain-patterns/projects/project-app.js";

export {
  FacilitiesService,
  type CreateFacilityParams,
  type MaintainFacilityParams,
  type RepairFacilityParams,
  type ApplyDamageParams
} from "../facilities/services/facilities-service.js";
export {
  DefaultPublicFacilitiesApi,
  type PublicFacilitiesApi
} from "../facilities/api/public-facilities-api.js";
export {
  FacilityDefinitionRegistry,
  createDefaultFacilityRegistry
} from "../facilities/definitions/facility-registry.js";
export {
  FacilitiesApplication,
  FacilitiesApplicationController
} from "../ui/domain-patterns/facilities/facility-app.js";

export {
  DowntimeService,
  type StartActivityParams,
  type AdvanceActivityParams,
  type CompleteActivityParams
} from "../downtime/services/downtime-service.js";
export {
  DefaultPublicDowntimeApi,
  type PublicDowntimeApi
} from "../downtime/api/public-downtime-api.js";
export {
  DowntimeDefinitionRegistry,
  createDefaultDowntimeRegistry
} from "../downtime/definitions/downtime-registry.js";
export {
  DowntimeApplication,
  DowntimeApplicationController
} from "../ui/domain-patterns/downtime/downtime-app.js";
