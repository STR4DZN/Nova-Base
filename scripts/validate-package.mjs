import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("module.json", "utf8"));
const requiredFiles = ["module.json", "dist/main.js", "dist/main.js.map"];

for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`Missing package file: ${file}`);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

if (manifest.id !== "domain-manager") throw new Error("Invalid module id");
if (manifest.version !== pkg.version) {
  throw new Error(`Manifest version (${manifest.version}) does not match package.json (${pkg.version})`);
}
if (!manifest.esmodules?.includes("dist/main.js")) {
  throw new Error("Manifest does not reference dist/main.js in esmodules");
}
if (manifest.scripts?.includes("dist/main.js")) {
  throw new Error("Manifest must not reference dist/main.js in scripts (ESM bundle requires esmodules)");
}
if (manifest.socket !== true) {
  throw new Error("Manifest must specify socket: true for Foundry v13 module socket routing");
}

const socketlibDep = manifest.relationships?.requires?.find((r) => r.id === "socketlib");
if (!socketlibDep) throw new Error("Manifest must declare socketlib in relationships.requires");
if (socketlibDep.compatibility?.minimum !== "1.1.3") {
  throw new Error(`Socketlib minimum compatibility must be 1.1.3 for Foundry v13, got ${socketlibDep.compatibility?.minimum}`);
}
if (socketlibDep.compatibility?.verified !== "1.1.4") {
  throw new Error(`Socketlib verified compatibility must be 1.1.4, got ${socketlibDep.compatibility?.verified}`);
}

console.info("Package validation passed");
