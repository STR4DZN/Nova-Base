import { readFile } from "node:fs/promises";
import { crc32, readZip } from "./zip-utils.mjs";

const artifact = "dist/domain-manager-v0.0.2.zip";
const expected = ["module.json", "dist/main.js", "dist/main.js.map"];
const zip = readZip(await readFile(artifact));
const actual = [...zip.keys()].sort();
if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
  throw new Error(`Unexpected ZIP entries: ${actual.join(", ")}`);
}

for (const name of expected) {
  const bytes = zip.get(name);
  if (!bytes) throw new Error(`Invalid ZIP data: ${name}`);
  const local = await readFile(name);
  if (!bytes.equals(local)) throw new Error(`Artifact differs from local file: ${name}`);
}

const manifest = JSON.parse(zip.get("module.json").toString("utf8"));
if (manifest.scripts?.[0] !== "dist/main.js") throw new Error("Invalid artifact entry point");
if (manifest.version !== "0.0.2") throw new Error("Invalid artifact version");
console.info("Artifact validation passed");
