import test from "node:test";
import assert from "node:assert/strict";
import { ThresholdService } from "../../src/economy/thresholds/threshold-service.js";
import { CustomResourceDefinitionStore } from "../../src/economy/definitions/custom-resource-store.js";
import { EconomyAggregationProvider } from "../../src/economy/aggregation/economy-aggregation-provider.js";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { createDefaultResourceRegistry } from "../../src/economy/definitions/resource-registry.js";
import { ReservationStore } from "../../src/economy/reservations/reservation-store.js";
import { withDomainEconomyData } from "../../src/economy/economy-data.js";
import { EconomyService } from "../../src/economy/services/economy-service.js";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";
import { InMemoryThresholdStorageAdapter } from "../../src/economy/storage/threshold-storage-adapter.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { registerEconomyCommands } from "../../src/economy/commands/economy-commands.js";
import { COMMAND_CONTRACT_VERSION_V1 } from "../../src/commands/command-envelope.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";

const testRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Rollup Domain", description: "" },
    classification: { kind: "base", scale: "small", tags: [] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function createDoc(
  id: string,
  name: string,
  accounts: any[] = []
): IdentifiedJournalEntryDocumentLike {
  const record = withDomainEconomyData(testRecord, { schemaVersion: 1, accounts });
  let currentFlags: Readonly<Record<string, unknown>> = {
    "domain-manager": JSON.parse(JSON.stringify(record))
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

test("G4-AUD-010: ThresholdService evaluates condition breaches on accounts", async () => {
  const thresholds = new ThresholdService();

  thresholds.register({
    domainUuid: "dom-1",
    resourceId: "domain-manager:supplies",
    name: "Low supplies alert",
    metric: "available",
    operator: "lte",
    targetValueMinor: 100,
    severity: "warning",
    autoHoldReservations: false
  });

  // Safe account state (available = 200 > 100)
  const safeResults = thresholds.evaluate(
    "dom-1",
    "domain-manager:supplies",
    { balanceMinor: 200, reservedMinor: 0, availableMinor: 200, capacityMinor: null }
  );
  assert.equal(safeResults.length, 0);

  // Breached account state (available = 80 <= 100)
  const breachResults = thresholds.evaluate(
    "dom-1",
    "domain-manager:supplies",
    { balanceMinor: 100, reservedMinor: 20, availableMinor: 80, capacityMinor: null }
  );
  assert.equal(breachResults.length, 1);
  assert.equal(breachResults[0].breached, true);
  assert.equal(breachResults[0].definition.severity, "warning");
  assert.equal(breachResults[0].actualValueMinor, 80);
});

test("G4-AUD-008: ThresholdService tracks crossedStates and emits only on state transition (breach vs recovery)", async () => {
  const thresholds = new ThresholdService();

  const regRes = thresholds.register({
    domainUuid: "dom-alert",
    resourceId: "domain-manager:treasury",
    name: "Treasury Low Alert",
    metric: "balance",
    operator: "<=",
    targetValueMinor: 500,
    severity: "critical"
  });
  assert.equal(regRes.ok, true);

  // 1. Initial evaluation: Safe state (1,000 > 500) -> 0 transitions
  const step1 = thresholds.evaluateCrossings("dom-alert", "domain-manager:treasury", {
    balanceMinor: 1_000,
    availableMinor: 1_000
  });
  assert.equal(step1.length, 0);
  assert.equal(thresholds.isCrossed(regRes.value.id), false);

  // 2. Value drops to 400 (<= 500) -> 1 transition: "breach"
  const step2 = thresholds.evaluateCrossings("dom-alert", "domain-manager:treasury", {
    balanceMinor: 400,
    availableMinor: 400
  });
  assert.equal(step2.length, 1);
  assert.equal(step2[0].type, "breach");
  assert.equal(step2[0].previousState, false);
  assert.equal(step2[0].currentState, true);
  assert.equal(step2[0].actualValueMinor, 400);
  assert.equal(thresholds.isCrossed(regRes.value.id), true);

  // 3. Repeated query while still breached (400 <= 500) -> 0 transitions (NO SPAM)
  const step3 = thresholds.evaluateCrossings("dom-alert", "domain-manager:treasury", {
    balanceMinor: 400,
    availableMinor: 400
  });
  assert.equal(step3.length, 0, "No duplicate alert event when state has not crossed");

  // 4. Value recovers to 600 (> 500) -> 1 transition: "recovery"
  const step4 = thresholds.evaluateCrossings("dom-alert", "domain-manager:treasury", {
    balanceMinor: 600,
    availableMinor: 600
  });
  assert.equal(step4.length, 1);
  assert.equal(step4[0].type, "recovery");
  assert.equal(step4[0].previousState, true);
  assert.equal(step4[0].currentState, false);
  assert.equal(step4[0].actualValueMinor, 600);
  assert.equal(thresholds.isCrossed(regRes.value.id), false);

  // 5. Repeated query while safe -> 0 transitions
  const step5 = thresholds.evaluateCrossings("dom-alert", "domain-manager:treasury", {
    balanceMinor: 700,
    availableMinor: 700
  });
  assert.equal(step5.length, 0);
});

test("G4-AUD-010: CustomResourceDefinitionStore loads and validates custom world resource definitions", async () => {
  const store = new CustomResourceDefinitionStore();

  const regRes = store.register({
    id: "world:crystals",
    version: 1,
    label: "Magic Crystals",
    description: "Crystalline arcane power",
    categoryId: "arcane",
    tags: ["magic", "energy"],
    precision: 0,
    displayUnit: { singular: "crystal", plural: "crystals" },
    minimumMinor: 0,
    maximumMinor: 10_000,
    allowNegative: false,
    defaultCapacityPolicy: "block",
    lifecycle: "active"
  });

  assert.equal(regRes.ok, true);
  assert.equal(store.has("world:crystals"), true);
  assert.equal(store.get("world:crystals")?.label, "Magic Crystals");

  // Invalid non-namespaced ID is rejected
  const invRes = store.register({
    id: "raw_ore",
    version: 1,
    label: "Ore",
    description: "",
    categoryId: "raw",
    tags: [],
    precision: 0,
    minimumMinor: 0,
    maximumMinor: null,
    allowNegative: false,
    defaultCapacityPolicy: "block",
    lifecycle: "active"
  });
  assert.equal(invRes.ok, false);
});

test("G4-AUD-010: Multi-domain economy aggregation accounts for hidden and unknown contributors", async () => {
  const docPublic = createDoc("dom-pub", "Public Domain", [
    { mode: "native", domainUuid: "JournalEntry.dom-pub", resourceId: "domain-manager:treasury", balanceMinor: 5000, baseCapacityMinor: 10000, visibility: "public" }
  ]);

  const docSecret = createDoc("dom-sec", "Secret Domain", [
    { mode: "native", domainUuid: "JournalEntry.dom-sec", resourceId: "domain-manager:treasury", balanceMinor: 3000, baseCapacityMinor: 5000, visibility: "secret" }
  ]);

  const docMap = new Map<string, IdentifiedJournalEntryDocumentLike>([
    [docPublic.id, docPublic],
    [docPublic.uuid, docPublic],
    [docSecret.id, docSecret],
    [docSecret.uuid, docSecret]
  ]);

  const repo = new StorageDomainRepository({
    get: (id: string) => docMap.get(id),
    list: () => [...new Set(docMap.values())],
    create: async () => { throw new Error("not used"); }
  });

  const registry = createDefaultResourceRegistry();
  const reservationStore = new ReservationStore();

  const aggregator = new EconomyAggregationProvider({
    domains: repo,
    resourceRegistry: registry,
    reservationStore
  });

  // GM viewer sees total of both domains (5000 + 3000 = 8000), hiddenContributors = 0
  const gmAgr = await aggregator.getAggregateContext(
    [docPublic.uuid, docSecret.uuid],
    { isGm: true }
  );

  const gmTreasury = gmAgr.totals.find((a) => a.resourceId === "domain-manager:treasury")!;
  assert.equal(gmTreasury.totalBalanceMinor, 8000);
  assert.equal(gmTreasury.contributingDomainCount, 2);
  assert.equal(gmTreasury.hiddenDomainCount, 0);
  assert.equal(gmAgr.hiddenContributors.length, 0);

  // Non-GM viewer sees only public domain (5000), hiddenDomainCount tracks omission, and hiddenContributors is empty (G4-AUD-007: no secret UUID leak)
  const playerAgr = await aggregator.getAggregateContext(
    [docPublic.uuid, docSecret.uuid],
    { isGm: false }
  );

  const playerTreasury = playerAgr.totals.find((a) => a.resourceId === "domain-manager:treasury")!;
  assert.equal(playerTreasury.totalBalanceMinor, 5000);
  assert.equal(playerTreasury.contributingDomainCount, 1);
  assert.equal(playerTreasury.hiddenDomainCount, 1);
  assert.equal(playerAgr.hiddenContributors.length, 0);
});

test("G4-AUD-010: Zero-delta adjustment acts as no-op and creates no ledger entries", async () => {
  const doc = createDoc("dom-noop", "No-Op Domain", [
    { mode: "native", domainUuid: "JournalEntry.dom-noop", resourceId: "domain-manager:treasury", balanceMinor: 1000, baseCapacityMinor: 5000, visibility: "public" }
  ]);

  const repo = new StorageDomainRepository({
    get: (id: string) => doc,
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  });

  const registry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();

  const economy = new EconomyService({
    domains: repo,
    resourceRegistry: registry,
    ledgerStore,
    reservationStore
  });

  const initialLedgerCount = ledgerStore.count;

  // Execute zero-delta adjustment
  const res = await economy.commitAdjust({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    deltaMinor: 0,
    reason: "No-op test"
  });

  assert.equal(res.ok, true);
  assert.equal(res.value.isNoop, true);
  assert.equal(res.value.entry, undefined);
  assert.equal(ledgerStore.count, initialLedgerCount, "Zero-delta adjust must NOT append any ledger entry");

  // Balance remains 1000
  const acc = (await economy.getAccount(doc.uuid, "domain-manager:treasury")).value!;
  assert.equal(acc.mode === "native" ? acc.balanceMinor : null, 1000);
});

test("G4-REVAL3-007: ThresholdService persistence survives reload via InMemoryThresholdStorageAdapter", async () => {
  const adapter = new InMemoryThresholdStorageAdapter();
  const service1 = new ThresholdService(adapter);

  const regRes = service1.register({
    domainUuid: "JournalEntry.dom-persist",
    resourceId: "domain-manager:treasury",
    name: "Treasury Low Alert",
    metric: "balance",
    operator: "<=",
    targetValueMinor: 1000,
    severity: "critical"
  });
  assert.equal(regRes.ok, true);
  const thId = regRes.value.id;

  // Trigger breach transition so crossedStates is true
  const transitions = service1.evaluateCrossings("JournalEntry.dom-persist", "domain-manager:treasury", {
    balanceMinor: 500,
    availableMinor: 500
  });
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].type, "breach");
  assert.equal(service1.isCrossed(thId), true);

  // Flush to guarantee persistence
  await service1.flush();

  // Recreate instance from same storage adapter
  const service2 = new ThresholdService(adapter);
  await service2.rehydrate();

  // Verify definition and crossed state were preserved
  const restoredDef = service2.getThreshold(thId);
  assert.equal(restoredDef !== undefined, true);
  assert.equal(restoredDef?.targetValueMinor, 1000);
  assert.equal(restoredDef?.severity, "critical");
  assert.equal(service2.isCrossed(thId), true, "Crossed state must be restored after rehydration");
});

test("G4-REVAL3-007: EconomyService automatically triggers evaluateCrossings on balance mutations", async () => {
  const doc = createDoc("dom-crossings", "Crossings Domain", [
    {
      mode: "native",
      domainUuid: "JournalEntry.dom-crossings",
      resourceId: "domain-manager:treasury",
      balanceMinor: 5000,
      baseCapacityMinor: 10000,
      visibility: "public"
    }
  ]);

  const repo = new StorageDomainRepository({
    get: (id: string) => doc,
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  });

  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const thresholdService = new ThresholdService();

  const regRes = thresholdService.register({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    name: "Treasury Warning",
    metric: "balance",
    operator: "<=",
    targetValueMinor: 1000,
    severity: "warning"
  });
  assert.equal(regRes.ok, true);
  const thId = regRes.value.id;

  const economy = new EconomyService({
    domains: repo,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    thresholdService
  });

  // Initially not crossed (balance is 5000 > 1000)
  assert.equal(thresholdService.isCrossed(thId), false);

  // commitAdjust drops balance to 800 <= 1000
  const adjustDownRes = await economy.commitAdjust({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    deltaMinor: -4200,
    reason: "Large expense"
  });
  assert.equal(adjustDownRes.ok, true);

  // Automatically evaluated and marked crossed!
  assert.equal(thresholdService.isCrossed(thId), true, "Threshold crossing must be detected automatically on adjust");

  // commitAdjust restores balance to 2500 > 1000
  const adjustUpRes = await economy.commitAdjust({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    deltaMinor: 1700,
    reason: "Deposit"
  });
  assert.equal(adjustUpRes.ok, true);

  // Automatically evaluated recovery!
  assert.equal(thresholdService.isCrossed(thId), false, "Threshold recovery must be detected automatically on adjust");
});

test("G4-REVAL3-007: Multi-domain economy aggregation tracks incomplete/unknown contributors", async () => {
  const docValid = createDoc("dom-valid", "Valid Domain", [
    {
      mode: "native",
      domainUuid: "JournalEntry.dom-valid",
      resourceId: "domain-manager:treasury",
      balanceMinor: 2000,
      baseCapacityMinor: 5000,
      visibility: "public"
    }
  ]);

  const docFailedProvider = createDoc("dom-prov-fail", "Provider Fail Domain", [
    {
      mode: "provider",
      domainUuid: "JournalEntry.dom-prov-fail",
      resourceId: "domain-manager:treasury",
      providerId: "offline-provider",
      providerRef: "wallet-test-ref",
      visibility: "public"
    }
  ]);

  const docMap = new Map<string, IdentifiedJournalEntryDocumentLike>([
    [docValid.id, docValid],
    [docValid.uuid, docValid],
    [docFailedProvider.id, docFailedProvider],
    [docFailedProvider.uuid, docFailedProvider]
  ]);

  const repo = new StorageDomainRepository({
    get: (id: string) => docMap.get(id),
    list: () => [...new Set(docMap.values())],
    create: async () => { throw new Error("not used"); }
  });

  const registry = createDefaultResourceRegistry();
  const reservationStore = new ReservationStore();

  const aggregator = new EconomyAggregationProvider({
    domains: repo,
    resourceRegistry: registry,
    reservationStore
  });

  // Query with valid domain, missing domain, and domain with failed provider
  const aggregate = await aggregator.getAggregateContext([
    docValid.uuid,
    "JournalEntry.dom-nonexistent",
    docFailedProvider.uuid
  ]);

  // isComplete must be false and unknownContributors populated
  assert.equal(aggregate.isComplete, false);
  assert.equal(aggregate.unknownContributors.includes("JournalEntry.dom-nonexistent"), true);
  assert.equal(aggregate.unknownContributors.includes(docFailedProvider.uuid), true);

  const treasuryTotal = aggregate.totals.find((t) => t.resourceId === "domain-manager:treasury");
  assert.equal(treasuryTotal !== undefined, true);
  assert.equal(treasuryTotal?.isComplete, false);
  assert.equal(treasuryTotal?.unknownContributorCount, 1);

  // Querying only healthy valid domain
  const cleanAggregate = await aggregator.getAggregateContext([docValid.uuid]);
  assert.equal(cleanAggregate.isComplete, true);
  assert.equal(cleanAggregate.unknownContributors.length, 0);
  const cleanTreasury = cleanAggregate.totals.find((t) => t.resourceId === "domain-manager:treasury");
  assert.equal(cleanTreasury?.isComplete, true);
  assert.equal(cleanTreasury?.unknownContributorCount, 0);
});

test("G4-REVAL3-007: Canonical economy commands economy:set-threshold, economy:register-custom-resource, and release reason", async () => {
  const doc = createDoc("dom-cmd-test", "Command Test Domain", [
    {
      mode: "native",
      domainUuid: "JournalEntry.dom-cmd-test",
      resourceId: "domain-manager:treasury",
      balanceMinor: 10000,
      baseCapacityMinor: 20000,
      visibility: "public"
    }
  ]);

  const repo = new StorageDomainRepository({
    get: (id: string) => doc,
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  });

  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const thresholdService = new ThresholdService();
  const customResourceStore = new CustomResourceDefinitionStore();

  const economyService = new EconomyService({
    domains: repo,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    thresholdService
  });

  const registry = new CommandRegistry();
  const authorityService = new PrimaryAuthorityService(
    {
      getUsers: () => [
        { id: "gm-user", isGM: true, active: true },
        { id: "player-user", isGM: false, active: true }
      ],
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-user"
    },
    { authorityUserId: "gm-user", authorityEpoch: 1, initialized: true }
  );

  registerEconomyCommands({
    registry,
    economyService,
    domains: repo,
    thresholdService,
    customResourceStore,
    resourceRegistry
  });

  const commandBus = new CommandBus({ registry, authorityService });

  // 1. economy:set-threshold: invalid metric rejected
  const badThCmd = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createOpaqueId("cmd"),
    type: "economy:set-threshold",
    payload: {
      domainUuid: doc.uuid,
      resourceId: "domain-manager:treasury",
      metric: "invalid-metric",
      targetValueMinor: 500,
      severity: "warning"
    },
    issuedAtReal: Date.now()
  };
  const badThReceipt = await commandBus.execute(badThCmd);
  assert.equal(badThReceipt.ok, true);
  assert.equal(badThReceipt.value.status, "rejected");

  // 1b. economy:set-threshold: valid command registers threshold
  const validThCmd = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createOpaqueId("cmd"),
    type: "economy:set-threshold",
    payload: {
      domainUuid: doc.uuid,
      resourceId: "domain-manager:treasury",
      metric: "balance",
      operator: "<=",
      targetValueMinor: 2500,
      severity: "critical",
      label: "Treasury Critical Low"
    },
    issuedAtReal: Date.now()
  };
  const validThReceipt = await commandBus.execute(validThCmd);
  assert.equal(validThReceipt.ok, true);
  assert.equal(validThReceipt.value.status, "executed");
  const thList = thresholdService.listThresholds(doc.uuid, "domain-manager:treasury");
  assert.equal(thList.length, 1);
  assert.equal(thList[0].targetValueMinor, 2500);

  // 2. economy:register-custom-resource: GM-only command
  const customDef = {
    id: "world:mana",
    version: 1,
    label: "Arcane Mana",
    description: "Magical energy",
    icon: "fas fa-magic",
    categoryId: "arcana",
    tags: ["magic"],
    precision: 0,
    displayUnit: { singular: "crystal", plural: "crystals" },
    minimumMinor: 0,
    maximumMinor: 100000,
    allowNegative: false,
    defaultCapacityPolicy: "block" as const,
    lifecycle: "active" as const
  };

  const regCustomCmd = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createOpaqueId("cmd"),
    type: "economy:register-custom-resource",
    payload: { definition: customDef },
    issuedAtReal: Date.now()
  };
  const regCustomReceipt = await commandBus.execute(regCustomCmd);
  assert.equal(regCustomReceipt.ok, true);
  assert.equal(regCustomReceipt.value.status, "executed");

  // Verifies registered in registry and saved in store
  assert.equal(resourceRegistry.get("world:mana") !== undefined, true);
  assert.equal(customResourceStore.get("world:mana") !== undefined, true);

  // 3. economy:release-reservation records reason in reservation store
  const resCreation = reservationStore.create({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    originalAmountMinor: 1000,
    source: { type: "command" }
  });
  assert.equal(resCreation.ok, true);
  const resId = resCreation.value.id;

  const releaseCmd = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createOpaqueId("cmd"),
    type: "economy:release-reservation",
    payload: {
      domainUuid: doc.uuid,
      reservationId: resId,
      reason: "Mission cancelled by Domain Council"
    },
    issuedAtReal: Date.now()
  };
  const releaseReceipt = await commandBus.execute(releaseCmd);
  assert.equal(releaseReceipt.ok, true);
  assert.equal(releaseReceipt.value.status, "executed");

  const releasedRes = reservationStore.get(resId);
  assert.equal(releasedRes?.status, "released");
  const events = reservationStore.listEvents(resId);
  const releaseEvent = events.find((e) => e.type === "released");
  assert.equal(releaseEvent !== undefined, true);
  assert.equal(releaseEvent?.reason, "Mission cancelled by Domain Council");
});

test("G4-REVAL4-002: ThresholdService.flush() propagates storage failure and economy:set-threshold returns DM_DOMAIN_STORAGE_ERROR", async () => {
  const failingAdapter = {
    loadSnapshot: async () => null,
    saveSnapshot: async () => {
      throw new Error("I/O Storage Error: Disk full");
    }
  };

  const thresholdService = new ThresholdService({ storageAdapter: failingAdapter as any });

  // Registering threshold schedules flush
  thresholdService.registerThreshold({
    id: "thresh-fail-1",
    domainUuid: "dom-fail",
    resourceId: "domain-manager:treasury",
    direction: "below",
    levelMinor: 100,
    severity: "warning",
    channel: "chat"
  });

  // Direct flush() should rethrow the persistent error
  await assert.rejects(
    async () => {
      await thresholdService.flush();
    },
    { message: /I\/O Storage Error: Disk full/ }
  );

  // Now test command execution pipeline
  const registry = new CommandRegistry();
  const authorityService = new PrimaryAuthorityService(
    {
      getUsers: () => [{ id: "gm-1", isGM: true, active: true }],
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-1"
    },
    { authorityUserId: "gm-1", authorityEpoch: 1, initialized: true }
  );
  const commandBus = new CommandBus({ registry, authorityService });

  const doc = createDoc("dom-fail", "Fail Domain");
  const docMap = new Map([[doc.id, doc], [doc.uuid, doc]]);
  const domains = new StorageDomainRepository({
    get: (id: string) => docMap.get(id),
    list: () => [...new Set(docMap.values())],
    create: async () => { throw new Error("not used"); }
  });

  registerEconomyCommands({
    registry,
    domains,
    resourceRegistry: createDefaultResourceRegistry(),
    thresholdService
  });

  const cmd = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createOpaqueId("cmd"),
    type: "economy:set-threshold",
    payload: {
      id: "thresh-fail-cmd",
      domainUuid: doc.uuid,
      resourceId: "domain-manager:treasury",
      metric: "balance" as const,
      valueMinor: 50,
      direction: "below" as const,
      severity: "critical" as const,
      channel: "chat" as const
    },
    issuedAtReal: Date.now()
  };

  const receipt = await commandBus.execute(cmd);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.value.status, "rejected");
  assert.equal(receipt.value.error?.code, "DM_DOMAIN_STORAGE_ERROR");
});

test("G4-REVAL4-004: economy:register-custom-resource rejects duplicate resource definition with DM_ECON_RESOURCE_ALREADY_EXISTS", async () => {
  const customResourceStore = new CustomResourceDefinitionStore();
  const resourceRegistry = createDefaultResourceRegistry();
  const registry = new CommandRegistry();
  const authorityService = new PrimaryAuthorityService(
    {
      getUsers: () => [{ id: "gm-1", isGM: true, active: true }],
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-1"
    },
    { authorityUserId: "gm-1", authorityEpoch: 1, initialized: true }
  );
  const commandBus = new CommandBus({ registry, authorityService });

  const doc = createDoc("dom-custom-test", "Custom Domain");
  const docMap = new Map([[doc.id, doc], [doc.uuid, doc]]);
  const domains = new StorageDomainRepository({
    get: (id: string) => docMap.get(id),
    list: () => [...new Set(docMap.values())],
    create: async () => { throw new Error("not used"); }
  });

  registerEconomyCommands({
    registry,
    domains,
    resourceRegistry,
    customResourceStore
  });

  const customDef = {
    id: "world:stellar-dust",
    version: 1,
    label: "Stellar Dust",
    description: "Cosmic matter",
    categoryId: "cosmic",
    tags: ["space"],
    precision: 2,
    displayUnit: { singular: "grain", plural: "grains" },
    minimumMinor: 0,
    maximumMinor: 100000,
    allowNegative: false,
    defaultCapacityPolicy: "block" as const,
    lifecycle: "active" as const
  };

  // First registration succeeds
  const cmd1 = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createOpaqueId("cmd"),
    type: "economy:register-custom-resource",
    payload: { definition: customDef },
    issuedAtReal: Date.now()
  };
  const receipt1 = await commandBus.execute(cmd1);
  assert.equal(receipt1.ok, true);
  assert.equal(receipt1.value.status, "executed");

  // Second registration of exact same resource ID must fail with DM_ECON_RESOURCE_ALREADY_EXISTS
  const cmd2 = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createOpaqueId("cmd"),
    type: "economy:register-custom-resource",
    payload: { definition: { ...customDef, label: "Spoofed Duplicate" } },
    issuedAtReal: Date.now()
  };
  const receipt2 = await commandBus.execute(cmd2);
  assert.equal(receipt2.ok, true);
  assert.equal(receipt2.value.status, "rejected");
  assert.equal(receipt2.value.error?.code, "DM_ECON_RESOURCE_ALREADY_EXISTS");

  // Original definition preserved without overwrite
  assert.equal(resourceRegistry.get("world:stellar-dust")?.label, "Stellar Dust");
  assert.equal(customResourceStore.get("world:stellar-dust")?.label, "Stellar Dust");
});

test("G4-REVAL4-004: EconomyAggregationProvider marks unresolvable derived accounts as incomplete and lists domain in unknownContributors", async () => {
  const docDerived = createDoc("dom-derived-test", "Derived Domain", [
    {
      mode: "derived",
      domainUuid: "JournalEntry.dom-derived-test",
      resourceId: "domain-manager:treasury",
      resolverId: "unregistered-resolver-service",
      derivedBalanceMinor: 0,
      baseCapacityMinor: 10000,
      visibility: "public"
    }
  ]);

  const docMap = new Map<string, IdentifiedJournalEntryDocumentLike>([
    [docDerived.id, docDerived],
    [docDerived.uuid, docDerived]
  ]);

  const repo = new StorageDomainRepository({
    get: (id: string) => docMap.get(id),
    list: () => [...new Set(docMap.values())],
    create: async () => { throw new Error("not used"); }
  });

  const registry = createDefaultResourceRegistry();
  const reservationStore = new ReservationStore();

  const aggregator = new EconomyAggregationProvider({
    domains: repo,
    resourceRegistry: registry,
    reservationStore
  });

  const result = await aggregator.getAggregateContext(
    [docDerived.uuid],
    { isGm: true }
  );

  const treasuryStats = result.totals.find((t) => t.resourceId === "domain-manager:treasury")!;
  assert.ok(treasuryStats);
  assert.equal(treasuryStats.isComplete, false, "Resource stats must be incomplete when derived account is unresolvable");
  assert.equal(treasuryStats.unknownContributorCount, 1, "Should count 1 unknown contributor");

  assert.ok(result.unknownContributors.includes(docDerived.uuid), "Domain UUID must be included in unknownContributors for GM");
});

test("G4-REVAL5-004: In-memory state rolls back on storage failure for thresholds and custom resources", async () => {
  // 1. ThresholdService rollback on flush failure (both new threshold and updating existing)
  let throwOnSave = true;
  class FailingThresholdStorageAdapter implements ThresholdStorageAdapter {
    async loadSnapshot() { return null; }
    async saveSnapshot() {
      if (throwOnSave) {
        throw new Error("I/O Storage Error: Disk full");
      }
    }
  }

  const thresholdAdapter = new FailingThresholdStorageAdapter();
  const thresholdService = new ThresholdService({ storageAdapter: thresholdAdapter });

  // First save an initial threshold while storage is working
  throwOnSave = false;
  const initRes = thresholdService.register({
    id: "thresh-existing",
    domainUuid: "JournalEntry.dom-rollback",
    resourceId: "domain-manager:treasury",
    name: "Original Name",
    metric: "balance",
    operator: "<=",
    targetValueMinor: 100,
    severity: "warning"
  });
  assert.equal(initRes.ok, true);
  await thresholdService.flush();

  // Re-enable failure
  throwOnSave = true;

  const registry = new CommandRegistry();
  const authorityService = new PrimaryAuthorityService(
    {
      getUsers: () => [{ id: "gm-1", isGM: true, active: true }],
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-1"
    },
    { authorityUserId: "gm-1", authorityEpoch: 1, initialized: true }
  );
  const commandBus = new CommandBus({ registry, authorityService });

  const doc = createDoc("dom-rollback", "Rollback Domain");
  const docMap = new Map([[doc.id, doc], [doc.uuid, doc]]);
  const domains = new StorageDomainRepository({
    get: (id: string) => docMap.get(id),
    list: () => [...new Set(docMap.values())],
    create: async () => { throw new Error("not used"); }
  });

  const resourceRegistry = createDefaultResourceRegistry();

  class FailingCustomResourceStorageAdapter implements CustomResourceStorageAdapter {
    async loadSnapshot() { return null; }
    async saveSnapshot() {
      throw new Error("I/O Storage Error: Custom resource disk full");
    }
  }

  const customResourceStore = new CustomResourceDefinitionStore({
    storageAdapter: new FailingCustomResourceStorageAdapter()
  });

  registerEconomyCommands({
    registry,
    domains,
    resourceRegistry,
    thresholdService,
    customResourceStore
  });

  // A. Command setting NEW threshold fails and rolls back from in-memory ThresholdService
  const cmdNewThreshold = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createOpaqueId("cmd"),
    type: "economy:set-threshold",
    payload: {
      id: "thresh-new-fail",
      domainUuid: doc.uuid,
      resourceId: "domain-manager:treasury",
      name: "New Failed Threshold",
      metric: "balance" as const,
      operator: "<=" as const,
      targetValueMinor: 50,
      severity: "critical" as const
    },
    issuedAtReal: Date.now()
  };

  const receiptNew = await commandBus.execute(cmdNewThreshold);
  assert.equal(receiptNew.ok, true);
  assert.equal(receiptNew.value.status, "rejected");
  assert.equal(receiptNew.value.error?.code, "DM_DOMAIN_STORAGE_ERROR");
  assert.equal(thresholdService.getThreshold("thresh-new-fail"), undefined, "New threshold must be rolled back from in-memory state");

  // B. Command updating EXISTING threshold fails and restores original threshold in memory
  const cmdUpdateThreshold = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createOpaqueId("cmd"),
    type: "economy:set-threshold",
    payload: {
      id: "thresh-existing",
      domainUuid: doc.uuid,
      resourceId: "domain-manager:treasury",
      name: "Updated Name That Should Rollback",
      metric: "balance" as const,
      operator: "<=" as const,
      targetValueMinor: 999,
      severity: "critical" as const
    },
    issuedAtReal: Date.now()
  };

  const receiptUpdate = await commandBus.execute(cmdUpdateThreshold);
  assert.equal(receiptUpdate.ok, true);
  assert.equal(receiptUpdate.value.status, "rejected");
  assert.equal(receiptUpdate.value.error?.code, "DM_DOMAIN_STORAGE_ERROR");
  // Check that the existing threshold in memory was restored to original values!
  const restored = thresholdService.getThreshold("thresh-existing");
  assert.ok(restored);
  assert.equal(restored?.name, "Original Name", "Existing threshold must be restored to previous state on failure");
  assert.equal(restored?.targetValueMinor, 100);

  // C. Command registering custom resource fails on storage: definition rolled back from store and NOT in registry
  const customDef = {
    id: "world:failed-mineral",
    version: 1,
    label: "Failed Mineral",
    description: "Will fail storage",
    categoryId: "mineral",
    tags: ["ore"],
    precision: 2,
    displayUnit: { singular: "chunk", plural: "chunks" },
    minimumMinor: 0,
    maximumMinor: 50000,
    allowNegative: false,
    defaultCapacityPolicy: "block" as const,
    lifecycle: "active" as const
  };

  const cmdCustom = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createOpaqueId("cmd"),
    type: "economy:register-custom-resource",
    payload: { definition: customDef },
    issuedAtReal: Date.now()
  };

  const receiptCustom = await commandBus.execute(cmdCustom);
  assert.equal(receiptCustom.ok, true);
  assert.equal(receiptCustom.value.status, "rejected");
  assert.equal(receiptCustom.value.error?.code, "DM_DOMAIN_STORAGE_ERROR");

  // Verify definition is NOT present in customResourceStore or resourceRegistry
  assert.equal(customResourceStore.get("world:failed-mineral"), undefined, "Definition must be rolled back from CustomResourceDefinitionStore");
  assert.equal(resourceRegistry.get("world:failed-mineral"), undefined, "Definition must not be registered in ResourceDefinitionRegistry");
});


