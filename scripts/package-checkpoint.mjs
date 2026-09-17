import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createZip } from "./zip-utils.mjs";

const root = process.cwd();
const output = join(root, "dist", "domain-manager-g2-full-checkpoint.zip");

const rootFiles = [
  "module.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "build.mjs",
  "ANTIGRAVITY_HANDOFF.md"
];

const directoryRoots = ["src", "tests", "scripts", "docs", "Documentos"];
const distFiles = ["dist/main.js", "dist/main.js.map"];

function archiveName(path) {
  return relative(root, path).split("\\").join("/");
}

async function collectDirectory(directory, entries) {
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));

  for (const child of children) {
    const path = join(directory, child.name);
    const name = archiveName(path);
    if (child.isDirectory()) {
      entries.push({ name: `${name}/`, data: Buffer.alloc(0) });
      await collectDirectory(path, entries);
      continue;
    }
    if (child.isFile()) {
      // Exclude temporary or zip files
      if (child.name.endsWith(".zip")) continue;
      entries.push({ name, data: await readFile(path) });
    }
  }
}

const entries = [];
for (const file of rootFiles) {
  try {
    entries.push({ name: file, data: await readFile(join(root, file)) });
  } catch (err) {
    console.warn(`Skipping optional/missing root file: ${file}`);
  }
}

for (const directory of directoryRoots) {
  await collectDirectory(join(root, directory), entries);
}

for (const file of distFiles) {
  entries.push({ name: file, data: await readFile(join(root, file)) });
}

entries.sort((left, right) => left.name.localeCompare(right.name));
await mkdir(join(root, "dist"), { recursive: true });

const zipBuffer = createZip(entries);
await writeFile(output, zipBuffer);

const sha256 = createHash("sha256").update(zipBuffer).digest("hex");

console.info(`Checkpoint package created: ${output}`);
console.info(`Total entries: ${entries.length}`);
console.info(`SHA-256: ${sha256}`);
