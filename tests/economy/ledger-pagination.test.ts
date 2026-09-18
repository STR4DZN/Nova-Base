import test from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";

test("G4-AUD-009: LedgerStore.queryPaged supports cursor pagination and limit", async () => {
  const store = new LedgerStore();

  // Populate 25 ledger entries
  for (let i = 1; i <= 25; i++) {
    store.append({
      domainUuid: "dom-paged",
      resourceId: "domain-manager:treasury",
      deltaMinor: 10 * i,
      kind: "adjustment",
      source: { type: "manual", reason: `Entry #${i}` }
    });
  }

  assert.equal(store.count, 25);

  // 1. Page 1: 10 items, descending (newest first by default in paged)
  const page1 = store.queryPaged({
    domainUuid: "dom-paged",
    direction: "desc",
    limit: 10
  });

  assert.equal(page1.totalCount, 25);
  assert.equal(page1.entries.length, 10);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.entries[0].sequence, 25);
  assert.equal(page1.entries[9].sequence, 16);
  assert.ok(page1.nextCursor);

  // 2. Page 2 using cursor
  const page2 = store.queryPaged({
    domainUuid: "dom-paged",
    direction: "desc",
    cursor: page1.nextCursor,
    limit: 10
  });

  assert.equal(page2.entries.length, 10);
  assert.equal(page2.hasMore, true);
  assert.equal(page2.entries[0].sequence, 15);
  assert.equal(page2.entries[9].sequence, 6);

  // 3. Page 3 using cursor (remaining 5)
  const page3 = store.queryPaged({
    domainUuid: "dom-paged",
    direction: "desc",
    cursor: page2.nextCursor,
    limit: 10
  });

  assert.equal(page3.entries.length, 5);
  assert.equal(page3.hasMore, false);
  assert.equal(page3.entries[0].sequence, 5);
  assert.equal(page3.entries[4].sequence, 1);
});

test("G4-AUD-009: LedgerStore.query sorts descending by default when direction is desc", async () => {
  const store = new LedgerStore();

  store.append({
    domainUuid: "dom-desc",
    resourceId: "domain-manager:materials",
    deltaMinor: 100,
    kind: "adjustment",
    source: { type: "manual" }
  });

  store.append({
    domainUuid: "dom-desc",
    resourceId: "domain-manager:materials",
    deltaMinor: 200,
    kind: "adjustment",
    source: { type: "manual" }
  });

  store.append({
    domainUuid: "dom-desc",
    resourceId: "domain-manager:materials",
    deltaMinor: 300,
    kind: "adjustment",
    source: { type: "manual" }
  });

  const descEntries = store.query({ domainUuid: "dom-desc", direction: "desc" });
  assert.equal(descEntries.length, 3);
  assert.equal(descEntries[0].sequence, 3);
  assert.equal(descEntries[1].sequence, 2);
  assert.equal(descEntries[2].sequence, 1);
});
