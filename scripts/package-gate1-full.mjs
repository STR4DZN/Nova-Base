import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createZip } from "./zip-utils.mjs";

const root = process.cwd();
const output = join(root, "dist", "domain-manager-gate1-full.zip");
const rootFiles = [
  "module.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "build.mjs"
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
    if (child.isFile()) entries.push({ name, data: await readFile(path) });
  }
}

const entries = [];
for (const file of rootFiles) entries.push({ name: file, data: await readFile(join(root, file)) });
for (const directory of directoryRoots) await collectDirectory(join(root, directory), entries);
for (const file of distFiles) entries.push({ name: file, data: await readFile(join(root, file)) });

entries.sort((left, right) => left.name.localeCompare(right.name));
await stat(join(root, "dist"));
await mkdir(join(root, "dist"), { recursive: true });
await writeFile(output, createZip(entries));
console.info(`Gate 1 full package created: ${output}`);
console.info(`Entries: ${entries.length}`);
