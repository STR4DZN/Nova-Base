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

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

try {
  await esbuild.build({
    entryPoints: testFiles,
    bundle: true,
    format: "esm",
    platform: "node",
    outdir: outputRoot,
    entryNames: "[name]"
  });

  execFileSync(process.execPath, ["--test", ...findBuiltTests(outputRoot)], {
    stdio: "inherit"
  });
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}
