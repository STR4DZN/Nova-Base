import test from "node:test";
import assert from "node:assert/strict";
import {
  type CurrencyProvider,
  type InventoryProvider,
  type ResourceProvider,
  assertDebitAllowedOnProviderBalance,
  assertProviderHealthy
} from "../../src/economy/providers/provider-types.js";
import { ProviderRegistry } from "../../src/economy/providers/provider-registry.js";
import { ok } from "../../src/core/contracts/result.js";

test("G4.8: ProviderRegistry registers providers, rejects invalid IDs, duplicates, and freezes", () => {
  const registry = new ProviderRegistry();

  const mockCurrencyProvider: CurrencyProvider = {
    providerId: "system:currency",
    contractVersion: 1,
    family: "currency",
    label: "Core System Currency",
    capabilities: ["readCurrency", "mutateCurrency"],
    isReadOnly: false,
    getHealth: () => ({ status: "healthy", lastCheckedAt: Date.now() }),
    hasCapability: (cap) => cap === "readCurrency" || cap === "mutateCurrency",
    getCurrencyBalance: async () => ok(5000)
  };

  const regRes = registry.register(mockCurrencyProvider);
  assert.equal(regRes.ok, true);

  // Retrieve provider
  const retrieved = registry.get<CurrencyProvider>("system:currency");
  assert.equal(retrieved !== undefined, true);
  assert.equal(retrieved?.label, "Core System Currency");

  // Duplicate ID rejected
  const dupRes = registry.register(mockCurrencyProvider);
  assert.equal(dupRes.ok, false);
  if (!dupRes.ok) {
    assert.equal(dupRes.error.code, "DM_ECON_PROVIDER_ALREADY_EXISTS");
  }

  // Non-namespaced ID rejected
  const invalidIdProvider: CurrencyProvider = {
    ...mockCurrencyProvider,
    providerId: "unnamespaced"
  };
  const invalidRes = registry.register(invalidIdProvider);
  assert.equal(invalidRes.ok, false);
  if (!invalidRes.ok) {
    assert.equal(invalidRes.error.code, "DM_ECON_PROVIDER_INVALID_ID");
  }

  // Incompatible contract version rejected
  const incompatibleVersion: CurrencyProvider = {
    ...mockCurrencyProvider,
    providerId: "system:currency_v0",
    contractVersion: 0
  };
  const incompRes = registry.register(incompatibleVersion);
  assert.equal(incompRes.ok, false);
  if (!incompRes.ok) {
    assert.equal(incompRes.error.code, "DM_ECON_PROVIDER_INCOMPATIBLE");
  }

  // Listing by family
  const currencies = registry.getByFamily("currency");
  assert.equal(currencies.length, 1);
  const inventories = registry.getByFamily("physical-inventory");
  assert.equal(inventories.length, 0);

  // Freezing blocks further writes
  registry.freeze();
  assert.equal(registry.isFrozen(), true);
  const frozenRes = registry.register({
    ...mockCurrencyProvider,
    providerId: "system:extra"
  });
  assert.equal(frozenRes.ok, false);
  if (!frozenRes.ok) {
    assert.equal(frozenRes.error.code, "DM_ECON_PROVIDER_REGISTRY_FROZEN");
  }
});

test("G4.8: assertProviderHealthy enforces fail-closed semantics for unavailable providers", async () => {
  const healthyProvider: CurrencyProvider = {
    providerId: "system:healthy",
    contractVersion: 1,
    family: "currency",
    label: "Healthy Provider",
    capabilities: [],
    isReadOnly: true,
    getHealth: () => ({ status: "healthy", lastCheckedAt: Date.now() }),
    hasCapability: () => false,
    getCurrencyBalance: async () => ok(0)
  };

  const degradedProvider: CurrencyProvider = {
    ...healthyProvider,
    providerId: "system:degraded",
    getHealth: () => ({ status: "degraded", message: "High latency", lastCheckedAt: Date.now() })
  };

  const unavailableProvider: CurrencyProvider = {
    ...healthyProvider,
    providerId: "system:unavailable",
    getHealth: () => ({ status: "unavailable", message: "Connection lost", lastCheckedAt: Date.now() })
  };

  const hRes = await assertProviderHealthy(healthyProvider);
  assert.equal(hRes.ok, true);

  const dRes = await assertProviderHealthy(degradedProvider);
  assert.equal(dRes.ok, true);

  const uRes = await assertProviderHealthy(unavailableProvider);
  assert.equal(uRes.ok, false);
  if (!uRes.ok) {
    assert.equal(uRes.error.code, "DM_ECON_PROVIDER_UNAVAILABLE");
    assert.match(uRes.error.message, /Connection lost/);
  }
});

test("G4.8: assertDebitAllowedOnProviderBalance forbids debits on stale cached balances", () => {
  // Fresh balance allows debits
  const freshRes = assertDebitAllowedOnProviderBalance(
    { balanceMinor: 1000, isStale: false },
    "vault:provider"
  );
  assert.equal(freshRes.ok, true);

  // Stale balance blocks debits (DEC-16806)
  const staleRes = assertDebitAllowedOnProviderBalance(
    { balanceMinor: 1000, isStale: true },
    "vault:provider"
  );
  assert.equal(staleRes.ok, false);
  if (!staleRes.ok) {
    assert.equal(staleRes.error.code, "DM_ECON_PROVIDER_STALE_CACHE");
  }
});

test("G4.8: InventoryProvider contract returns items list", async () => {
  const inventoryProvider: InventoryProvider = {
    providerId: "system:inventory",
    contractVersion: 1,
    family: "physical-inventory",
    label: "Actor Inventory Provider",
    capabilities: ["readInventory"],
    isReadOnly: true,
    getHealth: () => ({ status: "healthy", lastCheckedAt: Date.now() }),
    hasCapability: (cap) => cap === "readInventory",
    listItems: async () =>
      ok([
        { itemId: "item_sword", name: "Iron Sword", quantity: 2, itemType: "weapon" },
        { itemId: "item_potion", name: "Health Potion", quantity: 5, itemType: "consumable" }
      ])
  };

  const itemsRes = await inventoryProvider.listItems("Actor.123");
  assert.equal(itemsRes.ok, true);
  if (itemsRes.ok) {
    assert.equal(itemsRes.value.length, 2);
    assert.equal(itemsRes.value[0].name, "Iron Sword");
    assert.equal(itemsRes.value[1].quantity, 5);
  }
});

test("G4-REVAL3-004: ManualCurrencyProvider persists balances and survives rehydration across instances", async () => {
  const { InMemoryManualCurrencyStorageAdapter } = await import(
    "../../src/economy/storage/manual-currency-storage-adapter.js"
  );
  const { ManualCurrencyProvider } = await import(
    "../../src/economy/providers/manual-currency-provider.js"
  );

  const sharedState = { snapshot: null };
  const adapter1 = new InMemoryManualCurrencyStorageAdapter(sharedState);
  const provider1 = new ManualCurrencyProvider({ storageAdapter: adapter1 });

  await provider1.mutateCurrency("dom-1:domain-manager:treasury", 5000, "Initial deposit");
  await provider1.mutateCurrency("dom-2:domain-manager:treasury", 3000, "Secondary deposit");
  await provider1.flush();

  // Fresh instance simulating restart
  const adapter2 = new InMemoryManualCurrencyStorageAdapter(sharedState);
  const provider2 = new ManualCurrencyProvider({ storageAdapter: adapter2 });
  await provider2.rehydrate();

  const bal1 = await provider2.getCurrencyBalance("dom-1:domain-manager:treasury");
  const bal2 = await provider2.getCurrencyBalance("dom-2:domain-manager:treasury");

  assert.equal(bal1.ok, true);
  assert.equal(bal1.value, 5000, "Balance 1 must survive restart");
  assert.equal(bal2.ok, true);
  assert.equal(bal2.value, 3000, "Balance 2 must survive restart");
});

test("G4-REVAL3-004: Provider write creates TransactionRecord and recovery compensator reverts provider mutation if ledger fails", async () => {
  const { DomainRepository: StorageDomainRepository } = await import(
    "../../src/storage/repositories/domain-repository.js"
  );
  const { createDefaultResourceRegistry } = await import(
    "../../src/economy/definitions/resource-registry.js"
  );
  const { LedgerStore } = await import("../../src/economy/ledger/ledger-store.js");
  const { ReservationStore } = await import(
    "../../src/economy/reservations/reservation-store.js"
  );
  const { EconomyService } = await import(
    "../../src/economy/services/economy-service.js"
  );
  const { LockManager } = await import("../../src/mutations/lock-manager.js");
  const { TransactionStore } = await import("../../src/mutations/transaction-store.js");
  const { RecoveryService } = await import("../../src/mutations/recovery-service.js");
  const { ProviderRegistry } = await import("../../src/economy/providers/provider-registry.js");
  const { ManualCurrencyProvider } = await import(
    "../../src/economy/providers/manual-currency-provider.js"
  );
  const { InMemoryManualCurrencyStorageAdapter } = await import(
    "../../src/economy/storage/manual-currency-storage-adapter.js"
  );
  const { withDomainEconomyData } = await import("../../src/economy/economy-data.js");

  let docFlags: Record<string, unknown> = {
    "domain-manager": {
      schemaVersion: 1,
      revision: 0,
      definition: {
        identity: { aliases: [], summary: "Prov Test", description: "" },
        classification: { kind: "base", scale: "small", tags: [] },
        hierarchy: { parentDomainUuid: null },
        capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {} }
      },
      state: { lifecycle: "active" },
      metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
    }
  };

  const doc = {
    id: "dom-prov-test",
    uuid: "JournalEntry.dom-prov-test",
    name: "Prov Test Domain",
    get flags() { return docFlags; },
    ownership: { default: 3 },
    update: async (data: any) => {
      if (data["flags.domain-manager"]) {
        docFlags = { ...docFlags, "domain-manager": data["flags.domain-manager"] };
      }
    }
  };

  const store = {
    get: () => doc as any,
    list: () => [doc as any],
    create: async () => { throw new Error("not used"); }
  };

  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore();
  const recoveryService = new RecoveryService(transactionStore, lockManager);

  const manualProvider = new ManualCurrencyProvider({
    storageAdapter: new InMemoryManualCurrencyStorageAdapter()
  });
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(manualProvider);

  const economy = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    recoveryService,
    providerRegistry
  });

  // Setup provider account
  await economy.createAccount({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    mode: "provider",
    providerId: manualProvider.providerId,
    providerRef: `${doc.uuid}:domain-manager:treasury`
  });

  // Commit adjust on provider account
  const adjustRes = await economy.commitAdjust({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    deltaMinor: 5000,
    reason: "Test provider adjust"
  });

  assert.equal(adjustRes.ok, true);
  if (adjustRes.ok) {
    assert.ok(adjustRes.value.transactionId, "Provider adjust must generate transactionId");
    const tx = transactionStore.get(adjustRes.value.transactionId!);
    assert.ok(tx, "TransactionRecord must exist for provider adjust");
    assert.equal(tx.state, "committed", "TransactionRecord must be committed");
  }

  const provBal = await manualProvider.getCurrencyBalance(`${doc.uuid}:domain-manager:treasury`);
  assert.equal(provBal.value, 5000);

  // Now simulate partial crash: provider was mutated by +2000, but transaction crashed before ledger
  await manualProvider.mutateCurrency(`${doc.uuid}:domain-manager:treasury`, 2000, "Crash intent");
  const { createTransactionRecord } = await import("../../src/mutations/transaction-record.js");
  const crashTx = createTransactionRecord({
    transactionId: "tx_prov_crash_1",
    commandId: "cmd_prov_crash" as any,
    authorityEpoch: 1,
    lockKeys: [doc.uuid],
    safeAutoRecovery: true,
    recoveryData: {
      type: "economy:provider-adjust",
      domainUuid: doc.uuid,
      resourceId: "domain-manager:treasury",
      providerId: manualProvider.providerId,
      providerRef: `${doc.uuid}:domain-manager:treasury`,
      deltaMinor: 2000
    }
  });

  transactionStore.save(crashTx);
  transactionStore.transition(crashTx.transactionId, "claimed", 1);
  transactionStore.transition(crashTx.transactionId, "prepared", 1);
  transactionStore.transition(crashTx.transactionId, "committing", 1);

  // Provider balance is 7000 before recovery
  const preRecBal = await manualProvider.getCurrencyBalance(`${doc.uuid}:domain-manager:treasury`);
  assert.equal(preRecBal.value, 7000);

  // Recovery runs: compensator sees no ledger entry, so it reverts the +2000 mutation!
  const recRes = await recoveryService.recoverAll(1);
  assert.equal(recRes.length, 1);
  assert.equal(recRes[0].value.state, "compensated");

  const postRecBal = await manualProvider.getCurrencyBalance(`${doc.uuid}:domain-manager:treasury`);
  assert.equal(postRecBal.value, 5000, "Provider balance must be compensated back to 5000");
});

