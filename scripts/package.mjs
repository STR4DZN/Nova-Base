import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createZip } from "./zip-utils.mjs";

const files = [
  ["module.json", "module.json"],
  ["dist/main.js", "dist/main.js"],
  ["dist/main.js.map", "dist/main.js.map"]
];

const entries = [];
for (const [name, path] of files) entries.push({ name, data: await readFile(path) });
await mkdir("dist", { recursive: true });
await writeFile("dist/domain-manager-v0.0.2.zip", createZip(entries));
console.info("Package created: dist/domain-manager-v0.0.2.zip");
