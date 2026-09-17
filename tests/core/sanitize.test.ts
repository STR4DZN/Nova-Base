import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDiagnosticsValue } from "../../src/diagnostics/sanitize.js";

test("sanitizer redacts sensitive nested fields", () => {
  const result = sanitizeDiagnosticsValue({
    moduleVersion: "0.0.1",
    credentials: {
      apiKey: "hidden",
      nested: [{ token: "hidden" }]
    },
    safe: "visible"
  });

  assert.deepEqual(result, {
    moduleVersion: "0.0.1",
    credentials: "[REDACTED]",
    safe: "visible"
  });
});

test("sanitizer preserves primitive values and arrays", () => {
  assert.equal(sanitizeDiagnosticsValue("safe"), "safe");
  assert.deepEqual(sanitizeDiagnosticsValue(["safe", { password: "hidden" }]), [
    "safe",
    { password: "[REDACTED]" }
]);
});

test("sanitizer represents circular references safely", () => {
  const value: { name: string; self?: unknown } = { name: "cycle" };
  value.self = value;
  assert.deepEqual(sanitizeDiagnosticsValue(value), {
    name: "cycle",
    self: "[Circular]"
  });
});

test("sanitizer serializes Date and Error instances meaningfully", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");
  assert.equal(sanitizeDiagnosticsValue(now), "2026-09-17T12:00:00.000Z");

  const err = new Error("Something broke");
  const sanitizedErr = sanitizeDiagnosticsValue(err) as { name: string; message: string };
  assert.equal(sanitizedErr.name, "Error");
  assert.equal(sanitizedErr.message, "Something broke");
});
