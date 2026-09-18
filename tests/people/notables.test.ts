import assert from "node:assert/strict";
import test from "node:test";
import { CommandBus } from "../../src/commands/command-bus.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { registerNotableCommandHandlers } from "../../src/people/commands/notable-commands.js";
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
import { resolveNotableStatus } from "../../src/people/notables/notable-types.js";

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

test("G3.3 - Notables: Create inline and actor-linked notables with stable IDs", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Solaris", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // 1. Create Inline Notable
  const inlineCmd = createTestCommand("people:create-notable", {
    domainUuid,
    notable: {
      type: "inline" as const,
      name: "Captain Valerie",
      portrait: "icons/captain.webp",
      description: "Veteran captain of the guard",
      tags: ["military", "leader"],
      visibility: "public" as const
    }
  });

  const inlineRes = await bus.executeLocal(inlineCmd);
  assert.equal(inlineRes.ok, true);
  if (inlineRes.ok) {
    assert.equal(inlineRes.value.status, "executed");
  }

  // 2. Create Actor-linked Notable
  const actorCmd = createTestCommand("people:create-notable", {
    domainUuid,
    notable: {
      type: "actor" as const,
      actorUuid: "Actor.act1234567890abc",
      name: "Archmage Elion",
      description: "Resident court wizard",
      tags: ["magic", "advisor"],
      visibility: "restricted" as const
    }
  });

  const actorRes = await bus.executeLocal(actorCmd);
  assert.equal(actorRes.ok, true);
  if (actorRes.ok) {
    assert.equal(actorRes.value.status, "executed");
  }

  // 3. Query via PeopleRepository
  const notablesRes = await peopleRepo.getNotables(domainUuid, { viewerIsGm: true });
  assert.equal(notablesRes.ok, true);
  if (notablesRes.ok) {
    assert.equal(notablesRes.value.length, 2);

    const valerie = notablesRes.value.find((n) => n.name === "Captain Valerie");
    assert.ok(valerie);
    assert.equal(valerie?.type, "inline");
    assert.ok(valerie?.id.startsWith("not_"));

    const elion = notablesRes.value.find((n) => n.name === "Archmage Elion");
    assert.ok(elion);
    assert.equal(elion?.type, "actor");
    assert.ok(elion?.id.startsWith("not_"));
    if (elion?.type === "actor") {
      assert.equal(elion.actorUuid, "Actor.act1234567890abc");
    }
  }
});

test("G3.3 - Notables: Anti-duplicate Actor check within the same domain", async () => {
  const { domains, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Haven", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  const actorUuid = "Actor.duplicate999xyz";

  // First creation succeeds
  const cmd1 = createTestCommand("people:create-notable", {
    domainUuid,
    notable: {
      type: "actor" as const,
      actorUuid,
      name: "Lord Aethel"
    }
  });
  const res1 = await bus.executeLocal(cmd1);
  assert.equal(res1.ok, true);
  if (res1.ok) {
    assert.equal(res1.value.status, "executed");
  }

  // Second creation with the SAME actorUuid in the same domain fails
  const cmd2 = createTestCommand("people:create-notable", {
    domainUuid,
    notable: {
      type: "actor" as const,
      actorUuid,
      name: "Lord Aethel Duplicate"
    }
  });
  const res2 = await bus.executeLocal(cmd2);
  assert.equal(res2.ok, true);
  if (res2.ok) {
    assert.equal(res2.value.status, "rejected");
    assert.equal(res2.value.error?.code, "DM_NOTABLE_DUPLICATE_ACTOR");
  }
});

test("G3.3 - Notables: Notable ID survives missing Actor (broken ref resilience)", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Ruins", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  const missingActorUuid = "Actor.deleted12345678";

  const createCmd = createTestCommand("people:create-notable", {
    domainUuid,
    notable: {
      type: "actor" as const,
      actorUuid: missingActorUuid,
      name: "Lost Ghost",
      visibility: "public" as const
    }
  });
  const createRes = await bus.executeLocal(createCmd);
  assert.equal(createRes.ok, true);
  if (createRes.ok) {
    assert.equal(createRes.value.status, "executed");
  }

  const notables = await peopleRepo.getNotables(domainUuid, { viewerIsGm: true });
  assert.equal(notables.ok, true);
  const ghost = notables.ok ? notables.value[0] : null;
  assert.ok(ghost);

  // Status check with resolver that cannot find the actor (simulating deleted Actor)
  const statusReport = resolveNotableStatus(ghost!, () => null);
  assert.equal(statusReport.isBrokenRef, true);
  assert.equal(statusReport.notable.id, ghost!.id);
  assert.equal(statusReport.resolvedName, "Lost Ghost");

  // Record still exists in repository
  const fetchAgain = await peopleRepo.getNotable(domainUuid, ghost!.id, { viewerIsGm: true });
  assert.equal(fetchAgain.ok, true);
});

test("G3.3 - Notables: Convert inline notable to actor-linked via update", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Village", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // 1. Create inline
  const createCmd = createTestCommand("people:create-notable", {
    domainUuid,
    notable: {
      type: "inline" as const,
      name: "Apprentice Rowan"
    }
  });
  const createRes = await bus.executeLocal(createCmd);
  assert.equal(createRes.ok, true);

  const notablesRes = await peopleRepo.getNotables(domainUuid, { viewerIsGm: true });
  assert.equal(notablesRes.ok, true);
  const rowanId = notablesRes.ok ? notablesRes.value[0].id : "";

  // 2. Convert to Actor-linked
  const updateCmd = createTestCommand("people:update-notable", {
    domainUuid,
    notableId: rowanId,
    patch: {
      convertToActorUuid: "Actor.rowanMasterActor1"
    }
  });
  const updateRes = await bus.executeLocal(updateCmd);
  assert.equal(updateRes.ok, true);
  if (updateRes.ok) {
    assert.equal(updateRes.value.status, "executed");
  }

  // 3. Verify conversion
  const updatedNotableRes = await peopleRepo.getNotable(domainUuid, rowanId, { viewerIsGm: true });
  assert.equal(updatedNotableRes.ok, true);
  if (updatedNotableRes.ok) {
    assert.equal(updatedNotableRes.value.id, rowanId); // ID preserved
    assert.equal(updatedNotableRes.value.type, "actor");
    if (updatedNotableRes.value.type === "actor") {
      assert.equal(updatedNotableRes.value.actorUuid, "Actor.rowanMasterActor1");
    }
  }
});

test("G3.3 - Notables: Secret notable visibility sanitization for non-GM viewers", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Keep", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // Public notable
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: {
        type: "inline" as const,
        name: "Public Guard",
        visibility: "public" as const
      }
    })
  );

  // Secret notable
  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: {
        type: "inline" as const,
        name: "Secret Spymaster",
        visibility: "secret" as const
      }
    })
  );

  // GM sees both
  const gmView = await peopleRepo.getNotables(domainUuid, { viewerIsGm: true });
  assert.equal(gmView.ok, true);
  if (gmView.ok) {
    assert.equal(gmView.value.length, 2);
  }

  // Non-GM player only sees the public one
  const playerView = await peopleRepo.getNotables(domainUuid, { viewerIsGm: false });
  assert.equal(playerView.ok, true);
  if (playerView.ok) {
    assert.equal(playerView.value.length, 1);
    assert.equal(playerView.value[0].name, "Public Guard");
  }
});

test("G3.3 - Notables: Non-GM remote command execution is rejected", async () => {
  const { domains, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Border", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  const cmd = createTestCommand("people:create-notable", {
    domainUuid,
    notable: {
      type: "inline" as const,
      name: "Unauthorized NPC"
    }
  });

  const inbound = {
    rawEnvelope: cmd,
    transportContext: {
      senderUserId: "player-2",
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

test("G3.3 - Notables: Delete notable removes record", async () => {
  const { domains, bus, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Camp", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Temporary Scout" }
    })
  );

  const list1 = await peopleRepo.getNotables(domainUuid, { viewerIsGm: true });
  assert.equal(list1.ok, true);
  const scoutId = list1.ok ? list1.value[0].id : "";

  const deleteCmd = createTestCommand("people:delete-notable", {
    domainUuid,
    notableId: scoutId
  });
  const deleteRes = await bus.executeLocal(deleteCmd);
  assert.equal(deleteRes.ok, true);
  if (deleteRes.ok) {
    assert.equal(deleteRes.value.status, "executed");
  }

  const list2 = await peopleRepo.getNotables(domainUuid, { viewerIsGm: true });
  assert.equal(list2.ok, true);
  if (list2.ok) {
    assert.equal(list2.value.length, 0);
  }
});

