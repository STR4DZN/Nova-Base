import test from "node:test";
import assert from "node:assert/strict";
import { validateDiplomacyQuery } from "../../src/diplomacy/diplomacy-query.js";
import { renderTerritoryClaims } from "../../src/ui/domain-patterns/diplomacy/territory-claims-view.js";
import { DiplomacyApplication, DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
import { ok } from "../../src/core/contracts/result.js";
const child = "JournalEntry.child", parent = "JournalEntry.parent";
const claim = { id: "same-id", sourceRef: { type: "manual" as const, id: "gm" }, visibility: "public" as const,
  startsAtWorldTick: 0, expiresAtWorldTick: null, claimantRef: { type: "narrative" as const, id: "Guild" },
  claimType: "domain-manager:ownership", lifecycle: "active" as const, contested: true, strength: null, inherited: true };
const rows = [{ sourceTerritoryUuid: child, sourceTerritoryLabel: "Child", sourceRevision: 1, inherited: false, claim },
  { sourceTerritoryUuid: parent, sourceTerritoryLabel: "Parent", sourceRevision: 4, inherited: true, claim }];
function fixture() {
  const calls: any[] = []; let fail = false;
  const detail = { id: child, revision: 1, worldTick: 10, claims: [claim], effectiveClaims: rows, links: [], occupations: [], presence: [] };
  const api: any = { territory: { query: async (p: any) => { calls.push(p); return p.id ? fail ? { ok: false, error: { message: "Unavailable" } } : ok({ ...detail, claimInheritanceAxis: p.claimInheritanceAxis }) : ok({ items: [], isGm: true, worldTick: 10 }); } } };
  const c = new DiplomacyApplicationController(api); c.selectTab("territory"); c.select(child); c.detail = detail;
  return { c, api, calls, detail, fail: () => fail = true };
}
test("G6 claims UI: query accepts either axis only on territory detail", () => {
  for (const claimInheritanceAxis of ["locatedInUuid", "administrativeParentUuid"]) assert.equal(validateDiplomacyQuery({ id: child, claimInheritanceAxis }, "territory").ok, true);
  for (const claimInheritanceAxis of ["", "both", null, [], 1]) assert.equal(validateDiplomacyQuery({ id: child, claimInheritanceAxis }, "territory").ok, false);
  for (const kind of ["agreement", "relation", "dispute", "reputation", "proposal"] as const) assert.equal(validateDiplomacyQuery({ id: child, claimInheritanceAxis: "locatedInUuid" }, kind).ok, false);
  assert.equal(validateDiplomacyQuery({ claimInheritanceAxis: "locatedInUuid" }, "territory").ok, false);
});
test("G6 claims UI: provenance and propagation policy are distinct; concurrent IDs survive", () => {
  const html = renderTerritoryClaims(rows, "locatedInUuid", 10);
  assert.ok(html.includes("1 locais · 1 herdadas")); assert.ok(html.includes("<td>Local</td>")); assert.ok(html.includes("<td>Herdada</td>"));
  assert.equal((html.match(/<td>same-id<\/td>/g) ?? []).length, 2); assert.equal((html.match(/<td>Sim<\/td>/g) ?? []).length, 2);
  assert.ok(html.includes("revisão 4")); assert.ok(html.includes("Contestada")); assert.ok(html.includes("sem copiar registros"));
});
test("G6 claims UI: origin and all user-supplied labels are escaped", () => {
  const hostile = { ...rows[1], sourceTerritoryUuid: 'JournalEntry.x" onclick="bad', sourceTerritoryLabel: "<script>origin</script>",
    claim: { ...claim, id: "<script>id</script>", claimType: "<script>type</script>", claimantRef: { type: "narrative" as const, id: "<script>party</script>" } } };
  const html = renderTerritoryClaims([hostile], "administrativeParentUuid", 10); assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes(' onclick="bad'), false); assert.ok(html.includes("&lt;script&gt;")); assert.ok(html.includes('value="administrativeParentUuid" selected'));
});
test("G6 claims UI: empty visible set does not report hidden origins or completeness", () => {
  const html = renderTerritoryClaims([], "locatedInUuid", 0); assert.ok(html.includes("Nenhuma reivindicação vigente visível")); assert.ok(html.includes("tick 0")); assert.equal(html.includes("<tbody>"), false);
});
test("G6 claims UI: axis switch invalidates detail while retaining local action draft and history page", async () => {
  const { c, calls } = fixture(); c.occupationDraft = { reason: "Keep" }; c.historyOffset = 30;
  assert.equal(c.applyClaimInheritanceAxis("administrativeParentUuid").ok, true); assert.equal(c.detail, null); assert.deepEqual(c.occupationDraft, { reason: "Keep" }); assert.equal(c.historyOffset, 30);
  assert.equal((await c.load()).ok, true); const query = calls.find(p => p.id); assert.equal(query.claimInheritanceAxis, "administrativeParentUuid"); assert.equal(query.historyOffset, 30);
  assert.equal(c.detail.claims.length, 1); assert.equal(c.detail.effectiveClaims.length, 2); assert.equal(calls.some(p => !p.id && p.claimInheritanceAxis), false);
});
test("G6 claims UI: foreign axis or origin cannot navigate, and origin navigation keeps chosen axis", () => {
  const { c, detail } = fixture(); assert.equal(c.openClaimOrigin("JournalEntry.secret-marker").ok, false); assert.equal(c.selectedId, child); assert.equal(c.detail, detail);
  assert.equal(c.applyClaimInheritanceAxis("both").ok, false); assert.equal(c.detail, detail);
  c.claimInheritanceAxis = "administrativeParentUuid"; assert.equal(c.openClaimOrigin(parent).ok, true); assert.equal(c.selectedId, parent); assert.equal(c.detail, null); assert.equal(c.claimInheritanceAxis, "administrativeParentUuid");
  c.selectTab("agreements"); assert.equal(c.claimInheritanceAxis, "locatedInUuid"); assert.equal(c.applyClaimInheritanceAxis("locatedInUuid").ok, false); assert.equal(c.openClaimOrigin(parent).ok, false);
});
test("G6 claims UI: failed refresh removes previous inherited DTO", async () => {
  const { c, fail } = fixture(); fail(); assert.equal((await c.load()).ok, false); assert.equal(c.detail, null);
});
test("G6 claims bindings: selector and origin button route through admitted controller actions", async () => {
  const { api, detail } = fixture(), app = new DiplomacyApplication({ api }), listeners: Record<string, Function> = {}, saved = globalThis.FormData;
  app.controller.selectTab("territory"); app.controller.select(child); app.controller.detail = detail;
  (app as any).element = { addEventListener: (e: string, fn: Function) => listeners[e] = fn }; (app as any).render = async () => {};
  (globalThis as any).FormData = class { constructor(readonly form: any) {} forEach(fn: Function) { Object.entries(this.form.values).forEach(([k, v]) => fn(v, k)); } };
  try { (app as any)._onRender(); await listeners.submit({ target: { dataset: { dmForm: "claim-inheritance" }, values: { claimInheritanceAxis: "administrativeParentUuid" } }, preventDefault() {} });
    assert.equal(app.controller.claimInheritanceAxis, "administrativeParentUuid"); app.controller.detail = detail;
    await listeners.click({ target: { closest: () => ({ dataset: { dmClaimOrigin: parent } }) } }); assert.equal(app.controller.selectedId, parent);
  } finally { (globalThis as any).FormData = saved; }
});
