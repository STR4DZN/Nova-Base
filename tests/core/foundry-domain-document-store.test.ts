import assert from "node:assert/strict";
import test from "node:test";
import {
  FoundryDomainDocumentStore,
  type FoundryDomainStoreRuntime
} from "../../src/storage/adapters/foundry-domain-document-store.js";
import type { IdentifiedJournalEntryDocumentLike } from "../../src/storage/repositories/domain-repository.js";

function document(id: string, name: string): IdentifiedJournalEntryDocumentLike {
  return {
    id,
    uuid: `JournalEntry.${id}`,
    name,
    flags: { "domain-manager": { schemaVersion: 1 } },
    update: async () => undefined
  };
}

test("Foundry Domain store reads the injected game.journal boundary", () => {
  const one = document("one", "One");
  const runtime: FoundryDomainStoreRuntime = {
    journal: { contents: [one], get: (id) => id === "one" ? one : undefined },
    createJournalEntry: async () => undefined
  };
  const store = new FoundryDomainDocumentStore(runtime);
  assert.equal(store.get("one"), one);
  assert.deepEqual(store.list(), [one]);
});

test("Foundry Domain store creates canonical JournalEntries through the runtime", async () => {
  const created = document("created", "Created");
  let received: unknown;
  const runtime: FoundryDomainStoreRuntime = {
    journal: { contents: [], get: () => undefined },
    createJournalEntry: async (data) => { received = data; return created; }
  };
  const store = new FoundryDomainDocumentStore(runtime);
  const result = await store.create({ name: "Created", flags: { "domain-manager": { schemaVersion: 1 } } });
  assert.equal(result, created);
  assert.deepEqual(received, { name: "Created", flags: { "domain-manager": { schemaVersion: 1 } } });
});

test("Foundry Domain store fails loudly when JournalEntry.create returns nothing", async () => {
  const runtime: FoundryDomainStoreRuntime = {
    journal: { contents: [], get: () => undefined },
    createJournalEntry: async () => null
  };
  const store = new FoundryDomainDocumentStore(runtime);
  await assert.rejects(() => store.create({ name: "Missing", flags: {} }), /did not return/);
});


test("Foundry Domain store ignores ordinary JournalEntries without Domain flags", () => {
  const domain = document("domain", "Domain");
  const ordinary: IdentifiedJournalEntryDocumentLike = {
    id: "notes",
    uuid: "JournalEntry.notes",
    name: "Notes",
    flags: {},
    update: async () => undefined
  };
  const runtime: FoundryDomainStoreRuntime = {
    journal: {
      contents: [domain, ordinary],
      get: (id) => id === "domain" ? domain : id === "notes" ? ordinary : undefined
    },
    createJournalEntry: async () => undefined
  };
  const store = new FoundryDomainDocumentStore(runtime);
  assert.deepEqual(store.list(), [domain]);
  assert.equal(store.get("notes"), undefined);
});
