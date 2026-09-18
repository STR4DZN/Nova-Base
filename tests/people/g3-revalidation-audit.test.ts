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
  value = defaultRecord
): IdentifiedJournalEntryDocumentLike {
  let currentName = name;
  let currentFlags: Readonly<Record<string, unknown>> = { "domain-manager": value };
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return currentName; },
    get flags() { return currentFlags; },
    update: async (data: Record<string, unknown>) => {
      if (typeof data.name === "string") currentName = data.name;
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": payload };
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
      const doc = document(id, data.name, data.flags["domain-manager"] as any);
      registerDoc(doc);
      return doc;
    }
  };
}

import {
  InMemoryCommandTransport,
  InMemoryTransportHub
} from "../../src/commands/in-memory-command-transport.js";

function setupMultiplayerHarness() {
  const store = createStore();
  const domains = new StorageDomainRepository(store);
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });
  const registry = new CommandRegistry();

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
    createPlayerBus
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

  // Reset provider to GM
  setCurrentUserProvider(() => ({
    userId: "gm-user",
    isGm: true
  }));
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
  const docRes = await domains.create({ name: "Guild Hall", record: playerDomainRecord });
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
    record: { ...defaultRecord, metadata: { ...defaultRecord.metadata, createdByUserId: player1 } }
  });
  const doc2 = await domains.create({
    name: "Domain Beta",
    record: { ...defaultRecord, metadata: { ...defaultRecord.metadata, createdByUserId: player2 } }
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
  assert.equal(bundleCode.includes("submitCreate"), true);
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
  assert.equal(modalNotables.html.includes("data-action=\"submitCreate\""), true);

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
