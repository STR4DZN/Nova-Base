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
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { RecoveryService } from "../../src/mutations/recovery-service.js";

const testRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Fault Test Domain", description: "" },
    classification: { kind: "base", scale: "small", tags: [] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function createFaultInjectableDoc(
  id: string,
  name: string,
  failOnUpdate: { shouldFail: boolean }
): IdentifiedJournalEntryDocumentLike {
  let currentFlags: Readonly<Record<string, unknown>> = {
    "domain-manager": JSON.parse(JSON.stringify(testRecord))
  };
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return name; },
    get flags() { return currentFlags; },
    get ownership() { return { default: 3 }; },
    update: async (data: Record<string, unknown>) => {
      if (failOnUpdate.shouldFail) {
        throw new Error(`Injected simulated disk/network write failure on ${id}`);
      }
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": payload };
      }
    }
  };
}

test("G4-AUD-002: Transfer step-2 failure triggers complete automatic rollback (atomic conservation)", async () => {
  const failControl = { shouldFail: false };
  const docSource = createFaultInjectableDoc("dom-src", "Source Domain", { shouldFail: false });
  const docDest = createFaultInjectableDoc("dom-dst", "Destination Domain", failControl);

  const docMap = new Map<string, IdentifiedJournalEntryDocumentLike>([
    [docSource.id, docSource],
    [docSource.uuid, docSource],
    [docDest.id, docDest],
    [docDest.uuid, docDest]
  ]);

  const store: DomainDocumentStore = {
    get: (idOrUuid: string) => {
      const clean = idOrUuid.startsWith("JournalEntry.") ? idOrUuid.slice("JournalEntry.".length) : idOrUuid;
      return docMap.get(idOrUuid) ?? docMap.get(clean);
    },
    list: () => [...new Set(docMap.values())],
    create: async () => { throw new Error("not used"); }
  };

  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore();
  const recoveryService = new RecoveryService(transactionStore, lockManager);

  const economy = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    recoveryService
  });

  // Setup initial accounts
  await economy.createAccount({
    domainUuid: docSource.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 10_000
  });

  await economy.createAccount({
    domainUuid: docDest.uuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 2_000
  });

  // Enable fault on destination update
  failControl.shouldFail = true;

  // Execute transfer that will fail at step 2
  const transferRes = await economy.commitTransfer({
    sourceDomainUuid: docSource.uuid,
    targetDomainUuid: docDest.uuid,
    resourceId: "domain-manager:treasury",
    amountMinor: 3_000,
    reason: "Transfer with injected failure"
  });

  // Must report failure
  assert.equal(transferRes.ok, false);

  // Both accounts must retain their EXACT initial balances (no money created or destroyed)
  const srcAcc = (await economy.getAccount(docSource.uuid, "domain-manager:treasury")).value!;
  const dstAcc = (await economy.getAccount(docDest.uuid, "domain-manager:treasury")).value!;

  assert.equal(srcAcc.mode === "native" ? srcAcc.balanceMinor : null, 10_000, "Source balance must be rolled back to 10,000");
  assert.equal(dstAcc.mode === "native" ? dstAcc.balanceMinor : null, 2_000, "Destination balance must remain 2,000");

  // No phantom transfer entries should remain in the ledger
  const transferEntries = ledgerStore.query({ resourceId: "domain-manager:treasury" })
    .filter((e) => e.kind === "transfer_out" || e.kind === "transfer_in");
  assert.equal(transferEntries.length, 0, "No transfer entries should be committed on aborted transaction");

  // Now disable fault and retry: transfer succeeds completely
  failControl.shouldFail = false;

  const retryRes = await economy.commitTransfer({
    sourceDomainUuid: docSource.uuid,
    targetDomainUuid: docDest.uuid,
    resourceId: "domain-manager:treasury",
    amountMinor: 3_000,
    reason: "Retried transfer after issue resolution"
  });

  assert.equal(retryRes.ok, true);

  const finalSrc = (await economy.getAccount(docSource.uuid, "domain-manager:treasury")).value!;
  const finalDst = (await economy.getAccount(docDest.uuid, "domain-manager:treasury")).value!;

  assert.equal(finalSrc.mode === "native" ? finalSrc.balanceMinor : null, 7_000);
  assert.equal(finalDst.mode === "native" ? finalDst.balanceMinor : null, 5_000);
  assert.equal((finalSrc.mode === "native" ? finalSrc.balanceMinor : 0) + (finalDst.mode === "native" ? finalDst.balanceMinor : 0), 12_000);
});
