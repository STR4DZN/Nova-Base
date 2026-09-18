import assert from "node:assert/strict";
import test from "node:test";
import { createDiagnosticsSnapshot } from "../../src/diagnostics/diagnostics-snapshot.js";

test("diagnostics snapshot exposes only safe bootstrap metadata", () => {
  const snapshot = createDiagnosticsSnapshot();

  assert.deepEqual(snapshot, {
    moduleVersion: "0.0.3",
    buildChannel: "dev",
    target: "foundry-vtt",
    diagnosticScope: "bootstrap"
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal("secret" in snapshot, false);
});
