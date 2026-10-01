import test from "node:test";
import assert from "node:assert/strict";
import { previewTerritoryRightsImpact, rightConditionContext } from "../../src/territory/territory-rights-impact.js";
import { emptyTerritoryState, type TerritoryRight, type TerritoryState } from "../../src/territory/territory-state.js";
import { createDiplomacyDraft } from "../../src/diplomacy/diplomacy-drafts.js";
import { territoryPreviewSnapshot } from "../../src/diplomacy/territory-preview-snapshot.js";
import { renderTerritoryPreview } from "../../src/ui/domain-patterns/diplomacy/territory-claims-preview.js";
import { renderTerritoryRightsPreview } from "../../src/ui/domain-patterns/diplomacy/territory-rights-preview.js";
import { DiplomacyApplicationController } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
import { ok } from "../../src/core/contracts/result.js";
const id = (s: string) => `JournalEntry.${s}`, unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const right = (name = "same", patch = {}): TerritoryRight => ({ id: name, sourceRef: { type: "manual", id: "gm" }, visibility: "public", startsAtWorldTick: 0,
  expiresAtWorldTick: null, beneficiaryRef: { type: "narrative", id: "Guild" }, rightType: "test:entry", inherited: true, revocable: true, active: true, conditionRefs: [], grants: [], ...patch });
const state = (name: string, physical: string | null = null, admin: string | null = null, rights: TerritoryRight[] = []): TerritoryState => ({
  ...emptyTerritoryState({ schemaVersion: 1, uuid: id(name), revision: 0, label: name, kind: "test:region", scale: "region", visibility: "public", createdAt: 0, updatedAt: 0,
    locatedInUuid: physical && id(physical), administrativeParentUuid: admin && id(admin), geography: {}, hierarchyHistory: [] }), rights });
function agreement(name: string, scope: string, patch = {}) {
  const data: any = createDiplomacyDraft("agreement", name, [{ type: "narrative", id: "Guild" }, { type: "narrative", id: "Partner" }], "public").data;
  Object.assign(data.state.agreement, { id: name, lifecycle: "active", revision: 7, terms: [{ id: "same", type: "domain-manager:right", title: "Right", text: null, partyIds: ["party-0"], visibility: "public",
    payload: { beneficiaryPartyId: "party-0", territoryUuid: id(scope), rightType: "test:trade", startsAtWorldTick: null, expiresAtWorldTick: null, inherited: true, revocable: true, conditionRefs: [], grants: [], ...patch } }] });
  return data;
}
function graphs(physical: string | null = "new", admin: string | null = "admin-old") {
  const before = [state("root", null, null, [right("common")]), state("old", "root", null, [right()]), state("new", "root", null, [right("same", { grants: ["test:construction"] })]),
    state("admin-old", null, null, [right("admin-old")]), state("admin-new", null, null, [right("admin-new")]), state("target", "old", "admin-old", [right()]),
    state("physical-child", "target", "admin-new", [right("child-local")]), state("grandchild", "physical-child"), state("admin-child", "new", "target"), state("unrelated", "old")];
  const after = before.map(s => s.territory.uuid === id("target") ? { ...s, territory: { ...s.territory, revision: 1, locatedInUuid: physical && id(physical), administrativeParentUuid: admin && id(admin) } } : s);
  const agreements = [agreement("old-treaty", "old"), agreement("new-treaty", "new"), agreement("common-treaty", "root"), agreement("local-treaty", "target")];
  const conditions = rightConditionContext();
  return { before, after, agreements, conditions, impact: () => unwrap(previewTerritoryRightsImpact(before, after, agreements, id("target"), 10, conditions)) };
}
test("G6 rights impacts: territory and treaty provenance survive equal IDs, empty grants and common ancestors", () => {
  const g = graphs(), original = structuredClone({ before: g.before, after: g.after, agreements: g.agreements }), result = g.impact(), target = result.axes[0].territories[0];
  assert.deepEqual(target.removed.map((r: any) => r.origin.id), [id("old"), "old-treaty"]); assert.deepEqual(target.added.map((r: any) => r.origin.id), [id("new"), "new-treaty"]);
  assert.deepEqual(target.retained.map((r: any) => r.origin.id), [id("root"), "common-treaty"]); assert.equal(target.localCount, 2);
  assert.ok(target.removed.every((r: any) => !r.grants.length)); assert.deepEqual(target.added[0].grants, ["test:construction"]); assert.equal(target.added[1].origin.revision, 7);
  assert.ok(Object.isFrozen(result.axes[0].territories[0].added)); assert.deepEqual({ before: g.before, after: g.after, agreements: g.agreements }, original);
});
test("G6 rights impacts: descendants include inherited target sources while their local rights stay local", () => {
  const result = graphs().impact(), axis = result.axes[0]; assert.deepEqual(axis.territories.map((r: any) => r.territoryUuid), [id("target"), id("physical-child"), id("grandchild")]);
  const child = axis.territories[1]; assert.equal(child.localCount, 1); assert.ok(child.retained.some((r: any) => r.origin.id === id("target") && r.origin.revision === 1));
  assert.ok(child.retained.some((r: any) => r.origin.id === "local-treaty")); assert.equal(child.added.some((r: any) => r.rightId === "child-local"), false);
});
test("G6 rights impacts: physical and administrative subtrees are independent", () => {
  const g = graphs("old", "admin-new"); g.agreements.push(agreement("admin-old-treaty", "admin-old"), agreement("admin-new-treaty", "admin-new"));
  const result = g.impact(); assert.equal(result.axes[0].changed, false); assert.deepEqual(result.axes[0].territories, []);
  assert.deepEqual(result.axes[1].territories.map((r: any) => r.territoryUuid), [id("target"), id("admin-child")]);
  assert.deepEqual(result.axes[1].territories[0].removed.map((r: any) => r.origin.id), [id("admin-old"), "admin-old-treaty"]);
});
test("G6 rights impacts: two axes, root detachment and no-op have explicit outcomes", () => {
  const result = graphs(null, null).impact(); assert.ok(result.axes.every((a: any) => a.changed)); assert.equal(result.axes[0].territories[0].after.length, 0);
  assert.ok(result.axes[0].territories[1].retained.some((r: any) => r.origin.id === "local-treaty"));
  assert.ok(graphs("old").impact().axes.every((a: any) => !a.changed && a.territories.length === 0));
});
test("G6 rights impacts: active inclusive start, exclusive end and propagation apply to both source kinds", () => {
  const g = graphs(), old = g.before.find(s => s.territory.uuid === id("old"))!;
  (old as any).rights.push(right("expired", { expiresAtWorldTick: 10 }), right("future", { startsAtWorldTick: 11 }), right("inactive", { active: false }), right("non-propagating", { inherited: false }), right("secret", { visibility: "secret", startsAtWorldTick: 10 }));
  g.agreements.push(agreement("expired-treaty", "old", { expiresAtWorldTick: 10 }), agreement("future-treaty", "old", { startsAtWorldTick: 11 }), agreement("non-propagating-treaty", "old", { inherited: false }));
  const result = g.impact().axes[0].territories[0]; assert.deepEqual(result.removed.map((r: any) => r.rightId), ["same", "secret", "same"]);
  const expired = g.agreements[0]; expired.state.agreement.duration.expiresAtWorldTick = 10;
  assert.equal(g.impact().axes[0].territories[0].removed.some((r: any) => r.origin.id === "old-treaty"), false);
});
test("G6 rights impacts: suspended/pending sources and capability-only terms confer no rights", () => {
  const g = graphs(); g.agreements[0].state.agreement.lifecycle = "suspended"; g.agreements[1].state.agreement.lifecycle = "pendingApproval";
  const capability = agreement("capability-only", "old"); capability.state.agreement.terms = [{ id: "cap", type: "domain-manager:capability", title: "Capability", text: null, partyIds: ["party-0"], visibility: "public", payload: { beneficiaryPartyId: "party-0", capabilityIds: ["test:capability"], scopeRef: null, conditionRefs: [] } }];
  g.agreements.push(capability); assert.equal(g.impact().axes[0].territories[0].added.some((r: any) => r.origin.id === "new-treaty"), false); assert.deepEqual(g.impact().axes[0].territories[0].removed.map((r: any) => r.origin.id), [id("old")]);
});
test("G6 rights impacts: memoized sanitized conditions are stable across all descendants and both graphs", () => {
  const g = graphs("new", "admin-new"), ref = { type: "requirement", id: "shared", privateMetadata: "private-marker" }, calls: any[] = [];
  (g.before[1] as any).rights[0].conditionRefs = [ref]; g.agreements[1].state.agreement.terms[0].payload.conditionRefs = [ref];
  const conditions = rightConditionContext(r => { calls.push(r); return true; }); const result = unwrap(previewTerritoryRightsImpact(g.before, g.after, g.agreements, id("target"), 10, conditions));
  assert.equal(result.axes[0].territories[0].removed[0].conditions[0].confirmed, true); assert.deepEqual(calls, [{ type: "requirement", id: "shared" }]); assert.equal(JSON.stringify(result).includes("private-marker"), false);
  assert.deepEqual(conditions.evaluations(), [{ key: '{"id":"shared","type":"requirement"}', confirmed: true }]);
});
test("G6 rights impacts: false, non-boolean, throwing and missing providers never authorize rights", () => {
  for (const provider of [undefined, () => false, () => 1 as any, () => { throw Error("private-error"); }]) {
    const g = graphs(); g.agreements[0].state.agreement.terms[0].payload.conditionRefs = [{ type: "requirement", id: "check" }];
    const result = unwrap(previewTerritoryRightsImpact(g.before, g.after, g.agreements, id("target"), 10, rightConditionContext(provider)));
    assert.equal(result.axes[0].territories[0].removed.some((r: any) => r.origin.id === "old-treaty"), false); assert.equal(JSON.stringify(result).includes("private-error"), false);
  }
});
test("G6 rights impacts: invalid time, state, cycle, missing parent or duplicate agreement fails closed", () => {
  for (const tick of [-1, 0.5, NaN]) { const g = graphs(); assert.equal(previewTerritoryRightsImpact(g.before, g.after, g.agreements, id("target"), tick).ok, false); }
  for (const parent of ["missing", "grandchild"]) { const g = graphs(parent); assert.equal(previewTerritoryRightsImpact(g.before, g.after, g.agreements, id("target"), 10).ok, false); }
  const g = graphs(); g.agreements.push(g.agreements[0]); assert.equal(previewTerritoryRightsImpact(g.before, g.after, g.agreements, id("target"), 10).ok, false);
  g.agreements.pop(); g.agreements[0].state.agreement.terms[0].payload.rightType = 1; assert.equal(previewTerritoryRightsImpact(g.before, g.after, g.agreements, id("target"), 10).ok, false);
});
test("G6 rights impact snapshot: catalog and condition results invalidate confirmation, enumeration order does not", () => {
  const g = graphs(), intent: any = { id: id("target"), expectedRevision: 0, action: { kind: "reparent", parents: {} }, reason: "Move" }, confirmed = [{ key: "a", confirmed: true }, { key: "b", confirmed: false }];
  const snapshot = territoryPreviewSnapshot(intent, g.before, 10, { agreements: g.agreements, conditions: confirmed });
  assert.deepEqual(snapshot, territoryPreviewSnapshot(intent, [...g.before].reverse(), 10, { agreements: [...g.agreements].reverse(), conditions: [...confirmed].reverse() }));
  assert.notEqual(snapshot.fingerprint, territoryPreviewSnapshot(intent, g.before, 10, { agreements: g.agreements, conditions: [{ key: "a", confirmed: false }, confirmed[1]] }).fingerprint);
  g.agreements[0].state.agreement.terms[0].payload.grants.push("test:added"); assert.notEqual(snapshot.fingerprint, territoryPreviewSnapshot(intent, g.before, 10, { agreements: g.agreements, conditions: confirmed }).fingerprint);
});
test("G6 rights preview UI: provenance, beneficiaries, grants and local preservation render distinctly", () => {
  const impact = graphs().impact(), html = renderTerritoryRightsPreview(impact);
  for (const value of ["Recebido", "Perdido", "Mantido", "Território", "Acordo", "Guild", "revisão 7", "2 direitos locais efetivos preservados", "Nenhuma", "test:construction", "fim exclusivo", "não calcula a resolução final"]) assert.ok(html.includes(value), value);
  const combined = renderTerritoryPreview({ changes: [], rightInheritanceImpact: impact }); assert.ok(combined.includes("Impactos nos direitos herdados"));
});
test("G6 rights preview UI: source, condition and beneficiary text is escaped; empty/no-op remain explicit", () => {
  const impact = structuredClone(graphs().impact()), r = impact.axes[0].territories[0].added[0]; r.origin.label = '<script>"'; r.sourceTerritoryLabel = "<script>"; r.rightId = "<script>"; r.grants = ["<script>"];
  r.beneficiaryRef.id = "<script>"; r.conditions = [{ ref: { type: "requirement", id: "<script>" }, confirmed: true }];
  const html = renderTerritoryRightsPreview(impact); assert.equal(html.includes("<script>"), false); assert.ok(html.includes("&lt;script&gt;")); assert.ok(html.includes("Confirmada"));
  assert.ok(renderTerritoryRightsPreview(graphs("old").impact()).includes("Sem alteração neste eixo"));
  const g = graphs(null, null); g.before.forEach(s => (s as any).rights = []); g.agreements.length = 0; assert.ok(renderTerritoryRightsPreview(g.impact()).includes("Nenhum direito herdado efetivo"));
});
test("G6 rights preview UI: incomplete rights preview cannot authorize a reparent confirmation", async () => {
  const calls: any[] = [], api: any = { previewTerritory: async () => ok({ claimInheritanceImpact: {}, previewSnapshot: { worldTick: 10, fingerprint: "fp_0123456789abcdef" } }),
    territory: { modify: async (p: any) => { calls.push(p); return ok({}); } } }, c = new DiplomacyApplicationController(api);
  c.selectTab("territory"); c.detail = { id: id("target"), revision: 0 }; c.list = { isGm: true };
  const fields = { kind: "reparent", physical: id("new"), administrative: "", reason: "Move" };
  assert.equal((await c.change(fields, true)).ok, false); assert.equal(c.preview, null); assert.equal((await c.change(fields)).ok, false); assert.equal(calls.length, 0);
});
