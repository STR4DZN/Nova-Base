import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORITY_STATE_SETTING,
  PREFERRED_AUTHORITY_USER_SETTING
} from "../../src/authority/foundry-primary-authority-adapter.js";

test("main registers authority settings at init, resolves at ready, and recalculates on userConnected", async () => {
  const onceCallbacks = new Map<string, () => void>();
  const onCallbacks = new Map<string, (...args: unknown[]) => void>();
  const registeredSettings = new Map<string, { default: unknown; onChange?: (value: unknown) => void }>();
  const settingValues = new Map<string, unknown>();
  const settingWrites: Array<{ key: string; value: unknown }> = [];
  let creates = 0;

  let users = [
    { id: "gm-a", isGM: true, active: true },
    { id: "gm-b", isGM: true, active: true }
  ];

  const game: {
    settings: {
      register(namespace: string, key: string, data: { default: unknown; onChange?: (value: unknown) => void }): void;
      get(namespace: string, key: string): unknown;
      set(namespace: string, key: string, value: unknown): Promise<unknown>;
    };
    journal?: { contents: readonly unknown[]; get(id: string): undefined };
    users?: { readonly contents: readonly typeof users[number][] };
    user?: typeof users[number] | null;
  } = {
    settings: {
      register(_namespace, key, data) {
        registeredSettings.set(key, data);
        if (!settingValues.has(key)) settingValues.set(key, data.default);
      },
      get(_namespace, key) {
        return settingValues.get(key);
      },
      async set(_namespace, key, value) {
        settingValues.set(key, value);
        settingWrites.push({ key, value });
        registeredSettings.get(key)?.onChange?.(value);
        return value;
      }
    }
  };

  const globals = globalThis as unknown as {
    Hooks?: {
      once(event: "init" | "ready", callback: () => void): void;
      on(event: "userConnected", callback: (...args: unknown[]) => void): number;
    };
    game?: typeof game;
    JournalEntry?: { create(data: unknown): Promise<unknown> };
  };

  globals.game = game;
  globals.Hooks = {
    once(event, callback) {
      onceCallbacks.set(event, callback);
    },
    on(event, callback) {
      onCallbacks.set(event, callback);
      return 1;
    }
  };

  await import("../../src/main.js");

  assert.doesNotThrow(() => onceCallbacks.get("init")?.());
  assert.equal(registeredSettings.has(PREFERRED_AUTHORITY_USER_SETTING), true);
  assert.equal(registeredSettings.has(AUTHORITY_STATE_SETTING), true);
  assert.equal(creates, 0);

  game.journal = {
    contents: [],
    get: () => undefined
  };
  Object.defineProperty(game, "users", {
    configurable: true,
    get: () => ({ contents: users })
  });
  Object.defineProperty(game, "user", {
    configurable: true,
    get: () => users.find((user) => user.id === "gm-b") ?? null
  });
  globals.JournalEntry = {
    create: async () => {
      creates += 1;
      return undefined;
    }
  };

  assert.doesNotThrow(() => onceCallbacks.get("ready")?.());
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(onCallbacks.has("userConnected"), true);
  assert.equal(creates, 0);
  assert.deepEqual(settingWrites, [], "non-authority client must not persist initial state");

  // The persisted state still names gm-a. When gm-a disconnects, gm-b becomes
  // the new local authority and writes one atomic state transition.
  settingValues.set(AUTHORITY_STATE_SETTING, JSON.stringify({
    authorityUserId: "gm-a",
    authorityEpoch: 0,
    initialized: true
  }));
  registeredSettings.get(AUTHORITY_STATE_SETTING)?.onChange?.(settingValues.get(AUTHORITY_STATE_SETTING));

  users = [
    { id: "gm-a", isGM: true, active: false },
    { id: "gm-b", isGM: true, active: true }
  ];
  onCallbacks.get("userConnected")?.(users[0], false);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assert.equal(settingWrites.length, 1);
  assert.equal(settingWrites[0]?.key, AUTHORITY_STATE_SETTING);
  assert.deepEqual(JSON.parse(String(settingWrites[0]?.value)), {
    authorityUserId: "gm-b",
    authorityEpoch: 1,
    initialized: true
  });
});
