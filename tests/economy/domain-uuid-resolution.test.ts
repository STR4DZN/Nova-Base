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
import { LockManager } from "../../src/mutations/lock-manager.js";
import { EconomyService } from "../../src/economy/services/economy-service.js";
import { DefaultPublicEconomyApi } from "../../src/economy/services/public-economy-api.js";
import { NativeResourceProvider } from "../../src/economy/providers/native-resource-provider.js";
import { EconomyAggregationProvider } from "../../src/economy/aggregation/economy-aggregation-provider.js";
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
    identity: { aliases: [], summary: "Strict Resolution Test Domain", description: "Testing" },
    classification: { kind: "base", scale: "small", tags: ["economy"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function createStrictDocument(
  id: string,
  name: string,
  value = defaultRecord,
  ownership: Record<string, number | string> = { default: 3 }
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

/**
 * Creates a store that strictly matches Foundry's game.journal.get(id) behavior:
 * - Looks up strictly by document ID (e.g. "06hTHcMj5SOqMGDv").
 * - Returns undefined if passed a full UUID (e.g. "JournalEntry.06hTHcMj5SOqMGDv").
 */
function createStrictDocumentStore(initialDocs: IdentifiedJournalEntryDocumentLike[] = []): DomainDocumentStore {
  const byId = new Map<string, IdentifiedJournalEntryDocumentLike>();
  let nextId = 1;

  for (const doc of initialDocs) {
    byId.set(doc.id, doc);
  }

  return {
    get: (id: string) => {
      if (id.startsWith("JournalEntry.")) {
        // STRICT RESOLUTION CHECK: In Foundry VTT, game.journal.get("JournalEntry.<id>") returns undefined.
        return undefined;
      }
      return byId.get(id);
    },
    list: () => [...byId.values()],
    create: async (data) => {
      const id = `je-${nextId++}`;
      const doc = createStrictDocument(id, data.name, data.flags["domain-manager"] as any, (data.ownership ?? {}) as any);
      byId.set(doc.id, doc);
      return doc;
    }
  };
}

function setupStrictHarness() {
  const docA = createStrictDocument("06hTHcMj5SOqMGDv", "Domain Alpha");
  const docB = createStrictDocument("78kXyZp91ABcDeFg", "Domain Beta");
  const store = createStrictDocumentStore([docA, docB]);
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

  const commandRegistry = new CommandRegistry();
  registerEconomyCommands({
    registry: commandRegistry,
    economyService,
    domains,
    resourceRegistry
  });

  const users = [{ id: "gm-user-1", isGM: true, active: true }];
  const authorityService = new PrimaryAuthorityService(
    {
      getUsers: () => users,
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-user-1"
    },
    {
      authorityUserId: "gm-user-1",
      authorityEpoch: 1,
      initialized: true
    }
  );

  const commandBus = new CommandBus({
    registry: commandRegistry,
    authorityService
  });

  const publicApi = new DefaultPublicEconomyApi({
    commandBus,
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore
  });

  const nativeProvider = new NativeResourceProvider(domains);
  const aggregationProvider = new EconomyAggregationProvider({
    domains,
    resourceRegistry,
    reservationStore
  });

  return {
    docA,
    docB,
    domainAUuid: docA.uuid, // "JournalEntry.06hTHcMj5SOqMGDv"
    domainBUuid: docB.uuid, // "JournalEntry.78kXyZp91ABcDeFg"
    domains,
    economyService,
    commandBus,
    publicApi,
    nativeProvider,
    aggregationProvider,
    ledgerStore,
    reservationStore
  };
}

test("Strict Store Mock rejects JournalEntry.<id> lookup to guarantee no bypass", () => {
  const doc = createStrictDocument("testDoc123", "Test");
  const store = createStrictDocumentStore([doc]);
  assert.equal(store.get("testDoc123")?.id, "testDoc123");
  assert.equal(store.get("JournalEntry.testDoc123"), undefined);
});

test("Strict Resolution 1: economy:create-account accepts full JournalEntry.<id> UUID", async () => {
  const h = setupStrictHarness();

  const cmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainAUuid, // "JournalEntry.06hTHcMj5SOqMGDv"
      resourceId: "domain-manager:treasury",
      initialBalanceMinor: 100000,
      reason: "Initial Treasury Creation"
    },
    issuedAtReal: Date.now()
  };

  const receipt = await h.commandBus.execute(cmd);
  assert.equal(receipt.ok, true, `Failed: ${JSON.stringify(receipt)}`);

  const accountRes = await h.economyService.getAccount(h.domainAUuid, "domain-manager:treasury");
  assert.equal(accountRes.ok, true);
  if (accountRes.ok && accountRes.value?.mode === "native") {
    assert.equal(accountRes.value.balanceMinor, 100000);
  }
});

test("Strict Resolution 2: economy:adjust accepts full JournalEntry.<id> UUID", async () => {
  const h = setupStrictHarness();

  // Initialize account
  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainAUuid,
      resourceId: "domain-manager:treasury",
      initialBalanceMinor: 50000
    },
    issuedAtReal: Date.now()
  });

  // Adjust with delta +15000
  const adjustCmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:adjust",
    payload: {
      domainUuid: h.domainAUuid, // "JournalEntry.06hTHcMj5SOqMGDv"
      resourceId: "domain-manager:treasury",
      deltaMinor: 15000,
      reason: "Tax collection"
    },
    issuedAtReal: Date.now()
  };

  const receipt = await h.commandBus.execute(adjustCmd);
  assert.equal(receipt.ok, true, `Adjust failed: ${JSON.stringify(receipt)}`);

  const accountRes = await h.economyService.getAccount(h.domainAUuid, "domain-manager:treasury");
  assert.equal(accountRes.ok, true);
  if (accountRes.ok && accountRes.value?.mode === "native") {
    assert.equal(accountRes.value.balanceMinor, 65000);
  }
});

test("Strict Resolution 3: economy:transfer accepts full JournalEntry.<id> UUID on source and target", async () => {
  const h = setupStrictHarness();

  // Create accounts on domain A and domain B
  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainAUuid,
      resourceId: "domain-manager:treasury",
      initialBalanceMinor: 100000
    },
    issuedAtReal: Date.now()
  });

  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainBUuid,
      resourceId: "domain-manager:treasury",
      initialBalanceMinor: 20000
    },
    issuedAtReal: Date.now()
  });

  // Execute transfer between domains using full JournalEntry UUIDs
  const transferCmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:transfer",
    payload: {
      sourceDomainUuid: h.domainAUuid, // "JournalEntry.06hTHcMj5SOqMGDv"
      targetDomainUuid: h.domainBUuid, // "JournalEntry.78kXyZp91ABcDeFg"
      resourceId: "domain-manager:treasury",
      amountMinor: 35000,
      reason: "Tribute payment"
    },
    issuedAtReal: Date.now()
  };

  const receipt = await h.commandBus.execute(transferCmd);
  assert.equal(receipt.ok, true, `Transfer failed: ${JSON.stringify(receipt)}`);

  const accA = await h.economyService.getAccount(h.domainAUuid, "domain-manager:treasury");
  assert.equal(accA.ok, true);
  if (accA.ok && accA.value?.mode === "native") {
    assert.equal(accA.value.balanceMinor, 65000);
  }

  const accB = await h.economyService.getAccount(h.domainBUuid, "domain-manager:treasury");
  assert.equal(accB.ok, true);
  if (accB.ok && accB.value?.mode === "native") {
    assert.equal(accB.value.balanceMinor, 55000);
  }
});

test("Strict Resolution 4: economy:convert accepts full JournalEntry.<id> UUID", async () => {
  const h = setupStrictHarness();

  // Create treasury and supplies accounts on domain A
  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainAUuid,
      resourceId: "domain-manager:treasury",
      initialBalanceMinor: 80000
    },
    issuedAtReal: Date.now()
  });

  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainAUuid,
      resourceId: "domain-manager:supplies",
      initialBalanceMinor: 10000
    },
    issuedAtReal: Date.now()
  });

  // Convert 20000 treasury -> 40000 supplies
  const convertCmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:convert",
    payload: {
      domainUuid: h.domainAUuid, // "JournalEntry.06hTHcMj5SOqMGDv"
      fromResourceId: "domain-manager:treasury",
      toResourceId: "domain-manager:supplies",
      fromAmountMinor: 20000,
      toAmountMinor: 40000,
      rateDescription: "1 treasury = 2 supplies",
      reason: "Bulk supplies purchase"
    },
    issuedAtReal: Date.now()
  };

  const receipt = await h.commandBus.execute(convertCmd);
  assert.equal(receipt.ok, true, `Convert failed: ${JSON.stringify(receipt)}`);

  const accTreasury = await h.economyService.getAccount(h.domainAUuid, "domain-manager:treasury");
  assert.equal(accTreasury.ok, true);
  if (accTreasury.ok && accTreasury.value?.mode === "native") {
    assert.equal(accTreasury.value.balanceMinor, 60000);
  }

  const accSupplies = await h.economyService.getAccount(h.domainAUuid, "domain-manager:supplies");
  assert.equal(accSupplies.ok, true);
  if (accSupplies.ok && accSupplies.value?.mode === "native") {
    assert.equal(accSupplies.value.balanceMinor, 50000);
  }
});

test("Strict Resolution 5: economy:reserve and economy:consume-reservation accept full JournalEntry.<id> UUID", async () => {
  const h = setupStrictHarness();

  // Create treasury account
  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainAUuid,
      resourceId: "domain-manager:treasury",
      initialBalanceMinor: 50000
    },
    issuedAtReal: Date.now()
  });

  // Reserve 15000
  const reserveCmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:reserve",
    payload: {
      domainUuid: h.domainAUuid, // "JournalEntry.06hTHcMj5SOqMGDv"
      resourceId: "domain-manager:treasury",
      amountMinor: 15000,
      source: { type: "manual", reason: "Order hold", ref: "ORD-001" }
    },
    issuedAtReal: Date.now()
  };

  const reserveReceipt = await h.commandBus.execute(reserveCmd);
  assert.equal(reserveReceipt.ok, true, `Reserve failed: ${JSON.stringify(reserveReceipt)}`);
  const reservation = reserveReceipt.value?.result as any;
  assert.ok(reservation?.id, "Reservation ID must be present");

  // Consume reservation
  const consumeCmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:consume-reservation",
    payload: {
      domainUuid: h.domainAUuid, // "JournalEntry.06hTHcMj5SOqMGDv"
      reservationId: reservation.id,
      amountMinor: 15000,
      reason: "Order fulfilled"
    },
    issuedAtReal: Date.now()
  };

  const consumeReceipt = await h.commandBus.execute(consumeCmd);
  assert.equal(consumeReceipt.ok, true, `Consume reservation failed: ${JSON.stringify(consumeReceipt)}`);

  const acc = await h.economyService.getAccount(h.domainAUuid, "domain-manager:treasury");
  assert.equal(acc.ok, true);
  if (acc.ok && acc.value?.mode === "native") {
    assert.equal(acc.value.balanceMinor, 35000);
  }
});

test("Strict Resolution 6: economy:reversal accepts full JournalEntry.<id> UUID", async () => {
  const h = setupStrictHarness();

  // Create treasury account
  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainAUuid,
      resourceId: "domain-manager:treasury",
      initialBalanceMinor: 50000
    },
    issuedAtReal: Date.now()
  });

  // Execute an adjust to create a reversible ledger entry
  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:adjust",
    payload: {
      domainUuid: h.domainAUuid,
      resourceId: "domain-manager:treasury",
      deltaMinor: 10000,
      reason: "Incorrect bonus grant"
    },
    issuedAtReal: Date.now()
  });

  // Find the ledger entry
  const entries = h.ledgerStore.query({
    domainUuid: h.domainAUuid,
    resourceId: "domain-manager:treasury",
    kind: "adjustment"
  });
  assert.equal(entries.length, 1);
  const targetEntryId = entries[0].id;

  // Execute reversal using full JournalEntry UUID
  const reversalCmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:reversal",
    payload: {
      domainUuid: h.domainAUuid, // "JournalEntry.06hTHcMj5SOqMGDv"
      entryId: targetEntryId,
      reason: "Revoking erroneous bonus"
    },
    issuedAtReal: Date.now()
  };

  const receipt = await h.commandBus.execute(reversalCmd);
  assert.equal(receipt.ok, true, `Reversal failed: ${JSON.stringify(receipt)}`);

  const acc = await h.economyService.getAccount(h.domainAUuid, "domain-manager:treasury");
  assert.equal(acc.ok, true);
  if (acc.ok && acc.value?.mode === "native") {
    assert.equal(acc.value.balanceMinor, 50000); // 50000 + 10000 - 10000
  }
});

test("Strict Resolution 7: economy:close-account accepts full JournalEntry.<id> UUID", async () => {
  const h = setupStrictHarness();

  // Create an account with 0 initial balance
  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainAUuid,
      resourceId: "domain-manager:supplies",
      initialBalanceMinor: 0
    },
    issuedAtReal: Date.now()
  });

  // Close the account using full JournalEntry UUID
  const closeCmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:close-account",
    payload: {
      domainUuid: h.domainAUuid, // "JournalEntry.06hTHcMj5SOqMGDv"
      resourceId: "domain-manager:supplies",
      reason: "No longer needed"
    },
    issuedAtReal: Date.now()
  };

  const receipt = await h.commandBus.execute(closeCmd);
  assert.equal(receipt.ok, true, `Close account failed: ${JSON.stringify(receipt)}`);

  const acc = await h.economyService.getAccount(h.domainAUuid, "domain-manager:supplies");
  assert.equal(acc.ok, true);
  assert.equal(acc.value, undefined, "Closed account without history should be removed");
});

test("Strict Resolution 8: PublicEconomyApi, NativeResourceProvider, EconomyAggregationProvider resolve with full UUID", async () => {
  const h = setupStrictHarness();

  // Create accounts
  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainAUuid,
      resourceId: "domain-manager:treasury",
      initialBalanceMinor: 100000
    },
    issuedAtReal: Date.now()
  });

  await h.commandBus.execute({
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "economy:create-account",
    payload: {
      domainUuid: h.domainBUuid,
      resourceId: "domain-manager:treasury",
      initialBalanceMinor: 50000
    },
    issuedAtReal: Date.now()
  });

  // PublicEconomyApi.getContext
  const ctxRes = await h.publicApi.getContext(h.domainAUuid);
  assert.equal(ctxRes.ok, true, `getContext failed: ${JSON.stringify(ctxRes)}`);
  if (ctxRes.ok) {
    assert.equal(ctxRes.value.domainUuid, h.domainAUuid);
    assert.equal(ctxRes.value.accounts.length, 1);
  }

  // PublicEconomyApi.queryLedger
  const ledgerRes = await h.publicApi.queryLedger({ domainUuid: h.domainAUuid });
  assert.equal(ledgerRes.ok, true);
  if (ledgerRes.ok) {
    assert.equal(ledgerRes.value.entries.length, 1);
  }

  // NativeResourceProvider.readBalance
  const balRes = await h.nativeProvider.readBalance(h.domainAUuid, "domain-manager:treasury", "");
  assert.equal(balRes.ok, true);
  if (balRes.ok) {
    assert.equal(balRes.value.balanceMinor, 100000);
  }

  // EconomyAggregationProvider.getAggregateContext
  const agg = await h.aggregationProvider.getAggregateContext([h.domainAUuid, h.domainBUuid]);
  const treasurySummary = agg.totals.find((t) => t.resourceId === "domain-manager:treasury");
  assert.ok(treasurySummary);
  assert.equal(treasurySummary.totalBalanceMinor, 150000);
  assert.equal(treasurySummary.contributingDomainCount, 2);

  // Also verify through PublicEconomyApi.getAggregateContext
  const publicAggRes = await h.publicApi.getAggregateContext([h.domainAUuid, h.domainBUuid]);
  assert.equal(publicAggRes.ok, true);
  if (publicAggRes.ok) {
    const pubSummary = publicAggRes.value.totals.find((t) => t.resourceId === "domain-manager:treasury");
    assert.ok(pubSummary);
    assert.equal(pubSummary.totalBalanceMinor, 150000);
    assert.equal(pubSummary.contributingDomainCount, 2);
  }
});
