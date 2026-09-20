import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const testsRoot = join(projectRoot, "tests");
const outputRoot = join(projectRoot, ".test-build");

function findTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(path);
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function findBuiltTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findBuiltTests(path);
    return entry.name.endsWith(".test.js") ? [path] : [];
  });
}

const testFiles = findTestFiles(testsRoot);
if (testFiles.length === 0) throw new Error("No test files found");

const filterArg = process.argv.find((a) => a.includes(".test"));
const targetFiles = filterArg
  ? testFiles.filter((f) => f.includes(filterArg))
  : testFiles;
if (targetFiles.length === 0) throw new Error("No test files found matching: " + filterArg);

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

try {
  await esbuild.build({
    entryPoints: targetFiles,
    bundle: true,
    format: "esm",
    platform: "node",
    outdir: outputRoot,
    entryNames: "[name]"
  });

  const userArgs = process.argv.slice(2).filter((a) => a !== filterArg);
  execFileSync(process.execPath, ["--test", ...userArgs, ...findBuiltTests(outputRoot)], {
    stdio: "inherit"
  });
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}
