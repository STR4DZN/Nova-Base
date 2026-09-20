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
  withDomainEconomyData
} from "../../src/economy/economy-data.js";
import { ProjectsService } from "../../src/projects/services/projects-service.js";
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
import { withDomainFacilitiesData } from "../../src/facilities/facility-data.js";
import { withDomainPeopleData, createDefaultDomainPeopleData } from "../../src/people/people-data.js";
import { withDomainProjectsData } from "../../src/projects/project-data.js";
import { withDomainDowntimeData } from "../../src/downtime/downtime-data.js";
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
    economyService
  });

  const projectsService = new ProjectsService({
    domains,
    projectRegistry,
    economyService,
    facilitiesService,
    transactionStore
  });

  const downtimeService = new DowntimeService({
    domains,
    downtimeRegistry,
    economyService,
    facilitiesService
  });

  const registry = new CommandRegistry();
  registerProjectCommands({ registry, projectsService, domains, coordinator });
  registerFacilityCommands({ registry, facilitiesService, domains, coordinator });
  registerDowntimeCommands({ registry, downtimeService, domains, coordinator });

  const authorityService = new PrimaryAuthorityService(
    {
      getUsers: () => [
        { id: "gm-user", isGM: true, active: true },
        { id: "player-1", isGM: false, active: true }
      ],
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-user"
    },
    { authorityUserId: "gm-user", authorityEpoch: 1, initialized: true }
  );

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
    publicProjects,
    publicFacilities,
    publicDowntime,
    transactionStore,
    coordinator,
    commandBus,
    projectRegistry,
    facilityRegistry,
    downtimeRegistry
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
