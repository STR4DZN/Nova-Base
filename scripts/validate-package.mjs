import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("module.json", "utf8"));
const requiredFiles = ["module.json", "dist/main.js", "dist/main.js.map"];

for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`Missing package file: ${file}`);
}

if (manifest.id !== "domain-manager") throw new Error("Invalid module id");
if (manifest.version !== "0.0.2") throw new Error("Invalid module version");
if (!manifest.scripts?.includes("dist/main.js")) {
  throw new Error("Manifest does not reference dist/main.js");
}
if (manifest.socket !== true) {
  throw new Error("Manifest must specify socket: true for Foundry v13 module socket routing");
}

console.info("Package validation passed");
