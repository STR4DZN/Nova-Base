import test from "node:test";
import assert from "node:assert/strict";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import {
  ResourceDefinitionRegistry,
  createDefaultResourceRegistry
} from "../../src/economy/definitions/resource-registry.js";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";
import { ReservationStore } from "../../src/economy/reservations/reservation-store.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { EconomyService } from "../../src/economy/services/economy-service.js";
import { registerEconomyCommands } from "../../src/economy/commands/economy-commands.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { RecoveryService } from "../../src/mutations/recovery-service.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";

const defaultRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Economy Test Domain", description: "Testing" },
    classification: { kind: "base", scale: "small", tags: ["economy"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function document(
  id: string,
  name: string,
  value = defaultRecord,
  ownership: Record<string, number | string> = {}
): IdentifiedJournalEntryDocumentLike {
  let currentName = name;
  let currentFlags: Readonly<Record<string, unknown>> = { "domain-manager": value };
  let currentOwnership: Record<string, number | string> = { ...ownership };
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return currentName; },
    get flags() { return currentFlags; },
    get ownership() { return currentOwnership; },
    update: async (data: Record<string, unknown>) => {
      if (typeof data.name === "string") currentName = data.name;
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": payload };
      }
      if (data.ownership !== undefined) {
        currentOwnership = { ...(data.ownership as any) };
      }
    }
  };
}

function createStore(initialDocs: IdentifiedJournalEntryDocumentLike[] = []): DomainDocumentStore {
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  let nextId = 1;

  function registerDoc(doc: IdentifiedJournalEntryDocumentLike) {
    byKey.set(doc.id, doc);
    byKey.set(doc.uuid, doc);
  }

  for (const doc of initialDocs) {
    registerDoc(doc);
  }

  return {
    get: (idOrUuid) => {
      const clean = idOrUuid.startsWith("JournalEntry.")
        ? idOrUuid.slice("JournalEntry.".length)
        : idOrUuid;
      return byKey.get(idOrUuid) ?? byKey.get(clean);
    },
    list: () => [...new Set(byKey.values())],
    create: async (data) => {
      const id = `je-${nextId++}`;
      const doc = document(id, data.name, data.flags["domain-manager"] as any, (data.ownership ?? {}) as any);
      registerDoc(doc);
      return doc;
    }
  };
}

function setupEconomyHarness() {
  const docA = document("dom-a", "Domain Alpha", defaultRecord, { default: 3 });
  const docB = document("dom-b", "Domain Beta", defaultRecord, { default: 3 });
  const store = createStore([docA, docB]);
  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore();
  const recoveryService = new RecoveryService({ transactionStore, lockManager });

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    recoveryService
  });

  return {
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    economyService,
    domainAUuid: docA.uuid,
    domainBUuid: docB.uuid
  };
}

test("G4.7: createAccount creates account and generates opening-balance ledger entry when initialBalance > 0", async () => {
  const h = setupEconomyHarness();

  // Create account with initial balance 1000
  const accRes = await h.economyService.createAccount({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 1000,
    baseCapacityMinor: null,
    reason: "Initial Treasury setup"
  });

  assert.equal(accRes.ok, true);
  if (accRes.ok) {
    assert.equal(accRes.value.balanceMinor, 1000);
    assert.equal(accRes.value.resourceId, "domain-manager:treasury");
  }

  // Ledger must have 1 opening-balance entry
  const entries = h.ledgerStore.query({ domainUuid: h.domainAUuid });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "opening-balance");
  assert.equal(entries[0].deltaMinor, 1000);

  // Duplicate account in same domain rejected
  const dupRes = await h.economyService.createAccount({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 500
  });
  assert.equal(dupRes.ok, false);
  if (!dupRes.ok) {
    assert.equal(dupRes.error.code, "DM_ECON_ACCOUNT_ALREADY_EXISTS");
  }
});

test("G4.7: adjust preview and commit enforce reasons, safe delta, and capacity", async () => {
  const h = setupEconomyHarness();

  await h.economyService.createAccount({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:supplies",
    initialBalanceMinor: 200,
    baseCapacityMinor: 1000
  });

  // Preview adjust
  const previewRes = await h.economyService.previewAdjust({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:supplies",
    deltaMinor: 300,
    reason: "Harvest surplus"
  });
  assert.equal(previewRes.ok, true);
  if (previewRes.ok) {
    assert.equal(previewRes.value.isExecutable, true);
    assert.equal(previewRes.value.ledgerIntents.length, 1);
    assert.equal(previewRes.value.ledgerIntents[0].deltaMinor, 300);
  }

  // Commit adjust
  const commitRes = await h.economyService.commitAdjust({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:supplies",
    deltaMinor: 300,
    reason: "Harvest surplus"
  });
  assert.equal(commitRes.ok, true);
  if (commitRes.ok) {
    assert.equal(commitRes.value.account.balanceMinor, 500);
    assert.equal(commitRes.value.entry.kind, "adjustment");
    assert.equal(commitRes.value.entry.deltaMinor, 300);
  }

  // Adjust without reason rejected (DEC-16875)
  const noReason = await h.economyService.commitAdjust({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:supplies",
    deltaMinor: 50,
    reason: ""
  });
  assert.equal(noReason.ok, false);
  if (!noReason.ok) {
    assert.equal(noReason.error.code, "DM_ECON_ADJUST_REASON_REQUIRED");
  }

  // Adjust exceeding capacity under default "block" policy rejected
  const exceedCap = await h.economyService.commitAdjust({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:supplies",
    deltaMinor: 600, // 500 + 600 = 1100 > 1000
    reason: "Too much grain"
  });
  assert.equal(exceedCap.ok, false);
  if (!exceedCap.ok) {
    assert.equal(exceedCap.error.code, "DM_ECON_CAPACITY_EXCEEDED");
  }
});

test("G4.7: transfer moves resources atomically, enforces mass conservation, and orders multi-locks", async () => {
  const h = setupEconomyHarness();

  await h.economyService.createAccount({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 1000
  });

  await h.economyService.createAccount({
    domainUuid: h.domainBUuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 100
  });

  // Transfer 400 from A to B
  const transferRes = await h.economyService.commitTransfer({
    sourceDomainUuid: h.domainAUuid,
    targetDomainUuid: h.domainBUuid,
    resourceId: "domain-manager:treasury",
    amountMinor: 400,
    reason: "Aid package"
  });

  assert.equal(transferRes.ok, true);
  if (transferRes.ok) {
    assert.equal(transferRes.value.sourceAccount.balanceMinor, 600);
    assert.equal(transferRes.value.targetAccount.balanceMinor, 500);

    // Mass conservation invariant (DEC-17211–17222)
    assert.equal(transferRes.value.debitEntry.deltaMinor, -400);
    assert.equal(transferRes.value.creditEntry.deltaMinor, 400);
    assert.equal(transferRes.value.debitEntry.transactionId, transferRes.value.creditEntry.transactionId);
  }

  // Same domain transfer rejected
  const sameDomain = await h.economyService.commitTransfer({
    sourceDomainUuid: h.domainAUuid,
    targetDomainUuid: h.domainAUuid,
    resourceId: "domain-manager:treasury",
    amountMinor: 100
  });
  assert.equal(sameDomain.ok, false);
  if (!sameDomain.ok) {
    assert.equal(sameDomain.error.code, "DM_ECON_TRANSFER_SAME_DOMAIN");
  }

  // Transfer exceeding available funds rejected
  const overspend = await h.economyService.commitTransfer({
    sourceDomainUuid: h.domainAUuid,
    targetDomainUuid: h.domainBUuid,
    resourceId: "domain-manager:treasury",
    amountMinor: 700 // only 600 available
  });
  assert.equal(overspend.ok, false);
  if (!overspend.ok) {
    assert.equal(overspend.error.code, "DM_ECON_INSUFFICIENT_AVAILABLE");
  }
});

test("G4.7: convert converts between two resources atomically with paired ledger entries", async () => {
  const h = setupEconomyHarness();

  await h.economyService.createAccount({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 1000
  });

  await h.economyService.createAccount({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:materials",
    initialBalanceMinor: 0
  });

  // Convert 300 treasury to 150 materials
  const convertRes = await h.economyService.commitConvert({
    domainUuid: h.domainAUuid,
    fromResourceId: "domain-manager:treasury",
    toResourceId: "domain-manager:materials",
    fromAmountMinor: 300,
    toAmountMinor: 150,
    rateDescription: "2 credits = 1 material"
  });

  assert.equal(convertRes.ok, true);
  if (convertRes.ok) {
    assert.equal(convertRes.value.fromAccount.balanceMinor, 700);
    assert.equal(convertRes.value.toAccount.balanceMinor, 150);
    assert.equal(convertRes.value.debitEntry.kind, "conversion-debit");
    assert.equal(convertRes.value.debitEntry.deltaMinor, -300);
    assert.equal(convertRes.value.creditEntry.kind, "conversion-credit");
    assert.equal(convertRes.value.creditEntry.deltaMinor, 150);
    assert.equal(convertRes.value.debitEntry.transactionId, convertRes.value.creditEntry.transactionId);
  }
});

test("G4.7: reservation lifecycle: reserve, consume, release, and availability separation", async () => {
  const h = setupEconomyHarness();

  await h.economyService.createAccount({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:supplies",
    initialBalanceMinor: 500
  });

  // Reserve 200 supplies
  const reserveRes = await h.economyService.reserve({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:supplies",
    amountMinor: 200,
    source: { type: "project", ref: "proj_build_barracks" }
  });
  assert.equal(reserveRes.ok, true);

  // Balance NOT altered, no ledger entry generated (DEC-17049–17054)
  const availRes = await h.economyService.getAccountAvailability(
    h.domainAUuid,
    "domain-manager:supplies"
  );
  assert.equal(availRes.ok, true);
  if (availRes.ok && availRes.value) {
    assert.equal(availRes.value.balanceMinor, 500);
    assert.equal(availRes.value.reservedMinor, 200);
    assert.equal(availRes.value.availableMinor, 300); // 500 - 200
  }

  // Consume 80 from reservation
  if (reserveRes.ok) {
    const consumeRes = await h.economyService.consumeReservation({
      domainUuid: h.domainAUuid,
      reservationId: reserveRes.value.id,
      amountMinor: 80,
      reason: "Work crew fed"
    });
    assert.equal(consumeRes.ok, true);
    if (consumeRes.ok) {
      assert.equal(consumeRes.value.account.balanceMinor, 420); // 500 - 80
      assert.equal(consumeRes.value.entry.kind, "consumption");
      assert.equal(consumeRes.value.entry.deltaMinor, -80);
      assert.equal(consumeRes.value.entry.reservationId, reserveRes.value.id);
    }

    // Remaining reservation is 120 (200 - 80)
    // Available is 420 - 120 = 300
    const afterConsume = await h.economyService.getAccountAvailability(
      h.domainAUuid,
      "domain-manager:supplies"
    );
    assert.equal(afterConsume.ok, true);
    if (afterConsume.ok && afterConsume.value) {
      assert.equal(afterConsume.value.balanceMinor, 420);
      assert.equal(afterConsume.value.reservedMinor, 120);
      assert.equal(afterConsume.value.availableMinor, 300);
    }

    // Release remaining reservation (120)
    const releaseRes = await h.economyService.releaseReservation({
      domainUuid: h.domainAUuid,
      reservationId: reserveRes.value.id
    });
    assert.equal(releaseRes.ok, true);

    // After release: balance still 420, reserved 0, available 420 (DEC-17082–17087)
    const afterRelease = await h.economyService.getAccountAvailability(
      h.domainAUuid,
      "domain-manager:supplies"
    );
    assert.equal(afterRelease.ok, true);
    if (afterRelease.ok && afterRelease.value) {
      assert.equal(afterRelease.value.balanceMinor, 420);
      assert.equal(afterRelease.value.reservedMinor, 0);
      assert.equal(afterRelease.value.availableMinor, 420);
    }
  }
});

test("G4.7: reverseLedgerEntry compensates balance and prevents double reversal", async () => {
  const h = setupEconomyHarness();

  await h.economyService.createAccount({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 1000
  });

  // Adjust +300
  const adj = await h.economyService.commitAdjust({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:treasury",
    deltaMinor: 300,
    reason: "Tax collection"
  });
  assert.equal(adj.ok, true);
  if (adj.ok) {
    assert.equal(adj.value.account.balanceMinor, 1300);
    const entryId = adj.value.entry.id;

    // Reverse adjustment
    const rev = await h.economyService.reverseLedgerEntry({
      domainUuid: h.domainAUuid,
      entryId,
      reason: "Tax calculation error refund"
    });
    assert.equal(rev.ok, true);
    if (rev.ok) {
      assert.equal(rev.value.account.balanceMinor, 1000); // restored!
      assert.equal(rev.value.reversalEntry.deltaMinor, -300);
      assert.equal(rev.value.reversalEntry.reversesEntryId, entryId);
    }

    // Anti-double reversal check (DEC-17206)
    const doubleRev = await h.economyService.reverseLedgerEntry({
      domainUuid: h.domainAUuid,
      entryId,
      reason: "Try to reverse again"
    });
    assert.equal(doubleRev.ok, false);
    if (!doubleRev.ok) {
      assert.equal(doubleRev.error.code, "DM_ECON_REVERSAL_ALREADY_EXISTS");
    }
  }
});

test("G4.7: CommandBus executes economy:transfer end-to-end", async () => {
  const h = setupEconomyHarness();

  await h.economyService.createAccount({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 1000
  });

  await h.economyService.createAccount({
    domainUuid: h.domainBUuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 200
  });

  const registry = new CommandRegistry();
  registerEconomyCommands({
    registry,
    economyService: h.economyService,
    domains: h.domains
  });

  const users = [
    { id: "gm-1", isGM: true, active: true }
  ];
  const authorityService = new PrimaryAuthorityService(
    {
      getUsers: () => users,
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-1"
    },
    {
      authorityUserId: "gm-1",
      authorityEpoch: 1,
      initialized: true
    }
  );

  const commandBus = new CommandBus({
    registry,
    authorityService
  });

  const transferCmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:transfer",
    payload: {
      sourceDomainUuid: h.domainAUuid,
      targetDomainUuid: h.domainBUuid,
      resourceId: "domain-manager:treasury",
      amountMinor: 350,
      reason: "Bus test transfer"
    },
    issuedAtReal: Date.now()
  };

  const receiptRes = await commandBus.execute(transferCmd);
  assert.equal(receiptRes.ok, true);
  if (receiptRes.ok) {
    assert.equal(receiptRes.value.status, "executed");
  }

  // Verify accounts
  const accA = await h.economyService.getAccount(h.domainAUuid, "domain-manager:treasury");
  assert.equal(accA.ok, true);
  if (accA.ok && accA.value?.mode === "native") {
    assert.equal(accA.value.balanceMinor, 650); // 1000 - 350
  }

  const accB = await h.economyService.getAccount(h.domainBUuid, "domain-manager:treasury");
  assert.equal(accB.ok, true);
  if (accB.ok && accB.value?.mode === "native") {
    assert.equal(accB.value.balanceMinor, 550); // 200 + 350
  }
});

test("G4-REVAL3-002: Command envelope forged authorityEpoch does not override authenticated ctx.authorityEpoch in TransactionRecord", async () => {
  const h = setupEconomyHarness();

  await h.economyService.createAccount({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 1000
  });

  await h.economyService.createAccount({
    domainUuid: h.domainBUuid,
    resourceId: "domain-manager:treasury",
    initialBalanceMinor: 200
  });

  const registry = new CommandRegistry();
  registerEconomyCommands({
    registry,
    economyService: h.economyService,
    domains: h.domains
  });

  const users = [
    { id: "gm-1", isGM: true, active: true }
  ];
  const authorityService = new PrimaryAuthorityService(
    {
      getUsers: () => users,
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-1"
    },
    {
      authorityUserId: "gm-1",
      authorityEpoch: 7,
      initialized: true
    }
  );

  const commandBus = new CommandBus({
    registry,
    authorityService
  });

  const forgedEpochCmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    authorityEpoch: 999999, // Forged epoch in untrusted command envelope!
    type: "economy:transfer",
    payload: {
      sourceDomainUuid: h.domainAUuid,
      targetDomainUuid: h.domainBUuid,
      resourceId: "domain-manager:treasury",
      amountMinor: 100,
      reason: "Forged epoch adversarial transfer"
    },
    issuedAtReal: Date.now()
  };

  const receiptRes = await commandBus.execute(forgedEpochCmd);
  assert.equal(receiptRes.ok, true);
  if (receiptRes.ok) {
    assert.equal(receiptRes.value.status, "executed");
    const txId = receiptRes.value.result.transactionId;
    const tx = h.transactionStore.get(txId);
    assert.ok(tx, "TransactionRecord must exist");
    assert.equal(tx.authorityEpoch, 7, "TransactionRecord must reflect authenticated ctx.authorityEpoch (7), NOT forged command.authorityEpoch (999999)");
  }
});

