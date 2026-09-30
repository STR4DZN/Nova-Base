import assert from "node:assert/strict";
import test from "node:test";
import { calculatePopulation } from "../../src/people/population/population-calculator.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";
const group = (count: number | null) => ({ id: createOpaqueId("pop"), name: "Group", count, includedInTotal: true, tags: [] });
test("review G3: overflow never becomes an exact or estimated population", () => {
  for (const groups of [[group(Number.MAX_SAFE_INTEGER), group(2)], [group(Number.MAX_SAFE_INTEGER), group(2), group(null)]]) {
    const r = calculatePopulation({ mode: "sumGroups", total: null, precision: "unknown" }, groups);
    assert.equal(r.total, null); assert.equal(r.precision, "unknown");
    assert.equal(r.warnings.filter(x => x.startsWith("DM_POPULATION_SUM_OVERFLOW")).length, 1);
  }
});
test("review G3: hybrid comparison reports the exact oversized subset without changing declared total", () => {
  const r = calculatePopulation({ mode: "hybrid", total: 100, precision: "exact" }, [group(Number.MAX_SAFE_INTEGER), group(2)]);
  assert.equal(r.total, 100); assert.equal(r.precision, "exact");
  assert.ok(r.warnings.some(x => x.includes("9007199254740993")));
});
