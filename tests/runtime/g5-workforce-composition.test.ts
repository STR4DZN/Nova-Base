import test from "node:test";
import assert from "node:assert/strict";
import { composeDomainManagerRuntime } from "../../src/bootstrap/domain-manager-runtime.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import type { PrimaryAuthorityHost } from "../../src/authority/foundry-primary-authority-adapter.js";
import { InMemoryCommandTransport } from "../../src/commands/in-memory-command-transport.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import { createCommandId } from "../../src/commands/command-envelope.js";
import type { Result } from "../../src/core/contracts/result.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import type { DomainDocumentStore, IdentifiedJournalEntryDocumentLike } from "../../src/storage/repositories/domain-repository.js";
import { createDefaultDomainPeopleData, getDomainPeopleData } from "../../src/people/people-data.js";
import { PeopleService } from "../../src/people/services/people-service.js";
import { createDefaultDomainProjectsData, getDomainProjectsData } from "../../src/projects/project-data.js";
import { createTransactionRecord } from "../../src/mutations/transaction-record.js";
import { InMemoryTransactionStorageAdapter } from "../../src/mutations/transaction-storage-adapter.js";

function unwrap<T>(result: Result<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Actual production composition, with only the Foundry host/storage boundaries replaced. */
function fixture() {
  const id = "dom-smoke-workforce";
  const uuid = `JournalEntry.${id}`;
  let writes = 0;
  let record: DomainRecord = {
    schemaVersion: 1,
    revision: 0,
    definition: {
      identity: { aliases: [], summary: "Workforce smoke regression", description: "" },
      classification: { kind: "base", scale: "small", tags: [] },
      hierarchy: { parentDomainUuid: null },
      capabilities: {
        enabled: ["domain-manager:domain", "domain-manager:people", "domain-manager:projects"],
        config: {
          "domain-manager:people": {
            ...createDefaultDomainPeopleData(),
            population: { mode: "manual", total: 30, precision: "exact" },
            populationGroups: [{
              id: createOpaqueId("pop"), name: "Workers", count: 30, includedInTotal: true,
              visibility: "public", tags: [],
              workforceContributions: [{ workforceTypeId: "general", amount: 30 }]
            }]
          },
          "domain-manager:projects": createDefaultDomainProjectsData()
        }
      }
    },
    state: { lifecycle: "active" },
    metadata: { createdByUserId: "gm-workforce", archivedAt: null, source: { type: "manual", ref: null } }
  };
  const doc: IdentifiedJournalEntryDocumentLike = {
    id, uuid, name: "Workforce smoke", ownership: { default: 0, "gm-workforce": 3 },
    get flags() { return { "domain-manager": structuredClone(record) }; },
    async update(data) {
      assert.ok(data["flags.domain-manager"]);
      record = structuredClone(data["flags.domain-manager"] as DomainRecord);
      writes += 1;
    }
  };
  const domainStore: DomainDocumentStore = {
    get: (key) => key === id ? doc : undefined,
    list: () => [doc],
    create: async () => { throw new Error("Unexpected document creation"); }
  };
  const txState = { snapshot: null };
  function compose() {
    const service = new PrimaryAuthorityService({
      getUsers: () => [{ id: "gm-workforce", isGM: true, active: true }],
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-workforce"
    }, { authorityUserId: "gm-workforce", authorityEpoch: 1, initialized: true });
    const authority: PrimaryAuthorityHost = {
      service,
      reconcile: async () => service.resolve(),
      synchronizePersistedState: (value) => service.synchronizeState(value as never)
    };
    return composeDomainManagerRuntime({
      domainStore, authority,
      transactionStorageAdapter: new InMemoryTransactionStorageAdapter(txState),
      transport: new InMemoryCommandTransport({
        currentUserId: "gm-workforce", getAuthorityUserId: () => "gm-workforce"
      })
    });
  }
  return {
    id, uuid, compose,
    get record() { return record; },
    get writes() { return writes; },
    setRecord(value: DomainRecord) { record = structuredClone(value); }
  };
}

async function start(runtime: ReturnType<typeof composeDomainManagerRuntime>, domainUuid: string) {
  const result = unwrap(await runtime.publicApi.projects.startProject({
    domainUuid, definitionId: "domain-manager:survey", name: "Project A", workforceRequired: 5,
    workRequired: 10
  })) as { project: { id: string } };
  return result.project.id;
}

function assertReserved(env: ReturnType<typeof fixture>, expected: number) {
  const reservations = getDomainPeopleData(env.record).reservations;
  assert.equal(reservations.filter((r) => r.status === "active").reduce((n, r) => n + r.amount, 0), expected);
}

test("Smoke regression: public People is physically read-only and reads without domain.update", async () => {
  const env = fixture();
  const runtime = env.compose();
  try {
    for (const name of ["allocateWorkforceReservation", "releaseWorkforceReservation", "restoreWorkforceReservation"]) {
      assert.equal(name in runtime.publicApi.people, false, `${name} must not be callable from module.api.people`);
      assert.equal(name in runtime.people, false);
    }
    assert.equal("workforceReservations" in runtime.publicApi, false);
    assert.equal("update" in runtime.publicApi.domains, false);
    const publicPeople = new PeopleService(runtime.publicApi.domains);
    const report = unwrap(await publicPeople.getWorkforce(env.uuid, { isGm: true }));
    assert.equal(report.types.general.capacity, 30);
    assert.equal(report.types.general.reserved, 0);
    assert.equal(unwrap(await publicPeople.getReservations(env.uuid, { isGm: true })).length, 0);
    assert.equal(env.writes, 0, "Public queries must never write");
  } finally { runtime.destroy(); }
});

test("Smoke regression: Project A + workforce 5 through public API/CommandBus reserves and cancel releases", async () => {
  const env = fixture();
  const runtime = env.compose();
  try {
    const projectId = await start(runtime, env.uuid);
    assertReserved(env, 5);
    const reservations = getDomainPeopleData(env.record).reservations;
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].targetRef, `project:${projectId}`);
    assert.equal(unwrap(await runtime.people.getWorkforce(env.uuid, { isGm: true })).types.general.available, 25);
    unwrap(await runtime.publicApi.projects.cancelProject({ domainUuid: env.uuid, projectId }));
    assertReserved(env, 0);
    assert.equal(getDomainPeopleData(env.record).reservations[0].status, "released");
    assert.equal(getDomainProjectsData(env.record).projects[0].lifecycle, "cancelled");
  } finally { runtime.destroy(); }
});

test("Smoke regression: Project advance/complete releases workforce through production composition", async () => {
  const env = fixture();
  const runtime = env.compose();
  try {
    const projectId = await start(runtime, env.uuid);
    unwrap(await runtime.publicApi.projects.advanceProject({ domainUuid: env.uuid, projectId, delta: 10 }));
    unwrap(await runtime.publicApi.projects.completeProject({ domainUuid: env.uuid, projectId }));
    assertReserved(env, 0);
    assert.equal(getDomainPeopleData(env.record).reservations[0].status, "released");
    assert.equal(getDomainProjectsData(env.record).projects[0].lifecycle, "completed");
  } finally { runtime.destroy(); }
});

test("Smoke regression: fresh runtime recovers executing workforce intent after effect but before receipt", async () => {
  const env = fixture();
  let runtime = env.compose();
  try {
    const projectId = await start(runtime, env.uuid);
    const reservation = getDomainPeopleData(env.record).reservations[0];
    // Durable crash image: child wrote People, parent Project and child receipt were never written.
    env.setRecord({ ...env.record, definition: { ...env.record.definition,
      capabilities: { ...env.record.definition.capabilities, config: {
        ...env.record.definition.capabilities.config,
        "domain-manager:projects": createDefaultDomainProjectsData()
      } }
    } });
    const tx = createTransactionRecord({
      commandId: createCommandId(), transactionId: "tx_workforce_crash", authorityEpoch: 1,
      lockKeys: [`domain:${env.id}`], safeAutoRecovery: true,
      recoveryData: {
        type: "projects:start", domainUuid: env.id, projectId, debitedCosts: [], createdReservationIds: [],
        steps: [{ stepId: "workforce", state: "executing", subsystem: "people",
          operation: "allocateWorkforceReservation", targetRef: env.id,
          intent: { reservationId: reservation.id, operationRef: reservation.operationRef, projectId, amount: 5 }
        }]
      }
    });
    runtime.transactionStore.save(tx);
    unwrap(runtime.transactionStore.transition(tx.transactionId, "claimed", 1));
    unwrap(runtime.transactionStore.transition(tx.transactionId, "prepared", 1));
    await runtime.transactionStore.flush();
    runtime.destroy();
    runtime = env.compose();
    await runtime.initialize();
    await runtime.recovery.scanOnStartup(1);
    assert.equal(runtime.recovery.fenceRegistry.hasFenceForKeys([`domain:${env.id}`]), true);
    const results = await runtime.recovery.recoverAll(1);
    assert.equal(results.length, 1);
    unwrap(results[0]);
    assertReserved(env, 0);
    assert.equal(runtime.transactionStore.get(tx.transactionId)?.state, "compensated");
    assert.equal(runtime.recovery.fenceRegistry.hasFenceForKeys([`domain:${env.id}`]), false);
    const before = env.writes;
    unwrap(await runtime.recovery.recoverTransaction(tx.transactionId, 1));
    assert.equal(env.writes, before, "Recovery retry must not write again");
    assert.equal(getDomainPeopleData(env.record).reservations.length, 1);
  } finally { runtime.destroy(); }
});

for (const operation of ["cancel", "completion"] as const) {
  test(`Smoke regression: fresh runtime restores workforce after partial Project ${operation}`, async () => {
    const env = fixture();
    let runtime = env.compose();
    try {
      const projectId = await start(runtime, env.uuid);
      const parentBefore = getDomainProjectsData(env.record);
      if (operation === "cancel") {
        unwrap(await runtime.projects.cancelProject({ domainUuid: env.uuid, projectId }));
      } else {
        unwrap(await runtime.projects.advanceProject({ domainUuid: env.uuid, projectId, delta: 10 }));
        unwrap(await runtime.projects.completeProject({ domainUuid: env.uuid, projectId }));
      }
      assertReserved(env, 0);
      const sourceTx = runtime.transactionStore.listAll().find((tx) =>
        (tx.recoveryData as { type?: string })?.type === `projects:${operation}`)!;
      assert.ok(sourceTx, "Actual child release transaction must exist");
      const data = structuredClone(sourceTx.recoveryData) as Record<string, unknown>;
      assert.equal((data.releasedWorkforceSnapshots as unknown[]).length, 1);
      // Parent save was not reached, but child release was durable.
      env.setRecord({ ...env.record, definition: { ...env.record.definition,
        capabilities: { ...env.record.definition.capabilities, config: {
          ...env.record.definition.capabilities.config, "domain-manager:projects": parentBefore
        } }
      } });
      const crash = createTransactionRecord({
        commandId: createCommandId(), transactionId: `tx_${operation}_crash`, authorityEpoch: 1,
        lockKeys: sourceTx.lockKeys, safeAutoRecovery: true, recoveryData: data
      });
      runtime.transactionStore.save(crash);
      unwrap(runtime.transactionStore.transition(crash.transactionId, "claimed", 1));
      unwrap(runtime.transactionStore.transition(crash.transactionId, "prepared", 1));
      await runtime.transactionStore.flush();
      runtime.destroy();
      runtime = env.compose();
      await runtime.initialize();
      await runtime.recovery.scanOnStartup(1);
      const results = await runtime.recovery.recoverAll(1);
      assert.equal(results.length, 1);
      unwrap(results[0]);
      assertReserved(env, 5);
      assert.equal(getDomainPeopleData(env.record).reservations.length, 1);
      assert.equal(runtime.transactionStore.get(crash.transactionId)?.state, "compensated");
      const before = env.writes;
      unwrap(await runtime.recovery.recoverTransaction(crash.transactionId, 1));
      assert.equal(env.writes, before);
    } finally { runtime.destroy(); }
  });
}

test("Smoke regression: TypeScript rejects read-only repositories and public People at workforce mutation boundaries", async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [
    "node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--target", "ES2022",
    "--module", "preserve", "--moduleResolution", "bundler",
    "tests/people/workforce-contracts.typecheck.ts"
  ], { stdio: "pipe" });
});
