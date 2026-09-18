import assert from "node:assert/strict";
import test from "node:test";
import {
  type NativeResourceAccount,
  type DerivedResourceAccount,
  type ProviderResourceAccount,
  validateResourceAccount
} from "../../src/economy/accounts/account-types.js";
import {
  type DomainEconomyData,
  createDefaultDomainEconomyData,
  validateDomainEconomyData,
  tryGetDomainEconomyData,
  getDomainEconomyData,
  withDomainEconomyData,
  ECONOMY_CAPABILITY_ID
} from "../../src/economy/economy-data.js";
import { domainCapabilityRegistry } from "../../src/domains/domain-capabilities.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";

const baseRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Summary", description: "Description" },
    classification: { kind: "base", scale: "small", tags: ["starter"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

test("G4.2: NativeResourceAccount passes validation with safe integer balance", () => {
  const account: NativeResourceAccount = {
    mode: "native",
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    balanceMinor: 25000,
    baseCapacityMinor: 100000,
    visibility: "public"
  };

  const res = validateResourceAccount(account);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.mode, "native");
    assert.equal(res.value.domainUuid, "domain-1");
    assert.equal(res.value.resourceId, "domain-manager:treasury");
    assert.equal((res.value as NativeResourceAccount).balanceMinor, 25000);
    assert.equal((res.value as NativeResourceAccount).baseCapacityMinor, 100000);
    assert.equal(res.value.visibility, "public");
  }
});

test("G4.2: NativeResourceAccount rejects non-safe-integer balance and negative capacity", () => {
  const invalidBalance = {
    mode: "native",
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    balanceMinor: 10.5 // float, not integer
  };
  const resBalance = validateResourceAccount(invalidBalance);
  assert.equal(resBalance.ok, false);
  assert.equal(resBalance.error.code, "DM_ECON_ACCOUNT_INVALID");

  const invalidCapacity = {
    mode: "native",
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    balanceMinor: 100,
    baseCapacityMinor: -50 // negative capacity
  };
  const resCap = validateResourceAccount(invalidCapacity);
  assert.equal(resCap.ok, false);
  assert.equal(resCap.error.code, "DM_ECON_ACCOUNT_INVALID");
});

test("G4.2: DerivedResourceAccount validates resolverId", () => {
  const derived: DerivedResourceAccount = {
    mode: "derived",
    domainUuid: "domain-1",
    resourceId: "world:population-tax-base",
    resolverId: "population-tax-calculator",
    visibility: "restricted"
  };

  const res = validateResourceAccount(derived);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.mode, "derived");
    assert.equal((res.value as DerivedResourceAccount).resolverId, "population-tax-calculator");
  }

  const missingResolver = {
    mode: "derived",
    domainUuid: "domain-1",
    resourceId: "world:population-tax-base",
    resolverId: "   " // blank
  };
  assert.equal(validateResourceAccount(missingResolver).ok, false);
});

test("G4.2: ProviderResourceAccount validates providerId and providerRef", () => {
  const providerAcc: ProviderResourceAccount = {
    mode: "provider",
    domainUuid: "domain-1",
    resourceId: "world:actor-gold",
    providerId: "system-dnd5e-currency",
    providerRef: "Actor.xyz123.system.currency.gp",
    visibility: "secret"
  };

  const res = validateResourceAccount(providerAcc);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.mode, "provider");
    assert.equal((res.value as ProviderResourceAccount).providerId, "system-dnd5e-currency");
    assert.equal((res.value as ProviderResourceAccount).providerRef, "Actor.xyz123.system.currency.gp");
  }

  const missingRef = {
    mode: "provider",
    domainUuid: "domain-1",
    resourceId: "world:actor-gold",
    providerId: "system-dnd5e-currency"
  };
  assert.equal(validateResourceAccount(missingRef).ok, false);
});

test("G4.2: DomainEconomyData detects duplicate resource accounts in the same domain", () => {
  const dupData: DomainEconomyData = {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "domain-1",
        resourceId: "domain-manager:treasury",
        balanceMinor: 100,
        baseCapacityMinor: null
      },
      {
        mode: "native",
        domainUuid: "domain-1",
        resourceId: "domain-manager:treasury", // duplicate resourceId
        balanceMinor: 50,
        baseCapacityMinor: null
      }
    ]
  };

  const res = validateDomainEconomyData(dupData);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "DM_ECON_DUPLICATE_RESOURCE_ACCOUNT");
});

test("G4.2: tryGetDomainEconomyData, withDomainEconomyData roundtrip and capability registry", () => {
  // Empty domain defaults to default economy data
  const defaultEco = getDomainEconomyData(baseRecord);
  assert.equal(defaultEco.schemaVersion, 1);
  assert.equal(defaultEco.accounts.length, 0);

  // Set economy data
  const customEco: DomainEconomyData = {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "domain-1",
        resourceId: "domain-manager:treasury",
        balanceMinor: 5000,
        baseCapacityMinor: 20000
      },
      {
        mode: "native",
        domainUuid: "domain-1",
        resourceId: "domain-manager:supplies",
        balanceMinor: 120,
        baseCapacityMinor: 500
      }
    ]
  };

  const domainWithEco = withDomainEconomyData(baseRecord, customEco);
  assert.ok(domainWithEco.definition.capabilities.enabled.includes(ECONOMY_CAPABILITY_ID));

  const readEco = getDomainEconomyData(domainWithEco);
  assert.equal(readEco.accounts.length, 2);
  assert.equal((readEco.accounts[0] as NativeResourceAccount).balanceMinor, 5000);

  // Capability registry recognizes domain-manager:economy and validates config
  const capDef = domainCapabilityRegistry.get(ECONOMY_CAPABILITY_ID);
  assert.ok(capDef);
  assert.equal(capDef.functional, true);

  const validCheck = capDef.validateConfig?.(customEco);
  assert.ok(validCheck);
  assert.equal(validCheck.ok, true);

  const invalidCheck = capDef.validateConfig?.({ schemaVersion: 99 });
  assert.ok(invalidCheck);
  assert.equal(invalidCheck.ok, false);
});
