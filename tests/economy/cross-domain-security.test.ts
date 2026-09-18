import test from "node:test";
import assert from "node:assert/strict";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { createDefaultResourceRegistry } from "../../src/economy/definitions/resource-registry.js";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";
import { ReservationStore } from "../../src/economy/reservations/reservation-store.js";
import { EconomyService } from "../../src/economy/services/economy-service.js";
import { LockManager } from "../../src/mutations/lock-manager.js";

const baseRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Security Domain", description: "" },
    classification: { kind: "base", scale: "small", tags: [] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function createMockDoc(id: string, name: string): IdentifiedJournalEntryDocumentLike {
  let currentFlags: Readonly<Record<string, unknown>> = {
    "domain-manager": JSON.parse(JSON.stringify(baseRecord))
  };
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return name; },
    get flags() { return currentFlags; },
    get ownership() { return { default: 3 }; },
    update: async (data: Record<string, unknown>) => {
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": payload };
      }
    }
  };
}

function createStore(docs: IdentifiedJournalEntryDocumentLike[]): DomainDocumentStore {
  const map = new Map<string, IdentifiedJournalEntryDocumentLike>();
  for (const d of docs) {
    map.set(d.id, d);
    map.set(d.uuid, d);
  }
  return {
    get: (idOrUuid: string) => {
      const clean = idOrUuid.startsWith("JournalEntry.") ? idOrUuid.slice("JournalEntry.".length) : idOrUuid;
      return map.get(idOrUuid) ?? map.get(clean);
    },
    list: () => [...new Set(map.values())],
    create: async () => { throw new Error("not used"); }
  };
}

test("G4-AUD-003: Strict cross-domain integrity blocks consuming reservations of other domains", async () => {
  const docAlpha = createMockDoc("dom-alpha", "Realm Alpha");
  const docBeta = createMockDoc("dom-beta", "Realm Beta");
  const domains = new StorageDomainRepository(createStore([docAlpha, docBeta]));
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();

  const economy = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  // Create accounts in both domains
  await economy.createAccount({
    domainUuid: docAlpha.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 1000
  });
  await economy.createAccount({
    domainUuid: docBeta.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 500
  });

  // Create a reservation on Alpha
  const resvRes = await economy.reserve({
    domainUuid: docAlpha.uuid,
    resourceId: "domain-manager:treasury",
    amountMinor: 300,
    source: { type: "project", ref: "alpha-bridge" }
  });
  assert.equal(resvRes.ok, true);
  const alphaReservationId = resvRes.value.id;

  // Adversarial attempt: Beta tries to consume Alpha's reservation
  const attackConsumeRes = await economy.consumeReservation({
    domainUuid: docBeta.uuid,
    reservationId: alphaReservationId,
    amountMinor: 100,
    reason: "Illegitimate cross-domain claim"
  });

  assert.equal(attackConsumeRes.ok, false);
  assert.equal(attackConsumeRes.error.code, "DM_ECON_RESERVATION_DOMAIN_MISMATCH");

  // Verify Alpha's reservation is unchanged
  const rAlpha = reservationStore.get(alphaReservationId)!;
  assert.equal(rAlpha.remainingAmountMinor, 300);
  assert.equal(rAlpha.status, "active");

  // Verify Beta's balance was NOT debited
  const betaAcc = (await economy.getAccount(docBeta.uuid, "domain-manager:treasury")).value!;
  assert.equal(betaAcc.mode === "native" ? betaAcc.balanceMinor : null, 500);

  // Adversarial attempt: Beta tries to release Alpha's reservation
  const attackReleaseRes = await economy.releaseReservation({
    domainUuid: docBeta.uuid,
    reservationId: alphaReservationId,
    amountMinor: 100
  });

  assert.equal(attackReleaseRes.ok, false);
  assert.equal(attackReleaseRes.error.code, "DM_ECON_RESERVATION_DOMAIN_MISMATCH");

  // Legitimate consumption by Alpha works
  const validConsumeRes = await economy.consumeReservation({
    domainUuid: docAlpha.uuid,
    reservationId: alphaReservationId,
    amountMinor: 100,
    reason: "Legitimate consumption"
  });
  assert.equal(validConsumeRes.ok, true);
  assert.equal(validConsumeRes.value.reservation.remainingAmountMinor, 200);

  const alphaAcc = (await economy.getAccount(docAlpha.uuid, "domain-manager:treasury")).value!;
  assert.equal(alphaAcc.mode === "native" ? alphaAcc.balanceMinor : null, 900);
});

test("G4-AUD-003: Reversal rejects entry domain mismatch", async () => {
  const docAlpha = createMockDoc("dom-alpha-rev", "Alpha Rev");
  const docBeta = createMockDoc("dom-beta-rev", "Beta Rev");
  const domains = new StorageDomainRepository(createStore([docAlpha, docBeta]));
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();

  const economy = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  await economy.createAccount({
    domainUuid: docAlpha.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 1000
  });

  // Adjust on Alpha
  const adj = await economy.commitAdjust({
    domainUuid: docAlpha.uuid,
    resourceId: "domain-manager:treasury",
    deltaMinor: 200,
    reason: "Alpha adjust"
  });
  assert.equal(adj.ok, true);
  const entryId = adj.value.entry.id;

  // Try to reverse Alpha's entry under Beta's domainUuid
  const revMismatch = await economy.reverseLedgerEntry({
    domainUuid: docBeta.uuid,
    entryId,
    reason: "Malicious reverse under other domain"
  });

  assert.equal(revMismatch.ok, false);
  assert.equal(revMismatch.error.code, "DM_ECON_DOMAIN_MISMATCH");
});
