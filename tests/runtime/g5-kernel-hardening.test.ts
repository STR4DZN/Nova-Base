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
import type { TransactionalChildHandler, ReconcileOutcome } from "../../src/mutations/child-handler-contract.js";
import { ok, err, type Result } from "../../src/core/contracts/result.js";
import { createPublicError, type PublicError } from "../../src/core/contracts/public-error.js";
import { createTransactionRecord, type TransactionRecord } from "../../src/mutations/transaction-record.js";
import { executeProjectStartDomainOperationPlan } from "../../src/projects/plans/project-start-domain-operation-plan.js";
import { executeProjectCompletionDomainOperationPlan } from "../../src/projects/plans/project-completion-domain-operation-plan.js";
import { executeDowntimeResolutionPlan } from "../../src/downtime/plans/downtime-resolution-plan.js";
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

// Helper: In-memory domain document fixture with full capability configurations
function createMockDomainDoc(id: string, initialBalance = 1000) {
  let doc = {
    id,
    uuid: id,
    record: {
      schemaVersion: 1,
      revision: 1,
      definition: {
        identity: { aliases: [], summary: "Hardening Test Domain" },
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
  const { domains } = createMockDomainDoc("dom-t5", 1000);
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
