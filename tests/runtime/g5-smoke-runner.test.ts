import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { composeDomainManagerRuntime } from "../../src/bootstrap/domain-manager-runtime.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { InMemoryCommandTransport } from "../../src/commands/in-memory-command-transport.js";
import type { IdentifiedJournalEntryDocumentLike } from "../../src/storage/repositories/domain-repository.js";

// Run the actual distributed macro against the composed runtime. Only Foundry
// documents, DOM windows and the host transport are doubles; no public API mock.
test("G5 runner uses current contracts and completes both durable recovery reloads", async () => {
  const docs: any[] = [];
  async function create(input: any) {
    const id = `doc-${docs.length + 1}`;
    const doc = { ...structuredClone(input), id, uuid: `JournalEntry.${id}`,
      async update(changes: Record<string, unknown>) {
        for (const [path, value] of Object.entries(changes)) {
          const parts = path.split("."); let target: any = doc;
          for (const part of parts.slice(0, -1)) target = target[part] ??= {};
          target[parts.at(-1)!] = structuredClone(value);
        }
        return doc;
      }, async delete() { docs.splice(docs.indexOf(doc), 1); }
    };
    docs.push(doc); return doc;
  }
  const journal = { contents: docs, get: (id: string) => docs.find(d => d.id === id) };
  const user = { id: "gm-smoke", isGM: true, active: true };
  const game: any = { journal, user, users: { contents: [user] }, version: "13.351",
    modules: new Map([["socketlib", { active: true }], ["domain-manager", { api: null }]]) };
  const globals = globalThis as any;
  const oldGame = globals.game, oldJournal = globals.JournalEntry;
  globals.game = game; globals.JournalEntry = { create };
  function compose() {
    const service = new PrimaryAuthorityService({ getUsers: () => [user],
      getPreferredUserId: () => null, getCurrentUserId: () => user.id },
      { authorityUserId: user.id, authorityEpoch: 1, initialized: true });
    return composeDomainManagerRuntime({
      domainStore: { get: journal.get, list: () => docs as IdentifiedJournalEntryDocumentLike[], create },
      authority: { service, reconcile: async () => service.resolve(),
        synchronizePersistedState: state => service.synchronizeState(state as never) },
      transport: new InMemoryCommandTransport({ currentUserId: user.id, getAuthorityUserId: () => user.id })
    });
  }
  class HostWindow {
    rendered = false; modal = false;
    controller = { openStartModal: () => { this.modal = true; }, openCreateModal: () => { this.modal = true; } };
    element = { querySelector: () => ({}), querySelectorAll: () => this.modal ? [{}] : [] };
    async render() { this.rendered = true; } async close() { this.rendered = false; }
  }
  const script = (await readFile("scripts/foundry-v13-g5-full-smoke-test.js", "utf8"))
    .replace('await import("/modules/domain-manager/dist/main.js")', "BUNDLE");
  let rt = compose();
  const reports: any[] = [];
  try {
    for (let phase = 0; phase < 3; phase++) {
      if (phase) { rt.destroy(); rt = compose(); }
      await rt.initialize(); await rt.handleAuthorityTransition();
      // VM object prototypes differ from the runtime realm. Normalize only the
      // boundary arguments so strict JSON-safe validation sees host objects.
      const bridge = (value: any): any => new Proxy({}, { get(_target, key) {
        const target = value, item = target[key];
        return typeof item === "function" ? (...args: any[]) => item.apply(target, structuredClone(args))
          : item && typeof item === "object" ? bridge(item) : item;
      } });
      game.modules.get("domain-manager").api = bridge(rt.publicApi);
      const context = vm.createContext({ game, JournalEntry: { create }, crypto: webcrypto,
        BUNDLE: { ProjectsApplication: HostWindow, FacilitiesApplication: HostWindow, DowntimeApplication: HostWindow },
        console: { log() {}, warn() {}, error() {}, table() {} }, ui: { notifications: { info() {}, error() {} } } });
      await vm.runInContext(script, context);
      const report = context.DM_G5_SMOKE_REPORT;
      reports.push(report);
      assert.equal(report.fail, 0, JSON.stringify(report.rows.filter((r: any) => r.status === "FAIL")));
      assert.equal(report.phase, ["await-fence", "await-recovery", "player-ready"][phase]);
    }
    assert.ok(reports[0].pass > 50);
    assert.ok(reports[1].rows.some((r: any) => r.name === "Fence bloqueia escopo afetado" && r.status === "PASS"));
    assert.ok(reports[2].rows.some((r: any) => r.name === "Executing workforce recuperado" && r.status === "PASS"));
  } finally { rt.destroy(); globals.game = oldGame; globals.JournalEntry = oldJournal; }
});
