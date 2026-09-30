import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("module.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const metadata = await readFile("src/core/versioning/build-metadata.ts", "utf8");
const releaseBase = `${manifest.url}/releases/download/v${manifest.version}/`;
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.version, lock.version);
assert.equal(manifest.version, lock.packages[""].version);
assert.ok(metadata.includes(`moduleVersion: "${manifest.version}"`));
assert.equal(manifest.manifest, `${releaseBase}module.json`);
assert.equal(manifest.download, `${releaseBase}domain-manager-v${manifest.version}.zip`);
await import("./validate-package.mjs");
await import("./validate-artifact.mjs");
console.info(`Release URLs, versions and ZIP verified: v${manifest.version}`);
