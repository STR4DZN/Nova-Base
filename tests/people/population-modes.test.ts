import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePopulation,
} from "../../src/people/population/population-calculator.js";
import {
  validatePopulationGroup,
  validatePopulationState,
  type PopulationGroup,
  type PopulationState,
} from "../../src/people/population/population-types.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";

test("G3.1 - Population State: Validation of valid states", () => {
  const validManual = validatePopulationState({
    mode: "manual",
    total: 1500,
    precision: "exact",
  });
  assert.equal(validManual.ok, true);
  if (validManual.ok) {
    assert.equal(validManual.value.mode, "manual");
    assert.equal(validManual.value.total, 1500);
    assert.equal(validManual.value.precision, "exact");
  }

  const validSumGroups = validatePopulationState({
    mode: "sumGroups",
    total: null,
    precision: "unknown",
  });
  assert.equal(validSumGroups.ok, true);

  const validHybrid = validatePopulationState({
    mode: "hybrid",
    total: 50000,
    precision: "estimated",
  });
  assert.equal(validHybrid.ok, true);
});

test("G3.1 - Population State: Null total forces unknown precision", () => {
  const res = validatePopulationState({
    mode: "manual",
    total: null,
    precision: "exact", // Should normalize to unknown
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.total, null);
    assert.equal(res.value.precision, "unknown");
  }
});

test("G3.1 - Population State: Invalid state inputs fail validation", () => {
  assert.equal(validatePopulationState(null).ok, false);
  assert.equal(validatePopulationState("not-an-object").ok, false);

  // Invalid mode
  assert.equal(
    validatePopulationState({ mode: "invalid", total: 100, precision: "exact" }).ok,
    false
  );

  // Invalid precision
  assert.equal(
    validatePopulationState({ mode: "manual", total: 100, precision: "fuzzy" }).ok,
    false
  );

  // Negative number
  assert.equal(
    validatePopulationState({ mode: "manual", total: -1, precision: "exact" }).ok,
    false
  );

  // Non-integer
  assert.equal(
    validatePopulationState({ mode: "manual", total: 12.5, precision: "exact" }).ok,
    false
  );

  // Unsafe integer
  assert.equal(
    validatePopulationState({
      mode: "manual",
      total: Number.MAX_SAFE_INTEGER + 10,
      precision: "exact",
    }).ok,
    false
  );
});

test("G3.1 - Population Calculator: Manual mode returns declared total ignoring groups", () => {
  const state: PopulationState = {
    mode: "manual",
    total: 2500,
    precision: "exact",
  };

  const groups: PopulationGroup[] = [
    {
      id: createOpaqueId("pop"),
      name: "Citizens",
      count: 1000,
      includedInTotal: true,
      tags: ["core"],
    },
    {
      id: createOpaqueId("pop"),
      name: "Guards",
      count: 200,
      includedInTotal: true,
      tags: ["military"],
    },
  ];

  const res = calculatePopulation(state, groups);
  assert.equal(res.total, 2500);
  assert.equal(res.precision, "exact");
  assert.equal(res.warnings.length, 0);
});

test("G3.1 - Population Calculator: sumGroups mode sums included groups", () => {
  const state: PopulationState = {
    mode: "sumGroups",
    total: null,
    precision: "unknown",
  };

  const groups: PopulationGroup[] = [
    {
      id: createOpaqueId("pop"),
      name: "Farmers",
      count: 400,
      includedInTotal: true,
      tags: ["rural"],
    },
    {
      id: createOpaqueId("pop"),
      name: "Miners",
      count: 600,
      includedInTotal: true,
      tags: ["heavy"],
    },
    {
      id: createOpaqueId("pop"),
      name: "Transient Visitors",
      count: 150,
      includedInTotal: false, // Must be excluded from sum
      tags: ["visitors"],
    },
  ];

  const res = calculatePopulation(state, groups);
  assert.equal(res.total, 1000);
  assert.equal(res.precision, "exact");
  assert.equal(res.warnings.length, 0);
});

test("G3.1 - Population Calculator: sumGroups with no groups returns 0 exact", () => {
  const state: PopulationState = {
    mode: "sumGroups",
    total: null,
    precision: "unknown",
  };

  const res = calculatePopulation(state, []);
  assert.equal(res.total, 0);
  assert.equal(res.precision, "exact");
  assert.equal(res.warnings.length, 0);
});

test("G3.1 - Population Calculator: sumGroups propagates unknown / estimated when groups have null count", () => {
  const state: PopulationState = {
    mode: "sumGroups",
    total: null,
    precision: "unknown",
  };

  // Case A: All included groups have null count
  const allNullGroups: PopulationGroup[] = [
    {
      id: createOpaqueId("pop"),
      name: "Uncounted Tribe",
      count: null,
      includedInTotal: true,
      tags: ["wild"],
    },
  ];
  const resAllNull = calculatePopulation(state, allNullGroups);
  assert.equal(resAllNull.total, null);
  assert.equal(resAllNull.precision, "unknown");

  // Case B: Some groups counted, some uncounted
  const mixedGroups: PopulationGroup[] = [
    {
      id: createOpaqueId("pop"),
      name: "Known Garrison",
      count: 300,
      includedInTotal: true,
      tags: ["military"],
    },
    {
      id: createOpaqueId("pop"),
      name: "Unknown Nomads",
      count: null,
      includedInTotal: true,
      tags: ["nomads"],
    },
  ];
  const resMixed = calculatePopulation(state, mixedGroups);
  assert.equal(resMixed.total, 300);
  assert.equal(resMixed.precision, "estimated");
  assert.ok(resMixed.warnings.some((w) => w.includes("DM_POPULATION_PARTIAL_UNKNOWN")));
});

test("G3.1 - Population Calculator: hybrid mode warns when groups exceed total without failing", () => {
  const state: PopulationState = {
    mode: "hybrid",
    total: 1000,
    precision: "estimated",
  };

  const groupsExceeding: PopulationGroup[] = [
    {
      id: createOpaqueId("pop"),
      name: "District 1",
      count: 700,
      includedInTotal: true,
      tags: ["d1"],
    },
    {
      id: createOpaqueId("pop"),
      name: "District 2",
      count: 500,
      includedInTotal: true,
      tags: ["d2"],
    },
  ];

  const res = calculatePopulation(state, groupsExceeding);
  assert.equal(res.total, 1000);
  assert.equal(res.precision, "estimated");
  assert.ok(
    res.warnings.some((w) => w.includes("DM_POPULATION_GROUPS_EXCEED_TOTAL")),
    "Should include warning when groups exceed total in hybrid mode"
  );
});

test("G3.1 - Population Group Validation: Strict field validation and notes character limit", () => {
  const validGroup = validatePopulationGroup({
    id: createOpaqueId("pop"),
    name: "Artisans",
    count: 250,
    includedInTotal: true,
    tags: ["trade", "guild"],
    notes: "Guild of fine crafts",
  });
  assert.equal(validGroup.ok, true);

  // Invalid ID prefix (must be pop_)
  assert.equal(
    validatePopulationGroup({
      id: createOpaqueId("cmd"),
      name: "Artisans",
      count: 250,
      includedInTotal: true,
      tags: [],
    }).ok,
    false
  );

  // Empty name
  assert.equal(
    validatePopulationGroup({
      id: createOpaqueId("pop"),
      name: "   ",
      count: 250,
      includedInTotal: true,
      tags: [],
    }).ok,
    false
  );

  // Negative count
  assert.equal(
    validatePopulationGroup({
      id: createOpaqueId("pop"),
      name: "Guild",
      count: -5,
      includedInTotal: true,
      tags: [],
    }).ok,
    false
  );

  // Notes exceeding 2000 chars
  assert.equal(
    validatePopulationGroup({
      id: createOpaqueId("pop"),
      name: "Guild",
      count: 100,
      includedInTotal: true,
      tags: [],
      notes: "a".repeat(2001),
    }).ok,
    false
  );
});
