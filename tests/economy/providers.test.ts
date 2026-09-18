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
