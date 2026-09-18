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
