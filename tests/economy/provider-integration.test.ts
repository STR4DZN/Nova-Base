import test from "node:test";
import assert from "node:assert/strict";
import { ProviderRegistry } from "../../src/economy/providers/provider-registry.js";
import { ManualCurrencyProvider } from "../../src/economy/providers/manual-currency-provider.js";
import { NativeResourceProvider } from "../../src/economy/providers/native-resource-provider.js";
import {
  assertProviderHealthy,
  assertDebitAllowedOnProviderBalance
} from "../../src/economy/providers/provider-types.js";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { withDomainEconomyData } from "../../src/economy/economy-data.js";
import { encodeDomainRecord } from "../../src/storage/codecs/domain-codec.js";

const testRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Provider Domain", description: "" },
    classification: { kind: "base", scale: "small", tags: [] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function createDoc(id: string): IdentifiedJournalEntryDocumentLike {
  let currentFlags: Readonly<Record<string, unknown>> = {
    "domain-manager": encodeDomainRecord(testRecord)
  };
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return "Domain " + id; },
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

test("G4-AUD-006: ManualCurrencyProvider provides synchronous fallback and state mutation", async () => {
  const manual = new ManualCurrencyProvider();
  assert.equal(manual.providerId, "domain-manager:manual-currency");
  assert.equal(manual.family, "currency");

  const health = manual.getHealth();
  assert.equal(health.status, "healthy");

  // Read non-existent balance defaults to 0
  const initRes = await manual.getCurrencyBalance("actor-1");
  assert.equal(initRes.ok, true);
  assert.equal(initRes.value, 0);

  // Apply positive delta
  const addRes = await manual.mutateCurrency("actor-1", 500, "Loot award");
  assert.equal(addRes.ok, true);
  assert.equal(addRes.value.newBalanceMinor, 500);

  // Re-read confirms 500
  const readRes2 = await manual.getCurrencyBalance("actor-1");
  assert.equal(readRes2.ok, true);
  assert.equal(readRes2.value, 500);

  // Offline provider rejects mutations
  manual.setHealthy(false);
  const subRes = await manual.mutateCurrency("actor-1", -1000, "Over-spend");
  assert.equal(subRes.ok, false);
  assert.equal(subRes.error.code, "DM_ECON_PROVIDER_UNAVAILABLE");
});

test("G4-AUD-006: Fail-closed semantics block debit on stale or unavailable provider balance", async () => {
  // Stale balance check
  const staleCheck = assertDebitAllowedOnProviderBalance(
    {
      balanceMinor: 1000,
      isStale: true
    },
    "provider-1"
  );
  assert.equal(staleCheck.ok, false);
  assert.equal(staleCheck.error.code, "DM_ECON_PROVIDER_STALE_CACHE");

  // Fresh balance check
  const freshCheck = assertDebitAllowedOnProviderBalance(
    {
      balanceMinor: 1000,
      isStale: false
    },
    "provider-1"
  );
  assert.equal(freshCheck.ok, true);

  // Health check: degraded provider rejects write operations
  const mockDegradedProvider: any = {
    providerId: "external:sync",
    getHealth: () => ({
      status: "unavailable",
      message: "Network timeout",
      lastCheckedAt: Date.now()
    })
  };
  const healthCheck = await assertProviderHealthy(mockDegradedProvider);
  assert.equal(healthCheck.ok, false);
  assert.equal(healthCheck.error.code, "DM_ECON_PROVIDER_UNAVAILABLE");
});

test("G4-AUD-006: NativeResourceProvider integrates with DomainRepository", async () => {
  const doc = createDoc("dom-native");
  const econRecord = withDomainEconomyData(testRecord, {
    schemaVersion: 1,
    accounts: [
      {
        domainUuid: doc.uuid,
        resourceId: "domain-manager:treasury",
        mode: "native",
        balanceMinor: 2500,
        baseCapacityMinor: null,
        status: "active",
        visibility: "public",
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
  });
  await doc.update({ "flags.domain-manager": encodeDomainRecord(econRecord) });

  const docMap = new Map([[doc.id, doc], [doc.uuid, doc]]);
  const store: DomainDocumentStore = {
    get: (idOrUuid) => {
      const clean = idOrUuid.startsWith("JournalEntry.") ? idOrUuid.slice("JournalEntry.".length) : idOrUuid;
      return docMap.get(idOrUuid) ?? docMap.get(clean);
    },
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  };
  const domains = new StorageDomainRepository(store);

  const native = new NativeResourceProvider(domains);
  assert.equal(native.providerId, "domain-manager:native-provider");

  const health = native.getHealth();
  assert.equal(health.status, "healthy");

  const balRes = await native.readBalance(doc.uuid, "domain-manager:treasury", "");
  assert.equal(balRes.ok, true);
  assert.equal(balRes.value.balanceMinor, 2500);
});
