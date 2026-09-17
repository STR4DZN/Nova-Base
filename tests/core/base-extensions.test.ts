import assert from "node:assert/strict";
import test from "node:test";
import {
  baseExtensionRegistry,
  freezeBaseExtensions,
  registerBaseExtension
} from "../../src/core/registries/base-extensions.js";

test("base extension registry accepts and freezes an extension", () => {
  const extension = {
    id: "domain-manager:core",
    version: "0.0.1",
    label: "Core"
  };

  registerBaseExtension(extension);
  assert.deepEqual(baseExtensionRegistry.get(extension.id), extension);

  freezeBaseExtensions();
  assert.equal(baseExtensionRegistry.isFrozen(), true);
});
