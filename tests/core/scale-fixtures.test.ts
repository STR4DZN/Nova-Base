import assert from "node:assert/strict";
import test from "node:test";
import { createScaleFixture } from "../fixtures/scale-fixtures.js";

test("scale fixtures provide deterministic small, medium, and large sizes", () => {
  assert.equal(createScaleFixture("small").length, 1);
  assert.equal(createScaleFixture("medium").length, 10);
  assert.equal(createScaleFixture("large").length, 100);
  assert.deepEqual(createScaleFixture("small"), ["small-1"]);
});
