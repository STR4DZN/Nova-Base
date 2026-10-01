import test from "node:test";
import assert from "node:assert/strict";
import { ok, type Result } from "../../src/core/contracts/result.js";
import { AGREEMENT_LIFECYCLES, type AgreementLifecycle } from "../../src/agreements/agreement-model.js";
import { summarizeAgreementLifecycles, matchesAgreementLifecycle } from "../../src/agreements/agreement-dashboard.js";
import { queryDiplomacyOwner, validateDiplomacyQuery } from "../../src/diplomacy/diplomacy-query.js";
import { DiplomacyEntityStore, InMemoryDiplomacyStorageAdapter, type DiplomacyEntity } from "../../src/diplomacy/diplomacy-store.js";
import { agreementOwner } from "../../src/agreements/agreement-owner.js";
import { createDiplomacyDraft } from "../../src/diplomacy/diplomacy-drafts.js";
import { renderAgreementDashboard, renderAgreementListItem } from "../../src/ui/domain-patterns/diplomacy/agreement-dashboard-view.js";
import { DiplomacyApplicationController, DiplomacyApplication } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
function row(lifecycle: AgreementLifecycle = "draft", label = "Treaty", visibility = "public"): DiplomacyEntity {
  const d = createDiplomacyDraft("agreement", label, [{ type: "narrative", id: "A" }, { type: "narrative", id: "B" }], visibility as any);
  const data: any = d.data; data.state.agreement.lifecycle = lifecycle;
  return { schemaVersion: 1, kind: "agreement", id: d.id, revision: 0, data, receipts: [] };
}
async function queryFixture(rows: DiplomacyEntity[], user = "player", fenced = new Set<string>()) {
  const adapter = new InMemoryDiplomacyStorageAdapter(); for (const r of rows) await adapter.write(r);
  const store = new DiplomacyEntityStore(adapter); await store.rehydrate(); let projections = 0;
  const owner = { ...agreementOwner, project: (...args: Parameters<typeof agreementOwner.project>) => { projections++; return agreementOwner.project(...args); } };
  const query = async (payload: any = {}) => unwrap(await queryDiplomacyOwner({ senderUserId: user, authorityUserId: "gm", receivedAtReal: Date.now(), command: { payload } } as any,
    "agreement", owner, store, {} as any, {} as any,
    { fenceRegistry: { assertKeysAvailable: (keys: string[]) => keys.some(k => [...fenced].some(id => k.includes(id))) ? { ok: false, error: { code: "FENCED", message: "Busy" } } : ok({}) } } as any, 500)) as any;
  return { query, adapter, projections: () => projections };
}
function controller(result: Result<any> = ok({ items: [], total: 0, agreementSummary: summarizeAgreementLifecycles([]) })) {
  const calls: any[] = []; const api: any = {};
  for (const kind of ["agreements", "relations", "reputation", "territory", "disputes", "proposals"]) api[kind] = { query: async (q: any) => { calls.push({ kind, q }); return result; } };
  const c = new DiplomacyApplicationController(api); c.selectTab("agreements"); return { c, calls };
}
test("G6 dashboard: complete immutable histogram includes all eight states and zero buckets", () => {
  const states = [...AGREEMENT_LIFECYCLES, "active" as const], before = [...states], s = summarizeAgreementLifecycles(states);
  assert.equal(s.total, 9); assert.equal(s.byLifecycle.active, 2); assert.equal(Object.keys(s.byLifecycle).length, 8);
  assert.equal(Object.values(s.byLifecycle).reduce((a, b) => a + b), 9); assert.ok(Object.isFrozen(s.byLifecycle)); assert.deepEqual(states, before);
  assert.equal(summarizeAgreementLifecycles([]).byLifecycle.expired, 0);
});
test("G6 dashboard: negotiation groups only initial proposal and approval; exact states stay distinct", () => {
  for (const state of AGREEMENT_LIFECYCLES) { assert.ok(matchesAgreementLifecycle(state)); assert.ok(matchesAgreementLifecycle(state, state));
    assert.equal(matchesAgreementLifecycle(state, "negotiation"), ["proposed", "pendingApproval"].includes(state)); }
  assert.equal(matchesAgreementLifecycle("active", "draft"), false);
});
test("G6 dashboard: API validates exact states and group only for agreement lists", () => {
  for (const value of [...AGREEMENT_LIFECYCLES, "negotiation"]) assert.ok(validateDiplomacyQuery({ agreementLifecycle: value }, "agreement").ok);
  for (const value of ["", "all", "Active", "__proto__", null, 3, {}, ["draft"]]) assert.equal(validateDiplomacyQuery({ agreementLifecycle: value }, "agreement").ok, false);
  for (const kind of ["relation", "reputation", "territory", "dispute", "proposal", undefined] as const) assert.equal(validateDiplomacyQuery({ agreementLifecycle: "draft" }, kind).ok, false);
  assert.equal(validateDiplomacyQuery({ id: "agr", agreementLifecycle: "active" }, "agreement").ok, false);
  assert.ok(validateDiplomacyQuery({ search: "Treaty", offset: 30, limit: 30 }, "agreement").ok);
});
test("G6 dashboard: totals precede state filter and paging beyond the first page", async () => {
  const f = await queryFixture([...Array.from({ length: 65 }, () => row("active")), row("draft"), row("proposed")]);
  const first = await f.query({ agreementLifecycle: "active", limit: 30 }), last = await f.query({ agreementLifecycle: "active", offset: 60, limit: 30 });
  assert.equal(first.items.length, 30); assert.equal(last.items.length, 5); assert.equal(last.total, 65); assert.equal(last.agreementSummary.total, 67);
  assert.deepEqual(first.agreementSummary, last.agreementSummary); assert.equal(f.projections(), 0);
});
test("G6 dashboard: audience and recovery fences apply before counts; GM never counts fenced rows", async () => {
  const secret = row("terminated", "Secret", "secret"), restricted = row("breached", "Restricted", "restricted"), busy = row("expired", "Busy");
  const rows = [row("active"), secret, restricted, busy], f = await queryFixture(rows, "player", new Set([busy.id])), gm = await queryFixture(rows, "gm", new Set([busy.id]));
  assert.equal((await f.query()).agreementSummary.total, 1); const d = await gm.query(); assert.equal(d.agreementSummary.total, 3); assert.equal(d.agreementSummary.byLifecycle.expired, 0);
  assert.equal(JSON.stringify(await f.query()).includes(secret.id), false);
});
test("G6 dashboard: search composes with state and cannot reveal hidden labels or states", async () => {
  const f = await queryFixture([row("active", "Trade north"), row("draft", "Trade south"), row("expired", "Other"), row("breached", "Secret marker", "secret")]);
  const d = await f.query({ search: "TRADE", agreementLifecycle: "terminated" }); assert.equal(d.total, 0); assert.equal(d.agreementSummary.total, 2);
  assert.equal(d.agreementSummary.byLifecycle.active, 1); assert.equal(d.agreementSummary.byLifecycle.expired, 0);
  assert.deepEqual(await f.query({ search: "Secret marker" }), await f.query({ search: "Nothing exists" }));
});
test("G6 dashboard: list is a minimal DTO without projecting terms, obligations or definitions", async () => {
  const r = row("draft"); (r.data as any).state.agreement.terms = [{ id: "secret-term-marker" }];
  const f = await queryFixture([r]); const d = await f.query(); assert.deepEqual(Object.keys(d.items[0]).sort(), ["id", "label", "lifecycle", "revision"]);
  assert.equal(f.projections(), 0); assert.equal(JSON.stringify(d).includes("secret-term-marker"), false);
});
test("G6 dashboard: reads never alter durable owner state and invalid stored states fail closed", async () => {
  const r = row("active"), f = await queryFixture([r]), before = await f.adapter.loadAll(); await f.query({ agreementLifecycle: "negotiation" });
  assert.deepEqual(await f.adapter.loadAll(), before);
  const corrupt = row(); (corrupt.data as any).state.agreement.lifecycle = "unknown"; const broken = await queryFixture([corrupt]);
  await assert.rejects(() => broken.query(), /DM_AGREEMENT_STATE_INVALID/);
});
test("G6 dashboard: renderer has eight selectable cards, exact options and count scope", () => {
  const h = renderAgreementDashboard(summarizeAgreementLifecycles(["active", "proposed", "pendingApproval"]), "", "Trade");
  assert.equal((h.match(/data-dm-agreement-state=/g) ?? []).length, 8); assert.ok(h.includes('<strong>2</strong>'));
  assert.ok(h.includes('value="pendingApproval"')); assert.ok(h.includes("página não alteram")); assert.ok(h.includes("Emendas pendentes"));
  assert.ok(h.includes("não expira o acordo automaticamente"));
});
test("G6 dashboard: HTML escapes search, list labels and IDs; unavailable is not fabricated zero", () => {
  const h = renderAgreementDashboard(summarizeAgreementLifecycles([]), "active", '<script>"'); assert.equal(h.includes("<script>"), false); assert.ok(h.includes("&lt;script&gt;"));
  const item = renderAgreementListItem({ id: '" onclick="bad', label: "<b>bad</b>", lifecycle: "pendingApproval" }, null);
  assert.equal(item.includes("<b>"), false); assert.ok(item.includes("Em aprovação")); assert.ok(item.includes("&quot;"));
  const unavailable = renderAgreementDashboard(undefined, "", ""); assert.ok(unavailable.includes("Resumo indisponível")); assert.equal(unavailable.includes("<strong>0"), false);
});
test("G6 dashboard: changing state clears selection, pages, action fields and editor but retains search", () => {
  const { c } = controller(); Object.assign(c, { offset: 60, historyOffset: 30, selectedId: "old", detail: {}, list: {}, creating: true, preview: {}, agreementFormFields: { reason: "Old" }, agreementTermEditor: {}, agreementTermPreview: {}, search: "Trade" });
  unwrap(c.selectAgreementLifecycle("negotiation")); assert.equal(c.offset, 0); assert.equal(c.historyOffset, 0); assert.equal(c.selectedId, null); assert.equal(c.detail, null);
  assert.equal(c.list, null); assert.equal(c.creating, false); assert.equal(c.preview, null); assert.equal(c.agreementTermEditor, null); assert.equal(c.agreementTermPreview, null);
  assert.deepEqual(c.agreementFormFields, {}); assert.equal(c.search, "Trade");
});
test("G6 dashboard: invalid or unchanged filter preserves draft; switching tabs prevents filter leakage", () => {
  const { c } = controller(); c.agreementLifecycle = "active"; c.selectedId = "keep"; c.agreementFormFields = { reason: "Keep" };
  assert.equal(c.selectAgreementLifecycle("bogus").ok, false); assert.equal(c.selectedId, "keep"); unwrap(c.selectAgreementLifecycle("active")); assert.equal(c.selectedId, "keep");
  c.selectTab("relations"); assert.equal(c.agreementLifecycle, ""); assert.equal(c.selectAgreementLifecycle("draft").ok, false);
});
test("G6 dashboard: list query gets filter while detail query remains ID-only and clears omit field", async () => {
  const { c, calls } = controller(); unwrap(c.selectAgreementLifecycle("active")); c.select("agr"); await c.load();
  assert.equal(calls[0].q.agreementLifecycle, "active"); assert.equal(Object.hasOwn(calls[1].q, "agreementLifecycle"), false);
  unwrap(c.selectAgreementLifecycle("")); await c.load(); assert.equal(Object.hasOwn(calls[2].q, "agreementLifecycle"), false);
  c.selectTab("relations"); await c.load(); assert.equal(Object.hasOwn(calls[3].q, "agreementLifecycle"), false);
});
test("G6 dashboard: search resets agreement selection/page and retains lifecycle filter", () => {
  const { c } = controller(); c.agreementLifecycle = "expired"; c.offset = 60; c.selectedId = "old"; c.historyOffset = 30;
  c.setSearch("Trade"); assert.equal(c.agreementLifecycle, "expired"); assert.equal(c.search, "Trade"); assert.equal(c.offset, 0); assert.equal(c.selectedId, null);
  assert.equal(c.historyOffset, 0); unwrap(c.selectAgreementLifecycle("")); assert.equal(c.search, "Trade");
});
test("G6 dashboard: failed authority read hides stale list/detail and retains editor recovery state", async () => {
  const { c } = controller({ ok: false, error: { code: "FAIL", message: "Unavailable", severity: "error" } } as any);
  c.list = { agreementSummary: summarizeAgreementLifecycles(["active"]) }; c.detail = { label: "Private stale marker" }; c.agreementTermEditor = { fields: { reason: "Recover" } } as any;
  assert.equal((await c.load()).ok, false); assert.equal(c.list, null); assert.equal(c.detail, null); assert.equal(c.agreementTermEditor!.fields.reason, "Recover");
  const h = c.render(); assert.equal(h.includes("Private stale marker"), false); assert.ok(h.includes("Resumo indisponível"));
});
test("G6 dashboard: empty filtered list still shows search-scoped summary and disables paging", () => {
  const { c } = controller(); c.agreementLifecycle = "expired"; c.list = { items: [], total: 0, agreementSummary: summarizeAgreementLifecycles(["active"]) };
  const h = c.render(); assert.ok(h.includes("Nenhum acordo visível para este filtro/pesquisa")); assert.ok(h.includes('<strong>1</strong>'));
  assert.ok(h.includes('data-dm-page="1" disabled')); assert.ok(h.includes("Limpar filtro de estado"));
});
test("G6 dashboard: application routes summary clicks including empty clear and filter dropdown submit", async () => {
  const { c } = controller(), app = new DiplomacyApplication({ api: c.api }), listeners: Record<string, Function> = {}, savedFormData = globalThis.FormData;
  app.controller.selectTab("agreements"); let renders = 0; (app as any).element = { addEventListener: (e: string, fn: Function) => listeners[e] = fn }; (app as any).render = async () => { renders++; };
  (globalThis as any).FormData = class { constructor(readonly form: any) {} forEach(fn: Function) { Object.entries(this.form.values).forEach(([k, v]) => fn(v, k)); } };
  try { app._onRender(); await listeners.click({ target: { closest: () => ({ dataset: { dmAgreementState: "active" } }) } }); assert.equal(app.controller.agreementLifecycle, "active");
    await listeners.click({ target: { closest: () => ({ dataset: { dmAgreementState: "" } }) } }); assert.equal(app.controller.agreementLifecycle, "");
    await listeners.submit({ target: { dataset: { dmForm: "agreement-state" }, values: { agreementLifecycle: "pendingApproval" } }, preventDefault() {} });
    assert.equal(app.controller.agreementLifecycle, "pendingApproval"); assert.equal(renders, 3);
  } finally { globalThis.FormData = savedFormData; }
});
