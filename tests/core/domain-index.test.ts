import assert from "node:assert/strict";
import test from "node:test";
import { DomainIndex, type DomainIndexEntry } from "../../src/storage/indexes/domain-index.js";
import type { DomainDocument } from "../../src/storage/repositories/domain-repository.js";

const record = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: ["First"], summary: "Summary", description: "Description" },
    classification: { kind: "base", scale: "large", tags: ["capital"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
} as const;

function domain(id: string, name: string, value = record): DomainDocument {
  return { id, uuid: `JournalEntry.${id}`, name, record: value };
}

test("domain index rebuilds and queries canonical fields", () => {
  const index = new DomainIndex();
  const result = index.rebuild([
    domain("root", "Root"),
    domain("child", "Child", {
      ...record,
      definition: {
        ...record.definition,
        identity: { ...record.definition.identity, aliases: ["Branch"] },
        classification: { kind: "outpost", scale: "small", tags: ["frontier"] },
        hierarchy: { parentDomainUuid: "JournalEntry.root" },
        capabilities: { enabled: ["domain-manager:domain", "addon:logistics"], config: {} }
      },
      state: { lifecycle: "inactive" }
    })
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(index.query({ parentDomainUuid: "JournalEntry.root" }).map((entry) => entry.id), ["child"]);
  assert.deepEqual(index.query({ alias: "Branch" }).map((entry) => entry.id), ["child"]);
  assert.deepEqual(index.query({ uuid: "JournalEntry.child" }).map((entry) => entry.id), ["child"]);
  assert.deepEqual(index.query({ capabilityId: "addon:logistics" }).map((entry) => entry.id), ["child"]);
  assert.deepEqual(index.query({ lifecycle: "active", kind: "base" }).map((entry) => entry.id), ["root"]);
});

test("domain index applies incremental upserts and removals", () => {
  const index = new DomainIndex();
  index.rebuild([domain("one", "One")]);
  const changed = domain("one", "One Updated", {
    ...record,
    definition: {
      ...record.definition,
      classification: { ...record.definition.classification, kind: "outpost" }
    }
  });
  assert.equal(index.upsert(changed).ok, true);
  assert.equal(index.get("one")?.name, "One Updated");
  assert.equal(index.query({ kind: "base" }).length, 0);
  assert.equal(index.query({ kind: "outpost" }).length, 1);
  assert.equal(index.remove("one"), true);
  assert.equal(index.list().length, 0);
  assert.equal(index.remove("one"), false);
});

test("domain index rebuild is atomic when an entry is invalid", () => {
  const index = new DomainIndex();
  index.rebuild([domain("stable", "Stable")]);
  const invalid = domain("broken", "Broken", { ...record, revision: -1 });

  const result = index.rebuild([invalid]);
  assert.equal(result.ok, false);
  assert.deepEqual(index.list().map((entry: DomainIndexEntry) => entry.id), ["stable"]);
});
