import assert from "node:assert/strict";
import test from "node:test";
import {
  CommandDedupeStore,
  computeCommandFingerprint,
  canonicalJsonStringify
} from "../../src/commands/command-dedupe-store.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { ok } from "../../src/core/contracts/result.js";
import type { TransportInboundMessage } from "../../src/commands/command-transport.js";

function createAuthorityService(currentUserId: string | null = "gm-1") {
  const users = [
    { id: "gm-1", isGM: true, active: true },
    { id: "player-1", isGM: false, active: true }
  ];

  return new PrimaryAuthorityService(
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
}

function createCommand(
  type: string,
  payload: unknown,
  commandId = createCommandId()
): DomainCommand<unknown> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId,
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

test("computeCommandFingerprint is deterministic regardless of object key order", () => {
  assert.equal(canonicalJsonStringify({ b: 2, a: 1 }), canonicalJsonStringify({ a: 1, b: 2 }));

  const cmdA = createCommand("domain:action", { b: 2, a: 1, nested: { y: 2, x: 1 } });
  const cmdB = createCommand("domain:action", { a: 1, b: 2, nested: { x: 1, y: 2 } });
  const cmdDifferent = createCommand("domain:action", { a: 1, b: 3 });

  const fpA = computeCommandFingerprint(cmdA);
  const fpB = computeCommandFingerprint(cmdB);
  const fpDiff = computeCommandFingerprint(cmdDifferent);

  assert.equal(fpA, fpB);
  assert.notEqual(fpA, fpDiff);
});

test("CommandBus deduplicates retry of same commandId with same intent without re-executing handler", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  let executionCount = 0;
  registry.register({
    type: "domain:increment",
    visibility: "public",
    handler: async () => {
      executionCount++;
      return ok({ count: executionCount });
    }
  });

  const bus = new CommandBus({ registry, authorityService });
  const command = createCommand("domain:increment", { delta: 1 });

  const msg: TransportInboundMessage = {
    rawEnvelope: command,
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  // First execution
  const res1 = await bus.dispatchInbound(msg);
  assert.equal(res1.ok && res1.value.status === "executed", true);
  if (res1.ok) {
    assert.deepEqual(res1.value.result, { count: 1 });
  }
  assert.equal(executionCount, 1);

  // Second execution with same commandId and same payload (retry)
  const res2 = await bus.dispatchInbound(msg);
  assert.equal(res2.ok && res2.value.status === "executed", true);
  if (res2.ok) {
    assert.deepEqual(res2.value.result, { count: 1 });
  }
  // Handler must NOT have run a second time
  assert.equal(executionCount, 1);
});

test("CommandBus rejects reuse of same commandId with different payload (DM_COMMAND_ID_REUSE_MISMATCH)", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  registry.register({
    type: "domain:transfer",
    visibility: "public",
    handler: async () => ok({ transferred: true })
  });

  const bus = new CommandBus({ registry, authorityService });
  const sharedCommandId = createCommandId();

  // Call 1: transfer 100 gold
  const cmd1 = createCommand("domain:transfer", { amount: 100 }, sharedCommandId);
  const res1 = await bus.dispatchInbound({
    rawEnvelope: cmd1,
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  });
  assert.equal(res1.ok && res1.value.status === "executed", true);

  // Call 2: reusing sharedCommandId with different payload (transfer 500 gold)
  const cmd2 = createCommand("domain:transfer", { amount: 500 }, sharedCommandId);
  const res2 = await bus.dispatchInbound({
    rawEnvelope: cmd2,
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  });

  assert.equal(res2.ok, true);
  if (res2.ok) {
    assert.equal(res2.value.status, "rejected");
    assert.equal(res2.value.error?.code, "DM_COMMAND_ID_REUSE_MISMATCH");
    assert.equal(res2.value.error?.category, "conflict");
  }
});

test("CommandBus coordinates simultaneous concurrent requests for same commandId", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  let executionCount = 0;
  registry.register({
    type: "domain:slow-op",
    visibility: "public",
    handler: async () => {
      executionCount++;
      // Simulate asynchronous processing time
      await new Promise((resolve) => setTimeout(resolve, 30));
      return ok({ processed: true, runId: executionCount });
    }
  });

  const bus = new CommandBus({ registry, authorityService });
  const command = createCommand("domain:slow-op", { param: "alpha" });

  const msg: TransportInboundMessage = {
    rawEnvelope: command,
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  // Launch two concurrent dispatches simultaneously for the exact same command
  const [res1, res2] = await Promise.all([
    bus.dispatchInbound(msg),
    bus.dispatchInbound(msg)
  ]);

  assert.equal(res1.ok && res1.value.status === "executed", true);
  assert.equal(res2.ok && res2.value.status === "executed", true);

  if (res1.ok && res2.ok) {
    assert.deepEqual(res1.value.result, { processed: true, runId: 1 });
    assert.deepEqual(res2.value.result, { processed: true, runId: 1 });
  }

  // Handler must have been executed exactly once!
  assert.equal(executionCount, 1);
});

test("CommandDedupeStore respects LRU eviction capacity and TTL retention", () => {
  const store = new CommandDedupeStore({ maxEntries: 3, ttlMs: 100 });

  const id1 = createCommandId();
  const id2 = createCommandId();
  const id3 = createCommandId();
  const id4 = createCommandId();

  store.claim(id1, "fp_1", 1000);
  store.claim(id2, "fp_2", 1000);
  store.claim(id3, "fp_3", 1000);

  assert.equal(store.has(id1), true);
  assert.equal(store.has(id2), true);
  assert.equal(store.has(id3), true);

  // Claiming 4th entry evicts oldest (id1)
  store.claim(id4, "fp_4", 1000);
  assert.equal(store.has(id1), false);
  assert.equal(store.has(id4), true);

  // TTL eviction
  store.recordResult(id2, {
    commandId: id2,
    status: "executed",
    transportTimestamp: 1000
  });

  // At time 1200 (TTL is 100), claiming a new item evicts expired non-pending entries
  const id5 = createCommandId();
  store.claim(id5, "fp_5", 1200);

  assert.equal(store.has(id2), false); // evicted by TTL
});
