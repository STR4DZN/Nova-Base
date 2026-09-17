import assert from "node:assert/strict";
import test from "node:test";
import { isNamespace, normalizeNamespace } from "../../src/core/identity/namespaces.js";
import { createOpaqueId, isOpaqueId } from "../../src/core/identity/ids.js";

test("opaque ID factory creates a valid prefixed ID", () => {
  const id = createOpaqueId("cmd");
  assert.equal(isOpaqueId(id), true);
  assert.equal(isOpaqueId(id, "cmd"), true);
  assert.equal(isOpaqueId(id, "tx"), false);
});

test("namespace normalization is lowercase and trimmed", () => {
  const namespace = normalizeNamespace(" Domain-Manager:Capability ");
  assert.equal(namespace, "domain-manager:capability");
  assert.equal(isNamespace(namespace), true);
});

test("namespace validation rejects malformed values", () => {
  assert.equal(isNamespace("missing-separator"), false);
  assert.equal(isNamespace("owner:"), false);
  assert.throws(() => normalizeNamespace("owner"));
  assert.throws(() => normalizeNamespace("owner:bad space"));
  assert.throws(() => normalizeNamespace("owner:bad/slash"));
  assert.throws(() => normalizeNamespace("owner_name:value"));
  assert.throws(() => normalizeNamespace("owner:one:two"));
});
