import assert from "node:assert/strict";
import test from "node:test";
import { CommandBus } from "../../src/commands/command-bus.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { registerOperationalGroupCommandHandlers } from "../../src/people/commands/operational-group-commands.js";
import { registerAssignmentCommandHandlers } from "../../src/people/commands/assignment-commands.js";
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
  registerOperationalGroupCommandHandlers(registry, coordinator, domains);
  registerAssignmentCommandHandlers(registry, coordinator, domains);

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

test("G3.7 - Assignments: Create assignment within capacity succeeds and updates workforce", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Construction Site", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // Create an operational group of 50 general workers
  const groupRes = await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "Masons Guild",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "abstract" as const,
        size: 50
      }
    })
  );
  const groupId = (groupRes.value as any).result.id;

  // Create assignment of 30 workers
  const asgCmd = createTestCommand("people:create-assignment", {
    domainUuid,
    assignment: {
      sourceRef: groupId,
      targetRef: "prj_aqueduct",
      workforceTypeId: "general",
      amount: 30,
      notes: "Aqueduct construction"
    }
  });
  const asgRes = await bus.executeLocal(asgCmd);
  assert.equal(asgRes.ok, true);
  if (asgRes.ok) {
    assert.equal(asgRes.value.status, "executed");
    const asg = (asgRes.value as any).result;
    assert.ok(asg.id.startsWith("asg_"));
    assert.equal(asg.amount, 30);
  }

  // Check workforce report
  const wf = (await peopleRepo.getWorkforce(domainUuid)).value!;
  const general = wf.types["general"];
  assert.equal(general.capacity, 50);
  assert.equal(general.committed, 30);
  assert.equal(general.available, 20);
});

test("G3.7 - Assignments: Overcommit is blocked without explicit override (DEC-1121)", async () => {
  const { domains, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Quarry", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // Create operational group of 20 workers
  const groupRes = await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "Stonecutters",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "abstract" as const,
        size: 20
      }
    })
  );
  const groupId = (groupRes.value as any).result.id;

  // 1. Attempting to assign 25 workers (when capacity is only 20) is blocked
  const overcommitCmd = createTestCommand("people:create-assignment", {
    domainUuid,
    assignment: {
      sourceRef: groupId,
      targetRef: "prj_grand_monument",
      workforceTypeId: "general",
      amount: 25
    }
  });
  const overcommitRes = await bus.executeLocal(overcommitCmd);
  assert.equal(overcommitRes.ok, true);
  if (overcommitRes.ok) {
    assert.equal(overcommitRes.value.status, "rejected");
    assert.equal(overcommitRes.value.error?.code, "DM_WORKFORCE_OVERCOMMIT");
  }

  // 2. With explicit GM override, overcommit is permitted (DEC-1122)
  const overrideCmd = createTestCommand("people:create-assignment", {
    domainUuid,
    assignment: {
      sourceRef: groupId,
      targetRef: "prj_grand_monument",
      workforceTypeId: "general",
      amount: 25
    },
    allowOvercommit: true
  });
  const overrideRes = await bus.executeLocal(overrideCmd);
  assert.equal(overrideRes.ok, true);
  if (overrideRes.ok) {
    assert.equal(overrideRes.value.status, "executed");
  }
});

test("G3.7 - Assignments: Cancel assignment frees committed workforce (DEC-1124)", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Mine Camp", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  const groupRes = await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "Miners",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "abstract" as const,
        size: 40
      }
    })
  );
  const groupId = (groupRes.value as any).result.id;

  const asgRes = await bus.executeLocal(
    createTestCommand("people:create-assignment", {
      domainUuid,
      assignment: {
        sourceRef: groupId,
        targetRef: "prj_deep_tunnel",
        workforceTypeId: "general",
        amount: 35
      }
    })
  );
  const asgId = (asgRes.value as any).result.id;

  // Available was 5
  const wfBefore = (await peopleRepo.getWorkforce(domainUuid)).value!;
  assert.equal(wfBefore.types["general"].available, 5);

  // Cancel assignment
  const cancelRes = await bus.executeLocal(
    createTestCommand("people:cancel-assignment", {
      domainUuid,
      assignmentId: asgId
    })
  );
  assert.equal(cancelRes.ok, true);

  // Available is now 40 again
  const wfAfter = (await peopleRepo.getWorkforce(domainUuid)).value!;
  assert.equal(wfAfter.types["general"].committed, 0);
  assert.equal(wfAfter.types["general"].available, 40);
});

test("G3.7 - Reservations: Create and release workforce reservations", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Dockyards", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  const groupRes = await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "Shipwrights",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "abstract" as const,
        size: 60
      }
    })
  );
  const groupId = (groupRes.value as any).result.id;

  // Create reservation
  const resvRes = await bus.executeLocal(
    createTestCommand("people:create-reservation", {
      domainUuid,
      reservation: {
        sourceRef: groupId,
        targetRef: "prj_flagship_keel",
        workforceTypeId: "general",
        amount: 25
      }
    })
  );
  assert.equal(resvRes.ok, true);
  const resvId = (resvRes.value as any).result.id;

  const wf1 = (await peopleRepo.getWorkforce(domainUuid)).value!;
  assert.equal(wf1.types["general"].reserved, 25);
  assert.equal(wf1.types["general"].available, 35);

  // Release reservation
  const releaseRes = await bus.executeLocal(
    createTestCommand("people:release-reservation", {
      domainUuid,
      reservationId: resvId
    })
  );
  assert.equal(releaseRes.ok, true);

  const wf2 = (await peopleRepo.getWorkforce(domainUuid)).value!;
  assert.equal(wf2.types["general"].reserved, 0);
  assert.equal(wf2.types["general"].available, 60);
});

test("G3.7 - Assignments: Non-GM remote command is rejected", async () => {
  const { domains, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Outpost", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  const cmd = createTestCommand("people:create-assignment", {
    domainUuid,
    assignment: {
      sourceRef: "opg_fake",
      targetRef: "prj_fake",
      workforceTypeId: "general",
      amount: 10
    }
  });

  const inbound = {
    rawEnvelope: cmd,
    transportContext: {
      senderUserId: "player-4",
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
