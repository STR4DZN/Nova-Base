import test from "node:test";
import assert from "node:assert/strict";
import { CommandBus } from "../../src/commands/command-bus.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { CommandQueue } from "../../src/commands/command-queue.js";
import { CommandDedupeStore, canonicalJsonStringify } from "../../src/commands/command-dedupe-store.js";
import { createCommandId } from "../../src/commands/command-envelope.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { ok } from "../../src/core/contracts/result.js";

function fixture(handler: any, concurrency = 10) {
  const registry = new CommandRegistry();
  registry.register({ type: "review:query", visibility: "public", handler });
  const authority = new PrimaryAuthorityService({ getCurrentUserId: () => "gm", getPreferredUserId: () => "gm",
    getUsers: () => [{ id: "gm", isGM: true, active: true }, { id: "player", isGM: false, active: true }] },
    { authorityUserId: "gm", authorityEpoch: 1, initialized: true });
  const bus = new CommandBus({ registry, authorityService: authority, commandQueue: new CommandQueue({ maxConcurrency: concurrency }) });
  const command = () => ({ contractVersion: 1 as const, commandId: createCommandId(), type: "review:query", payload: {}, issuedAtReal: Date.now() });
  return { bus, command, remote: (c: any, user = "player") => bus.dispatchInbound({ rawEnvelope: c,
    transportContext: { senderUserId: user, transportName: "socketlib", receivedAtReal: Date.now() } }) };
}
test("review G2: another sender cannot replay a GM-only query projection", async () => {
  const f = fixture(async (c: any) => ok({ label: c.senderUserId === "gm" ? "hidden-diplomatic-fact" : "public" }));
  try { const c = f.command(); assert.equal((await f.bus.execute(c)).ok, true);
    const r = await f.remote(c); assert.equal(r.ok, true); if (r.ok) assert.equal(r.value.status, "rejected");
    assert.equal(JSON.stringify(r).includes("hidden-diplomatic-fact"), false);
  } finally { f.bus.destroy(); }
});
test("review G2: authenticated status does not disclose another sender's receipt", async () => {
  const f = fixture(async () => ok({ label: "hidden-diplomatic-fact" }));
  try { const c = f.command(); await f.bus.execute(c);
    const r = await (f.bus.queryCommandStatus as any)(c.commandId, "player"); assert.equal(r.ok, false);
    assert.equal(JSON.stringify(r).includes("hidden-diplomatic-fact"), false);
  } finally { f.bus.destroy(); }
});
test("review G2: cancelled queued commands finish dedupe and return on retry", async () => {
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(r => { entered = r; }), hold = new Promise<void>(r => { release = r; });
  let calls = 0;
  const f = fixture(async () => { if (++calls === 1) { entered(); await hold; } return ok({ done: true }); }, 1);
  try {
    const first = f.remote(f.command()); await ready;
    const c = f.command(), second = f.remote(c);
    for (let n = 0; n < 20 && f.bus.getQueueDiagnostics().queuedCount === 0; n++) await new Promise(r => setTimeout(r, 1));
    assert.equal(f.bus.cancelCommand(c.commandId, "player", false).ok, true);
    await second;
    assert.equal(f.bus.getCommandStatus(c.commandId).state, "rejected");
    const retry = await f.remote(c); assert.equal(retry.ok, true); if (retry.ok) assert.equal(retry.value.status, "rejected");
    release(); await first; assert.equal(calls, 1);
  } finally { release(); f.bus.destroy(); }
});
test("review G2: capacity never evicts an unresolved in-flight command", () => {
  const s = new CommandDedupeStore({ maxEntries: 1 });
  const a = createCommandId(); assert.equal(s.claim(a, "a").ok, true);
  assert.equal(s.claim(createCommandId(), "b").ok, false);
  assert.equal(s.has(a), true);
});
test("review G0: canonical fingerprints preserve literal __proto__ data", () => {
  assert.equal(canonicalJsonStringify(JSON.parse('{"__proto__":{"label":"literal"}}')), '{"__proto__":{"label":"literal"}}');
});
