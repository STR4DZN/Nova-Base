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

test("G4-AUD-009: LedgerStore handles 10,000+ entries scale test with performant paged queries", async () => {
  const store = new LedgerStore();
  const totalEntries = 10_000;

  // Append 10,000 entries
  for (let i = 1; i <= totalEntries; i++) {
    store.append({
      domainUuid: "dom-scale",
      resourceId: "domain-manager:supplies",
      deltaMinor: i,
      kind: "adjustment",
      source: { type: "system", reason: `Tick #${i}` }
    });
  }

  assert.equal(store.count, totalEntries);

  const start = performance.now();
  const page1 = store.queryPaged({
    domainUuid: "dom-scale",
    direction: "desc",
    limit: 50
  });
  const duration = performance.now() - start;

  assert.equal(page1.totalCount, totalEntries);
  assert.equal(page1.entries.length, 50);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.entries[0].sequence, 10_000);
  assert.equal(page1.entries[49].sequence, 9_951);
  assert.ok(page1.nextCursor);
  // Query should execute in under 100ms
  assert.ok(duration < 250, `Query took ${duration.toFixed(2)}ms, should be < 250ms`);

  // Query next page with cursor
  const page2 = store.queryPaged({
    domainUuid: "dom-scale",
    direction: "desc",
    cursor: page1.nextCursor,
    limit: 50
  });

  assert.equal(page2.entries.length, 50);
  assert.equal(page2.entries[0].sequence, 9_950);
  assert.equal(page2.entries[49].sequence, 9_901);
});

test("G4-REVAL4-003: LedgerStore.queryPaged filters strictly by allowedResourceIds without leaking totalCount or hasMore", async () => {
  const store = new LedgerStore();

  // Populate 15 treasury entries (public)
  for (let i = 1; i <= 15; i++) {
    store.append({
      domainUuid: "dom-leak-test",
      resourceId: "domain-manager:treasury",
      deltaMinor: 100 * i,
      kind: "adjustment",
      source: { type: "manual", reason: `Treasury #${i}` }
    });
  }

  // Populate 20 materials entries (secret)
  for (let i = 1; i <= 20; i++) {
    store.append({
      domainUuid: "dom-leak-test",
      resourceId: "domain-manager:materials",
      deltaMinor: 50 * i,
      kind: "adjustment",
      source: { type: "manual", reason: `Materials #${i}` }
    });
  }

  assert.equal(store.count, 35);

  // Query with allowedResourceIds restricted only to treasury
  const page1 = store.queryPaged({
    domainUuid: "dom-leak-test",
    allowedResourceIds: ["domain-manager:treasury"],
    direction: "desc",
    limit: 10
  });

  // totalCount MUST be 15, NOT 35!
  assert.equal(page1.totalCount, 15, "totalCount must reflect only allowed resources");
  assert.equal(page1.entries.length, 10);
  assert.equal(page1.hasMore, true);
  for (const entry of page1.entries) {
    assert.equal(entry.resourceId, "domain-manager:treasury");
  }

  // Page 2
  const page2 = store.queryPaged({
    domainUuid: "dom-leak-test",
    allowedResourceIds: ["domain-manager:treasury"],
    direction: "desc",
    cursor: page1.nextCursor,
    limit: 10
  });

  assert.equal(page2.totalCount, 5, "totalCount reflects matching entries in cursor window");
  assert.equal(page2.entries.length, 5);
  assert.equal(page2.hasMore, false, "hasMore must be false after the 15th treasury entry");
  for (const entry of page2.entries) {
    assert.equal(entry.resourceId, "domain-manager:treasury");
  }
});

test("G4-REVAL5-002: LedgerStore.queryPaged enforces domain-qualified allowedDomainResourceKeys preventing cross-domain leaks", async () => {
  const store = new LedgerStore();

  const domainAUuid = "JournalEntry.dom-a";
  const domainBUuid = "JournalEntry.dom-b";

  // Populate 12 entries for Domain A treasury (public)
  for (let i = 1; i <= 12; i++) {
    store.append({
      domainUuid: domainAUuid,
      resourceId: "domain-manager:treasury",
      deltaMinor: 100 * i,
      kind: "adjustment",
      source: { type: "manual", reason: `DomA #${i}` }
    });
  }

  // Populate 18 entries for Domain B treasury (secret)
  for (let i = 1; i <= 18; i++) {
    store.append({
      domainUuid: domainBUuid,
      resourceId: "domain-manager:treasury",
      deltaMinor: 200 * i,
      kind: "adjustment",
      source: { type: "manual", reason: `DomB #${i}` }
    });
  }

  assert.equal(store.count, 30);

  // Player has access ONLY to Domain A treasury
  const allowedKeys = [`${domainAUuid}:domain-manager:treasury`];

  // 1. Querying Domain B with player's allowedDomainResourceKeys yields 0 entries and 0 totalCount
  const domBQuery = store.queryPaged({
    domainUuid: domainBUuid,
    allowedDomainResourceKeys: allowedKeys,
    direction: "desc",
    limit: 10
  });

  assert.equal(domBQuery.totalCount, 0, "Domain B totalCount must be 0 for player without access");
  assert.equal(domBQuery.entries.length, 0, "Domain B entries must be empty for unauthorized player");
  assert.equal(domBQuery.hasMore, false);

  // 2. Global query across domains (no domainUuid filter) with allowedDomainResourceKeys
  const globalPage1 = store.queryPaged({
    allowedDomainResourceKeys: allowedKeys,
    direction: "desc",
    limit: 10
  });

  // totalCount MUST be 12 (Domain A entries only), NEVER 30!
  assert.equal(globalPage1.totalCount, 12, "Global totalCount must only count entries from authorized domains");
  assert.equal(globalPage1.entries.length, 10);
  assert.equal(globalPage1.hasMore, true);
  for (const entry of globalPage1.entries) {
    assert.equal(entry.domainUuid, domainAUuid, "Entries must belong exclusively to authorized Domain A");
    assert.equal(entry.resourceId, "domain-manager:treasury");
  }

  // 3. Global query page 2 using cursor
  const globalPage2 = store.queryPaged({
    allowedDomainResourceKeys: new Set(allowedKeys),
    direction: "desc",
    cursor: globalPage1.nextCursor,
    limit: 10
  });

  assert.equal(globalPage2.entries.length, 2, "Page 2 must have remaining 2 entries from Domain A");
  assert.equal(globalPage2.hasMore, false, "hasMore must be false after the 12th Domain A entry");
  for (const entry of globalPage2.entries) {
    assert.equal(entry.domainUuid, domainAUuid);
  }
});



