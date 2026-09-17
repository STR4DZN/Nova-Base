import assert from "node:assert/strict";
import test from "node:test";
import {
  Registry,
  RegistryCollisionError,
  RegistryFrozenError
} from "../../src/core/registries/registry.js";

test("registry stores and retrieves entries", () => {
  const registry = new Registry<{ label: string }>("test");
  const entry = { label: "Example" };

  registry.register("example", entry);

  assert.equal(registry.has("example"), true);
  assert.deepEqual(registry.get("example"), entry);
  assert.equal(registry.get("missing"), undefined);
});

test("registry rejects duplicate IDs", () => {
  const registry = new Registry<string>("test");
  registry.register("same", "first");

  assert.throws(
    () => registry.register("same", "second"),
    (error) => error instanceof RegistryCollisionError && error.code === "DM_REGISTRY_COLLISION"
  );
});

test("registry freeze blocks further writes", () => {
  const registry = new Registry<string>("test");
  registry.register("before-freeze", "value");
  registry.freeze();

  assert.equal(registry.isFrozen(), true);
  assert.throws(
    () => registry.register("after-freeze", "value"),
    (error) => error instanceof RegistryFrozenError && error.code === "DM_REGISTRY_FROZEN"
  );
  assert.equal(registry.get("before-freeze"), "value");
});
