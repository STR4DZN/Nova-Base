import test from "node:test";
import assert from "node:assert/strict";
import {
  lockKey,
  assertSameCanonicalLockSet,
  assertNoForbiddenLockKeys,
  areLockSetsEqual
} from "../../src/mutations/lock-keys.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { registerProjectCommands } from "../../src/projects/commands/project-commands.js";
import { registerDowntimeCommands } from "../../src/downtime/commands/downtime-commands.js";
import { registerFacilityCommands } from "../../src/facilities/commands/facility-commands.js";
import { COMMAND_CONTRACT_VERSION_V1, createCommandId } from "../../src/commands/command-envelope.js";
import { CompositeMutationSession } from "../../src/mutations/composite-mutation-session.js";
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { InMemoryTransactionStorageAdapter } from "../../src/mutations/transaction-storage-adapter.js";

async function assertLockSetIdentityContract(
  commandLockKeys: readonly string[],
  commandId: any,
  parentRef: string,
  recoveryType: string
): Promise<void> {
  const txStore = new TransactionStore(new InMemoryTransactionStorageAdapter());
  const sessionRes = await CompositeMutationSession.prepare({
    transactionStore: txStore,
    commandId,
    authorityEpoch: 1,
    lockKeys: commandLockKeys,
    planLockKeys: commandLockKeys,
    recoveryType,
    parentRef
  });
  assert.equal(sessionRes.ok, true, `CompositeMutationSession.prepare must succeed for ${recoveryType}`);
  const session = sessionRes.value;
  assert.equal(
    areLockSetsEqual(session.lockKeys, commandLockKeys),
    true,
    `session.lockKeys must equal commandLockKeys for ${recoveryType}`
  );
  const txRecord = txStore.get(session.transactionId);
  assert.ok(txRecord, "Transaction record must be saved in store");
  assert.equal(
    areLockSetsEqual(txRecord.lockKeys, commandLockKeys),
    true,
    `txRecord.lockKeys must equal commandLockKeys for ${recoveryType}`
  );
}

test("G5-LOCKSET-A1: Project Start command lock keys match canonical domain-only lock set", async () => {
  const registry = new CommandRegistry();
  registerProjectCommands({
    registry,
    projectsService: {} as any,
    domains: {} as any
  });

  const domainUuid = "Actor.Domain123";
  const cmd = {
    commandId: createCommandId(),
    commandType: "projects:start-project" as const,
    aggregateId: domainUuid,
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    payload: {
      domainUuid,
      definitionId: "prj:test",
      name: "Test Project"
    },
    metadata: {
      issuedAt: Date.now(),
      authorityEpoch: 1,
      schemaVersion: 1
    }
  };

  const reg = registry.get("projects:start-project");
  assert.ok(reg?.mutationDefinition);
  const keys = reg.mutationDefinition.getLockKeys({ command: cmd } as any);

  const expected = [lockKey.domain(domainUuid)];
  const comp = assertSameCanonicalLockSet(keys, expected, "projects:start-project");
  assert.equal(comp.ok, true);
  assert.equal(keys.length, 1);
  assert.equal(keys[0], lockKey.domain(domainUuid));

  await assertLockSetIdentityContract(keys, cmd.commandId, `domain:${domainUuid}`, "projects:start");
});

test("G5-LOCKSET-A2: Project Advance command lock keys match canonical domain + project lock set", async () => {
  const registry = new CommandRegistry();
  registerProjectCommands({
    registry,
    projectsService: {} as any,
    domains: {} as any
  });

  const domainUuid = "Domain123";
  const projectId = "prj-001";
  const cmd = {
    commandId: createCommandId(),
    commandType: "projects:advance-project" as const,
    aggregateId: domainUuid,
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    payload: {
      domainUuid,
      projectId,
      unitsToAdvance: 5
    },
    metadata: {
      issuedAt: Date.now(),
      authorityEpoch: 1,
      schemaVersion: 1
    }
  };

  const reg = registry.get("projects:advance-project");
  assert.ok(reg?.mutationDefinition);
  const keys = reg.mutationDefinition.getLockKeys({ command: cmd } as any);

  const expected = [lockKey.domain(domainUuid), lockKey.project(projectId)];
  const comp = assertSameCanonicalLockSet(keys, expected, "projects:advance-project");
  assert.equal(comp.ok, true);

  await assertLockSetIdentityContract(keys, cmd.commandId, `domain:${domainUuid}`, "projects:advance");
});

test("G5-LOCKSET-A3: Project Cancel command lock keys match canonical domain + project lock set", async () => {
  const registry = new CommandRegistry();
  registerProjectCommands({
    registry,
    projectsService: {} as any,
    domains: {} as any
  });

  const domainUuid = "Domain123";
  const projectId = "prj-001";
  const cmd = {
    commandId: createCommandId(),
    commandType: "projects:cancel-project" as const,
    aggregateId: domainUuid,
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    payload: {
      domainUuid,
      projectId
    },
    metadata: {
      issuedAt: Date.now(),
      authorityEpoch: 1,
      schemaVersion: 1
    }
  };

  const reg = registry.get("projects:cancel-project");
  assert.ok(reg?.mutationDefinition);
  const keys = reg.mutationDefinition.getLockKeys({ command: cmd } as any);

  const expected = [lockKey.domain(domainUuid), lockKey.project(projectId)];
  const comp = assertSameCanonicalLockSet(keys, expected, "projects:cancel-project");
  assert.equal(comp.ok, true);

  await assertLockSetIdentityContract(keys, cmd.commandId, `domain:${domainUuid}`, "projects:cancel");
});

test("G5-LOCKSET-A4: Project Completion command lock keys match canonical domain + project lock set", async () => {
  const registry = new CommandRegistry();
  registerProjectCommands({
    registry,
    projectsService: {} as any,
    domains: {} as any
  });

  const domainUuid = "Domain123";
  const projectId = "prj-001";
  const cmd = {
    commandId: createCommandId(),
    commandType: "projects:complete-project" as const,
    aggregateId: domainUuid,
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    payload: {
      domainUuid,
      projectId
    },
    metadata: {
      issuedAt: Date.now(),
      authorityEpoch: 1,
      schemaVersion: 1
    }
  };

  const reg = registry.get("projects:complete-project");
  assert.ok(reg?.mutationDefinition);
  const keys = reg.mutationDefinition.getLockKeys({ command: cmd } as any);

  const expected = [lockKey.domain(domainUuid), lockKey.project(projectId)];
  const comp = assertSameCanonicalLockSet(keys, expected, "projects:complete-project");
  assert.equal(comp.ok, true);

  await assertLockSetIdentityContract(keys, cmd.commandId, `domain:${domainUuid}`, "projects:completion");
});

test("G5-LOCKSET-A5: Downtime Start command lock keys match canonical domain-only lock set", async () => {
  const registry = new CommandRegistry();
  registerDowntimeCommands({
    registry,
    downtimeService: {} as any,
    domains: {} as any
  });

  const domainUuid = "Domain123";
  const cmd = {
    commandId: createCommandId(),
    commandType: "downtime:start-activity" as const,
    aggregateId: domainUuid,
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    payload: {
      domainUuid,
      definitionId: "dt:test",
      participants: [{ participantRef: "Actor.1" }]
    },
    metadata: {
      issuedAt: Date.now(),
      authorityEpoch: 1,
      schemaVersion: 1
    }
  };

  const reg = registry.get("downtime:start-activity");
  assert.ok(reg?.mutationDefinition);
  const keys = reg.mutationDefinition.getLockKeys({ command: cmd } as any);

  const expected = [lockKey.domain(domainUuid)];
  const comp = assertSameCanonicalLockSet(keys, expected, "downtime:start-activity");
  assert.equal(comp.ok, true);

  await assertLockSetIdentityContract(keys, cmd.commandId, `domain:${domainUuid}`, "downtime:start");
});

test("G5-LOCKSET-A6: Downtime Resolution command lock keys use 'downtime:' and strictly ban 'activity:'", async () => {
  const registry = new CommandRegistry();
  registerDowntimeCommands({
    registry,
    downtimeService: {} as any,
    domains: {} as any
  });

  const domainUuid = "Domain123";
  const activityId = "act-999";
  const cmd = {
    commandId: createCommandId(),
    commandType: "downtime:complete-activity" as const,
    aggregateId: domainUuid,
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    payload: {
      domainUuid,
      activityId
    },
    metadata: {
      issuedAt: Date.now(),
      authorityEpoch: 1,
      schemaVersion: 1
    }
  };

  const reg = registry.get("downtime:complete-activity");
  assert.ok(reg?.mutationDefinition);
  const keys = reg.mutationDefinition.getLockKeys({ command: cmd } as any);

  // Must contain downtime:<activityId>, NOT activity:<activityId>
  assert.ok(keys.includes(`downtime:${activityId}`));
  assert.ok(!keys.includes(`activity:${activityId}`));

  const forbidden = assertNoForbiddenLockKeys(keys);
  assert.equal(forbidden.ok, true);

  const expected = [lockKey.domain(domainUuid), lockKey.downtime(activityId)];
  const comp = assertSameCanonicalLockSet(keys, expected, "downtime:complete-activity");
  assert.equal(comp.ok, true);

  await assertLockSetIdentityContract(keys, cmd.commandId, `domain:${domainUuid}`, "downtime:resolution");
});

test("G5-LOCKSET-A7: Facility Maintenance command lock keys match canonical domain + facility lock set", async () => {
  const registry = new CommandRegistry();
  registerFacilityCommands({
    registry,
    facilitiesService: {} as any,
    domains: {} as any
  });

  const domainUuid = "Domain123";
  const facilityId = "fac-456";
  const cmd = {
    commandId: createCommandId(),
    commandType: "facilities:maintain-facility" as const,
    aggregateId: domainUuid,
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    payload: {
      domainUuid,
      facilityId
    },
    metadata: {
      issuedAt: Date.now(),
      authorityEpoch: 1,
      schemaVersion: 1
    }
  };

  const reg = registry.get("facilities:maintain-facility");
  assert.ok(reg?.mutationDefinition);
  const keys = reg.mutationDefinition.getLockKeys({ command: cmd } as any);

  const expected = [lockKey.domain(domainUuid), lockKey.facility(facilityId)];
  const comp = assertSameCanonicalLockSet(keys, expected, "facilities:maintain-facility");
  assert.equal(comp.ok, true);

  await assertLockSetIdentityContract(keys, cmd.commandId, `domain:${domainUuid}`, "facilities:maintenance");
});

test("G5-LOCKSET-A8: Facility Repair command lock keys match canonical domain + facility lock set", async () => {
  const registry = new CommandRegistry();
  registerFacilityCommands({
    registry,
    facilitiesService: {} as any,
    domains: {} as any
  });

  const domainUuid = "Domain123";
  const facilityId = "fac-456";
  const cmd = {
    commandId: createCommandId(),
    commandType: "facilities:repair-facility" as const,
    aggregateId: domainUuid,
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    payload: {
      domainUuid,
      facilityId
    },
    metadata: {
      issuedAt: Date.now(),
      authorityEpoch: 1,
      schemaVersion: 1
    }
  };

  const reg = registry.get("facilities:repair-facility");
  assert.ok(reg?.mutationDefinition);
  const keys = reg.mutationDefinition.getLockKeys({ command: cmd } as any);

  const expected = [lockKey.domain(domainUuid), lockKey.facility(facilityId)];
  const comp = assertSameCanonicalLockSet(keys, expected, "facilities:repair-facility");
  assert.equal(comp.ok, true);

  await assertLockSetIdentityContract(keys, cmd.commandId, `domain:${domainUuid}`, "facilities:repair");
});

test("G5-LOCKSET-ASSERTION: assertNoForbiddenLockKeys rejects 'activity:' namespace and malformed keys", () => {
  const badKeys1 = ["domain:abc", "activity:act-123"];
  const res1 = assertNoForbiddenLockKeys(badKeys1);
  assert.equal(res1.ok, false);
  assert.equal(res1.error.code, "DM_TX_LOCKSET_DIVERGENCE");

  const validKeys = [lockKey.domain("abc"), lockKey.downtime("act-123")];
  const res3 = assertNoForbiddenLockKeys(validKeys);
  assert.equal(res3.ok, true);
});

test("G5-LOCKSET-EQUALITY: assertSameCanonicalLockSet detects missing and extra keys", () => {
  const setA = ["domain:abc", "project:p1"];
  const setB = ["project:p1", "domain:abc"]; // order-independent
  assert.equal(assertSameCanonicalLockSet(setA, setB).ok, true);

  const missing = ["domain:abc"];
  const missRes = assertSameCanonicalLockSet(missing, setA);
  assert.equal(missRes.ok, false);
  assert.equal(missRes.error.code, "DM_TX_LOCKSET_DIVERGENCE");

  const extra = ["domain:abc", "project:p1", "extra:key"];
  const extraRes = assertSameCanonicalLockSet(extra, setA);
  assert.equal(extraRes.ok, false);
  assert.equal(extraRes.error.code, "DM_TX_LOCKSET_DIVERGENCE");
});
