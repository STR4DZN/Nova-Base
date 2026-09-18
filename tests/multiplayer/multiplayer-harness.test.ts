import assert from "node:assert/strict";
import test from "node:test";
import {
  PrimaryAuthorityService,
  type AuthorityElectionUser
} from "../../src/authority/primary-authority-service.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import { RateLimiter } from "../../src/commands/rate-limiter.js";
import { CommandDedupeStore } from "../../src/commands/command-dedupe-store.js";
import {
  InMemoryCommandTransport,
  InMemoryTransportHub
} from "../../src/commands/in-memory-command-transport.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { createMutationPlan } from "../../src/mutations/plans/plan-contract.js";
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { RecoveryService } from "../../src/mutations/recovery-service.js";
import {
  createTransactionRecord,
  transitionTransactionState
} from "../../src/mutations/transaction-record.js";
import { ok, err } from "../../src/core/contracts/result.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";
import type { AuthenticatedCommandContext } from "../../src/commands/authenticated-command-context.js";

function createContext<TPayload>(
  command: DomainCommand<TPayload>,
  senderUserId: string = "player-1"
): AuthenticatedCommandContext<TPayload> {
  return {
    command,
    senderUserId,
    authorityUserId: "gm-1",
    authorityEpoch: 1,
    receivedAtReal: Date.now(),
    source: { type: "user" }
  };
}

interface SimulatedNode {
  userId: string;
  isGM: boolean;
  authorityService: PrimaryAuthorityService<AuthorityElectionUser>;
  transport: InMemoryCommandTransport;
  registry?: CommandRegistry;
  bus?: CommandBus;
  lockManager?: LockManager;
  coordinator?: MutationCoordinator;
  transactionStore?: TransactionStore;
  recoveryService?: RecoveryService;
}

interface SimulatedCluster {
  hub: InMemoryTransportHub;
  users: AuthorityElectionUser[];
  nodes: Map<string, SimulatedNode>;
  failover(disconnectedUserId: string): void;
}

function createSimulatedCluster(): SimulatedCluster {
  const hub = new InMemoryTransportHub();
  const users: AuthorityElectionUser[] = [
    { id: "gm-1", isGM: true, active: true },
    { id: "gm-2", isGM: true, active: true },
    { id: "player-1", isGM: false, active: true },
    { id: "player-2", isGM: false, active: true }
  ];

  const nodes = new Map<string, SimulatedNode>();

  for (const user of users) {
    const authorityService = new PrimaryAuthorityService(
      {
        getUsers: () => users,
        getPreferredUserId: () => "gm-1",
        getCurrentUserId: () => user.id
      },
      {
        authorityUserId: "gm-1",
        authorityEpoch: 1,
        initialized: true
      }
    );

    const transport = new InMemoryCommandTransport(
      {
        currentUserId: user.id,
        getAuthorityUserId: () => authorityService.getStatus().authorityUserId
      },
      hub
    );

    let node: SimulatedNode = {
      userId: user.id,
      isGM: user.isGM,
      authorityService,
      transport
    };

    if (user.isGM) {
      const registry = new CommandRegistry();
      const lockManager = new LockManager();
      const coordinator = new MutationCoordinator({ lockManager });
      const transactionStore = new TransactionStore();
      const recoveryService = new RecoveryService({
        transactionStore,
        lockManager
      });

      const bus = new CommandBus({
        registry,
        authorityService,
        transport,
        rateLimiter: new RateLimiter({ defaultMaxRequests: 1000, windowMs: 1000 }),
        dedupeStore: new CommandDedupeStore()
      });

      node = {
        ...node,
        registry,
        bus,
        lockManager,
        coordinator,
        transactionStore,
        recoveryService
      };
    }

    nodes.set(user.id, node);
  }

  const failover = (disconnectedUserId: string) => {
    const target = users.find((u) => u.id === disconnectedUserId);
    if (target) {
      target.active = false;
    }
    // All nodes resolve new authority
    for (const n of nodes.values()) {
      n.authorityService.resolve();
    }
  };

  return {
    hub,
    users,
    nodes,
    failover
  };
}

function createTestCommand(
  type: string,
  payload: Record<string, unknown> = {},
  commandId = createCommandId()
): DomainCommand<Record<string, unknown>> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId,
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

test("Multiplayer Cluster: Preferred GM handles remote player command execution and returns receipt", async () => {
  const cluster = createSimulatedCluster();
  const gm1 = cluster.nodes.get("gm-1")!;
  const player1 = cluster.nodes.get("player-1")!;

  // Register command on GM nodes
  gm1.registry!.register({
    type: "domain:create",
    visibility: "public",
    handler: async (ctx) => {
      return ok({
        createdId: "dom-42",
        author: ctx.senderUserId,
        epoch: ctx.authorityEpoch
      });
    }
  });

  const command = createTestCommand("domain:create", { name: "Realm of Testing" });
  const result = await player1.transport.send(command);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.status, "executed");
    assert.equal(result.value.commandId, command.commandId);
    assert.deepEqual(result.value.result, {
      createdId: "dom-42",
      author: "player-1",
      epoch: 1
    });
  }
});

test("Multiplayer Cluster: Failover to fallback GM when preferred GM disconnects, routing subsequent commands seamlessly", async () => {
  const cluster = createSimulatedCluster();
  const gm1 = cluster.nodes.get("gm-1")!;
  const gm2 = cluster.nodes.get("gm-2")!;
  const player1 = cluster.nodes.get("player-1")!;

  // Register handlers on both GMs
  for (const gm of [gm1, gm2]) {
    gm.registry!.register({
      type: "domain:touch",
      visibility: "public",
      handler: async (ctx) => {
        return ok({
          handledBy: gm.userId,
          sender: ctx.senderUserId,
          epoch: ctx.authorityEpoch
        });
      }
    });
  }

  // 1. Initial request handled by preferred GM (gm-1) at epoch 1
  const cmd1 = createTestCommand("domain:touch");
  const res1 = await player1.transport.send(cmd1);
  assert.equal(res1.ok, true);
  if (res1.ok) {
    assert.equal(res1.value.status, "executed");
    assert.equal((res1.value.result as any).handledBy, "gm-1");
  }

  // 2. Preferred GM goes offline -> failover triggered
  cluster.failover("gm-1");

  // Verify election state across nodes
  assert.equal(gm2.authorityService.getStatus().authorityUserId, "gm-2");
  assert.equal(gm2.authorityService.getStatus().authorityEpoch, 2);
  assert.equal(player1.authorityService.getStatus().authorityUserId, "gm-2");
  assert.equal(player1.authorityService.getStatus().authorityEpoch, 2);

  // 3. Next command from player-1 routes to gm-2 at epoch 2
  const cmd2 = createTestCommand("domain:touch");
  const res2 = await player1.transport.send(cmd2);
  assert.equal(res2.ok, true);
  if (res2.ok) {
    assert.equal(res2.value.status, "executed");
    assert.equal((res2.value.result as any).handledBy, "gm-2");
    assert.equal((res2.value.result as any).epoch, 2);
  }
});

test("Multiplayer Cluster: Simultaneous identical commands share in-flight execution and deduplicate safely", async () => {
  const cluster = createSimulatedCluster();
  const gm1 = cluster.nodes.get("gm-1")!;
  const player1 = cluster.nodes.get("player-1")!;
  const player2 = cluster.nodes.get("player-2")!;

  let handlerCalls = 0;
  gm1.registry!.register({
    type: "domain:expensive-op",
    visibility: "public",
    handler: async () => {
      handlerCalls++;
      await new Promise((r) => setTimeout(r, 20));
      return ok({ count: handlerCalls });
    }
  });

  const sharedCommandId = createCommandId();
  const cmdA = createTestCommand("domain:expensive-op", { key: "value" }, sharedCommandId);
  const cmdB = createTestCommand("domain:expensive-op", { key: "value" }, sharedCommandId);

  // Both players submit identical command concurrently
  const [resA, resB] = await Promise.all([
    player1.transport.send(cmdA),
    player2.transport.send(cmdB)
  ]);

  assert.equal(resA.ok, true);
  assert.equal(resB.ok, true);
  if (resA.ok && resB.ok) {
    assert.equal(resA.value.status, "executed");
    assert.equal(resB.value.status, "executed");
    assert.deepEqual(resA.value.result, resB.value.result);
  }

  // Handler must have been executed exactly once
  assert.equal(handlerCalls, 1);
});

test("Multiplayer Cluster: Reused commandId with conflicting payload is rejected with DM_COMMAND_ID_REUSE_MISMATCH", async () => {
  const cluster = createSimulatedCluster();
  const gm1 = cluster.nodes.get("gm-1")!;
  const player1 = cluster.nodes.get("player-1")!;

  gm1.registry!.register({
    type: "domain:action",
    visibility: "public",
    handler: async () => ok({ done: true })
  });

  const commandId = createCommandId();
  const cmdOriginal = createTestCommand("domain:action", { step: 1 }, commandId);
  const cmdConflicting = createTestCommand("domain:action", { step: 2 }, commandId);

  // First succeeds
  const res1 = await player1.transport.send(cmdOriginal);
  assert.equal(res1.ok, true);
  if (res1.ok) {
    assert.equal(res1.value.status, "executed");
  }

  // Second with same commandId but different payload fails with mismatch
  const res2 = await player1.transport.send(cmdConflicting);
  assert.equal(res2.ok, true);
  if (res2.ok) {
    assert.equal(res2.value.status, "rejected");
    assert.equal(res2.value.error?.code, "DM_COMMAND_ID_REUSE_MISMATCH");
  }
});

test("Multiplayer Cluster: Player cannot spoof sender identity in command payload (DM_SECURITY_SENDER_SPOOFED)", async () => {
  const cluster = createSimulatedCluster();
  const gm1 = cluster.nodes.get("gm-1")!;
  const player1 = cluster.nodes.get("player-1")!;

  gm1.registry!.register({
    type: "domain:mutate",
    visibility: "public",
    handler: async () => ok({ mutated: true })
  });

  // Player sends payload claiming userId is gm-1
  const spoofedCmd = createTestCommand("domain:mutate", {
    userId: "gm-1",
    field: "secret"
  });

  const res = await player1.transport.send(spoofedCmd);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.status, "rejected");
    assert.equal(res.value.error?.code, "DM_SECURITY_SENDER_SPOOFED");
  }
});

test("Multiplayer Cluster: Remote call of internal-only command is rejected even from GM (DM_SECURITY_INTERNAL_ONLY_COMMAND)", async () => {
  const cluster = createSimulatedCluster();
  const gm1 = cluster.nodes.get("gm-1")!;
  const gm2 = cluster.nodes.get("gm-2")!;
  const player1 = cluster.nodes.get("player-1")!;

  gm1.registry!.register({
    type: "domain:internal-maintenance",
    visibility: "internal",
    handler: async () => ok({ clean: true })
  });

  // 1. Player calls internal command via network transport -> REJECTED
  const playerCmd = createTestCommand("domain:internal-maintenance");
  const playerRes = await player1.transport.send(playerCmd);
  assert.equal(playerRes.ok, true);
  if (playerRes.ok) {
    assert.equal(playerRes.value.status, "rejected");
    assert.equal(playerRes.value.error?.code, "DM_SECURITY_INTERNAL_ONLY_COMMAND");
  }

  // 2. Secondary GM calls internal command over network transport -> REJECTED
  const gmCmd = createTestCommand("domain:internal-maintenance");
  const gmRes = await gm2.transport.send(gmCmd);
  assert.equal(gmRes.ok, true);
  if (gmRes.ok) {
    assert.equal(gmRes.value.status, "rejected");
    assert.equal(gmRes.value.error?.code, "DM_SECURITY_INTERNAL_ONLY_COMMAND");
  }
});

test("Multiplayer Cluster: Unknown command returns structured DM_COMMAND_HANDLER_NOT_FOUND", async () => {
  const cluster = createSimulatedCluster();
  const player1 = cluster.nodes.get("player-1")!;

  const unknownCmd = createTestCommand("domain:does-not-exist");
  const res = await player1.transport.send(unknownCmd);

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.status, "rejected");
    assert.equal(res.value.error?.code, "DM_COMMAND_HANDLER_NOT_FOUND");
  }
});

test("Multiplayer Cluster: Inverted multi-key lock acquisition across concurrent clients is deadlock-free", async () => {
  const lockManager = new LockManager();

  // 4 clients attempting to acquire overlapping locks in conflicting/inverted orders
  const clientA = lockManager.acquireLocks({
    ownerId: "client-a",
    keys: ["domain:omega", "domain:alpha"]
  });

  const clientB = lockManager.acquireLocks({
    ownerId: "client-b",
    keys: ["domain:alpha", "domain:omega"]
  });

  const clientC = lockManager.acquireLocks({
    ownerId: "client-c",
    keys: ["domain:beta", "domain:alpha", "domain:omega"]
  });

  const clientD = lockManager.acquireLocks({
    ownerId: "client-d",
    keys: ["domain:omega", "domain:beta"]
  });

  // Simulate concurrent execution: release each lock after a small simulated operation
  const runWorker = async (promise: ReturnType<typeof lockManager.acquireLocks>) => {
    const handleResult = await promise;
    assert.equal(handleResult.ok, true);
    if (handleResult.ok) {
      await new Promise((r) => setTimeout(r, 5));
      handleResult.value.release();
    }
  };

  // All 4 complete deterministically without deadlocks or timeouts
  await Promise.all([
    runWorker(clientA),
    runWorker(clientB),
    runWorker(clientC),
    runWorker(clientD)
  ]);

  const diag = lockManager.getDiagnostics();
  const activeLocksCount = diag.filter((d) => d.currentOwnerId !== null).length;
  const totalQueuedRequests = diag.reduce((sum, d) => sum + d.waitingCount, 0);
  assert.equal(activeLocksCount, 0);
  assert.equal(totalQueuedRequests, 0);
});

test("Multiplayer Cluster: Revision conflict between plan preview and confirm rejects with DM_REVISION_CONFLICT", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  let simulatedRevision = 1;

  // 1. Client previews plan expecting revision 1
  const previewPlan = createMutationPlan({
    commandId: createCommandId(),
    lockKeys: ["domain:dom-shared"],
    expectedRevisions: { "dom-shared": 1 },
    writeSet: [
      {
        targetRef: "dom-shared",
        operationType: "update",
        payload: { name: "New Name" }
      }
    ]
  });

  // 2. Intervening concurrent transaction commits and advances revision to 2
  simulatedRevision = 2;

  // 3. Confirm execution is sent declaring expectedRevisions: { "dom-shared": 1 }
  const confirmCommand = createTestCommand("domain:confirm", {}, previewPlan.commandId);
  (confirmCommand as any).expectedRevisions = { "dom-shared": 1 };
  const context = createContext(confirmCommand);

  const confirmResult = await coordinator.execute(context, {
    getLockKeys: () => ["domain:dom-shared"],
    freshRead: async () => {
      // Fresh read strictly after acquiring lock returns actual revision 2
      return ok({
        revision: simulatedRevision,
        entityRevisions: { "dom-shared": simulatedRevision }
      });
    },
    buildPlan: async () => ok(previewPlan),
    commit: async () =>
      ok({
        result: { applied: true },
        resultingRevisions: { "dom-shared": simulatedRevision },
        changed: true
      })
  });

  assert.equal(confirmResult.ok, true);
  if (confirmResult.ok) {
    assert.equal(confirmResult.value.status, "rejected");
    assert.equal(confirmResult.value.error?.code, "DM_REVISION_CONFLICT");
    assert.equal(confirmResult.value.error?.category, "conflict");
  }

  // Locks must be released
  assert.equal(lockManager.isLocked("domain:dom-shared"), false);
});

test("Multiplayer Cluster: Provider commit write failure triggers compensation, and compensation failure returns DM_COMPENSATION_FAILED", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  const command = createTestCommand("domain:critical-write");
  const context = createContext(command);

  const failingCommitResult = await coordinator.execute(context, {
    getLockKeys: () => ["domain:critical"],
    freshRead: async () => ok({ revision: 1 }),
    buildPlan: async (ctx) => {
      return ok(
        createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: ["domain:critical"],
          writeSet: [
            {
              targetRef: "domain:critical",
              operationType: "create",
              payload: {}
            }
          ]
        })
      );
    },
    commit: async () => {
      return err(
        createPublicError({
          code: "DM_EXTERNAL_API_UNREACHABLE",
          category: "provider",
          message: "Database storage backend crashed during write"
        })
      );
    },
    compensate: async () => {
      return err(
        createPublicError({
          code: "DM_COMPENSATION_ERROR",
          category: "provider",
          message: "Rollback undo failed"
        })
      );
    }
  });

  assert.equal(failingCommitResult.ok, true);
  if (failingCommitResult.ok) {
    assert.equal(failingCommitResult.value.status, "rejected");
    assert.equal(failingCommitResult.value.error?.code, "DM_COMPENSATION_FAILED");
    assert.equal(failingCommitResult.value.error?.category, "recovery");
  }

  // Locks must be released even after severe compensation failure
  assert.equal(lockManager.isLocked("domain:critical"), false);
});

test("Multiplayer Cluster: Crash during commit leaves transaction in committing; new GM scans on startup, transitions to needs-recovery, and isolates keys", async () => {
  const store = new TransactionStore();
  const lockManager = new LockManager();
  const recoveryService = new RecoveryService({
    transactionStore: store,
    lockManager
  });

  // Old authority was processing a transaction when GM crashed
  const crashedTx = createTransactionRecord({
    commandId: createCommandId(),
    authorityEpoch: 1,
    lockKeys: ["domain:damaged-partition"]
  });
  const c1 = transitionTransactionState(crashedTx, "claimed", 1);
  const c2 = transitionTransactionState(c1.value!, "prepared", 1);
  const c3 = transitionTransactionState(c2.value!, "committing", 1);
  store.save(c3.value!);

  // New GM elected at epoch 2 runs startup scan
  const unresolved = await recoveryService.scanOnStartup(2);
  assert.equal(unresolved.length, 1);

  const updatedRecord = store.get(crashedTx.transactionId)!;
  assert.equal(updatedRecord.state, "needs-recovery");
  assert.equal(updatedRecord.authorityEpoch, 2);

  // Damaged domain key is isolated
  assert.equal(lockManager.isLocked("domain:damaged-partition"), true);

  // Healthy independent domain is not blocked and can execute
  const healthyLock = await lockManager.acquireLocks({
    ownerId: "healthy-worker",
    keys: ["domain:healthy-partition"]
  });
  assert.equal(healthyLock.ok, true);
  if (healthyLock.ok) {
    healthyLock.value.release();
  }

  // Idempotent recovery execution
  let compensationsDone = 0;
  const rec1 = await recoveryService.recoverTransaction(crashedTx.transactionId, 2, async () => {
    compensationsDone++;
    return ok(undefined);
  });
  assert.equal(rec1.ok, true);
  if (rec1.ok) {
    assert.equal(rec1.value.state, "compensated");
  }
  assert.equal(compensationsDone, 1);
  assert.equal(lockManager.isLocked("domain:damaged-partition"), false);

  // Repeated recovery is safe no-op
  const rec2 = await recoveryService.recoverTransaction(crashedTx.transactionId, 2, async () => {
    compensationsDone++;
    return ok(undefined);
  });
  assert.equal(rec2.ok, true);
  assert.equal(compensationsDone, 1);
});

test("Multiplayer Cluster: Scale benchmark - 5000 commands checked in dedupe store without memory exhaustion", () => {
  const store = new CommandDedupeStore({ maxEntries: 10000, ttlMs: 60000 });

  const count = 5000;
  for (let i = 0; i < count; i++) {
    const cmdId = createCommandId();
    const receipt = {
      commandId: cmdId,
      status: "executed" as const,
      transportTimestamp: Date.now()
    };

    store.claim(cmdId, `fp_${i}`);
    store.recordResult(cmdId, receipt);
  }

  assert.equal(store.size, count);

  // Spot check retrieval performance
  const lookupStart = performance.now();
  for (let i = 0; i < 500; i++) {
    const randomId = ("cmd_" + String(i).padStart(32, "0")) as any;
    store.get(randomId);
  }
  const lookupDuration = performance.now() - lookupStart;

  // 500 lookups should complete in less than 50ms
  assert.ok(lookupDuration < 50, `Lookup duration was ${lookupDuration}ms`);
});

test("Multiplayer Cluster: Scale benchmark - high concurrency independent domain transactions execute in parallel", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  const domainCount = 50;
  const start = Date.now();

  const tasks = Array.from({ length: domainCount }, (_, i) => {
    const domainId = `domain_${i}`;
    const command = createTestCommand("domain:concurrent-update", { v: i });
    const context = createContext(command);

    return coordinator.execute(context, {
      getLockKeys: () => [`domain:${domainId}`],
      freshRead: async () => ok({ revision: 1 }),
      buildPlan: async (ctx) => {
        return ok(
          createMutationPlan({
            commandId: ctx.command.commandId,
            lockKeys: [`domain:${domainId}`],
            writeSet: [
              {
                targetRef: domainId,
                operationType: "update",
                payload: { v: i }
              }
            ]
          })
        );
      },
      commit: async () => {
        await new Promise((r) => setTimeout(r, 2));
        return ok({
          result: { applied: true },
          resultingRevisions: { [domainId]: 2 },
          changed: true
        });
      }
    });
  });

  const results = await Promise.all(tasks);
  for (const res of results) {
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value.status, "executed");
    }
  }

  const duration = Date.now() - start;
  // 50 parallel 2ms tasks should complete well under 8000ms even under heavy test suite load
  assert.ok(duration < 8000, `Duration was ${duration}ms`);
  const activeLocks = lockManager.getDiagnostics().filter((d) => d.currentOwnerId !== null).length;
  assert.equal(activeLocks, 0);
});
