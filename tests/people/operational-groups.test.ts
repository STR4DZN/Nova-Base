import assert from "node:assert/strict";
import test from "node:test";
import { CommandBus } from "../../src/commands/command-bus.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { registerNotableCommandHandlers } from "../../src/people/commands/notable-commands.js";
import { registerPopulationCommandHandlers } from "../../src/people/commands/population-commands.js";
import { registerOperationalGroupCommandHandlers } from "../../src/people/commands/operational-group-commands.js";
import { registerDomainCommandHandlers } from "../../src/domains/domain-command-handlers.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { PeopleRepository } from "../../src/people/repositories/people-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import type { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import { validateOperationalGroup } from "../../src/people/operational-groups/operational-group-types.js";

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
  const domains = new StorageDomainRepository(store);

  registerDomainCommandHandlers(registry, coordinator, domains);
  registerPopulationCommandHandlers(registry, coordinator, domains);
  registerNotableCommandHandlers(registry, coordinator, domains);
  registerOperationalGroupCommandHandlers(registry, coordinator, domains);

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

test("G3.5 - OperationalGroup: Abstract membership mode enforces size without roster", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Harbor City", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // 1. Abstract group with declared size=120 succeeds
  const cmd = createTestCommand("people:create-operational-group", {
    domainUuid,
    group: {
      name: "Dock Workers Guild",
      definitionId: "domain-manager:labor-squad",
      membershipMode: "abstract" as const,
      size: 120,
      tags: ["labor", "docks"]
    }
  });
  const res = await bus.executeLocal(cmd);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.status, "executed");
    const group = (res.value as any).result;
    assert.ok(group.id.startsWith("opg_"));
    assert.equal(group.size, 120);
    assert.equal(group.membershipMode, "abstract");
    assert.deepEqual(group.members, []);
  }

  // 2. Abstract group attempting to include members fails validation
  const invalidAbstract = validateOperationalGroup({
    id: "opg_11111111-1111-4111-8111-111111111111",
    name: "Illegal Abstract",
    definitionId: "domain-manager:labor-squad",
    membershipMode: "abstract",
    size: 10,
    members: ["not_22222222-2222-4222-8222-222222222222"]
  });
  assert.equal(invalidAbstract.ok, false);
  if (!invalidAbstract.ok) {
    assert.equal(invalidAbstract.error.code, "DM_OPG_ABSTRACT_CANNOT_HAVE_MEMBERS");
  }
});

test("G3.5 - OperationalGroup: Partial membership mode allows subset roster up to size", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Garrison Town", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // Create two notables
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Sergeant Thorne" }
    })
  );
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Corporal Vance" }
    })
  );
  const notables = (await peopleRepo.getNotables(domainUuid, { viewerIsGm: true })).value!;
  const thorneId = notables[0].id;
  const vanceId = notables[1].id;

  // 1. Partial group with size=30 and 2 known members succeeds
  const cmd = createTestCommand("people:create-operational-group", {
    domainUuid,
    group: {
      name: "3rd Garrison Unit",
      definitionId: "domain-manager:militia",
      membershipMode: "partial" as const,
      size: 30,
      members: [thorneId, vanceId],
      tags: ["defense"]
    }
  });
  const res = await bus.executeLocal(cmd);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.status, "executed");
    const group = (res.value as any).result;
    assert.equal(group.size, 30);
    assert.equal(group.members.length, 2);
  }

  // 2. Partial group with roster exceeding declared size fails validation
  const invalidPartial = validateOperationalGroup({
    id: "opg_11111111-1111-4111-8111-111111111111",
    name: "Overloaded Squad",
    definitionId: "domain-manager:militia",
    membershipMode: "partial",
    size: 1,
    members: [thorneId, vanceId]
  });
  assert.equal(invalidPartial.ok, false);
  if (!invalidPartial.ok) {
    assert.equal(invalidPartial.error.code, "DM_OPG_PARTIAL_MEMBERS_EXCEED_SIZE");
  }
});

test("G3.5 - OperationalGroup: Explicit membership mode derives size automatically from members", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Forest Fort", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // Create 3 notables
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Scout Robin" }
    })
  );
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Scout Marian" }
    })
  );
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Scout Tuck" }
    })
  );
  const notables = (await peopleRepo.getNotables(domainUuid, { viewerIsGm: true })).value!;
  const robinId = notables[0].id;
  const marianId = notables[1].id;
  const tuckId = notables[2].id;

  // 1. Create with 2 members in explicit mode (size automatically becomes 2)
  const createCmd = createTestCommand("people:create-operational-group", {
    domainUuid,
    group: {
      name: "Outrider Vanguard",
      definitionId: "domain-manager:scout-patrol",
      membershipMode: "explicit" as const,
      members: [robinId, marianId]
    }
  });
  const createRes = await bus.executeLocal(createCmd);
  assert.equal(createRes.ok, true);
  const groupId = (createRes.value as any).result.id;

  const group1 = (await peopleRepo.getOperationalGroup(domainUuid, groupId)).value!;
  assert.equal(group1.size, 2);
  assert.equal(group1.members.length, 2);

  // 2. Update to add third member (size is automatically derived to 3)
  const updateCmd = createTestCommand("people:update-operational-group", {
    domainUuid,
    groupId,
    update: {
      members: [robinId, marianId, tuckId]
    }
  });
  const updateRes = await bus.executeLocal(updateCmd);
  assert.equal(updateRes.ok, true);

  const group2 = (await peopleRepo.getOperationalGroup(domainUuid, groupId)).value!;
  assert.equal(group2.size, 3);
  assert.equal(group2.members.length, 3);
  assert.deepEqual(group2.members, [robinId, marianId, tuckId]);
});

test("G3.5 - OperationalGroup: Referential integrity with notables and population groups", async () => {
  const { domains, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Highlands", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // 1. Non-existent notable member fails with DM_NOTABLE_NOT_FOUND
  const badMemberCmd = createTestCommand("people:create-operational-group", {
    domainUuid,
    group: {
      name: "Ghost Squad",
      definitionId: "domain-manager:scout-patrol",
      membershipMode: "explicit" as const,
      members: ["not_99999999-9999-4999-8999-999999999999"]
    }
  });
  const badMemberRes = await bus.executeLocal(badMemberCmd);
  assert.equal(badMemberRes.ok, true);
  if (badMemberRes.ok) {
    assert.equal(badMemberRes.value.status, "rejected");
    assert.equal(badMemberRes.value.error?.code, "DM_NOTABLE_NOT_FOUND");
  }

  // 2. Non-existent population group fails with DM_POPULATION_GROUP_NOT_FOUND
  const badPopCmd = createTestCommand("people:create-operational-group", {
    domainUuid,
    group: {
      name: "Highland Militia",
      definitionId: "domain-manager:militia",
      membershipMode: "abstract" as const,
      size: 50,
      populationGroupId: "pop_88888888-8888-4888-8888-888888888888"
    }
  });
  const badPopRes = await bus.executeLocal(badPopCmd);
  assert.equal(badPopRes.ok, true);
  if (badPopRes.ok) {
    assert.equal(badPopRes.value.status, "rejected");
    assert.equal(badPopRes.value.error?.code, "DM_POPULATION_GROUP_NOT_FOUND");
  }
});

test("G3.5 - OperationalGroup: Secret group visibility filtering for non-GM viewers", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Citadel of Secrets", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // Public group
  await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "City Watch",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract" as const,
        size: 100,
        visibility: "public" as const
      }
    })
  );

  // Secret group
  await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "Silent Daggers",
        definitionId: "domain-manager:scout-patrol",
        membershipMode: "abstract" as const,
        size: 5,
        visibility: "secret" as const
      }
    })
  );

  // GM sees 2 groups
  const gmGroups = (await peopleRepo.getOperationalGroups(domainUuid, { viewerIsGm: true })).value!;
  assert.equal(gmGroups.length, 2);

  // Non-GM sees only 1 group (secret excluded)
  const playerGroups = (await peopleRepo.getOperationalGroups(domainUuid, { viewerIsGm: false })).value!;
  assert.equal(playerGroups.length, 1);
  assert.equal(playerGroups[0].name, "City Watch");
});

test("G3.5 - OperationalGroup: Lifecycle updates and deletion", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Port Royale", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  const createRes = await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "Royal Navy Squadron",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract" as const,
        size: 250,
        lifecycle: "active" as const
      }
    })
  );
  const groupId = (createRes.value as any).result.id;

  // Update lifecycle to disbanded
  const updateRes = await bus.executeLocal(
    createTestCommand("people:update-operational-group", {
      domainUuid,
      groupId,
      update: {
        lifecycle: "disbanded" as const
      }
    })
  );
  assert.equal(updateRes.ok, true);
  const updatedGroup = (await peopleRepo.getOperationalGroup(domainUuid, groupId)).value!;
  assert.equal(updatedGroup.lifecycle, "disbanded");

  // Delete operational group
  const deleteRes = await bus.executeLocal(
    createTestCommand("people:delete-operational-group", {
      domainUuid,
      groupId
    })
  );
  assert.equal(deleteRes.ok, true);
  if (deleteRes.ok) {
    assert.equal(deleteRes.value.status, "executed");
  }

  const list = (await peopleRepo.getOperationalGroups(domainUuid)).value!;
  assert.equal(list.length, 0);
});
