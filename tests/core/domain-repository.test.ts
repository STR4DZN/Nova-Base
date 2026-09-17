import assert from "node:assert/strict";
import test from "node:test";
import { DomainIndex } from "../../src/storage/indexes/domain-index.js";
import type { DomainDocumentStore, IdentifiedJournalEntryDocumentLike } from "../../src/storage/repositories/domain-repository.js";
import { DomainRepository, type DomainDocument } from "../../src/storage/repositories/domain-repository.js";

const record = {
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
} as const;

function createStore(documents: readonly IdentifiedJournalEntryDocumentLike[]): DomainDocumentStore {
  const byId = new Map(documents.map((document) => [document.id, document]));
  let nextId = 1;
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
    create: async (data) => {
      const created = document(`created-${nextId++}`, data.name, data.flags["domain-manager"] as typeof record);
      byId.set(created.id, created);
      return created;
    }
  };
}

function document(id: string, name: string, value = record): IdentifiedJournalEntryDocumentLike & { updateData?: Record<string, unknown> } {
  let currentName = name;
  let currentFlags: Readonly<Record<string, unknown>> = { "domain-manager": value };
  let updateData: Record<string, unknown> | undefined;
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return currentName; },
    get flags() { return currentFlags; },
    get updateData() { return updateData; },
    update: async (data) => {
      updateData = data;
      if (typeof data.name === "string") currentName = data.name;
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) currentFlags = { ...currentFlags, "domain-manager": payload };
    }
  };
}

test("repository reads a domain through the document boundary", () => {
  const result = new DomainRepository(createStore([document("je-1", "Base")])).read("je-1");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.id, "je-1");
    assert.equal(result.value.name, "Base");
    assert.deepEqual(result.value.record, record);
  }
});

test("repository queries decoded domains without accessing raw flags", () => {
  const result = new DomainRepository(createStore([
    document("je-1", "Base"),
    document("je-2", "Other", {
      ...record,
      definition: {
        ...record.definition,
        classification: { ...record.definition.classification, kind: "station", tags: [] }
      },
      state: { lifecycle: "inactive" }
    })
  ])).query({ kind: "base", tag: "starter" });

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.map((item) => item.id), ["je-1"]);
});

test("repository saves name and payload through the adapter", async () => {
  const target = document("je-1", "Old");
  const domain: DomainDocument = { id: "je-1", uuid: "JournalEntry.je-1", name: "New", record };
  const result = await new DomainRepository(createStore([target])).save(domain);

  assert.equal(result.ok, true);
  assert.equal(target.updateData?.name, "New");
  assert.deepEqual(target.updateData?.["flags.domain-manager"], { ...record, revision: 1 });
});

test("repository creates, loads, and updates a domain internally", async () => {
  const repository = new DomainRepository(createStore([]));
  const created = await repository.create({ name: "Created", record });

  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.name, "Created");
  assert.equal(created.value.record.state.lifecycle, "active");
  assert.equal(created.value.record.revision, 0);

  const loaded = repository.load(created.value.id);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;

  const updated = await repository.update({ ...loaded.value, name: "Renamed" });
  assert.equal(updated.ok, true);
  assert.equal(repository.load(created.value.id).value.name, "Renamed");
});

test("repository archives and restores without replacing the document", async () => {
  const repository = new DomainRepository(createStore([document("je-1", "Base")]), { now: () => 1234 });

  const archived = await repository.archive("je-1");
  assert.equal(archived.ok, true);
  const archivedDomain = repository.load("je-1");
  assert.equal(archivedDomain.ok, true);
  if (archivedDomain.ok) {
    assert.equal(archivedDomain.value.id, "je-1");
    assert.equal(archivedDomain.value.record.state.lifecycle, "archived");
    assert.equal(archivedDomain.value.record.metadata.archivedAt, 1234);
  }

  const restored = await repository.restore("je-1");
  assert.equal(restored.ok, true);
  const restoredDomain = repository.load("je-1");
  assert.equal(restoredDomain.ok, true);
  if (restoredDomain.ok) {
    assert.equal(restoredDomain.value.id, "je-1");
    assert.equal(restoredDomain.value.record.state.lifecycle, "active");
    assert.equal(restoredDomain.value.record.metadata.archivedAt, null);
  }
});

test("repository increments revision only for semantic changes", async () => {
  const target = document("je-1", "Base");
  const repository = new DomainRepository(createStore([target]));

  const renamed = await repository.update({ id: "je-1", uuid: "JournalEntry.je-1", name: "Renamed", record });
  assert.equal(renamed.ok, true);
  if (renamed.ok) {
    assert.equal(renamed.value.status, "updated");
    assert.equal(renamed.value.revision, 1);
  }

  const current = repository.load("je-1");
  assert.equal(current.ok, true);
  if (!current.ok) return;
  const previousWrite = target.updateData;
  const noOp = await repository.update(current.value);
  assert.equal(noOp.ok, true);
  if (noOp.ok) {
    assert.equal(noOp.value.status, "no-op");
    assert.equal(noOp.value.revision, 1);
  }
  assert.deepEqual(target.updateData, previousWrite);
});

test("repository rejects stale revisions without writing", async () => {
  const target = document("je-1", "Base");
  const repository = new DomainRepository(createStore([target]));
  const first = await repository.update({ id: "je-1", uuid: "JournalEntry.je-1", name: "First", record });
  assert.equal(first.ok, true);
  const previousWrite = target.updateData;

  const stale = await repository.update({ id: "je-1", uuid: "JournalEntry.je-1", name: "Stale", record });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.error.code, "DM_DOMAIN_REVISION_CONFLICT");
    assert.deepEqual(stale.error.details, { expectedRevision: 0, actualRevision: 1 });
  }
  assert.deepEqual(target.updateData, previousWrite);
});

test("repository reparents a Domain and blocks cycles", async () => {
  const root = document("root", "Root");
  const child = document("child", "Child");
  const repository = new DomainRepository(createStore([root, child]));

  const moved = await repository.reparent("child", "JournalEntry.root");
  assert.equal(moved.ok, true);
  if (moved.ok) {
    assert.equal(moved.value.status, "updated");
    assert.equal(moved.value.revision, 1);
  }

  const loaded = repository.load("child");
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.value.record.definition.hierarchy.parentDomainUuid, "JournalEntry.root");

  const cycle = await repository.reparent("root", "JournalEntry.child");
  assert.equal(cycle.ok, false);
  if (!cycle.ok) assert.equal(cycle.error.code, "DM_DOMAIN_HIERARCHY_CYCLE");
  assert.equal(root.updateData, undefined);

  const missing = await repository.reparent("child", "JournalEntry.missing");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, "DM_DOMAIN_PARENT_NOT_FOUND");
});

test("repository rebuilds and incrementally updates its derived index", async () => {
  const target = document("je-1", "Base");
  const index = new DomainIndex();
  const repository = new DomainRepository(createStore([target]), { index });

  const rebuilt = repository.rebuildIndex();
  assert.equal(rebuilt.ok, true);
  assert.deepEqual(index.query({ name: "Base" }).map((entry) => entry.id), ["je-1"]);

  const current = repository.load("je-1");
  assert.equal(current.ok, true);
  if (!current.ok) return;
  const updated = await repository.update({ ...current.value, name: "Renamed" });
  assert.equal(updated.ok, true);
  assert.equal(index.query({ name: "Base" }).length, 0);
  assert.deepEqual(index.query({ name: "Renamed" }).map((entry) => entry.id), ["je-1"]);
});

test("repository exposes read-only integrity diagnostics for invalid payloads", () => {
  const broken: IdentifiedJournalEntryDocumentLike = {
    id: "broken",
    uuid: "JournalEntry.broken",
    name: "Broken",
    flags: { "domain-manager": { malformed: true } },
    update: async () => undefined
  };
  const report = new DomainRepository(createStore([broken])).checkIntegrity();

  assert.equal(report.healthy, false);
  assert.equal(report.checked, 1);
  assert.ok(report.issues.some((item) => item.code === "DM_DOMAIN_PAYLOAD_INVALID"));
});

test("repository rejects invalid records and missing documents", async () => {
  const repository = new DomainRepository(createStore([]));
  const missing = await repository.save({ id: "missing", uuid: "JournalEntry.missing", name: "Missing", record });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, "DM_DOMAIN_NOT_FOUND");

  const invalid = await new DomainRepository(createStore([document("je-1", "Base")])).save({
    id: "je-1",
    uuid: "JournalEntry.je-1",
    name: "Base",
    record: { ...record, revision: -1 }
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "DM_INVALID_DOMAIN_REPOSITORY_RECORD");
});


test("generic save cannot bypass hierarchy cycle validation", async () => {
  const root = document("root", "Root");
  const child = document("child", "Child", {
    ...record,
    definition: { ...record.definition, hierarchy: { parentDomainUuid: "JournalEntry.root" } }
  });
  const repository = new DomainRepository(createStore([root, child]));
  const loadedRoot = repository.load("root");
  assert.equal(loadedRoot.ok, true);
  if (!loadedRoot.ok) return;

  const direct = await repository.save({
    ...loadedRoot.value,
    record: {
      ...loadedRoot.value.record,
      definition: { ...loadedRoot.value.record.definition, hierarchy: { parentDomainUuid: "JournalEntry.child" } }
    }
  });
  assert.equal(direct.ok, false);
  if (!direct.ok) assert.equal(direct.error.code, "DM_DOMAIN_HIERARCHY_CYCLE");
  assert.equal(root.updateData, undefined);
});

test("repository query uses the derived index after its initial rebuild", () => {
  const documents = [document("one", "One"), document("two", "Two")];
  const base = createStore(documents);
  let listCalls = 0;
  const store: DomainDocumentStore = {
    ...base,
    list: () => { listCalls += 1; return base.list(); }
  };
  const repository = new DomainRepository(store);

  const first = repository.query({ name: "One" });
  assert.equal(first.ok, true);
  assert.equal(listCalls, 1);
  const second = repository.query({ name: "Two" });
  assert.equal(second.ok, true);
  assert.equal(listCalls, 1);
});

test("repository preserves immutable document UUID identity", async () => {
  const target = document("je-1", "Base");
  const repository = new DomainRepository(createStore([target]));
  const result = await repository.save({ id: "je-1", uuid: "JournalEntry.other", name: "Base", record });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "DM_INVALID_DOMAIN_REPOSITORY_INPUT");
  assert.equal(target.updateData, undefined);
});

test("repository removes an alias that duplicates the primary JournalEntry name", async () => {
  const repository = new DomainRepository(createStore([]));
  const created = await repository.create({
    name: " Atlas ",
    record: {
      ...record,
      definition: {
        ...record.definition,
        identity: { ...record.definition.identity, aliases: ["atlas", "Other"] }
      }
    }
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.value.name, "Atlas");
    assert.deepEqual(created.value.record.definition.identity.aliases, ["Other"]);
  }
});
