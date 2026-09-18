import assert from "node:assert/strict";
import test from "node:test";
import { CommandBus } from "../../src/commands/command-bus.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { registerOperationalGroupCommandHandlers } from "../../src/people/commands/operational-group-commands.js";
import { registerPopulationCommandHandlers } from "../../src/people/commands/population-commands.js";
import { registerAssignmentCommandHandlers, getSourceCapacity } from "../../src/people/commands/assignment-commands.js";
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
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:people"], config: {} }
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
  registerPopulationCommandHandlers(registry, coordinator, domains);
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

test("DEC-1145: Assignment does not exceed source contribution by default even if global capacity exists", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Province", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // 1. Create Small Squad (size 10)
  const g1Res = await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "Small Squad",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "abstract" as const,
        size: 10
      }
    })
  );
  assert.equal(g1Res.ok, true);
  const smallSquadId = (g1Res.value as any).result.id;

  // 2. Create Large Guild (size 90)
  const g2Res = await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "Large Guild",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "abstract" as const,
        size: 90
      }
    })
  );
  assert.equal(g2Res.ok, true);
  const largeGuildId = (g2Res.value as any).result.id;

  // Global general capacity is 100
  const wf = (await peopleRepo.getWorkforce(domainUuid)).value!;
  assert.equal(wf.types["general"].capacity, 100);

  // 3. Attempt to assign 15 workers from Small Squad (capacity 10)
  // Even though total domain general capacity is 100, Small Squad only has 10.
  const overcommitCmd = createTestCommand("people:create-assignment", {
    domainUuid,
    assignment: {
      sourceRef: smallSquadId,
      targetRef: "prj_fort",
      workforceTypeId: "general",
      amount: 15
    }
  });

  const overcommitRes = await bus.executeLocal(overcommitCmd);
  assert.equal(overcommitRes.ok, true);
  if (overcommitRes.ok) {
    assert.equal(overcommitRes.value.status, "rejected");
    assert.equal(overcommitRes.value.error?.code, "DM_WORKFORCE_OVERCOMMIT");
    assert.ok(overcommitRes.value.error?.message.includes(smallSquadId));
  }

  // 4. With explicit GM override (allowOvercommit: true), it succeeds
  const overrideCmd = createTestCommand("people:create-assignment", {
    domainUuid,
    assignment: {
      sourceRef: smallSquadId,
      targetRef: "prj_fort",
      workforceTypeId: "general",
      amount: 15
    },
    allowOvercommit: true
  });

  const overrideRes = await bus.executeLocal(overrideCmd);
  assert.equal(overrideRes.ok, true);
  if (overrideRes.ok) {
    assert.equal(overrideRes.value.status, "executed");
  }

  // 5. Reservation also enforces source capacity
  const resvCmd = createTestCommand("people:create-reservation", {
    domainUuid,
    reservation: {
      sourceRef: smallSquadId,
      targetRef: "prj_fort_resv",
      workforceTypeId: "general",
      amount: 5
    }
  });

  const resvRes = await bus.executeLocal(resvCmd);
  assert.equal(resvRes.ok, true);
  if (resvRes.ok) {
    // Small squad has 10 capacity, 15 committed, so available is -5 < 5 -> rejected!
    assert.equal(resvRes.value.status, "rejected");
    assert.equal(resvRes.value.error?.code, "DM_WORKFORCE_OVERCOMMIT");
  }
});

test("DEC-1145: PopulationGroup source capacity accounts for linked operational group deductions", async () => {
  const { domains, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Borderlands", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // 1. Create PopulationGroup with 20 military contribution
  const popCmd = createTestCommand("people:create-population-group", {
    domainUuid,
    group: {
      name: "Border Villagers",
      count: 100,
      includedInTotal: true,
      precision: "exact" as const,
      workforceContributions: [
        { workforceTypeId: "military", amount: 20 }
      ]
    }
  });
  const popRes = await bus.executeLocal(popCmd);
  assert.equal(popRes.ok, true);
  const popGroupId = (popRes.value as any).result.id;

  // 2. Create Militia (size 15) linked to Border Villagers
  const ogCmd = createTestCommand("people:create-operational-group", {
    domainUuid,
    group: {
      name: "Village Guard",
      definitionId: "domain-manager:militia",
      membershipMode: "abstract" as const,
      size: 15,
      populationGroupId: popGroupId
    }
  });
  const ogRes = await bus.executeLocal(ogCmd);
  assert.equal(ogRes.ok, true);

  // Remaining available military workforce from popGroupId is 20 - 15 = 5
  // 3. Attempting to assign 8 from popGroupId must be rejected with DM_WORKFORCE_OVERCOMMIT
  const asgOvercommitCmd = createTestCommand("people:create-assignment", {
    domainUuid,
    assignment: {
      sourceRef: popGroupId,
      targetRef: "prj_patrol",
      workforceTypeId: "military",
      amount: 8
    }
  });
  const asgOvercommitRes = await bus.executeLocal(asgOvercommitCmd);
  assert.equal(asgOvercommitRes.ok, true);
  if (asgOvercommitRes.ok) {
    assert.equal(asgOvercommitRes.value.status, "rejected");
    assert.equal(asgOvercommitRes.value.error?.code, "DM_WORKFORCE_OVERCOMMIT");
  }

  // 4. Assigning 4 from popGroupId must succeed
  const asgSuccessCmd = createTestCommand("people:create-assignment", {
    domainUuid,
    assignment: {
      sourceRef: popGroupId,
      targetRef: "prj_patrol",
      workforceTypeId: "military",
      amount: 4
    }
  });
  const asgSuccessRes = await bus.executeLocal(asgSuccessCmd);
  assert.equal(asgSuccessRes.ok, true);
  if (asgSuccessRes.ok) {
    assert.equal(asgSuccessRes.value.status, "executed");
  }
});
