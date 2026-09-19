import test from "node:test";
import assert from "node:assert/strict";
import {
  type FacilityDefinition,
  type FacilityInstance,
  type FacilityLifecycle,
  type FacilityReadiness,
  validateFacilityDefinition,
  validateFacilityInstance,
  validateFacilityLifecycleTransition,
  validateFacilityReadinessTransition,
  calculateFacilityEffectiveCapabilities,
  FACILITY_LIFECYCLE_STATES,
  FACILITY_READINESS_STATES
} from "../../src/facilities/types/facility-types.js";
import {
  FacilityDefinitionRegistry,
  createDefaultFacilityRegistry
} from "../../src/facilities/definitions/facility-registry.js";
import { CANONICAL_FACILITY_DEFINITIONS } from "../../src/facilities/definitions/canonical-facility-definitions.js";
import {
  FACILITIES_CAPABILITY_ID,
  createDefaultDomainFacilitiesData,
  validateDomainFacilitiesData,
  tryGetDomainFacilitiesData,
  getDomainFacilitiesData,
  withDomainFacilitiesData
} from "../../src/facilities/facility-data.js";
import { domainCapabilityRegistry } from "../../src/domains/domain-capabilities.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";

function createTestDefinition(overrides: Partial<FacilityDefinition> = {}): FacilityDefinition {
  return {
    id: "domain-manager:test-forge",
    version: 1,
    label: "Test Forge",
    category: "production",
    tags: ["crafting", "metalwork"],
    scale: "building",
    maxLevel: 3,
    capabilitiesGranted: ["domain-manager:forge"],
    defaultReadiness: "ready",
    upgrades: [
      {
        id: "blast-furnace",
        label: "Blast Furnace",
        capabilitiesGranted: ["domain-manager:smelting"],
        levelRequired: 2
      }
    ],
    ...overrides
  };
}

function createTestInstance(overrides: Partial<FacilityInstance> = {}): FacilityInstance {
  const base: FacilityInstance = {
    id: "fac-inst-1",
    domainUuid: "dom-test-1",
    definitionId: "domain-manager:test-forge",
    name: "Settlement Forge",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "operational",
    readiness: "ready",
    level: 1,
    installedModules: [],
    activeUpgrades: [],
    tags: ["crafting"],
    createdAt: 1000,
    updatedAt: 1000
  };

  const candidate = { ...base, ...overrides };
  const valid = validateFacilityInstance(candidate);
  if (!valid.ok) {
    throw new Error(`Invalid test fixture: ${valid.error.message}`);
  }
  return valid.value;
}

test("G5.6: validateFacilityDefinition validates namespaced ID, schema, labels, and capabilities", () => {
  const def = createTestDefinition();
  const valid = validateFacilityDefinition(def);
  assert.equal(valid.ok, true);

  // Non-namespaced ID
  const invalidId = validateFacilityDefinition({ ...def, id: "simple_forge" });
  assert.equal(invalidId.ok, false);
  if (!invalidId.ok) {
    assert.equal(invalidId.error.code, "DM_FACILITY_INVALID_ID");
  }

  // Missing label
  const missingLabel = validateFacilityDefinition({ ...def, label: "   " });
  assert.equal(missingLabel.ok, false);
  if (!missingLabel.ok) {
    assert.equal(missingLabel.error.code, "DM_FACILITY_DEFINITION_INVALID");
  }

  // Invalid defaultReadiness
  const invalidReadiness = validateFacilityDefinition({ ...def, defaultReadiness: "broken" });
  assert.equal(invalidReadiness.ok, false);
  if (!invalidReadiness.ok) {
    assert.equal(invalidReadiness.error.code, "DM_FACILITY_INVALID_READINESS");
  }
});

test("G5.6: FacilityDefinitionRegistry registers, lists, filters, freezes, and loads canonical facilities", () => {
  const registry = new FacilityDefinitionRegistry();
  const def = createTestDefinition();

  const regRes = registry.register(def);
  assert.equal(regRes.ok, true);
  assert.equal(registry.has(def.id), true);
  assert.equal(registry.get(def.id)?.label, "Test Forge");

  // Rejects duplicate
  const dupRes = registry.register(def);
  assert.equal(dupRes.ok, false);
  if (!dupRes.ok) {
    assert.equal(dupRes.error.code, "DM_FACILITY_ALREADY_EXISTS");
  }

  // List with filter
  const filtered = registry.list({ category: "production" });
  assert.equal(filtered.length, 1);
  assert.equal(registry.list({ category: "security" }).length, 0);

  // Freeze
  registry.freeze();
  assert.equal(registry.isFrozen, true);
  const postFreeze = registry.register(createTestDefinition({ id: "domain-manager:another-forge" }));
  assert.equal(postFreeze.ok, false);
  if (!postFreeze.ok) {
    assert.equal(postFreeze.error.code, "DM_REGISTRY_FROZEN");
  }

  // Canonical registry
  const canonical = createDefaultFacilityRegistry();
  assert.ok(canonical.has("domain-manager:storehouse"));
  assert.ok(canonical.has("domain-manager:basic-workshop"));
  assert.ok(canonical.has("domain-manager:guard-post"));
  assert.equal(canonical.list().length, CANONICAL_FACILITY_DEFINITIONS.length);
});

test("G5.6: validateFacilityInstance enforces valid lifecycle, readiness, integrity, and levels", () => {
  const instance = createTestInstance();
  assert.equal(instance.lifecycle, "operational");
  assert.equal(instance.readiness, "ready");
  assert.equal(instance.level, 1);

  // Invalid lifecycle
  const badLifecycle = validateFacilityInstance({ ...instance, lifecycle: "half-built" });
  assert.equal(badLifecycle.ok, false);
  if (!badLifecycle.ok) {
    assert.equal(badLifecycle.error.code, "DM_FACILITY_INVALID_LIFECYCLE");
  }

  // Invalid readiness
  const badReadiness = validateFacilityInstance({ ...instance, readiness: "super-ready" });
  assert.equal(badReadiness.ok, false);
  if (!badReadiness.ok) {
    assert.equal(badReadiness.error.code, "DM_FACILITY_INVALID_READINESS");
  }

  // Valid integrity
  const withInteg = validateFacilityInstance({
    ...instance,
    integrity: { current: 80, max: 100 }
  });
  assert.equal(withInteg.ok, true);

  // Invalid integrity (current > max)
  const badInteg = validateFacilityInstance({
    ...instance,
    integrity: { current: 150, max: 100 }
  });
  assert.equal(badInteg.ok, false);
  if (!badInteg.ok) {
    assert.equal(badInteg.error.code, "DM_FACILITY_INTEGRITY_INVALID");
  }
});

test("G5.6: validateFacilityLifecycleTransition validates legal and illegal transitions", () => {
  // Legal transitions
  assert.equal(validateFacilityLifecycleTransition("planned", "underConstruction").ok, true);
  assert.equal(validateFacilityLifecycleTransition("underConstruction", "operational").ok, true);
  assert.equal(validateFacilityLifecycleTransition("operational", "degraded").ok, true);
  assert.equal(validateFacilityLifecycleTransition("degraded", "operational").ok, true);
  assert.equal(validateFacilityLifecycleTransition("operational", "disabled").ok, true);
  assert.equal(validateFacilityLifecycleTransition("disabled", "operational").ok, true);
  assert.equal(validateFacilityLifecycleTransition("operational", "decommissioned").ok, true);
  assert.equal(validateFacilityLifecycleTransition("decommissioned", "destroyed").ok, true);
  assert.equal(validateFacilityLifecycleTransition("destroyed", "underConstruction").ok, true);

  // Same-state no-op is valid
  assert.equal(validateFacilityLifecycleTransition("operational", "operational").ok, true);

  // Illegal transitions
  const illegal1 = validateFacilityLifecycleTransition("decommissioned", "operational");
  assert.equal(illegal1.ok, false);
  if (!illegal1.ok) {
    assert.equal(illegal1.error.code, "DM_FACILITY_INVALID_LIFECYCLE_TRANSITION");
  }

  const illegal2 = validateFacilityLifecycleTransition("planned", "destroyed");
  assert.equal(illegal2.ok, false);
});

test("G5.6: calculateFacilityEffectiveCapabilities strictly separates Lifecycle and Readiness (Master Spec §16)", () => {
  const def = createTestDefinition();

  // 1. Operational + Ready -> grants capabilities
  const activeFacility = createTestInstance({
    lifecycle: "operational",
    readiness: "ready"
  });
  const caps1 = calculateFacilityEffectiveCapabilities(activeFacility, def);
  assert.deepEqual(caps1, ["domain-manager:forge"]);

  // 2. Operational + Active Upgrade -> grants base + upgrade capabilities
  const upgradedFacility = createTestInstance({
    lifecycle: "operational",
    readiness: "ready",
    activeUpgrades: ["blast-furnace"]
  });
  const caps2 = calculateFacilityEffectiveCapabilities(upgradedFacility, def);
  assert.ok(caps2.includes("domain-manager:forge"));
  assert.ok(caps2.includes("domain-manager:smelting"));

  // 3. Operational + Blocked readiness -> grants NO capabilities (lifecycle ≠ readiness)
  const blockedFacility = createTestInstance({
    lifecycle: "operational",
    readiness: "blocked",
    readinessReason: "Missing essential blacksmith fuel"
  });
  const capsBlocked = calculateFacilityEffectiveCapabilities(blockedFacility, def);
  assert.deepEqual(capsBlocked, []);

  // 4. Operational + Unavailable readiness -> grants NO capabilities
  const unavailFacility = createTestInstance({
    lifecycle: "operational",
    readiness: "unavailable"
  });
  const capsUnavail = calculateFacilityEffectiveCapabilities(unavailFacility, def);
  assert.deepEqual(capsUnavail, []);

  // 5. UnderConstruction + Ready readiness -> grants NO capabilities (lifecycle is not operational/degraded)
  const constructingFacility = createTestInstance({
    lifecycle: "underConstruction",
    readiness: "ready"
  });
  const capsConstructing = calculateFacilityEffectiveCapabilities(constructingFacility, def);
  assert.deepEqual(capsConstructing, []);

  // 6. Inactive, Disabled, Decommissioned, Destroyed -> grants NO capabilities
  for (const nonOperational of ["inactive", "disabled", "decommissioned", "destroyed"] as FacilityLifecycle[]) {
    const fac = createTestInstance({ lifecycle: nonOperational, readiness: "ready" });
    assert.deepEqual(calculateFacilityEffectiveCapabilities(fac, def), []);
  }

  // 7. Degraded + Limited readiness -> still grants capabilities (partial operationality)
  const degradedFacility = createTestInstance({
    lifecycle: "degraded",
    readiness: "limited"
  });
  assert.deepEqual(calculateFacilityEffectiveCapabilities(degradedFacility, def), ["domain-manager:forge"]);
});

test("G5.6: DomainFacilitiesData persists, validates duplicate IDs, and integrates with DomainRecord", () => {
  const f1 = createTestInstance({ id: "fac-1" });
  const f2 = createTestInstance({ id: "fac-2" });

  const data = {
    schemaVersion: 1 as const,
    facilities: [f1, f2]
  };

  const validData = validateDomainFacilitiesData(data);
  assert.equal(validData.ok, true);

  // Duplicate facility ID
  const dupData = validateDomainFacilitiesData({
    schemaVersion: 1,
    facilities: [f1, f1]
  });
  assert.equal(dupData.ok, false);
  if (!dupData.ok) {
    assert.equal(dupData.error.code, "DM_FACILITY_DUPLICATE_ID");
  }

  // DomainRecord integration
  const domain: DomainRecord = {
    schemaVersion: 1,
    definition: {
      identity: { id: "dom-test-1", name: "Settlement" },
      archetype: "settlement",
      capabilities: {
        enabled: ["domain-manager:core", "domain-manager:domain"],
        configurations: {}
      }
    },
    state: { lifecycle: "active", status: "normal" },
    history: { createdAt: 1000, updatedAt: 1000 }
  } as unknown as DomainRecord;

  // With facilities data
  const updatedDomain = withDomainFacilitiesData(domain, validData.value);
  assert.ok(updatedDomain.definition.capabilities.enabled.includes(FACILITIES_CAPABILITY_ID));

  const retrievedRes = tryGetDomainFacilitiesData(updatedDomain);
  assert.ok(retrievedRes.ok);
  const retrieved = retrievedRes.value;
  assert.ok(retrieved);
  assert.equal(retrieved.facilities.length, 2);
  assert.equal(retrieved.facilities[0].id, "fac-1");
  assert.equal(retrieved.facilities[1].id, "fac-2");

  // Registered in domainCapabilityRegistry
  const capDef = domainCapabilityRegistry.get(FACILITIES_CAPABILITY_ID);
  assert.ok(capDef);
  assert.equal(capDef.functional, true);
});

test("G5-AUD-008: Corrupt facilities data produces PublicError and getDomainFacilitiesData throws", () => {
  const corruptDomain = {
    schemaVersion: 1,
    revision: 1,
    id: "domain-corrupt",
    definition: {
      identity: { name: "Corrupt Domain" },
      capabilities: {
        enabled: [FACILITIES_CAPABILITY_ID],
        config: {
          [FACILITIES_CAPABILITY_ID]: {
            schemaVersion: 99,
            facilities: "invalid_list"
          }
        }
      }
    }
  } as unknown as DomainRecord;

  const tryRes = tryGetDomainFacilitiesData(corruptDomain);
  assert.equal(tryRes.ok, false);
  if (!tryRes.ok) {
    assert.equal(tryRes.error.code, "DM_FACILITY_INVALID_SCHEMA_VERSION");
  }

  assert.throws(
    () => getDomainFacilitiesData(corruptDomain),
    /Domain facilities data corruption/
  );
});
