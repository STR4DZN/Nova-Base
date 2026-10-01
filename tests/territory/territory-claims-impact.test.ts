import test from "node:test";
import assert from "node:assert/strict";
import { previewTerritoryClaimsImpact } from "../../src/territory/territory-claims-impact.js";
import { emptyTerritoryState, type TerritoryState, type TerritoryClaim } from "../../src/territory/territory-state.js";
import { territoryPreviewSnapshot } from "../../src/diplomacy/territory-preview-snapshot.js";
import { validateOwnerIntent } from "../../src/diplomacy/owner-commands.js";
import { renderTerritoryPreview } from "../../src/ui/domain-patterns/diplomacy/territory-claims-preview.js";
import { DiplomacyApplication, DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
import { ok } from "../../src/core/contracts/result.js";
const id = (s: string) => `JournalEntry.${s}`;
const unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const claim = (name = "same", patch = {}): TerritoryClaim => ({ id: name, sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 0,
  expiresAtWorldTick: null, claimantRef: { type: "narrative", id: "Guild" }, claimType: "domain-manager:ownership", lifecycle: "active", contested: true, strength: null, inherited: true, ...patch });
const state = (name: string, physical: string | null = null, admin: string | null = null, claims: TerritoryClaim[] = []): TerritoryState => ({
  ...emptyTerritoryState({ schemaVersion: 1, uuid: id(name), revision: 0, label: name, kind: "domain-manager:region", scale: "region", visibility: "public", createdAt: 0, updatedAt: 0,
    locatedInUuid: physical && id(physical), administrativeParentUuid: admin && id(admin), geography: {}, hierarchyHistory: [] }), claims });
function graphs(physical: string | null = "new", admin: string | null = "admin-old") {
  const before = [state("root", null, null, [claim("common")]), state("old", "root", null, [claim()]), state("new", "root", null, [claim()]),
    state("admin-old", null, null, [claim("admin-old")]), state("admin-new", null, null, [claim("admin-new")]),
    state("target", "old", "admin-old", [claim()]), state("physical-child", "target", "admin-new", [claim("child-local")]),
    state("grandchild", "physical-child"), state("admin-child", "new", "target"), state("unrelated", "old")];
  const after = before.map(s => s.territory.uuid === id("target") ? { ...s, territory: { ...s.territory, locatedInUuid: physical && id(physical), administrativeParentUuid: admin && id(admin), revision: 1 } } : s);
  return { before, after, impact: () => unwrap(previewTerritoryClaimsImpact(before, after, id("target"), 10)) };
}
const fields = (patch = {}) => ({ kind: "reparent", physical: id("new"), administrative: id("admin-old"), reason: "Move", ...patch });
function fixture() {
  const g = graphs(), impact = g.impact(), target = g.before.find(s => s.territory.uuid === id("target"))!;
  const detail: any = { ...target, id: id("target"), revision: 0, worldTick: 10 };
  const intent: any = { kind: "territory", mode: "modify", id: id("target"), expectedRevision: 0, action: { kind: "reparent", parents: { locatedInUuid: id("new"), administrativeParentUuid: id("admin-old") } }, reason: "Move" };
  const preview = { id: id("target"), changes: [{ id: id("target"), before: target, after: g.after.find(s => s.territory.uuid === id("target")) }], claimInheritanceImpact: impact, rightInheritanceImpact: { worldTick: 10, axes: [] }, previewSnapshot: territoryPreviewSnapshot(intent, g.before, 10) };
  const calls: any[] = []; let fail = false, badPreview = false;
  const api: any = { previewTerritory: async (p: any) => { calls.push(["preview", p]); return ok(badPreview ? { changes: [] } : preview); },
    territory: { query: async (p: any) => ok(p.id ? detail : { items: [], isGm: true, worldTick: 10 }), modify: async (p: any) => { calls.push(["modify", p]); return fail ? { ok: false, error: { code: "DM_TERRITORY_PREVIEW_STALE", message: "Refresh" } } : ok({}); } },
    proposals: { submit: async (p: any) => { calls.push(["proposal", p]); return ok({}); } } };
  const c = new DiplomacyApplicationController(api); c.selectTab("territory"); c.select(id("target")); c.detail = detail; c.list = { isGm: true, worldTick: 10 };
  return { c, api, calls, preview, fail: () => fail = true, badPreview: () => badPreview = true };
}
test("G6 claim impacts: physical target and all descendants use provenance, preserving equal IDs and shared ancestors", () => {
  const g = graphs(), copy = structuredClone({ before: g.before, after: g.after }), impact = g.impact(), a = impact.axes[0];
  assert.deepEqual(a.territories.map((r: any) => r.territoryUuid), [id("target"), id("physical-child"), id("grandchild")]);
  const target = a.territories[0]; assert.equal(target.localCount, 1); assert.equal(target.added[0].sourceTerritoryUuid, id("new")); assert.equal(target.removed[0].sourceTerritoryUuid, id("old")); assert.equal(target.retained[0].sourceTerritoryUuid, id("root"));
  assert.equal(a.territories[1].retained.find((r: any) => r.sourceTerritoryUuid === id("target")).claim.id, "same");
  assert.equal(target.added[0].claim.contested, true); assert.equal(Object.isFrozen(impact), true); assert.deepEqual(g.before, copy.before); assert.deepEqual(g.after, copy.after);
});
test("G6 claim impacts: administrative subtree is independent of physical descendants", () => {
  const impact = graphs("old", "admin-new").impact(); assert.equal(impact.axes[0].changed, false); assert.deepEqual(impact.axes[0].territories, []);
  assert.deepEqual(impact.axes[1].territories.map((r: any) => r.territoryUuid), [id("target"), id("admin-child")]);
  assert.equal(impact.axes[1].territories[0].added[0].claim.id, "admin-new"); assert.equal(impact.axes[1].territories[0].removed[0].claim.id, "admin-old");
});
test("G6 claim impacts: both axes and root detachment are reported separately", () => {
  const impact = graphs(null, null).impact(); assert.ok(impact.axes.every((a: any) => a.changed)); assert.equal(impact.axes[0].territories[0].after.length, 0);
  assert.equal(impact.axes[0].territories[1].retained[0].sourceTerritoryUuid, id("target")); assert.equal(impact.axes[1].territories[0].after.length, 0);
});
test("G6 claim impacts: unchanged parents produce no affected subtrees", () => {
  assert.ok(graphs("old").impact().axes.every((a: any) => !a.changed && a.territories.length === 0));
});
test("G6 claim impacts: temporal boundaries, lifecycle and propagation policy filter ancestral sources", () => {
  const g = graphs(); const old = g.before.find(s => s.territory.uuid === id("old"))!;
  (old as any).claims.push(claim("expired", { expiresAtWorldTick: 10 }), claim("future", { startsAtWorldTick: 11 }), claim("ended", { lifecycle: "ended" }), claim("superseded", { lifecycle: "superseded" }), claim("private", { visibility: "secret" }), claim("no-propagation", { inherited: false }));
  const a = g.impact().axes[0].territories[0]; assert.deepEqual(a.removed.map((r: any) => r.claim.id), ["same", "private"]);
  assert.equal(unwrap(previewTerritoryClaimsImpact(g.before, g.after, id("target"), 9)).axes[0].territories[0].before.some((r: any) => r.claim.id === "expired"), true);
});
test("G6 claim impacts: invalid clock, corrupt source, missing parent and cycle fail closed", () => {
  for (const tick of [-1, 0.5, NaN, undefined]) { const g = graphs(); assert.equal(previewTerritoryClaimsImpact(g.before, g.after, id("target"), tick as any).ok, false); }
  for (const physical of ["missing", "grandchild"]) { const g = graphs(physical); assert.equal(previewTerritoryClaimsImpact(g.before, g.after, id("target"), 10).ok, false); }
  const g = graphs(); (g.before[0] as any).claims = "bad"; assert.equal(previewTerritoryClaimsImpact(g.before, g.after, id("target"), 10).ok, false);
});
test("G6 claim impacts: snapshot ignores source enumeration order but detects data, tick and intent drift", () => {
  const g = graphs(), intent: any = { kind: "territory", mode: "modify", id: id("target"), expectedRevision: 0, action: { kind: "reparent", parents: {} }, reason: "Move" };
  const snapshot = territoryPreviewSnapshot(intent, g.before, 0); assert.deepEqual(territoryPreviewSnapshot(intent, [...g.before].reverse(), 0), snapshot);
  for (const patch of [{ reason: "Other" }, { expectedRevision: 1 }, { id: id("other") }, { action: { kind: "reparent", parents: { locatedInUuid: id("new") } } }]) assert.notEqual(territoryPreviewSnapshot({ ...intent, ...patch }, g.before, 0).fingerprint, snapshot.fingerprint);
  assert.notEqual(territoryPreviewSnapshot(intent, g.before, 1).fingerprint, snapshot.fingerprint); (g.before[0] as any).claims[0].visibility = "secret";
  assert.notEqual(territoryPreviewSnapshot(intent, g.before, 0).fingerprint, snapshot.fingerprint);
});
test("G6 claim impacts: snapshot schema is scoped to reparent and retains zero tick", () => {
  const intent: any = { kind: "territory", mode: "modify", id: id("target"), expectedRevision: 0, action: { kind: "reparent" }, reason: "Move", previewSnapshot: { worldTick: 0, fingerprint: "fp_0123456789abcdef" } };
  assert.equal(validateOwnerIntent(intent).ok, true);
  for (const snapshot of [null, {}, { worldTick: -1, fingerprint: "fp_0123456789abcdef" }, { worldTick: 0, fingerprint: "bad" }]) assert.equal(validateOwnerIntent({ ...intent, previewSnapshot: snapshot }).ok, false);
  assert.equal(validateOwnerIntent({ ...intent, kind: "relation" }).ok, false); assert.equal(validateOwnerIntent({ ...intent, action: { kind: "claim" } }).ok, false);
});
test("G6 claim preview UI: before/after, local preservation and unaffected axis are explicit without showing snapshot fingerprint", () => {
  const { preview } = fixture(), html = renderTerritoryPreview(preview); for (const text of ["Recebida", "Perdida", "Mantida", "Contestada", "locais vigentes preservadas", "Sem alteração neste eixo", "3 território(s)", "tick 10"]) assert.ok(html.includes(text), text);
  assert.equal(html.includes(preview.previewSnapshot.fingerprint), false); assert.equal(html.includes("unrelated"), false);
});
test("G6 claim preview UI: labels, refs and claim types escape HTML; no-op and empty inherited sets render", () => {
  const preview = structuredClone(fixture().preview); const row = preview.claimInheritanceImpact.axes[0].territories[0]; row.label = '<script>"'; row.added[0].claim.claimType = "<script>"; row.added[0].sourceTerritoryLabel = "<script>";
  assert.equal(renderTerritoryPreview(preview).includes("<script>"), false);
  row.before = []; row.after = []; row.added = []; row.removed = []; row.retained = []; assert.ok(renderTerritoryPreview(preview).includes("Nenhuma reivindicação herdada vigente"));
  assert.equal(renderTerritoryPreview(null), ""); assert.ok(renderTerritoryPreview({ changes: [] }).includes("Prévia validada: 0"));
});
test("G6 claim preview UI: preview persists reparent fields through rendering and binds confirmation to snapshot", async () => {
  const { c, calls, preview } = fixture(); assert.equal((await c.change(fields())).ok, false); unwrap(await c.change(fields(), true));
  const html = c.actionForm(); assert.ok(html.includes('value="reparent" selected')); assert.ok(html.includes('value="JournalEntry.new"')); assert.ok(html.includes('value="Move"'));
  unwrap(await c.change(fields())); assert.deepEqual(calls.find(([type]) => type === "modify")[1].previewSnapshot, preview.previewSnapshot); assert.equal(c.preview, null); assert.deepEqual(c.territoryHierarchyFields, {});
});
test("G6 claim preview UI: edits invalidate preview and block confirmation while preserving draft", async () => {
  const { c, calls } = fixture(); unwrap(await c.change(fields(), true)); c.updateTerritoryHierarchyDraft(fields({ reason: "Other" })); assert.equal(c.preview, null);
  assert.equal((await c.change(fields({ reason: "Other" }))).ok, false); assert.equal(c.territoryHierarchyFields.reason, "Other"); assert.equal(calls.some(([type]) => type === "modify"), false);
});
test("G6 claim preview UI: stale backend rejection clears preview; incomplete preview cannot authorize confirmation", async () => {
  const { c, fail } = fixture(); unwrap(await c.change(fields(), true)); fail(); assert.equal((await c.change(fields())).ok, false); assert.equal(c.preview, null); assert.equal(c.territoryHierarchyFields.reason, "Move");
  const second = fixture(); second.badPreview(); assert.equal((await second.c.change(fields(), true)).ok, false); assert.equal((await second.c.change(fields())).ok, false);
});
test("G6 claim preview UI: context switch clears draft and Player submits an ordinary proposal", async () => {
  const { c, calls } = fixture(); c.list.isGm = false; unwrap(await c.change(fields())); assert.equal(calls[0][0], "proposal"); assert.equal(calls[0][1].intent.previewSnapshot, undefined);
  c.select(id("other")); assert.deepEqual(c.territoryHierarchyFields, {}); c.territoryHierarchyFields = fields(); c.selectTab("agreements"); assert.deepEqual(c.territoryHierarchyFields, {});
});
test("G6 claim preview bindings: input invalidation, preview render and submit retain form intent", async () => {
  const f = fixture(), app = new DiplomacyApplication({ api: f.api }), listeners: Record<string, Function> = {}, saved = globalThis.FormData; let html = "";
  app.controller.selectTab("territory"); app.controller.select(id("target")); unwrap(await app.controller.load());
  (app as any).element = { addEventListener: (e: string, fn: Function) => listeners[e] = fn }; (app as any).render = async () => { unwrap(await app.controller.load()); html = app.controller.actionForm(); };
  (globalThis as any).FormData = class { constructor(readonly form: any) {} forEach(fn: Function) { Object.entries(this.form.values).forEach(([k, v]) => fn(v, k)); } };
  const form: any = { dataset: { dmForm: "change" }, values: fields() };
  try { (app as any)._onRender(); listeners.input({ target: { closest: () => form } });
    await listeners.click({ target: { closest: () => ({ dataset: { dmPreview: "true" }, closest: () => form }) } }); assert.ok(html.includes('value="JournalEntry.new"')); assert.ok(html.includes("Prévia da hierarquia"));
    await listeners.submit({ target: form, preventDefault() {} }); assert.equal(f.calls.find(([type]) => type === "modify")[1].action.parents.locatedInUuid, id("new"));
  } finally { (globalThis as any).FormData = saved; }
});
