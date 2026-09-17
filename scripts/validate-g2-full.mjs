import { readFile } from "node:fs/promises";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";
import { readZip } from "./zip-utils.mjs";

const root = process.cwd();
const artifact = join(root, "dist", "domain-manager-g2-full-checkpoint.zip");

console.info("[G2 Full Validator] 1. Validating package structure...");
const zipBuffer = await readFile(artifact);
const zip = readZip(zipBuffer);

const requiredFiles = [
  "module.json",
  "package.json",
  "tsconfig.json",
  "build.mjs",
  "ANTIGRAVITY_HANDOFF.md",
  "dist/main.js",
  "src/authority/primary-authority-service.ts",
  "src/commands/command-bus.ts",
  "src/commands/command-envelope.ts",
  "src/commands/command-transport.ts",
  "src/commands/command-registry.ts",
  "src/commands/rate-limiter.ts",
  "src/commands/command-dedupe-store.ts",
  "src/commands/command-queue.ts",
  "src/commands/authenticated-command-context.ts",
  "src/commands/foundry-command-transport-adapter.ts",
  "src/diagnostics/g2-diagnostics-provider.ts",
  "src/mutations/lock-manager.ts",
  "src/mutations/mutation-coordinator.ts",
  "src/mutations/plans/plan-contract.ts",
  "src/mutations/receipt-contract.ts",
  "src/mutations/transaction-record.ts",
  "src/mutations/transaction-store.ts",
  "src/mutations/recovery-service.ts",
  "tests/multiplayer/multiplayer-harness.test.ts",
  "tests/mutations/mutation-coordinator-adversarial.test.ts",
  "tests/commands/foundry-transport-adversarial.test.ts",
  "tests/commands/revalidation-adversarial.test.ts",
  "tests/commands/socketlib-upstream-real.test.ts",
  "tests/commands/foundry-command-transport-socketlib-only.test.ts",
  "tests/docs/build-state-validator.test.ts",
  "docs/history/G2_BUILD_HISTORY.md"
];

for (const path of requiredFiles) {
  if (!zip.has(path)) {
    throw new Error(`[G2 Full Validator] Missing expected file in checkpoint: ${path}`);
  }
}
console.info(`[G2 Full Validator] Package structure verified (${zip.size} entries in ZIP).`);

console.info("[G2 Full Validator] 2. Verifying production bundle reachability (G2-AUD-001 / G2-AUD-022)...");
const bundledMain = zip.get("dist/main.js")?.toString("utf8");
if (!bundledMain) {
  throw new Error("[G2 Full Validator] Missing dist/main.js in checkpoint");
}

const requiredBundleSymbols = [
  "MutationCoordinator",
  "CommandBus",
  "LockManager",
  "RecoveryService",
  "FoundryCommandTransportAdapter",
  "G2DiagnosticsProvider"
];

for (const symbol of requiredBundleSymbols) {
  if (!bundledMain.includes(symbol)) {
    throw new Error(
      `[G2 Full Validator] Bundle reachability check failed: '${symbol}' is not reachable/bundled in dist/main.js!`
    );
  }
}
console.info("[G2 Full Validator] All G2 core components are bundled and reachable in dist/main.js.");

console.info("[G2 Full Validator] 3. Verifying Foundry v13 manifest compliance...");
const moduleJsonContent = zip.get("module.json")?.toString("utf8");
if (!moduleJsonContent) {
  throw new Error("[G2 Full Validator] Missing module.json in checkpoint");
}
const moduleJson = JSON.parse(moduleJsonContent);
if (moduleJson.socket !== true) {
  throw new Error("[G2 Full Validator] module.json must have 'socket: true'");
}
if (moduleJson.compatibility?.verified !== "13.351") {
  throw new Error("[G2 Full Validator] module.json compatibility.verified must be '13.351'");
}
const socketlibDep = moduleJson.relationships?.requires?.find((r) => r.id === "socketlib");
if (!socketlibDep) throw new Error("[G2 Full Validator] module.json must declare socketlib in relationships.requires");
if (socketlibDep.compatibility?.minimum !== "1.1.3") {
  throw new Error(`[G2 Full Validator] Socketlib minimum compatibility must be 1.1.3 for Foundry v13, got ${socketlibDep.compatibility?.minimum}`);
}
if (socketlibDep.compatibility?.verified !== "1.1.4") {
  throw new Error(`[G2 Full Validator] Socketlib verified compatibility must be 1.1.4, got ${socketlibDep.compatibility?.verified}`);
}
console.info("[G2 Full Validator] Manifest compliance verified (socket: true, verified: 13.351, socketlib: 1.1.3/1.1.4).");

console.info("[G2 Full Validator] 4. Executing TypeScript typecheck...");
execSync("npm run typecheck", {
  cwd: root,
  stdio: "inherit"
});
console.info("[G2 Full Validator] Typecheck passed cleanly (0 errors).");

console.info("[G2 Full Validator] 5. Executing full test suite & adversarial gates...");
execFileSync(process.execPath, ["tests/run-tests.mjs"], {
  cwd: root,
  stdio: "inherit"
});
console.info("[G2 Full Validator] All test suites and adversarial gates passed cleanly.");

console.info("\n=======================================================");
console.info("  GATE G2 FULL ACCEPTANCE & INTEGRITY VALIDATION: PASSED");
console.info("=======================================================\n");
