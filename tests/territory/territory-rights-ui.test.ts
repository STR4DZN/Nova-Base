import test from "node:test";
import assert from "node:assert/strict";
import { validateDiplomacyQuery } from "../../src/diplomacy/diplomacy-query.js";
import type { TerritoryRightView, TerritoryRightsReport } from "../../src/diplomacy/territory-rights-query.js";
import { renderTerritoryRights } from "../../src/ui/domain-patterns/diplomacy/territory-rights-view.js";
import { DiplomacyApplication, DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
import { ok } from "../../src/core/contracts/result.js";
const child = "JournalEntry.child", parent = "JournalEntry.parent";
const right: TerritoryRightView = { origin: { kind: "territory", id: parent, label: "Parent", revision: 4 }, sourceTerritoryUuid: parent,
  sourceTerritoryLabel: "Parent", sourceTerritoryRevision: 4, rightId: "same", rightType: "domain-manager:entry", beneficiaryRef: { type: "narrative", id: "Guild" },
  inherited: true, propagates: true, revocable: true, sourceActive: true, startsAtWorldTick: 0, expiresAtWorldTick: 20, grants: [], status: "effective", conditions: [] };
const treaty: TerritoryRightView = { ...right, origin: { kind: "agreement", id: "treaty", label: "Treaty", revision: 8 }, grants: ["test:construction"] };
const report = (entries: readonly TerritoryRightView[]): TerritoryRightsReport => ({ axis: "locatedInUuid", worldTick: 10, effectiveCount: entries.filter(r => r.status === "effective").length, entries });
function fixture() {
  const calls: any[] = []; let fail = false;
  const detail = { id: child, revision: 1, territory: { uuid: child, label: "Child", locatedInUuid: parent, administrativeParentUuid: null },
    worldTick: 10, rights: [], claims: [], territoryRights: report([right, treaty]), links: [], occupations: [], presence: [] };
  const api: any = { territory: { query: async (p: any) => { calls.push(p); return p.id ? fail ? { ok: false, error: { message: "Unavailable" } } : ok({ ...detail, territoryRights: { ...detail.territoryRights, axis: p.rightInheritanceAxis } }) : ok({ items: [], isGm: true, worldTick: 10 }); } }, agreements: { query: async (p: any) => { calls.push(p); return ok(p.id ? { id: p.id } : { items: [], isGm: true }); } } };
  const c = new DiplomacyApplicationController(api); c.selectTab("territory"); c.select(child); c.detail = detail;
  return { c, api, calls, detail, fail: () => fail = true };
}
test("G6 rights UI: axis validation requires territory detail and permits independent claim axis", () => {
  for (const rightInheritanceAxis of ["locatedInUuid", "administrativeParentUuid"]) assert.equal(validateDiplomacyQuery({ id: child, rightInheritanceAxis, claimInheritanceAxis: "locatedInUuid" }, "territory").ok, true);
  for (const rightInheritanceAxis of ["both", "", 1, null, []]) assert.equal(validateDiplomacyQuery({ id: child, rightInheritanceAxis }, "territory").ok, false);
  for (const kind of ["agreement", "relation", "reputation", "proposal", "dispute"] as const) assert.equal(validateDiplomacyQuery({ id: child, rightInheritanceAxis: "locatedInUuid" }, kind).ok, false);
  assert.equal(validateDiplomacyQuery({ rightInheritanceAxis: "locatedInUuid" }, "territory").ok, false);
});
test("G6 rights UI: no-grant rights and identical IDs from different origins remain distinct", () => {
  const html = renderTerritoryRights(report([right, treaty]));
  for (const text of ["2 direitos efetivos", "Entrada", "Nenhuma", "test:construction", "revisão 4", "revisão 8", "Âmbito:", "não representam a resolução final", "sem copiar registros locais"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<small>same<\/small>/g) ?? []).length, 2); assert.ok(html.includes('data-dm-right-kind="agreement"'));
});
test("G6 rights UI: every ineffective reason and condition outcome is shown separately", () => {
  const statuses = ["inactive", "source-inactive", "scheduled", "expired", "conditions-unconfirmed"] as const;
  const html = renderTerritoryRights(report(statuses.map((status, i) => ({ ...right, status, conditions: [{ ref: { type: "requirement", id: `check-${i}` }, confirmed: i === 0 ? null : i === 1 ? true : false }] }))));
  for (const text of ["Nenhum direito efetivo", "<details>", "Outros direitos visíveis: 5", "Inativo", "Acordo sem vigência ativa", "Agendado", "Expirado", "Condições não confirmadas", "Não avaliada", "Confirmada", "Não confirmada", "fim exclusivo"]) assert.ok(html.includes(text), text);
});
test("G6 rights UI: beneficiary reference variants retain their distinguishing identifiers", () => {
  const refs = [{ type: "domain", uuid: child }, { type: "people", id: "people-id", domainUuid: child }, { type: "member", id: "member-id", domainUuid: child },
    { type: "actor", uuid: "Actor.hero" }, { type: "organization", id: "org-id" }, { type: "narrative", id: "narrative-id" }];
  const html = renderTerritoryRights(report(refs.map(beneficiaryRef => ({ ...right, beneficiaryRef }))));
  for (const ref of refs) assert.ok(html.includes(`${ref.type}: ${ref.uuid ?? ref.id}`)); assert.ok(html.includes(`(${child})`));
});
test("G6 rights UI: all source, beneficiary, condition and capability text is escaped", () => {
  const bad = '<script>bad</script>', html = renderTerritoryRights(report([{ ...right, rightId: bad, rightType: bad,
    origin: { ...right.origin, id: 'x" onclick="bad', label: bad }, sourceTerritoryLabel: bad, sourceTerritoryUuid: bad,
    beneficiaryRef: { type: "narrative", id: bad }, grants: [bad], conditions: [{ ref: { type: bad, id: bad }, confirmed: false }] }]));
  assert.equal(html.includes("<script>"), false); assert.equal(html.includes(' onclick="bad'), false); assert.ok(html.includes("&lt;script&gt;"));
});
test("G6 rights UI: independent axis reload preserves local draft and sends filters only with detail", async () => {
  const { c, calls } = fixture(); c.historyOffset = 30; c.occupationDraft = { reason: "Keep" };
  assert.equal(c.applyRightInheritanceAxis("administrativeParentUuid").ok, true); assert.equal(c.detail, null); assert.equal(c.claimInheritanceAxis, "locatedInUuid");
  assert.deepEqual(c.occupationDraft, { reason: "Keep" }); unwrap(await c.load()); const query = calls.find(p => p.id);
  assert.equal(query.rightInheritanceAxis, "administrativeParentUuid"); assert.equal(query.claimInheritanceAxis, "locatedInUuid"); assert.equal(query.historyOffset, 30);
  assert.equal(c.detail.rights.length, 0); assert.equal(calls.some(p => !p.id && p.rightInheritanceAxis), false);
});
const unwrap = (r: any) => { assert.equal(r.ok, true); return r.value; };
test("G6 rights UI: admitted origins navigate to matching inspector and requery", async () => {
  const { c, detail, calls } = fixture(); assert.equal(c.openRightOrigin("agreement", parent).ok, false); assert.equal(c.openRightOrigin("territory", "hidden").ok, false);
  c.rightInheritanceAxis = "administrativeParentUuid"; assert.equal(c.openRightOrigin("territory", parent).ok, true); assert.equal(c.rightInheritanceAxis, "administrativeParentUuid"); assert.equal(c.detail, null);
  unwrap(await c.load()); assert.equal(calls.find(p => p.id).id, parent); c.detail = detail;
  assert.equal(c.openRightOrigin("agreement", "treaty").ok, true); assert.equal(c.tab, "agreements"); assert.equal(c.selectedId, "treaty"); assert.equal(c.detail, null);
  unwrap(await c.load()); assert.equal(c.detail.id, "treaty"); assert.equal(c.rightInheritanceAxis, "locatedInUuid");
});
test("G6 rights UI: invalid axis and failed refresh cannot preserve stale rights", async () => {
  const { c, detail, fail } = fixture(); assert.equal(c.applyRightInheritanceAxis("both").ok, false); assert.equal(c.detail, detail);
  fail(); assert.equal((await c.load()).ok, false); assert.equal(c.detail, null); assert.equal(c.openRightOrigin("territory", parent).ok, false);
  c.selectTab("agreements"); assert.equal(c.applyRightInheritanceAxis("locatedInUuid").ok, false);
});
test("G6 rights bindings: form and origin buttons route through authenticated controller state", async () => {
  const { api, detail } = fixture(), app = new DiplomacyApplication({ api }), listeners: Record<string, Function> = {}, saved = globalThis.FormData;
  app.controller.selectTab("territory"); app.controller.select(child); app.controller.detail = detail;
  (app as any).element = { addEventListener: (e: string, fn: Function) => listeners[e] = fn }; (app as any).render = async () => {};
  (globalThis as any).FormData = class { constructor(readonly form: any) {} forEach(fn: Function) { Object.entries(this.form.values).forEach(([k, v]) => fn(v, k)); } };
  try { (app as any)._onRender(); await listeners.submit({ target: { dataset: { dmForm: "right-inheritance" }, values: { rightInheritanceAxis: "administrativeParentUuid" } }, preventDefault() {} });
    assert.equal(app.controller.rightInheritanceAxis, "administrativeParentUuid"); app.controller.detail = detail;
    await listeners.click({ target: { closest: () => ({ dataset: { dmRightOrigin: "treaty", dmRightKind: "agreement" } }) } }); assert.equal(app.controller.tab, "agreements"); assert.equal(app.controller.selectedId, "treaty");
  } finally { (globalThis as any).FormData = saved; }
});
