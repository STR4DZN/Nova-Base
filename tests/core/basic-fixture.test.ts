import assert from "node:assert/strict";
import test from "node:test";
import { createBasicFixture } from "../fixtures/basic-fixture.js";

test("basic fixture preserves an ID and value", () => {
  const fixture = createBasicFixture("fixture-1", { ready: true });

  assert.deepEqual(fixture, { id: "fixture-1", value: { ready: true } });
  assert.equal(Object.isFrozen(fixture), true);
});
