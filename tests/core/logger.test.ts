import assert from "node:assert/strict";
import test from "node:test";
import { Logger } from "../../src/diagnostics/logger.js";

test("logger returns structured entries with scope-independent context", () => {
  const logger = new Logger("test");
  const entry = logger.info("started", { correlationId: "corr-1" });

  assert.deepEqual(entry, {
    level: "info",
    message: "started",
    context: { correlationId: "corr-1" }
  });
});

test("logger sanitizes context before returning and writing", () => {
  const logger = new Logger("test");
  const original = console.info;
  let emitted: unknown;
  console.info = (_message?: unknown, context?: unknown) => { emitted = context; };
  try {
    const entry = logger.info("safe", { apiKey: "secret-value", visible: "yes" });
    assert.deepEqual(entry.context, { apiKey: "[REDACTED]", visible: "yes" });
    assert.deepEqual(emitted, { apiKey: "[REDACTED]", visible: "yes" });
  } finally {
    console.info = original;
  }
});
