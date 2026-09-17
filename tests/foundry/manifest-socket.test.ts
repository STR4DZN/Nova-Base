import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("Adversarial: module.json manifest must declare socket: true and verified compatibility for Foundry v13", () => {
  const manifestPath = join(process.cwd(), "module.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  assert.equal(
    manifest.socket,
    true,
    "Foundry v13 requires 'socket: true' in module.json for module socket communication to be routed by the server"
  );

  assert.ok(
    manifest.compatibility,
    "module.json must declare compatibility"
  );
  assert.equal(
    manifest.compatibility.verified,
    "13.351",
    "module.json should declare verified compatibility for target release 13.351"
  );
});
