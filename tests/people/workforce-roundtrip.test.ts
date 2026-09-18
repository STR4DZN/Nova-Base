import test from "node:test";
import assert from "node:assert/strict";
import { validatePopulationGroup, type PopulationGroup } from "../../src/people/population/population-types.js";
import { calculateWorkforce } from "../../src/people/workforce/workforce-calculator.js";
import type { DomainPeopleData } from "../../src/people/people-data.js";

import { createOpaqueId } from "../../src/core/identity/ids.js";

test("G3 Workforce Roundtrip: PopulationGroup workforceContributions persistence, validation, and workforce calculation", () => {
  // 1. Validation of valid workforceContributions
  const validGroupInput = {
    id: createOpaqueId("pop"),
    name: "Quarry Guild",
    count: 50,
    precision: "exact" as const,
    includedInTotal: true,
    visibility: "public" as const,
    workforceContributions: [
      { workforceTypeId: "laborers", amount: 30 },
      { workforceTypeId: "masons", amount: 10 }
    ],
    tags: ["industry", "stone"],
    notes: "Primary quarry workers"
  };

  const validationResult = validatePopulationGroup(validGroupInput);
  assert.equal(validationResult.ok, true, "Valid group with workforceContributions must pass validation");
  const validatedGroup = validationResult.value;

  assert.equal(validatedGroup.workforceContributions?.length, 2);
  assert.equal(validatedGroup.workforceContributions?.[0].workforceTypeId, "laborers");
  assert.equal(validatedGroup.workforceContributions?.[0].amount, 30);
  assert.equal(validatedGroup.workforceContributions?.[1].workforceTypeId, "masons");
  assert.equal(validatedGroup.workforceContributions?.[1].amount, 10);

  // 2. Serialization and deserialization roundtrip
  const serialized = JSON.stringify(validatedGroup);
  const deserialized = JSON.parse(serialized);
  const roundtripValidation = validatePopulationGroup(deserialized);
  assert.equal(roundtripValidation.ok, true, "Deserialized group must pass validation without loss");
  assert.deepEqual(roundtripValidation.value, validatedGroup, "Roundtrip group must match original exactly");

  // 3. calculateWorkforce calculates capacity from PopulationGroup contributions
  const peopleData: DomainPeopleData = {
    population: { mode: "manual", total: 100, precision: "exact" },
    populationGroups: [roundtripValidation.value],
    notables: [],
    roles: [],
    operationalGroups: [],
    assignments: [],
    reservations: []
  };

  const report = calculateWorkforce(peopleData);
  assert.equal(report.totalCapacity, 40, "Total capacity should equal 30 laborers + 10 masons = 40");
  assert.ok(report.types["laborers"], "Laborers type must exist in report");
  assert.equal(report.types["laborers"].capacity, 30);
  assert.equal(report.types["masons"].capacity, 10);

  // Check provenance
  const laborerContributions = report.types["laborers"].contributions;
  assert.equal(laborerContributions.length, 1);
  assert.equal(laborerContributions[0].sourceType, "population-group");
  assert.equal(laborerContributions[0].sourceId, validGroupInput.id);
  assert.equal(laborerContributions[0].sourceName, "Quarry Guild");
  assert.equal(laborerContributions[0].amount, 30);

  // 4. Validation rejects invalid contributions
  const invalidContributions = [
    { workforceTypeId: "", amount: 10 },
    { workforceTypeId: "laborers", amount: -5 },
    { workforceTypeId: "laborers", amount: 2.5 },
    { workforceTypeId: "laborers", amount: "ten" as any }
  ];

  for (const badC of invalidContributions) {
    const badGroup = {
      ...validGroupInput,
      workforceContributions: [badC]
    };
    const badRes = validatePopulationGroup(badGroup);
    assert.equal(badRes.ok, false, `Invalid contribution ${JSON.stringify(badC)} must be rejected`);
  }
});
