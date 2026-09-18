import assert from "node:assert/strict";
import test from "node:test";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";
import { validateLedgerEntry } from "../../src/economy/ledger/ledger-types.js";

test("G4.4: LedgerEntry validator rejects non-zero delta and invalid ID", () => {
  const zeroDelta = {
    id: "led_01",
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    deltaMinor: 0, // must be non-zero
    kind: "adjustment",
    timestampReal: Date.now(),
    source: { type: "manual" },
    sequence: 1
  };
  assert.equal(validateLedgerEntry(zeroDelta).ok, false);

  const invalidId = {
    id: "invalid_id", // must start with led_
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    deltaMinor: 100,
    kind: "adjustment",
    timestampReal: Date.now(),
    source: { type: "manual" },
    sequence: 1
  };
  assert.equal(validateLedgerEntry(invalidId).ok, false);
});

test("G4.4: LedgerStore appends entries with monotonic sequence and query filtering", () => {
  const store = new LedgerStore();

  const e1 = store.append({
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    deltaMinor: 5000,
    kind: "opening-balance",
    timestampReal: 1000,
    source: { type: "init" }
  });
  assert.equal(e1.ok, true);
  if (e1.ok) {
    assert.equal(e1.value.sequence, 1);
    assert.ok(e1.value.id.startsWith("led_"));
  }

  const e2 = store.append({
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    deltaMinor: -200,
    kind: "fee",
    timestampReal: 1050,
    source: { type: "taxation" }
  });
  assert.equal(e2.ok, true);
  if (e2.ok) {
    assert.equal(e2.value.sequence, 2);
  }

  const e3 = store.append({
    domainUuid: "domain-2",
    resourceId: "domain-manager:supplies",
    deltaMinor: 100,
    kind: "production",
    timestampReal: 1100,
    source: { type: "facility" }
  });
  assert.equal(e3.ok, true);
  if (e3.ok) {
    assert.equal(e3.value.sequence, 3);
  }

  // Query all
  assert.equal(store.query().length, 3);

  // Filter by domainUuid
  const dom1Entries = store.query({ domainUuid: "domain-1" });
  assert.equal(dom1Entries.length, 2);

  // Filter by resourceId
  const treasuryEntries = store.query({ resourceId: "domain-manager:treasury" });
  assert.equal(treasuryEntries.length, 2);

  // Filter by kind
  const feeEntries = store.query({ kind: "fee" });
  assert.equal(feeEntries.length, 1);
  assert.equal(feeEntries[0].deltaMinor, -200);

  // Filter with limit
  const limited = store.query({ limit: 2 });
  assert.equal(limited.length, 2);
});

test("G4.4: LedgerStore creates reversal preserving original and blocking double reversals", () => {
  const store = new LedgerStore();

  const original = store.append({
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    deltaMinor: 1000,
    kind: "adjustment",
    timestampReal: 1000,
    source: { type: "manual", reason: "Mistaken bonus" }
  });
  assert.equal(original.ok, true);
  if (!original.ok) return;

  // 1. Create valid reversal
  const reversal = store.createReversal(original.value.id, {
    type: "manual",
    reason: "Correcting mistaken bonus"
  });
  assert.equal(reversal.ok, true);
  if (reversal.ok) {
    assert.equal(reversal.value.kind, "reversal");
    assert.equal(reversal.value.deltaMinor, -1000); // exactly opposing
    assert.equal(reversal.value.reversesEntryId, original.value.id);
    assert.equal(reversal.value.sequence, 2);
  }

  // Original entry remains in store and unchanged
  const fetchedOrig = store.get(original.value.id);
  assert.ok(fetchedOrig);
  assert.equal(fetchedOrig.deltaMinor, 1000);

  // 2. Double reversal attempt must be REJECTED (DEC-17206)
  const doubleRev = store.createReversal(original.value.id, {
    type: "manual",
    reason: "Trying to reverse again"
  });
  assert.equal(doubleRev.ok, false);
  assert.equal(doubleRev.error.code, "DM_ECON_REVERSAL_ALREADY_EXISTS");

  // 3. Attempting to reverse a reversal must be REJECTED (DEC-17206)
  if (reversal.ok) {
    const revOfRev = store.createReversal(reversal.value.id, {
      type: "manual",
      reason: "Reverse the reversal"
    });
    assert.equal(revOfRev.ok, false);
    assert.equal(revOfRev.error.code, "DM_ECON_CANNOT_REVERSE_REVERSAL");
  }

  // 4. Non-existent entry reversal attempt
  const nonExistent = store.createReversal("led_non_existent", { type: "manual" });
  assert.equal(nonExistent.ok, false);
  assert.equal(nonExistent.error.code, "DM_ECON_LEDGER_ENTRY_NOT_FOUND");
});
