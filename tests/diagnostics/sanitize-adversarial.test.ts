import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDiagnosticsValue } from "../../src/diagnostics/sanitize.js";

test("Adversarial: sanitizeDiagnosticsValue converts BigInt and Symbol so JSON.stringify does not crash", () => {
  const hostileContext = {
    bigNumber: 9007199254740993n,
    symbolField: Symbol("secret_symbol"),
    fnField: () => "secret",
    normalField: "safe",
    nested: {
      innerBig: 42n,
      innerSym: Symbol("inner")
    }
  };

  const sanitized = sanitizeDiagnosticsValue(hostileContext);

  // JSON.stringify must NOT throw TypeError: Do not know how to serialize a BigInt
  assert.doesNotThrow(() => {
    const json = JSON.stringify(sanitized);
    assert.ok(json.includes("9007199254740993"));
  });
});
