import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORITY_STATE_SETTING,
  FoundryPrimaryAuthorityAdapter,
  PREFERRED_AUTHORITY_USER_SETTING,
  PRIMARY_AUTHORITY_SETTING_NAMESPACE,
  registerFoundryPrimaryAuthoritySettings,
  type FoundryAuthorityRuntimeLike,
  type FoundryAuthoritySettingsLike,
  type FoundryAuthorityUserLike
} from "../../src/authority/foundry-primary-authority-adapter.js";

const gm = (id: string, active = true): FoundryAuthorityUserLike => ({ id, isGM: true, active });
const player = (id: string, active = true): FoundryAuthorityUserLike => ({ id, isGM: false, active });
const persisted = (authorityUserId: string | null, authorityEpoch: number, initialized = true) =>
  JSON.stringify({ authorityUserId, authorityEpoch, initialized });

interface RegisteredSetting {
  readonly data: Parameters<FoundryAuthoritySettingsLike["register"]>[2];
}

function settingsHarness(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  const registrations = new Map<string, RegisteredSetting>();
  const writes: Array<{ key: string; value: unknown }> = [];

  const settings: FoundryAuthoritySettingsLike = {
    register(namespace, key, data) {
      assert.equal(namespace, PRIMARY_AUTHORITY_SETTING_NAMESPACE);
      registrations.set(key, { data });
      if (!values.has(key)) values.set(key, data.default);
    },
    get(namespace, key) {
      assert.equal(namespace, PRIMARY_AUTHORITY_SETTING_NAMESPACE);
      return values.get(key);
    },
    async set(namespace, key, value) {
      assert.equal(namespace, PRIMARY_AUTHORITY_SETTING_NAMESPACE);
      values.set(key, value);
      writes.push({ key, value });
      return value;
    }
  };

  return { settings, values, registrations, writes };
}

function runtimeHarness(options: {
  users?: FoundryAuthorityUserLike[];
  currentUserId?: string | null;
  preferredUserId?: string;
  authorityState?: string;
} = {}) {
  const state = {
    users: options.users ?? [gm("gm-a")],
    currentUserId: options.currentUserId ?? "gm-a"
  };
  const settings = settingsHarness({
    [PREFERRED_AUTHORITY_USER_SETTING]: options.preferredUserId ?? "",
    [AUTHORITY_STATE_SETTING]: options.authorityState ?? persisted(null, 0, false)
  });

  const runtime: FoundryAuthorityRuntimeLike = {
    get users() {
      return { contents: state.users };
    },
    get user() {
      return state.users.find((user) => user.id === state.currentUserId) ?? null;
    },
    settings: settings.settings
  };

  return { state, settings, runtime };
}

test("registers hidden world settings for preferred GM and atomic authority state", () => {
  const ctx = settingsHarness();
  let preferredChanges = 0;
  const stateChanges: unknown[] = [];

  registerFoundryPrimaryAuthoritySettings({
    onPreferredChanged: () => preferredChanges++,
    onAuthorityStateChanged: (value) => stateChanges.push(value)
  }, ctx.settings);

  const preferred = ctx.registrations.get(PREFERRED_AUTHORITY_USER_SETTING)?.data;
  const state = ctx.registrations.get(AUTHORITY_STATE_SETTING)?.data;

  assert.equal(preferred?.scope, "world");
  assert.equal(preferred?.config, false);
  assert.equal(preferred?.type, String);
  assert.equal(preferred?.default, "");

  assert.equal(state?.scope, "world");
  assert.equal(state?.config, false);
  assert.equal(state?.type, String);
  assert.deepEqual(JSON.parse(String(state?.default)), {
    authorityUserId: null,
    authorityEpoch: 0,
    initialized: false
  });

  preferred?.onChange?.("gm-b");
  state?.onChange?.(persisted("gm-b", 3));
  assert.equal(preferredChanges, 1);
  assert.deepEqual(stateChanges, [persisted("gm-b", 3)]);
});

test("ready-time reconciliation rehydrates persisted identity and epoch without rewriting", async () => {
  const ctx = runtimeHarness({
    users: [gm("gm-b"), gm("gm-a")],
    currentUserId: "gm-a",
    authorityState: persisted("gm-a", 7)
  });
  const adapter = new FoundryPrimaryAuthorityAdapter(ctx.runtime);

  assert.equal((await adapter.reconcile())?.id, "gm-a");
  assert.deepEqual(adapter.service.getStatus(), {
    authorityUserId: "gm-a",
    authorityEpoch: 7,
    available: true
  });
  assert.deepEqual(ctx.settings.writes, []);
});

test("first authority seeds and persists state at epoch zero", async () => {
  const ctx = runtimeHarness({
    users: [gm("gm-a")],
    currentUserId: "gm-a",
    authorityState: persisted(null, 0, false)
  });
  const adapter = new FoundryPrimaryAuthorityAdapter(ctx.runtime);

  assert.equal((await adapter.reconcile())?.id, "gm-a");
  assert.equal(adapter.service.getEpoch(), 0);
  assert.deepEqual(ctx.settings.writes, [{
    key: AUTHORITY_STATE_SETTING,
    value: persisted("gm-a", 0)
  }]);
});

test("effective failover is persisted only by the newly elected local authority", async () => {
  const ctx = runtimeHarness({
    users: [gm("gm-a"), gm("gm-b")],
    currentUserId: "gm-b",
    authorityState: persisted("gm-a", 4)
  });
  const adapter = new FoundryPrimaryAuthorityAdapter(ctx.runtime);
  await adapter.reconcile();

  ctx.state.users = [gm("gm-a", false), gm("gm-b")];

  assert.equal((await adapter.reconcile())?.id, "gm-b");
  assert.equal(adapter.service.getEpoch(), 5);
  assert.deepEqual(ctx.settings.writes, [{
    key: AUTHORITY_STATE_SETTING,
    value: persisted("gm-b", 5)
  }]);
});

test("no-GM gap does not create unpersistable epoch churn", async () => {
  const ctx = runtimeHarness({
    users: [gm("gm-a")],
    currentUserId: null,
    authorityState: persisted("gm-a", 4)
  });
  const adapter = new FoundryPrimaryAuthorityAdapter(ctx.runtime);

  ctx.state.users = [];
  assert.equal(await adapter.reconcile(), null);
  assert.deepEqual(adapter.service.getStatus(), {
    authorityUserId: "gm-a",
    authorityEpoch: 4,
    available: false
  });
  assert.deepEqual(ctx.settings.writes, []);
});

test("new authority after a no-GM gap advances exactly once from persisted executor", async () => {
  const ctx = runtimeHarness({
    users: [gm("gm-b")],
    currentUserId: "gm-b",
    authorityState: persisted("gm-a", 4)
  });
  const adapter = new FoundryPrimaryAuthorityAdapter(ctx.runtime);

  assert.equal((await adapter.reconcile())?.id, "gm-b");
  assert.equal(adapter.service.getEpoch(), 5);
  assert.deepEqual(ctx.settings.writes, [{
    key: AUTHORITY_STATE_SETTING,
    value: persisted("gm-b", 5)
  }]);
});

test("non-authority clients never race the authority state world-setting write", async () => {
  const ctx = runtimeHarness({
    users: [gm("gm-a"), gm("gm-b"), player("player-x")],
    currentUserId: "player-x",
    authorityState: persisted("gm-a", 2)
  });
  const adapter = new FoundryPrimaryAuthorityAdapter(ctx.runtime);

  ctx.state.users = [gm("gm-a", false), gm("gm-b"), player("player-x")];
  await adapter.reconcile();

  assert.equal(adapter.service.getStatus().authorityUserId, "gm-b");
  assert.equal(adapter.service.getEpoch(), 3);
  assert.deepEqual(ctx.settings.writes, []);
});

test("preferred GM setting is read as an exact user id", async () => {
  const ctx = runtimeHarness({
    users: [gm("gm-a"), gm("gm-z")],
    currentUserId: "gm-z",
    preferredUserId: "gm-z",
    authorityState: persisted("gm-a", 2)
  });
  const adapter = new FoundryPrimaryAuthorityAdapter(ctx.runtime);

  assert.equal((await adapter.reconcile())?.id, "gm-z");
  assert.equal(adapter.service.getEpoch(), 3);
});

test("persisted state synchronization advances stale clients atomically and never rolls back", () => {
  const ctx = runtimeHarness({ authorityState: persisted("gm-a", 3) });
  const adapter = new FoundryPrimaryAuthorityAdapter(ctx.runtime);

  assert.equal(adapter.synchronizePersistedState(persisted("gm-b", 8)), true);
  assert.equal(adapter.service.getEpoch(), 8);
  assert.equal(adapter.service.getStatus().authorityUserId, "gm-b");
  assert.equal(adapter.synchronizePersistedState(persisted("gm-a", 7)), false);
  assert.equal(adapter.service.getEpoch(), 8);
});

test("corrupt persisted state fails closed at adapter construction and synchronization", () => {
  const bad = runtimeHarness({ authorityState: "not-json" });
  assert.throws(() => new FoundryPrimaryAuthorityAdapter(bad.runtime), /not valid JSON/);

  const good = runtimeHarness({ authorityState: persisted("gm-a", 1) });
  const adapter = new FoundryPrimaryAuthorityAdapter(good.runtime);
  assert.throws(
    () => adapter.synchronizePersistedState(JSON.stringify({ authorityUserId: "gm-b", authorityEpoch: 1.5, initialized: true })),
    /Persisted authorityEpoch/
  );
});
