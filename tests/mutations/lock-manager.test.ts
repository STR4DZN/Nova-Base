import assert from "node:assert/strict";
import test from "node:test";
import {
  LockManager,
  canonicalizeLockKeys
} from "../../src/mutations/lock-manager.js";

test("canonicalizeLockKeys normalizes, trims, deduplicates, and sorts keys lexically", () => {
  const keys = [" domain:B ", "project:1", "domain:A", "domain:B", ""];
  const canonical = canonicalizeLockKeys(keys);

  assert.deepEqual(canonical, ["domain:A", "domain:B", "project:1"]);
  assert.equal(Object.isFrozen(canonical), true);
});

test("LockManager prevents AB-BA deadlock by enforcing deterministic lexical order", async () => {
  const manager = new LockManager({ defaultTimeoutMs: 1000 });

  // Caller 1 requests [B, A]
  const handle1Result = await manager.acquireLocks({
    ownerId: "cmd-1",
    keys: ["domain:B", "domain:A"]
  });
  assert.equal(handle1Result.ok, true);

  // Caller 2 requests [A, B] while Caller 1 holds both
  let caller2Acquired = false;
  const caller2Promise = manager.acquireLocks({
    ownerId: "cmd-2",
    keys: ["domain:A", "domain:B"]
  }).then((res) => {
    caller2Acquired = true;
    return res;
  });

  // Caller 2 must be waiting, not deadlocked
  assert.equal(caller2Acquired, false);
  assert.equal(manager.isLocked("domain:A"), true);
  assert.equal(manager.isLocked("domain:B"), true);

  // Caller 1 releases
  if (handle1Result.ok) {
    handle1Result.value.release();
  }

  // Caller 2 should now acquire successfully
  const handle2Result = await caller2Promise;
  assert.equal(handle2Result.ok, true);
  assert.equal(caller2Acquired, true);

  if (handle2Result.ok) {
    handle2Result.value.release();
  }
  assert.equal(manager.isLocked("domain:A"), false);
  assert.equal(manager.isLocked("domain:B"), false);
});

test("LockManager allows independent domains to acquire and run concurrently", async () => {
  const manager = new LockManager();

  const handle1 = await manager.acquireLocks({
    ownerId: "cmd-alpha",
    keys: ["domain:alpha"]
  });

  const handle2 = await manager.acquireLocks({
    ownerId: "cmd-beta",
    keys: ["domain:beta"]
  });

  // Both should be acquired immediately without waiting
  assert.equal(handle1.ok, true);
  assert.equal(handle2.ok, true);

  assert.equal(manager.getLockOwner("domain:alpha"), "cmd-alpha");
  assert.equal(manager.getLockOwner("domain:beta"), "cmd-beta");

  if (handle1.ok) handle1.value.release();
  if (handle2.ok) handle2.value.release();
});

test("LockManager supports reentrant acquisition by the same owner", async () => {
  const manager = new LockManager();

  // Primary acquisition
  const outer = await manager.acquireLocks({
    ownerId: "cmd-nested",
    keys: ["domain:X"]
  });
  assert.equal(outer.ok, true);

  // Reentrant acquisition with same owner
  const inner = await manager.acquireLocks({
    ownerId: "cmd-nested",
    keys: ["domain:X", "project:sub"]
  });
  assert.equal(inner.ok, true);

  // Releasing inner keeps domain:X locked by outer
  if (inner.ok) inner.value.release();
  assert.equal(manager.isLocked("domain:X"), true);
  assert.equal(manager.isLocked("project:sub"), false);

  // Releasing outer frees domain:X
  if (outer.ok) outer.value.release();
  assert.equal(manager.isLocked("domain:X"), false);
});

test("LockManager times out queued requests with DM_LOCK_TIMEOUT", async () => {
  const manager = new LockManager({ defaultTimeoutMs: 50 });

  const handle1 = await manager.acquireLocks({
    ownerId: "cmd-holder",
    keys: ["domain:busy"]
  });
  assert.equal(handle1.ok, true);

  // Waiting request with 20ms timeout
  const handle2Result = await manager.acquireLocks({
    ownerId: "cmd-waiter",
    keys: ["domain:busy"],
    timeoutMs: 20
  });

  assert.equal(handle2Result.ok, false);
  if (!handle2Result.ok) {
    assert.equal(handle2Result.error.code, "DM_LOCK_TIMEOUT");
    assert.equal(handle2Result.error.category, "busy");
  }

  if (handle1.ok) handle1.value.release();
});

test("LockManager supports cancelling queued requests via AbortSignal", async () => {
  const manager = new LockManager({ defaultTimeoutMs: 5000 });

  const handle1 = await manager.acquireLocks({
    ownerId: "cmd-holder",
    keys: ["domain:blocked"]
  });
  assert.equal(handle1.ok, true);

  const controller = new AbortController();
  const waiterPromise = manager.acquireLocks({
    ownerId: "cmd-abortable",
    keys: ["domain:blocked"],
    signal: controller.signal
  });

  // Cancel while waiting in queue
  queueMicrotask(() => {
    controller.abort();
  });

  const waiterResult = await waiterPromise;
  assert.equal(waiterResult.ok, false);
  if (!waiterResult.ok) {
    assert.equal(waiterResult.error.code, "DM_COMMAND_CANCELLED");
    assert.equal(waiterResult.error.category, "busy");
  }

  // Holder can still release safely
  if (handle1.ok) handle1.value.release();
  assert.equal(manager.isLocked("domain:blocked"), false);
});

test("LockManager exposes diagnostic information on active locks and queues", async () => {
  const manager = new LockManager();

  const handle = await manager.acquireLocks({
    ownerId: "cmd-diag",
    keys: ["domain:diag-1"]
  });
  assert.equal(handle.ok, true);

  // Queue a second waiter
  manager.acquireLocks({
    ownerId: "cmd-waiting",
    keys: ["domain:diag-1"],
    timeoutMs: 5000
  });

  const diags = manager.getDiagnostics();
  const diag1 = diags.find((d) => d.key === "domain:diag-1");

  assert.ok(diag1);
  assert.equal(diag1.currentOwnerId, "cmd-diag");
  assert.equal(diag1.waitingCount, 1);
  assert.equal(diag1.reentrantDepth, 1);

  if (handle.ok) handle.value.release();
});

test("LockManager unblocks subsequent waiting requests immediately when front-of-queue request aborts", async () => {
  const manager = new LockManager();

  // 1. Owner 1 holds key-B
  const handleB = await manager.acquireLocks({
    ownerId: "owner-B",
    keys: ["domain:key-B"]
  });
  assert.equal(handleB.ok, true);

  // 2. Waiter 1 requests key-A and key-B (blocked by key-B, but key-A is free)
  const controller1 = new AbortController();
  const waiter1Promise = manager.acquireLocks({
    ownerId: "waiter-1",
    keys: ["domain:key-A", "domain:key-B"],
    signal: controller1.signal,
    timeoutMs: 5000
  });

  // 3. Waiter 2 requests key-A only (queued behind waiter-1 on key-A)
  let waiter2Acquired = false;
  const waiter2Promise = manager.acquireLocks({
    ownerId: "waiter-2",
    keys: ["domain:key-A"],
    timeoutMs: 5000
  }).then((res) => {
    waiter2Acquired = res.ok;
    return res;
  });

  // Waiter 2 cannot acquire yet because waiter 1 is ahead in key-A's queue
  assert.equal(waiter2Acquired, false);

  // 4. Waiter 1 cancels
  controller1.abort();
  const waiter1Res = await waiter1Promise;
  assert.equal(waiter1Res.ok, false);

  // 5. Waiter 2 should be unblocked IMMEDIATELY without waiting for timeout
  const waiter2Res = await waiter2Promise;
  assert.equal(waiter2Res.ok, true);
  assert.equal(waiter2Acquired, true);

  if (waiter2Res.ok) waiter2Res.value.release();
  if (handleB.ok) handleB.value.release();
});

test("Adversarial G2-AUD-016: LockManager unblocks subsequent waiting requests immediately when front-of-queue request times out", async () => {
  const manager = new LockManager();

  // 1. Owner B holds key-B
  const handleB = await manager.acquireLocks({
    ownerId: "owner-B",
    keys: ["domain:key-B"]
  });
  assert.equal(handleB.ok, true);

  // 2. Waiter 1 requests key-A and key-B with a short 25ms timeout (blocked by key-B)
  const waiter1Promise = manager.acquireLocks({
    ownerId: "waiter-1",
    keys: ["domain:key-A", "domain:key-B"],
    timeoutMs: 25
  });

  // 3. Waiter 2 requests key-A only with a longer timeout (queued behind waiter-1 on key-A)
  let waiter2Acquired = false;
  const waiter2Promise = manager.acquireLocks({
    ownerId: "waiter-2",
    keys: ["domain:key-A"],
    timeoutMs: 5000
  }).then((res) => {
    waiter2Acquired = res.ok;
    return res;
  });

  // Prior to waiter 1 timeout, waiter 2 cannot acquire key-A
  assert.equal(waiter2Acquired, false);

  // 4. Await waiter 1 timeout
  const waiter1Res = await waiter1Promise;
  assert.equal(waiter1Res.ok, false);
  assert.equal(waiter1Res.error?.code, "DM_LOCK_TIMEOUT");

  // 5. Waiter 2 must be unblocked immediately without requiring handleB to be released!
  const waiter2Res = await waiter2Promise;
  assert.equal(waiter2Res.ok, true, "Waiter 2 must acquire key-A immediately after waiter 1 times out");
  assert.equal(waiter2Acquired, true);

  if (waiter2Res.ok) waiter2Res.value.release();
  if (handleB.ok) handleB.value.release();
});

