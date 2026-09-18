import assert from "node:assert/strict";
import test from "node:test";
import {
  type ResourceDefinition,
  validateResourceDefinition
} from "../../src/economy/definitions/resource-definition-types.js";
import {
  ResourceDefinitionRegistry,
  createDefaultResourceRegistry
} from "../../src/economy/definitions/resource-registry.js";
import {
  CANONICAL_RESOURCE_TREASURY,
  CANONICAL_RESOURCE_SUPPLIES,
  CANONICAL_RESOURCE_MATERIALS
} from "../../src/economy/definitions/canonical-definitions.js";

test("G4.1: Valid ResourceDefinition passes validation", () => {
  const def: ResourceDefinition = {
    id: "world:crystal-mana",
    version: 1,
    label: "Crystal Mana",
    description: "Refined arcane energy crystals.",
    icon: "fas fa-gem",
    categoryId: "arcane",
    tags: ["magic", "energy"],
    precision: 1,
    displayUnit: {
      singular: "crystal",
      plural: "crystals",
      abbreviation: "xtal"
    },
    minimumMinor: 0,
    maximumMinor: 100000,
    allowNegative: false,
    defaultCapacityPolicy: "block",
    lifecycle: "active"
  };

  const res = validateResourceDefinition(def);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.id, "world:crystal-mana");
    assert.equal(res.value.precision, 1);
    assert.equal(res.value.minimumMinor, 0);
    assert.equal(res.value.maximumMinor, 100000);
    assert.equal(res.value.tags.length, 2);
  }
});

test("G4.1: Non-namespaced ID is rejected with DM_ECON_RESOURCE_INVALID_ID", () => {
  const def = {
    id: "gold", // not namespaced
    version: 1,
    label: "Gold",
    tags: [],
    precision: 2,
    allowNegative: false,
    defaultCapacityPolicy: "block",
    lifecycle: "active"
  };

  const res = validateResourceDefinition(def);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, "DM_ECON_RESOURCE_INVALID_ID");
  }
});

test("G4.1: Precision outside 0..4 or non-integer is rejected with DM_ECON_PRECISION_INVALID", () => {
  const base = {
    id: "world:test",
    version: 1,
    label: "Test",
    tags: [],
    allowNegative: false,
    defaultCapacityPolicy: "block",
    lifecycle: "active"
  };

  const resNegative = validateResourceDefinition({ ...base, precision: -1 });
  assert.equal(resNegative.ok, false);
  assert.equal(resNegative.error.code, "DM_ECON_PRECISION_INVALID");

  const resTooHigh = validateResourceDefinition({ ...base, precision: 5 });
  assert.equal(resTooHigh.ok, false);
  assert.equal(resTooHigh.error.code, "DM_ECON_PRECISION_INVALID");

  const resFloat = validateResourceDefinition({ ...base, precision: 2.5 });
  assert.equal(resFloat.ok, false);
  assert.equal(resFloat.error.code, "DM_ECON_PRECISION_INVALID");
});

test("G4.1: minimumMinor > maximumMinor is rejected", () => {
  const def = {
    id: "world:bound-test",
    version: 1,
    label: "Bound Test",
    tags: [],
    precision: 0,
    minimumMinor: 500,
    maximumMinor: 100, // min > max
    allowNegative: false,
    defaultCapacityPolicy: "block",
    lifecycle: "active"
  };

  const res = validateResourceDefinition(def);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "DM_ECON_RESOURCE_INVALID");
  assert.ok(res.error.message.includes("cannot exceed"));
});

test("G4.1: negative minimumMinor when allowNegative is false is rejected", () => {
  const def = {
    id: "world:negative-test",
    version: 1,
    label: "Negative Test",
    tags: [],
    precision: 0,
    minimumMinor: -10,
    allowNegative: false,
    defaultCapacityPolicy: "block",
    lifecycle: "active"
  };

  const res = validateResourceDefinition(def);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "DM_ECON_RESOURCE_INVALID");
  assert.ok(res.error.message.includes("cannot be negative"));
});

test("G4.1: ResourceDefinitionRegistry registers, detects duplicates, lists with filters, and freezes", () => {
  const registry = new ResourceDefinitionRegistry();

  // Register Treasury
  const reg1 = registry.register(CANONICAL_RESOURCE_TREASURY);
  assert.equal(reg1.ok, true);
  assert.equal(registry.has(CANONICAL_RESOURCE_TREASURY.id), true);
  assert.equal(registry.get(CANONICAL_RESOURCE_TREASURY.id)?.label, "Treasury");

  // Duplicate registration must fail
  const regDup = registry.register(CANONICAL_RESOURCE_TREASURY);
  assert.equal(regDup.ok, false);
  assert.equal(regDup.error.code, "DM_ECON_RESOURCE_ALREADY_EXISTS");

  // Register Supplies
  const reg2 = registry.register(CANONICAL_RESOURCE_SUPPLIES);
  assert.equal(reg2.ok, true);

  // List all
  assert.equal(registry.list().length, 2);

  // Filter by category
  const currencies = registry.list({ categoryId: "currency" });
  assert.equal(currencies.length, 1);
  assert.equal(currencies[0].id, CANONICAL_RESOURCE_TREASURY.id);

  // Filter by tag
  const coreResources = registry.list({ tag: "core" });
  assert.equal(coreResources.length, 2);

  // Freeze registry
  assert.equal(registry.isFrozen(), false);
  registry.freeze();
  assert.equal(registry.isFrozen(), true);

  // New registration on frozen registry must fail
  const regFrozen = registry.register(CANONICAL_RESOURCE_MATERIALS);
  assert.equal(regFrozen.ok, false);
  assert.equal(regFrozen.error.code, "DM_ECON_REGISTRY_FROZEN");
});

test("G4.1: createDefaultResourceRegistry provides Treasury, Supplies, and Materials", () => {
  const defaultReg = createDefaultResourceRegistry();
  assert.equal(defaultReg.has("domain-manager:treasury"), true);
  assert.equal(defaultReg.has("domain-manager:supplies"), true);
  assert.equal(defaultReg.has("domain-manager:materials"), true);
  assert.equal(defaultReg.list().length, 3);
});
