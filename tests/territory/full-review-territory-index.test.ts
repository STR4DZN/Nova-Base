import assert from "node:assert/strict";
import test from "node:test";
import { DiplomacyEntityStore, InMemoryDiplomacyStorageAdapter, type DiplomacyEntity } from "../../src/diplomacy/diplomacy-store.js";
test("review G6: recreating a removed territory never leaves it under its old parents", async () => {
  const store = new DiplomacyEntityStore(new InMemoryDiplomacyStorageAdapter());
  const row = (parent: string): DiplomacyEntity => ({ schemaVersion: 1, kind: "territory", id: "JournalEntry.child", revision: 0,
    data: { territory: { locatedInUuid: parent, administrativeParentUuid: parent } }, receipts: [] });
  await store.save(row("JournalEntry.old")); await store.remove("territory", "JournalEntry.child"); await store.save(row("JournalEntry.new"));
  for (const axis of ["locatedInUuid", "administrativeParentUuid"] as const) {
    assert.equal(store.children("JournalEntry.old", axis).length, 0);
    assert.equal(store.children("JournalEntry.new", axis).length, 1);
  }
});
