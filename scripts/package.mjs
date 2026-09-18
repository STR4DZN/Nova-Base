import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createZip } from "./zip-utils.mjs";

const manifest = JSON.parse(await readFile("module.json", "utf8"));
const version = manifest.version;

const files = [
  ["module.json", "module.json"],
  ["dist/main.js", "dist/main.js"],
  ["dist/main.js.map", "dist/main.js.map"]
];

const entries = [];
for (const [name, path] of files) entries.push({ name, data: await readFile(path) });
await mkdir("dist", { recursive: true });
const zipName = `dist/domain-manager-v${version}.zip`;
await writeFile(zipName, createZip(entries));
console.info(`Package created: ${zipName}`);
