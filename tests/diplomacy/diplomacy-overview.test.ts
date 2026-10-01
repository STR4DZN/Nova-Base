import test from "node:test";
import assert from "node:assert/strict";
import { ok, type Result } from "../../src/core/contracts/result.js";
import { buildDiplomacyOverview, validateDiplomacyOverviewQuery, OVERVIEW_FILTERS, type DiplomacyOverviewFact } from "../../src/diplomacy/diplomacy-overview.js";
import { renderDiplomacyOverview } from "../../src/ui/domain-patterns/diplomacy/diplomacy-overview-view.js";
import { DiplomacyApplicationController, DiplomacyApplication } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const now = 100_000_000;
const fact = (patch: Partial<DiplomacyOverviewFact> = {}): DiplomacyOverviewFact => ({ kind: "agreement", id: "A", label: "Treaty", revision: 1, lifecycle: "active", ...patch });
const overview = (rows = [fact()], query = {}, isGm = true, tick = 10) => unwrap(buildDiplomacyOverview(rows, query, isGm, tick, now));
function controller(result: Result<any> = ok(overview([fact({ expiresAtWorldTick: 15 })]))) {
  const calls: any[] = [], api: any = {};
  for (const kind of ["overview", "relations", "reputation", "agreements", "territory", "disputes", "proposals"]) api[kind] = { query: async (q: any) => {
    calls.push({ kind, q }); return result; } };
  const c = new DiplomacyApplicationController(api); c.selectTab("overview"); return { c, calls };
}
test("G6 overview: strict filters, bounded pagination and explicit window schemas", () => {
  for (const filter of OVERVIEW_FILTERS) assert.ok(validateDiplomacyOverviewQuery({ filter, offset: 0, limit: 100, search: "", expiryHorizonTicks: 0, recentHours: 720 }).ok);
  for (const q of [null, [], { id: "A" }, { isGm: true }, { filter: "secret" }, { offset: -1 }, { limit: 0 }, { limit: 101 }, { limit: 1.1 },
    { search: "s".repeat(201) }, { expiryHorizonTicks: -1 }, { expiryHorizonTicks: 1_000_001 }, { recentHours: 0 }, { recentHours: 721 }, { historyOffset: 0 }])
    assert.equal(validateDiplomacyOverviewQuery(q).ok, false);
});
test("G6 overview: explicit independent clocks reject invalid inputs", () => {
  assert.equal(buildDiplomacyOverview([], {}, true, -1, now).ok, false); assert.equal(buildDiplomacyOverview([], {}, true, 10, NaN).ok, false);
  const d = overview([fact({ expiresAtWorldTick: 20, updatedAt: now - 1 })]); assert.equal(d.worldTick, 10); assert.equal(d.asOfReal, now);
  assert.deepEqual(d.items[0].reasons, ["expiring", "recent"]);
});
test("G6 overview: deadline horizon is inclusive, zero-aware and exact at MAX_SAFE_INTEGER", () => {
  const d = overview([fact({ expiresAtWorldTick: 0 }), fact({ id: "B", expiresAtWorldTick: 10 }), fact({ id: "C", expiresAtWorldTick: 20 }), fact({ id: "D", expiresAtWorldTick: 21 }), fact({ id: "E", expiresAtWorldTick: null })]);
  assert.equal(d.summary.expiring, 3); assert.equal(d.items[0].reasons[0], "expiry-due");
  assert.equal(overview([fact({ expiresAtWorldTick: 0 })], { expiryHorizonTicks: 0 }, true, 0).summary.expiring, 1);
  assert.equal(overview([fact({ expiresAtWorldTick: Number.MAX_SAFE_INTEGER })], {}, true, Number.MAX_SAFE_INTEGER - 1).summary.expiring, 1);
});
test("G6 overview: suspended and ended agreements have no derived expiry or overdue alerts", () => {
  const d = overview(["draft", "proposed", "pendingApproval", "suspended", "expired", "terminated"].map(lifecycle => fact({ id: lifecycle, lifecycle, overdue: true, expiresAtWorldTick: 0 })));
  assert.equal(d.total, 0); assert.equal(d.summary.records.agreement, 6); assert.equal(d.summary.expiring, 0); assert.equal(d.summary.overdue, 0);
});
test("G6 overview: overlapping reasons count entities once per card and once in attention", () => {
  const d = overview([fact({ lifecycle: "breached", confirmedBreach: true, overdue: true, expiresAtWorldTick: 15, updatedAt: now })]);
  assert.equal(d.summary.attention, 1); assert.equal(d.summary.breaches, 1); assert.equal(d.summary.overdue, 1); assert.equal(d.summary.expiring, 1); assert.equal(d.summary.changes, 1);
  assert.equal(d.items.length, 1); assert.equal(d.items[0].reasons.length, 4);
});
test("G6 overview: only open disputes and pending proposals contribute to pending cards", () => {
  const rows = ["latent", "active", "escalated", "frozen", "settled", "abandoned", "superseded"].map(lifecycle => fact({ kind: "dispute", id: lifecycle, lifecycle }));
  rows.push(...["pending", "approved", "rejected"].map(lifecycle => fact({ kind: "proposal", id: lifecycle, lifecycle })));
  const d = overview(rows); assert.equal(d.summary.disputes, 4); assert.equal(d.summary.proposals, 1); assert.equal(d.summary.attention, 5);
});
test("G6 overview: recent GM changes span all six owners with inclusive real-time bounds", () => {
  const kinds = ["relation", "reputation", "agreement", "territory", "dispute", "proposal"] as const;
  const d = overview(kinds.map(kind => fact({ kind, id: kind, lifecycle: "settled", updatedAt: now - 3_600_000 })), { filter: "changes", recentHours: 1 });
  assert.equal(d.summary.changes, 6); assert.equal(d.summary.attention, 0); assert.equal(d.total, 6);
  assert.equal(overview([fact({ updatedAt: 0 }), fact({ id: "old", updatedAt: now - 86_400_001 }), fact({ id: "future", updatedAt: now + 1 })]).total, 0);
});
test("G6 overview: Player recent audit is unavailable, never a hidden change count or timestamp", () => {
  const d = overview([fact({ updatedAt: now, expiresAtWorldTick: 15 })], {}, false);
  assert.equal(d.summary.changes, null); assert.deepEqual(d.items[0].reasons, ["expiring"]); assert.equal(Object.hasOwn(d.items[0], "changedAtReal"), false);
  assert.equal(overview([fact({ updatedAt: now })], { filter: "changes" }, false).total, 0);
});
test("G6 overview: search precedes card counts while category and page do not", () => {
  const rows = [fact({ expiresAtWorldTick: 15 }), fact({ id: "B", label: "Treaty two", lifecycle: "breached" }), fact({ id: "C", label: "Other", lifecycle: "breached" })];
  const d = overview(rows, { search: "tReAtY", filter: "breaches", offset: 100, limit: 1 });
  assert.equal(d.total, 1); assert.equal(d.items.length, 0); assert.equal(d.summary.breaches, 1); assert.equal(d.summary.expiring, 1); assert.equal(d.summary.records.agreement, 2);
});
test("G6 overview: priority, recent time and owner/id tuple produce deterministic independent pages", () => {
  const rows = Array.from({ length: 65 }, (_, i) => fact({ id: String(i).padStart(2, "0"), expiresAtWorldTick: 15 }));
  const a = overview(rows), b = overview([...rows].reverse(), { offset: 30 }), c = overview(rows, { offset: 60 });
  assert.equal(a.items.length, 30); assert.equal(b.items[0].id, "30"); assert.equal(c.items.length, 5); assert.equal(c.total, 65); assert.deepEqual(a.summary, c.summary);
  const ranked = overview([fact({ id: "recent", updatedAt: now }), fact({ id: "expiry", expiresAtWorldTick: 15 }), fact({ id: "breach", lifecycle: "breached" })]);
  assert.deepEqual(ranked.items.map(r => r.id), ["breach", "expiry", "recent"]);
});
test("G6 overview: detached immutable DTO and read-only derivation preserve all input state", () => {
  const rows = [fact({ updatedAt: now, expiresAtWorldTick: 15 })], query = { search: "Treaty" }, before = structuredClone(rows), d = overview(rows, query);
  assert.deepEqual(rows, before); assert.ok(Object.isFrozen(d)); assert.ok(Object.isFrozen(d.items[0])); assert.ok(Object.isFrozen(d.summary.records));
  assert.deepEqual(Object.keys(d.items[0]).sort(), ["changedAtReal", "expiresAtWorldTick", "id", "kind", "label", "lifecycle", "reasons", "revision"]);
});
test("G6 overview: renderer escapes identities, distinguishes unavailable and explains counters/clocks", () => {
  const d = overview([fact({ id: '\" onclick=\"bad', label: "<script>secret</script>", lifecycle: "<b>active</b>", confirmedBreach: true, expiresAtWorldTick: 15 })]);
  const h = renderDiplomacyOverview(d, "all", 10, 24); assert.equal(h.includes("<script>"), false); assert.equal(h.includes("<b>active"), false); assert.ok(h.includes("&quot;"));
  assert.ok(h.includes("antes do filtro")); assert.ok(h.includes("ticks do mundo")); assert.ok(h.includes("não confirma uma quebra"));
  const unavailable = renderDiplomacyOverview(null, "all", 10, 24); assert.ok(unavailable.includes("Resumo indisponível")); assert.equal(unavailable.includes("<strong>0"), false);
});
test("G6 overview: empty data, Player note and page totals are truthful", () => {
  const h = renderDiplomacyOverview(overview([], {}, false), "all", 10, 24); assert.ok(h.includes("Exclusivo do GM")); assert.ok(h.includes("somente as enviadas por você")); assert.ok(h.includes("Nenhum destaque visível"));
  assert.ok(h.includes('data-dm-page="1" disabled')); assert.ok(h.includes('data-dm-overview-filter="changes" aria-pressed="false" disabled'));
  const d = overview(Array.from({ length: 30 }, (_, i) => fact({ id: String(i), lifecycle: "breached" })));
  assert.ok(renderDiplomacyOverview(d, "all", 10, 24).includes('data-dm-page="1" disabled'));
});
test("G6 overview: controller scopes windows to overview and resets page on filter and tab changes", async () => {
  const { c, calls } = controller(); c.offset = 60; unwrap(c.applyOverviewFilter("expiring", 0, 2)); assert.equal(c.offset, 0); c.setSearch("Treaty"); unwrap(await c.load());
  assert.deepEqual(calls[0], { kind: "overview", q: { offset: 0, limit: 30, search: "Treaty", filter: "expiring", expiryHorizonTicks: 0, recentHours: 2 } });
  assert.equal(c.detail, null); c.selectTab("agreements"); unwrap(await c.load()); assert.equal(c.overviewFilter, "all"); assert.equal(c.expiryHorizonTicks, 10); assert.equal(Object.hasOwn(calls[1].q, "filter"), false);
});
test("G6 overview: invalid filter keeps prior values and failed read removes stale cards", async () => {
  const { c } = controller({ ok: false, error: { code: "FAIL", message: "Unavailable", severity: "error" } } as any);
  c.offset = 30; assert.equal(c.applyOverviewFilter("wrong").ok, false); assert.equal(c.offset, 30); assert.equal(c.overviewFilter, "all");
  c.list = overview([fact({ label: "Stale private marker", lifecycle: "breached" })]); assert.equal((await c.load()).ok, false); assert.equal(c.list, null); assert.ok(c.render().includes("Resumo indisponível")); assert.equal(c.render().includes("Stale private marker"), false);
});
test("G6 overview: safe drilldown uses existing owner detail, clears old search/tree and denies creation", async () => {
  const { c, calls } = controller(); unwrap(await c.load()); c.treeAxis = "locatedInUuid"; c.treeParent = "JournalEntry.private"; c.setSearch("Treaty");
  assert.equal(c.openOverviewItem("territory", "A").ok, false); assert.equal(c.tab, "overview"); assert.equal((await c.create({})).ok, false);
  unwrap(c.openOverviewItem("agreements", "A")); assert.equal(c.search, ""); assert.equal(c.treeAxis, null); assert.equal(c.selectedId, "A"); unwrap(await c.load());
  assert.equal(calls.at(-1).kind, "agreements"); assert.equal(calls.at(-1).q.id, "A"); assert.equal(Object.hasOwn(calls.at(-1).q, "filter"), false);
});
test("G6 overview: application routes category clicks, form windows, paging and owner drilldown", async () => {
  const { c } = controller(), app = new DiplomacyApplication({ api: c.api }), listeners: Record<string, Function> = {}, saved = globalThis.FormData;
  app.controller.selectTab("overview"); let renders = 0; (app as any).element = { addEventListener: (e: string, fn: Function) => listeners[e] = fn }; (app as any).render = async () => { renders++; };
  (globalThis as any).FormData = class { constructor(readonly form: any) {} forEach(fn: Function) { Object.entries(this.form.values).forEach(([k, v]) => fn(v, k)); } };
  try { app._onRender(); const click = (dataset: any) => listeners.click({ target: { closest: () => ({ dataset }) } });
    await click({ dmOverviewFilter: "breaches" }); assert.equal(app.controller.overviewFilter, "breaches");
    await listeners.submit({ target: { dataset: { dmForm: "overview-filter" }, values: { filter: "expiring", expiryHorizonTicks: "0", recentHours: "1" } }, preventDefault() {} });
    assert.equal(app.controller.expiryHorizonTicks, 0); await click({ dmPage: "1" }); assert.equal(app.controller.offset, 30);
    await app.controller.load(); await click({ dmOverviewTab: "agreements", dmOverviewId: "A" }); assert.equal(app.controller.tab, "agreements"); assert.equal(renders, 4);
  } finally { globalThis.FormData = saved; }
});
