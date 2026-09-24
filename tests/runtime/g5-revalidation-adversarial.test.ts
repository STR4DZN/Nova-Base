import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type CommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { InMemoryTransactionStorageAdapter } from "../../src/mutations/transaction-storage-adapter.js";
import { createTransactionRecord } from "../../src/mutations/transaction-record.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import {
  DomainRepository,
  type DomainDocument,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import { normalizeJournalEntryId, normalizeDomainId } from "../../src/core/identity/refs.js";
import {
  resolveCurrentViewer,
  setCurrentUserProvider
} from "../../src/projection/viewer-identity.js";
import { createDefaultDomainProjectsData } from "../../src/projects/project-data.js";
import { createDefaultDomainFacilitiesData } from "../../src/facilities/facility-data.js";
import { createDefaultDomainDowntimeData } from "../../src/downtime/downtime-data.js";
import {
  createDefaultDomainEconomyData,
  tryGetDomainEconomyData,
  withDomainEconomyData
} from "../../src/economy/economy-data.js";
import { ProjectsService } from "../../src/projects/services/projects-service.js";
import { PeopleService } from "../../src/people/services/people-service.js";
import { registerProjectCommands } from "../../src/projects/commands/project-commands.js";
import { DefaultPublicProjectsApi } from "../../src/projects/api/public-projects-api.js";
import { FacilitiesService } from "../../src/facilities/services/facilities-service.js";
import { registerFacilityCommands } from "../../src/facilities/commands/facility-commands.js";
import { DefaultPublicFacilitiesApi } from "../../src/facilities/api/public-facilities-api.js";
import { DowntimeService } from "../../src/downtime/services/downtime-service.js";
import { registerDowntimeCommands } from "../../src/downtime/commands/downtime-commands.js";
import { DefaultPublicDowntimeApi } from "../../src/downtime/api/public-downtime-api.js";
import {
  ProjectDefinitionRegistry,
  createDefaultProjectRegistry
} from "../../src/projects/definitions/project-registry.js";
import { FacilityDefinitionRegistry } from "../../src/facilities/definitions/facility-registry.js";
import { DowntimeDefinitionRegistry } from "../../src/downtime/definitions/downtime-registry.js";
import { CANONICAL_DOWNTIME_DEFINITIONS } from "../../src/downtime/definitions/canonical-downtime-definitions.js";
import { EconomyService } from "../../src/economy/services/economy-service.js";
import { createDefaultResourceRegistry } from "../../src/economy/definitions/resource-registry.js";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";
import { InMemoryLedgerStorageAdapter } from "../../src/economy/storage/ledger-storage-adapter.js";
import { ReservationStore } from "../../src/economy/reservations/reservation-store.js";
import { InMemoryReservationStorageAdapter } from "../../src/economy/storage/reservation-storage-adapter.js";
import { RecoveryService } from "../../src/mutations/recovery-service.js";
import { createDefaultProviderRegistry } from "../../src/economy/providers/provider-registry.js";
import { ThresholdService } from "../../src/economy/thresholds/threshold-service.js";
import { InMemoryThresholdStorageAdapter } from "../../src/economy/storage/threshold-storage-adapter.js";
import { ProjectsApplicationController } from "../../src/ui/domain-patterns/projects/project-app.js";
import { FacilitiesApplicationController } from "../../src/ui/domain-patterns/facilities/facility-app.js";
import { DowntimeApplicationController } from "../../src/ui/domain-patterns/downtime/downtime-app.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { withDomainFacilitiesData, getDomainFacilitiesData } from "../../src/facilities/facility-data.js";
import { withDomainPeopleData, createDefaultDomainPeopleData, getDomainPeopleData } from "../../src/people/people-data.js";
import { calculateWorkforce } from "../../src/people/workforce/workforce-calculator.js";
import { withDomainProjectsData, getDomainProjectsData } from "../../src/projects/project-data.js";
import { withDomainDowntimeData, getDomainDowntimeData } from "../../src/downtime/downtime-data.js";
import { ok, err } from "../../src/core/contracts/result.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";

function checkOk(res: { ok: boolean; error?: any }, msg?: string) {
  if (!res.ok) {
    console.error("FAIL in " + (msg ?? "unnamed") + ":", JSON.stringify(res.error, null, 2));
  }
  assert.equal(res.ok, true, msg);
}

function createInitialRecord(): DomainRecord {
  return {
    schemaVersion: 1,
    revision: 1,
    definition: {
      identity: { aliases: [], summary: "Adversarial Test Domain", description: "Testing G5 revalidation invariants" },
      classification: { kind: "base", scale: "small", tags: ["adversarial"] },
      hierarchy: { parentDomainUuid: null },
      capabilities: {
        enabled: [
          "domain-manager:domain",
          "domain-manager:economy",
          "domain-manager:people",
          "domain-manager:projects",
          "domain-manager:facilities",
          "domain-manager:downtime"
        ],
        config: {
          "domain-manager:projects": createDefaultDomainProjectsData(),
          "domain-manager:facilities": createDefaultDomainFacilitiesData(),
          "domain-manager:downtime": createDefaultDomainDowntimeData(),
          "domain-manager:economy": {
            schemaVersion: 1,
            accounts: [
              {
                mode: "native",
                domainUuid: "JournalEntry.dom-adv-1",
                resourceId: "domain-manager:materials",
                balanceMinor: 0,
                baseCapacityMinor: null
              },
              {
                mode: "native",
                domainUuid: "JournalEntry.dom-adv-1",
                resourceId: "domain-manager:supplies",
                balanceMinor: 0,
                baseCapacityMinor: null
              }
            ]
          },
          "domain-manager:people": {
            ...createDefaultDomainPeopleData(),
            populationGroups: [
              {
                id: "pop_00000000-0000-0000-0000-000000000001",
                name: "Citizens",
                count: 100,
                includedInTotal: true,
                tags: [],
                workforceContributions: [
                  { workforceTypeId: "general", amount: 10 }
                ]
              }
            ]
          }
        }
      }
    },
    state: { lifecycle: "active" },
    metadata: { createdByUserId: "gm-user", archivedAt: null, source: { type: "manual", ref: null } }
  };
}

/**
 * Strict Foundry Domain Document Store mock (G5-REVAL-001, G5-REVAL-012).
 * Strictly mirrors Foundry's game.journal.get(id):
 * ONLY keyed by raw ID; rejects / returns undefined for 'JournalEntry.<id>' full UUID.
 */
function createStrictMockStore(docs: IdentifiedJournalEntryDocumentLike[]): DomainDocumentStore {
  const byId = new Map<string, IdentifiedJournalEntryDocumentLike>();
  for (const doc of docs) {
    byId.set(doc.id, doc);
  }

  return {
    get: (id: string) => {
      // In Foundry runtime, game.journal.get(id) accepts only raw ID. Full UUID lookup fails!
      if (id.startsWith("JournalEntry.")) {
        return undefined;
      }
      return byId.get(id);
    },
    list: () => Array.from(byId.values()),
    create: async () => {
      throw new Error("not implemented in test fixture");
    }
  };
}

function createMockDoc(
  id: string,
  name: string,
  record: DomainRecord,
  ownership: Record<string, number> = { default: 0, "gm-user": 3, "player-1": 1 }
): IdentifiedJournalEntryDocumentLike {
  let currentFlags = { "domain-manager": JSON.parse(JSON.stringify(record)) };
  let currentOwnership = { ...ownership };

  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return name; },
    get flags() { return currentFlags; },
    get ownership() { return currentOwnership; },
    update: async (data: Record<string, unknown>) => {
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": JSON.parse(JSON.stringify(payload)) };
      }
      if (data.ownership !== undefined) {
        currentOwnership = { ...(data.ownership as any) };
      }
    }
  };
}

function setupTestEnvironment(record: DomainRecord = createInitialRecord()) {
  const rawDoc = createMockDoc("dom-adv-1", "Adversarial Domain", record);
  const store = createStrictMockStore([rawDoc]);
  const domains = new DomainRepository(store);

  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });
  const transactionStore = new TransactionStore({ storageAdapter: new InMemoryTransactionStorageAdapter() });
  const recoveryService = new RecoveryService({ transactionStore, lockManager });

  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore({ storageAdapter: new InMemoryLedgerStorageAdapter() });
  const reservationStore = new ReservationStore({ storageAdapter: new InMemoryReservationStorageAdapter() });
  const providerRegistry = createDefaultProviderRegistry(domains);
  const thresholdService = new ThresholdService(new InMemoryThresholdStorageAdapter());

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    recoveryService,
    providerRegistry,
    thresholdService
  });

  const projectRegistry = createDefaultProjectRegistry();
  projectRegistry.register({
    id: "domain-manager:fortified-gate",
    version: 1,
    label: "Fortified Gate",
    tags: ["construction"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    requirements: [],
    costs: [
      { resourceId: "domain-manager:materials", amountMinor: 50, timing: "upfront" },
      { resourceId: "domain-manager:materials", amountMinor: 30, timing: "reserved" }
    ],
    rewards: []
  });

  const facilityRegistry = new FacilityDefinitionRegistry();
  facilityRegistry.register({
    id: "domain-manager:storehouse",
    version: 1,
    label: "Storehouse",
    category: "storage",
    tags: ["storage", "inventory"],
    scale: "building",
    maxLevel: 3,
    capabilitiesGranted: ["storage.expand"],
    defaultReadiness: "ready",
    maintenance: {
      intervalTicks: 20,
      costs: [{ resourceId: "domain-manager:materials", amount: 10 }]
    },
    repair: {
      directRepairAllowed: true,
      projectThresholdIntegrity: 25,
      resourceCosts: [{ resourceId: "domain-manager:materials", amount: 15 }]
    }
  });

  const downtimeRegistry = new DowntimeDefinitionRegistry();
  for (const def of CANONICAL_DOWNTIME_DEFINITIONS) {
    downtimeRegistry.register(def);
  }

  const facilitiesService = new FacilitiesService({
    domains,
    facilityRegistry,
    economyService,
    transactionStore,
    recoveryService
  });

  const peopleService = new PeopleService(domains);

  const projectsService = new ProjectsService({
    domains,
    projectRegistry,
    economyService,
    facilitiesService,
    peopleService,
    transactionStore,
    recoveryService
  });

  const downtimeService = new DowntimeService({
    domains,
    downtimeRegistry,
    economyService,
    facilitiesService,
    transactionStore,
    recoveryService
  });

  const registry = new CommandRegistry();
  registerProjectCommands({ registry, projectsService, domains, coordinator });
  registerFacilityCommands({ registry, facilitiesService, domains, coordinator });
  registerDowntimeCommands({ registry, downtimeService, domains, coordinator });

  const authorityService = new PrimaryAuthorityService(
    {
      getUsers: () => [
        { id: "gm-user", isGM: true, active: true },
        { id: "player-1", isGM: false, active: true },
        { id: "player-controller", isGM: false, active: true }
      ],
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-user"
    },
    { authorityUserId: "gm-user", authorityEpoch: 1, initialized: true }
  );

  (globalThis as any).game = {
    users: {
      get: (id: string) => (id === "gm-user" ? { id: "gm-user", isGM: true } : { id, isGM: false })
    }
  };

  const commandBus = new CommandBus({ registry, authorityService, coordinator });

  const publicProjects = new DefaultPublicProjectsApi({
    domains,
    commandBus,
    projectRegistry,
    projectsService
  });

  const publicFacilities = new DefaultPublicFacilitiesApi({
    domains,
    commandBus,
    facilityRegistry,
    facilitiesService
  });

  const publicDowntime = new DefaultPublicDowntimeApi({
    domains,
    commandBus,
    downtimeRegistry,
    downtimeService
  });

  return {
    rawDoc,
    store,
    domains,
    economyService,
    projectsService,
    facilitiesService,
    downtimeService,
    peopleService,
    recoveryService,
    publicProjects,
    publicFacilities,
    publicDowntime,
    transactionStore,
    coordinator,
    commandBus,
    projectRegistry,
    facilityRegistry,
    downtimeRegistry,
    lockManager,
    registry,
    authorityService
  };
}

// ---------------------------------------------------------------------------
// TEST 1: G5-REVAL-001 & G5-REVAL-012 — Strict Foundry Store Normalization
// ---------------------------------------------------------------------------
test("G5-REVAL-001 & G5-REVAL-012: Services normalize canonical JournalEntry.<id> against strict non-tolerant store", async () => {
  const env = setupTestEnvironment();
  const canonicalUuid = env.rawDoc.uuid; // "JournalEntry.dom-adv-1"
  const rawId = env.rawDoc.id; // "dom-adv-1"

  // 1. Verify strict store fails on full UUID
  assert.equal(env.store.get(canonicalUuid), undefined, "Raw Foundry store must reject 'JournalEntry.<id>' lookup");
  assert.ok(env.store.get(rawId), "Raw Foundry store succeeds with clean id");

  // 2. DomainRepository.read normalizes canonical UUID
  const repoRead = await env.domains.read(canonicalUuid);
  assert.equal(repoRead.ok, true, "DomainRepository must normalize JournalEntry.<id>");
  assert.equal(repoRead.value.id, rawId);

  // 3. ProjectsService normalizes domainUuid
  const prjRes = await env.projectsService.getProjects(canonicalUuid);
  assert.equal(prjRes.ok, true, "ProjectsService must normalize JournalEntry.<id>");

  // 4. FacilitiesService normalizes domainUuid
  const facRes = await env.facilitiesService.getFacilities(canonicalUuid);
  assert.equal(facRes.ok, true, "FacilitiesService must normalize JournalEntry.<id>");

  // 5. DowntimeService normalizes domainUuid
  const dtRes = await env.downtimeService.getActivities(canonicalUuid);
  assert.equal(dtRes.ok, true, "DowntimeService must normalize JournalEntry.<id>");

  // 6. Public APIs normalize domainUuid
  const vmPrj = await env.publicProjects.getProjects(canonicalUuid);
  assert.equal(vmPrj.ok, true, "PublicProjectsApi must normalize JournalEntry.<id>");

  const vmFac = await env.publicFacilities.getFacilities(canonicalUuid);
  assert.equal(vmFac.ok, true, "PublicFacilitiesApi must normalize JournalEntry.<id>");

  const vmDt = await env.publicDowntime.getActivities(canonicalUuid);
  assert.equal(vmDt.ok, true, "PublicDowntimeApi must normalize JournalEntry.<id>");

  // 7. Presenters and Application Controllers normalize domainUuid
  const prjApp = new ProjectsApplicationController({ domainUuid: canonicalUuid, domains: env.domains, commandBus: env.commandBus });
  const prjAppVm = await prjApp.loadViewModel();
  assert.equal(prjAppVm.ok, true, "ProjectsApplicationController must normalize JournalEntry.<id>");

  const facApp = new FacilitiesApplicationController({ domainUuid: canonicalUuid, domains: env.domains, commandBus: env.commandBus });
  const facAppVm = await facApp.loadViewModel();
  assert.equal(facAppVm.ok, true, "FacilitiesApplicationController must normalize JournalEntry.<id>");

  const dtApp = new DowntimeApplicationController({ domainUuid: canonicalUuid, domains: env.domains, commandBus: env.commandBus });
  const dtAppVm = await dtApp.loadViewModel();
  assert.equal(dtAppVm.ok, true, "DowntimeApplicationController must normalize JournalEntry.<id>");
});

// ---------------------------------------------------------------------------
// TEST 2: G5-REVAL-002 — Fail-Closed Viewer Spoof Protection
// ---------------------------------------------------------------------------
test("G5-REVAL-002: Viewer spoofing is overridden fail-closed; secret entities remain hidden from unauthorized callers", async () => {
  // Setup domain with a secret facility
  let record = createInitialRecord();
  record = withDomainFacilitiesData(record, {
    schemaVersion: 1,
    facilities: [
      {
        id: "fac-secret-vault",
        definitionId: "domain-manager:storehouse",
        domainUuid: "JournalEntry.dom-adv-1",
        name: "Shadow Vault",
        schemaVersion: 1,
        revision: 1,
        level: 1,
        lifecycle: "operational",
        readiness: "ready",
        installedModules: [],
        activeUpgrades: [],
        integrity: { current: 100, max: 100 },
        conditions: [],
        tags: ["secret"], // Secret tag!
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
  });

  const env = setupTestEnvironment(record);

  // Active session is a regular player (non-GM)
  setCurrentUserProvider(() => ({ id: "player-1", isGM: false }));

  try {
    // Adversarial caller attempts to claim viewer.isGm: true
    const spoofedViewer = { userId: "player-1", isGm: true };

    const resolved = resolveCurrentViewer(spoofedViewer);
    assert.equal(resolved.isGm, false, "Security: Non-GM session must never escalate to isGm: true");

    // Public Facilities API getFacilities check with spoofed viewer
    const facRes = await env.publicFacilities.getFacilities(env.rawDoc.uuid, spoofedViewer);
    assert.equal(facRes.ok, true);
    assert.equal(
      facRes.value.length,
      0,
      "Secret facility must be hidden from non-GM viewer even if caller claimed isGm: true"
    );

    // Application controller check
    const appController = new FacilitiesApplicationController({
      domainUuid: env.rawDoc.uuid,
      domains: env.domains,
      commandBus: env.commandBus,
      viewer: spoofedViewer
    });
    const appVM = await appController.loadViewModel();
    assert.equal(appVM.ok, true);
    assert.equal(appVM.value.viewerIsGm, false);
    assert.equal(appVM.value.facilities.length, 0);
  } finally {
    setCurrentUserProvider(null);
  }
});

// ---------------------------------------------------------------------------
// TEST 3: G5-REVAL-003 & G5-REVAL-011 — Project Financial & Workforce Lifecycle
// ---------------------------------------------------------------------------
test("G5-REVAL-003 & G5-REVAL-011: Project workforce insufficiency rejects start; upfront debits, reservations and cancellations execute", async () => {
  // Domain with workforce = 2 (insufficient for workforceRequired = 4)
  let record = createInitialRecord();
  record = withDomainPeopleData(record, {
    ...createDefaultDomainPeopleData(),
    populationGroups: [
      {
        id: "pop_00000000-0000-0000-0000-000000000002",
        name: "Small Crew",
        count: 10,
        includedInTotal: true,
        tags: [],
        workforceContributions: [{ workforceTypeId: "general", amount: 2 }] // Capacity = 2
      }
    ]
  });
  // Add 500 Materials to economy
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 500,
        baseCapacityMinor: null
      }
    ]
  });

  const env = setupTestEnvironment(record);

  // 1. Workforce check: required 4, available 2 -> conflict rejection
  const startInsufficientRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:fortified-gate",
    name: "Fortified Gate",
    workRequired: 100,
    workforceRequired: 4,
    userId: "gm-user"
  });
  assert.equal(startInsufficientRes.ok, false);
  assert.equal(startInsufficientRes.error.code, "DM_PROJECT_WORKFORCE_INSUFFICIENT");
  assert.equal(startInsufficientRes.error.category, "conflict");

  // 2. Increase workforce capacity to 10
  const updatedDoc = (await env.domains.read(env.rawDoc.id)).value;
  const updatedRecord = withDomainPeopleData(updatedDoc.record, {
    ...updatedDoc.record.definition.capabilities.config["domain-manager:people"],
    populationGroups: [
      {
        id: "pop_00000000-0000-0000-0000-000000000003",
        name: "Full Workforce",
        count: 50,
        includedInTotal: true,
        tags: [],
        workforceContributions: [{ workforceTypeId: "general", amount: 10 }]
      }
    ]
  });
  await env.domains.save({ ...updatedDoc, record: updatedRecord });

  // 3. Start project with upfront debit and reservation
  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:fortified-gate",
    name: "Fortified Gate",
    workRequired: 100,
    workforceRequired: 4,
    userId: "gm-user"
  });
  checkOk(startRes, "Test 3 startProject");
  const projectId = startRes.value.project.id;

  // Verify materials were debited (500 - 50 = 450)
  const afterStartDoc = (await env.domains.read(env.rawDoc.id)).value;
  const econAfterStart = afterStartDoc.record.definition.capabilities.config["domain-manager:economy"];
  const matAcc = econAfterStart.accounts.find((a: any) => a.resourceId === "domain-manager:materials");
  assert.equal(matAcc.balanceMinor, 450, "Upfront cost must be debited from economy account");

  // 4. Cancel project releases active reservations
  const cancelRes = await env.projectsService.cancelProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    reason: "Plan change",
    userId: "gm-user"
  });
  checkOk(cancelRes, "Test 3 cancelProject");
  assert.equal(cancelRes.value.project.lifecycle, "cancelled");
});

// ---------------------------------------------------------------------------
// TEST 4: G5-REVAL-004 — Transactional MutationCoordinator Enforcement
// ---------------------------------------------------------------------------
test("G5-REVAL-004: G5 commands execute with transactional coordinator locks; bus without coordinator fails closed", async () => {
  const env = setupTestEnvironment();

  // Create isolated registry and bus WITHOUT coordinator
  const bareRegistry = new CommandRegistry();
  registerProjectCommands({
    registry: bareRegistry,
    projectsService: env.projectsService,
    domains: env.domains
    // coordinator omitted!
  });

  const bareAuthority = new PrimaryAuthorityService(
    { getUsers: () => [{ id: "gm-user", isGM: true, active: true }], getPreferredUserId: () => null, getCurrentUserId: () => "gm-user" },
    { authorityUserId: "gm-user", authorityEpoch: 1, initialized: true }
  );

  const bareBus = new CommandBus({ registry: bareRegistry, authorityService: bareAuthority }); // coordinator omitted

  const cmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:start-project",
    payload: {
      domainUuid: env.rawDoc.uuid,
      definitionId: "domain-manager:basic-construction",
      name: "Uncoordinated Project",
      workRequired: 50
    },
    issuedAtReal: Date.now()
  };

  const receiptRes = await bareBus.execute(cmd);
  assert.equal(receiptRes.ok, true);
  assert.equal(receiptRes.value.status, "rejected");
  assert.equal(receiptRes.value.error?.code, "DM_TRANSACTIONAL_COORDINATOR_REQUIRED");
});

// ---------------------------------------------------------------------------
// TEST 5: G5-REVAL-005 — Real Project Completion Side Effects & Child Receipts
// ---------------------------------------------------------------------------
test("G5-REVAL-005: Project completion creates real facility and real economy rewards producing ChildReceipts", async () => {
  const env = setupTestEnvironment();

  // Custom project definition with facility creation and resource reward side effects
  env.projectRegistry.register({
    id: "domain-manager:build-storehouse",
    version: 1,
    label: "Construct Community Storehouse",
    tags: ["construction"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 50,
    requirements: [],
    costs: [],
    rewards: [
      {
        type: "facility",
        targetRef: "domain-manager:storehouse",
        label: "Main Community Storehouse"
      },
      {
        type: "resource",
        targetRef: "domain-manager:supplies",
        value: 250,
        label: "Supplies Reward"
      }
    ]
  });

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:build-storehouse",
    name: "Main Community Storehouse",
    workRequired: 50,
    userId: "gm-user"
  });
  checkOk(startRes, "Test 5 startProject");
  const projectId = startRes.value.project.id;

  // Advance project to 100% completion (50 units)
  const advanceRes = await env.projectsService.advanceProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    delta: 50,
    userId: "gm-user"
  });
  checkOk(advanceRes, "Test 5 advanceProject");

  // Complete project
  const completeRes = await env.projectsService.completeProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    commandId: "cmd_comp_test_001" as CommandId,
    authorityEpoch: 2,
    userId: "gm-user"
  });
  checkOk(completeRes, "Test 5 completeProject");
  assert.equal(completeRes.value.project.lifecycle, "completed");

  // Verify child receipts exist
  const childReceipts = completeRes.value.childReceipts;
  assert.ok(childReceipts, "Child receipts must be present");
  assert.equal(childReceipts.length, 2, "Both side effects must produce ChildReceipts");

  const facReceipt = childReceipts.find((c) => c.action === "create_facility");
  assert.ok(facReceipt);
  assert.equal(facReceipt.success, true);

  const econReceipt = childReceipts.find((c) => c.action === "credit_resource");
  assert.ok(econReceipt);
  assert.equal(econReceipt.success, true);

  // Verify REAL facility actually exists in domain facilities data
  const facilitiesRes = await env.facilitiesService.getFacilities(env.rawDoc.uuid);
  assert.equal(facilitiesRes.ok, true);
  const createdFacility = facilitiesRes.value.find((f) => f.name === "Main Community Storehouse");
  assert.ok(createdFacility, "Real facility must exist in domain facilities data");
  assert.equal(createdFacility.definitionId, "domain-manager:storehouse");
  assert.equal(createdFacility.lifecycle, "operational");

  // Verify REAL supplies were credited in domain economy data
  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const econData = doc.record.definition.capabilities.config["domain-manager:economy"];
  const supAcc = econData.accounts.find((a: any) => a.resourceId === "domain-manager:supplies");
  assert.ok(supAcc, "Supplies account must exist");
  assert.equal(supAcc.balanceMinor, 250, "Real supplies must be credited by side effect");
});

// ---------------------------------------------------------------------------
// TEST 6: G5-REVAL-006 — Partial Failure Transitions Transaction to needs-recovery
// ---------------------------------------------------------------------------
test("G5-REVAL-006: Side effect failure records partialFailure and transitions transaction to needs-recovery", async () => {
  const env = setupTestEnvironment();

  // Custom project definition with invalid facility definition causing side effect failure
  env.projectRegistry.register({
    id: "domain-manager:build-failing-project",
    version: 1,
    label: "Construct Nonexistent Facility",
    tags: ["construction"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 20,
    requirements: [],
    costs: [],
    rewards: [
      {
        type: "facility",
        targetRef: "domain-manager:nonexistent-facility",
        label: "Ghost Structure"
      }
    ]
  });

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:build-failing-project",
    name: "Ghost Project",
    workRequired: 20,
    userId: "gm-user"
  });
  checkOk(startRes, "Test 6 startProject");
  const projectId = startRes.value.project.id;

  // Advance to completion
  const advanceRes = await env.projectsService.advanceProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    delta: 20,
    userId: "gm-user"
  });
  checkOk(advanceRes, "Test 6 advanceProject");

  const testCommandId = "cmd_partial_fail_001" as CommandId;

  const completeRes = await env.projectsService.completeProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    commandId: testCommandId,
    authorityEpoch: 3,
    userId: "gm-user"
  });
  checkOk(completeRes, "Test 6 completeProject");
  const failedReceipt = completeRes.value.childReceipts.find((c) => c.action === "create_facility");
  assert.ok(failedReceipt);
  assert.equal(failedReceipt.success, false, "Facility creation must fail");

  // Verify transaction in TransactionStore is marked 'needs-recovery'
  const tx = env.transactionStore.getByCommandId(testCommandId);
  assert.ok(tx, "Transaction record must exist in TransactionStore");
  assert.equal(tx.state, "needs-recovery", "Transaction must transition to needs-recovery upon partial failure");
  assert.equal(tx.authorityEpoch, 3, "Transaction must preserve the exact authorityEpoch");
});

// ---------------------------------------------------------------------------
// TEST 7: G5-REVAL-007 & G5-REVAL-008 — Downtime Invariants & Real Outcome Execution
// ---------------------------------------------------------------------------
test("G5-REVAL-007 & G5-REVAL-008: Downtime enforces participant invariants and executes real outcomes upon completion", async () => {
  // Give domain 50 Materials
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 50,
        baseCapacityMinor: null
      },
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:supplies",
        balanceMinor: 0,
        baseCapacityMinor: null
      }
    ]
  });

  const env = setupTestEnvironment(record);

  // 1. Min participants invariant (patrol-and-recon requires min 2)
  const dtInsufficientRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:patrol-and-recon",
    label: "Solo Patrol",
    participants: [{ participantRef: "notable:scout-1", participantType: "notable", role: "supervisor" }],
    userId: "gm-user"
  });
  assert.equal(dtInsufficientRes.ok, false);
  assert.equal(dtInsufficientRes.error.code, "DM_DOWNTIME_PARTICIPANT_REQUIRED");

  // 2. Role invariant (role must be in allowedParticipantRoles: ["supervisor", "participant"])
  const dtBadRoleRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:patrol-and-recon",
    label: "Bad Role Patrol",
    participants: [
      { participantRef: "notable:scout-1", participantType: "notable", role: "wizard" },
      { participantRef: "notable:scout-2", participantType: "notable", role: "participant" }
    ],
    userId: "gm-user"
  });
  assert.equal(dtBadRoleRes.ok, false);
  assert.equal(dtBadRoleRes.error.code, "DM_DOWNTIME_INVALID_PARTICIPANT_ROLE");

  // 3. Required facility invariant
  env.downtimeRegistry.register({
    id: "domain-manager:forge-crafting",
    version: 1,
    label: "Forge Crafting",
    description: "Crafting in a specialized forge facility",
    category: "production",
    scope: "individual",
    defaultDurationTicks: 10,
    minParticipants: 1,
    maxParticipants: 2,
    allowedParticipantRoles: ["owner"],
    requiredFacilityDefinitions: ["domain-manager:storehouse"],
    outcomeDefinitions: []
  });

  // Without storehouse -> fails DM_DOWNTIME_REQUIRED_FACILITY_MISSING
  const dtNoFacRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:forge-crafting",
    label: "Forge Work",
    participants: [{ participantRef: "notable:blacksmith-1", participantType: "notable", role: "owner" }],
    userId: "gm-user"
  });
  assert.equal(dtNoFacRes.ok, false);
  assert.equal(dtNoFacRes.error.code, "DM_DOWNTIME_REQUIRED_FACILITY_MISSING");

  // 4. Crafting activity (requires 10 materials, grants 15 supplies on completion)
  const craftRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:crafting",
    label: "Smithing Iron Tools",
    durationTicks: 10,
    participants: [
      { participantRef: "notable:blacksmith-1", participantType: "notable", role: "owner" }
    ],
    userId: "gm-user"
  });
  checkOk(craftRes, "Test 7 craftRes");
  const activityId = craftRes.value.activity.id;

  // Verify upfront materials cost was debited (50 - 10 = 40)
  const afterStartDoc = (await env.domains.read(env.rawDoc.id)).value;
  const matAcc = afterStartDoc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 40, "Downtime upfront cost must be debited from economy");

  // 5. Complete crafting activity -> executes outcome definition (grants 15 supplies)
  const completeCraftRes = await env.downtimeService.completeActivity({
    domainUuid: env.rawDoc.uuid,
    activityId,
    userId: "gm-user"
  });
  checkOk(completeCraftRes, "Test 7 completeCraftRes");
  assert.equal(completeCraftRes.value.activity.lifecycle, "completed");
  assert.ok(completeCraftRes.value.outcomesApplied.length > 0, "Outcomes must be applied");

  // Verify supplies were credited
  const afterCompDoc = (await env.domains.read(env.rawDoc.id)).value;
  const supAcc = afterCompDoc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:supplies"
  );
  assert.ok(supAcc);
  assert.equal(supAcc.balanceMinor, 15, "Crafting completion must grant 15 supplies to economy");
});

// ---------------------------------------------------------------------------
// TEST 8: G5-REVAL-009 & G5-REVAL-010 — Facility Maintenance Costs & Canonical Damage
// ---------------------------------------------------------------------------
test("G5-REVAL-009 & G5-REVAL-010: Facility maintenance debits resources; damage preserves append-only history", async () => {
  // Give domain 100 Materials
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 100,
        baseCapacityMinor: null
      }
    ]
  });

  const env = setupTestEnvironment(record);

  // 1. Create storehouse facility (maintenance cost = 10 materials)
  const createFacRes = await env.facilitiesService.createFacility({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:storehouse",
    name: "Main Granary",
    level: 1,
    initialLifecycle: "operational"
  });
  checkOk(createFacRes, "Test 8 createFacRes");
  const facilityId = createFacRes.value.facility.id;

  // 2. Maintain facility -> debits 10 materials (100 - 10 = 90)
  const maintRes = await env.facilitiesService.maintainFacility({
    domainUuid: env.rawDoc.uuid,
    facilityId,
    notes: "Spring service",
    userId: "gm-user"
  });
  checkOk(maintRes, "Test 8 maintRes");

  const docAfterMaint = (await env.domains.read(env.rawDoc.id)).value;
  const matAcc = docAfterMaint.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 90, "Maintenance must debit 10 materials from economy");

  // 3. Apply canonical damage
  const dmgRes = await env.facilitiesService.applyDamage({
    domainUuid: env.rawDoc.uuid,
    facilityId,
    damage: 30,
    reason: "Storm damage",
    userId: "gm-user"
  });
  checkOk(dmgRes, "Test 8 dmgRes");
  assert.equal(dmgRes.value.facility.integrity?.current, 70); // 100 - 30

  // Verify append-only history was preserved
  const damagedFacility = dmgRes.value.facility;
  assert.ok(damagedFacility.history && damagedFacility.history.length > 0, "Facility history must be populated");
  const dmgHistory = damagedFacility.history.find((h) => h.entryType === "damaged");
  assert.ok(dmgHistory, "Must record 'damaged' entry in append-only history");
});

// ---------------------------------------------------------------------------
// TEST 9: G5-REVAL-011 — Authority Epoch and CommandId Preservation
// ---------------------------------------------------------------------------
test("G5-REVAL-011: Transaction records preserve real commandId and authorityEpoch !== 1 without fabricating identifiers", async () => {
  const env = setupTestEnvironment();

  env.projectRegistry.register({
    id: "domain-manager:simple-task",
    version: 1,
    label: "Simple Task",
    tags: ["infrastructure"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 10,
    requirements: [],
    costs: [],
    rewards: []
  });

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:simple-task",
    name: "Quick Watchtower",
    workRequired: 10,
    userId: "gm-user"
  });
  checkOk(startRes, "Test 9 startRes");
  const projectId = startRes.value.project.id;

  // Advance to completion
  const advRes = await env.projectsService.advanceProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    delta: 10,
    userId: "gm-user"
  });
  checkOk(advRes, "Test 9 advRes");

  const customCommandId = "cmd_authoritative_epoch_99" as CommandId;
  const customEpoch = 42;

  const compRes = await env.projectsService.completeProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    commandId: customCommandId,
    authorityEpoch: customEpoch,
    userId: "gm-user"
  });
  checkOk(compRes, "Test 9 compRes");

  const tx = env.transactionStore.getByCommandId(customCommandId);
  assert.ok(tx, "Transaction record must be registered under customCommandId");
  assert.equal(tx.commandId, customCommandId, "commandId must not be fabricated or overwritten");
  assert.equal(tx.authorityEpoch, 42, "authorityEpoch must be preserved as 42, not hardcoded to 1");
});

// ---------------------------------------------------------------------------
// TEST 10: G5-REVAL2-001 — Nested Lock / Reentrancy through CommandBus
// ---------------------------------------------------------------------------
test("G5-REVAL2-001: Nested lock between MutationCoordinator and EconomyService reentrantly succeeds through CommandBus", async () => {
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 200,
        baseCapacityMinor: null
      }
    ]
  });

  const env = setupTestEnvironment(record);

  // CommandBus executes 'projects:start-project' which acquires domain lock via MutationCoordinator
  // ProjectsService.startProject commits upfront debit and reservation in EconomyService with lockOwner: commandId
  // Shared lockManager must permit reentrancy without timeout or deadlock
  const cmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:start-project",
    payload: {
      domainUuid: env.rawDoc.uuid,
      definitionId: "domain-manager:fortified-gate", // 50 upfront, 30 reserved
      name: "Non-Deadlocking Gate",
      workRequired: 100
    },
    issuedAtReal: Date.now()
  };

  const receiptRes = await env.commandBus.execute(cmd);
  assert.equal(receiptRes.ok, true);
  assert.equal(receiptRes.value.status, "executed", "Command must succeed without lock timeout or deadlock");

  // Verify economy state: 200 - 50 upfront = 150 balance; 30 reserved
  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 150, "Upfront cost must be debited");

  const reservations = env.economyService.listReservations({ domainUuid: env.rawDoc.uuid, status: "active" });
  assert.equal(reservations.length, 1, "Reservation must be registered in ReservationStore");
  assert.equal(reservations[0].remainingAmountMinor, 30);
});

// ---------------------------------------------------------------------------
// TEST 11: G5-REVAL2-002 — Reservation cancellation release via CommandBus
// ---------------------------------------------------------------------------
test("G5-REVAL2-002: Project cancellation releases reservations in ReservationStore via CommandBus", async () => {
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 200,
        baseCapacityMinor: null
      }
    ]
  });

  const env = setupTestEnvironment(record);

  const startCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:start-project",
    payload: {
      domainUuid: env.rawDoc.uuid,
      definitionId: "domain-manager:fortified-gate",
      name: "Gate to Cancel",
      workRequired: 100
    },
    issuedAtReal: Date.now()
  };

  const startRes = await env.commandBus.execute(startCmd);
  assert.equal(startRes.ok, true);
  assert.equal(startRes.value.status, "executed");
  const projectId = (startRes.value.result as any).project.id;

  const activeResBefore = env.economyService.listReservations({ domainUuid: env.rawDoc.uuid, sourceRef: projectId, status: "active" });
  assert.equal(activeResBefore.length, 1);
  const reservationId = activeResBefore[0].id;

  // Cancel via CommandBus
  const cancelCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:cancel-project",
    payload: {
      domainUuid: env.rawDoc.uuid,
      projectId,
      reason: "Strategic pivot"
    },
    issuedAtReal: Date.now()
  };

  const cancelRes = await env.commandBus.execute(cancelCmd);
  assert.equal(cancelRes.ok, true);
  assert.equal(cancelRes.value.status, "executed");

  // Reservation must now be released in ReservationStore
  const resAfter = env.economyService.getReservation(reservationId);
  assert.ok(resAfter);
  assert.equal(resAfter.status, "released", "Reservation must be released in ReservationStore upon cancellation");
});

// ---------------------------------------------------------------------------
// TEST 12: G5-REVAL2-003 & G5-REVAL2-004 — Cumulative progressive cost exactness & fail-closed debit
// ---------------------------------------------------------------------------
test("G5-REVAL2-003 & G5-REVAL2-004: Cumulative progressive cost tracking debits exact fractions without loss; fails closed on insufficient balance", async () => {
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 10, // Exact 10 materials
        baseCapacityMinor: null
      }
    ]
  });

  const env = setupTestEnvironment(record);

  env.projectRegistry.register({
    id: "domain-manager:irrigation-canal",
    version: 1,
    label: "Irrigation Canal",
    tags: ["agriculture"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    requirements: [],
    costs: [
      { resourceId: "domain-manager:materials", amountMinor: 10, timing: "progressive" }
    ],
    rewards: []
  });

  const startCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:start-project",
    payload: {
      domainUuid: env.rawDoc.uuid,
      definitionId: "domain-manager:irrigation-canal",
      name: "Canal Alpha",
      workRequired: 100
    },
    issuedAtReal: Date.now()
  };

  const startRes = await env.commandBus.execute(startCmd);
  assert.equal(startRes.ok, true);
  const projectId = (startRes.value.result as any).project.id;

  // Step 1: Advance by 33 units (floor(33/100 * 10) - 0 = 3)
  const adv1Cmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: env.rawDoc.uuid, projectId, delta: 33 },
    issuedAtReal: Date.now()
  };
  const adv1Res = await env.commandBus.execute(adv1Cmd);
  assert.equal(adv1Res.ok, true);
  assert.equal(adv1Res.value.status, "executed");

  let doc = (await env.domains.read(env.rawDoc.id)).value;
  let matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 7, "Step 1: 10 - 3 = 7");

  // Step 2: Advance by 33 units (floor(66/100 * 10) - 3 = 6 - 3 = 3)
  const adv2Cmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: env.rawDoc.uuid, projectId, delta: 33 },
    issuedAtReal: Date.now()
  };
  const adv2Res = await env.commandBus.execute(adv2Cmd);
  assert.equal(adv2Res.ok, true);
  assert.equal(adv2Res.value.status, "executed");

  doc = (await env.domains.read(env.rawDoc.id)).value;
  matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 4, "Step 2: 7 - 3 = 4");

  // Step 3: Advance by 34 units (floor(100/100 * 10) - 6 = 10 - 6 = 4)
  const adv3Cmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: env.rawDoc.uuid, projectId, delta: 34 },
    issuedAtReal: Date.now()
  };
  const adv3Res = await env.commandBus.execute(adv3Cmd);
  assert.equal(adv3Res.ok, true);
  assert.equal(adv3Res.value.status, "executed");

  doc = (await env.domains.read(env.rawDoc.id)).value;
  matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 0, "Step 3: 4 - 4 = 0 (Total 10 debited with zero fraction loss)");

  // Step 4: Now test fail-closed: start second canal with 0 balance and try to advance
  const start2Cmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:start-project",
    payload: {
      domainUuid: env.rawDoc.uuid,
      definitionId: "domain-manager:irrigation-canal",
      name: "Canal Beta",
      workRequired: 100
    },
    issuedAtReal: Date.now()
  };
  const start2Res = await env.commandBus.execute(start2Cmd);
  assert.equal(start2Res.ok, true);
  const project2Id = (start2Res.value.result as any).project.id;

  const advFailCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: env.rawDoc.uuid, projectId: project2Id, delta: 50 },
    issuedAtReal: Date.now()
  };
  const advFailRes = await env.commandBus.execute(advFailCmd);
  assert.equal(advFailRes.ok, true);
  assert.equal(advFailRes.value.status, "rejected", "Advance with insufficient progressive funds must fail closed");
  assert.equal(advFailRes.value.error?.code, "DM_PROJECT_ADVANCE_BLOCKED");
});

// ---------------------------------------------------------------------------
// TEST 13: G5-REVAL2-005 & G5-REVAL2-006 — Provenance propagation and partial failure recovery
// ---------------------------------------------------------------------------
test("G5-REVAL2-005 & G5-REVAL2-006: TransactionRecord receives authorityEpoch !== 1 from CommandBus and transitions to needs-recovery on partial failure", async () => {
  const env = setupTestEnvironment();

  const customAuthority = new PrimaryAuthorityService(
    { getUsers: () => [{ id: "gm-user", isGM: true, active: true }], getPreferredUserId: () => null, getCurrentUserId: () => "gm-user" },
    { authorityUserId: "gm-user", authorityEpoch: 77, initialized: true }
  );

  const customBus = new CommandBus({
    registry: env.registry,
    authorityService: customAuthority,
    coordinator: env.coordinator
  });

  // Register project with an unhandled reward type to trigger partial failure
  env.projectRegistry.register({
    id: "domain-manager:failing-reward-project",
    version: 1,
    label: "Project with Unhandled Reward",
    tags: ["infrastructure"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 10,
    requirements: [],
    costs: [],
    rewards: [
      {
        type: "unknown_side_effect_subsystem",
        targetRef: "none",
        value: 100
      }
    ]
  });

  const startCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:start-project",
    payload: {
      domainUuid: env.rawDoc.uuid,
      definitionId: "domain-manager:failing-reward-project",
      name: "Failure Injection Project",
      workRequired: 10
    },
    issuedAtReal: Date.now()
  };

  const startRes = await customBus.execute(startCmd);
  assert.equal(startRes.ok, true);
  const projectId = (startRes.value.result as any).project.id;

  // Advance to completion
  const advCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: env.rawDoc.uuid, projectId, delta: 10 },
    issuedAtReal: Date.now()
  };
  await customBus.execute(advCmd);

  // Complete via CommandBus with authorityEpoch 77
  const completeCmdId = createCommandId();
  const compCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: completeCmdId,
    type: "projects:complete-project",
    payload: { domainUuid: env.rawDoc.uuid, projectId },
    issuedAtReal: Date.now()
  };

  const compRes = await customBus.execute(compCmd);
  assert.equal(compRes.ok, true);
  assert.equal(compRes.value.status, "executed");

  // Verify TransactionRecord provenance and transition to needs-recovery
  const tx = env.transactionStore.getByCommandId(completeCmdId);
  assert.ok(tx, "TransactionRecord must be saved for complete-project");
  assert.equal(tx.authorityEpoch, 77, "authorityEpoch 77 must be propagated from CommandBus to TransactionRecord");
  assert.equal(tx.state, "needs-recovery", "TransactionRecord must transition to needs-recovery on partial failure");
});

// ---------------------------------------------------------------------------
// TEST 14: G5-REVAL2-007 & G5-REVAL2-008 — Downtime validation invariants & non-economy outcome fail closed
// ---------------------------------------------------------------------------
test("G5-REVAL2-007 & G5-REVAL2-008: Downtime validates disabled capability, missing facility, busy participant, and non-economy outcome fails closed", async () => {
  const env = setupTestEnvironment();

  // 1. Missing capability invariant
  env.downtimeRegistry.register({
    id: "domain-manager:astral-divination",
    version: 1,
    label: "Astral Divination",
    category: "arcane",
    scope: "domain",
    defaultDurationTicks: 10,
    minParticipants: 1,
    requiredCapabilities: ["domain-manager:forbidden-arcana"], // Not enabled on domain
    outcomeDefinitions: []
  });

  const capRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:astral-divination",
    label: "Star Watching",
    participants: [{ participantRef: "notable:scout-1", participantType: "notable", role: "participant" }],
    userId: "gm-user"
  });
  assert.equal(capRes.ok, false);
  assert.equal(capRes.error.code, "DM_DOWNTIME_REQUIRED_CAPABILITY_DISABLED");

  // 2. Participant busy check
  const dt1Res = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:patrol-and-recon",
    label: "First Patrol",
    participants: [
      { participantRef: "notable:scout-1", participantType: "notable", role: "supervisor" },
      { participantRef: "notable:scout-2", participantType: "notable", role: "participant" }
    ],
    userId: "gm-user"
  });
  checkOk(dt1Res, "First Patrol Start");

  // Attempt to assign scout-1 to a concurrent activity while First Patrol is inProgress
  const busyRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:patrol-and-recon",
    label: "Second Patrol with Same Scout",
    participants: [
      { participantRef: "notable:scout-1", participantType: "notable", role: "supervisor" },
      { participantRef: "notable:scout-3", participantType: "notable", role: "participant" }
    ],
    userId: "gm-user"
  });
  assert.equal(busyRes.ok, false);
  assert.equal(busyRes.error.code, "DM_DOWNTIME_PARTICIPANT_BUSY");

  // 3. Non-economy outcome fails closed when no handler is registered
  env.downtimeRegistry.register({
    id: "domain-manager:sacred-ritual",
    version: 1,
    label: "Sacred Ritual",
    category: "religious",
    scope: "domain",
    defaultDurationTicks: 10,
    minParticipants: 1,
    outcomeDefinitions: [
      {
        id: "out-blessing",
        type: "unknown_custom_buff",
        targetRef: "faith:holy",
        value: 10,
        optional: true
      }
    ]
  });

  const ritualStartRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:sacred-ritual",
    label: "Midsummer Ritual",
    participants: [{ participantRef: "notable:priest-1", participantType: "notable", role: "participant" }],
    userId: "gm-user"
  });
  checkOk(ritualStartRes, "Ritual Start");

  const ritualCompleteRes = await env.downtimeService.completeActivity({
    domainUuid: env.rawDoc.uuid,
    activityId: ritualStartRes.value.activityId,
    userId: "gm-user"
  });
  checkOk(ritualCompleteRes, "Ritual Complete");
  assert.equal(ritualCompleteRes.value.outcomesApplied.length, 1);
  assert.equal(ritualCompleteRes.value.outcomesApplied[0].success, false, "Unhandled outcome must fail closed");

  // 4. Operational facility readiness check: register facility with non-ready status
  env.downtimeRegistry.register({
    id: "domain-manager:forge-crafting-2",
    version: 1,
    label: "Forge Crafting 2",
    category: "production",
    scope: "individual",
    defaultDurationTicks: 10,
    minParticipants: 1,
    requiredFacilityDefinitions: ["domain-manager:storehouse"],
    outcomeDefinitions: []
  });

  // Create facility with readiness unavailable
  await env.facilitiesService.createFacility({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:storehouse",
    name: "Damaged Granary",
    level: 1,
    initialLifecycle: "operational",
    initialReadiness: "unavailable"
  });

  const dtDamagedFacRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:forge-crafting-2",
    label: "Unavailable Facility Work",
    participants: [{ participantRef: "notable:scout-1", participantType: "notable", role: "participant" }],
    userId: "gm-user"
  });
  assert.equal(dtDamagedFacRes.ok, false);
  assert.equal(dtDamagedFacRes.error.code, "DM_DOWNTIME_REQUIRED_FACILITY_MISSING");
});

// ---------------------------------------------------------------------------
// TEST 15: G5-REVAL2-009 — Workforce reservation in DomainPeopleData
// ---------------------------------------------------------------------------
test("G5-REVAL2-009: Workforce reservation in DomainPeopleData is allocated on project start and released on cancel/complete", async () => {
  let record = createInitialRecord();
  record = withDomainPeopleData(record, {
    ...createDefaultDomainPeopleData(),
    populationGroups: [
      {
        id: "pop_00000000-0000-0000-0000-000000000005",
        name: "Builders Guild",
        count: 20,
        includedInTotal: true,
        tags: [],
        workforceContributions: [{ workforceTypeId: "general", amount: 10 }]
      }
    ]
  });

  const env = setupTestEnvironment(record);

  // Check initial workforce capacity
  let peopleDoc = (await env.domains.read(env.rawDoc.id)).value;
  let initialWf = calculateWorkforce(getDomainPeopleData(peopleDoc.record));
  assert.equal(initialWf.types.general.available, 10, "Initial available workforce should be 10");

  env.projectRegistry.register({
    id: "domain-manager:bridge-project",
    version: 1,
    label: "Stone Bridge",
    tags: ["infrastructure"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 50,
    requirements: [],
    costs: [],
    rewards: []
  });

  // Start project with workforceRequired = 4
  const startCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:start-project",
    payload: {
      domainUuid: env.rawDoc.uuid,
      definitionId: "domain-manager:bridge-project",
      name: "River Bridge",
      workRequired: 50,
      workforceRequired: 4
    },
    issuedAtReal: Date.now()
  };

  const startRes = await env.commandBus.execute(startCmd);
  assert.equal(startRes.ok, true);
  assert.equal(startRes.value.status, "executed");
  const projectId = (startRes.value.result as any).project.id;

  // Verify workforce reservation exists in DomainPeopleData
  peopleDoc = (await env.domains.read(env.rawDoc.id)).value;
  let peopleData = getDomainPeopleData(peopleDoc.record);
  const wfResv = peopleData.reservations.find((r) => r.targetRef === `project:${projectId}`);
  assert.ok(wfResv, "Workforce reservation must exist in DomainPeopleData");
  assert.equal(wfResv.status, "active");
  assert.equal(wfResv.amount, 4);

  // Verify available capacity reduced
  let activeWf = calculateWorkforce(peopleData);
  assert.equal(activeWf.types.general.available, 6, "Available workforce must be 10 - 4 = 6");

  // Cancel project and verify workforce reservation is released
  const cancelCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:cancel-project",
    payload: {
      domainUuid: env.rawDoc.uuid,
      projectId,
      reason: "Postponed"
    },
    issuedAtReal: Date.now()
  };

  const cancelRes = await env.commandBus.execute(cancelCmd);
  assert.equal(cancelRes.ok, true);
  assert.equal(cancelRes.value.status, "executed");

  peopleDoc = (await env.domains.read(env.rawDoc.id)).value;
  peopleData = getDomainPeopleData(peopleDoc.record);
  const releasedResv = peopleData.reservations.find((r) => r.targetRef === `project:${projectId}`);
  assert.ok(releasedResv);
  assert.equal(releasedResv.status, "released", "Workforce reservation must be marked 'released'");

  let restoredWf = calculateWorkforce(peopleData);
  assert.equal(restoredWf.types.general.available, 10, "Available workforce must be restored to 10");
});

// ===========================================================================
// REVALIDATION 3 FAULT-INJECTION SUITE (G5-REVAL3-001 TO G5-REVAL3-007)
// ===========================================================================

// TEST 16 (Fault 1): G5-REVAL3-001/002 — Project start rolls back reservations and workforce when domain save fails
test("G5-REVAL3-001 & 002 (Fault 1): Project start rolls back reservations and workforce when domain save fails", async () => {
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 200,
        baseCapacityMinor: null
      }
    ]
  });
  record = withDomainPeopleData(record, {
    ...createDefaultDomainPeopleData(),
    populationGroups: [
      {
        id: "pop_00000000-0000-0000-0000-000000000009",
        name: "Engineers",
        count: 50,
        includedInTotal: true,
        tags: [],
        workforceContributions: [{ workforceTypeId: "general", amount: 10 }]
      }
    ]
  });

  const env = setupTestEnvironment(record);

  env.projectRegistry.register({
    id: "domain-manager:fault-start-project",
    version: 1,
    label: "Fault Start Project",
    tags: ["infrastructure"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    requirements: [],
    costs: [
      { resourceId: "domain-manager:materials", amountMinor: 50, timing: "upfront" },
      { resourceId: "domain-manager:materials", amountMinor: 30, timing: "reserved" }
    ],
    rewards: []
  });

  // Inject save failure on domain save
  const originalSave = env.domains.save.bind(env.domains);
  let saveAttempted = false;
  env.domains.save = async () => {
    saveAttempted = true;
    return err(
      createPublicError({
        code: "DM_STORAGE_INJECTED_FAULT",
        category: "internal",
        message: "Injected disk write failure during project start save"
      })
    );
  };

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:fault-start-project",
    name: "Fault Project",
    workRequired: 100,
    workforceRequired: 4,
    userId: "gm-user"
  });

  assert.equal(startRes.ok, false, "Project start must fail closed when domain save fails");
  assert.equal(saveAttempted, true, "Save must have been attempted");

  // Restore save method
  env.domains.save = originalSave;

  // Verify economic upfront cost was compensated/refunded (balance remains 200)
  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 200, "Upfront debit must be compensated/refunded");

  // Verify economic reservation was cancelled/released
  const reservations = env.economyService.listReservations({ domainUuid: env.rawDoc.uuid, status: "active" });
  assert.equal(reservations.length, 0, "Economic reservation must be released/cancelled on failure");

  // Verify workforce reservation was released / available capacity restored
  const peopleData = getDomainPeopleData(doc.record);
  const activeWfResvs = peopleData.reservations.filter((r) => r.status === "active");
  assert.equal(activeWfResvs.length, 0, "Workforce reservation must be released on failure");
  const wf = calculateWorkforce(peopleData);
  assert.equal(wf.types.general.available, 10, "Workforce available must remain 10");
});

// TEST 17 (Fault 2): G5-REVAL3-002/004 — Project completion transitions to needs-recovery when child facility creation fails
test("G5-REVAL3-002 & 004 (Fault 2): Project completion transitions to needs-recovery when child facility creation fails", async () => {
  const env = setupTestEnvironment();

  env.projectRegistry.register({
    id: "domain-manager:facility-maker-project",
    version: 1,
    label: "Facility Maker Project",
    tags: ["infrastructure"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 10,
    requirements: [],
    costs: [],
    rewards: [
      {
        type: "facility:create",
        targetRef: "domain-manager:storehouse",
        value: 1
      }
    ]
  });

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:facility-maker-project",
    name: "Maker Project",
    workRequired: 10,
    userId: "gm-user"
  });
  checkOk(startRes, "Maker Project Start");
  const projectId = startRes.value.project.id;

  await env.projectsService.advanceProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    delta: 10,
    userId: "gm-user"
  });

  // Inject failure into facilitiesService.createFacility
  const originalCreate = env.facilitiesService.createFacility.bind(env.facilitiesService);
  env.facilitiesService.createFacility = async () => {
    return err(
      createPublicError({
        code: "DM_FACILITY_INJECTED_FAULT",
        category: "internal",
        message: "Injected facility creation fault"
      })
    );
  };

  const compCmdId = "cmd_comp_fault_fac" as CommandId;
  await env.projectsService.completeProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    commandId: compCmdId,
    authorityEpoch: 5,
    userId: "gm-user"
  });

  env.facilitiesService.createFacility = originalCreate;

  // The operation had a partial failure on child facility creation
  // Transaction must transition to needs-recovery with durable recoveryData
  const tx = env.transactionStore.getByCommandId(compCmdId);
  assert.ok(tx, "TransactionRecord must transition to needs-recovery");
  assert.equal(tx.state, "needs-recovery");
  assert.ok(tx.recoveryData, "Transaction must store durable recoveryData");
  assert.equal((tx.recoveryData as any).type, "projects:completion");
  assert.equal((tx.recoveryData as any).projectId, projectId);
});

// TEST 18 (Fault 3): G5-REVAL3-002/004 — Project completion transitions to needs-recovery when domain save fails after child effects
test("G5-REVAL3-002 & 004 (Fault 3): Project completion transitions to needs-recovery when domain save fails after child effects", async () => {
  const env = setupTestEnvironment();

  env.projectRegistry.register({
    id: "domain-manager:reward-project",
    version: 1,
    label: "Reward Project",
    tags: ["infrastructure"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 10,
    requirements: [],
    costs: [],
    rewards: [
      {
        type: "facility:create",
        targetRef: "domain-manager:storehouse",
        value: 1
      },
      {
        type: "resource",
        targetRef: "domain-manager:materials",
        value: 100
      }
    ]
  });

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:reward-project",
    name: "Save Fault Project",
    workRequired: 10,
    userId: "gm-user"
  });
  checkOk(startRes, "Save Fault Project Start");
  const projectId = startRes.value.project.id;

  await env.projectsService.advanceProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    delta: 10,
    userId: "gm-user"
  });

  // Inject failure on domains.save during final project completion save (after child effects succeed)
  const originalSave = env.domains.save.bind(env.domains);
  env.domains.save = async (doc: any) => {
    const prj = getDomainProjectsData(doc.record).projects.find((p: any) => p.id === projectId);
    if (prj?.lifecycle === "completed") {
      return err(
        createPublicError({
          code: "DM_STORAGE_INJECTED_FAULT",
          category: "internal",
          message: "Injected disk write failure during project completion save"
        })
      );
    }
    return originalSave(doc);
  };

  const compCmdId = "cmd_comp_fault_save" as CommandId;
  const compRes = await env.projectsService.completeProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    commandId: compCmdId,
    authorityEpoch: 3,
    userId: "gm-user"
  });

  env.domains.save = originalSave;

  assert.equal(compRes.ok, false, "Completion must fail closed when domain save fails");
  const tx = env.transactionStore.getByCommandId(compCmdId);
  assert.ok(tx, "Transaction must exist in store");
  assert.equal(tx.state, "needs-recovery");
  assert.ok(tx.recoveryData);
  assert.equal((tx.recoveryData as any).type, "projects:completion");
  assert.equal((tx.recoveryData as any).projectId, projectId);
  assert.ok((tx.recoveryData as any).createdFacilityIds.length > 0, "Created facility IDs must be recorded");
  assert.ok((tx.recoveryData as any).creditedResourceRefs.length > 0, "Credited resource refs must be recorded");
});

// TEST 19 (Fault 4): G5-REVAL3-004 — RecoveryService.recoverTransaction idempotently recovers projects:completion transaction
test("G5-REVAL3-004 (Fault 4): RecoveryService.recoverTransaction idempotently recovers projects:completion transaction", async () => {
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 200,
        baseCapacityMinor: null
      }
    ]
  });
  const env = setupTestEnvironment(record);

  // Register compensator
  env.projectsService.registerRecoveryCompensators(env.recoveryService);

  // Create a facility and credit 100 materials to simulate completed child effects
  const facRes = await env.facilitiesService.createFacility({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:storehouse",
    name: "Temporary Storehouse",
    level: 1,
    initialLifecycle: "operational"
  });
  checkOk(facRes, "Create facility for recovery test");
  const createdFacilityId = facRes.value.facility.id;

  const creditRes = await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 100,
    reason: "Completion reward to be recovered"
  });
  checkOk(creditRes, "Credit resources for recovery test");

  // Verify economy has 300 materials
  let doc = (await env.domains.read(env.rawDoc.id)).value;
  let matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 300);

  // Create synthetic needs-recovery transaction with recoveryData
  const txId = createOpaqueId("tx");
  const txCmdId = createCommandId();
  const initialSnapshot: any = {
    id: "prj-recovered-1",
    definitionId: "domain-manager:fortified-gate",
    domainUuid: env.rawDoc.id,
    name: "Recovered Project",
    workRequired: 100,
    workCompleted: 100,
    lifecycle: "active",
    revision: 1
  };

  const recoveryData = {
    type: "projects:completion",
    domainUuid: env.rawDoc.uuid,
    projectId: initialSnapshot.id,
    initialProjectSnapshot: initialSnapshot,
    createdFacilityIds: [createdFacilityId],
    creditedResourceRefs: [{ resourceId: "domain-manager:materials", amountMinor: 100 }],
    debitedCostRefs: []
  };

  const txRecord = createTransactionRecord({
    transactionId: txId,
    commandId: txCmdId,
    lockKeys: [`domain:${env.rawDoc.id}`],
    authorityEpoch: 1,
    recoveryData
  });

  env.transactionStore.save({
    ...txRecord,
    state: "needs-recovery"
  });

  // Execute recovery
  const recRes = await env.recoveryService.recoverTransaction(txId);
  checkOk(recRes, "RecoveryService.recoverTransaction");

  // Verify recovery effects:
  // 1. Created facility was rolled back (deleted)
  doc = (await env.domains.read(env.rawDoc.id)).value;
  const facs = getDomainFacilitiesData(doc.record).facilities;
  assert.equal(facs.find((f) => f.id === createdFacilityId), undefined, "Created facility must be rolled back");

  // 2. Credited 100 materials was reverted (balance restored to 200)
  matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 200, "Credited reward must be debited back");

  // 3. Transaction transitioned to compensated
  const txAfter = env.transactionStore.get(txId);
  assert.equal(txAfter?.state, "compensated", "Transaction must be marked 'compensated'");

  // 4. Idempotency check: recovering again must succeed without double-debiting
  const recRes2 = await env.recoveryService.recoverTransaction(txId);
  checkOk(recRes2, "Subsequent recovery must be idempotent");
  doc = (await env.domains.read(env.rawDoc.id)).value;
  matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 200, "Balance must remain unchanged after idempotent recovery");
});

// TEST 20 (Fault 5): G5-REVAL3-003 — Project cancel fails closed when economy reservation release fails
test("G5-REVAL3-003 (Fault 5): Project cancel fails closed when economy reservation release fails", async () => {
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 200,
        baseCapacityMinor: null
      }
    ]
  });
  const env = setupTestEnvironment(record);

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:fortified-gate",
    name: "Cancel Fail Project",
    workRequired: 100,
    userId: "gm-user"
  });
  checkOk(startRes, "Project Start");
  const projectId = startRes.value.project.id;

  // Stub economyService.releaseReservation to return failure
  const originalRelease = env.economyService.releaseReservation.bind(env.economyService);
  env.economyService.releaseReservation = async () => {
    return err(
      createPublicError({
        code: "DM_ECON_RELEASE_FAILED",
        category: "internal",
        message: "Injected economy reservation release failure"
      })
    );
  };

  const cancelRes = await env.projectsService.cancelProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    reason: "Abort",
    userId: "gm-user"
  });

  env.economyService.releaseReservation = originalRelease;

  assert.equal(cancelRes.ok, false, "Cancel must fail closed when reservation release fails");
  assert.equal(cancelRes.error.code, "DM_ECON_RELEASE_FAILED");

  // Verify project is still active in domain (NOT cancelled)
  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const project = getDomainProjectsData(doc.record).projects.find((p) => p.id === projectId);
  assert.equal(project?.lifecycle, "active", "Project must remain active when cancel fails closed");
});

// TEST 21 (Fault 6): G5-REVAL3-003 — Project cancel fails closed when workforce release fails
test("G5-REVAL3-003 (Fault 6): Project cancel fails closed when workforce release fails", async () => {
  let record = createInitialRecord();
  record = withDomainPeopleData(record, {
    ...createDefaultDomainPeopleData(),
    populationGroups: [
      {
        id: "pop_00000000-0000-0000-0000-000000000010",
        name: "Artisans",
        count: 50,
        includedInTotal: true,
        tags: [],
        workforceContributions: [{ workforceTypeId: "general", amount: 10 }]
      }
    ]
  });
  const env = setupTestEnvironment(record);

  env.projectRegistry.register({
    id: "domain-manager:labor-project",
    version: 1,
    label: "Labor Project",
    tags: ["labor"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 50,
    requirements: [],
    costs: [],
    rewards: []
  });

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:labor-project",
    name: "Labor Project",
    workRequired: 50,
    workforceRequired: 4,
    userId: "gm-user"
  });
  checkOk(startRes, "Labor Project Start");
  const projectId = startRes.value.project.id;

  // Stub peopleService.releaseWorkforceReservation to return failure
  const originalWfRelease = env.peopleService.releaseWorkforceReservation.bind(env.peopleService);
  env.peopleService.releaseWorkforceReservation = async () => {
    return err(
      createPublicError({
        code: "DM_PEOPLE_RELEASE_FAILED",
        category: "internal",
        message: "Injected workforce release failure"
      })
    );
  };

  const cancelRes = await env.projectsService.cancelProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    reason: "Abort",
    userId: "gm-user"
  });

  env.peopleService.releaseWorkforceReservation = originalWfRelease;

  assert.equal(cancelRes.ok, false, "Cancel must fail closed when workforce release fails");
  assert.equal(cancelRes.error.code, "DM_PEOPLE_RELEASE_FAILED");

  // Verify project is still active in domain (NOT cancelled)
  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const project = getDomainProjectsData(doc.record).projects.find((p) => p.id === projectId);
  assert.equal(project?.lifecycle, "active", "Project must remain active when cancel fails closed");
});

// TEST 22 (Fault 7): G5-REVAL3-002 — Facility maintenance refunds debited costs when domain save fails
test("G5-REVAL3-002 (Fault 7): Facility maintenance refunds debited costs when domain save fails", async () => {
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 100,
        baseCapacityMinor: null
      }
    ]
  });
  const env = setupTestEnvironment(record);

  // Create facility
  const facRes = await env.facilitiesService.createFacility({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:storehouse",
    name: "Maintenance Storehouse",
    level: 1,
    initialLifecycle: "operational"
  });
  checkOk(facRes, "Create facility for maintenance");
  const facilityId = facRes.value.facility.id;

  // Inject failure on domains.save during maintainFacility
  const originalSave = env.domains.save.bind(env.domains);
  env.domains.save = async () => {
    return err(
      createPublicError({
        code: "DM_STORAGE_INJECTED_FAULT",
        category: "internal",
        message: "Injected disk write failure during maintenance save"
      })
    );
  };

  const maintainRes = await env.facilitiesService.maintainFacility({
    domainUuid: env.rawDoc.uuid,
    facilityId,
    userId: "gm-user"
  });

  env.domains.save = originalSave;

  assert.equal(maintainRes.ok, false, "Maintenance must fail closed when save fails");

  // Verify economy cost was compensated/refunded (balance remains 100)
  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 100, "Maintenance debited cost must be refunded on save failure");
});

// TEST 23 (Fault 8): G5-REVAL3-002 — Facility repair refunds debited costs when domain save fails
test("G5-REVAL3-002 (Fault 8): Facility repair refunds debited costs when domain save fails", async () => {
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 100,
        baseCapacityMinor: null
      }
    ]
  });
  const env = setupTestEnvironment(record);

  // Create damaged facility (integrity 50)
  const facRes = await env.facilitiesService.createFacility({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:storehouse",
    name: "Repair Storehouse",
    level: 1,
    initialLifecycle: "operational"
  });
  checkOk(facRes, "Create facility for repair");
  const facilityId = facRes.value.facility.id;

  await env.facilitiesService.applyDamage({
    domainUuid: env.rawDoc.uuid,
    facilityId,
    damage: 50,
    userId: "gm-user"
  });

  // Verify balance before repair is 100
  let doc = (await env.domains.read(env.rawDoc.id)).value;
  let matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 100);

  // Inject failure on domains.save during repairFacility
  const originalSave = env.domains.save.bind(env.domains);
  env.domains.save = async () => {
    return err(
      createPublicError({
        code: "DM_STORAGE_INJECTED_FAULT",
        category: "internal",
        message: "Injected disk write failure during repair save"
      })
    );
  };

  const repairRes = await env.facilitiesService.repairFacility({
    domainUuid: env.rawDoc.uuid,
    facilityId,
    userId: "gm-user"
  });

  env.domains.save = originalSave;

  assert.equal(repairRes.ok, false, "Repair must fail closed when save fails");

  // Verify economy cost was compensated/refunded (balance remains 100)
  doc = (await env.domains.read(env.rawDoc.id)).value;
  matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 100, "Repair debited cost must be refunded on save failure");
});

// TEST 24 (Fault 9): G5-REVAL3-002 — Downtime start refunds debited upfront costs when domain save fails
test("G5-REVAL3-002 (Fault 9): Downtime start refunds debited upfront costs when domain save fails", async () => {
  let record = createInitialRecord();
  record = withDomainEconomyData(record, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-adv-1",
        resourceId: "domain-manager:materials",
        balanceMinor: 50,
        baseCapacityMinor: null
      }
    ]
  });
  const env = setupTestEnvironment(record);

  // Inject failure on domains.save during downtime start
  const originalSave = env.domains.save.bind(env.domains);
  env.domains.save = async () => {
    return err(
      createPublicError({
        code: "DM_STORAGE_INJECTED_FAULT",
        category: "internal",
        message: "Injected disk write failure during downtime start save"
      })
    );
  };

  const startDtRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:crafting", // Costs 10 materials upfront
    label: "Fault Crafting",
    participants: [{ participantRef: "notable:crafter-1", participantType: "notable", role: "owner" }],
    userId: "gm-user"
  });

  env.domains.save = originalSave;

  assert.equal(startDtRes.ok, false, "Downtime start must fail closed when save fails");

  // Verify economy cost was compensated/refunded (balance remains 50)
  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const matAcc = doc.record.definition.capabilities.config["domain-manager:economy"].accounts.find(
    (a: any) => a.resourceId === "domain-manager:materials"
  );
  assert.equal(matAcc.balanceMinor, 50, "Upfront cost (10 materials) must be refunded on downtime save failure");
});

// TEST 25 (Fault 10): G5-REVAL3-005 — Downtime completion with failed mandatory outcome fails closed and does not complete
test("G5-REVAL3-005 (Fault 10): Downtime completion with failed mandatory outcome fails closed and does not complete", async () => {
  const env = setupTestEnvironment();

  env.downtimeRegistry.register({
    id: "domain-manager:failing-mandatory-outcome",
    version: 1,
    label: "Mandatory Outcome Activity",
    category: "production",
    scope: "individual",
    defaultDurationTicks: 5,
    minParticipants: 1,
    outcomeDefinitions: [
      {
        id: "mandatory-buff",
        type: "unknown_mandatory_side_effect",
        label: "Mandatory Buff",
        parameters: { buffId: "strength" },
        visibility: "public" as const,
        optional: false // Strictly mandatory!
      }
    ]
  });

  const startRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:failing-mandatory-outcome",
    label: "Buff Exercise",
    participants: [{ participantRef: "notable:warrior-1", participantType: "notable", role: "participant" }],
    userId: "gm-user"
  });
  checkOk(startRes, "Start Mandatory Outcome Activity");
  const activityId = startRes.value.activityId;

  // Complete activity without registered handler for unknown_mandatory_side_effect
  const compRes = await env.downtimeService.completeActivity({
    domainUuid: env.rawDoc.uuid,
    activityId,
    userId: "gm-user"
  });

  assert.equal(compRes.ok, false, "Completion must fail closed when mandatory outcome fails");
  assert.equal(compRes.error.code, "DM_DOWNTIME_MANDATORY_OUTCOME_FAILED");

  // Verify activity is NOT marked completed in domain data
  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const activity = getDomainDowntimeData(doc.record).activities.find((a) => a.id === activityId);
  assert.ok(activity);
  assert.equal(activity.lifecycle, "inProgress", "Activity lifecycle must remain inProgress, NOT completed");
});

// TEST 26 (Fault 11): G5-REVAL3-006 — facilities:apply-damage rejects non-GM Domain Controller with DM_SECURITY_PERMISSION_DENIED
test("G5-REVAL3-006 (Fault 11): facilities:apply-damage rejects non-GM Domain Controller with DM_SECURITY_PERMISSION_DENIED", async () => {
  const env = setupTestEnvironment();

  // Create facility as GM
  const facRes = await env.facilitiesService.createFacility({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:storehouse",
    name: "Guarded Storehouse",
    level: 1,
    initialLifecycle: "operational"
  });
  checkOk(facRes, "Create facility for GM damage test");
  const facilityId = facRes.value.facility.id;

  // Non-GM Domain Controller attempts to apply damage
  const playerDmgCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "facilities:apply-damage",
    payload: {
      domainUuid: env.rawDoc.uuid,
      facilityId,
      damage: 25,
      reason: "Sabotage attempt"
    },
    issuedAtReal: Date.now()
  };

  // Dispatch inbound through commandBus as remote player-controller (ownership 3, but isGM: false)
  const playerRes = await env.commandBus.dispatchInbound({
    rawEnvelope: playerDmgCmd,
    transportContext: {
      senderUserId: "player-controller",
      transportName: "socketlib",
      transportTimestamp: Date.now()
    }
  });
  assert.equal(playerRes.ok, true);
  assert.equal(playerRes.value.status, "rejected", "Non-GM controller must be rejected");
  assert.equal(playerRes.value.error?.code, "DM_SECURITY_PERMISSION_DENIED");

  // Game Master applies damage
  const gmDmgCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "facilities:apply-damage",
    payload: {
      domainUuid: env.rawDoc.uuid,
      facilityId,
      damage: 25,
      reason: "Official GM disaster"
    },
    issuedAtReal: Date.now()
  };

  const gmRes = await env.commandBus.dispatchInbound({
    rawEnvelope: gmDmgCmd,
    transportContext: {
      senderUserId: "gm-user",
      transportName: "socketlib",
      transportTimestamp: Date.now()
    }
  });
  assert.equal(gmRes.ok, true);
  assert.equal(gmRes.value.status, "executed", "GM must be permitted to apply damage");

  // Verify damage applied
  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const facility = getDomainFacilitiesData(doc.record).facilities.find((f) => f.id === facilityId);
  assert.equal(facility?.integrity?.current, 75, "Integrity must be reduced by 25");
});

// TEST 27: G5-REVAL4-001 (Fault 1): Downtime start transitions canonical lifecycle prepared -> committing -> committed
test("G5-REVAL4-001 (Fault 1): Downtime start transitions canonical lifecycle prepared -> committing -> committed", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials for downtime"
  });

  const startRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:crafting",
    activityName: "Forging weapons",
    duration: 5,
    participants: [
      { participantRef: "notable:blacksmith-1", participantType: "notable", role: "owner" }
    ],
    commandId: "cmd_dt_start_canonical"
  });
  checkOk(startRes, "Downtime start should succeed");

  const tx = env.transactionStore.getByCommandId("cmd_dt_start_canonical" as any);
  assert.ok(tx, "Transaction must exist in store");
  assert.equal(tx.state, "committed", "Transaction must be committed");

  const transitions = tx.history.map((h) => `${h.fromState}->${h.toState}`);
  assert.deepEqual(transitions, [
    "planned->claimed",
    "claimed->prepared",
    "prepared->committing",
    "committing->committed"
  ], "Canonical transitions must include prepared -> committing -> committed");
});

// TEST 28: G5-REVAL4-001 (Fault 2): Downtime resolution transitions canonical lifecycle prepared -> committing -> committed
test("G5-REVAL4-001 (Fault 2): Downtime resolution transitions canonical lifecycle prepared -> committing -> committed", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials for downtime"
  });

  const startRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:crafting",
    activityName: "Forging shields",
    duration: 1,
    participants: [
      { participantRef: "notable:blacksmith-1", participantType: "notable", role: "owner" }
    ]
  });
  checkOk(startRes, "Start activity");

  const compRes = await env.downtimeService.completeActivity({
    domainUuid: env.rawDoc.uuid,
    activityId: startRes.value.activity.id,
    commandId: "cmd_dt_comp_canonical"
  });
  checkOk(compRes, "Complete activity");

  const tx = env.transactionStore.getByCommandId("cmd_dt_comp_canonical" as any);
  assert.ok(tx, "Resolution transaction must exist in store");
  assert.equal(tx.state, "committed", "Transaction must be committed");

  const transitions = tx.history.map((h) => `${h.fromState}->${h.toState}`);
  assert.deepEqual(transitions, [
    "planned->claimed",
    "claimed->prepared",
    "prepared->committing",
    "committing->committed"
  ], "Canonical transitions must include prepared -> committing -> committed");
});

// TEST 29: G5-REVAL4-002 (Fault 3): Flush failure immediately after prepared aborts without child writes
test("G5-REVAL4-002 (Fault 3): Flush failure immediately after prepared aborts without child writes", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials"
  });

  const originalFlush = env.transactionStore.flush.bind(env.transactionStore);
  env.transactionStore.flush = async () => {
    throw new Error("Simulated storage write error during prepare flush");
  };

  const startRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:crafting",
    activityName: "Aborted activity",
    duration: 5,
    participants: [
      { participantRef: "notable:blacksmith-1", participantType: "notable", role: "owner" }
    ],
    commandId: "cmd_dt_flush_fail"
  });

  assert.equal(startRes.ok, false);
  assert.equal(startRes.error.code, "DM_DOMAIN_STORAGE_ERROR");

  env.transactionStore.flush = originalFlush;

  // Domain must NOT have been mutated
  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const downtimeData = getDomainDowntimeData(doc.record);
  assert.equal(downtimeData.activities.length, 0, "No activities must be added on prepare flush failure");

  const tx = env.transactionStore.getByCommandId("cmd_dt_flush_fail" as any);
  assert.ok(tx);
  assert.equal(tx.state, "failed", "Transaction must transition to failed on prepare flush failure");
});

// TEST 30: G5-REVAL4-003 (Fault 4): Failed compensation transitions transaction to needs-recovery
test("G5-REVAL4-003 (Fault 4): Failed compensation transitions transaction to needs-recovery", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials"
  });

  const facRes = await env.facilitiesService.createFacility({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:storehouse",
    name: "Test Facility for compensation failure"
  });
  checkOk(facRes, "Create facility");
  const facilityId = facRes.value.facility.id;

  // Inject failure in domain save after maintenance debits
  let debitSaveDone = false;
  const originalSave = env.domains.save.bind(env.domains);
  env.domains.save = async (params) => {
    if (!debitSaveDone) {
      debitSaveDone = true;
      return originalSave(params);
    }
    return err(createPublicError({
      code: "DM_DOMAIN_SAVE_FAILED",
      category: "storage",
      message: "Simulated save failure during maintenance commit"
    }));
  };

  // Inject failure in commitAdjust during compensation (refund)
  const originalCommitAdjust = env.economyService.commitAdjust.bind(env.economyService);
  env.economyService.commitAdjust = async (params) => {
    if (params.deltaMinor !== undefined && params.deltaMinor > 0 && params.reason.startsWith("Compensation:")) {
      return err(createPublicError({
        code: "DM_ECONOMY_ADJUST_FAILED",
        category: "internal",
        message: "Simulated compensation failure"
      }));
    }
    return originalCommitAdjust(params);
  };

  const maintRes = await env.facilitiesService.maintainFacility({
    domainUuid: env.rawDoc.uuid,
    facilityId,
    commandId: "cmd_fac_comp_fail"
  });
  assert.equal(maintRes.ok, false);

  env.domains.save = originalSave;
  env.economyService.commitAdjust = originalCommitAdjust;

  const tx = env.transactionStore.getByCommandId("cmd_fac_comp_fail" as any);
  assert.ok(tx);
  assert.equal(tx.state, "needs-recovery", "Transaction must end in needs-recovery when compensation fails");
});

// TEST 31: G5-REVAL4-004 (Fault 5): Recovery execution with recovery_<txId> lockOwner avoids self-deadlock
test("G5-REVAL4-004 (Fault 5): Recovery execution with recovery_<txId> lockOwner avoids self-deadlock", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials"
  });

  const facRes = await env.facilitiesService.createFacility({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:storehouse",
    name: "Storehouse for recovery deadlock test"
  });
  checkOk(facRes, "Create facility");
  const facilityId = facRes.value.facility.id;

  const txId = createOpaqueId("tx");
  const cmdId = createCommandId();
  const txRecord = createTransactionRecord({
    transactionId: txId,
    commandId: cmdId,
    authorityEpoch: 1,
    lockKeys: [`domain:${normalizeJournalEntryId(env.rawDoc.uuid)}`, `facility:${facilityId}`],
    recoveryData: {
      type: "facilities:maintenance",
      facilityId,
      domainUuid: normalizeJournalEntryId(env.rawDoc.uuid),
      debitedCosts: [{ resourceId: "domain-manager:materials", amount: 10 }],
      authorityEpoch: 1,
      status: "executing"
    }
  });
  env.transactionStore.save(txRecord);
  env.transactionStore.transition(txId, "claimed", 1);
  env.transactionStore.transition(txId, "prepared", 1);
  env.transactionStore.transition(txId, "needs-recovery", 1, "Simulated crash");

  const recResList = await env.recoveryService.recoverAll(1);
  assert.equal(recResList.length, 1, "Must find and recover 1 unresolved transaction via recoverAll");
  checkOk(recResList[0], "Recovery should succeed under recovery_<txId> lock via recoverAll");

  const recoveredTx = env.transactionStore.get(txId);
  assert.equal(recoveredTx?.state, "compensated", "Transaction must be marked compensated");
});

// TEST 32: G5-REVAL4-005 (Fault 6): Partial failure during recovery compensation preserves needs-recovery state
test("G5-REVAL4-005 (Fault 6): Partial failure during recovery compensation preserves needs-recovery state", async () => {
  const env = setupTestEnvironment();
  const txId = createOpaqueId("tx");
  const cmdId = createCommandId();
  const txRecord = createTransactionRecord({
    transactionId: txId,
    commandId: cmdId,
    authorityEpoch: 1,
    lockKeys: [`domain:${normalizeJournalEntryId(env.rawDoc.uuid)}`],
    recoveryData: {
      type: "facilities:maintenance",
      facilityId: "fac-123",
      domainUuid: normalizeJournalEntryId(env.rawDoc.uuid),
      debitedCosts: [{ resourceId: "domain-manager:materials", amount: 20 }],
      authorityEpoch: 1,
      status: "executing"
    }
  });
  env.transactionStore.save(txRecord);
  env.transactionStore.transition(txId, "claimed", 1);
  env.transactionStore.transition(txId, "prepared", 1);
  env.transactionStore.transition(txId, "needs-recovery", 1, "Simulated crash");

  const originalAdjust = env.economyService.commitAdjust.bind(env.economyService);
  env.economyService.commitAdjust = async () => {
    return err(createPublicError({
      code: "DM_RECOVERY_ADJUST_FAILED",
      category: "internal",
      message: "Database connection failed during recovery"
    }));
  };

  const recRes = await env.recoveryService.recoverTransaction(txId);
  assert.equal(recRes.ok, false);

  env.economyService.commitAdjust = originalAdjust;

  const currentTx = env.transactionStore.get(txId);
  assert.equal(currentTx?.state, "needs-recovery", "Transaction must remain in needs-recovery after failed recovery attempt");
});

// TEST 33: G5-REVAL4-006 (Fault 7): Project completion recovery restores consumed economic reservations and released workforce
test("G5-REVAL4-006 (Fault 7): Project completion recovery restores consumed economic reservations and released workforce", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials for project"
  });

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:fortified-gate",
    name: "Gate Alpha",
    workforceRequired: 2
  });
  checkOk(startRes, "Project start");
  const project = startRes.value.project;

  const advRes = await env.projectsService.advanceProject({
    domainUuid: env.rawDoc.uuid,
    projectId: project.id,
    delta: 100
  });
  checkOk(advRes, "Advance project");

  const compRes = await env.projectsService.completeProject({
    domainUuid: env.rawDoc.uuid,
    projectId: project.id,
    commandId: "cmd_complete_for_rec"
  });
  checkOk(compRes, "Complete project");

  const tx = env.transactionStore.getByCommandId("cmd_complete_for_rec" as any);
  assert.ok(tx);
  const recoveryData = tx.recoveryData as any;
  assert.ok(recoveryData.consumedReservationSnapshots?.length > 0, "Must have snapshotted consumed economic reservation");
  assert.ok(recoveryData.releasedWorkforceSnapshots?.length > 0, "Must have snapshotted released workforce reservation");

  // Re-create as needs-recovery transaction with the snapshot data to test recovery execution
  const recTxId = createOpaqueId("tx");
  const recTx = createTransactionRecord({
    transactionId: recTxId,
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: tx.lockKeys,
    recoveryData: tx.recoveryData
  });
  env.transactionStore.save(recTx);
  env.transactionStore.transition(recTxId, "claimed", 1);
  env.transactionStore.transition(recTxId, "prepared", 1);
  env.transactionStore.transition(recTxId, "needs-recovery", 1, "Simulated crash after completion");

  const recResList = await env.recoveryService.recoverAll(1);
  assert.equal(recResList.length, 1, "Must find and recover 1 needs-recovery transaction via recoverAll");
  checkOk(recResList[0], "Recovery should succeed");

  const resSnapshot = recoveryData.consumedReservationSnapshots[0].reservation;
  const restoredRes = env.economyService.getReservation(resSnapshot.id);
  assert.equal(restoredRes?.status, "active", "Economic reservation must be restored to active");

  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const peopleData = getDomainPeopleData(doc.record);
  const wfRes = peopleData.reservations.find((r) => r.id === recoveryData.releasedWorkforceSnapshots[0].reservationId);
  assert.equal(wfRes?.status, "active", "Workforce reservation must be restored to active");
});

// TEST 34: G5-REVAL4-007 (Fault 8): Project advance atomic plan refunds progressive costs on save failure
test("G5-REVAL4-007 (Fault 8): Project advance atomic plan refunds progressive costs on save failure", async () => {
  const env = setupTestEnvironment();
  env.projectRegistry.register({
    id: "domain-manager:long-canal",
    version: 1,
    label: "Long Canal",
    tags: ["civil"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    requirements: [],
    costs: [
      { resourceId: "domain-manager:materials", amountMinor: 100, timing: "progressive" }
    ],
    rewards: []
  });

  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials for canal"
  });

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:long-canal",
    name: "Great Canal"
  });
  checkOk(startRes, "Start canal project");
  const projectId = startRes.value.project.id;

  const docBefore = (await env.domains.read(env.rawDoc.id)).value;
  const econBefore = tryGetDomainEconomyData(docBefore.record).value;
  const balanceBefore = econBefore.accounts.find((a) => a.resourceId === "domain-manager:materials")!.balanceMinor;

  const originalSave = env.domains.save.bind(env.domains);
  env.domains.save = async () => {
    return err(createPublicError({
      code: "DM_DOMAIN_SAVE_FAILED",
      category: "storage",
      message: "Simulated save failure during advance"
    }));
  };

  const advRes = await env.projectsService.advanceProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    delta: 50,
    commandId: "cmd_adv_save_fail"
  });
  assert.equal(advRes.ok, false);

  env.domains.save = originalSave;

  const docAfter = (await env.domains.read(env.rawDoc.id)).value;
  const econAfter = tryGetDomainEconomyData(docAfter.record).value;
  const balanceAfter = econAfter.accounts.find((a) => a.resourceId === "domain-manager:materials")!.balanceMinor;
  assert.equal(balanceAfter, balanceBefore, "Progressive cost must be completely refunded on save failure");

  const tx = env.transactionStore.getByCommandId("cmd_adv_save_fail" as any);
  assert.ok(tx);
  assert.equal(tx.state, "failed", "Transaction must be marked failed after successful compensation");
});

// TEST 35: G5-REVAL4-008 (Fault 9): Project cancel atomic plan restores reservations and workforce on save failure
test("G5-REVAL4-008 (Fault 9): Project cancel atomic plan restores reservations and workforce on save failure", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials"
  });

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:fortified-gate",
    name: "Gate for cancel test",
    workforceRequired: 2
  });
  checkOk(startRes, "Project start");
  const projectId = startRes.value.project.id;

  const originalSave = env.domains.save.bind(env.domains);
  env.domains.save = async () => {
    return err(createPublicError({
      code: "DM_DOMAIN_SAVE_FAILED",
      category: "storage",
      message: "Simulated save failure during cancel"
    }));
  };

  const cancelRes = await env.projectsService.cancelProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    commandId: "cmd_cancel_save_fail"
  });
  assert.equal(cancelRes.ok, false);

  env.domains.save = originalSave;

  const doc = (await env.domains.read(env.rawDoc.id)).value;
  const peopleData = getDomainPeopleData(doc.record);
  const wfRes = peopleData.reservations.find((r) => r.targetRef === `project:${projectId}`);
  assert.equal(wfRes?.status, "active", "Workforce reservation must remain active after cancel failure");

  const tx = env.transactionStore.getByCommandId("cmd_cancel_save_fail" as any);
  assert.ok(tx);
  assert.equal(tx.state, "failed", "Transaction must be marked failed after successful restoration");
});

// TEST 36: G5-REVAL4-009 & G5-REVAL4-010 (Fault 10): Downtime auto-complete forwards execution context; Facilities maintenance & repair write transactions with recovery
test("G5-REVAL4-009 & G5-REVAL4-010 (Fault 10): Downtime auto-complete forwards execution context; Facilities maintenance & repair write transactions with recovery", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials"
  });

  // 1. Downtime auto-complete context forwarding
  const startDtRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:crafting",
    label: "Short craft",
    durationTicks: 2,
    participants: [
      { participantRef: "notable:blacksmith-1", participantType: "notable", role: "owner" }
    ]
  });
  checkOk(startDtRes, "Start short downtime");
  const activityId = startDtRes.value.activity.id;

  const advDtRes = await env.downtimeService.advanceActivity({
    domainUuid: env.rawDoc.uuid,
    activityId,
    ticks: 2,
    commandId: "cmd_dt_auto_comp_1",
    authorityEpoch: 4,
    correlationId: "corr_auto_1",
    causationId: "caus_auto_1"
  });
  checkOk(advDtRes, "Advance short downtime to completion");

  const dtResTx = env.transactionStore.getByCommandId("cmd_dt_auto_comp_1" as any);
  assert.ok(dtResTx, "Resolution transaction must exist with forwarded commandId");
  assert.equal(dtResTx.authorityEpoch, 4, "Resolution transaction must preserve forwarded authorityEpoch");

  // 2. Facilities maintenance writes TransactionRecord
  const facRes = await env.facilitiesService.createFacility({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:storehouse",
    name: "Storehouse for transactional test"
  });
  checkOk(facRes, "Create facility");
  const facilityId = facRes.value.facility.id;

  const maintRes = await env.facilitiesService.maintainFacility({
    domainUuid: env.rawDoc.uuid,
    facilityId,
    commandId: "cmd_maint_tx_1",
    authorityEpoch: 2
  });
  checkOk(maintRes, "Maintain facility");

  const maintTx = env.transactionStore.getByCommandId("cmd_maint_tx_1" as any);
  assert.ok(maintTx, "Maintenance transaction must be stored");
  assert.equal(maintTx.state, "committed");
  assert.equal(maintTx.authorityEpoch, 2);
  const maintHistory = maintTx.history.map((h) => `${h.fromState}->${h.toState}`);
  assert.deepEqual(maintHistory, [
    "planned->claimed",
    "claimed->prepared",
    "prepared->committing",
    "committing->committed"
  ]);

  // 3. Facilities repair writes TransactionRecord
  await env.facilitiesService.applyDamage({
    domainUuid: env.rawDoc.uuid,
    facilityId,
    damage: 10,
    reason: "Wear and tear"
  });

  const repRes = await env.facilitiesService.repairFacility({
    domainUuid: env.rawDoc.uuid,
    facilityId,
    restoreIntegrity: 10,
    commandId: "cmd_repair_tx_1",
    authorityEpoch: 3
  });
  checkOk(repRes, "Repair facility");

  const repTx = env.transactionStore.getByCommandId("cmd_repair_tx_1" as any);
  assert.ok(repTx, "Repair transaction must be stored");
  assert.equal(repTx.state, "committed");
  assert.equal(repTx.authorityEpoch, 3);
  const repHistory = repTx.history.map((h) => `${h.fromState}->${h.toState}`);
  assert.deepEqual(repHistory, [
    "planned->claimed",
    "claimed->prepared",
    "prepared->committing",
    "committing->committed"
  ]);
});

// ---------------------------------------------------------------------------
// TEST 37: G5-REVAL4-008 Scenario A — Project cancel fails at People stage
// ---------------------------------------------------------------------------
test("G5-REVAL4-008 Scenario A: Project cancel fails at People stage (Economy released, People fails -> Economy restored)", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials"
  });

  const startRes = await env.projectsService.startProject({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:fortified-gate",
    name: "Gate for cancel people fail",
    workforceRequired: 2
  });
  checkOk(startRes, "Project start");
  const projectId = startRes.value.project.id;

  const resBefore = env.economyService.listReservations({
    domainUuid: env.rawDoc.id,
    sourceRef: projectId,
    status: "active"
  });
  assert.ok(resBefore.length > 0, "Economy reservation must exist");

  const origReleaseWf = env.peopleService.releaseWorkforceReservation.bind(env.peopleService);
  env.peopleService.releaseWorkforceReservation = async () => {
    return err(createPublicError({
      code: "DM_PEOPLE_RELEASE_FAILED",
      category: "conflict",
      message: "Simulated People stage failure during project cancellation"
    }));
  };

  const cancelRes = await env.projectsService.cancelProject({
    domainUuid: env.rawDoc.uuid,
    projectId,
    commandId: "cmd_cancel_people_fail"
  });
  assert.equal(cancelRes.ok, false, "Cancel must fail when People stage fails");

  env.peopleService.releaseWorkforceReservation = origReleaseWf;

  const restoredRes = env.economyService.listReservations({
    domainUuid: env.rawDoc.id,
    sourceRef: projectId,
    status: "active"
  });
  assert.ok(restoredRes.length > 0, "Reservation must be restored to active status");

  const tx = env.transactionStore.getByCommandId("cmd_cancel_people_fail" as any);
  assert.ok(tx);
  assert.equal(tx.state, "failed", "Transaction must be marked failed after successful compensation");
});

// ---------------------------------------------------------------------------
// TEST 38: G5-REVAL4-009 Scenario B — Downtime advance auto-completes with economic outcome
// ---------------------------------------------------------------------------
test("G5-REVAL4-009 Scenario B: Downtime advance auto-completes with economic outcome dispatched via CommandBus", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials"
  });

  const startRes = await env.downtimeService.startActivity({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:crafting",
    label: "Crafting for bus test",
    durationTicks: 2,
    participants: [
      { participantRef: "notable:blacksmith-1", participantType: "notable", role: "owner" }
    ]
  });
  checkOk(startRes, "Start downtime");
  const activityId = startRes.value.activity.id;

  const docBefore = (await env.domains.read(env.rawDoc.id)).value;
  const econBefore = tryGetDomainEconomyData(docBefore.record).value;
  const suppliesBefore = econBefore.accounts.find((a) => a.resourceId === "domain-manager:supplies")?.balanceMinor ?? 0;

  const advRes = await env.publicDowntime.advanceActivity({
    domainUuid: env.rawDoc.uuid,
    activityId,
    ticks: 2
  });
  checkOk(advRes, "Dispatch downtime:advance via CommandBus");

  const docAfter = (await env.domains.read(env.rawDoc.id)).value;
  const econAfter = tryGetDomainEconomyData(docAfter.record).value;
  const suppliesAfter = econAfter.accounts.find((a) => a.resourceId === "domain-manager:supplies")?.balanceMinor ?? 0;
  assert.equal(suppliesAfter, suppliesBefore + 15, "Crafting completion outcome must grant 15 supplies through CommandBus dispatch");

  const dtAfter = getDomainDowntimeData(docAfter.record);
  const actAfter = dtAfter.activities.find((a) => a.id === activityId);
  assert.ok(actAfter);
  assert.equal(actAfter.lifecycle, "completed");
});

// ---------------------------------------------------------------------------
// TEST 39: G5-REVAL4-010 Scenario C — Facility repair crash recovery
// ---------------------------------------------------------------------------
test("G5-REVAL4-010 Scenario C: Facility repair crash after debit recovers cleanly via recoverAll(1)", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials"
  });

  const facRes = await env.facilitiesService.createFacility({
    domainUuid: env.rawDoc.uuid,
    definitionId: "domain-manager:storehouse",
    name: "Storehouse for crash recovery test"
  });
  checkOk(facRes, "Create facility");
  const facilityId = facRes.value.facility.id;

  await env.facilitiesService.applyDamage({
    domainUuid: env.rawDoc.uuid,
    facilityId,
    damage: 20,
    reason: "Testing crash recovery"
  });

  const docBefore = (await env.domains.read(env.rawDoc.id)).value;
  const econBefore = tryGetDomainEconomyData(docBefore.record).value;
  const materialsBefore = econBefore.accounts.find((a) => a.resourceId === "domain-manager:materials")!.balanceMinor;

  const repairTxId = "tx_simulated_repair_crash_1";
  const repairAmount = 15;
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: -repairAmount,
    reason: `Repair cost for facility '${facilityId}'`
  });

  const txRecord = createTransactionRecord({
    transactionId: repairTxId,
    commandId: "cmd_sim_repair_crash" as any,
    authorityEpoch: 1,
    lockKeys: [`domain:${env.rawDoc.id}`, `facility:${facilityId}`],
    recoveryData: {
      type: "facilities:repair",
      facilityId,
      domainUuid: env.rawDoc.id,
      debitedCosts: [{ resourceId: "domain-manager:materials", amount: repairAmount }],
      authorityEpoch: 1,
      status: "executing"
    }
  });
  env.transactionStore.save(txRecord);
  env.transactionStore.transition(repairTxId, "claimed", 1);
  env.transactionStore.transition(repairTxId, "prepared", 1);
  await env.transactionStore.flush();

  const docDuring = (await env.domains.read(env.rawDoc.id)).value;
  const econDuring = tryGetDomainEconomyData(docDuring.record).value;
  const materialsDuring = econDuring.accounts.find((a) => a.resourceId === "domain-manager:materials")!.balanceMinor;
  assert.equal(materialsDuring, materialsBefore - repairAmount);

  const recoveryResults = await env.recoveryService.recoverAll(1);
  assert.equal(recoveryResults.length, 1);
  checkOk(recoveryResults[0], "Recovery must succeed");

  const docAfter = (await env.domains.read(env.rawDoc.id)).value;
  const econAfter = tryGetDomainEconomyData(docAfter.record).value;
  const materialsAfter = econAfter.accounts.find((a) => a.resourceId === "domain-manager:materials")!.balanceMinor;
  assert.equal(materialsAfter, materialsBefore, "Materials must be refunded after recovery");

  const recoveredTx = env.transactionStore.get(repairTxId);
  assert.ok(recoveredTx);
  assert.equal(recoveredTx.state, "compensated");
});

// ---------------------------------------------------------------------------
// TEST 40: G5-REVAL4-004 & G5-REVAL4-006 Scenario D — Project start crash recovery
// ---------------------------------------------------------------------------
test("G5-REVAL4-004 & G5-REVAL4-006 Scenario D: Project start crash after upfront debit recovers cleanly via recoverAll(1)", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials"
  });

  const docBefore = (await env.domains.read(env.rawDoc.id)).value;
  const econBefore = tryGetDomainEconomyData(docBefore.record).value;
  const materialsBefore = econBefore.accounts.find((a) => a.resourceId === "domain-manager:materials")!.balanceMinor;

  const projectId = "prj-crash-test-1";
  const startTxId = "tx_simulated_prj_start_crash_1";
  const upfrontAmount = 50;

  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: -upfrontAmount,
    reason: `Cost for starting project ${projectId}`
  });

  const wfRes = await env.peopleService.allocateWorkforceReservation({
    domainUuid: env.rawDoc.uuid,
    projectId,
    amount: 2,
    workforceTypeId: "general"
  });
  checkOk(wfRes, "Reserve workforce");
  const wfResId = wfRes.value.reservationId;

  const txRecord = createTransactionRecord({
    transactionId: startTxId,
    commandId: "cmd_sim_prj_start_crash" as any,
    authorityEpoch: 1,
    lockKeys: [`domain:${env.rawDoc.id}`, `project:${projectId}`],
    recoveryData: {
      type: "projects:start",
      projectId,
      domainUuid: env.rawDoc.id,
      debitedCosts: [{ resourceId: "domain-manager:materials", amountMinor: upfrontAmount }],
      createdReservationIds: [],
      allocatedWorkforceReservationId: wfResId,
      authorityEpoch: 1,
      status: "executing"
    }
  });
  env.transactionStore.save(txRecord);
  env.transactionStore.transition(startTxId, "claimed", 1);
  env.transactionStore.transition(startTxId, "prepared", 1);
  await env.transactionStore.flush();

  const recoveryResults = await env.recoveryService.recoverAll(1);
  assert.equal(recoveryResults.length, 1);
  checkOk(recoveryResults[0], "Project start recovery must succeed");

  const docAfter = (await env.domains.read(env.rawDoc.id)).value;
  const econAfter = tryGetDomainEconomyData(docAfter.record).value;
  const materialsAfter = econAfter.accounts.find((a) => a.resourceId === "domain-manager:materials")!.balanceMinor;
  assert.equal(materialsAfter, materialsBefore, "Materials must be refunded after recovery");

  const peopleDocAfter = (await env.domains.read(env.rawDoc.id)).value;
  const peopleDataAfter = getDomainPeopleData(peopleDocAfter.record);
  const wfResAfter = peopleDataAfter.reservations.find((r) => r.id === wfResId);
  assert.equal(wfResAfter?.status, "released", "Workforce reservation must be released after recovery");

  const recoveredTx = env.transactionStore.get(startTxId);
  assert.ok(recoveredTx);
  assert.equal(recoveredTx.state, "compensated");
});

// ---------------------------------------------------------------------------
// TEST 41: G5-REVAL4-001 & G5-REVAL4-004 Scenario E — Downtime start crash recovery
// ---------------------------------------------------------------------------
test("G5-REVAL4-001 & G5-REVAL4-004 Scenario E: Downtime start crash after upfront debit recovers cleanly via recoverAll(1)", async () => {
  const env = setupTestEnvironment();
  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: 500,
    reason: "Initial materials"
  });

  const docBefore = (await env.domains.read(env.rawDoc.id)).value;
  const econBefore = tryGetDomainEconomyData(docBefore.record).value;
  const materialsBefore = econBefore.accounts.find((a) => a.resourceId === "domain-manager:materials")!.balanceMinor;

  const dtTxId = "tx_simulated_dt_start_crash_1";
  const costAmount = 10;

  await env.economyService.commitAdjust({
    domainUuid: env.rawDoc.uuid,
    resourceId: "domain-manager:materials",
    deltaMinor: -costAmount,
    reason: "Cost for starting downtime activity"
  });

  const txRecord = createTransactionRecord({
    transactionId: dtTxId,
    commandId: "cmd_sim_dt_start_crash" as any,
    authorityEpoch: 1,
    lockKeys: [`domain:${env.rawDoc.id}`],
    recoveryData: {
      type: "downtime:start",
      domainUuid: env.rawDoc.id,
      definitionId: "domain-manager:crafting",
      debitedCosts: [{ resourceId: "domain-manager:materials", amount: costAmount }],
      status: "executing"
    }
  });
  env.transactionStore.save(txRecord);
  env.transactionStore.transition(dtTxId, "claimed", 1);
  env.transactionStore.transition(dtTxId, "prepared", 1);
  await env.transactionStore.flush();

  const recoveryResults = await env.recoveryService.recoverAll(1);
  assert.equal(recoveryResults.length, 1);
  checkOk(recoveryResults[0], "Downtime start recovery must succeed");

  const docAfter = (await env.domains.read(env.rawDoc.id)).value;
  const econAfter = tryGetDomainEconomyData(docAfter.record).value;
  const materialsAfter = econAfter.accounts.find((a) => a.resourceId === "domain-manager:materials")!.balanceMinor;
  assert.equal(materialsAfter, materialsBefore, "Materials must be refunded after downtime recovery");

  const recoveredTx = env.transactionStore.get(dtTxId);
  assert.ok(recoveredTx);
  assert.equal(recoveredTx.state, "compensated");
});



