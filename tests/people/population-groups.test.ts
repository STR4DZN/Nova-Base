import assert from "node:assert/strict";
import test from "node:test";
import { CommandBus } from "../../src/commands/command-bus.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { registerPopulationCommandHandlers } from "../../src/people/commands/population-commands.js";
import { registerDomainCommandHandlers } from "../../src/domains/domain-command-handlers.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { PeopleRepository } from "../../src/people/repositories/people-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import type { AuthenticatedCommandContext } from "../../src/commands/authenticated-command-context.js";
import type { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";

const defaultRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Summary", description: "Description" },
    classification: { kind: "base", scale: "small", tags: ["starter"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function createTestCommand<T>(type: string, payload: T): DomainCommand<T> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

import {
  DomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";

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

function setupTestEnvironment() {
  const registry = new CommandRegistry();
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });
  const store = createStore();
  const domains = new DomainRepository(store);

  registerDomainCommandHandlers(registry, coordinator, domains);
  registerPopulationCommandHandlers(registry, coordinator, domains);

  const mockAuthority = {
    isCurrentUser: () => true,
    getCurrent: () => "gm-user-1",
    getStatus: () => ({ authorityUserId: "gm-user-1", authorityEpoch: 1, available: true }),
  } as unknown as PrimaryAuthorityService;

  const bus = new CommandBus({
    registry,
    coordinator,
    authorityService: mockAuthority,
  });

  const peopleRepo = new PeopleRepository(domains);

  return { registry, lockManager, coordinator, domains, bus, peopleRepo };
}

test("G3.2 - Population Commands: people:set-population updates population state transactionally", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  // 1. Create a test domain
  const createRes = await domains.create({
    name: "Metropolis",
    record: defaultRecord
  });
  assert.equal(createRes.ok, true);
  const domainUuid = createRes.value.uuid;

  // 2. Dispatch people:set-population
  const envelope = createTestCommand("people:set-population", {
    domainUuid,
    population: {
      mode: "hybrid",
      total: 12000,
      precision: "estimated",
    },
  });

  const res = await bus.executeLocal(envelope);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.status, "executed");
  }

  // 3. Verify via PeopleRepository
  const popResult = await peopleRepo.getPopulation(domainUuid);
  assert.equal(popResult.ok, true);
  if (popResult.ok) {
    assert.equal(popResult.value.state.mode, "hybrid");
    assert.equal(popResult.value.state.total, 12000);
    assert.equal(popResult.value.state.precision, "estimated");
    assert.equal(popResult.value.resolution.total, 12000);
  }
});

test("G3.2 - Population Commands: Non-GM cannot modify population or create groups", async () => {
  const { domains, bus } = setupTestEnvironment();

  const createRes = await domains.create({
    name: "Colony",
    record: defaultRecord
  });
  assert.equal(createRes.ok, true);
  const domainUuid = createRes.value.uuid;

  const envelope = createTestCommand("people:set-population", {
    domainUuid,
    population: { mode: "manual", total: 50, precision: "exact" },
  });

  const inbound = {
    rawEnvelope: envelope,
    transportContext: {
      senderUserId: "player-1",
      transportName: "network" as const,
      receivedAtReal: Date.now()
    }
  };

  const res = await bus.dispatchInbound(inbound);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.status, "rejected");
    assert.equal(res.value.error?.code, "DM_SECURITY_PERMISSION_DENIED");
  }
});

test("G3.2 - Population Group Lifecycle: create, update, and delete groups transactionally", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const createRes = await domains.create({
    name: "Citadel",
    record: defaultRecord
  });
  assert.equal(createRes.ok, true);
  const domainUuid = createRes.value.uuid;

  // Set mode to sumGroups
  const setPopRes = await bus.executeLocal(
    createTestCommand("people:set-population", {
      domainUuid,
      population: { mode: "sumGroups", total: null, precision: "unknown" },
    })
  );
  assert.equal(setPopRes.ok, true);
  if (setPopRes.ok) {
    assert.equal(setPopRes.value.status, "executed");
  }

  // 1. Create Group A
  const createCmdA = createTestCommand("people:create-population-group", {
    domainUuid,
    group: {
      name: "Engineers",
      count: 150,
      includedInTotal: true,
      tags: ["tech"],
      notes: "Power plant crew",
    },
  });

  const createResA = await bus.executeLocal(createCmdA);
  assert.equal(createResA.ok, true);
  if (createResA.ok) {
    assert.equal(createResA.value.status, "executed");
  }

  // Verify group created
  const groups1 = await peopleRepo.getPopulationGroups(domainUuid);
  assert.equal(groups1.ok, true);
  if (groups1.ok) {
    assert.equal(groups1.value.length, 1);
    assert.equal(groups1.value[0].name, "Engineers");
    assert.equal(groups1.value[0].count, 150);
    assert.ok(groups1.value[0].id.startsWith("pop_"));
  }

  const groupId = (groups1.ok && groups1.value[0].id) as string;

  // 2. Create Group B (Excluded from total)
  const createCmdB = createTestCommand("people:create-population-group", {
    domainUuid,
    group: {
      name: "Contractors",
      count: 50,
      includedInTotal: false,
      tags: ["temp"],
    },
  });
  const createResB = await bus.executeLocal(createCmdB);
  assert.equal(createResB.ok, true);
  if (createResB.ok) {
    assert.equal(createResB.value.status, "executed");
  }

  // Check calculated population: should be 150 (since B is not included in total)
  const popCalc1 = await peopleRepo.getPopulation(domainUuid);
  assert.equal(popCalc1.ok, true);
  if (popCalc1.ok) {
    assert.equal(popCalc1.value.resolution.total, 150);
  }

  // 3. Update Group A count to 200
  const updateCmdA = createTestCommand("people:update-population-group", {
    domainUuid,
    groupId,
    patch: {
      count: 200,
    },
  });
  const updateResA = await bus.executeLocal(updateCmdA);
  assert.equal(updateResA.ok, true);
  if (updateResA.ok) {
    assert.equal(updateResA.value.status, "executed");
  }

  // Check updated population: should be 200
  const popCalc2 = await peopleRepo.getPopulation(domainUuid);
  assert.equal(popCalc2.ok, true);
  if (popCalc2.ok) {
    assert.equal(popCalc2.value.resolution.total, 200);
  }

  // 4. Delete Group A
  const deleteCmdA = createTestCommand("people:delete-population-group", {
    domainUuid,
    groupId,
  });
  const deleteResA = await bus.executeLocal(deleteCmdA);
  assert.equal(deleteResA.ok, true);
  if (deleteResA.ok) {
    assert.equal(deleteResA.value.status, "executed");
  }

  // Remaining groups should only be Group B
  const groupsAfter = await peopleRepo.getPopulationGroups(domainUuid);
  assert.equal(groupsAfter.ok, true);
  if (groupsAfter.ok) {
    assert.equal(groupsAfter.value.length, 1);
    assert.equal(groupsAfter.value[0].name, "Contractors");
  }

  // Population total should now be 0 since Contractors are excluded
  const popCalc3 = await peopleRepo.getPopulation(domainUuid);
  assert.equal(popCalc3.ok, true);
  if (popCalc3.ok) {
    assert.equal(popCalc3.value.resolution.total, 0);
  }
});
