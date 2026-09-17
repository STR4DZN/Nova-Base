import assert from "node:assert/strict";
import test from "node:test";
import { createPublicError, isPublicError } from "../../src/core/contracts/public-error.js";
import { err, isErr, isOk, ok } from "../../src/core/contracts/result.js";

const validationError = createPublicError({
  code: "DM_INVALID_INPUT",
  category: "validation",
  message: "Invalid input"
});

test("ok creates a successful Result", () => {
  const result = ok(42);
  assert.equal(result.ok, true);
  assert.equal(isOk(result), true);
  assert.equal(isErr(result), false);
  if (isOk(result)) assert.equal(result.value, 42);
});

test("ok preserves warnings", () => {
  const result = ok("value", [{ code: "DM_WARNING", message: "Review" }]);
  assert.deepEqual(result.warnings, [{ code: "DM_WARNING", message: "Review" }]);
});

test("err creates a failed Result", () => {
  const result = err(validationError);
  assert.equal(result.ok, false);
  assert.equal(isErr(result), true);
  assert.equal(isOk(result), false);
  if (isErr(result)) assert.equal(result.error, validationError);
});

test("PublicError factory freezes the returned error", () => {
  assert.equal(Object.isFrozen(validationError), true);
  assert.equal(isPublicError(validationError), true);
});

test("isPublicError rejects malformed values", () => {
  assert.equal(isPublicError(null), false);
  assert.equal(isPublicError({}), false);
  assert.equal(isPublicError({ code: "ERR", category: "validation", message: "x" }), false);
  assert.equal(isPublicError({ code: "DM_X", category: "totally-invalid", message: "x" }), false);
  assert.equal(isPublicError({ code: "DM_X", category: "validation", message: "x", retryable: "yes" }), false);
});
