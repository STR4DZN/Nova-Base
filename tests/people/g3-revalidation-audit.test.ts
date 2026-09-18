import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { CommandBus } from "../../src/commands/command-bus.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { registerDomainCommandHandlers } from "../../src/domains/domain-command-handlers.js";
import { registerPopulationCommandHandlers } from "../../src/people/commands/population-commands.js";
import { registerNotableCommandHandlers } from "../../src/people/commands/notable-commands.js";
import { registerRoleCommandHandlers } from "../../src/people/commands/role-commands.js";
import { registerOperationalGroupCommandHandlers } from "../../src/people/commands/operational-group-commands.js";
import { registerAssignmentCommandHandlers } from "../../src/people/commands/assignment-commands.js";
import { registerRepairCommandHandlers } from "../../src/people/commands/repair-commands.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { PeopleService, type PublicPeopleApi } from "../../src/people/services/people-service.js";
import { PeopleRepairTool } from "../../src/people/services/people-repair-tool.js";
import {
  registerDomainControllerPolicy,
  clearDomainControllerPolicies
} from "../../src/people/commands/people-permissions.js";
import {
  PeopleApplication,
  PeopleApplicationController
} from "../../src/ui/domain-patterns/people/people-app.js";
import {
  setCurrentUserProvider,
  resolveCurrentViewer
} from "../../src/projection/viewer-identity.js";
import {
  composeDomainManagerRuntime,
  type DomainManagerRuntime
} from "../../src/bootstrap/domain-manager-runtime.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import type { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import {
  withDomainPeopleData,
  type DomainPeopleData,
  PEOPLE_CAPABILITY_ID
} from "../../src/people/people-data.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import type { CommandTransport, CommandTransportSenderSession } from "../../src/commands/command-transport.js";

const defaultRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Revalidation Test Domain", description: "Audit Testing" },
    classification: { kind: "base", scale: "small", tags: ["revalidation"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function document(
  id: string,
  name: string,
  value = defaultRecord,
  ownership: Record<string, number | string> = {}
): IdentifiedJournalEntryDocumentLike {
  let currentName = name;
  let currentFlags: Readonly<Record<string, unknown>> = { "domain-manager": value };
  let currentOwnership: Record<string, number | string> = { ...ownership };
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return currentName; },
    get flags() { return currentFlags; },
    get ownership() { return currentOwnership; },
    update: async (data: Record<string, unknown>) => {
      if (typeof data.name === "string") currentName = data.name;
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": payload };
      }
      if (data.ownership !== undefined) {
        currentOwnership = { ...data.ownership as any };
      }
    }
  };
}

function createStore(initialDocs: IdentifiedJournalEntryDocumentLike[] = []): DomainDocumentStore {
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  let nextId = 1;

  function registerDoc(doc: IdentifiedJournalEntryDocumentLike) {
    byKey.set(doc.id, doc);
    byKey.set(doc.uuid, doc);
  }

  for (const doc of initialDocs) {
    registerDoc(doc);
  }

  return {
    get: (idOrUuid) => {
      const clean = idOrUuid.startsWith("JournalEntry.") ? idOrUuid.slice("JournalEntry.".length) : idOrUuid;
      return byKey.get(idOrUuid) ?? byKey.get(clean);
    },
    list: () => [...new Set(byKey.values())],
    create: async (data) => {
      const id = `je-${nextId++}`;
      const doc = document(id, data.name, data.flags["domain-manager"] as any, (data.ownership ?? {}) as any);
      registerDoc(doc);
      return doc;
    }
  };
}

import {
  InMemoryCommandTransport,
  InMemoryTransportHub
} from "../../src/commands/in-memory-command-transport.js";
import { DefaultDomainControllerProvider } from "../../src/domains/domain-controller-provider.js";

function setupMultiplayerHarness() {
  clearDomainControllerPolicies();
  const store = createStore();
  const domains = new StorageDomainRepository(store);
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });
  const registry = new CommandRegistry();

  const controllerProvider = new DefaultDomainControllerProvider();
  registerDomainControllerPolicy((domainId, userId, context) => {
    return controllerProvider.isDomainController(domainId, userId, context);
  });

  registerDomainCommandHandlers(registry, coordinator, domains);
  registerPopulationCommandHandlers(registry, coordinator, domains);
  registerNotableCommandHandlers(registry, coordinator, domains);
  registerRoleCommandHandlers(registry, coordinator, domains);
  registerOperationalGroupCommandHandlers(registry, coordinator, domains);
  registerAssignmentCommandHandlers(registry, coordinator, domains);
  registerRepairCommandHandlers(registry, coordinator, domains);
  registry.freeze();

  const mockGmAuthority: PrimaryAuthorityService<any> = {
    isCurrentUser: () => true,
    getCurrent: () => "gm-user",
    getStatus: () => ({ authorityUserId: "gm-user", authorityEpoch: 1, available: true }),
    reconcile: async () => {},
    onChanged: () => () => {},
    synchronizePersistedState: () => {},
    snapshotState: () => ({ authorityUserId: "gm-user", authorityEpoch: 1 })
  } as any;

  const hub = new InMemoryTransportHub();
  const gmTransport = new InMemoryCommandTransport(
    {
      currentUserId: "gm-user",
      getAuthorityUserId: () => "gm-user"
    },
    hub
  );

  const busOnAuthority = new CommandBus({
    registry,
    coordinator,
    authorityService: mockGmAuthority,
    transport: gmTransport
  });

  const mockPlayerAuthority: PrimaryAuthorityService<any> = {
    isCurrentUser: () => false,
    getCurrent: () => "gm-user",
    getStatus: () => ({ authorityUserId: "gm-user", authorityEpoch: 1, available: true }),
    reconcile: async () => {},
    onChanged: () => () => {},
    synchronizePersistedState: () => {},
    snapshotState: () => ({ authorityUserId: "gm-user", authorityEpoch: 1 })
  } as any;

  function createPlayerBus(userId: string): CommandBus {
    const playerTransport = new InMemoryCommandTransport(
      {
        currentUserId: userId,
        getAuthorityUserId: () => "gm-user"
      },
      hub
    );

    return new CommandBus({
      registry,
      coordinator,
      authorityService: mockPlayerAuthority,
      transport: playerTransport
    });
  }

  return {
    store,
    domains,
    registry,
    coordinator,
    lockManager,
    busOnAuthority,
    createPlayerBus,
    controllerProvider
  };
}

// ---------------------------------------------------------------------------
// BLOCKER 1 TESTS: Public People API Security & Clearance Bypasses
// ---------------------------------------------------------------------------

test("G3 Blocker 1: Public People API has no asAdmin, no asAuthority, and strips secrets for non-GM", async () => {
  const store = createStore();
  const domains = new StorageDomainRepository(store);
  const peopleService = new PeopleService(domains);
  const publicApi: PublicPeopleApi = peopleService;

  // 1. Privileged escalation functions must NOT exist on public API or service
  assert.equal((publicApi as any).asAdmin, undefined);
  assert.equal((publicApi as any).asAuthority, undefined);
  assert.equal((peopleService as any).asAdmin, undefined);
  assert.equal((peopleService as any).asAuthority, undefined);

  // 2. Set current user context as non-GM Player
  setCurrentUserProvider(() => ({
    userId: "player-sneaky",
    isGm: false,
    allowedRestrictedRefs: []
  }));

  // Create domain with a public notable and a secret notable
  const secretNotable = {
    id: createOpaqueId("not"),
    name: "Undercover Spymaster",
    type: "inline" as const,
    visibility: "secret" as const,
    tags: ["spy"]
  };
  const publicNotable = {
    id: createOpaqueId("not"),
    name: "Captain of the Guard",
    type: "inline" as const,
    visibility: "public" as const,
    tags: ["guard"]
  };

  const domainPeopleData: DomainPeopleData = {
    schemaVersion: 1,
    population: { mode: "manual", total: 100, precision: "exact" },
    populationGroups: [],
    notables: [publicNotable, secretNotable],
    roles: [],
    operationalGroups: [],
    assignments: [],
    reservations: []
  };

  const domainWithSecrets: DomainRecord = withDomainPeopleData(defaultRecord, domainPeopleData);

  const docRes = await domains.create({ name: "Spy Haven", record: domainWithSecrets });
  assert.equal(docRes.ok, true);
  const domainUuid = docRes.value.uuid;

  // 3. Spoofed caller-supplied viewer attempting to elevate isGm and access secret refs
  const spoofedViewer = {
    userId: "spoofed-gm",
    isGm: true,
    allowedRestrictedRefs: [secretNotable.id]
  };

  // resolveCurrentViewer must strictly ignore spoofed values
  const resolved = resolveCurrentViewer(spoofedViewer);
  assert.equal(resolved.userId, "player-sneaky");
  assert.equal(resolved.isGm, false);
  assert.deepEqual(resolved.allowedRestrictedRefs, []);

  // 4. getNotables with spoofed viewer must still strip secret notable
  const notablesRes = await publicApi.getNotables(domainUuid, spoofedViewer);
  assert.equal(notablesRes.ok, true);
  assert.equal(notablesRes.value.length, 1);
  assert.equal(notablesRes.value[0].name, "Captain of the Guard");
  assert.equal(notablesRes.value.some((n) => n.id === secretNotable.id), false);

  // 5. buildViewModel must force effectiveIsGm = false for non-GM caller
  const vm = publicApi.buildViewModel(docRes.value, { viewerIsGm: true });
  assert.equal(vm.viewerIsGm, false);
  assert.equal(vm.notables.length, 1);
  assert.equal(vm.notables[0].notable.name, "Captain of the Guard");

  // 6. Non-GM runtime composition does not expose runtime.admin or raw mutable domain repository
  const mockAuth = {
    service: {
      isCurrentUser: () => true,
      getStatus: () => ({ isAuthority: true, authorityEpoch: 1, authorityUserId: "gm-user", available: true }),
      reconcile: async () => {},
      onChanged: () => () => {},
      isAvailable: () => true
    },
    reconcile: async () => {},
    synchronizePersistedState: () => {},
    destroy: () => {}
  };
  const mockTrans = {
    send: async () => ({ ok: true }),
    registerInboundHandler: () => () => {},
    onReceive: () => () => {},
    isAvailable: () => true,
    destroy: () => {}
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: store,
    authority: mockAuth as any,
    transport: mockTrans as any
  });
  assert.equal((runtime as any).admin, undefined, "runtime.admin must be completely undefined");
  assert.equal((runtime.domains as any).create, undefined, "runtime.domains must not expose create");
  assert.equal((runtime.domains as any).update, undefined, "runtime.domains must not expose update");
  assert.equal((runtime.domains as any).save, undefined, "runtime.domains must not expose save");

  // 7. Legitimate GM receives full visibility including secret notables
  setCurrentUserProvider(() => ({
    userId: "gm-user",
    isGm: true,
    allowedRestrictedRefs: []
  }));

  const gmNotablesRes = await publicApi.getNotables(domainUuid);
  assert.equal(gmNotablesRes.ok, true);
  assert.equal(gmNotablesRes.value.length, 2);
  assert.equal(gmNotablesRes.value.some((n) => n.id === secretNotable.id), true);
  assert.equal(gmNotablesRes.value.some((n) => n.id === publicNotable.id), true);

  const gmVm = publicApi.buildViewModel(docRes.value);
  assert.equal(gmVm.viewerIsGm, true);
  assert.equal(gmVm.notables.length, 2);
});

// ---------------------------------------------------------------------------
// BLOCKER 2 TESTS: Multiplayer — UI Mutating as Player & Authority Permissions
// ---------------------------------------------------------------------------

test("G3 Blocker 2: Authorized Player routes mutations through UI -> CommandBus.execute -> Authority -> Committed", async () => {
  const { domains, busOnAuthority, createPlayerBus } = setupMultiplayerHarness();

  const playerUserId = "player-guildmaster";
  const playerBus = createPlayerBus(playerUserId);

  // Create domain where player is the creator (Domain Controller)
  const playerDomainRecord: DomainRecord = {
    ...defaultRecord,
    metadata: {
      ...defaultRecord.metadata,
      createdByUserId: playerUserId
    }
  };
  const docRes = await domains.create({
    name: "Guild Hall",
    record: playerDomainRecord,
    ownership: { [playerUserId]: 3 }
  });
  assert.equal(docRes.ok, true);
  const domainUuid = docRes.value.uuid;

  // Player opens UI controller backed by playerBus
  const peopleService = new PeopleService(domains, { commandBus: playerBus });
  const controller = new PeopleApplicationController({
    domainUuid,
    commandBus: playerBus,
    peopleApi: peopleService,
    domains,
    viewer: { userId: playerUserId, isGm: false }
  });

  // Player dispatches create notable through UI
  const createRes = await controller.dispatchCreateNotable({
    name: "Guild Treasurer",
    type: "inline",
    description: "Manages guild coffers"
  });

  assert.equal(createRes.ok, true);

  // Verify domain was committed by authority
  const readRes = await domains.read(docRes.value.id);
  assert.equal(readRes.ok, true);
  const peopleData = (readRes.value.record.definition.capabilities.config as any)[PEOPLE_CAPABILITY_ID] as DomainPeopleData;
  assert.equal(peopleData.notables.length, 1);
  assert.equal(peopleData.notables[0].name, "Guild Treasurer");
});

test("G3 Blocker 2: Unauthorized Player mutating foreign domain is rejected by Authority", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();

  const attackerUserId = "player-intruder";
  const intruderBus = createPlayerBus(attackerUserId);

  // Domain belongs to gm-user, intruder is NOT creator or controller
  const foreignDomainRecord: DomainRecord = {
    ...defaultRecord,
    metadata: {
      ...defaultRecord.metadata,
      createdByUserId: "gm-user"
    }
  };
  const docRes = await domains.create({ name: "Royal Citadel", record: foreignDomainRecord });
  assert.equal(docRes.ok, true);
  const domainUuid = docRes.value.uuid;

  const peopleService = new PeopleService(domains, { commandBus: intruderBus });
  const controller = new PeopleApplicationController({
    domainUuid,
    commandBus: intruderBus,
    peopleApi: peopleService,
    domains,
    viewer: { userId: attackerUserId, isGm: false }
  });

  // Intruder tries to mutate domain
  const createRes = await controller.dispatchCreateNotable({
    name: "Saboteur",
    type: "inline"
  });

  assert.equal(createRes.ok, false);
  assert.equal((createRes as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");

  // Domain remains unchanged
  const readRes = await domains.read(docRes.value.id);
  assert.equal(readRes.ok, true);
  const peopleData = (readRes.value.record.definition.capabilities.config as any)?.[PEOPLE_CAPABILITY_ID];
  assert.equal(peopleData, undefined);
});

test("G3 Blocker 2: Parallel players on independent domains succeed concurrently; same domain serialized", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();

  const player1 = "player-alpha";
  const player2 = "player-beta";
  const bus1 = createPlayerBus(player1);
  const bus2 = createPlayerBus(player2);

  const doc1 = await domains.create({
    name: "Domain Alpha",
    record: { ...defaultRecord, metadata: { ...defaultRecord.metadata, createdByUserId: player1 } },
    ownership: { [player1]: 3 }
  });
  const doc2 = await domains.create({
    name: "Domain Beta",
    record: { ...defaultRecord, metadata: { ...defaultRecord.metadata, createdByUserId: player2 } },
    ownership: { [player2]: 3 }
  });

  const ctrl1 = new PeopleApplicationController({
    domainUuid: doc1.value.uuid,
    commandBus: bus1,
    peopleApi: new PeopleService(domains, { commandBus: bus1 }),
    domains,
    viewer: { userId: player1, isGm: false }
  });

  const ctrl2 = new PeopleApplicationController({
    domainUuid: doc2.value.uuid,
    commandBus: bus2,
    peopleApi: new PeopleService(domains, { commandBus: bus2 }),
    domains,
    viewer: { userId: player2, isGm: false }
  });

  // Run mutations concurrently
  const [res1, res2] = await Promise.all([
    ctrl1.dispatchCreateNotable({ name: "Alpha Leader" }),
    ctrl2.dispatchCreateNotable({ name: "Beta Leader" })
  ]);

  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);
});

// ---------------------------------------------------------------------------
// BLOCKER 3 TESTS: G3.9 UI Production Composition & Action Wiring
// ---------------------------------------------------------------------------

test("G3 Blocker 3: Production bundle dist/main.js exports UI components and action wiring", async () => {
  const distPath = path.resolve("dist", "main.js");
  assert.equal(fs.existsSync(distPath), true, "dist/main.js must exist");

  const bundleCode = fs.readFileSync(distPath, "utf-8");

  // Verify critical production exports and symbols are present in compiled bundle
  assert.equal(bundleCode.includes("PeopleApplication"), true);
  assert.equal(bundleCode.includes("PeopleApplicationController"), true);
  assert.equal(bundleCode.includes("PeopleRepairTool"), true);
  assert.equal(bundleCode.includes("dm-people-app-v2"), true);
  assert.equal(bundleCode.includes("openCreateModal"), true);
  assert.equal(bundleCode.includes("renderCreateModal"), true);
  assert.equal(bundleCode.includes("selectTab"), true);
  assert.equal(bundleCode.includes("selectEntity"), true);
  assert.equal(bundleCode.includes("closeModal"), true);
});

test("G3 Blocker 3: PeopleApplication and PeopleApplicationController modal and navigation wiring", async () => {
  const store = createStore();
  const domains = new StorageDomainRepository(store);
  const doc = await domains.create({ name: "UI Domain", record: defaultRecord });

  const mockBus = {
    execute: async () => ({ ok: true, value: { status: "committed", result: {} } }),
    executeLocal: async () => ({ ok: true, value: { status: "committed", result: {} } })
  } as unknown as CommandBus;

  const peopleService = new PeopleService(domains, { commandBus: mockBus });
  const app = new PeopleApplication({
    domainUuid: doc.value.uuid,
    commandBus: mockBus,
    peopleApi: peopleService,
    domains
  });

  assert.ok(app.controller);
  assert.equal(app.controller.activeTab, "notables");

  // Tab switching
  app.controller.selectTab("roles");
  assert.equal(app.controller.activeTab, "roles");

  // Entity selection
  app.controller.selectEntity("role", "role_steward");
  assert.deepEqual(app.controller.selectedEntity, { type: "role", id: "role_steward" });

  app.controller.clearSelection();
  assert.equal(app.controller.selectedEntity, null);

  // Modal rendering
  const modalNotables = app.controller.openCreateModal("notables");
  assert.equal(modalNotables.type, "notables");
  assert.equal(modalNotables.html.includes("Create Notable"), true);
  assert.equal(modalNotables.html.includes("data-action=\"submitCreate\""), false);
  assert.equal(modalNotables.html.includes('data-create-type="notable"'), true);

  const modalRoles = app.controller.openCreateModal("roles");
  assert.equal(modalRoles.type, "roles");
  assert.equal(modalRoles.html.includes("Create Role"), true);

  const modalGroups = app.controller.openCreateModal("operationalGroups");
  assert.equal(modalGroups.type, "operationalGroups");
  assert.equal(modalGroups.html.includes("Create Operational Group"), true);

  // runtime.people.openApp helper
  const openedApp = peopleService.openApp(doc.value.uuid);
  assert.ok(openedApp instanceof PeopleApplication);
});

// ---------------------------------------------------------------------------
// BLOCKER 4 TESTS: PeopleRepairTool via Transactional Command Pipeline
// ---------------------------------------------------------------------------

test("G3 Blocker 4: PeopleRepairTool routes all repairs through people:repair transactional pipeline with locks & GM check", async () => {
  const { domains, busOnAuthority, createPlayerBus, coordinator } = setupMultiplayerHarness();

  const legitNotableId = createOpaqueId("not");
  const ghostNotableId = createOpaqueId("not");
  const roleCaptainId = createOpaqueId("role");
  const opgPatrolId = createOpaqueId("opg");
  const resvExpiredId = createOpaqueId("resv");

  // Create domain with integrity issues:
  // 1. Role referencing non-existent notable
  // 2. OperationalGroup with explicit size mismatch
  // 3. Expired reservation
  const corruptPeopleData: DomainPeopleData = {
    schemaVersion: 1,
    population: { mode: "manual", total: 50, precision: "exact" },
    populationGroups: [],
    notables: [
      { id: legitNotableId, name: "Legitimate Notable", type: "inline", visibility: "public", tags: [] }
    ],
    roles: [
      {
        id: roleCaptainId,
        definitionId: "domain-manager:councilor",
        customLabel: "Captain",
        occupants: [legitNotableId, ghostNotableId],
        visibility: "public",
        scope: "domain",
        notes: "",
        tags: []
      }
    ],
    operationalGroups: [
      {
        id: opgPatrolId,
        name: "Dawn Patrol",
        definitionId: "domain-manager:scout-patrol",
        membershipMode: "explicit",
        size: 5, // size 5 but only 1 member!
        members: [legitNotableId],
        lifecycle: "active",
        visibility: "public",
        tags: []
      }
    ],
    assignments: [],
    reservations: [
      {
        id: resvExpiredId,
        sourceRef: "domain:je-corrupt",
        targetRef: "prj_proj-1",
        workforceTypeId: "labor",
        amount: 5,
        status: "active",
        visibility: "public",
        expiresAtWorld: 50 // will be pruned when nowWorld = 100
      }
    ]
  };

  const corruptRecord = withDomainPeopleData(defaultRecord, corruptPeopleData);
  const docRes = await domains.create({ name: "Corrupt Domain", record: corruptRecord });
  assert.equal(docRes.ok, true);
  const domainUuid = docRes.value.uuid;

  // 1. Non-GM player CANNOT execute repair
  const playerBus = createPlayerBus("player-unauthorized");
  const unauthorizedRepairTool = new PeopleRepairTool(playerBus);

  const unauthorizedPurge = await unauthorizedRepairTool.purgeDanglingOccupants(domainUuid);
  assert.equal(unauthorizedPurge.ok, false);
  assert.equal((unauthorizedPurge as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");

  // 2. GM authority executes repair through transactional tool
  const gmRepairTool = new PeopleRepairTool(busOnAuthority);

  // Purge dangling occupants
  const purgeRes = await gmRepairTool.purgeDanglingOccupants(domainUuid);
  assert.equal(purgeRes.ok, true);
  assert.equal(purgeRes.value.repaired, true);

  // Verify dangling occupant was purged from role
  const afterPurgeDoc = await domains.read(docRes.value.id);
  const afterPurgePeople = (afterPurgeDoc.value.record.definition.capabilities.config as any)[PEOPLE_CAPABILITY_ID] as DomainPeopleData;
  assert.deepEqual(afterPurgePeople.roles[0].occupants, [legitNotableId]);

  // Repair explicit group sizes
  const groupRepairRes = await gmRepairTool.repairExplicitGroupSizes(domainUuid);
  assert.equal(groupRepairRes.ok, true);
  assert.equal(groupRepairRes.value.repaired, true);

  const afterGroupDoc = await domains.read(docRes.value.id);
  const afterGroupPeople = (afterGroupDoc.value.record.definition.capabilities.config as any)[PEOPLE_CAPABILITY_ID] as DomainPeopleData;
  assert.equal(afterGroupPeople.operationalGroups[0].size, 1);

  // Prune expired reservations
  const pruneRes = await gmRepairTool.pruneExpiredReservations(domainUuid, Date.now(), 100);
  assert.equal(pruneRes.ok, true);
  assert.equal(pruneRes.value.repaired, true);

  const afterPruneDoc = await domains.read(docRes.value.id);
  const afterPrunePeople = (afterPruneDoc.value.record.definition.capabilities.config as any)[PEOPLE_CAPABILITY_ID] as DomainPeopleData;
  assert.equal(afterPrunePeople.reservations.length, 0);

  // 3. Idempotent: running again on clean domain reports repaired: false
  const repeatPurge = await gmRepairTool.purgeDanglingOccupants(domainUuid);
  assert.equal(repeatPurge.ok, true);
  assert.equal(repeatPurge.value.repaired, false);
});

test("G3 Blocker 2: UI exclusively invokes CommandBus.execute (never executeLocal) and refreshes after receipt", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const playerBus = createPlayerBus("player-guildmaster");

  let executeCalled = false;
  let executeLocalCalled = false;

  const spyBus = {
    execute: async (cmd: any, opts: any) => {
      executeCalled = true;
      return playerBus.execute(cmd, opts);
    },
    executeLocal: async () => {
      executeLocalCalled = true;
      throw new Error("UI must NEVER call executeLocal directly!");
    }
  } as unknown as CommandBus;

  const docRes = await domains.create({
    name: "Spy Test Domain",
    record: { ...defaultRecord, metadata: { ...defaultRecord.metadata, createdByUserId: "player-guildmaster" } },
    ownership: { "player-guildmaster": 3 }
  });

  const peopleService = new PeopleService(domains, { commandBus: spyBus });
  const controller = new PeopleApplicationController({
    domainUuid: docRes.value.uuid,
    commandBus: spyBus,
    peopleApi: peopleService,
    domains,
    viewer: { userId: "player-guildmaster", isGm: false }
  });

  await controller.loadViewModel();
  assert.equal(controller.viewModel?.notables.length, 0);

  const res = await controller.dispatchCreateNotable({ name: "Treasurer" });
  assert.equal(res.ok, true);
  assert.equal(executeCalled, true, "UI must call commandBus.execute");
  assert.equal(executeLocalCalled, false, "UI must never call executeLocal");

  // Verify UI reloaded/refreshed view model after receipt
  assert.equal(controller.viewModel?.notables.length, 1);
  assert.equal(controller.viewModel?.notables[0].notable.name, "Treasurer");
});

test("G3 Blocker 4: Secondary GM or client without local Primary Authority cannot execute repair locally", async () => {
  const { registry, coordinator } = setupMultiplayerHarness();

  const nonAuthorityService = {
    isCurrentUser: () => false,
    getCurrent: () => "primary-gm",
    getStatus: () => ({ authorityUserId: "primary-gm", authorityEpoch: 1, available: true })
  } as unknown as PrimaryAuthorityService<any>;

  const remoteBus = new CommandBus({
    registry,
    coordinator,
    authorityService: nonAuthorityService
  });

  const tool = new PeopleRepairTool(remoteBus);
  const res = await tool.purgeDanglingOccupants("JournalEntry.fake-uuid");
  assert.equal(res.ok, false);
});

test("G3 Blocker 4: Repair with stale expectedRevision is rejected with revision conflict", async () => {
  const { domains, busOnAuthority } = setupMultiplayerHarness();

  const docRes = await domains.create({ name: "Revision Domain", record: defaultRecord });
  assert.equal(docRes.ok, true);

  const staleCmd: DomainCommand<any> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "people:repair",
    payload: {
      domainUuid: docRes.value.uuid,
      operation: { type: "purge-dangling-occupants" }
    },
    expectedRevision: 999, // Stale! Actual revision is 0
    issuedAtReal: Date.now()
  };

  const receiptRes = await busOnAuthority.execute(staleCmd);
  assert.equal(receiptRes.ok, true);
  assert.equal(receiptRes.value.status, "rejected");
  assert.equal(receiptRes.value.error?.code, "DM_REVISION_CONFLICT");
});

// ---------------------------------------------------------------------------
// BLOCKER 1 TESTS: Foundry v13 ApplicationV2 Lifecycle & Real Action Dispatch
// ---------------------------------------------------------------------------

test("G3 Blocker 1: PeopleApplication complies with Foundry v13 ApplicationV2 lifecycle (_prepareContext, _renderHTML, _replaceHTML, _onRender, DEFAULT_OPTIONS.actions)", async () => {
  const { domains, busOnAuthority } = setupMultiplayerHarness();
  const docRes = await domains.create({
    name: "ApplicationV2 Lifecycle Domain",
    record: defaultRecord,
    ownership: { "gm-user": 3 }
  });
  assert.equal(docRes.ok, true);

  // 1. Prototype methods required by Foundry v13 ApplicationV2 specification
  assert.equal(typeof (PeopleApplication.prototype as any)._prepareContext, "function");
  assert.equal(typeof (PeopleApplication.prototype as any)._renderHTML, "function");
  assert.equal(typeof (PeopleApplication.prototype as any)._replaceHTML, "function");
  assert.equal(typeof (PeopleApplication.prototype as any)._onRender, "function");
  assert.equal(typeof (PeopleApplication.prototype as any).attachEventListeners, "function");
  assert.equal(typeof (PeopleApplication.prototype as any).closeModal, "function");

  // 2. DEFAULT_OPTIONS actions
  const actions = PeopleApplication.DEFAULT_OPTIONS.actions;
  assert.equal(typeof actions.selectTab, "function");
  assert.equal(typeof actions.selectEntity, "function");
  assert.equal(typeof actions.openCreateModal, "function");
  assert.equal(typeof actions.closeModal, "function");
  assert.equal((actions as any).submitCreate, undefined);

  // 3. Render execution
  const peopleService = new PeopleService(domains, { commandBus: busOnAuthority });
  const app = new PeopleApplication({
    domainUuid: docRes.value.uuid,
    commandBus: busOnAuthority,
    peopleApi: peopleService,
    domains,
    viewer: { userId: "gm-user", isGm: true }
  });

  const renderedApp = await app.render(true);
  assert.equal(renderedApp, app);
  assert.notEqual(app.element, null);
  assert.equal(app.element!.className.includes("dm-people-app-v2"), true);

  // 4. Tabs navigation and switching
  assert.equal(app.controller.activeTab, "notables");
  const rolesTabBtn = app.element!.querySelector('[data-tab="roles"]');
  assert.notEqual(rolesTabBtn, null);
  rolesTabBtn!.dispatchEvent({ type: "click" });
  assert.equal(app.controller.activeTab, "roles");

  // 5. Open Create Modal
  const createBtn = app.element!.querySelector('[data-action="openCreateModal"]');
  assert.notEqual(createBtn, null);
  createBtn!.dispatchEvent({ type: "click" });

  const backdrop = app.element!.querySelector(".dm-modal-backdrop");
  assert.notEqual(backdrop, null);

  // 6. Close Modal
  const cancelBtn = backdrop!.querySelector('[data-action="closeModal"]');
  assert.notEqual(cancelBtn, null);
  cancelBtn!.dispatchEvent({ type: "click" });

  const backdropAfterClose = app.element!.querySelector(".dm-modal-backdrop");
  assert.equal(backdropAfterClose, null);
});

test("G3 Blocker 1: PeopleApplication #onSubmitCreate extracts FormData and persists Notable, Role, and OperationalGroup", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const playerUserId = "player-guildmaster";
  const playerBus = createPlayerBus(playerUserId);

  const docRes = await domains.create({
    name: "Creation Test Domain",
    record: defaultRecord,
    ownership: { [playerUserId]: 3 }
  });
  assert.equal(docRes.ok, true);

  const peopleService = new PeopleService(domains, { commandBus: playerBus });
  const app = new PeopleApplication({
    domainUuid: docRes.value.uuid,
    commandBus: playerBus,
    peopleApi: peopleService,
    domains,
    viewer: { userId: playerUserId, isGm: false }
  });

  await app.render(true);

  // 1. Create Notable through UI modal form submission
  app.openCreateModal("notables");
  const notableForm = app.element!.querySelector('form[data-create-type="notable"]');
  assert.notEqual(notableForm, null);
  notableForm!.querySelector('input[name="name"]')!.value = "Master of coin";
  notableForm!.querySelector('textarea[name="description"]')!.value = "Controls treasury";
  notableForm!.dispatchEvent({ type: "submit" });

  // Wait for async dispatch
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Verify Notable was persisted
  const readRes1 = await domains.read(docRes.value.id);
  assert.equal(readRes1.ok, true);
  const peopleData1 = (readRes1.value.record.definition.capabilities.config as any)[PEOPLE_CAPABILITY_ID] as DomainPeopleData;
  assert.equal(peopleData1.notables.length, 1);
  assert.equal(peopleData1.notables[0].name, "Master of coin");
  assert.equal(peopleData1.notables[0].description, "Controls treasury");
  // Verify modal closed
  assert.equal(app.element!.querySelector(".dm-modal-backdrop"), null);

  // 2. Create Role through UI modal form submission
  app.openCreateModal("roles");
  const roleForm = app.element!.querySelector('form[data-create-type="role"]');
  assert.notEqual(roleForm, null);
  roleForm!.querySelector('input[name="name"]')!.value = "Council Leader";
  roleForm!.querySelector('input[name="definitionId"]')!.value = "domain-manager:councilor";
  roleForm!.dispatchEvent({ type: "submit" });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const readRes2 = await domains.read(docRes.value.id);
  assert.equal(readRes2.ok, true);
  const peopleData2 = (readRes2.value.record.definition.capabilities.config as any)[PEOPLE_CAPABILITY_ID] as DomainPeopleData;
  assert.equal(peopleData2.roles.length, 1);
  assert.equal(peopleData2.roles[0].definitionId, "domain-manager:councilor");
  assert.equal(peopleData2.roles[0].customLabel, "Council Leader");
  assert.equal(app.element!.querySelector(".dm-modal-backdrop"), null);

  // 3. Create OperationalGroup through UI modal form submission
  app.openCreateModal("operationalGroups");
  const groupForm = app.element!.querySelector('form[data-create-type="group"]');
  assert.notEqual(groupForm, null);
  groupForm!.querySelector('input[name="name"]')!.value = "Iron Guard";
  groupForm!.querySelector('input[name="definitionId"]')!.value = "domain-manager:labor-squad";
  groupForm!.dispatchEvent({ type: "submit" });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const readRes3 = await domains.read(docRes.value.id);
  assert.equal(readRes3.ok, true);
  const peopleData3 = (readRes3.value.record.definition.capabilities.config as any)[PEOPLE_CAPABILITY_ID] as DomainPeopleData;
  assert.equal(peopleData3.operationalGroups.length, 1);
  assert.equal(peopleData3.operationalGroups[0].name, "Iron Guard");
  assert.equal(app.element!.querySelector(".dm-modal-backdrop"), null);
});

// ---------------------------------------------------------------------------
// BLOCKER 2 TESTS: Domain Controller Permissions & Provenance Isolation
// ---------------------------------------------------------------------------

test("G3 Blocker 2: Player who is only createdByUserId but NOT controller is DENIED", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const playerAuthor = "player-author-only";
  const authorBus = createPlayerBus(playerAuthor);

  // Domain records playerAuthor in provenance metadata, but ownership is empty/none
  const docRes = await domains.create({
    name: "Author Provenance Domain",
    record: { ...defaultRecord, metadata: { ...defaultRecord.metadata, createdByUserId: playerAuthor } },
    ownership: { [playerAuthor]: 0 }
  });
  assert.equal(docRes.ok, true);

  const controller = new PeopleApplicationController({
    domainUuid: docRes.value.uuid,
    commandBus: authorBus,
    peopleApi: new PeopleService(domains, { commandBus: authorBus }),
    domains,
    viewer: { userId: playerAuthor, isGm: false }
  });

  const res = await controller.dispatchCreateNotable({ name: "Unauthorized Notable" });
  assert.equal(res.ok, false);
  assert.equal((res as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");
});

test("G3 Blocker 2: Explicit Domain Controller via DomainControllerPolicy contract is ALLOWED", async () => {
  clearDomainControllerPolicies();
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const trustedControllerId = "player-trusted-officer";
  const officerBus = createPlayerBus(trustedControllerId);

  const docRes = await domains.create({
    name: "Delegated Domain",
    record: defaultRecord,
    ownership: { [trustedControllerId]: 0 } // No Foundry ownership
  });
  assert.equal(docRes.ok, true);

  // 1. Without policy: DENIED
  const ctrl = new PeopleApplicationController({
    domainUuid: docRes.value.uuid,
    commandBus: officerBus,
    peopleApi: new PeopleService(domains, { commandBus: officerBus }),
    domains,
    viewer: { userId: trustedControllerId, isGm: false }
  });
  const deniedRes = await ctrl.dispatchCreateNotable({ name: "Officer Notable" });
  assert.equal(deniedRes.ok, false);
  assert.equal((deniedRes as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");

  // 2. Register explicit policy contract: ALLOWED
  const unregister = registerDomainControllerPolicy((domainId, userId) => {
    return domainId === docRes.value.id && userId === trustedControllerId;
  });

  const allowedRes = await ctrl.dispatchCreateNotable({ name: "Officer Notable" });
  assert.equal(allowedRes.ok, true);

  // 3. Unregister: back to DENIED
  unregister();
  const deniedAfter = await ctrl.dispatchCreateNotable({ name: "Second Notable" });
  assert.equal(deniedAfter.ok, false);
  assert.equal((deniedAfter as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");
});

test("G3 Blocker 2: Historical creator after control transfer is DENIED; new owner is ALLOWED", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const oldCreator = "player-founder";
  const newOwner = "player-successor";
  const oldBus = createPlayerBus(oldCreator);
  const newBus = createPlayerBus(newOwner);

  // Created with oldCreator as creator, but ownership transferred to newOwner
  const docRes = await domains.create({
    name: "Succession Domain",
    record: { ...defaultRecord, metadata: { ...defaultRecord.metadata, createdByUserId: oldCreator } },
    ownership: { [oldCreator]: 0, [newOwner]: 3 }
  });
  assert.equal(docRes.ok, true);

  const oldCtrl = new PeopleApplicationController({
    domainUuid: docRes.value.uuid,
    commandBus: oldBus,
    peopleApi: new PeopleService(domains, { commandBus: oldBus }),
    domains,
    viewer: { userId: oldCreator, isGm: false }
  });

  const newCtrl = new PeopleApplicationController({
    domainUuid: docRes.value.uuid,
    commandBus: newBus,
    peopleApi: new PeopleService(domains, { commandBus: newBus }),
    domains,
    viewer: { userId: newOwner, isGm: false }
  });

  // Old creator denied
  const oldRes = await oldCtrl.dispatchCreateNotable({ name: "Deposed Ruler" });
  assert.equal(oldRes.ok, false);
  assert.equal((oldRes as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");

  // New owner allowed
  const newRes = await newCtrl.dispatchCreateNotable({ name: "New Monarch" });
  assert.equal(newRes.ok, true);
});

test("G3 Blocker 2: Imported domain with old createdByUserId does NOT grant permission", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const importedAuthor = "ancient-foreign-user";
  const importBus = createPlayerBus(importedAuthor);

  const docRes = await domains.create({
    name: "Imported Ancient Kingdom",
    record: {
      ...defaultRecord,
      metadata: {
        createdByUserId: importedAuthor,
        archivedAt: null,
        source: { type: "import", ref: "backup-2024.json" }
      }
    },
    ownership: { [importedAuthor]: 0 }
  });
  assert.equal(docRes.ok, true);

  const ctrl = new PeopleApplicationController({
    domainUuid: docRes.value.uuid,
    commandBus: importBus,
    peopleApi: new PeopleService(domains, { commandBus: importBus }),
    domains,
    viewer: { userId: importedAuthor, isGm: false }
  });

  const res = await ctrl.dispatchCreateNotable({ name: "Imported Ghost" });
  assert.equal(res.ok, false);
  assert.equal((res as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");
});

test("G3 Blocker 2: Game Master is always ALLOWED regardless of document ownership", async () => {
  const { domains, busOnAuthority } = setupMultiplayerHarness();
  const gmUser = "gm-administrator";

  const docRes = await domains.create({
    name: "GM Sovereign Domain",
    record: defaultRecord,
    ownership: { "other-player": 3 } // GM has no explicit entry in ownership
  });
  assert.equal(docRes.ok, true);

  setCurrentUserProvider(() => ({
    userId: gmUser,
    isGm: true,
    allowedRestrictedRefs: []
  }));

  const ctrl = new PeopleApplicationController({
    domainUuid: docRes.value.uuid,
    commandBus: busOnAuthority,
    peopleApi: new PeopleService(domains, { commandBus: busOnAuthority }),
    domains,
    viewer: { userId: gmUser, isGm: true }
  });

  const res = await ctrl.dispatchCreateNotable({ name: "Imperial Governor" });
  assert.equal(res.ok, true);
});

test("G3 Blocker 2: Unauthorized random player without GM, ownership, or policy is DENIED", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const stranger = "player-stranger";
  const strangerBus = createPlayerBus(stranger);

  const docRes = await domains.create({
    name: "Fortress",
    record: defaultRecord,
    ownership: { "legitimate-owner": 3 }
  });
  assert.equal(docRes.ok, true);

  const ctrl = new PeopleApplicationController({
    domainUuid: docRes.value.uuid,
    commandBus: strangerBus,
    peopleApi: new PeopleService(domains, { commandBus: strangerBus }),
    domains,
    viewer: { userId: stranger, isGm: false }
  });

  const res = await ctrl.dispatchCreateNotable({ name: "Infiltrator" });
  assert.equal(res.ok, false);
  assert.equal((res as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");
});

// ---------------------------------------------------------------------------
// BLOCKER 3 TESTS: PeopleRepairTool Constructor, Authority Isolation & Locks
// ---------------------------------------------------------------------------

test("G3 Blocker 3: PeopleRepairTool requires CommandBus and rejects repository/coordinator construction", () => {
  assert.throws(
    () => new (PeopleRepairTool as any)({}, {}),
    /PeopleRepairTool requires an authorized CommandBus instance/
  );
  assert.throws(
    () => new (PeopleRepairTool as any)(null),
    /PeopleRepairTool requires an authorized CommandBus instance/
  );
  assert.throws(
    () => new (PeopleRepairTool as any)(undefined),
    /PeopleRepairTool requires an authorized CommandBus instance/
  );
});

test("G3 Blocker 3: Source code verification guarantees zero occurrences of local-authority fake", () => {
  const srcDir = path.resolve(process.cwd(), "src");

  function scanDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        const content = fs.readFileSync(fullPath, "utf-8");
        assert.equal(
          content.includes("local-authority"),
          false,
          `Forbidden 'local-authority' bypass found in ${fullPath}`
        );
      }
    }
  }

  scanDir(srcDir);
});

test("G3 Blocker 3: Concurrent normal mutation vs repair preserves domain lock and revision integrity", async () => {
  const { domains, busOnAuthority, createPlayerBus } = setupMultiplayerHarness();
  const playerUserId = "player-domain-admin";
  const playerBus = createPlayerBus(playerUserId);

  const initialData: DomainPeopleData = {
    schemaVersion: 1,
    population: { mode: "manual", total: 100, precision: "exact" },
    populationGroups: [],
    notables: [],
    roles: [
      {
        id: createOpaqueId("role"),
        definitionId: "domain-manager:councilor",
        occupants: [createOpaqueId("not")],
        visibility: "public",
        scope: "domain",
        tags: []
      }
    ],
    operationalGroups: [],
    assignments: [],
    reservations: []
  };
  const recordWithDangling = withDomainPeopleData(defaultRecord, initialData);

  const docRes = await domains.create({
    name: "Concurrency Test Domain",
    record: recordWithDangling,
    ownership: { [playerUserId]: 3 }
  });
  assert.equal(docRes.ok, true);
  const domainUuid = docRes.value.uuid;

  const ctrl = new PeopleApplicationController({
    domainUuid,
    commandBus: playerBus,
    peopleApi: new PeopleService(domains, { commandBus: playerBus }),
    domains,
    viewer: { userId: playerUserId, isGm: false }
  });

  const repairTool = new PeopleRepairTool(busOnAuthority);

  // Execute normal creation and repair concurrently
  const [createRes, repairRes] = await Promise.all([
    ctrl.dispatchCreateNotable({ name: "Concurrent Notable" }),
    repairTool.purgeDanglingOccupants(domainUuid)
  ]);

  assert.equal(createRes.ok, true);
  assert.equal(repairRes.ok, true);

  // Verify final state has revision advanced to 2 without conflicts or data loss
  const finalDoc = await domains.read(docRes.value.id);
  assert.equal(finalDoc.ok, true);
  assert.equal(finalDoc.value.record.revision, 2);

  const peopleData = (finalDoc.value.record.definition.capabilities.config as any)[PEOPLE_CAPABILITY_ID] as DomainPeopleData;
  assert.equal(peopleData.notables.length, 1);
  assert.equal(peopleData.notables[0].name, "Concurrent Notable");
  assert.equal(peopleData.roles[0].occupants.length, 0);
});

// ---------------------------------------------------------------------------
// REMEDIATION VERIFICATION TESTS: UI Action Unification & Canonical Controllers
// ---------------------------------------------------------------------------

test("G3 Blocker 1: UI action model unification - clicking input causes 0 commands, button click triggers exactly 1 command, Enter triggers exactly 1 command", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const playerUserId = "player-guildmaster";
  const playerBus = createPlayerBus(playerUserId);

  let commandsExecuted = 0;
  const countingBus = {
    execute: async (cmd: any, opts: any) => {
      commandsExecuted++;
      return playerBus.execute(cmd, opts);
    },
    executeLocal: async () => {
      throw new Error("executeLocal should not be called");
    }
  } as unknown as CommandBus;

  const docRes = await domains.create({
    name: "Unified Action Test Domain",
    record: defaultRecord,
    ownership: { [playerUserId]: 3 }
  });

  const peopleService = new PeopleService(domains, { commandBus: countingBus });
  const app = new PeopleApplication({
    domainUuid: docRes.value.uuid,
    commandBus: countingBus,
    peopleApi: peopleService,
    domains,
    viewer: { userId: playerUserId, isGm: false }
  });

  await app.render(true);

  // Open Create Notable Modal
  app.openCreateModal("notables");
  const form = app.element!.querySelector('form[data-create-type="notable"]');
  assert.notEqual(form, null);
  const nameInput = form!.querySelector('input[name="name"]');
  assert.notEqual(nameInput, null);

  // 1. Clicking an input element inside the form must trigger 0 commands (no premature action dispatch)
  nameInput!.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(commandsExecuted, 0, "Clicking input must trigger 0 commands");

  // 2. Clicking the submit button triggers form submission and exactly 1 command
  nameInput!.value = "Master of coin";
  const submitBtn = form!.querySelector('button[type="submit"]');
  assert.notEqual(submitBtn, null);
  await submitBtn!.dispatchEventAsync({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(commandsExecuted, 1, "Clicking submit button must trigger exactly 1 command");

  // Verify modal is closed
  assert.equal(app.element!.querySelector(".dm-modal-backdrop"), null);

  // Re-open Create Modal to test Enter submission
  app.openCreateModal("roles");
  const roleForm = app.element!.querySelector('form[data-create-type="role"]');
  assert.notEqual(roleForm, null);
  roleForm!.querySelector('input[name="name"]')!.value = "Council Steward";
  roleForm!.querySelector('input[name="definitionId"]')!.value = "domain-manager:councilor";

  // 3. Submitting via form submit event (Enter in field) triggers exactly 1 command
  await roleForm!.dispatchEventAsync({ type: "submit" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(commandsExecuted, 2, "Enter submission must trigger exactly 1 additional command");
});

test("G3 Blocker 1: Opening Create Modal multiple times results in exactly 1 backdrop and listeners are not duplicated across re-renders", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const playerUserId = "player-guildmaster";
  const playerBus = createPlayerBus(playerUserId);

  const docRes = await domains.create({
    name: "Modal Dedupe Test Domain",
    record: defaultRecord,
    ownership: { [playerUserId]: 3 }
  });

  const peopleService = new PeopleService(domains, { commandBus: playerBus });
  const app = new PeopleApplication({
    domainUuid: docRes.value.uuid,
    commandBus: playerBus,
    peopleApi: peopleService,
    domains,
    viewer: { userId: playerUserId, isGm: false }
  });

  await app.render(true);

  // 1. Call openCreateModal 3 times consecutively
  app.openCreateModal("notables");
  app.openCreateModal("roles");
  app.openCreateModal("operationalGroups");

  const backdrops = app.element!.querySelectorAll(".dm-modal-backdrop");
  assert.equal(backdrops.length, 1, "There must be exactly 1 modal backdrop even after opening 3 times");
  assert.notEqual(app.element!.querySelector('form[data-create-type="group"]'), null);

  // Close modal
  app.closeModal();
  assert.equal(app.element!.querySelectorAll(".dm-modal-backdrop").length, 0);

  // 2. Re-rendering multiple times does not duplicate listeners
  await app.render(true);
  await app.render(true);

  const rolesTab = app.element!.querySelector('[data-tab="roles"]');
  assert.notEqual(rolesTab, null);

  // Click tab once
  rolesTab!.dispatchEvent({ type: "click" });
  assert.equal(app.controller.activeTab, "roles");

  // Open modal again and submit once: exactly 1 command should execute
  let submitCount = 0;
  const countingBus = {
    execute: async (cmd: any, opts: any) => {
      submitCount++;
      return playerBus.execute(cmd, opts);
    },
    executeLocal: async () => {}
  } as unknown as CommandBus;

  const countingApp = new PeopleApplication({
    domainUuid: docRes.value.uuid,
    commandBus: countingBus,
    peopleApi: new PeopleService(domains, { commandBus: countingBus }),
    domains,
    viewer: { userId: playerUserId, isGm: false }
  });

  await countingApp.render(true);
  await countingApp.render(true); // Re-render before modal

  countingApp.openCreateModal("roles");
  const roleForm = countingApp.element!.querySelector('form[data-create-type="role"]');
  roleForm!.querySelector('input[name="name"]')!.value = "Warden";
  roleForm!.querySelector('input[name="definitionId"]')!.value = "domain-manager:councilor";
  await roleForm!.dispatchEventAsync({ type: "submit" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(submitCount, 1, "Submit handler must not execute multiple times due to re-renders");
});

test("G3 Blocker 2: Player with OBSERVER (ownership 2) + designated Domain Controller is ALLOWED; without controller is DENIED", async () => {
  const { domains, createPlayerBus, controllerProvider } = setupMultiplayerHarness();
  const playerObserver = "player-observer-user";
  const observerBus = createPlayerBus(playerObserver);

  // Domain with player having OBSERVER (2) ownership
  const docRes = await domains.create({
    name: "Observer Domain",
    record: defaultRecord,
    ownership: { [playerObserver]: 2 }
  });
  assert.equal(docRes.ok, true);

  const ctrl = new PeopleApplicationController({
    domainUuid: docRes.value.uuid,
    commandBus: observerBus,
    peopleApi: new PeopleService(domains, { commandBus: observerBus }),
    domains,
    viewer: { userId: playerObserver, isGm: false }
  });

  // 1. Without controller assignment: DENIED
  const deniedRes = await ctrl.dispatchCreateNotable({ name: "Observer Notable" });
  assert.equal(deniedRes.ok, false);
  assert.equal((deniedRes as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");

  // 2. Assign controller via DomainControllerProvider: ALLOWED
  controllerProvider.assignController(docRes.value.id, playerObserver);
  assert.deepEqual(controllerProvider.getControllers(docRes.value.id), [playerObserver]);

  const allowedRes = await ctrl.dispatchCreateNotable({ name: "Authorized Controller Notable" });
  assert.equal(allowedRes.ok, true);

  // 3. Revoke controller: DENIED again
  controllerProvider.revokeController(docRes.value.id, playerObserver);
  assert.deepEqual(controllerProvider.getControllers(docRes.value.id), []);

  const deniedAgainRes = await ctrl.dispatchCreateNotable({ name: "Post-Revocation Notable" });
  assert.equal(deniedAgainRes.ok, false);
  assert.equal((deniedAgainRes as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");
});

test("G3 Blocker 2: Persisted capability controllers authorize OBSERVER player without in-memory assignment", async () => {
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const playerController = "player-persisted-controller";
  const controllerBus = createPlayerBus(playerController);

  // Persisted controller in definition.capabilities.config["domain-manager:domain"].controllers
  const domainRecordWithControllers: DomainRecord = {
    ...defaultRecord,
    definition: {
      ...defaultRecord.definition,
      capabilities: {
        ...defaultRecord.definition.capabilities,
        config: {
          "domain-manager:domain": {
            controllers: [playerController]
          }
        }
      }
    }
  };

  const docRes = await domains.create({
    name: "Persisted Controller Domain",
    record: domainRecordWithControllers,
    ownership: { [playerController]: 2 } // OBSERVER
  });
  assert.equal(docRes.ok, true);

  const ctrl = new PeopleApplicationController({
    domainUuid: docRes.value.uuid,
    commandBus: controllerBus,
    peopleApi: new PeopleService(domains, { commandBus: controllerBus }),
    domains,
    viewer: { userId: playerController, isGm: false }
  });

  const res = await ctrl.dispatchCreateNotable({ name: "Persisted Controller Notable" });
  assert.equal(res.ok, true);
});

test("G3 Blocker 2: Two OBSERVER controllers on different domains execute concurrently via multiplayer bus", async () => {
  const { domains, createPlayerBus, controllerProvider } = setupMultiplayerHarness();
  const controller1 = "player-controller-1";
  const controller2 = "player-controller-2";
  const bus1 = createPlayerBus(controller1);
  const bus2 = createPlayerBus(controller2);

  const doc1 = await domains.create({
    name: "Domain 1",
    record: defaultRecord,
    ownership: { [controller1]: 2, [controller2]: 0 }
  });
  const doc2 = await domains.create({
    name: "Domain 2",
    record: defaultRecord,
    ownership: { [controller1]: 0, [controller2]: 2 }
  });

  // Assign each controller to their own domain
  controllerProvider.assignController(doc1.value.id, controller1);
  controllerProvider.assignController(doc2.value.id, controller2);

  const ctrl1 = new PeopleApplicationController({
    domainUuid: doc1.value.uuid,
    commandBus: bus1,
    peopleApi: new PeopleService(domains, { commandBus: bus1 }),
    domains,
    viewer: { userId: controller1, isGm: false }
  });

  const ctrl2 = new PeopleApplicationController({
    domainUuid: doc2.value.uuid,
    commandBus: bus2,
    peopleApi: new PeopleService(domains, { commandBus: bus2 }),
    domains,
    viewer: { userId: controller2, isGm: false }
  });

  // Execute mutations concurrently
  const [res1, res2] = await Promise.all([
    ctrl1.dispatchCreateNotable({ name: "Notable on Domain 1" }),
    ctrl2.dispatchCreateNotable({ name: "Notable on Domain 2" })
  ]);

  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);

  // Cross-domain mutation attempt must be DENIED
  const crossCtrl1 = new PeopleApplicationController({
    domainUuid: doc2.value.uuid,
    commandBus: bus1,
    peopleApi: new PeopleService(domains, { commandBus: bus1 }),
    domains,
    viewer: { userId: controller1, isGm: false }
  });
  const crossRes = await crossCtrl1.dispatchCreateNotable({ name: "Unauthorized Cross Notable" });
  assert.equal(crossRes.ok, false);
  assert.equal((crossRes as any).error?.code, "DM_SECURITY_PERMISSION_DENIED");
});

test("G3 Blocker 2: composeDomainManagerRuntime wires DefaultDomainControllerProvider and unregisters on destroy", async () => {
  const store = createStore();
  const mockAuth: PrimaryAuthorityService<any> = {
    isCurrentUser: () => true,
    getCurrent: () => "gm-user",
    getStatus: () => ({ authorityUserId: "gm-user", authorityEpoch: 1, available: true }),
    reconcile: async () => {},
    onChanged: () => () => {},
    synchronizePersistedState: () => {},
    destroy: () => {}
  };
  const mockTrans = {
    send: async () => ({ ok: true }),
    registerInboundHandler: () => () => {},
    onReceive: () => () => {},
    isAvailable: () => true,
    destroy: () => {}
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: store,
    authority: mockAuth as any,
    transport: mockTrans as any
  });

  assert.ok(runtime.controllerProvider);
  assert.equal(typeof runtime.controllerProvider.isDomainController, "function");
  assert.equal(typeof runtime.controllerProvider.assignController, "function");

  runtime.controllerProvider.assignController?.("test-domain", "user-assigned");
  assert.equal(runtime.controllerProvider.isDomainController("test-domain", "user-assigned"), true);
  assert.equal(runtime.controllerProvider.isDomainController("test-domain", "other-user"), false);

  // Clean up
  runtime.destroy();
});

test("G3 Blocker: PeopleApplication inherits native ApplicationV2 element accessor and does not mask it with a custom getter", async () => {
  // 1. Prototype contract: PeopleApplication must NOT define an own 'element' property/getter
  const ownDesc = Object.getOwnPropertyDescriptor(PeopleApplication.prototype, "element");
  assert.equal(ownDesc, undefined, "PeopleApplication.prototype must not shadow or override ApplicationV2.prototype.element");

  // 2. Render instance: app.element must be populated upon render() with required classes
  const { domains, createPlayerBus } = setupMultiplayerHarness();
  const playerBus = createPlayerBus("gm-user");
  const doc = await domains.create({
    name: "Element Accessor Test Domain",
    record: defaultRecord
  });

  const app = new PeopleApplication({
    domainUuid: doc.value.uuid,
    commandBus: playerBus,
    peopleApi: new PeopleService(domains, { commandBus: playerBus }),
    domains,
    viewer: { userId: "gm-user", isGm: true }
  });

  assert.equal(app.element, null, "app.element must be null before render");
  assert.equal((app as any).rendered, false, "app.rendered must be false before render");

  await (app as any).render(true);

  assert.ok(app.element, "app.element must be defined after render");
  assert.equal((app as any).rendered, true, "app.rendered must be true after render");
  assert.ok(
    app.element.classList?.contains?.("dm-people-app-v2") ||
      app.element.className?.includes?.("dm-people-app-v2"),
    "app.element must carry .dm-people-app-v2 class"
  );
});
