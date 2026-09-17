import assert from "node:assert/strict";
import test from "node:test";
import { err, ok } from "../../src/core/contracts/result.js";
import {
  CapabilityRegistry,
  createDefaultCapabilityRegistry,
  resolveEffectiveCapabilities,
  validateDomainCapabilities
} from "../../src/domains/domain-capabilities.js";

test("capability resolver keeps unknown IDs as unavailable and degraded", () => {
  const result = resolveEffectiveCapabilities({
    enabled: ["addon:missing"],
    config: { "addon:missing": { preserved: true } }
  }, createDefaultCapabilityRegistry());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value[0].capabilityId, "addon:missing");
    assert.equal(result.value[0].enabled, false);
    assert.equal(result.value[0].degraded, true);
    assert.equal(result.value[0].sources[0].source.type, "explicit");
    assert.equal(result.warnings?.[0].code, "DM_CAPABILITY_UNAVAILABLE");
  }
});

test("capability validation requires a registered functional capability", () => {
  const registry = createDefaultCapabilityRegistry();
  const unknownOnly = validateDomainCapabilities({ enabled: ["addon:missing"], config: {} }, registry);
  assert.equal(unknownOnly.ok, false);
  if (!unknownOnly.ok) assert.equal(unknownOnly.error.code, "DM_NO_FUNCTIONAL_CAPABILITY");

  const technicalOnly = validateDomainCapabilities({ enabled: ["domain-manager:core"], config: {} }, registry);
  assert.equal(technicalOnly.ok, false);
  if (!technicalOnly.ok) assert.equal(technicalOnly.error.code, "DM_NO_FUNCTIONAL_CAPABILITY");
});

test("capability registry validates known config without discarding unknown config", () => {
  const registry = new CapabilityRegistry();
  registry.register({
    id: "test:operations",
    label: "Operations",
    functional: true,
    validateConfig: (config) => (
      typeof config === "object" && config !== null && !Array.isArray(config)
        ? ok(undefined)
        : err({ code: "DM_BAD_TEST_CONFIG", category: "validation", message: "Config must be an object" })
    )
  });

  const valid = validateDomainCapabilities({
    enabled: ["test:operations", "addon:missing"],
    config: { "test:operations": { mode: "safe" }, "addon:missing": { keep: "me" } }
  }, registry);
  assert.equal(valid.ok, true);

  const invalid = validateDomainCapabilities({
    enabled: ["test:operations"],
    config: { "test:operations": "invalid" }
  }, registry);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "DM_INVALID_CAPABILITY_CONFIG");
});

test("capability IDs must be namespaced and enabled IDs cannot repeat", () => {
  const registry = createDefaultCapabilityRegistry();
  const invalidId = validateDomainCapabilities({ enabled: ["plain-id"], config: {} }, registry);
  assert.equal(invalidId.ok, false);
  if (!invalidId.ok) assert.equal(invalidId.error.code, "DM_INVALID_CAPABILITY_CONFIG");

  const duplicate = validateDomainCapabilities({
    enabled: ["domain-manager:domain", "domain-manager:domain"],
    config: {}
  }, registry);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, "DM_INVALID_CAPABILITY_CONFIG");
});
