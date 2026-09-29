import { readFile, writeFile } from "node:fs/promises";
import { createZip, readZip } from "./zip-utils.mjs";

const sources = [
  ["foundry-v13-g5-full-smoke-test.js", "scripts/foundry-v13-g5-full-smoke-test.js"],
  ["README.md", "docs/g5-smoke-v2-README.md"],
  ["error-report.md", "docs/g5-smoke-error-report.md"]
];
const entries = await Promise.all(sources.map(async ([name, path]) => ({ name, data: await readFile(path) })));
const bytes = createZip(entries);
const archive = readZip(bytes);
for (const entry of entries) {
  if (!archive.get(entry.name)?.equals(entry.data)) throw new Error(`Smoke ZIP mismatch: ${entry.name}`);
}
await writeFile("dist/domain-manager-g5-smoke-v2.zip", bytes);
console.info("Smoke ZIP created and validated: dist/domain-manager-g5-smoke-v2.zip");
