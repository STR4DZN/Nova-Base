import test from "node:test";
import assert from "node:assert/strict";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { InMemoryTransactionStorageAdapter } from "../../src/mutations/transaction-storage-adapter.js";
import { RecoveryFenceRegistry } from "../../src/mutations/recovery-fence-registry.js";
import { RecoveryService } from "../../src/mutations/recovery-service.js";
import { CompositeMutationSession } from "../../src/mutations/composite-mutation-session.js";
import { lockKey } from "../../src/mutations/lock-keys.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { EconomyService } from "../../src/economy/services/economy-service.js";
import { createDefaultResourceRegistry } from "../../src/economy/definitions/resource-registry.js";
import { LedgerStore } from "../../src/economy/ledger/ledger-store.js";
import { InMemoryLedgerStorageAdapter } from "../../src/economy/storage/ledger-storage-adapter.js";
import { ReservationStore } from "../../src/economy/reservations/reservation-store.js";
import { InMemoryReservationStorageAdapter } from "../../src/economy/storage/reservation-storage-adapter.js";
import { PeopleService } from "../../src/people/services/people-service.js";
import { createDefaultDomainPeopleData } from "../../src/people/people-data.js";
import {
  compensateProjectStart,
  compensateProjectCompletion
} from "../../src/projects/services/project-recovery-compensators.js";
import {
  createDefaultDomainFacilitiesData,
  getDomainFacilitiesData,
  withDomainFacilitiesData
} from "../../src/facilities/facility-data.js";
import {
  createDefaultDomainProjectsData,
  getDomainProjectsData,
  withDomainProjectsData
} from "../../src/projects/project-data.js";
import {
  createDefaultDomainDowntimeData,
  getDomainDowntimeData,
  withDomainDowntimeData
} from "../../src/downtime/downtime-data.js";
import { composeDomainManagerRuntime } from "../../src/bootstrap/domain-manager-runtime.js";
import type { DomainDocumentStore } from "../../src/storage/repositories/domain-repository.js";
import type {
  FoundryAuthorityUserLike,
  PrimaryAuthorityHost
} from "../../src/authority/foundry-primary-authority-adapter.js";
import {
  type TransactionalChildHandler,
  type ReconcileOutcome,
  DefaultTransactionalChildHandlerRegistry
} from "../../src/mutations/child-handler-contract.js";
import { ok, err, type Result } from "../../src/core/contracts/result.js";
import { createPublicError, type PublicError } from "../../src/core/contracts/public-error.js";
import { createTransactionRecord, type TransactionRecord } from "../../src/mutations/transaction-record.js";
import { executeProjectStartDomainOperationPlan } from "../../src/projects/plans/project-start-domain-operation-plan.js";
import { executeProjectCompletionDomainOperationPlan } from "../../src/projects/plans/project-completion-domain-operation-plan.js";
import { executeDowntimeResolutionPlan } from "../../src/downtime/plans/downtime-resolution-plan.js";
import { compensateDowntimeResolution } from "../../src/downtime/services/downtime-recovery-compensators.js";
import {
  createDefaultProjectRegistry,
  ProjectDefinitionRegistry
} from "../../src/projects/definitions/project-registry.js";
import {
  createDefaultFacilityRegistry,
  FacilityDefinitionRegistry
} from "../../src/facilities/definitions/facility-registry.js";
import {
  createDefaultDowntimeRegistry,
  DowntimeDefinitionRegistry
} from "../../src/downtime/definitions/downtime-registry.js";
import { FacilitiesService } from "../../src/facilities/services/facilities-service.js";
import { ProjectsService } from "../../src/projects/services/projects-service.js";
import { DowntimeService } from "../../src/downtime/services/downtime-service.js";
import type { ProjectInstance } from "../../src/projects/types/project-types.js";
import type { DowntimeInstance } from "../../src/downtime/types/downtime-types.js";
import type { ChildReceipt } from "../../src/projects/plans/project-plan-types.js";
import {
  ManualCurrencyProvider,
  MANUAL_CURRENCY_PROVIDER_ID
} from "../../src/economy/providers/manual-currency-provider.js";
import { ProviderRegistry } from "../../src/economy/providers/provider-registry.js";

// Helper: In-memory domain document fixture with full capability configurations
function createMockDomainDoc(id: string, initialBalance = 1000) {
  let doc = {
    id,
    uuid: id.startsWith("JournalEntry.") ? id : `JournalEntry.${id}`,
    name: "Hardening Test Domain",
    get flags() {
      return { "domain-manager": doc.record };
    },
    ownership: { default: 0, "gm-1": 3, "gm-a": 3, "gm-b": 3 },
    update: async (data: Record<string, unknown>) => {
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        doc.record = JSON.parse(JSON.stringify(payload));
      }
    },
    record: {
      schemaVersion: 1,
      revision: 1,
      definition: {
        identity: { aliases: [], summary: "Hardening Test Domain", description: "" },
        classification: { kind: "base", scale: "small", tags: [] },
        hierarchy: { parentDomainUuid: null },
        capabilities: {
          enabled: [
            "domain-manager:domain",
            "domain-manager:economy",
            "domain-manager:people",
            "domain-manager:projects",
            "domain-manager:facilities",
            "domain-manager:downtime"
          ],
          config: {
            "domain-manager:projects": createDefaultDomainProjectsData(),
            "domain-manager:facilities": createDefaultDomainFacilitiesData(),
            "domain-manager:downtime": createDefaultDomainDowntimeData(),
            "domain-manager:economy": {
              schemaVersion: 1,
              accounts: [
                {
                  mode: "native",
                  domainUuid: id,
                  resourceId: "domain-manager:materials",
                  balanceMinor: initialBalance,
                  baseCapacityMinor: null
                }
              ]
            },
            "domain-manager:people": {
              ...createDefaultDomainPeopleData(),
              operationalGroups: [
                {
                  id: createOpaqueId("opg"),
                  name: "General Laborers",
                  definitionId: "domain-manager:laborers",
                  membershipMode: "abstract",
                  schemaVersion: 1,
                  size: 30,
                  lifecycle: "active",
                  tags: []
                }
              ]
            }
          }
        }
      },
      state: { lifecycle: "active" },
      metadata: { createdByUserId: "gm-test", archivedAt: null, source: { type: "manual", ref: null } }
    }
  };

  return {
    getDoc: () => doc,
    domains: {
      read: async (uuid: string) => ok(doc),
      update: async (d: any) => {
        doc = d;
        return ok(d);
      },
      save: async (d: any) => {
        doc = d;
        return ok(d);
      }
    }
  };
}

function createAuthorityHost(currentUserId: string | null = "gm-1"): PrimaryAuthorityHost {
  const users: FoundryAuthorityUserLike[] = [
    { id: "gm-1", isGM: true, active: true },
    { id: "player-1", isGM: false, active: true }
  ];
  const service = new PrimaryAuthorityService<FoundryAuthorityUserLike>(
    {
      getUsers: () => users,
      getPreferredUserId: () => null,
      getCurrentUserId: () => currentUserId
    },
    {
      authorityUserId: "gm-1",
      authorityEpoch: 1,
      initialized: true
    }
  );

  return {
    service,
    reconcile: async () => service.resolve(),
    synchronizePersistedState: (value) => service.synchronizeState(value as any)
  };
}

// ---------------------------------------------------------------------------
// T1: Project Start / Economy debit (real upfront debit effect -> receipt flush failure -> rehydrate stores -> recovery refunds debit)
// ---------------------------------------------------------------------------
test("T1: Project Start / Economy debit (real upfront debit effect -> receipt flush failure -> rehydrate stores -> recovery refunds debit)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t1", 1000);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const ledgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());

  let failReceipt = false;
  class FaultyAdapter extends InMemoryTransactionStorageAdapter {
    override async saveSnapshot(snapshot: any): Promise<void> {
      if (failReceipt) {
        failReceipt = false;
        throw new Error("Disk error flushing receipt for upfront debit");
      }
      return super.saveSnapshot(snapshot);
    }
  }

  const adapter = new FaultyAdapter();
  const txStore = new TransactionStore(adapter);
  const fenceRegistry = new RecoveryFenceRegistry();
  const projectRegistry = createDefaultProjectRegistry();

  projectRegistry.register({
    id: "test:proj-upfront-cost",
    version: 1,
    label: "Upfront Project",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["test"],
    requirements: [],
    costs: [
      {
        resourceId: "domain-manager:materials",
        amountMinor: 150,
        timing: "upfront"
      }
    ],
    rewards: []
  });

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  // Intercept commitAdjust: trigger failReceipt immediately after the economy effect is executed
  const origAdjust = economyService.commitAdjust.bind(economyService);
  economyService.commitAdjust = async (args) => {
    const res = await origAdjust(args);
    failReceipt = true;
    return res;
  };

  const peopleService = new PeopleService(domains);

  // Execute real project start domain operation plan
  const planRes = await executeProjectStartDomainOperationPlan(
    {
      domains,
      projectRegistry,
      economyService,
      peopleService,
      transactionStore: txStore
    },
    {
      domainUuid: "dom-t1",
      definitionId: "test:proj-upfront-cost",
      commandId: createCommandId(),
      authorityEpoch: 1
    }
  );

  assert.equal(planRes.ok, false);
  assert.equal(planRes.error.code, "DM_DOMAIN_STORAGE_ERROR");

  // Effect DID apply: domain account was debited 150 (1000 - 150 = 850)
  const midDoc = getDoc();
  const midEcon = (midDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  assert.equal(midEcon.accounts[0].balanceMinor, 850);

  // Transaction record on disk is in needs-recovery with active fence
  const records = txStore.listAll();
  assert.equal(records.length, 1);
  const tx = records[0];
  assert.equal(tx.state, "needs-recovery");

  // Step in recoveryData is in unknown state
  const step = (tx.recoveryData as any).steps?.find((s: any) => s.operation === "adjust");
  assert.ok(step);
  assert.equal(step.state, "unknown");
  assert.equal(step.receipt, undefined);
  assert.equal(step.intent.deltaMinor, -150);

  // Rehydrate stores from persisted snapshot (simulating process restart)
  failReceipt = false;
  const snapshotData = await adapter.loadSnapshot();
  const rehydratedAdapter = new InMemoryTransactionStorageAdapter({ snapshot: snapshotData });
  const rehydratedTxStore = new TransactionStore(rehydratedAdapter);
  await rehydratedTxStore.rehydrate();

  // Run compensator on the rehydrated transaction
  const rehydratedTx = rehydratedTxStore.get(tx.transactionId)!;
  const compRes = await compensateProjectStart(rehydratedTx, {
    domains,
    economyService,
    peopleService,
    transactionStore: rehydratedTxStore
  });

  assert.equal(compRes.ok, true);

  // Verification: upfront debit was refunded! Balance is back to 1000!
  const finalDoc = getDoc();
  const finalEcon = (finalDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  assert.equal(finalEcon.accounts[0].balanceMinor, 1000);
});

// ---------------------------------------------------------------------------
// T2: Project Start / Economy reservation (real reservation -> receipt flush failure -> rehydrate -> compensator releases reservation using step.intent.reservationId)
// ---------------------------------------------------------------------------
test("T2: Project Start / Economy reservation (real reservation -> receipt flush failure -> rehydrate -> compensator releases reservation using step.intent.reservationId)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t2", 1000);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const ledgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());

  let failReceipt = false;
  class FaultyAdapter extends InMemoryTransactionStorageAdapter {
    override async saveSnapshot(snapshot: any): Promise<void> {
      if (failReceipt) {
        failReceipt = false;
        throw new Error("Disk error flushing receipt for reservation");
      }
      return super.saveSnapshot(snapshot);
    }
  }

  const adapter = new FaultyAdapter();
  const txStore = new TransactionStore(adapter);
  const projectRegistry = createDefaultProjectRegistry();

  projectRegistry.register({
    id: "test:proj-reserved-cost",
    version: 1,
    label: "Reserved Project",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["test"],
    requirements: [],
    costs: [
      {
        resourceId: "domain-manager:materials",
        amountMinor: 200,
        timing: "reserved"
      }
    ],
    rewards: []
  });

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  // Intercept reserve: trigger failReceipt immediately after the reservation is recorded
  const origReserve = economyService.reserve.bind(economyService);
  economyService.reserve = async (args) => {
    const res = await origReserve(args);
    failReceipt = true;
    return res;
  };

  const peopleService = new PeopleService(domains);

  // Execute real project start domain operation plan
  const planRes = await executeProjectStartDomainOperationPlan(
    {
      domains,
      projectRegistry,
      economyService,
      peopleService,
      transactionStore: txStore
    },
    {
      domainUuid: "dom-t2",
      definitionId: "test:proj-reserved-cost",
      commandId: createCommandId(),
      authorityEpoch: 1
    }
  );

  assert.equal(planRes.ok, false);
  assert.equal(planRes.error.code, "DM_DOMAIN_STORAGE_ERROR");

  // Reservation was allocated and exists in reservation store
  const tx = txStore.listAll()[0];
  assert.ok(tx);
  assert.equal(tx.state, "needs-recovery");

  const step = (tx.recoveryData as any).steps?.find((s: any) => s.operation === "reserve");
  assert.ok(step);
  assert.equal(step.state, "unknown");
  assert.equal(step.receipt, undefined);
  const allocatedResId = step.intent?.reservationId;
  assert.ok(allocatedResId, "Pre-allocated reservationId must exist in write-ahead intent");

  const activeRes = economyService.getReservation(allocatedResId);
  assert.ok(activeRes);
  assert.equal(activeRes.status, "active");

  // Rehydrate stores
  failReceipt = false;
  const snapshotData = await adapter.loadSnapshot();
  const rehydratedTxStore = new TransactionStore(new InMemoryTransactionStorageAdapter({ snapshot: snapshotData }));
  await rehydratedTxStore.rehydrate();
  const rehydratedTx = rehydratedTxStore.get(tx.transactionId)!;

  // Run compensator: must release reservation using step.intent.reservationId
  const compRes = await compensateProjectStart(rehydratedTx, {
    domains,
    economyService,
    peopleService,
    transactionStore: rehydratedTxStore
  });

  assert.equal(compRes.ok, true);

  // Verification: reservation is released!
  const releasedRes = economyService.getReservation(allocatedResId);
  assert.ok(releasedRes);
  assert.equal(releasedRes.status, "released");
});

// ---------------------------------------------------------------------------
// T3: Project Start / Workforce reservation (real workforce allocation -> receipt flush failure -> rehydrate -> compensator releases workforce reservation using step.intent.reservationId)
// ---------------------------------------------------------------------------
test("T3: Project Start / Workforce reservation (real workforce allocation -> receipt flush failure -> rehydrate -> compensator releases workforce reservation using step.intent.reservationId)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t3", 1000);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const ledgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());

  let failReceipt = false;
  class FaultyAdapter extends InMemoryTransactionStorageAdapter {
    override async saveSnapshot(snapshot: any): Promise<void> {
      if (failReceipt) {
        failReceipt = false;
        throw new Error("Disk error flushing receipt for workforce allocation");
      }
      return super.saveSnapshot(snapshot);
    }
  }

  const adapter = new FaultyAdapter();
  const txStore = new TransactionStore(adapter);
  const projectRegistry = createDefaultProjectRegistry();

  projectRegistry.register({
    id: "test:proj-workforce-req",
    version: 1,
    label: "Workforce Project",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["test"],
    requirements: [],
    costs: [],
    rewards: []
  });

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  const peopleService = new PeopleService(domains);

  // Intercept allocateWorkforceReservation: trigger failReceipt after allocation
  const origAlloc = peopleService.allocateWorkforceReservation.bind(peopleService);
  peopleService.allocateWorkforceReservation = async (args) => {
    const res = await origAlloc(args);
    failReceipt = true;
    return res;
  };

  // Execute project start requiring 10 workforce
  const planRes = await executeProjectStartDomainOperationPlan(
    {
      domains,
      projectRegistry,
      economyService,
      peopleService,
      transactionStore: txStore
    },
    {
      domainUuid: "dom-t3",
      definitionId: "test:proj-workforce-req",
      workforceRequired: 10,
      commandId: createCommandId(),
      authorityEpoch: 1
    }
  );

  assert.equal(planRes.ok, false);
  assert.equal(planRes.error.code, "DM_DOMAIN_STORAGE_ERROR");

  const tx = txStore.listAll()[0];
  assert.ok(tx);
  assert.equal(tx.state, "needs-recovery");

  const step = (tx.recoveryData as any).steps?.find((s: any) => s.operation === "allocateWorkforceReservation");
  assert.ok(step);
  assert.equal(step.state, "unknown");
  assert.equal(step.receipt, undefined);
  const allocatedWfResId = step.intent?.reservationId;
  assert.ok(allocatedWfResId, "Pre-allocated reservationId must exist in write-ahead intent");

  // Verify active reservation exists in domain people document
  const midDoc = getDoc();
  const midPeople = (midDoc.record.definition.capabilities.config as any)["domain-manager:people"];
  const wfResBefore = midPeople.reservations?.find((r: any) => r.id === allocatedWfResId);
  assert.ok(wfResBefore);
  assert.equal(wfResBefore.status, "active");

  // Rehydrate stores
  failReceipt = false;
  const snapshotData = await adapter.loadSnapshot();
  const rehydratedTxStore = new TransactionStore(new InMemoryTransactionStorageAdapter({ snapshot: snapshotData }));
  await rehydratedTxStore.rehydrate();
  const rehydratedTx = rehydratedTxStore.get(tx.transactionId)!;

  // Run compensator
  const compRes = await compensateProjectStart(rehydratedTx, {
    domains,
    economyService,
    peopleService,
    transactionStore: rehydratedTxStore
  });

  assert.equal(compRes.ok, true);

  // Verification: workforce reservation was released via fallback to step.intent.reservationId
  const finalDoc = getDoc();
  const finalPeople = (finalDoc.record.definition.capabilities.config as any)["domain-manager:people"];
  const wfResAfter = finalPeople.reservations?.find((r: any) => r.id === allocatedWfResId);
  assert.ok(wfResAfter);
  assert.equal(wfResAfter.status, "released");
});

// ---------------------------------------------------------------------------
// T4: Project Completion / Facility create (real facility create -> receipt flush failure -> rehydrate -> compensator rolls back facility using step.intent.facilityId)
// ---------------------------------------------------------------------------
test("T4: Project Completion / Facility create (real facility create -> receipt flush failure -> rehydrate -> compensator rolls back facility using step.intent.facilityId)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t4", 1000);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const ledgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());

  let failReceipt = false;
  class FaultyAdapter extends InMemoryTransactionStorageAdapter {
    override async saveSnapshot(snapshot: any): Promise<void> {
      if (failReceipt) {
        failReceipt = false;
        throw new Error("Disk error flushing receipt for facility creation");
      }
      return super.saveSnapshot(snapshot);
    }
  }

  const adapter = new FaultyAdapter();
  const txStore = new TransactionStore(adapter);
  const projectRegistry = createDefaultProjectRegistry();
  const facilityRegistry = createDefaultFacilityRegistry();

  projectRegistry.register({
    id: "test:proj-completion-fac",
    version: 1,
    label: "Completion Facility Project",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["test"],
    requirements: [],
    costs: [],
    rewards: [
      {
        type: "facility:create",
        targetRef: "domain-manager:basic-workshop",
        label: "Workshop Facility"
      }
    ]
  });

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  const facilitiesService = new FacilitiesService({
    domains,
    facilityRegistry,
    economyService,
    transactionStore: txStore,
    lockManager
  });

  // Intercept createFacility: trigger failReceipt after facility is added to domain document
  const origCreateFacility = facilitiesService.createFacility.bind(facilitiesService);
  facilitiesService.createFacility = async (args) => {
    const res = await origCreateFacility(args);
    failReceipt = true;
    return res;
  };

  // Seed project ready to complete in domain doc
  const doc = getDoc();
  const projData = getDomainProjectsData(doc.record);
  const readyProject: ProjectInstance = {
    id: "proj-ready-comp",
    definitionId: "test:proj-completion-fac",
    domainUuid: "dom-t4",
    name: "Ready Project",
    workRequired: 100,
    workCompleted: 100,
    lifecycle: "active",
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entries: []
  };
  await domains.save({
    ...doc,
    record: withDomainProjectsData(doc.record, {
      ...projData,
      projects: [readyProject]
    })
  });

  // Execute project completion plan
  const compPlanRes = await executeProjectCompletionDomainOperationPlan(
    {
      domains,
      projectRegistry,
      facilitiesService,
      economyService,
      transactionStore: txStore
    },
    {
      domainUuid: "dom-t4",
      projectId: "proj-ready-comp",
      commandId: createCommandId(),
      authorityEpoch: 1
    }
  );

  assert.equal(compPlanRes.ok, false);
  assert.equal(compPlanRes.error.code, "DM_DOMAIN_STORAGE_ERROR");

  // Facility was created in domain document
  const midDoc = getDoc();
  const midFacData = getDomainFacilitiesData(midDoc.record);
  assert.equal(midFacData.facilities.length, 1);
  const createdFacilityId = midFacData.facilities[0].id;
  assert.ok(createdFacilityId);

  // Transaction is in needs-recovery with step in unknown state
  const tx = txStore.listAll()[0];
  assert.ok(tx);
  assert.equal(tx.state, "needs-recovery");

  const step = (tx.recoveryData as any).steps?.find((s: any) => s.operation === "createFacility");
  assert.ok(step);
  assert.equal(step.state, "unknown");
  assert.equal(step.receipt, undefined);
  assert.equal(step.intent?.facilityId, createdFacilityId, "Pre-allocated facilityId must match created facility");

  // Rehydrate stores
  failReceipt = false;
  const snapshotData = await adapter.loadSnapshot();
  const rehydratedTxStore = new TransactionStore(new InMemoryTransactionStorageAdapter({ snapshot: snapshotData }));
  await rehydratedTxStore.rehydrate();
  const rehydratedTx = rehydratedTxStore.get(tx.transactionId)!;

  // Run compensator: must remove facility using step.intent.facilityId fallback
  const compRes = await compensateProjectCompletion(rehydratedTx, {
    domains,
    transactionStore: rehydratedTxStore
  });

  assert.equal(compRes.ok, true);

  // Verification: facility was rolled back from domain document!
  const finalDoc = getDoc();
  const finalFacData = getDomainFacilitiesData(finalDoc.record);
  assert.equal(finalFacData.facilities.length, 0, "Facility must be completely removed from domain");
});

// ---------------------------------------------------------------------------
// T5: Provider child timeout (unknown outcome) -> parent marked needs-recovery, fence active, NO blind compensation
// ---------------------------------------------------------------------------
test("T5: Provider child timeout (unknown outcome) -> parent marked needs-recovery, fence active, NO blind compensation", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t5", 1000);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const ledgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const fenceRegistry = new RecoveryFenceRegistry();
  const projectRegistry = createDefaultProjectRegistry();

  projectRegistry.register({
    id: "test:proj-timeout",
    version: 1,
    label: "Timeout Project",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["test"],
    requirements: [],
    costs: [
      {
        resourceId: "domain-manager:materials",
        amountMinor: 50,
        timing: "upfront"
      }
    ],
    rewards: []
  });

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  // Mock commitAdjust to fail with provider timeout (outcome: unknown)
  economyService.commitAdjust = async () => {
    return err(
      createPublicError({
        code: "DM_ECON_PROVIDER_TIMEOUT",
        category: "internal",
        message: "External bank provider timed out; state unconfirmed",
        details: { outcome: "unknown" }
      })
    );
  };

  const peopleService = new PeopleService(domains);

  const planRes = await executeProjectStartDomainOperationPlan(
    {
      domains,
      projectRegistry,
      economyService,
      peopleService,
      transactionStore: txStore,
      recoveryFenceRegistry: fenceRegistry
    },
    {
      domainUuid: "dom-t5",
      definitionId: "test:proj-timeout",
      commandId: createCommandId(),
      authorityEpoch: 1
    }
  );

  assert.equal(planRes.ok, false);

  // Invariant 06: Transaction must enter needs-recovery without executing blind compensation
  const tx = txStore.listAll()[0];
  assert.ok(tx);
  assert.equal(tx.state, "needs-recovery");

  // Logical fence must be installed and active
  const domainKey = lockKey.domain("dom-t5");
  assert.equal(fenceRegistry.isScopeBlocked([domainKey]), true);

  // -------------------------------------------------------------------------
  // T5 Hardening: Post-restart recovery of uncertain economy step with reconciliation
  // -------------------------------------------------------------------------
  // Case 5a: Reconciliation reports "applied" -> recovery compensates (refunds debit) once
  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore: txStore,
    recoveryFenceRegistry: fenceRegistry
  });

  // Re-read or simulate that 50 was debited before the crash
  const midDoc = getDoc();
  const midEcon = (midDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  midEcon.accounts[0].balanceMinor = 950;
  await domains.save(midDoc);

  let reconcileCallCount = 0;
  let reconcileOpRef = "";
  economyService.reconcileAdjustment = async (args) => {
    reconcileCallCount++;
    reconcileOpRef = args.operationRef;
    return ok("applied");
  };

  // Restore normal commitAdjust for refund
  economyService.commitAdjust = async (args) => {
    const d = getDoc();
    const econ = (d.record.definition.capabilities.config as any)["domain-manager:economy"];
    econ.accounts[0].balanceMinor += args.deltaMinor;
    await domains.save(d);
    return ok({ balanceMinor: econ.accounts[0].balanceMinor, isNoop: false });
  };

  const recResApplied = await recoveryService.recoverTransaction(
    tx.transactionId,
    1,
    async (rec) => compensateProjectStart(rec, { domains, economyService, transactionStore: txStore })
  );

  assert.equal(recResApplied.ok, true);
  assert.equal(recResApplied.value.state, "compensated");
  assert.equal(reconcileCallCount, 1);
  assert.ok(reconcileOpRef.startsWith(`${tx.transactionId}:`), "Reconciliation must use scoped operationRef");

  // Balance refunded from 950 back to 1000
  const afterRefundDoc = getDoc();
  const afterRefundEcon = (afterRefundDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  assert.equal(afterRefundEcon.accounts[0].balanceMinor, 1000);

  // Idempotency: repeated recovery call is safe no-op
  const recResIdemp = await recoveryService.recoverTransaction(
    tx.transactionId,
    1,
    async (rec) => compensateProjectStart(rec, { domains, economyService, transactionStore: txStore })
  );
  assert.equal(recResIdemp.ok, true);
  assert.equal(afterRefundEcon.accounts[0].balanceMinor, 1000);

  // Case 5b: Interrupted step where reconciliation reports "not-applied" -> do NOT compensate
  const txNotApplied = createTransactionRecord({
    transactionId: "tx-t5-not-applied",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainKey],
    safeAutoRecovery: false
  });
  const notAppliedOpRef = `${txNotApplied.transactionId}:start_upfront_cost_0`;
  txStore.save({
    ...txNotApplied,
    state: "needs-recovery",
    recoveryData: {
      type: "projects:start",
      domainUuid: "dom-t5",
      projectId: "prj-t5-na",
      steps: [
        {
          stepId: "start_upfront_cost_0",
          subsystem: "economy",
          operation: "adjust",
          state: "unknown",
          operationRef: notAppliedOpRef,
          intent: {
            resourceId: "domain-manager:materials",
            deltaMinor: -50
          }
        }
      ]
    } as any
  });

  economyService.reconcileAdjustment = async () => ok("not-applied");

  const recResNotApplied = await recoveryService.recoverTransaction(
    txNotApplied.transactionId,
    1,
    async (rec) => compensateProjectStart(rec, { domains, economyService, transactionStore: txStore })
  );

  assert.equal(recResNotApplied.ok, true);
  assert.equal(recResNotApplied.value.state, "compensated");
  // Balance was NOT increased (must remain 1000, no money created from thin air)
  const afterNaDoc = getDoc();
  const afterNaEcon = (afterNaDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  assert.equal(afterNaEcon.accounts[0].balanceMinor, 1000);

  // Case 5c: Reconciliation reports "unknown" -> fails closed, stays in needs-recovery
  const txUnknown = createTransactionRecord({
    transactionId: "tx-t5-unknown",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [domainKey],
    safeAutoRecovery: false
  });
  txStore.save({
    ...txUnknown,
    state: "needs-recovery",
    recoveryData: {
      type: "projects:start",
      domainUuid: "dom-t5",
      projectId: "prj-t5-unk",
      steps: [
        {
          stepId: "start_upfront_cost_0",
          subsystem: "economy",
          operation: "adjust",
          state: "unknown",
          operationRef: `${txUnknown.transactionId}:start_upfront_cost_0`,
          intent: {
            resourceId: "domain-manager:materials",
            deltaMinor: -50
          }
        }
      ]
    } as any
  });

  economyService.reconcileAdjustment = async () => ok("unknown");

  const recResUnk = await recoveryService.recoverTransaction(
    txUnknown.transactionId,
    1,
    async (rec) => compensateProjectStart(rec, { domains, economyService, transactionStore: txStore })
  );

  assert.equal(recResUnk.ok, false);
  const unkRecord = txStore.get(txUnknown.transactionId)!;
  assert.equal(unkRecord.state, "needs-recovery");
});

// ---------------------------------------------------------------------------
// T6: Project custom handler (handler mutates state & throws -> step marked unknown, parent in needs-recovery, reconciliation required)
// ---------------------------------------------------------------------------
test("T6: Project custom handler (handler mutates state & throws -> step marked unknown, parent in needs-recovery, reconciliation required)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t6", 1000);
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const fenceRegistry = new RecoveryFenceRegistry();
  const projectRegistry = createDefaultProjectRegistry();

  projectRegistry.register({
    id: "test:proj-custom-effect",
    version: 1,
    label: "Custom Handler Project",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["test"],
    requirements: [],
    costs: [],
    rewards: [
      {
        type: "custom:telemetry",
        targetRef: "station-alpha",
        label: "Emit telemetry beacon",
        value: { signal: "ping" }
      }
    ]
  });

  const externalLogs: string[] = [];

  const customHandler: TransactionalChildHandler<{ effect: any; domain: any; project: any }, ChildReceipt> = {
    async execute(input, operationRef) {
      externalLogs.push(`execute:${operationRef}`);
      // Mutate state, then throw network exception
      throw new Error("Telemetry transmitter power failure mid-broadcast");
    },
    async reconcile(operationRef): Promise<Result<ReconcileOutcome, PublicError>> {
      externalLogs.push(`reconcile:${operationRef}`);
      return ok("applied");
    },
    async compensate(operationRef): Promise<Result<void, PublicError>> {
      externalLogs.push(`compensate:${operationRef}`);
      return ok(undefined);
    }
  };

  // Seed ready project in domain doc
  const doc = getDoc();
  const projData = getDomainProjectsData(doc.record);
  const readyProject: ProjectInstance = {
    id: "proj-custom-ready",
    definitionId: "test:proj-custom-effect",
    domainUuid: "dom-t6",
    name: "Custom Ready Project",
    workRequired: 100,
    workCompleted: 100,
    lifecycle: "active",
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entries: []
  };
  await domains.save({
    ...doc,
    record: withDomainProjectsData(doc.record, {
      ...projData,
      projects: [readyProject]
    })
  });

  const compRes = await executeProjectCompletionDomainOperationPlan(
    {
      domains,
      projectRegistry,
      transactionStore: txStore
    },
    {
      domainUuid: "dom-t6",
      projectId: "proj-custom-ready",
      commandId: createCommandId(),
      authorityEpoch: 1,
      sideEffectHandlers: {
        "custom:telemetry": customHandler
      }
    }
  );

  assert.equal(compRes.ok, false);

  // Step is marked unknown, transaction is in needs-recovery
  const tx = txStore.listAll()[0];
  assert.ok(tx);
  assert.equal(tx.state, "needs-recovery");

  const step = (tx.recoveryData as any).steps?.find((s: any) => s.subsystem === "custom");
  assert.ok(step);
  assert.equal(step.state, "unknown");

  // Reconcile contract check
  const reconRes = await customHandler.reconcile!(step.operationRef ?? step.stepId);
  assert.equal(reconRes.ok, true);
  assert.equal(reconRes.value, "applied");

  // -------------------------------------------------------------------------
  // T6 Hardening: Post-restart recovery with TransactionalChildHandlerRegistry
  // -------------------------------------------------------------------------
  const lockManager = new LockManager();
  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore: txStore,
    recoveryFenceRegistry: fenceRegistry
  });

  // Case 6a: Recovery without handler registered in childHandlerRegistry -> fails closed (DM_RECOVERY_HANDLER_UNAVAILABLE)
  const emptyRegistry = new DefaultTransactionalChildHandlerRegistry();
  const recResNoHandler = await recoveryService.recoverTransaction(
    tx.transactionId,
    1,
    async (rec) => compensateProjectCompletion(rec, {
      domains,
      transactionStore: txStore,
      childHandlerRegistry: emptyRegistry
    })
  );

  assert.equal(recResNoHandler.ok, false);
  assert.equal(
    (recResNoHandler.error.details as any)?.code ?? recoveryService.lastRecoveryError?.code,
    "DM_RECOVERY_HANDLER_UNAVAILABLE"
  );
  // Transaction remains in needs-recovery!
  const txStillNeedsRec = txStore.get(tx.transactionId)!;
  assert.equal(txStillNeedsRec.state, "needs-recovery");

  // Case 6b: Recovery with handler registered in childHandlerRegistry -> reconciles & compensates successfully
  const populatedRegistry = new DefaultTransactionalChildHandlerRegistry();
  populatedRegistry.register("custom:telemetry", customHandler);

  const recResWithHandler = await recoveryService.recoverTransaction(
    tx.transactionId,
    1,
    async (rec) => compensateProjectCompletion(rec, {
      domains,
      transactionStore: txStore,
      childHandlerRegistry: populatedRegistry
    })
  );

  assert.equal(recResWithHandler.ok, true);
  assert.equal(recResWithHandler.value.state, "compensated");

  // Verify externalLogs has reconcile and compensate with the unique operationRef
  const expectedOpRef = step.operationRef ?? `${tx.transactionId}:${step.stepId}`;
  assert.ok(externalLogs.includes(`reconcile:${expectedOpRef}`));
  assert.ok(externalLogs.includes(`compensate:${expectedOpRef}`));
});

// ---------------------------------------------------------------------------
// T7: Downtime custom handler (handler mutates & throws -> step marked unknown, parent in needs-recovery)
// ---------------------------------------------------------------------------
test("T7: Downtime custom handler (handler mutates & throws -> step marked unknown, parent in needs-recovery)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t7", 1000);
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const downtimeRegistry = new DowntimeDefinitionRegistry();

  const regRes = downtimeRegistry.register({
    id: "test:dt-custom-outcome",
    version: 1,
    label: "Herald Announcement",
    scope: "domain",
    category: "narrative",
    tickCost: 1,
    costs: [],
    requirements: [],
    tags: [],
    outcomeDefinitions: [
      {
        id: "out-chronicle",
        type: "narrative:chronicle",
        label: "Record in Chronicle",
        optional: false,
        parameters: { chapter: 1 }
      }
    ]
  });
  assert.equal(regRes.ok, true);

  const chronicleEntries: string[] = [];
  const customOutcomeHandler: TransactionalChildHandler<any, ChildReceipt> = {
    async execute(outcome, operationRef) {
      chronicleEntries.push(`record:${operationRef}`);
      throw new Error("Chronicle archive ledger full");
    },
    async reconcile(operationRef) {
      return ok("applied");
    },
    async compensate(operationRef) {
      return ok(undefined);
    }
  };

  // Seed active downtime activity
  const doc = getDoc();
  const dtData = getDomainDowntimeData(doc.record);
  const activity: DowntimeInstance = {
    id: "dt-act-custom",
    definitionId: "test:dt-custom-outcome",
    domainUuid: "dom-t7",
    name: "Test Announcement",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "inProgress",
    scope: "domain",
    startedAt: Date.now() - 10000,
    durationTicks: 1,
    elapsedTicks: 1,
    participants: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    outcomesApplied: []
  };
  await domains.save({
    ...doc,
    record: withDomainDowntimeData(doc.record, {
      ...dtData,
      activities: [activity]
    })
  });

  const resPlan = await executeDowntimeResolutionPlan(
    {
      domains,
      downtimeRegistry,
      transactionStore: txStore
    },
    {
      domainUuid: "dom-t7",
      activityId: "dt-act-custom",
      commandId: createCommandId(),
      authorityEpoch: 1,
      outcomeHandlers: {
        "narrative:chronicle": customOutcomeHandler
      }
    }
  );

  assert.equal(resPlan.ok, false);

  const tx = txStore.listAll()[0];
  assert.ok(tx);
  assert.equal(tx.state, "needs-recovery");

  const step = (tx.recoveryData as any).steps?.find((s: any) => s.subsystem === "custom");
  assert.ok(step);
  assert.equal(step.state, "unknown");

  // -------------------------------------------------------------------------
  // T7 Hardening: Post-restart recovery for Downtime custom handler
  // -------------------------------------------------------------------------
  const lockManager = new LockManager();
  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore: txStore
  });

  // Case 7a: Missing handler in childHandlerRegistry -> fails closed with DM_RECOVERY_HANDLER_UNAVAILABLE
  const emptyDtRegistry = new DefaultTransactionalChildHandlerRegistry();
  const recResNoHandler = await recoveryService.recoverTransaction(
    tx.transactionId,
    1,
    async (rec) => compensateDowntimeResolution(rec, {
      domains,
      transactionStore: txStore,
      childHandlerRegistry: emptyDtRegistry
    })
  );

  assert.equal(recResNoHandler.ok, false);
  assert.equal(
    (recResNoHandler.error.details as any)?.code ?? recoveryService.lastRecoveryError?.code,
    "DM_RECOVERY_HANDLER_UNAVAILABLE"
  );
  assert.equal(txStore.get(tx.transactionId)!.state, "needs-recovery");

  // Case 7b: Handler registered in childHandlerRegistry -> reconciles & compensates successfully
  const populatedDtRegistry = new DefaultTransactionalChildHandlerRegistry();
  populatedDtRegistry.register("narrative:chronicle", customOutcomeHandler);

  const recResWithHandler = await recoveryService.recoverTransaction(
    tx.transactionId,
    1,
    async (rec) => compensateDowntimeResolution(rec, {
      domains,
      transactionStore: txStore,
      childHandlerRegistry: populatedDtRegistry
    })
  );

  assert.equal(recResWithHandler.ok, true);
  assert.equal(recResWithHandler.value.state, "compensated");
  const expectedDtOpRef = step.operationRef ?? `${tx.transactionId}:${step.stepId}`;
  assert.ok(chronicleEntries.includes(`record:${expectedDtOpRef}`));
});

// ---------------------------------------------------------------------------
// T8: Startup barrier (unresolved transaction persisted before runtime creation -> mutating commands rejected before fence/by fence during startup)
// ---------------------------------------------------------------------------
test("T8: Startup barrier (unresolved transaction persisted before runtime creation -> mutating commands rejected before fence/by fence during startup)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t8", 1000);
  const txStoreAdapter = new InMemoryTransactionStorageAdapter();

  // Persist unresolved transaction in storage before runtime creation
  const unresolvedTx = createTransactionRecord({
    transactionId: "tx-unresolved-t8",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-t8")],
    safeAutoRecovery: false
  });
  await txStoreAdapter.saveSnapshot({
    records: [
      {
        ...unresolvedTx,
        state: "needs-recovery"
      }
    ]
  });

  const authority = createAuthorityHost("gm-1");
  const store: DomainDocumentStore = {
    get: (id: string) => getDoc() as any,
    list: () => [getDoc() as any],
    create: async () => {
      throw new Error("unexpected write");
    }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: store,
    authority,
    transactionStorageAdapter: txStoreAdapter
  });

  // 1. Before startup barrier: mutations are disabled in safe mode
  runtime.commandBus.setMutationsEnabled(false);
  assert.equal(runtime.commandBus.mutationsEnabled, false);

  const mutatingCmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: "dom-t8", projectId: "prj-1", delta: 10 },
    issuedAtReal: Date.now()
  };

  const rejectedRes = await runtime.commandBus.execute(mutatingCmd, { senderUserId: "gm-1" });
  assert.equal(rejectedRes.ok, true);
  assert.equal(rejectedRes.value.status, "rejected");
  assert.ok(rejectedRes.value.error?.message.includes("safe mode"));

  // 2. Initialize runtime & run authority reconciliation and scanOnStartup
  await runtime.initialize();
  await authority.reconcile();
  await runtime.recoveryService.scanOnStartup(1);

  // Recovery fence is active on dom-t8
  assert.equal(runtime.recoveryFenceRegistry.isScopeBlocked([lockKey.domain("dom-t8")]), true);

  // Even with mutationsEnabled = true, domain dom-t8 remains protected by recovery fence!
  runtime.commandBus.setMutationsEnabled(true);
  const fencedRes = await runtime.commandBus.execute(mutatingCmd, { senderUserId: "gm-1" });
  assert.equal(fencedRes.ok, true);
  assert.equal(fencedRes.value.status, "rejected");
  assert.equal(fencedRes.value.error?.code, "DM_RECOVERY_SCOPE_BLOCKED");

  runtime.destroy();
});

// ---------------------------------------------------------------------------
// T9: Pending lock retry (active_worker holds lock during startup scan -> deferred -> release triggers automatic retry via LockManager.onLockReleased)
// ---------------------------------------------------------------------------
test("T9: Pending lock retry (active_worker holds lock during startup scan -> deferred -> release triggers automatic retry via LockManager.onLockReleased)", async () => {
  const lockManager = new LockManager();
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const fenceRegistry = new RecoveryFenceRegistry();
  const recoveryService = new RecoveryService({
    lockManager,
    transactionStore: txStore,
    recoveryFenceRegistry: fenceRegistry
  });

  const domainKey = lockKey.domain("dom-t9");

  // Lock domain key with active_worker
  const workerLock = await lockManager.acquireLocks({
    ownerId: "active_worker",
    keys: [domainKey],
    timeoutMs: 1000
  });
  assert.equal(workerLock.ok, true);

  // Save unresolved transaction
  const unresolvedTx = {
    ...createTransactionRecord({
      transactionId: "tx-t9",
      commandId: createCommandId(),
      authorityEpoch: 1,
      lockKeys: [domainKey],
      safeAutoRecovery: true
    }),
    state: "needs-recovery" as const
  };
  txStore.save(unresolvedTx);

  // Run startup scan: physical lock cannot be acquired because active_worker holds it
  await recoveryService.scanOnStartup(1);

  const diagBefore = recoveryService.getDiagnostics();
  assert.ok(diagBefore.pendingRecoveryLockAcquisition.includes("tx-t9"));

  // Release lock from active_worker -> onLockReleased triggers retryPendingLockAcquisitions()
  workerLock.value.release();

  // Yield microtasks for retryPendingLockAcquisitions promise
  await new Promise((resolve) => setTimeout(resolve, 50));

  const diagAfter = recoveryService.getDiagnostics();
  assert.equal(
    diagAfter.pendingRecoveryLockAcquisition.includes("tx-t9"),
    false,
    "Pending lock acquisition must be cleared"
  );
  const txDiag = diagAfter.unresolvedTransactions.find((t) => t.transactionId === "tx-t9");
  assert.ok(txDiag);
  assert.equal(txDiag.physicalLockHeld, true, "Physical lock must be held by recovery service");

  recoveryService.clear();
});

// ---------------------------------------------------------------------------
// T10: Economy restart ledger idempotency (adjust -200, ledger flush fails -> restart -> retry adjust -200 -> balance remains 800, ledger has exactly 1 entry)
// ---------------------------------------------------------------------------
test("T10: Economy restart ledger idempotency (adjust -200, ledger flush fails -> restart -> retry adjust -200 -> balance remains 800, ledger has exactly 1 entry)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t10", 1000);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());

  const ledgerAdapter = new InMemoryLedgerStorageAdapter();
  const failingLedgerStore = new LedgerStore(ledgerAdapter);
  let shouldFailFlush = true;
  const originalFlush = failingLedgerStore.flush.bind(failingLedgerStore);
  failingLedgerStore.flush = async () => {
    if (shouldFailFlush) {
      throw new Error("Disk full: durable ledger write error");
    }
    return originalFlush();
  };

  const economyService1 = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore: failingLedgerStore,
    reservationStore,
    lockManager
  });

  const idempKey = "tx-t10:adjust-debit-001";
  let firstErr: any;
  try {
    const res1 = await economyService1.commitAdjust({
      domainUuid: "dom-t10",
      resourceId: "domain-manager:materials",
      deltaMinor: -200,
      reason: "Initial debit",
      idempotencyKey: idempKey
    });
    if (!res1.ok) firstErr = res1.error;
  } catch (err) {
    firstErr = err;
  }

  assert.ok(firstErr, "First adjustment must fail due to ledger flush error");

  // Domain document balance was updated to 800 and receipt/idempotency was recorded
  const midDoc = getDoc();
  const midEcon = (midDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  assert.equal(midEcon.accounts[0].balanceMinor, 800);
  assert.ok(
    midEcon.appliedIdempotencyKeys?.includes(idempKey) ||
    midEcon.receipts?.some((r: any) => r.operationRef === idempKey)
  );

  // Service restart: recovery with repaired ledger store
  shouldFailFlush = false;
  const recoveredLedgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const economyService2 = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore: recoveredLedgerStore,
    reservationStore,
    lockManager
  });

  // Retry with the exact same idempotencyKey
  const res2 = await economyService2.commitAdjust({
    domainUuid: "dom-t10",
    resourceId: "domain-manager:materials",
    deltaMinor: -200,
    reason: "Retry debit after restart",
    idempotencyKey: idempKey
  });

  assert.equal(res2.ok, true);
  assert.equal(res2.value.isNoop, true, "Retry must be treated as no-op");

  // Balance must remain 800 (NOT 600!)
  const finalDoc = getDoc();
  const finalEcon = (finalDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  assert.equal(finalEcon.accounts[0].balanceMinor, 800);

  // Ledger entry must be reconstructed in the ledger store
  const entries = recoveredLedgerStore.query({ domainUuid: "dom-t10" });
  assert.ok(entries.length > 0, "Ledger entry must be reconstructed in ledger store");
  const reconstructedEntry = entries.find((e) => e.source.ref === idempKey);
  assert.ok(reconstructedEntry, "Reconstructed ledger entry must match operation idempotencyKey");
});

// ---------------------------------------------------------------------------
// T11: Lock drift detection in real flow (executeProjectStartDomainOperationPlan with extra lock keys -> Session rejects with DM_TX_LOCKSET_DIVERGENCE)
// ---------------------------------------------------------------------------
test("T11: Lock drift detection in real flow (executeProjectStartDomainOperationPlan with extra lock keys -> Session rejects with DM_TX_LOCKSET_DIVERGENCE)", async () => {
  const { domains } = createMockDomainDoc("dom-t11", 1000);
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const projectRegistry = createDefaultProjectRegistry();
  const domainKey = lockKey.domain("dom-t11");
  const extraKey = lockKey.project("proj-divergent");

  // Attempt project start with divergent lock set (extra project lock key)
  const driftRes = await executeProjectStartDomainOperationPlan(
    {
      domains,
      projectRegistry,
      transactionStore: txStore
    },
    {
      domainUuid: "dom-t11",
      definitionId: "domain-manager:survey",
      commandId: createCommandId(),
      authorityEpoch: 1,
      transactionContext: {
        commandId: createCommandId(),
        authorityEpoch: 1,
        lockKeys: [domainKey, extraKey] // Divergent from canonical [domainKey]
      }
    }
  );

  assert.equal(driftRes.ok, false);
  assert.equal(driftRes.error.code, "DM_TX_LOCKSET_DIVERGENCE");
});

// ---------------------------------------------------------------------------
// T12: Facilities checkpoint flush failure during maintainFacility -> fails closed, transitions to needs-recovery/compensation
// ---------------------------------------------------------------------------
test("T12: Facilities checkpoint flush failure during maintainFacility -> fails closed, transitions to needs-recovery/compensation", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t12", 1000);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const ledgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());

  let failCheckpoint = false;
  class FaultyAdapter extends InMemoryTransactionStorageAdapter {
    override async saveSnapshot(snapshot: any): Promise<void> {
      if (failCheckpoint) {
        failCheckpoint = false;
        throw new Error("Disk error during facility maintenance checkpoint");
      }
      return super.saveSnapshot(snapshot);
    }
  }

  const adapter = new FaultyAdapter();
  const txStore = new TransactionStore(adapter);
  const facilityRegistry = createDefaultFacilityRegistry();

  const regFac = facilityRegistry.register({
    id: "test:fac-maintenance",
    version: 1,
    label: "Maintained Workshop",
    scale: "building",
    maxLevel: 3,
    defaultReadiness: "ready",
    maintenance: {
      intervalTicks: 10,
      costs: [
        {
          resourceId: "domain-manager:materials",
          amount: 50
        }
      ]
    }
  });
  assert.equal(regFac.ok, true);

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  const facilitiesService = new FacilitiesService({
    domains,
    facilityRegistry,
    economyService,
    transactionStore: txStore,
    lockManager
  });

  // Seed facility with maintenance cost
  const doc = getDoc();
  const facData = getDomainFacilitiesData(doc.record);
  const facilityWithMaintenance = {
    id: "fac-maint-1",
    definitionId: "test:fac-maintenance",
    name: "Maintenance Workshop",
    schemaVersion: 1,
    lifecycle: "operational" as const,
    readiness: "ready" as const,
    level: 1,
    installedModules: [],
    activeUpgrades: [],
    tags: [],
    condition: {
      integrity: 80,
      damage: 0,
      wearLevel: 10,
      lastMaintainedAt: Date.now() - 30 * 86400 * 1000,
      lastRepairedAt: null,
      history: []
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revision: 1
  };
  await domains.save({
    ...doc,
    record: withDomainFacilitiesData(doc.record, {
      ...facData,
      facilities: [facilityWithMaintenance]
    })
  });

  // Intercept commitAdjust: trigger failCheckpoint after maintenance debit
  const origAdjust = economyService.commitAdjust.bind(economyService);
  economyService.commitAdjust = async (args) => {
    const res = await origAdjust(args);
    failCheckpoint = true;
    return res;
  };

  const maintRes = await facilitiesService.maintainFacility({
    domainUuid: "dom-t12",
    facilityId: "fac-maint-1",
    commandId: createCommandId()
  });

  assert.equal(maintRes.ok, false);

  // Transaction record must be in needs-recovery or properly compensated
  const txList = txStore.listAll();
  assert.ok(txList.length > 0);
  const tx = txList[0];
  assert.ok(tx.state === "needs-recovery" || tx.state === "failed");

  // Balance was either refunded or protected by recoveryData
  const finalDoc = getDoc();
  const finalEcon = (finalDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  assert.ok(finalEcon.accounts[0].balanceMinor === 1000 || tx.state === "needs-recovery");
});

// ---------------------------------------------------------------------------
// T13: OperationRef uniqueness across consecutive transactions (different transactionIds produce non-colliding operationRefs)
// ---------------------------------------------------------------------------
test("T13: OperationRef uniqueness across consecutive transactions (different transactionIds produce non-colliding operationRefs)", async () => {
  const { domains } = createMockDomainDoc("dom-t13", 2000);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const ledgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const projectRegistry = createDefaultProjectRegistry();
  const peopleService = new PeopleService(domains);

  projectRegistry.register({
    id: "test:proj-opref-unique",
    version: 1,
    label: "Unique OpRef Project",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["test"],
    requirements: [],
    costs: [
      {
        resourceId: "domain-manager:materials",
        amountMinor: 100,
        timing: "reserved"
      }
    ],
    rewards: []
  });

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  // Run first project start
  const planRes1 = await executeProjectStartDomainOperationPlan(
    {
      domains,
      projectRegistry,
      economyService,
      peopleService,
      transactionStore: txStore
    },
    {
      domainUuid: "dom-t13",
      definitionId: "test:proj-opref-unique",
      commandId: createCommandId(),
      authorityEpoch: 1
    }
  );
  assert.equal(planRes1.ok, true);

  // Run second project start
  const planRes2 = await executeProjectStartDomainOperationPlan(
    {
      domains,
      projectRegistry,
      economyService,
      peopleService,
      transactionStore: txStore
    },
    {
      domainUuid: "dom-t13",
      definitionId: "test:proj-opref-unique",
      commandId: createCommandId(),
      authorityEpoch: 1
    }
  );
  assert.equal(planRes2.ok, true);

  const txs = txStore.listAll();
  assert.equal(txs.length, 2);
  const tx1 = txs[0];
  const tx2 = txs[1];

  const steps1 = (tx1.recoveryData as any).steps as any[];
  const steps2 = (tx2.recoveryData as any).steps as any[];

  assert.ok(steps1.length > 0);
  assert.ok(steps2.length > 0);

  const opRefs1 = steps1.map((s) => s.operationRef);
  const opRefs2 = steps2.map((s) => s.operationRef);

  // Every operationRef in tx1 must contain tx1.transactionId
  for (const opRef of opRefs1) {
    assert.ok(opRef.includes(tx1.transactionId), `opRef '${opRef}' must include txId '${tx1.transactionId}'`);
  }
  // Every operationRef in tx2 must contain tx2.transactionId
  for (const opRef of opRefs2) {
    assert.ok(opRef.includes(tx2.transactionId), `opRef '${opRef}' must include txId '${tx2.transactionId}'`);
  }

  // Cross-check: No collision between tx1 and tx2 operationRefs
  const allOpRefs = new Set([...opRefs1, ...opRefs2]);
  assert.equal(allOpRefs.size, opRefs1.length + opRefs2.length, "All operationRefs must be mutually unique");

  // Pre-allocated reservation IDs must also be distinct
  const resId1 = steps1.find((s) => s.operation === "reserve")?.intent?.reservationId;
  const resId2 = steps2.find((s) => s.operation === "reserve")?.intent?.reservationId;
  assert.ok(resId1);
  assert.ok(resId2);
  assert.notEqual(resId1, resId2, "Pre-allocated reservationIds must never collide across transactions");
});

// ---------------------------------------------------------------------------
// T14: Fail-closed ledger reconstruction (append Err -> Err, flush Err -> Err, success -> state: ledger-confirmed)
// ---------------------------------------------------------------------------
test("T14: Fail-closed ledger reconstruction (append Err -> Err, flush Err -> Err, success -> state: ledger-confirmed)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t14", 1000);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());

  // Subcase 1: Append failure during reconstruction -> commitAdjust returns Err
  class FailingAppendLedgerStore extends LedgerStore {
    override async append(): Promise<any> {
      return err(
        createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: "Disk fault during ledger append"
        })
      );
    }
  }

  // Seed domain doc with an unconfirmed receipt (balance already modified)
  const opRef1 = "tx-t14:op-fail-append";
  const doc1 = getDoc();
  const econ1 = (doc1.record.definition.capabilities.config as any)["domain-manager:economy"];
  econ1.accounts[0].balanceMinor = 800;
  econ1.operationReceipts = [
    {
      operationRef: opRef1,
      resourceId: "domain-manager:materials",
      deltaMinor: -200,
      kind: "adjustment",
      reason: "Unconfirmed debit",
      appliedAt: Date.now(),
      state: "balance-applied"
    }
  ];
  await domains.save(doc1);

  const economyService1 = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore: new FailingAppendLedgerStore(new InMemoryLedgerStorageAdapter()),
    reservationStore,
    lockManager
  });

  const resAppendFail = await economyService1.commitAdjust({
    domainUuid: "dom-t14",
    resourceId: "domain-manager:materials",
    deltaMinor: -200,
    reason: "Retry append fail",
    idempotencyKey: opRef1
  });
  assert.equal(resAppendFail.ok, false);

  // Subcase 2: Flush failure during reconstruction -> commitAdjust returns Err
  const failingFlushAdapter = new InMemoryLedgerStorageAdapter();
  const failingFlushLedgerStore = new LedgerStore(failingFlushAdapter);
  failingFlushLedgerStore.flush = async () => {
    throw new Error("Disk full on ledger flush");
  };

  const opRef2 = "tx-t14:op-fail-flush";
  const doc2 = getDoc();
  const econ2 = (doc2.record.definition.capabilities.config as any)["domain-manager:economy"];
  econ2.operationReceipts = [
    ...(econ2.operationReceipts ?? []),
    {
      operationRef: opRef2,
      resourceId: "domain-manager:materials",
      deltaMinor: -100,
      kind: "adjustment",
      reason: "Unconfirmed debit 2",
      appliedAt: Date.now(),
      state: "balance-applied"
    }
  ];
  await domains.save(doc2);

  const economyService2 = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore: failingFlushLedgerStore,
    reservationStore,
    lockManager
  });

  const resFlushFail = await economyService2.commitAdjust({
    domainUuid: "dom-t14",
    resourceId: "domain-manager:materials",
    deltaMinor: -100,
    reason: "Retry flush fail",
    idempotencyKey: opRef2
  });
  assert.equal(resFlushFail.ok, false);
  assert.equal(resFlushFail.error.code, "DM_DOMAIN_STORAGE_ERROR");

  // Subcase 3: Successful reconstruction -> entry created, receipt updated to ledger-confirmed
  const healthyLedgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const opRef3 = "tx-t14:op-success-recon";
  const doc3 = getDoc();
  const econ3 = (doc3.record.definition.capabilities.config as any)["domain-manager:economy"];
  econ3.operationReceipts = [
    ...(econ3.operationReceipts ?? []),
    {
      operationRef: opRef3,
      resourceId: "domain-manager:materials",
      deltaMinor: -50,
      kind: "adjustment",
      reason: "Unconfirmed debit 3",
      appliedAt: Date.now(),
      state: "balance-applied"
    }
  ];
  await domains.save(doc3);

  const economyService3 = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore: healthyLedgerStore,
    reservationStore,
    lockManager
  });

  const resReconSuccess = await economyService3.commitAdjust({
    domainUuid: "dom-t14",
    resourceId: "domain-manager:materials",
    deltaMinor: -50,
    reason: "Retry healthy recon",
    idempotencyKey: opRef3
  });

  assert.equal(resReconSuccess.ok, true);
  assert.equal(resReconSuccess.value.isNoop, true);

  // Check ledger store has the reconstructed entry
  const entries = healthyLedgerStore.query({ domainUuid: "dom-t14" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source.ref, opRef3);

  // Check domain doc receipt was updated to ledger-confirmed with ledgerEntryId
  const finalDoc = getDoc();
  const finalEcon = (finalDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  const confirmedReceipt = finalEcon.operationReceipts.find((r: any) => r.operationRef === opRef3);
  assert.ok(confirmedReceipt);
  assert.equal(confirmedReceipt.state, "ledger-confirmed");
  assert.equal(confirmedReceipt.ledgerEntryId, entries[0].id);
});

// ---------------------------------------------------------------------------
// T15: Primary Authority failover recovery barrier during session (safe mode rejection before barrier, DM_RECOVERY_SCOPE_BLOCKED on affected domain, unaffected domain allowed)
// ---------------------------------------------------------------------------
test("T15: Primary Authority failover recovery barrier during session (safe mode rejection before barrier, DM_RECOVERY_SCOPE_BLOCKED on affected domain, unaffected domain allowed)", async () => {
  const { domains: domains1, getDoc: getDocAffected } = createMockDomainDoc("dom-affected", 1000);
  const { getDoc: getDocUnaffected } = createMockDomainDoc("dom-unaffected", 1000);

  const txStoreAdapter = new InMemoryTransactionStorageAdapter();

  // Create unresolved transaction on dom-affected with safeAutoRecovery: false
  const unresolvedTx = createTransactionRecord({
    transactionId: "tx-unresolved-failover",
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: [lockKey.domain("dom-affected")],
    safeAutoRecovery: false
  });
  await txStoreAdapter.saveSnapshot({
    records: [
      {
        ...unresolvedTx,
        state: "needs-recovery"
      }
    ]
  });

  // Setup multi-user authority environment
  const users: FoundryAuthorityUserLike[] = [
    { id: "gm-a", isGM: true, active: true },
    { id: "gm-b", isGM: true, active: true }
  ];
  let currentUserId: string | null = "gm-a";
  let preferredUserId: string | null = "gm-a";

  const authService = new PrimaryAuthorityService<FoundryAuthorityUserLike>(
    {
      getUsers: () => users,
      getPreferredUserId: () => preferredUserId,
      getCurrentUserId: () => currentUserId
    },
    {
      authorityUserId: "gm-a",
      authorityEpoch: 1,
      initialized: true
    }
  );

  let unblockReconcile: (() => void) | null = null;
  let reconcileStarted: (() => void) | null = null;
  const reconcileStartedPromise = new Promise<void>((r) => {
    reconcileStarted = r;
  });
  const reconcileWaitPromise = new Promise<void>((r) => {
    unblockReconcile = r;
  });

  const authorityHost: PrimaryAuthorityHost = {
    service: authService,
    reconcile: async () => {
      authService.resolve();
      reconcileStarted?.();
      await reconcileWaitPromise;
    },
    synchronizePersistedState: (val) => authService.synchronizeState(val as any)
  };

  const unaffectedDoc = getDocUnaffected();
  const projData = getDomainProjectsData(unaffectedDoc.record);
  const activeProj = {
    id: "prj-2",
    definitionId: "test:proj-unaffected",
    domainUuid: "dom-unaffected",
    name: "Unaffected Project",
    workRequired: 100,
    workCompleted: 10,
    lifecycle: "active" as const,
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entries: []
  };
  unaffectedDoc.record = withDomainProjectsData(unaffectedDoc.record, {
    ...projData,
    projects: [activeProj]
  });

  const domainDocsMap = new Map<string, any>([
    ["dom-affected", getDocAffected()],
    ["dom-unaffected", unaffectedDoc]
  ]);

  const docStore: DomainDocumentStore = {
    get: (id: string) => domainDocsMap.get(id) as any,
    list: () => [...domainDocsMap.values()] as any,
    create: async () => {
      throw new Error("unexpected write");
    }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: docStore,
    authority: authorityHost,
    transactionStorageAdapter: txStoreAdapter
  });

  runtime.projectRegistry.register({
    id: "test:proj-unaffected",
    version: 1,
    label: "Unaffected Project",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["test"],
    requirements: [],
    costs: [],
    rewards: []
  });

  await runtime.initialize();

  // Initially GM A is authority. Now switch local user to GM B and preferred GM to GM B (epoch 2 failover)
  currentUserId = "gm-b";
  preferredUserId = "gm-b";

  // Trigger authority transition
  const transitionPromise = runtime.handleAuthorityTransition();

  // Await reconcile starting and setting local user to primary authority while mutations are disabled
  await reconcileStartedPromise;

  // While transition is happening, mutations are disabled in safe mode!
  assert.equal(runtime.commandBus.mutationsEnabled, false);

  const cmdOnAffectedDuring: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: "dom-affected", projectId: "prj-1", delta: 10 },
    issuedAtReal: Date.now()
  };
  const duringRes = await runtime.commandBus.execute(cmdOnAffectedDuring, { senderUserId: "gm-b" });
  assert.equal(duringRes.ok, true);
  assert.equal(duringRes.value.status, "rejected");
  assert.ok(duringRes.value.error?.message.includes("safe mode"));

  // Unblock transition to complete recovery scan and enable mutations
  unblockReconcile?.();
  await transitionPromise;

  // After barrier: mutations are re-enabled
  assert.equal(runtime.commandBus.mutationsEnabled, true);

  // But dom-affected has active recovery fence!
  assert.equal(runtime.recoveryFenceRegistry.isScopeBlocked([lockKey.domain("dom-affected")]), true);

  // Command on affected domain is blocked by fence!
  const cmdOnAffectedAfter: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: "dom-affected", projectId: "prj-1", delta: 10 },
    issuedAtReal: Date.now()
  };
  const afterAffectedRes = await runtime.commandBus.execute(cmdOnAffectedAfter, { senderUserId: "gm-b" });
  assert.equal(afterAffectedRes.ok, true);
  assert.equal(afterAffectedRes.value.status, "rejected");
  assert.equal(afterAffectedRes.value.error?.code, "DM_RECOVERY_SCOPE_BLOCKED");

  // Meanwhile, command on unaffected domain is NOT blocked by fence and reaches handler!
  const cmdOnUnaffected: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: "dom-unaffected", projectId: "prj-2", delta: 10 },
    issuedAtReal: Date.now()
  };
  const unaffectedRes = await runtime.commandBus.execute(cmdOnUnaffected, { senderUserId: "gm-b" });
  assert.equal(unaffectedRes.ok, true);
  // It is NOT rejected by DM_RECOVERY_SCOPE_BLOCKED or safe mode
  assert.notEqual(unaffectedRes.value.error?.code, "DM_RECOVERY_SCOPE_BLOCKED");
  assert.notEqual(unaffectedRes.value.status, "rejected");

  runtime.destroy();
});

// ---------------------------------------------------------------------------
// T16-A: AuthorityRecoveryBarrier race (overlapping transitions keep mutations disabled until the last scan completes)
// ---------------------------------------------------------------------------
test("T16-A: AuthorityRecoveryBarrier race (overlapping transitions keep mutations disabled until the last scan completes)", async () => {
  const { getDoc: getDocDom } = createMockDomainDoc("dom-t16a", 1000);
  const txStoreAdapter = new InMemoryTransactionStorageAdapter();

  const users: FoundryAuthorityUserLike[] = [
    { id: "gm-a", isGM: true, active: true },
    { id: "gm-b", isGM: true, active: true }
  ];
  let currentUserId: string | null = "gm-b";
  let preferredUserId: string | null = "gm-b";

  const authService = new PrimaryAuthorityService<FoundryAuthorityUserLike>(
    {
      getUsers: () => users,
      getPreferredUserId: () => preferredUserId,
      getCurrentUserId: () => currentUserId
    },
    {
      authorityUserId: "gm-b",
      authorityEpoch: 2,
      initialized: true
    }
  );

  let reconcileCallCount = 0;
  let unblockReconcile1: (() => void) | null = null;
  const reconcile1Hold = new Promise<void>((r) => {
    unblockReconcile1 = r;
  });

  const authorityHost: PrimaryAuthorityHost = {
    service: authService,
    reconcile: async () => {
      reconcileCallCount++;
      authService.resolve();
      if (reconcileCallCount === 1) {
        await reconcile1Hold;
      }
    },
    synchronizePersistedState: (val) => authService.synchronizeState(val as any)
  };

  const domainDocsMap = new Map<string, any>([["dom-t16a", getDocDom()]]);
  const docStore: DomainDocumentStore = {
    get: (id: string) => domainDocsMap.get(id) as any,
    list: () => [...domainDocsMap.values()] as any,
    create: async () => {
      throw new Error("unexpected write");
    }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: docStore,
    authority: authorityHost,
    transactionStorageAdapter: txStoreAdapter
  });

  runtime.projectRegistry.register({
    id: "test:proj-t16a",
    version: 1,
    label: "T16A Project",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["test"],
    requirements: [],
    costs: [],
    rewards: []
  });

  await runtime.initialize();

  // Spy on scanOnStartup
  const scanCalls: number[] = [];
  const origScan = runtime.recovery.scanOnStartup.bind(runtime.recovery);
  runtime.recovery.scanOnStartup = async (epoch) => {
    scanCalls.push(epoch);
    return origScan(epoch);
  };

  // Trigger two overlapping authority transitions: T1 and T2
  // Call 1 enters and hangs inside reconcile1Hold
  const t1Promise = runtime.handleAuthorityTransition();

  // Call 2 is triggered while Call 1 is in-flight
  const t2Promise = runtime.handleAuthorityTransition();

  // During this mutual transition window:
  // 1. Mutations MUST be disabled
  assert.equal(runtime.commandBus.mutationsEnabled, false);

  // 2. Any mutating command executed during this window MUST be rejected in safe mode
  const cmdDuring: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: "dom-t16a", projectId: "prj-1", delta: 10 },
    issuedAtReal: Date.now()
  };
  const duringRes = await runtime.commandBus.execute(cmdDuring, { senderUserId: "gm-b" });
  assert.equal(duringRes.ok, true);
  assert.equal(duringRes.value.status, "rejected");
  assert.ok(duringRes.value.error?.message.includes("safe mode"));

  // Release Call 1: Call 1 will finish its reconcile and yield to Call 2
  unblockReconcile1?.();

  // Await both transitions
  await Promise.all([t1Promise, t2Promise]);

  // After both transitions complete:
  // 1. Mutations are re-enabled only at the end of the second scan
  assert.equal(runtime.commandBus.mutationsEnabled, true);

  // 2. scanOnStartup was called with the correct epoch (epoch 2)
  assert.ok(scanCalls.length >= 2, "Both transition scans must execute");
  assert.ok(scanCalls.every((ep) => ep === 2), "All scans must use epoch 2");

  runtime.destroy();
});

// ---------------------------------------------------------------------------
// T16-B: AuthorityRecoveryBarrier reconcile error (fails closed, maintains safe mode, rejects mutations, diagnostics available)
// ---------------------------------------------------------------------------
test("T16-B: AuthorityRecoveryBarrier reconcile error (fails closed, maintains safe mode, rejects mutations, diagnostics available)", async () => {
  const { getDoc: getDocDom } = createMockDomainDoc("dom-t16b", 1000);
  const txStoreAdapter = new InMemoryTransactionStorageAdapter();

  const users: FoundryAuthorityUserLike[] = [
    { id: "gm-a", isGM: true, active: true }
  ];
  let currentUserId: string | null = "gm-a";
  let preferredUserId: string | null = "gm-a";

  const authService = new PrimaryAuthorityService<FoundryAuthorityUserLike>(
    {
      getUsers: () => users,
      getPreferredUserId: () => preferredUserId,
      getCurrentUserId: () => currentUserId
    },
    {
      authorityUserId: "gm-a",
      authorityEpoch: 1,
      initialized: true
    }
  );

  let failReconcile = false;
  const authorityHost: PrimaryAuthorityHost = {
    service: authService,
    reconcile: async () => {
      if (failReconcile) {
        throw new Error("Simulated network failure during authority reconciliation");
      }
      authService.resolve();
    },
    synchronizePersistedState: (val) => authService.synchronizeState(val as any)
  };

  const domainDocsMap = new Map<string, any>([["dom-t16b", getDocDom()]]);
  const docStore: DomainDocumentStore = {
    get: (id: string) => domainDocsMap.get(id) as any,
    list: () => [...domainDocsMap.values()] as any,
    create: async () => {
      throw new Error("unexpected write");
    }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: docStore,
    authority: authorityHost,
    transactionStorageAdapter: txStoreAdapter
  });

  await runtime.initialize();
  assert.equal(runtime.commandBus.mutationsEnabled, true);

  // Now trigger an authority transition where reconcile fails
  failReconcile = true;
  await runtime.handleAuthorityTransition();

  // Fail-closed verification:
  // 1. Mutations disabled (safe mode)
  assert.equal(runtime.commandBus.mutationsEnabled, false);

  // 2. Diagnostics provider is still available and functioning
  const diags = runtime.diagnostics.getSnapshot();
  assert.ok(diags);
  assert.ok(diags.authority);

  // 3. Mutating commands rejected
  const cmd: DomainCommand = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "projects:advance-project",
    payload: { domainUuid: "dom-t16b", projectId: "prj-1", delta: 10 },
    issuedAtReal: Date.now()
  };
  const execRes = await runtime.commandBus.execute(cmd, { senderUserId: "gm-a" });
  assert.equal(execRes.ok, true);
  assert.equal(execRes.value.status, "rejected");
  assert.ok(execRes.value.error?.message.includes("safe mode"));

  runtime.destroy();
});

// ---------------------------------------------------------------------------
// T17: Provider operationRef in commitAdjust (passed to mutateBalance, stored in recoveryData, matched by reconcileAdjustment, used in compensation rollback)
// ---------------------------------------------------------------------------
test("T17: Provider operationRef in commitAdjust (passed to mutateBalance, stored in recoveryData, matched by reconcileAdjustment, used in compensation rollback)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t17", 0);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const ledgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const recoveryService = new RecoveryService({ lockManager, transactionStore: txStore });

  // Register provider resource
  resourceRegistry.register({
    id: "provider:gems",
    version: 1,
    label: "Gems",
    tags: [],
    precision: 0,
    allowNegative: false,
    defaultCapacityPolicy: "provider",
    lifecycle: "active"
  });

  // Setup provider and track all mutateBalance calls
  const mutateCalls: Array<{ delta: number; options?: { readonly operationRef?: string } }> = [];
  const provider = new ManualCurrencyProvider();
  provider.setBalance("account-gems", 500);

  const origMutate = provider.mutateBalance.bind(provider);
  provider.mutateBalance = async (dUuid, rId, pRef, delta, reason, opts) => {
    mutateCalls.push({ delta, options: opts });
    return origMutate(dUuid, rId, pRef, delta, reason, opts);
  };

  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(provider);

  // Setup account in domain document
  const doc = getDoc();
  const econ = (doc.record.definition.capabilities.config as any)["domain-manager:economy"];
  econ.accounts = [
    {
      domainUuid: "dom-t17",
      resourceId: "provider:gems",
      mode: "provider",
      providerId: MANUAL_CURRENCY_PROVIDER_ID,
      providerRef: "account-gems",
      balanceMinor: 500,
      baseCapacityMinor: null
    }
  ];
  await domains.save(doc);

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore: txStore,
    recoveryService,
    providerRegistry
  });

  const testIdempotencyKey = "idemp-key-gems-t17";

  // Execute commitAdjust with idempotencyKey
  const adjustRes = await economyService.commitAdjust({
    domainUuid: "dom-t17",
    resourceId: "provider:gems",
    deltaMinor: 100,
    reason: "Purchase gems",
    idempotencyKey: testIdempotencyKey
  });

  assert.equal(adjustRes.ok, true);
  assert.equal(adjustRes.value.isNoop, false);

  // 1. Verify provider.mutateBalance received the key as operationRef
  assert.equal(mutateCalls.length, 1);
  assert.equal(mutateCalls[0].delta, 100);
  assert.equal(mutateCalls[0].options?.operationRef, testIdempotencyKey);

  // 2. Verify txRecord.recoveryData.providerOperationRef contains that key
  const tx = txStore.get(adjustRes.value.transactionId!)!;
  assert.ok(tx);
  assert.equal((tx.recoveryData as any).providerOperationRef, testIdempotencyKey);

  // 3. Verify outer reconcileAdjustment returns "applied" for that key
  const recRes = await economyService.reconcileAdjustment({
    domainUuid: "dom-t17",
    resourceId: "provider:gems",
    operationRef: testIdempotencyKey
  });
  assert.equal(recRes.ok, true);
  assert.equal(recRes.value, "applied");

  // 4. Verify compensator uses that key and provider.mutateBalance is called with the same ref in rollback
  // Create an uncommitted/orphan provider transaction record to trigger compensation rollback
  const orphanTx = {
    ...createTransactionRecord({
      transactionId: "tx-provider-rollback-t17",
      commandId: createCommandId(),
      authorityEpoch: 1,
      lockKeys: [lockKey.domain("dom-t17")],
      safeAutoRecovery: true,
      recoveryData: {
        type: "economy:provider-adjust",
        domainUuid: "dom-t17",
        resourceId: "provider:gems",
        providerId: MANUAL_CURRENCY_PROVIDER_ID,
        providerRef: "account-gems",
        providerOperationRef: testIdempotencyKey,
        deltaMinor: 100
      }
    }),
    state: "needs-recovery" as const
  };
  txStore.save(orphanTx);

  const recoverRes = await recoveryService.recoverTransaction("tx-provider-rollback-t17", 1);
  assert.equal(recoverRes.ok, true);

  // Compensation must have invoked provider.mutateBalance with delta -100 and operationRef testIdempotencyKey
  assert.equal(mutateCalls.length, 2);
  assert.equal(mutateCalls[1].delta, -100);
  assert.equal(mutateCalls[1].options?.operationRef, testIdempotencyKey);
});

// ---------------------------------------------------------------------------
// T18-A: Project Completion with TransactionalChildHandler (routed through session.runChildStep, durable intent/receipt, compensator calls handler.compensate)
// ---------------------------------------------------------------------------
test("T18-A: Project Completion with TransactionalChildHandler (routed through session.runChildStep, durable intent/receipt, compensator calls handler.compensate)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t18a", 1000);
  const projectRegistry = createDefaultProjectRegistry();
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const childHandlerRegistry = new DefaultTransactionalChildHandlerRegistry();

  let executedOpRef = "";
  let compensatedOpRef = "";
  let compensatedReceipt: any = null;

  const customHandler: TransactionalChildHandler = {
    execute: async (_input, opRef) => {
      executedOpRef = opRef;
      return ok({
        childReceiptId: createOpaqueId("rep"),
        subsystem: "custom",
        action: "portal_opened",
        targetRef: "dom-t18a",
        payload: { portalId: "portal-42" },
        success: true,
        appliedAt: Date.now()
      });
    },
    reconcile: async (_opRef) => {
      return ok("applied");
    },
    compensate: async (opRef, receipt) => {
      compensatedOpRef = opRef;
      compensatedReceipt = receipt;
      return ok(undefined);
    }
  };
  childHandlerRegistry.register("magic:portal", customHandler);

  projectRegistry.register({
    id: "test:proj-t18a",
    version: 1,
    label: "Portal Project",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["test"],
    requirements: [],
    costs: [],
    rewards: [
      {
        type: "magic:portal",
        targetRef: "portal-42",
        value: 1,
        label: "Open Magic Portal"
      }
    ]
  });

  const doc = getDoc();
  const projData = getDomainProjectsData(doc.record);
  const readyProject: ProjectInstance = {
    id: "proj-ready-t18a",
    definitionId: "test:proj-t18a",
    domainUuid: "dom-t18a",
    name: "Portal Project",
    workRequired: 100,
    workCompleted: 100,
    lifecycle: "active",
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entries: []
  };
  await domains.save({
    ...doc,
    record: withDomainProjectsData(doc.record, {
      ...projData,
      projects: [readyProject]
    })
  });

  const planRes = await executeProjectCompletionDomainOperationPlan(
    {
      domains,
      projectRegistry,
      transactionStore: txStore,
      childHandlerRegistry
    },
    {
      domainUuid: "dom-t18a",
      projectId: "proj-ready-t18a",
      commandId: createCommandId(),
      authorityEpoch: 1
    }
  );

  assert.equal(planRes.ok, true);
  assert.ok(executedOpRef.length > 0, "Handler must be executed with non-empty operationRef");

  // Verify transaction record contains custom step with intent and receipt
  const tx = txStore.listAll()[0];
  assert.ok(tx);
  assert.equal(tx.state, "committed");

  const customStep = (tx.recoveryData as any).steps?.find((s: any) => s.operation === "magic:portal");
  assert.ok(customStep, "Custom step must be recorded in steps");
  assert.equal(customStep.state, "applied");
  assert.equal(customStep.intent?.operationRef, executedOpRef);
  assert.equal(customStep.receipt?.action, "portal_opened");

  // Now simulate compensation on this transaction record with skipReconciliation: true
  txStore.transition(tx.transactionId, "needs-recovery", 1);
  const compRes = await compensateProjectCompletion(
    txStore.get(tx.transactionId)!,
    {
      domains,
      childHandlerRegistry,
      transactionStore: txStore
    },
    { skipReconciliation: true }
  );

  assert.equal(compRes.ok, true);
  assert.equal(compensatedOpRef, executedOpRef, "Compensate must receive the same operationRef");
  assert.equal(compensatedReceipt?.action, "portal_opened", "Compensate must receive the applied receipt");
});

// ---------------------------------------------------------------------------
// T18-B: Downtime Resolution with TransactionalChildHandler (routed through session.runChildStep, intent/receipt persisted, compensator calls handler.compensate)
// ---------------------------------------------------------------------------
test("T18-B: Downtime Resolution with TransactionalChildHandler (routed through session.runChildStep, intent/receipt persisted, compensator calls handler.compensate)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t18b", 1000);
  const downtimeRegistry = new DowntimeDefinitionRegistry();
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const childHandlerRegistry = new DefaultTransactionalChildHandlerRegistry();

  let executedOpRef = "";
  let compensatedOpRef = "";
  let compensatedReceipt: any = null;

  const customHandler: TransactionalChildHandler = {
    execute: async (_input, opRef) => {
      executedOpRef = opRef;
      return ok({
        childReceiptId: createOpaqueId("rep"),
        subsystem: "custom",
        action: "scout_completed",
        targetRef: "dom-t18b",
        payload: { discoveredArea: "Ruins" },
        success: true,
        appliedAt: Date.now()
      });
    },
    reconcile: async (_opRef) => {
      return ok("applied");
    },
    compensate: async (opRef, receipt) => {
      compensatedOpRef = opRef;
      compensatedReceipt = receipt;
      return ok(undefined);
    }
  };
  childHandlerRegistry.register("scout:recon", customHandler);

  const regRes = downtimeRegistry.register({
    id: "test:dt-t18b",
    version: 1,
    label: "Scouting Expedition",
    scope: "domain",
    category: "narrative",
    tickCost: 1,
    requirements: [],
    tags: [],
    costs: [],
    outcomeDefinitions: [
      {
        id: "out-scout",
        type: "scout:recon",
        label: "Scout Region",
        optional: false,
        parameters: { targetArea: "Ruins" }
      }
    ]
  });
  assert.equal(regRes.ok, true);

  const doc = getDoc();
  const dtData = getDomainDowntimeData(doc.record);
  const readyActivity: DowntimeInstance = {
    id: "dt-act-t18b",
    definitionId: "test:dt-t18b",
    domainUuid: "dom-t18b",
    name: "Scouting Expedition",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "inProgress",
    scope: "domain",
    startedAt: Date.now() - 10000,
    durationTicks: 1,
    elapsedTicks: 1,
    participants: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    outcomesApplied: []
  };
  await domains.save({
    ...doc,
    record: withDomainDowntimeData(doc.record, {
      ...dtData,
      activities: [readyActivity]
    })
  });

  const planRes = await executeDowntimeResolutionPlan(
    {
      domains,
      downtimeRegistry,
      transactionStore: txStore,
      childHandlerRegistry
    },
    {
      domainUuid: "dom-t18b",
      activityId: "dt-act-t18b",
      commandId: createCommandId(),
      authorityEpoch: 1
    }
  );

  assert.equal(planRes.ok, true);
  assert.ok(executedOpRef.length > 0, "Handler must receive non-empty operationRef");

  // Verify transaction record contains custom step with intent and receipt
  const tx = txStore.listAll()[0];
  assert.ok(tx);
  assert.equal(tx.state, "committed");

  const customStep = (tx.recoveryData as any).steps?.find((s: any) => s.operation === "scout:recon");
  assert.ok(customStep, "Custom step must be recorded in steps");
  assert.equal(customStep.state, "applied");
  assert.equal(customStep.intent?.operationRef, executedOpRef);
  assert.equal(customStep.receipt?.action, "scout_completed");

  // Now simulate compensation on this transaction record with skipReconciliation: true
  txStore.transition(tx.transactionId, "needs-recovery", 1);
  const compRes = await compensateDowntimeResolution(
    txStore.get(tx.transactionId)!,
    {
      domains,
      childHandlerRegistry,
      transactionStore: txStore
    },
    { skipReconciliation: true }
  );

  assert.equal(compRes.ok, true);
  assert.equal(compensatedOpRef, executedOpRef, "Compensate must receive the same operationRef");
  assert.equal(compensatedReceipt?.action, "scout_completed", "Compensate must receive the applied receipt");
});

// ---------------------------------------------------------------------------
// T18-C: Custom step without reconcile/compensate in recovery (fails closed with DM_RECOVERY_HANDLER_CONTRACT_INSUFFICIENT, remains needs-recovery, no blind compensation)
// ---------------------------------------------------------------------------
test("T18-C: Custom step without reconcile/compensate in recovery (fails closed with DM_RECOVERY_HANDLER_CONTRACT_INSUFFICIENT, remains needs-recovery, no blind compensation)", async () => {
  const { domains } = createMockDomainDoc("dom-t18c", 1000);
  const lockManager = new LockManager();
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const recoveryService = new RecoveryService({ lockManager, transactionStore: txStore });

  // Subcase 1: Step state is "unknown", handler lacks reconcile()
  const registryWithoutReconcile = new DefaultTransactionalChildHandlerRegistry();
  let blindCompensateExecuted = false;
  registryWithoutReconcile.register("custom:unreconciled", {
    execute: async () => ok({}),
    compensate: async () => {
      blindCompensateExecuted = true;
      return ok(undefined);
    }
  });

  const txUnknown = {
    ...createTransactionRecord({
      transactionId: "tx-t18c-unknown",
      commandId: createCommandId(),
      authorityEpoch: 1,
      lockKeys: [lockKey.domain("dom-t18c")],
      safeAutoRecovery: true,
      recoveryData: {
        type: "projects:completion",
        domainUuid: "dom-t18c",
        projectId: "proj-1",
        steps: [
          {
            stepId: "step-1",
            subsystem: "custom",
            operation: "custom:unreconciled",
            state: "unknown",
            intent: { operationRef: "op-1" }
          }
        ]
      }
    }),
    state: "needs-recovery" as const
  };
  txStore.save(txUnknown);

  const recRes1 = await recoveryService.recoverTransaction(
    txUnknown.transactionId,
    1,
    (rec) => compensateProjectCompletion(rec, {
      domains,
      childHandlerRegistry: registryWithoutReconcile,
      transactionStore: txStore
    })
  );

  assert.equal(recRes1.ok, false);
  const code1 = (recRes1.error.details as any)?.code ?? recRes1.error.code;
  assert.equal(code1, "DM_RECOVERY_HANDLER_CONTRACT_INSUFFICIENT");
  assert.equal(blindCompensateExecuted, false, "Must not execute blind compensation");
  assert.equal(txStore.get(txUnknown.transactionId)!.state, "needs-recovery");

  // Subcase 2: Step state is "applied", handler lacks compensate()
  // Use a separate domain so recovery lock from subcase 1 doesn't conflict
  createMockDomainDoc("dom-t18c-applied", 1000);
  const registryWithoutCompensate = new DefaultTransactionalChildHandlerRegistry();
  registryWithoutCompensate.register("custom:uncompensated", {
    execute: async () => ok({}),
    reconcile: async () => ok("applied")
  });

  const txApplied = {
    ...createTransactionRecord({
      transactionId: "tx-t18c-applied",
      commandId: createCommandId(),
      authorityEpoch: 1,
      lockKeys: [lockKey.domain("dom-t18c-applied")],
      safeAutoRecovery: true,
      recoveryData: {
        type: "projects:completion",
        domainUuid: "dom-t18c-applied",
        projectId: "proj-1",
        steps: [
          {
            stepId: "step-2",
            subsystem: "custom",
            operation: "custom:uncompensated",
            state: "applied",
            intent: { operationRef: "op-2" },
            receipt: { success: true }
          }
        ]
      }
    }),
    state: "needs-recovery" as const
  };
  txStore.save(txApplied);

  const recRes2 = await recoveryService.recoverTransaction(
    txApplied.transactionId,
    1,
    (rec) => compensateProjectCompletion(rec, {
      domains,
      childHandlerRegistry: registryWithoutCompensate,
      transactionStore: txStore
    })
  );

  assert.equal(recRes2.ok, false);
  const code2 = (recRes2.error.details as any)?.code ?? recRes2.error.code;
  assert.equal(code2, "DM_RECOVERY_HANDLER_CONTRACT_INSUFFICIENT");
  assert.equal(txStore.get(txApplied.transactionId)!.state, "needs-recovery");
});

// ---------------------------------------------------------------------------
// T19: commitAdjust with ledger-confirmed persistence failure (fails closed without swallowing error, retry reconciles and confirms ledger receipt)
// ---------------------------------------------------------------------------
test("T19: commitAdjust with ledger-confirmed persistence failure (fails closed without swallowing error, retry reconciles and confirms ledger receipt)", async () => {
  const { domains, getDoc } = createMockDomainDoc("dom-t19", 1000);
  const resourceRegistry = createDefaultResourceRegistry();
  const lockManager = new LockManager();
  const ledgerStore = new LedgerStore(new InMemoryLedgerStorageAdapter());
  const reservationStore = new ReservationStore(new InMemoryReservationStorageAdapter());

  // Count domain updates to fail the second update (the ledger-confirmed receipt update)
  let domainUpdateCount = 0;
  let failSecondSave = true;
  const origUpdate = domains.update.bind(domains);
  domains.update = async (doc) => {
    domainUpdateCount++;
    if (domainUpdateCount === 2 && failSecondSave) {
      return err(
        createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: "Simulated domain storage failure on ledger-confirmed receipt update"
        })
      );
    }
    return origUpdate(doc);
  };

  const economyService = new EconomyService({
    domains,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager
  });

  const testKey = "tx-t19:idemp-save-fail";

  // First call: second update fails
  const res1 = await economyService.commitAdjust({
    domainUuid: "dom-t19",
    resourceId: "domain-manager:materials",
    deltaMinor: -100,
    reason: "Wall construction",
    idempotencyKey: testKey
  });

  // Verify error is returned and NOT swallowed
  assert.equal(res1.ok, false);
  assert.equal(res1.error.code, "DM_DOMAIN_STORAGE_ERROR");

  // Verify intermediate state:
  // 1. Balance was updated to 900
  const midDoc = getDoc();
  const midEcon = (midDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  const matAccount = midEcon.accounts.find((a: any) => a.resourceId === "domain-manager:materials");
  assert.equal(matAccount.balanceMinor, 900);

  // 2. Receipt in domain doc is still balance-applied (not yet confirmed)
  const unconfirmedReceipt = midEcon.operationReceipts.find((r: any) => r.operationRef === testKey);
  assert.ok(unconfirmedReceipt);
  assert.equal(unconfirmedReceipt.state, "balance-applied");

  // 3. Ledger entry was flushed and exists in ledger store
  const entriesBeforeRetry = ledgerStore.query({ domainUuid: "dom-t19", sourceRef: testKey });
  assert.equal(entriesBeforeRetry.length, 1);

  // Second call (retry): storage failure cleared
  failSecondSave = false;
  const res2 = await economyService.commitAdjust({
    domainUuid: "dom-t19",
    resourceId: "domain-manager:materials",
    deltaMinor: -100,
    reason: "Wall construction",
    idempotencyKey: testKey
  });

  // Verify retry succeeded as noop
  assert.equal(res2.ok, true);
  assert.equal(res2.value.isNoop, true);

  // Verify durable invariants:
  // 1. Balance did NOT debit twice (still 900)
  const finalDoc = getDoc();
  const finalEcon = (finalDoc.record.definition.capabilities.config as any)["domain-manager:economy"];
  const finalAccount = finalEcon.accounts.find((a: any) => a.resourceId === "domain-manager:materials");
  assert.equal(finalAccount.balanceMinor, 900);

  // 2. Ledger entries count for this operation is STILL exactly 1
  const entriesAfterRetry = ledgerStore.query({ domainUuid: "dom-t19", sourceRef: testKey });
  assert.equal(entriesAfterRetry.length, 1);

  // 3. Receipt in domain doc is now updated to "ledger-confirmed" with matching ledgerEntryId
  const confirmedReceipt = finalEcon.operationReceipts.find((r: any) => r.operationRef === testKey);
  assert.ok(confirmedReceipt);
  assert.equal(confirmedReceipt.state, "ledger-confirmed");
  assert.equal(confirmedReceipt.ledgerEntryId, entriesAfterRetry[0].id);
});
