import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { composeDomainManagerRuntime } from "../../src/bootstrap/domain-manager-runtime.js";
import { FoundryDiplomacyStorageAdapter } from "../../src/diplomacy/diplomacy-store.js";
import { FoundryJournalTransactionStorageAdapter } from "../../src/mutations/transaction-storage-adapter.js";
import { InMemoryLedgerStorageAdapter } from "../../src/economy/storage/ledger-storage-adapter.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { InMemoryCommandTransport, InMemoryTransportHub } from "../../src/commands/in-memory-command-transport.js";

// Execute the delivered script itself against the composed production owners.
// Browser rendering/permissions are doubles; this is not real Foundry evidence.
test("G6 Foundry runner: GM, Player, recovery reload and failover phases use real semantic owners", async () => {
  const source = readFileSync("scripts/g6-foundry-smoke.js", "utf8"), docs: any[] = [];
  const users = [{ id: "gm", isGM: true, active: true }, { id: "gm2", isGM: true, active: true }, { id: "player", isGM: false, active: true }];
  let primary = "gm", epoch = 1;
  const journal = { contents: docs, get: (id: string) => docs.find(d => d.id === id) };
  const create = async (data: any) => {
    const id = data._id ?? webcrypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const doc: any = { ...structuredClone(data), id, uuid: `JournalEntry.${id}`,
      testUserPermission: (user: any, level: number) => user.isGM || (doc.ownership?.[user.id] ?? doc.ownership?.default ?? 0) >= level,
      update: async (patch: any) => { for (const [key, value] of Object.entries(patch)) {
        if (key.startsWith("flags.")) doc.flags[key.slice(6)] = structuredClone(value); else doc[key] = structuredClone(value);
      } return doc; }, delete: async () => { docs.splice(docs.indexOf(doc), 1); } };
    docs.push(doc); return doc;
  };
  const gameBase: any = { users: { contents: users, get: (id: string) => users.find(u => u.id === id) }, journal,
    settings: { get: () => JSON.stringify({ authorityUserId: primary, authorityEpoch: epoch, initialized: true }) }, time: { worldTime: 10 } };
  const previousGame = (globalThis as any).game; (globalThis as any).game = gameBase;
  const hub = new InMemoryTransportHub(), ledger = new InMemoryLedgerStorageAdapter();
  const live: ReturnType<typeof composeDomainManagerRuntime>[] = [];
  const make = (userId: string) => {
    const r = composeDomainManagerRuntime({ domainStore: { get: journal.get, list: () => docs, create } as any,
      authority: { service: new PrimaryAuthorityService({ getUsers: () => users, getCurrentUserId: () => userId,
        getPreferredUserId: () => primary }, { authorityUserId: primary, authorityEpoch: epoch, initialized: true }) } as any,
      transport: new InMemoryCommandTransport({ currentUserId: userId, getAuthorityUserId: () => primary }, hub),
      diplomacyStorageAdapter: new FoundryDiplomacyStorageAdapter({ journal, create }),
      transactionStorageAdapter: new FoundryJournalTransactionStorageAdapter({ journal, createJournalEntry: create }),
      ledgerStorageAdapter: ledger, worldTick: () => 10 });
    live.push(r); return r;
  };
  const browserStorage = new Map<string, string>();
  const context = (r: ReturnType<typeof make>, userId: string, exposePrivate = false) => {
    // Public facade is real. DOM-only app is a controlled browser double.
    const bridge = (value: any): any => {
      if (!value || typeof value !== "object") return value;
      const keys = new Set(Object.keys(value));
      for (let p = Object.getPrototypeOf(value); p && p !== Object.prototype; p = Object.getPrototypeOf(p))
        for (const key of Object.getOwnPropertyNames(p)) if (key !== "constructor") keys.add(key);
      return Object.freeze(Object.fromEntries([...keys].map(k => [k, typeof value[k] === "function"
        ? (...args: any[]) => value[k](...args.map(x => structuredClone(x))) : bridge(value[k])])));
    };
    const diplomacy = Object.freeze({ ...bridge(r.publicApi.diplomacy), open: async () => ({ rendered: true,
      controller: { detail: null as any, selectTab() {}, select(id: string) { this.detail = { id }; }, load: async () => ({ ok: true, value: {} }) },
      element: { querySelector: () => ({}) }, async render() {}, async close() { this.rendered = false; } }) });
    return createContext({ game: { ...gameBase, user: users.find(u => u.id === userId), version: "test-double", world: { id: "runner-test" },
      journal: { get: journal.get, get contents() { return userId === "player" && !exposePrivate ? docs.filter(d => !d.flags["domain-manager-diplomacy"] && !d.flags["domain-manager-transactions"]) : docs; } },
      modules: { get: () => ({ api: { ...bridge(r.publicApi), diplomacy } }) } }, JournalEntry: { create }, crypto: webcrypto,
      console: { table() {}, info() {}, warn() {} }, CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 } },
      localStorage: { getItem: (key: string) => browserStorage.get(key) ?? null, setItem: (key: string, value: string) => browserStorage.set(key, value) },
      Date, JSON, Blob, URL, setTimeout, document: { createElement: () => ({ click() {} }) } });
  };
  const run = async (ctx: any, phase?: string) => {
    const report: any = structuredClone(await runInContext(source, ctx));
    assert.deepEqual(report.rows.filter((row: any) => row.status === "FAIL"), [], JSON.stringify(report.rows));
    if (phase) assert.equal(report.phase, phase); return report;
  };
  try {
    const gm = make("gm"), player = make("player"); await gm.initialize(); await player.initialize();
    const gmPage = context(gm, "gm"), playerPage = context(player, "player");
    await run(gmPage, "await-player"); await run(playerPage, "await-player"); await run(gmPage, "await-reload");
    const samePage: any = await runInContext(source, gmPage);
    assert.ok(samePage.rows.some((r: any) => r.status === "FAIL" && r.detalhe.includes("F5 real")));
    gm.destroy(); player.destroy();
    const reload = make("gm"); await reload.initialize(); await reload.handleAuthorityTransition();
    await run(context(reload, "gm"), "await-failover");
    await run(context(reload, "gm"), "await-failover"); // no fabricated failover PASS
    reload.destroy(); primary = "gm2"; epoch++;
    const gm2 = make("gm2"), player2 = make("player"); await gm2.initialize(); await gm2.handleAuthorityTransition(); await player2.initialize();
    await run(context(gm2, "gm2"), "completed"); await run(context(player2, "player"), "completed");
    const leaked: any = await runInContext(source, context(player2, "player", true));
    assert.ok(leaked.rows.some((r: any) => r.status === "FAIL" && r.teste.includes("payload")), "Runner must reject replicated canonical flags");
    assert.equal(leaked.rows.some((r: any) => r.teste.includes("propostas duráveis")), false, "Leak blocks dependent phase");
  } finally { for (const r of live) r.destroy(); (globalThis as any).game = previousGame; }
});
