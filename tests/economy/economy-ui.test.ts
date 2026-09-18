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
import { buildEconomyViewModel } from "../../src/ui/domain-patterns/economy/economy-presenter.js";
import {
  escapeAttribute,
  escapeHtml,
  renderEconomySubsystemHtml
} from "../../src/ui/domain-patterns/economy/economy-view.js";
import {
  EconomyApplication,
  EconomyApplicationController
} from "../../src/ui/domain-patterns/economy/economy-app.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import {
  getDomainEconomyData,
  withDomainEconomyData,
  type DomainEconomyData
} from "../../src/economy/economy-data.js";

const testRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "UI Test Domain", description: "Testing" },
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
  value = testRecord,
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

test("G4.9: buildEconomyViewModel sanitizes secret accounts for non-GM viewers", () => {
  const registry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();

  const econData: DomainEconomyData = {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-1",
        resourceId: "domain-manager:treasury",
        balanceMinor: 5000,
        baseCapacityMinor: 10000,
        visibility: "public"
      },
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-1",
        resourceId: "domain-manager:supplies",
        balanceMinor: 200,
        baseCapacityMinor: 1000,
        visibility: "secret" // secret cache
      }
    ]
  };

  const domainDoc = document("dom-1", "Realm Alpha", withDomainEconomyData(testRecord, econData));

  // GM viewer sees both accounts
  const gmVm = buildEconomyViewModel(domainDoc, {
    viewerIsGm: true,
    resourceRegistry: registry,
    ledgerStore,
    reservationStore
  });
  assert.equal(gmVm.accounts.length, 2);
  assert.equal(gmVm.accounts[0].resourceId, "domain-manager:treasury");
  assert.equal(gmVm.accounts[1].resourceId, "domain-manager:supplies");
  assert.equal(gmVm.accounts[1].isSecret, true);

  // Non-GM viewer sees ONLY the public account (DEC-16888–16894)
  const playerVm = buildEconomyViewModel(domainDoc, {
    viewerIsGm: false,
    resourceRegistry: registry,
    ledgerStore,
    reservationStore
  });
  assert.equal(playerVm.accounts.length, 1);
  assert.equal(playerVm.accounts[0].resourceId, "domain-manager:treasury");
  assert.equal(playerVm.accounts.some((a) => a.resourceId === "domain-manager:supplies"), false);
});

test("G4.9: renderEconomySubsystemHtml escapes malicious input against XSS", () => {
  const maliciousVm = {
    domainUuid: 'dom-xss" onmouseover="alert(1)',
    viewerIsGm: false,
    accounts: [
      {
        resourceId: "world:custom",
        label: '<script>alert("xss")</script>',
        balanceMinor: 100,
        balanceFormatted: '<img src=x onerror=alert(1)>',
        reservedMinor: 0,
        reservedFormatted: "0",
        availableMinor: 100,
        availableFormatted: "100",
        effectiveCapacityMinor: null,
        capacityFormatted: "Unlimited",
        capacityPercentage: null,
        isSecret: false,
        statusBadgeClass: "normal" as const
      }
    ],
    recentLedger: [
      {
        id: "led_1",
        timestampFormatted: "12:00",
        kind: '<b onclick="evil()">click</b>',
        deltaFormatted: "+100",
        deltaClass: "positive" as const,
        reason: '<script>evil()</script>',
        resourceLabel: "Gold"
      }
    ]
  };

  const html = renderEconomySubsystemHtml(maliciousVm);

  // Must not contain raw unescaped script tags or onerror attributes
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img src=x onerror=alert(1)>'), false);
  assert.equal(html.includes('onclick="evil()"'), false);
  assert.equal(html.includes('&lt;script&gt;'), true);
  assert.equal(html.includes('&lt;img src=x onerror=alert(1)&gt;'), true);
});

test("G4.9: EconomyApplication and EconomyApplicationController lifecycle", async () => {
  const initialRecord = withDomainEconomyData(testRecord, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-1",
        resourceId: "domain-manager:treasury",
        balanceMinor: 5000,
        baseCapacityMinor: 10000,
        visibility: "public"
      }
    ]
  });
  const doc = document("dom-1", "Domain Capital", initialRecord);
  const store = createStore([doc]);
  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore
  });

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

  const app = new EconomyApplication({
    domainUuid: doc.uuid,
    commandBus,
    economyService,
    domains,
    viewer: { isGm: true }
  });

  assert.equal(app.controller.domainUuid, doc.uuid);
  assert.equal(app.controller.activeModal, null);

  // Render application
  await app.render();
  assert.equal(app.element !== null, true);
  assert.equal(app.element.className.includes("dm-economy-app-v2"), true);

  // Open modal
  app.controller.openModal("transfer");
  assert.equal(app.controller.activeModal, "transfer");

  await app.render();
  assert.equal(app.element.innerHTML.includes("dm-transfer-modal"), true);

  // Close modal
  app.controller.closeModal();
  assert.equal(app.controller.activeModal, null);

  await app.render();
  assert.equal(app.element.innerHTML.includes("dm-transfer-modal"), false);

  // 1. Resource Detail Modal
  app.controller.openResourceDetail("domain-manager:treasury");
  assert.equal(app.controller.activeModal, "resourceDetail");
  assert.equal(app.controller.selectedResourceId, "domain-manager:treasury");

  await app.render();
  assert.equal(app.element.innerHTML.includes("dm-detail-modal"), true);
  assert.equal(app.element.innerHTML.includes("domain-manager:treasury"), true);

  app.controller.closeModal();
  await app.render();
  assert.equal(app.element.innerHTML.includes("dm-detail-modal"), false);

  // 2. Transfer & Adjust preview boxes
  app.controller.openModal("transfer");
  await app.render();
  assert.equal(app.element.innerHTML.includes("dm-transfer-preview"), true);

  app.controller.openModal("adjust");
  await app.render();
  assert.equal(app.element.innerHTML.includes("dm-adjust-preview"), true);
  app.controller.closeModal();

  // 3. Ledger pagination controls
  for (let i = 1; i <= 25; i++) {
    ledgerStore.append({
      domainUuid: doc.uuid,
      resourceId: "domain-manager:treasury",
      deltaMinor: i * 10,
      kind: "adjustment",
      source: { type: "manual" }
    });
  }

  await app.render();
  assert.equal(app.element.innerHTML.includes("dm-ledger-pagination"), true);
  assert.equal(app.element.innerHTML.includes("nextLedgerPage"), true);

  // Next page navigation
  app.controller.nextLedgerPage();
  assert.equal(app.controller.ledgerPage, 1);
  await app.render();
  assert.equal(app.element.innerHTML.includes("Page 2"), true);

  app.controller.prevLedgerPage();
  assert.equal(app.controller.ledgerPage, 0);

  // 4. Reservation release action button
  const createRes = reservationStore.create({
    domainUuid: doc.uuid,
    resourceId: "domain-manager:treasury",
    originalAmountMinor: 500,
    source: { type: "manual", reason: "Test reservation" }
  });
  assert.equal(createRes.ok, true);

  await app.render();
  assert.equal(app.element.innerHTML.includes('data-action="releaseReservation"'), true);
});

test("G4-REVAL3-005: buildEconomyViewModel enforces restricted clearance and masks reasons for non-GM viewers", () => {
  const registry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();

  const domainUuid = "JournalEntry.dom-sec-test";
  const econData: DomainEconomyData = {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid,
        resourceId: "domain-manager:treasury",
        balanceMinor: 10000,
        baseCapacityMinor: 20000,
        visibility: "public"
      },
      {
        mode: "native",
        domainUuid,
        resourceId: "domain-manager:supplies",
        balanceMinor: 5000,
        baseCapacityMinor: 10000,
        visibility: "secret"
      },
      {
        mode: "native",
        domainUuid,
        resourceId: "domain-manager:materials",
        balanceMinor: 2500,
        baseCapacityMinor: 5000,
        visibility: "restricted"
      }
    ]
  };

  const domainDoc = document("dom-sec-test", "Security Test Domain", withDomainEconomyData(testRecord, econData));

  // Ledger entries and reservations with sensitive reasons
  ledgerStore.append({
    domainUuid,
    resourceId: "domain-manager:treasury",
    deltaMinor: 1000,
    kind: "adjustment",
    source: { type: "manual", reason: "Classified GM funds transfer" }
  });

  reservationStore.create({
    domainUuid,
    resourceId: "domain-manager:treasury",
    originalAmountMinor: 500,
    source: { type: "manual", reason: "Classified covert op reservation" }
  });

  // 1. GM Viewer: sees public, secret, and restricted; sees unmasked reasons
  const gmVm = buildEconomyViewModel(domainDoc, {
    viewer: { isGm: true },
    resourceRegistry: registry,
    ledgerStore,
    reservationStore
  });
  assert.equal(gmVm.accounts.length, 3);
  assert.equal(gmVm.accounts.some((a) => a.resourceId === "domain-manager:treasury"), true);
  assert.equal(gmVm.accounts.some((a) => a.resourceId === "domain-manager:supplies"), true);
  assert.equal(gmVm.accounts.some((a) => a.resourceId === "domain-manager:materials"), true);
  assert.equal(gmVm.recentLedger[0].reason, "Classified GM funds transfer");
  assert.equal(gmVm.reservations[0].reason, "Classified covert op reservation");

  // 2. Player Viewer WITHOUT restricted clearance: sees ONLY public; reasons are undefined
  const unprivilegedPlayerVm = buildEconomyViewModel(domainDoc, {
    viewer: { isGm: false, allowedRestrictedRefs: [] },
    resourceRegistry: registry,
    ledgerStore,
    reservationStore
  });
  assert.equal(unprivilegedPlayerVm.accounts.length, 1);
  assert.equal(unprivilegedPlayerVm.accounts[0].resourceId, "domain-manager:treasury");
  assert.equal(unprivilegedPlayerVm.accounts.some((a) => a.resourceId === "domain-manager:supplies"), false);
  assert.equal(unprivilegedPlayerVm.accounts.some((a) => a.resourceId === "domain-manager:materials"), false);
  assert.equal(unprivilegedPlayerVm.recentLedger[0].reason, undefined);
  assert.equal(unprivilegedPlayerVm.reservations[0].reason, undefined);

  // 3. Player Viewer WITH restricted clearance for domain-manager:materials:
  // sees public AND restricted; secret remains strictly hidden; reasons remain masked
  const privilegedPlayerVm = buildEconomyViewModel(domainDoc, {
    viewer: { isGm: false, allowedRestrictedRefs: ["domain-manager:materials"] },
    resourceRegistry: registry,
    ledgerStore,
    reservationStore
  });
  assert.equal(privilegedPlayerVm.accounts.length, 2);
  assert.equal(privilegedPlayerVm.accounts.some((a) => a.resourceId === "domain-manager:treasury"), true);
  assert.equal(privilegedPlayerVm.accounts.some((a) => a.resourceId === "domain-manager:materials"), true);
  assert.equal(privilegedPlayerVm.accounts.some((a) => a.resourceId === "domain-manager:supplies"), false);
  assert.equal(privilegedPlayerVm.recentLedger[0].reason, undefined);
  assert.equal(privilegedPlayerVm.reservations[0].reason, undefined);
});

test("G4-REVAL3-006: EconomyApplication action dispatch executes exactly once per click (single action pipeline)", async () => {
  const initialRecord = withDomainEconomyData(testRecord, {
    schemaVersion: 1,
    accounts: [
      {
        mode: "native",
        domainUuid: "JournalEntry.dom-action-test",
        resourceId: "domain-manager:treasury",
        balanceMinor: 5000,
        baseCapacityMinor: 10000,
        visibility: "public"
      }
    ]
  });
  const doc = document("dom-action-test", "Action Test Domain", initialRecord);
  const store = createStore([doc]);
  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore
  });

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

  const app = new EconomyApplication({
    domainUuid: doc.uuid,
    commandBus,
    economyService,
    domains,
    viewer: { isGm: true }
  });

  await app.render();

  // Track how many times openTransferModal is called
  let modalOpenCount = 0;
  const originalOpenModal = app.controller.openModal.bind(app.controller);
  app.controller.openModal = (type: any, resId?: any) => {
    if (type === "transfer") {
      modalOpenCount++;
    }
    return originalOpenModal(type, resId);
  };

  // Simulate click event on openTransferModal button
  const clickListeners = (app.element as any)._listeners?.click ?? [];
  const fakeEvent = {
    target: {
      getAttribute: (name: string) => (name === "data-action" ? "openTransferModal" : null),
      dataset: { action: "openTransferModal" },
      parentElement: app.element
    },
    currentTarget: app.element
  };

  // If mock element has addEventListener click handlers, trigger them
  for (const listener of clickListeners) {
    await listener(fakeEvent);
  }

  // Under the single action pipeline, it must have been invoked exactly 1 time
  assert.equal(modalOpenCount, 1);
});

test("G4-REVAL4-004: buildEconomyViewModel includes provider health statuses and transaction history", async () => {
  const registry = createDefaultResourceRegistry();
  const doc = document("dom-ui-t4", "T4 Domain", withDomainEconomyData(testRecord, {
    schemaVersion: 1,
    accounts: [
      { mode: "native", domainUuid: "JournalEntry.dom-ui-t4", resourceId: "domain-manager:treasury", balanceMinor: 5000, baseCapacityMinor: 10000, visibility: "public" }
    ]
  }));

  const { TransactionStore } = await import("../../src/mutations/transaction-store.js");
  const { createTransactionRecord } = await import("../../src/mutations/transaction-record.js");
  const transactionStore = new TransactionStore();

  const tx1 = createTransactionRecord({
    transactionId: "tx-ui-1",
    commandId: "cmd-ui-1" as any,
    authorityEpoch: 1,
    lockKeys: [doc.uuid],
    recoveryData: {
      type: "economy:adjust",
      domainUuid: doc.uuid,
      resourceId: "domain-manager:treasury",
      deltaMinor: 2500,
      reason: "Grant bonus"
    }
  });
  transactionStore.save(tx1);
  transactionStore.transition(tx1.transactionId, "claimed", 1);
  transactionStore.transition(tx1.transactionId, "prepared", 1);
  transactionStore.transition(tx1.transactionId, "committing", 1);
  transactionStore.transition(tx1.transactionId, "committed", 1);

  const providerHealthMap = new Map([
    ["mock:currency", { status: "healthy" as const, lastCheckedAt: Date.now() - 1000 }],
    ["mock:inventory", { status: "degraded" as const, message: "Sync latency high", lastCheckedAt: Date.now() }]
  ]);

  const mockProviderRegistry = {
    list: () => [
      { providerId: "mock:currency", label: "Mock Currency" },
      { providerId: "mock:inventory", label: "Mock Inventory" }
    ],
    get: () => undefined
  };

  const vm = buildEconomyViewModel(doc, {
    viewerIsGm: true,
    resourceRegistry: registry,
    transactionStore,
    providerRegistry: mockProviderRegistry as any,
    providerHealthMap
  });

  // Check provider statuses
  assert.ok(vm.providerStatuses);
  assert.equal(vm.providerStatuses.length, 2);
  const curProv = vm.providerStatuses.find((p) => p.providerId === "mock:currency");
  assert.ok(curProv);
  assert.equal(curProv.status, "healthy");
  assert.equal(curProv.statusBadgeClass, "badge--healthy");

  const invProv = vm.providerStatuses.find((p) => p.providerId === "mock:inventory");
  assert.ok(invProv);
  assert.equal(invProv.status, "degraded");
  assert.equal(invProv.statusBadgeClass, "badge--degraded");

  // Check transactions
  assert.ok(vm.transactions);
  assert.equal(vm.transactions.length, 1);
  assert.equal(vm.transactions[0].transactionId, "tx-ui-1");
  assert.equal(vm.transactions[0].state, "committed");
  assert.equal(vm.transactions[0].reason, "Grant bonus");

  // Render HTML check
  const html = renderEconomySubsystemHtml(vm);
  assert.ok(html.includes("data-action=\"openTransactionHistoryModal\""));
  assert.ok(html.includes("Provider Status"));
  assert.ok(html.includes("HEALTHY"));
  assert.ok(html.includes("DEGRADED"));
});

test("G4-REVAL4-004: EconomyApplicationController dispatches Quick Resource Create and Account", async () => {
  const doc = document("dom-quick-res", "Quick Res Domain", withDomainEconomyData(testRecord, {
    schemaVersion: 1,
    accounts: []
  }));
  const store = createStore([doc]);
  const domains = new StorageDomainRepository(store);
  const resourceRegistry = createDefaultResourceRegistry();
  const ledgerStore = new LedgerStore();
  const reservationStore = new ReservationStore();
  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore
  });
  const { CustomResourceDefinitionStore } = await import("../../src/economy/definitions/custom-resource-store.js");
  const customResourceStore = new CustomResourceDefinitionStore();

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

  const { registerEconomyCommands } = await import("../../src/economy/commands/economy-commands.js");
  registerEconomyCommands({
    registry,
    domains,
    resourceRegistry,
    economyService,
    customResourceStore
  });

  const app = new EconomyApplication({
    domainUuid: doc.uuid,
    commandBus,
    domains,
    economyService,
    viewer: { isGm: true }
  });

  const res = await app.controller.dispatchQuickResourceCreateAndAccount({
    definition: {
      id: "world:mithril",
      label: "Mithril Ingot",
      precision: 0,
      unit: "ingot",
      description: "Rare silver metal"
    },
    account: {
      initialBalanceMinor: 100,
      baseCapacityMinor: 5000
    }
  });

  if (!res.ok) {
    console.error("DISPATCH QUICK CREATE ERROR:", res.error);
  }
  assert.equal(res.ok, true);

  // Resource is registered
  assert.equal(resourceRegistry.has("world:mithril"), true);
  assert.equal(customResourceStore.has("world:mithril"), true);

  // Account is created in domain
  const updatedDoc = await domains.read(doc.uuid);
  assert.equal(updatedDoc.ok, true);
  if (updatedDoc.ok) {
    const econ = getDomainEconomyData(updatedDoc.value.record);
    const acct = econ.accounts.find((a) => a.resourceId === "world:mithril");
    assert.ok(acct);
    assert.equal(acct.balanceMinor, 100);
  }
});

