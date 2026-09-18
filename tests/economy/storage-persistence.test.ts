import test from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";
import { ReservationStore } from "../../src/economy/reservations/reservation-store.js";
import {
  InMemoryLedgerStorageAdapter,
  FoundryJournalLedgerStorageAdapter
} from "../../src/economy/storage/ledger-storage-adapter.js";
import {
  InMemoryReservationStorageAdapter,
  FoundryJournalReservationStorageAdapter
} from "../../src/economy/storage/reservation-storage-adapter.js";

test("G4 Persistence: LedgerStore survives reload via InMemoryLedgerStorageAdapter", async () => {
  const adapter = new InMemoryLedgerStorageAdapter();
  const store1 = new LedgerStore({ storageAdapter: adapter });

  // Append entries in first session
  const e1Res = store1.append({
    domainUuid: "dom-1",
    resourceId: "domain-manager:treasury",
    deltaMinor: 1000,
    kind: "adjustment",
    source: { type: "manual", reason: "Initial funds" }
  });
  assert.equal(e1Res.ok, true);

  const e2Res = store1.append({
    domainUuid: "dom-1",
    resourceId: "domain-manager:treasury",
    deltaMinor: -200,
    kind: "transfer-debit",
    source: { type: "command", ref: "cmd_1" }
  });
  assert.equal(e2Res.ok, true);

  // Flush to adapter
  await store1.flush();

  // Create a completely new LedgerStore simulating a server reload/restart
  const store2 = new LedgerStore({ storageAdapter: adapter });
  await store2.rehydrate();

  assert.equal(store2.count, 2);
  const entries = store2.query({ domainUuid: "dom-1" });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].sequence, 1);
  assert.equal(entries[0].deltaMinor, 1000);
  assert.equal(entries[1].sequence, 2);
  assert.equal(entries[1].deltaMinor, -200);

  // Appending in store2 continues sequence monotonically
  const e3Res = store2.append({
    domainUuid: "dom-1",
    resourceId: "domain-manager:treasury",
    deltaMinor: 500,
    kind: "adjustment",
    source: { type: "manual" }
  });
  assert.equal(e3Res.ok, true);
  assert.equal(e3Res.value.sequence, 3);
});

test("G4 Persistence: FoundryJournalLedgerStorageAdapter loads and saves to JournalEntry flags", async () => {
  let flagsData: Record<string, unknown> = {};

  const mockJournalEntry: any = {
    id: "je-ledger-1",
    uuid: "JournalEntry.je-ledger-1",
    name: "[Domain Manager] Ledger Store",
    get flags() {
      return flagsData;
    },
    update: async (data: any) => {
      if (data.flags !== undefined) {
        flagsData = { ...flagsData, ...data.flags };
      }
    }
  };

  const mockRuntime = {
    journal: {
      contents: [mockJournalEntry],
      get: (id: string) => (id === mockJournalEntry.id ? mockJournalEntry : undefined)
    },
    createJournalEntry: async (data: any) => {
      flagsData = { ...data.flags };
      return mockJournalEntry;
    }
  };

  const adapter = new FoundryJournalLedgerStorageAdapter(mockRuntime);
  const store = new LedgerStore({ storageAdapter: adapter });

  store.append({
    domainUuid: "dom-journal",
    resourceId: "domain-manager:materials",
    deltaMinor: 50,
    kind: "adjustment",
    source: { type: "manual", reason: "Journal ledger test" }
  });

  await store.flush();
  assert.ok(flagsData["domain-manager-ledger"], "Journal flags should have persisted ledger snapshot");

  // Rehydrate in a new store from the same adapter
  const storeReloaded = new LedgerStore({ storageAdapter: adapter });
  await storeReloaded.rehydrate();

  assert.equal(storeReloaded.count, 1);
  const reloadedEntry = storeReloaded.query({ domainUuid: "dom-journal" })[0];
  assert.equal(reloadedEntry.deltaMinor, 50);
  assert.equal(reloadedEntry.source.reason, "Journal ledger test");
});

test("G4 Persistence: ReservationStore survives reload and retains active reservations and events", async () => {
  const adapter = new InMemoryReservationStorageAdapter();
  const resStore1 = new ReservationStore({ storageAdapter: adapter });

  const r1Res = resStore1.create({
    domainUuid: "dom-res-1",
    resourceId: "domain-manager:supplies",
    originalAmountMinor: 500,
    source: { type: "project", ref: "proj-abc", reason: "Bridge construction" }
  });
  assert.equal(r1Res.ok, true);
  const resvId = r1Res.value.id;

  // Consume part of the reservation
  const consumeRes = resStore1.consume(resvId, 200, { reason: "Phase 1 bricks" });
  assert.equal(consumeRes.ok, true);
  assert.equal(consumeRes.value.reservation.remainingAmountMinor, 300);
  assert.equal(consumeRes.value.reservation.status, "partially-consumed");

  await resStore1.flush();

  // Rehydrate in fresh store
  const resStore2 = new ReservationStore({ storageAdapter: adapter });
  await resStore2.rehydrate();

  const restoredResv = resStore2.get(resvId);
  assert.ok(restoredResv, "Restored reservation must exist");
  assert.equal(restoredResv.originalAmountMinor, 500);
  assert.equal(restoredResv.remainingAmountMinor, 300);
  assert.equal(restoredResv.status, "partially-consumed");

  // Events must be preserved
  const events = resStore2.listEvents(resvId);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "created");
  assert.equal(events[0].deltaMinor, 500);
  assert.equal(events[1].type, "partially-consumed");
  assert.equal(events[1].deltaMinor, -200);

  // Continue operations after reload
  const releaseRes = resStore2.release(resvId, 300, { reason: "Bridge cancelled" });
  assert.equal(releaseRes.ok, true);
  assert.equal(releaseRes.value.reservation.remainingAmountMinor, 0);
  assert.equal(releaseRes.value.reservation.status, "released");
});
