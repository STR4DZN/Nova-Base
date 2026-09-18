import { readFile } from "node:fs/promises";
import { readZip } from "./zip-utils.mjs";

const artifact = "dist/domain-manager-gate1-full.zip";
const requiredFiles = [
  "module.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "build.mjs",
  "src/domains/domain-schema.ts",
  "src/storage/repositories/domain-repository.ts",
  "src/storage/adapters/foundry-domain-document-store.ts",
  "src/storage/indexes/domain-index.ts",
  "src/storage/integrity/domain-integrity-checker.ts",
  "src/storage/migrations/domain-migration-seed.ts",
  "tests/core/domain-migration-seed.test.ts",
  "tests/core/foundry-domain-document-store.test.ts",
  "docs/BUILD_STATE.md",
  "docs/G1_AUDIT_FIX_REPORT.md",
  "docs/GATE_G0_ACCEPTANCE_REPORT.md",
  "docs/GATE_G1_ACCEPTANCE_REPORT.md",
  "Documentos/GATES/11_G1_CANONICAL_STORAGE_DOMAIN.md",
  "dist/main.js",
  "dist/main.js.map"
];

const zip = readZip(await readFile(artifact));
const names = [...zip.keys()];
for (const name of requiredFiles) {
  if (!zip.has(name)) throw new Error(`Missing Gate 1 file: ${name}`);
}

const forbidden = names.filter((name) => (
  name.startsWith("node_modules/") ||
  name.endsWith(".zip") ||
  name.startsWith("src/authority/") ||
  name.startsWith("src/commands/") ||
  name.startsWith("src/mutations/")
));
if (forbidden.length > 0) throw new Error(`Unexpected Gate 1 entries: ${forbidden.join(", ")}`);

const manifest = JSON.parse(zip.get("module.json").toString("utf8"));
if (manifest.id !== "domain-manager") throw new Error("Invalid Gate 1 module id");
if (manifest.version !== "0.0.2") throw new Error("Invalid Gate 1 module version");
const entrypoint = manifest.esmodules ?? manifest.scripts;
if (JSON.stringify(entrypoint) !== JSON.stringify(["dist/main.js"])) {
  throw new Error("Invalid Gate 1 module entry point");
}

const fileCount = names.filter((name) => !name.endsWith("/")).length;
console.info(`Gate 1 full package validation passed: ${fileCount} files, ${names.length} entries`);
