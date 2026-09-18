import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCapacityModifier,
  resolveEffectiveCapacity,
  evaluateCapacity,
  type CapacityModifier
} from "../../src/economy/accounts/capacity-resolver.js";
import {
  validateResourceThreshold,
  detectThresholdCrossings,
  isThresholdActive,
  type ResourceThreshold
} from "../../src/economy/definitions/threshold-types.js";
import type { ResourceDefinition } from "../../src/economy/definitions/resource-definition-types.js";

const mockResourceDef: ResourceDefinition = {
  id: "domain-manager:supplies",
  version: 1,
  label: "Supplies",
  precision: 0,
  allowNegative: false,
  minimumMinor: 0,
  maximumMinor: 5000,
  defaultCapacityPolicy: "block",
  tags: [],
  lifecycle: "active"
};

test("G4.6: validateCapacityModifier validates correctly", () => {
  const valid = validateCapacityModifier({
    id: "granary-1",
    source: "facility:granary",
    label: "Main Granary",
    deltaMinor: 500,
    active: true
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.deltaMinor, 500);
    assert.equal(valid.value.active, true);
  }

  const invalidDelta = validateCapacityModifier({
    id: "granary-1",
    source: "facility:granary",
    label: "Main Granary",
    deltaMinor: 500.5,
    active: true
  });
  assert.equal(invalidDelta.ok, false);
  if (!invalidDelta.ok) {
    assert.equal(invalidDelta.error.code, "DM_ECON_MODIFIER_INVALID");
  }
});

test("G4.6: resolveEffectiveCapacity respects modifiers, broken sources, and hard definition bounds", () => {
  // Unlimited capacity
  const unlimited = resolveEffectiveCapacity(null, []);
  assert.equal(unlimited.effectiveCapacityMinor, null);
  assert.equal(unlimited.hardLimitClamped, false);

  // Modifiers with active and inactive sources (DEC-16824: broken source produces no ghost capacity)
  const mods: CapacityModifier[] = [
    { id: "m1", source: "facility:silo", label: "Silo", deltaMinor: 200, active: true },
    { id: "m2", source: "facility:broken_warehouse", label: "Broken Warehouse", deltaMinor: 1000, active: false },
    { id: "m3", source: "trait:decay", label: "Damage", deltaMinor: -50, active: true }
  ];

  const resolved = resolveEffectiveCapacity(1000, mods, mockResourceDef);
  // 1000 + 200 - 50 = 1150 (broken warehouse ignored)
  assert.equal(resolved.effectiveCapacityMinor, 1150);
  assert.equal(resolved.hardLimitClamped, false);

  // Negative result floors at 0
  const heavyPenalty: CapacityModifier[] = [
    { id: "p1", source: "policy:blockade", label: "Blockade", deltaMinor: -2000, active: true }
  ];
  const floored = resolveEffectiveCapacity(500, heavyPenalty, mockResourceDef);
  assert.equal(floored.effectiveCapacityMinor, 0);

  // Clamped at hard definition maximum (DEC-16741)
  const massiveExpansion: CapacityModifier[] = [
    { id: "mega", source: "facility:mega_vault", label: "Mega Vault", deltaMinor: 10000, active: true }
  ];
  const clamped = resolveEffectiveCapacity(1000, massiveExpansion, mockResourceDef);
  // 1000 + 10000 = 11000 > maximumMinor (5000) -> clamped to 5000
  assert.equal(clamped.effectiveCapacityMinor, 5000);
  assert.equal(clamped.hardLimitClamped, true);
});

test("G4.6: evaluateCapacity enforces block, allow-with-warning, overflow, and absolute definition limits", () => {
  // Within capacity
  const within = evaluateCapacity(800, 1000, "block", mockResourceDef);
  assert.equal(within.allowed, true);
  assert.equal(within.excessMinor, 0);

  // Block policy rejects excess
  const blocked = evaluateCapacity(1200, 1000, "block", mockResourceDef);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.excessMinor, 200);
  assert.equal(blocked.error?.code, "DM_ECON_CAPACITY_EXCEEDED");

  // Allow with warning preserves excess
  const warned = evaluateCapacity(1200, 1000, "allow-with-warning", mockResourceDef);
  assert.equal(warned.allowed, true);
  assert.equal(warned.excessMinor, 200);
  assert.match(warned.warning ?? "", /Capacity exceeded/);

  // Overflow allows and reports excess
  const overflow = evaluateCapacity(1200, 1000, "overflow", mockResourceDef);
  assert.equal(overflow.allowed, true);
  assert.equal(overflow.excessMinor, 200);

  // Negative balance rejected when allowNegative is false
  const negative = evaluateCapacity(-50, 1000, "allow-with-warning", mockResourceDef);
  assert.equal(negative.allowed, false);
  assert.equal(negative.error?.code, "DM_ECON_NEGATIVE_NOT_ALLOWED");

  // Definition absolute maximum is hard even if policy is allow-with-warning (DEC-16739)
  const hardExceeded = evaluateCapacity(6000, null, "allow-with-warning", mockResourceDef);
  assert.equal(hardExceeded.allowed, false);
  assert.equal(hardExceeded.error?.code, "DM_ECON_CAPACITY_EXCEEDED");
});

test("G4.6: ResourceThreshold validation and crossing detector", () => {
  const validThreshold = validateResourceThreshold({
    id: "low-supplies",
    resourceId: "domain-manager:supplies",
    label: "Low Supplies Alert",
    operator: "below",
    valueMinor: 100,
    severity: "warning"
  });
  assert.equal(validThreshold.ok, true);

  if (validThreshold.ok) {
    const t = validThreshold.value;
    assert.equal(isThresholdActive(t, 50), true);
    assert.equal(isThresholdActive(t, 100), false);
    assert.equal(isThresholdActive(t, 150), false);

    // Test crossings
    // 150 -> 50: crossed from inactive to active
    const crossings = detectThresholdCrossings([t], 150, 50, "2026-09-18T12:00:00.000Z");
    assert.equal(crossings.length, 1);
    assert.equal(crossings[0].threshold.id, "low-supplies");
    assert.equal(crossings[0].previousMinor, 150);
    assert.equal(crossings[0].currentMinor, 50);

    // 50 -> 40: already active, not newly crossed
    const noCrossing = detectThresholdCrossings([t], 50, 40, "2026-09-18T12:00:00.000Z");
    assert.equal(noCrossing.length, 0);

    // 40 -> 200: moved out of threshold, not a newly crossed-into event
    const exiting = detectThresholdCrossings([t], 40, 200, "2026-09-18T12:00:00.000Z");
    assert.equal(exiting.length, 0);
  }
});
