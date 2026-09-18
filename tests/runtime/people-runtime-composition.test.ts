import test from "node:test";
import assert from "node:assert/strict";
import { composeDomainManagerRuntime } from "../../src/bootstrap/domain-manager-runtime.js";

// Minimal mock authority for composition tests
function createMockAuthority() {
  return {
    service: {
      isCurrentUser: () => true,
      getStatus: () => ({ isAuthority: true, authorityEpoch: 1, currentAuthorityUserId: "gm-user" }),
      reconcile: async () => {},
      onChanged: () => () => {},
      isAvailable: () => true,
      getCurrentAuthorityUserId: () => "gm-user"
    },
    reconcile: async () => {},
    synchronizePersistedState: () => {},
    destroy: () => {}
  };
}

function createMockTransport() {
  return {
    send: async () => ({ ok: true }),
    registerInboundHandler: () => () => {},
    onReceive: () => () => {},
    isAvailable: () => true,
    destroy: () => {}
  };
}

test("G3 Composition: People Subsystem commands registered and runtime.people facade exposed", () => {
  // Use createStore from earlier or minimal in-memory document store
  const byKey = new Map();
  const domainStore = {
    get: (id: string) => byKey.get(id),
    list: () => [...byKey.values()],
    create: async (data: any) => {
      const doc = { id: "je-1", uuid: "JournalEntry.je-1", name: data.name, flags: data.flags, update: async () => {} };
      byKey.set(doc.id, doc);
      return doc;
    }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: domainStore as any,
    authority: createMockAuthority() as any,
    transport: createMockTransport() as any
  });

  // 1. Verify runtime.people facade is exposed
  assert.ok(runtime.people, "runtime.people facade must be exposed");
  assert.equal(typeof runtime.people.getPeopleData, "function");
  assert.equal(typeof runtime.people.getViewerContext, "function");
  assert.equal(typeof runtime.people.getPopulation, "function");
  assert.equal(typeof runtime.people.getNotables, "function");
  assert.equal(typeof runtime.people.getRoles, "function");
  assert.equal(typeof runtime.people.getOperationalGroups, "function");
  assert.equal(typeof runtime.people.getWorkforce, "function");
  assert.equal(typeof runtime.people.getAssignments, "function");
  assert.equal(typeof runtime.people.getReservations, "function");
  assert.equal(typeof runtime.people.getAggregate, "function");

  // 2. Verify all People commands are registered in CommandRegistry
  const expectedCommands = [
    "people:set-population",
    "people:create-population-group",
    "people:update-population-group",
    "people:delete-population-group",
    "people:create-notable",
    "people:update-notable",
    "people:delete-notable",
    "people:create-role",
    "people:assign-role",
    "people:unassign-role",
    "people:delete-role",
    "people:create-operational-group",
    "people:update-operational-group",
    "people:delete-operational-group",
    "people:create-assignment",
    "people:cancel-assignment",
    "people:create-reservation",
    "people:release-reservation"
  ];

  for (const cmdType of expectedCommands) {
    const entry = runtime.registry.get(cmdType);
    assert.ok(entry, `Command '${cmdType}' must be registered in CommandRegistry`);
    assert.equal(entry.transactional, true, `Command '${cmdType}' must be transactional`);
  }

  // 3. Clean destroy
  runtime.destroy();
});
