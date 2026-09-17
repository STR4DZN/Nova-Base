import assert from "node:assert/strict";
import test from "node:test";
import {
  PrimaryAuthorityService,
  type PrimaryAuthorityEnvironment,
  type PrimaryAuthorityState
} from "../../src/authority/primary-authority-service.js";
import type { AuthorityElectionUser } from "../../src/authority/primary-authority-election.js";

const gm = (id: string, active = true): AuthorityElectionUser => ({ id, isGM: true, active });
const player = (id: string, active = true): AuthorityElectionUser => ({ id, isGM: false, active });

function harness(initialState?: PrimaryAuthorityState) {
  let users: readonly AuthorityElectionUser[] = [];
  let preferredUserId: string | null = null;
  let currentUserId: string | null = null;

  const environment: PrimaryAuthorityEnvironment<AuthorityElectionUser> = {
    getUsers: () => users,
    getPreferredUserId: () => preferredUserId,
    getCurrentUserId: () => currentUserId
  };

  const service = new PrimaryAuthorityService(environment, initialState);

  return {
    service,
    setUsers(next: readonly AuthorityElectionUser[]) {
      users = next;
    },
    setPreferredUserId(next: string | null) {
      preferredUserId = next;
    },
    setCurrentUserId(next: string | null) {
      currentUserId = next;
    }
  };
}

test("first resolve seeds authority without fabricating a new epoch", () => {
  const ctx = harness();
  ctx.setUsers([gm("gm-b"), gm("gm-a")]);

  assert.equal(ctx.service.resolve()?.id, "gm-a");
  assert.deepEqual(ctx.service.getStatus(), {
    authorityUserId: "gm-a",
    authorityEpoch: 0,
    available: true
  });
});

test("reordering users does not increment epoch or emit change", () => {
  const ctx = harness();
  ctx.setUsers([gm("gm-b"), gm("gm-a")]);
  ctx.service.resolve();

  let changes = 0;
  ctx.service.onChanged(() => changes++);

  ctx.setUsers([gm("gm-a"), gm("gm-b")]);
  assert.equal(ctx.service.resolve()?.id, "gm-a");
  assert.equal(ctx.service.getEpoch(), 0);
  assert.equal(changes, 0);
});

test("effective failover increments epoch exactly once", () => {
  const ctx = harness();
  ctx.setUsers([gm("gm-a"), gm("gm-b")]);
  ctx.service.resolve();

  ctx.setUsers([gm("gm-a", false), gm("gm-b")]);
  assert.equal(ctx.service.resolve()?.id, "gm-b");
  assert.equal(ctx.service.getEpoch(), 1);

  assert.equal(ctx.service.resolve()?.id, "gm-b");
  assert.equal(ctx.service.getEpoch(), 1);
});

test("preferred GM returning causes a single effective authority change", () => {
  const ctx = harness();
  ctx.setPreferredUserId("gm-z");
  ctx.setUsers([gm("gm-a"), gm("gm-z", false)]);
  assert.equal(ctx.service.resolve()?.id, "gm-a");

  ctx.setUsers([gm("gm-a"), gm("gm-z", true)]);
  assert.equal(ctx.service.resolve()?.id, "gm-z");
  assert.equal(ctx.service.getEpoch(), 1);
});

test("irrelevant preferred-user changes do not cause epoch churn", () => {
  const ctx = harness();
  ctx.setUsers([gm("gm-a"), player("player-x")]);
  ctx.service.resolve();

  ctx.setPreferredUserId("player-x");
  ctx.service.resolve();
  ctx.setPreferredUserId("missing-user");
  ctx.service.resolve();

  assert.equal(ctx.service.getStatus().authorityUserId, "gm-a");
  assert.equal(ctx.service.getEpoch(), 0);
});

test("temporary absence retains last authority identity and epoch while reporting unavailable", () => {
  const ctx = harness();
  ctx.setUsers([gm("gm-a")]);
  ctx.service.resolve();

  ctx.setUsers([gm("gm-a", false)]);
  assert.equal(ctx.service.resolve(), null);
  assert.deepEqual(ctx.service.getStatus(), {
    authorityUserId: "gm-a",
    authorityEpoch: 0,
    available: false
  });
});

test("same authority returning after a no-GM gap does not advance epoch", () => {
  const ctx = harness();
  ctx.setUsers([gm("gm-a")]);
  ctx.service.resolve();
  ctx.setUsers([]);
  ctx.service.resolve();

  ctx.setUsers([gm("gm-a")]);
  assert.equal(ctx.service.resolve()?.id, "gm-a");
  assert.equal(ctx.service.getEpoch(), 0);
});

test("different authority after a no-GM gap advances epoch exactly once", () => {
  const ctx = harness();
  ctx.setUsers([gm("gm-a")]);
  ctx.service.resolve();
  ctx.setUsers([]);
  ctx.service.resolve();

  ctx.setUsers([gm("gm-b")]);
  assert.equal(ctx.service.resolve()?.id, "gm-b");
  assert.equal(ctx.service.getEpoch(), 1);
});

test("first actual authority after an initially empty world stays at epoch zero", () => {
  const ctx = harness();
  ctx.setUsers([]);
  assert.equal(ctx.service.resolve(), null);

  ctx.setUsers([gm("gm-a")]);
  assert.equal(ctx.service.resolve()?.id, "gm-a");
  assert.equal(ctx.service.getEpoch(), 0);
});

test("isCurrentUser only matches an available resolved authority", () => {
  const ctx = harness();
  ctx.setUsers([gm("gm-a"), gm("gm-b")]);
  ctx.setCurrentUserId("gm-b");
  ctx.service.resolve();
  assert.equal(ctx.service.isCurrentUser(), false);

  ctx.setCurrentUserId("gm-a");
  assert.equal(ctx.service.isCurrentUser(), true);

  ctx.setUsers([gm("gm-a", false), gm("gm-b", false)]);
  ctx.service.resolve();
  assert.equal(ctx.service.isCurrentUser(), false);
});

test("onChanged fires only for effective executor identity changes and unsubscribe is idempotent", () => {
  const ctx = harness();
  ctx.setUsers([gm("gm-a"), gm("gm-b")]);
  ctx.service.resolve();

  let changes = 0;
  const unsubscribe = ctx.service.onChanged(() => changes++);

  ctx.service.resolve();
  assert.equal(changes, 0);

  ctx.setUsers([]);
  ctx.service.resolve();
  assert.equal(changes, 0, "temporary unavailability is not a new executor identity");

  ctx.setUsers([gm("gm-b")]);
  ctx.service.resolve();
  assert.equal(changes, 1);

  unsubscribe();
  unsubscribe();

  ctx.setPreferredUserId("gm-a");
  ctx.setUsers([gm("gm-a"), gm("gm-b")]);
  ctx.service.resolve();
  assert.equal(changes, 1);
});

test("rehydrated matching authority preserves epoch on first resolve", () => {
  const ctx = harness({ authorityUserId: "gm-a", authorityEpoch: 7, initialized: true });
  ctx.setUsers([gm("gm-b"), gm("gm-a")]);

  assert.equal(ctx.service.resolve()?.id, "gm-a");
  assert.equal(ctx.service.getEpoch(), 7);
});

test("rehydrated stale authority increments epoch when resolution changes", () => {
  const ctx = harness({ authorityUserId: "gm-z", authorityEpoch: 7, initialized: true });
  ctx.setUsers([gm("gm-a"), gm("gm-z", false)]);

  assert.equal(ctx.service.resolve()?.id, "gm-a");
  assert.equal(ctx.service.getEpoch(), 8);
});

test("snapshotState is immutable metadata suitable for persistence adapters", () => {
  const ctx = harness();
  ctx.setUsers([gm("gm-a")]);
  ctx.service.resolve();

  const snapshot = ctx.service.snapshotState();
  assert.deepEqual(snapshot, {
    authorityUserId: "gm-a",
    authorityEpoch: 0,
    initialized: true
  });
  assert.equal(Object.isFrozen(snapshot), true);
});

test("invalid initial states are rejected instead of silently normalized", () => {
  const environment: PrimaryAuthorityEnvironment<AuthorityElectionUser> = {
    getUsers: () => [],
    getPreferredUserId: () => null,
    getCurrentUserId: () => null
  };

  assert.throws(
    () => new PrimaryAuthorityService(environment, {
      authorityUserId: null,
      authorityEpoch: -1,
      initialized: true
    }),
    /non-negative safe integer/
  );

  assert.throws(
    () => new PrimaryAuthorityService(environment, {
      authorityUserId: "gm-a",
      authorityEpoch: 0,
      initialized: false
    }),
    /uninitialized authority state/
  );
});

test("epoch overflow fails closed rather than losing integer precision", () => {
  const ctx = harness({
    authorityUserId: "gm-a",
    authorityEpoch: Number.MAX_SAFE_INTEGER,
    initialized: true
  });
  ctx.setUsers([gm("gm-b")]);

  assert.throws(() => ctx.service.resolve(), /cannot exceed Number.MAX_SAFE_INTEGER/);
  assert.equal(ctx.service.getStatus().authorityUserId, "gm-a");
  assert.equal(ctx.service.getEpoch(), Number.MAX_SAFE_INTEGER);
});

test("synchronizeState advances to a newer persisted state atomically", () => {
  const ctx = harness({ authorityUserId: "gm-a", authorityEpoch: 4, initialized: true });
  ctx.setUsers([gm("gm-a"), gm("gm-b")]);

  assert.equal(ctx.service.synchronizeState({
    authorityUserId: "gm-b",
    authorityEpoch: 7,
    initialized: true
  }), true);
  assert.equal(ctx.service.getEpoch(), 7);
  assert.equal(ctx.service.getStatus().authorityUserId, "gm-b");
});

test("synchronizeState ignores stale state and rejects same-epoch identity conflicts", () => {
  const ctx = harness({ authorityUserId: "gm-a", authorityEpoch: 4, initialized: true });

  assert.equal(ctx.service.synchronizeState({
    authorityUserId: "gm-z",
    authorityEpoch: 3,
    initialized: true
  }), false);

  assert.throws(() => ctx.service.synchronizeState({
    authorityUserId: "gm-b",
    authorityEpoch: 4,
    initialized: true
  }), /Conflicting authority identities/);

  assert.equal(ctx.service.getStatus().authorityUserId, "gm-a");
  assert.equal(ctx.service.getEpoch(), 4);
});
