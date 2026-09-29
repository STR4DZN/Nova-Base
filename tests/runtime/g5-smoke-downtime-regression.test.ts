import test from "node:test";
import assert from "node:assert/strict";
import { composeDomainManagerRuntime } from "../../src/bootstrap/domain-manager-runtime.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { InMemoryCommandTransport } from "../../src/commands/in-memory-command-transport.js";
import { InMemoryTransactionStorageAdapter } from "../../src/mutations/transaction-storage-adapter.js";
import { createDefaultDomainDowntimeData, getDomainDowntimeData } from "../../src/downtime/downtime-data.js";
import { createDefaultDowntimeRegistry, DowntimeDefinitionRegistry } from "../../src/downtime/definitions/downtime-registry.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import type { Result } from "../../src/core/contracts/result.js";
import type { IdentifiedJournalEntryDocumentLike } from "../../src/storage/repositories/domain-repository.js";

function unwrap<T>(res: Result<T>): T {
  assert.equal(res.ok, true, res.ok ? undefined : JSON.stringify(res.error));
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
}

function fixture(downtimeRegistry = createDefaultDowntimeRegistry()) {
  const id = "smoke-downtime";
  const uuid = `JournalEntry.${id}`;
  let failNextWrite = false;
  let record: DomainRecord = {
    schemaVersion: 1, revision: 0,
    definition: {
      identity: { aliases: [], summary: "Downtime smoke", description: "" },
      classification: { kind: "base", scale: "small", tags: [] },
      hierarchy: { parentDomainUuid: null },
      capabilities: { enabled: ["domain-manager:domain", "domain-manager:downtime"],
        config: { "domain-manager:downtime": createDefaultDomainDowntimeData() } }
    },
    state: { lifecycle: "active" },
    metadata: { createdByUserId: "gm-smoke", archivedAt: null, source: { type: "manual", ref: null } }
  };
  const doc: IdentifiedJournalEntryDocumentLike = {
    id, uuid, name: "Downtime smoke", ownership: { default: 0, "gm-smoke": 3 },
    get flags() { return { "domain-manager": structuredClone(record) }; },
    async update(data) {
      if (failNextWrite) { failNextWrite = false; throw new Error("Injected parent storage failure"); }
      record = structuredClone(data["flags.domain-manager"] as DomainRecord);
    }
  };
  const txState = { snapshot: null };
  function compose() {
    const service = new PrimaryAuthorityService({
      getUsers: () => [{ id: "gm-smoke", isGM: true, active: true }],
      getPreferredUserId: () => null, getCurrentUserId: () => "gm-smoke"
    }, { authorityUserId: "gm-smoke", authorityEpoch: 1, initialized: true });
    return composeDomainManagerRuntime({
      domainStore: { get: key => key === id ? doc : undefined, list: () => [doc],
        create: async () => { throw new Error("Unexpected create"); } },
      authority: { service, reconcile: async () => service.resolve(),
        synchronizePersistedState: value => service.synchronizeState(value as never) },
      transport: new InMemoryCommandTransport({ currentUserId: "gm-smoke", getAuthorityUserId: () => "gm-smoke" }),
      transactionStorageAdapter: new InMemoryTransactionStorageAdapter(txState), downtimeRegistry
    });
  }
  return { uuid, compose, get record() { return record; }, failWrite() { failNextWrite = true; } };
}

const participant = { participantRef: "narrative:smoke", participantType: "narrative" as const, role: "participant" };

test("Smoke downtime: explicit null survives public command, advance, pause/resume and fresh runtime", async () => {
  const env = fixture();
  let rt = env.compose();
  try {
    unwrap(await rt.publicApi.downtime.startActivity({ domainUuid: env.uuid,
      definitionId: "domain-manager:rest-and-recuperation", durationTicks: null, participants: [participant] }));
    const id = getDomainDowntimeData(env.record).activities[0].id;
    assert.equal(getDomainDowntimeData(env.record).activities[0].durationTicks, null);
    unwrap(await rt.publicApi.downtime.advanceActivity({ domainUuid: env.uuid, activityId: id, ticks: 100 }));
    unwrap(await rt.publicApi.downtime.pauseActivity({ domainUuid: env.uuid, activityId: id }));
    unwrap(await rt.publicApi.downtime.resumeActivity({ domainUuid: env.uuid, activityId: id }));
    const before = unwrap(await rt.publicApi.downtime.getActivity(env.uuid, id));
    assert.equal(before.lifecycle, "inProgress");
    assert.equal(before.elapsedTicks, 100);
    const vm = rt.publicApi.downtime.buildViewModel(env.record);
    assert.ok(JSON.stringify(vm).includes('"progressPercent":null'));
    rt.destroy(); rt = env.compose(); await rt.initialize();
    assert.deepEqual(unwrap(await rt.publicApi.downtime.getActivity(env.uuid, id)), before);
    unwrap(await rt.publicApi.downtime.cancelActivity({ domainUuid: env.uuid, activityId: id }));
    assert.equal(getDomainDowntimeData(env.record).activities[0].lifecycle, "cancelled");
  } finally { rt.destroy(); }
});

for (const requested of [undefined, 3, 0] as const) {
  test(`Smoke downtime: duration ${String(requested)} retains default/override and final elapsed ticks`, async () => {
    const env = fixture(); const rt = env.compose();
    try {
      unwrap(await rt.publicApi.downtime.startActivity({ domainUuid: env.uuid,
        definitionId: "domain-manager:rest-and-recuperation", ...(requested === undefined ? {} : { durationTicks: requested }), participants: [participant] }));
      const a = getDomainDowntimeData(env.record).activities[0];
      const duration = requested === undefined ? 5 : requested;
      assert.equal(a.durationTicks, duration);
      const ticks = duration + 2;
      unwrap(await rt.publicApi.downtime.advanceActivity({ domainUuid: env.uuid, activityId: a.id, ticks }));
      const after = unwrap(await rt.publicApi.downtime.getActivity(env.uuid, a.id));
      assert.equal(after.lifecycle, "completed");
      assert.equal(after.elapsedTicks, ticks);
    } finally { rt.destroy(); }
  });
}

test("Smoke downtime: definition default null remains indefinite when duration is omitted", async () => {
  const registry = new DowntimeDefinitionRegistry();
  unwrap(registry.register({ ...createDefaultDowntimeRegistry().get("domain-manager:rest-and-recuperation")!,
    id: "smoke:indefinite", defaultDurationTicks: null }));
  const env = fixture(registry); const rt = env.compose();
  try {
    unwrap(await rt.publicApi.downtime.startActivity({ domainUuid: env.uuid,
      definitionId: "smoke:indefinite", participants: [participant] }));
    const a = getDomainDowntimeData(env.record).activities[0];
    assert.equal(a.durationTicks, null);
    unwrap(await rt.publicApi.downtime.advanceActivity({ domainUuid: env.uuid, activityId: a.id, ticks: 100 }));
    assert.equal(getDomainDowntimeData(env.record).activities[0].lifecycle, "inProgress");
  } finally { rt.destroy(); }
});

test("Smoke downtime: failed completion leaves both lifecycle and elapsed progress unchanged", async () => {
  const env = fixture(); const rt = env.compose();
  try {
    unwrap(await rt.publicApi.downtime.startActivity({ domainUuid: env.uuid,
      definitionId: "domain-manager:rest-and-recuperation", durationTicks: 5, participants: [participant] }));
    const a = getDomainDowntimeData(env.record).activities[0];
    unwrap(await rt.publicApi.downtime.advanceActivity({ domainUuid: env.uuid, activityId: a.id, ticks: 2 }));
    env.failWrite();
    const result = await rt.publicApi.downtime.advanceActivity({ domainUuid: env.uuid, activityId: a.id, ticks: 5 });
    assert.equal(result.ok, false);
    const after = getDomainDowntimeData(env.record).activities[0];
    assert.equal(after.lifecycle, "inProgress"); assert.equal(after.elapsedTicks, 2);
    assert.equal(rt.transactionStore.listUnresolved().length, 0,
      "Built-in narrative receipt must not leave an unrecoverable custom-handler fence");
    unwrap(await rt.publicApi.downtime.advanceActivity({ domainUuid: env.uuid, activityId: a.id, ticks: 5 }));
    assert.equal(getDomainDowntimeData(env.record).activities[0].elapsedTicks, 7);
  } finally { rt.destroy(); }
});
