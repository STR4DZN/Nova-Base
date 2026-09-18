import assert from "node:assert/strict";
import test from "node:test";
import { CommandBus } from "../../src/commands/command-bus.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { registerNotableCommandHandlers } from "../../src/people/commands/notable-commands.js";
import { registerRoleCommandHandlers } from "../../src/people/commands/role-commands.js";
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
import { evaluateRole, DEFAULT_ROLE_DEFINITIONS } from "../../src/people/roles/role-types.js";

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
  registerNotableCommandHandlers(registry, coordinator, domains);
  registerRoleCommandHandlers(registry, coordinator, domains);

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

test("G3.4 - Roles: Create role with occupants and custom label", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Kingdom of Iron", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // Create a notable to assign
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Arthur Pendelton" }
    })
  );
  const notables = (await peopleRepo.getNotables(domainUuid, { viewerIsGm: true })).value!;
  const arthurId = notables[0].id;

  // Create role
  const createCmd = createTestCommand("people:create-role", {
    domainUuid,
    role: {
      definitionId: "domain-manager:leader",
      customLabel: "High King",
      occupants: [arthurId],
      visibility: "public" as const,
      notes: "Crowned after the grand tournament"
    }
  });

  const createRes = await bus.executeLocal(createCmd);
  assert.equal(createRes.ok, true);
  if (createRes.ok) {
    assert.equal(createRes.value.status, "executed");
    const role = createRes.value.result as any;
    assert.ok(role.id.startsWith("role_"));
    assert.equal(role.definitionId, "domain-manager:leader");
    assert.equal(role.customLabel, "High King");
    assert.deepEqual(role.occupants, [arthurId]);
  }

  // Verify retrieval via PeopleRepository
  const rolesRes = await peopleRepo.getRoles(domainUuid);
  assert.equal(rolesRes.ok, true);
  if (rolesRes.ok) {
    assert.equal(rolesRes.value.length, 1);
    assert.equal(rolesRes.value[0].customLabel, "High King");
  }
});

test("G3.4 - Roles: Assign and unassign notable to a role", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Silverhold", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // Create two notables
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Advisor Bryan" }
    })
  );
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Advisor Clara" }
    })
  );
  const notables = (await peopleRepo.getNotables(domainUuid, { viewerIsGm: true })).value!;
  const bryanId = notables[0].id;
  const claraId = notables[1].id;

  // Create vacant councilor role (allows unlimited occupants)
  const roleCmd = createTestCommand("people:create-role", {
    domainUuid,
    role: {
      definitionId: "domain-manager:councilor",
      occupants: []
    }
  });
  const roleRes = await bus.executeLocal(roleCmd);
  assert.equal(roleRes.ok, true);
  const roleId = (roleRes.value as any).result.id;

  // Assign Bryan
  const assignBryan = await bus.executeLocal(
    createTestCommand("people:assign-role", {
      domainUuid,
      roleId,
      notableId: bryanId
    })
  );
  assert.equal(assignBryan.ok, true);
  assert.equal((assignBryan.value as any).status, "executed");

  // Assign Clara
  const assignClara = await bus.executeLocal(
    createTestCommand("people:assign-role", {
      domainUuid,
      roleId,
      notableId: claraId
    })
  );
  assert.equal(assignClara.ok, true);
  assert.equal((assignClara.value as any).status, "executed");

  // Verify both occupants in role
  const roleAfterAssign = (await peopleRepo.getRole(domainUuid, roleId)).value!;
  assert.deepEqual(roleAfterAssign.occupants, [bryanId, claraId]);

  // Unassign Bryan
  const unassignBryan = await bus.executeLocal(
    createTestCommand("people:unassign-role", {
      domainUuid,
      roleId,
      notableId: bryanId
    })
  );
  assert.equal(unassignBryan.ok, true);
  assert.equal((unassignBryan.value as any).status, "executed");

  // Verify only Clara remains
  const roleAfterUnassign = (await peopleRepo.getRole(domainUuid, roleId)).value!;
  assert.deepEqual(roleAfterUnassign.occupants, [claraId]);
});

test("G3.4 - Roles: Max occupancy enforcement (DEC-1005)", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Iron Citadel", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // Create two notables
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "General Max" }
    })
  );
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "General Leo" }
    })
  );
  const notables = (await peopleRepo.getNotables(domainUuid, { viewerIsGm: true })).value!;
  const maxId = notables[0].id;
  const leoId = notables[1].id;

  // Commander has max: 1
  // 1. Trying to create with 2 occupants fails
  const createExcess = await bus.executeLocal(
    createTestCommand("people:create-role", {
      domainUuid,
      role: {
        definitionId: "domain-manager:commander",
        occupants: [maxId, leoId]
      }
    })
  );
  assert.equal(createExcess.ok, true);
  if (createExcess.ok) {
    assert.equal(createExcess.value.status, "rejected");
    assert.equal(createExcess.value.error?.code, "DM_ROLE_OCCUPANCY_EXCEEDED");
  }

  // 2. Create with 1 occupant succeeds
  const createValid = await bus.executeLocal(
    createTestCommand("people:create-role", {
      domainUuid,
      role: {
        definitionId: "domain-manager:commander",
        occupants: [maxId]
      }
    })
  );
  assert.equal(createValid.ok, true);
  const roleId = (createValid.value as any).result.id;

  // 3. Trying to assign a second occupant fails
  const assignSecond = await bus.executeLocal(
    createTestCommand("people:assign-role", {
      domainUuid,
      roleId,
      notableId: leoId
    })
  );
  assert.equal(assignSecond.ok, true);
  if (assignSecond.ok) {
    assert.equal(assignSecond.value.status, "rejected");
    assert.equal(assignSecond.value.error?.code, "DM_ROLE_OCCUPANCY_EXCEEDED");
  }
});

test("G3.4 - Roles: Assignment of nonexistent notable fails with DM_NOTABLE_NOT_FOUND", async () => {
  const { domains, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Frontier Outpost", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  const createRole = await bus.executeLocal(
    createTestCommand("people:create-role", {
      domainUuid,
      role: {
        definitionId: "domain-manager:administrator",
        occupants: []
      }
    })
  );
  const roleId = (createRole.value as any).result.id;

  const fakeNotableId = "not_99999999-9999-4999-8999-999999999999";
  const assignCmd = createTestCommand("people:assign-role", {
    domainUuid,
    roleId,
    notableId: fakeNotableId
  });

  const res = await bus.executeLocal(assignCmd);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.status, "rejected");
    assert.equal(res.value.error?.code, "DM_NOTABLE_NOT_FOUND");
  }
});

test("G3.4 - Roles: Notable cannot be deleted while assigned to an active role", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Fortress", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Treasurer Midas" }
    })
  );
  const notables = (await peopleRepo.getNotables(domainUuid, { viewerIsGm: true })).value!;
  const midasId = notables[0].id;

  await bus.executeLocal(
    createTestCommand("people:create-role", {
      domainUuid,
      role: {
        definitionId: "domain-manager:treasurer",
        occupants: [midasId]
      }
    })
  );

  // Attempting to delete Midas while assigned to Treasurer must be blocked
  const deleteRes = await bus.executeLocal(
    createTestCommand("people:delete-notable", {
      domainUuid,
      notableId: midasId
    })
  );
  assert.equal(deleteRes.ok, true);
  if (deleteRes.ok) {
    assert.equal(deleteRes.value.status, "rejected");
    assert.equal(deleteRes.value.error?.code, "DM_NOTABLE_ASSIGNED_TO_ROLE");
  }
});

test("G3.4 - Roles: Delete role removes record from domain", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Redkeep", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  const roleRes = await bus.executeLocal(
    createTestCommand("people:create-role", {
      domainUuid,
      role: {
        definitionId: "domain-manager:administrator",
        occupants: []
      }
    })
  );
  const roleId = (roleRes.value as any).result.id;

  const deleteCmd = createTestCommand("people:delete-role", {
    domainUuid,
    roleId
  });
  const deleteRes = await bus.executeLocal(deleteCmd);
  assert.equal(deleteRes.ok, true);
  if (deleteRes.ok) {
    assert.equal(deleteRes.value.status, "executed");
  }

  const list = (await peopleRepo.getRoles(domainUuid)).value!;
  assert.equal(list.length, 0);
});

test("G3.4 - Roles: Non-GM remote command execution is rejected with DM_SECURITY_PERMISSION_DENIED", async () => {
  const { domains, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Bordertown", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  const cmd = createTestCommand("people:create-role", {
    domainUuid,
    role: {
      definitionId: "domain-manager:leader",
      occupants: []
    }
  });

  const inbound = {
    rawEnvelope: cmd,
    transportContext: {
      senderUserId: "player-3",
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

test("G3.4 - Roles: Secret role visibility filtering for non-GM viewers", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Shadow Keep", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  await bus.executeLocal(
    createTestCommand("people:create-role", {
      domainUuid,
      role: {
        definitionId: "domain-manager:leader",
        visibility: "public" as const,
        occupants: []
      }
    })
  );
  await bus.executeLocal(
    createTestCommand("people:create-role", {
      domainUuid,
      role: {
        definitionId: "domain-manager:administrator",
        customLabel: "Master of Spies",
        visibility: "secret" as const,
        occupants: []
      }
    })
  );

  // GM sees both
  const gmRoles = (await peopleRepo.getRoles(domainUuid, { viewerIsGm: true })).value!;
  assert.equal(gmRoles.length, 2);

  // Non-GM sees only public
  const playerRoles = (await peopleRepo.getRoles(domainUuid, { viewerIsGm: false })).value!;
  assert.equal(playerRoles.length, 1);
  assert.equal(playerRoles.some((r) => r.visibility === "secret"), false);
});

test("G3.4 - Roles: evaluateRole correctly identifies vacancy, staffing, and requirement satisfaction", () => {
  // Leader: min: 1, max: 1
  const vacantLeader = {
    id: "role_1",
    definitionId: "domain-manager:leader",
    occupants: [],
    visibility: "public" as const,
    tags: []
  };

  const evalVacant = evaluateRole(vacantLeader, DEFAULT_ROLE_DEFINITIONS);
  assert.equal(evalVacant.isVacant, true);
  assert.equal(evalVacant.isFilled, false);
  assert.equal(evalVacant.isUnderstaffed, true);
  assert.equal(evalVacant.isRequirementSatisfied, false);
  assert.equal(evalVacant.missingCount, 1);
  assert.equal(evalVacant.effectiveLabel, "Leader");

  const filledLeader = {
    id: "role_1",
    definitionId: "domain-manager:leader",
    customLabel: "High Lord",
    occupants: ["not_12345678-1234-4234-8234-123456789abc"],
    visibility: "public" as const,
    tags: []
  };

  const evalFilled = evaluateRole(filledLeader, DEFAULT_ROLE_DEFINITIONS);
  assert.equal(evalFilled.isVacant, false);
  assert.equal(evalFilled.isFilled, true);
  assert.equal(evalFilled.isUnderstaffed, false);
  assert.equal(evalFilled.isRequirementSatisfied, true);
  assert.equal(evalFilled.missingCount, 0);
  assert.equal(evalFilled.effectiveLabel, "High Lord");
});
