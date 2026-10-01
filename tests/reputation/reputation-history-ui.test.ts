import test from "node:test";
import assert from "node:assert/strict";
import { ok, type Result } from "../../src/core/contracts/result.js";
import { createDiplomacyDraft } from "../../src/diplomacy/diplomacy-drafts.js";
import { validateDiplomacyQuery } from "../../src/diplomacy/diplomacy-query.js";
import { reputationOwner, type ReputationOwnerData } from "../../src/reputation/reputation-owner.js";
import type { ReputationEntry, ReputationRecord } from "../../src/reputation/reputation-model.js";
import { projectReputationHistory, validateReputationHistoryFilter } from "../../src/reputation/reputation-history.js";
import { parseReputationHistoryFields, reputationHistoryFields, renderReputationHistory } from "../../src/ui/domain-patterns/diplomacy/reputation-history-view.js";
import { DiplomacyApplicationController, DiplomacyApplication } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const data = () => createDiplomacyDraft("reputation", "Standing", [{ type: "narrative", id: "A" }, { type: "narrative", id: "B" }], "public").data as ReputationOwnerData;
const entry = (patch: Partial<ReputationEntry> = {}): ReputationEntry => ({ id: crypto.randomUUID(), trackId: "domain-manager:standing", kind: "adjustment", before: 0, after: 2, delta: 2,
  source: { type: "manual", id: "gm" }, at: 1, reason: "Award", worldTick: 0, reversalOf: null, ...patch });
// Read-model fixtures isolate grouping/filtering; owner fixtures below use real valid transitions.
function record(entries: readonly ReputationEntry[]): ReputationRecord { return { ...data().record, entries,
  tracks: [...data().record.tracks, { definitionId: "test:second", definitionVersion: 1, initialScore: 0, score: 0, lastDecayWorldTick: null }] }; }
const ctx = (patch: any = {}) => ({ isGm: true, canSee: () => true, at: 100, worldTick: 10, historyOffset: 0, historyLimit: 30, ...patch });
function adjustedData() {
  let d = data(); const adjust = (delta: number, source = { type: "manual", id: "gm" }) => {
    d = unwrap(reputationOwner.change(d, { kind: "adjust", trackId: "domain-manager:standing", delta }, {
      expectedRevision: d.record.revision, eventId: crypto.randomUUID(), at: d.record.updatedAt + 1, worldTick: d.record.revision, reason: "Award", sourceRefs: [source] }, [])) as ReputationOwnerData;
  }; return { adjust, get: () => d };
}
function controller(isGm = true) {
  const calls: any[] = [], d = adjustedData(); d.adjust(5); const detail: any = unwrap(reputationOwner.project(d.get(), ctx({ isGm })));
  let result: Result<any> = ok(detail);
  const api: any = {}; for (const kind of ["reputation", "agreements", "relations", "territory", "disputes", "proposals"]) api[kind] = { query: async (q: any) => {
    calls.push({ kind, q }); return q.id ? result : ok({ isGm, items: [], total: 0 }); } };
  const c = new DiplomacyApplicationController(api); c.selectTab("reputation"); c.select(detail.id); c.list = { isGm }; c.detail = detail;
  return { c, calls, fail: () => result = { ok: false, error: { code: "FAIL", message: "Unavailable", severity: "error" } } as any };
}
test("G6 reputation history: filter schema supports track, entry kind, source type/ref and inclusive tick bounds", () => {
  for (const filter of [{}, { trackId: "test:track" }, { kind: "adjustment" }, { kind: "reversal" }, { kind: "decay" }, { sourceType: "manual" },
    { source: { type: "mission", uuid: "JournalEntry.source" } }, { sourceType: "manual", source: { type: "manual", id: "gm" }, fromWorldTick: 0, toWorldTick: 0 }])
    assert.ok(validateReputationHistoryFilter(filter).ok);
});
test("G6 reputation history: malformed filters, refs, intervals and unknown keys fail closed", () => {
  for (const filter of [null, [], { trackId: "" }, { trackId: "plain" }, { kind: "all" }, { sourceType: " " }, { source: { type: "manual" } },
    { source: { type: "manual", id: "a", uuid: "Actor.b" } }, { source: { type: "manual", id: "a", extra: true } },
    { sourceType: "manual", source: { type: "mission", id: "a" } }, { fromWorldTick: -1 }, { toWorldTick: 0.1 }, { fromWorldTick: 2, toWorldTick: 1 },
    { fromWorldTick: Number.MAX_SAFE_INTEGER + 1 }, { trackId: "test:a", isGm: true }]) assert.equal(validateReputationHistoryFilter(filter).ok, false);
});
test("G6 reputation history: query schema allows detail-only reputation fields and bounded source pages", () => {
  assert.ok(validateDiplomacyQuery({ id: "rep", reputationHistory: {}, reputationSourceOffset: 30, reputationSourceLimit: 100 }, "reputation").ok);
  for (const field of [{ reputationHistory: {} }, { reputationSourceOffset: 0 }, { reputationSourceLimit: 30 }]) {
    assert.equal(validateDiplomacyQuery(field, "reputation").ok, false);
    for (const kind of ["relation", "agreement", "territory", "dispute", "proposal", undefined] as const) assert.equal(validateDiplomacyQuery({ id: "rep", ...field }, kind).ok, false);
  }
  for (const page of [{ reputationSourceLimit: 0 }, { reputationSourceLimit: 101 }, { reputationSourceOffset: -1 }, { reputationSourceOffset: 1.5 }])
    assert.equal(validateDiplomacyQuery({ id: "rep", ...page }, "reputation").ok, false);
  assert.equal(validateDiplomacyQuery({ id: "rep", reputationHistory: { kind: "invalid" } }, "reputation").ok, false);
});
test("G6 reputation history: composed filters apply before pagination and exclude null ticks only for bounded intervals", () => {
  const rows = [entry({ worldTick: 10 }), entry({ worldTick: 20 }), entry({ worldTick: null }), entry({ worldTick: 11, kind: "decay" }),
    entry({ worldTick: 11, source: { type: "mission", id: "m" } }), entry({ trackId: "test:second", worldTick: 11 })];
  const d = unwrap(projectReputationHistory(record(rows), { trackId: "domain-manager:standing", kind: "adjustment", sourceType: "manual", fromWorldTick: 10, toWorldTick: 20 }, 1, 1));
  assert.equal(d.entries.length, 1); assert.equal(d.entries[0].worldTick, 20); assert.equal(d.reputationHistory.total, 2); assert.equal(d.reputationHistory.sources.items[0].net, "4");
  assert.equal(unwrap(projectReputationHistory(record(rows))).reputationHistory.total, 6);
});
test("G6 reputation history: exact reference kind and tuple grouping avoid ID/UUID/type/track collisions", () => {
  const rows = [entry({ source: { type: "mission", id: "JournalEntry.A" } }), entry({ source: { type: "mission", uuid: "JournalEntry.A" } }),
    entry({ source: { type: "other", uuid: "JournalEntry.A" } }), entry({ source: { type: "mission", uuid: "JournalEntry.A" }, trackId: "test:second" })];
  const d = unwrap(projectReputationHistory(record(rows))); assert.equal(d.reputationHistory.sources.total, 4);
  assert.equal(unwrap(projectReputationHistory(record(rows), { source: { type: "mission", uuid: "JournalEntry.A" } })).reputationHistory.total, 2);
  assert.equal(unwrap(projectReputationHistory(record(rows), { source: { type: "mission", id: "JournalEntry.A" } })).reputationHistory.total, 1);
});
test("G6 reputation history: entry and source pages are independent; source totals span all filtered entries", () => {
  const rows = Array.from({ length: 65 }, (_, i) => entry({ source: { type: "mission", id: String(i % 35) }, at: i })), r = record(rows);
  const first = unwrap(projectReputationHistory(r, {}, 0, 30, 0, 30)), last = unwrap(projectReputationHistory(r, {}, 60, 30, 30, 30));
  assert.equal(first.entries.length, 30); assert.equal(last.entries.length, 5); assert.equal(last.reputationHistory.total, 65);
  assert.equal(first.reputationHistory.sources.total, 35); assert.equal(last.reputationHistory.sources.items.length, 5); assert.equal(first.reputationHistory.sources.items[0].entries, 2);
  assert.deepEqual(first.reputationHistory.byKind, last.reputationHistory.byKind);
  assert.equal(unwrap(projectReputationHistory(r, {}, 1000, 30)).reputationHistory.sources.items.length, 30);
});
test("G6 reputation history: applied deltas retain adjustments, reversals, zero decay and separate track scales", () => {
  const d = unwrap(projectReputationHistory(record([entry({ delta: 10 }), entry({ kind: "reversal", delta: -10 }), entry({ kind: "decay", delta: -2 }),
    entry({ kind: "decay", delta: 0 }), entry({ trackId: "test:second", delta: 50 })])));
  const [a, b] = d.reputationHistory.sources.items; assert.equal(a.gains, "10"); assert.equal(a.losses, "-12"); assert.equal(a.net, "-2");
  assert.deepEqual(a.byKind, { adjustment: 1, reversal: 1, decay: 2 }); assert.equal(b.net, "50"); assert.equal(d.reputationHistory.total, 5);
});
test("G6 reputation history: sums above Number safe range remain exact JSON decimal strings", () => {
  const n = Number.MAX_SAFE_INTEGER, d = unwrap(projectReputationHistory(record([entry({ delta: n }), entry({ delta: n }), entry({ delta: -n })])));
  const g = d.reputationHistory.sources.items[0]; assert.equal(g.gains, (2n * BigInt(n)).toString()); assert.equal(g.net, String(n));
  assert.equal(JSON.parse(JSON.stringify(d)).reputationHistory.sources.items[0].gains, "18014398509481982");
});
test("G6 reputation history: unknown track rejects, unmatched source yields honest empty pages and invalid pages reject", () => {
  const r = record([entry()]); assert.equal(projectReputationHistory(r, { trackId: "test:missing" }).ok, false);
  const d = unwrap(projectReputationHistory(r, { sourceType: "missing" })); assert.equal(d.reputationHistory.total, 0); assert.equal(d.reputationHistory.sources.total, 0);
  assert.equal(projectReputationHistory(r, {}, 0, 30, 0, 0).ok, false); assert.equal(projectReputationHistory(r, {}, -1).ok, false);
});
test("G6 reputation history: immutable detached DTO preserves canonical source, entries and filter input", () => {
  const r = record([entry()]), filter = { source: { type: "manual", id: "gm" } }, before = structuredClone(r), d = unwrap(projectReputationHistory(r, filter));
  assert.deepEqual(r, before); assert.equal(Object.isFrozen(r.entries[0].source), false); assert.equal(Object.isFrozen(filter.source), false);
  assert.ok(Object.isFrozen(d.entries[0])); assert.ok(Object.isFrozen(d.reputationHistory.sources.items[0].source)); assert.notEqual(d.entries[0], r.entries[0]);
});
test("G6 reputation history: owner GM projects filtered pages and full source summary without changing current score", () => {
  const x = adjustedData(); x.adjust(5); x.adjust(3); x.adjust(-1, { type: "mission", id: "m" }); const before = structuredClone(x.get());
  const d: any = unwrap(reputationOwner.project(x.get(), ctx({ historyOffset: 1, historyLimit: 1, reputationHistory: { sourceType: "manual" } })));
  assert.equal(d.entries.length, 1); assert.equal(d.entries[0].delta, 3); assert.equal(d.reputationHistory.total, 2); assert.equal(d.reputationHistory.sources.items[0].net, "8");
  assert.equal(d.tracks[0].score, 7); assert.equal(d.tracks[0].initialScore, 0); assert.deepEqual(x.get(), before);
});
test("G6 reputation history: Player never receives raw history/source/counts and cannot probe known or hidden tracks", () => {
  const x = adjustedData(); x.adjust(5); const d = x.get(), normal: any = unwrap(reputationOwner.project(d, ctx({ isGm: false })));
  assert.equal(normal.tracks[0].score, undefined); assert.equal(normal.entries, undefined); assert.equal(normal.reputationHistory, undefined); assert.equal(normal.definitions, undefined);
  const known = reputationOwner.project(d, ctx({ isGm: false, reputationHistory: { trackId: "domain-manager:standing" } })), missing = reputationOwner.project(d, ctx({ isGm: false, reputationHistory: { trackId: "secret:probe" } }));
  assert.deepEqual(known, missing); assert.equal(known.ok, false);
  assert.equal(reputationOwner.project(d, ctx({ isGm: false, reputationSourceOffset: 0 })).ok, false);
});
test("G6 reputation history: form preserves zero ticks and exact ID/UUID filters on round trip", () => {
  for (const filter of [{}, { trackId: "test:track", kind: "reversal" as const, source: { type: "mission", uuid: "JournalEntry.source" }, sourceType: "mission", fromWorldTick: 0, toWorldTick: 10 },
    { sourceType: "manual", source: { type: "manual", id: "gm" } }]) assert.deepEqual(unwrap(parseReputationHistoryFields(reputationHistoryFields(filter))), filter);
  assert.equal(reputationHistoryFields({ fromWorldTick: 0 }).from, "0");
});
test("G6 reputation history: form rejects invalid ticks, reversed range and missing/malformed exact source type/ref", () => {
  const f = reputationHistoryFields(); for (const patch of [{ from: "-1" }, { from: "1.5" }, { from: "1e2" }, { from: "9007199254740992" }, { from: "20", to: "10" },
    { sourceRef: "m", sourceType: "" }, { sourceRef: "m", sourceType: "mission", sourceKind: "uuid" }, { sourceRef: "m", sourceType: "mission", sourceKind: "bad" }])
    assert.equal(parseReputationHistoryFields({ ...f, ...patch }).ok, false);
});
test("G6 reputation history: renderer explains scope, full deltas/ref/reversal and disables exact-final pages", () => {
  const x = adjustedData(); for (let i = 0; i < 30; i++) x.adjust(1); const d: any = unwrap(reputationOwner.project(x.get(), ctx()));
  const h = renderReputationHistory(d, {}); assert.ok(h.includes("antes da paginação")); assert.ok(h.includes("não substitui o valor atual")); assert.ok(h.includes("ID/UUID"));
  assert.ok(h.includes("Delta aplicado")); assert.ok(h.includes("Reverte lançamento")); assert.ok(h.includes('data-dm-history="1" disabled'));
  assert.ok(h.includes("0 decadências")); assert.ok(h.includes("1–30 de 30"));
  const exact: any = unwrap(reputationOwner.project(x.get(), ctx({ reputationHistory: { source: { type: "manual", id: "gm" } } })));
  assert.ok(renderReputationHistory(exact, {}).includes("Tipo de fonte: manual"));
});
test("G6 reputation history: HTML escapes source, reason, track labels and invalid saved form fields", () => {
  const r = record([entry({ reason: "<script>reason</script>", source: { type: '" onclick="bad', id: '<script>source</script>' } })]);
  const d = { ...unwrap(projectReputationHistory(r)), tracks: [{ definitionId: "domain-manager:standing", label: "<script>track</script>" }] };
  const h = renderReputationHistory(d, { ...reputationHistoryFields(), sourceRef: '\"><img src=x onerror=bad>' });
  assert.equal(h.includes("<script>"), false); assert.equal(h.includes("<img"), false); assert.ok(h.includes("&lt;script&gt;")); assert.ok(h.includes("&quot;"));
  assert.ok(renderReputationHistory({ entries: [], tracks: [] }, {}).includes("Resumo do histórico indisponível"));
});
test("G6 reputation history: applying filters resets both pages and retains selection/configuration/action fields", () => {
  const { c } = controller(); c.historyOffset = 60; c.reputationSourceOffset = 30; c.reputationConfigurationFields = { reason: "Keep config" }; c.offset = 30;
  const id = c.selectedId, before = structuredClone(c.detail); unwrap(c.applyReputationHistory({ ...reputationHistoryFields(), kind: "adjustment", from: "0" }));
  assert.equal(c.historyOffset, 0); assert.equal(c.reputationSourceOffset, 0); assert.equal(c.selectedId, id); assert.equal(c.offset, 30);
  assert.deepEqual(c.reputationConfigurationFields, { reason: "Keep config" }); assert.deepEqual(c.detail, before);
});
test("G6 reputation history: invalid filter keeps applied query/pages while preserving raw input and permission guard", () => {
  const { c } = controller(); c.historyOffset = 60; c.reputationSourceOffset = 30; const fields = { ...reputationHistoryFields(), from: "bad" };
  assert.equal(c.applyReputationHistory(fields).ok, false); assert.equal(c.historyOffset, 60); assert.deepEqual(c.reputationHistoryFilter, {}); assert.deepEqual(c.reputationHistoryFormFields, fields);
  assert.equal(c.applyReputationHistory({ ...fields, from: "", trackId: "test:unknown" }).ok, false);
  const player = controller(false).c; assert.equal(player.applyReputationHistory(reputationHistoryFields()).ok, false); assert.deepEqual(player.reputationHistoryFormFields, {});
});
test("G6 reputation history: only GM detail query receives filters/source pagination; switching record or tab resets", async () => {
  const { c, calls } = controller(); unwrap(c.applyReputationHistory({ ...reputationHistoryFields(), sourceType: "manual" })); await c.load();
  assert.equal(calls[0].q.reputationHistory, undefined); assert.equal(calls[1].q.reputationHistory.sourceType, "manual"); assert.equal(calls[1].q.reputationSourceLimit, 30);
  c.select("different"); assert.deepEqual(c.reputationHistoryFilter, {}); assert.deepEqual(c.reputationHistoryFormFields, {}); c.selectTab("agreements"); await c.load();
  assert.equal(calls.at(-1).q.reputationSourceOffset, undefined);
  const player = controller(false); await player.c.load(); assert.equal(player.calls[1].q.reputationHistory, undefined); assert.equal(player.calls[1].q.reputationSourceOffset, undefined);
});
test("G6 reputation history: source drilldown retains kind/tick scope, clear keeps selected record, failure retains inputs", async () => {
  const { c, fail } = controller(); const id = c.selectedId; unwrap(c.applyReputationHistory({ ...reputationHistoryFields(), kind: "adjustment", from: "0" }));
  unwrap(c.filterReputationSource("domain-manager:standing", "manual", "id", "gm")); assert.equal(c.reputationHistoryFilter.fromWorldTick, 0); assert.equal(c.reputationHistoryFilter.kind, "adjustment");
  assert.deepEqual(c.reputationHistoryFilter.source, { type: "manual", id: "gm" }); assert.equal(c.filterReputationSource("domain-manager:standing", "manual", "bad", "gm").ok, false);
  fail(); assert.equal((await c.load()).ok, false); assert.equal(c.detail, null); assert.equal(c.reputationHistoryFormFields.sourceRef, "gm");
  const next = controller().c, nextId = next.selectedId; unwrap(next.applyReputationHistory({ ...reputationHistoryFields(), kind: "decay" })); unwrap(next.applyReputationHistory(reputationHistoryFields())); assert.equal(next.selectedId, nextId); assert.deepEqual(next.reputationHistoryFilter, {});
});
test("G6 reputation history: application binds filter submit, source drilldown, independent source page and clear", async () => {
  const { c } = controller(), app = new DiplomacyApplication({ api: c.api }), listeners: Record<string, Function> = {}, original = globalThis.FormData;
  Object.assign(app.controller, { tab: c.tab, selectedId: c.selectedId, list: c.list, detail: c.detail }); let renders = 0;
  (app as any).element = { addEventListener: (event: string, fn: Function) => listeners[event] = fn }; (app as any).render = async () => { renders++; };
  (globalThis as any).FormData = class { constructor(readonly f: any) {} forEach(fn: Function) { Object.entries(this.f.values).forEach(([k, v]) => fn(v, k)); } };
  const click = (dataset: any) => listeners.click({ target: { closest: () => ({ dataset }) } });
  try { app._onRender(); await listeners.submit({ target: { dataset: { dmForm: "reputation-history" }, values: { ...reputationHistoryFields(), sourceType: "manual" } }, preventDefault() {} });
    assert.equal(app.controller.reputationHistoryFilter.sourceType, "manual"); await click({ dmReputationSourcePage: "1" }); assert.equal(app.controller.reputationSourceOffset, 30); assert.equal(app.controller.historyOffset, 0);
    await click({ dmReputationSourceTrack: "domain-manager:standing", dmReputationSourceType: "manual", dmReputationSourceKind: "id", dmReputationSourceRef: "gm" });
    assert.equal(app.controller.reputationHistoryFilter.source?.id, "gm"); assert.equal(app.controller.reputationSourceOffset, 0);
    await click({ dmReputationHistoryClear: "true" }); assert.deepEqual(app.controller.reputationHistoryFilter, {}); assert.equal(renders, 4);
  } finally { globalThis.FormData = original; }
});
