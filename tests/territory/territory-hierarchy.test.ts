import test from "node:test";
import assert from "node:assert/strict";
import type { Result } from "../../src/core/contracts/result.js";
import { validateTerritory, validateTerritoryGraph, territoryAncestors, previewTerritoryReparent, commitTerritoryReparent,
  type Territory, type TerritoryReparentContext } from "../../src/territory/territory-hierarchy.js";
export const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
export const territory = (id: string, parents: Partial<Territory> = {}): Territory => ({ schemaVersion: 1, uuid: `JournalEntry.${id}`,
  revision: 0, label: id, kind: "domain-manager:region", scale: "region", visibility: "public", createdAt: 0, updatedAt: 0,
  locatedInUuid: null, administrativeParentUuid: null, geography: {}, hierarchyHistory: [], ...parents });
const context: TerritoryReparentContext = { expectedRevision: 0, eventId: "event", at: 10, worldTick: 2, reason: "GM relocation",
  sourceRefs: [{ type: "manual", id: "gm" }] };
test("G6.6: roots and divergent physical/admin parents survive JSON roundtrip", () => {
  const graph = [territory("root"), territory("admin"), territory("city", { locatedInUuid: "JournalEntry.root", administrativeParentUuid: "JournalEntry.admin" })];
  assert.deepEqual(unwrap(validateTerritoryGraph(JSON.parse(JSON.stringify(graph)))), graph);
  assert.deepEqual(unwrap(territoryAncestors(graph, "JournalEntry.city", "locatedInUuid")), ["JournalEntry.root"]);
  assert.deepEqual(unwrap(territoryAncestors(graph, "JournalEntry.city", "administrativeParentUuid")), ["JournalEntry.admin"]);
});
test("G6.6: each ancestry axis rejects cycles and dangling parents", () => {
  for (const axis of ["locatedInUuid", "administrativeParentUuid"] as const) {
    assert.equal(validateTerritoryGraph([territory("a", { [axis]: "JournalEntry.b" }), territory("b", { [axis]: "JournalEntry.a" })]).ok, false);
    assert.equal(validateTerritoryGraph([territory("a", { [axis]: "JournalEntry.missing" })]).ok, false);
    assert.equal(validateTerritory(territory("a", { [axis]: "JournalEntry.a" })).ok, false);
  }
});
test("G6.6: cross-axis references are not falsely interpreted as cycles", () => {
  assert.equal(validateTerritoryGraph([territory("a", { locatedInUuid: "JournalEntry.b" }), territory("b", { administrativeParentUuid: "JournalEntry.a" })]).ok, true);
});
test("G6.6: duplicate identities and malformed scalar/reference/timestamp inputs fail closed", () => {
  assert.equal(validateTerritoryGraph([territory("a"), territory("a")]).ok, false);
  for (const patch of [{ revision: -1 }, { revision: 0.5 }, { uuid: "Actor.a" }, { visibility: "unknown" }, { updatedAt: -1 }, { kind: "region" }, { label: " " }])
    assert.equal(validateTerritory({ ...territory("a"), ...patch }).ok, false);
  assert.equal(territoryAncestors([], "JournalEntry.a", "locatedInUuid").ok, false);
});
test("G6.6: reparent preview is pure and reports separate descendant inheritance impacts", () => {
  const graph = [territory("a"), territory("b"), territory("child", { locatedInUuid: "JournalEntry.a" }),
    territory("admin", { administrativeParentUuid: "JournalEntry.a" })], before = structuredClone(graph);
  const plan = unwrap(previewTerritoryReparent(graph, "JournalEntry.a", { locatedInUuid: "JournalEntry.b", administrativeParentUuid: null }, context));
  assert.deepEqual(graph, before); assert.deepEqual(plan.affectedPhysicalDescendants, ["JournalEntry.child"]);
  assert.deepEqual(plan.affectedAdministrativeDescendants, ["JournalEntry.admin"]); assert.equal(plan.inheritedStateRequiresRecalculation, true);
  const next = unwrap(commitTerritoryReparent(graph, plan)), a = next.find(t => t.uuid === "JournalEntry.a")!;
  assert.equal(a.revision, 1); assert.equal(a.hierarchyHistory[0].before.locatedInUuid, null);
  assert.equal(a.hierarchyHistory[0].after.locatedInUuid, "JournalEntry.b"); assert.deepEqual(graph, before);
});
test("G6.6: stale preview catches target, parent and graph topology changes", () => {
  const graph = [territory("a"), territory("b")], plan = unwrap(previewTerritoryReparent(graph, "JournalEntry.a",
    { locatedInUuid: "JournalEntry.b", administrativeParentUuid: null }, context));
  assert.equal(commitTerritoryReparent([graph[0], { ...graph[1], revision: 1 }], plan).ok, false);
  assert.equal(commitTerritoryReparent([...graph, territory("c")], plan).ok, false);
  assert.equal(previewTerritoryReparent(graph, "JournalEntry.a", plan.after, { ...context, expectedRevision: 1 }).ok, false);
});
test("G6.6: reparent cycles and missing parent are blocked before any history mutation", () => {
  const graph = [territory("a"), territory("b", { locatedInUuid: "JournalEntry.a" })];
  for (const locatedInUuid of ["JournalEntry.b", "JournalEntry.missing"])
    assert.equal(previewTerritoryReparent(graph, "JournalEntry.a", { locatedInUuid, administrativeParentUuid: null }, context).ok, false);
  assert.equal(graph[0].hierarchyHistory.length, 0);
});
test("G6.6: audited second reparent keeps both events; forged history is rejected", () => {
  let graph: readonly Territory[] = [territory("a"), territory("b")];
  graph = unwrap(commitTerritoryReparent(graph, unwrap(previewTerritoryReparent(graph, "JournalEntry.a", { locatedInUuid: "JournalEntry.b", administrativeParentUuid: null }, context))));
  graph = unwrap(commitTerritoryReparent(graph, unwrap(previewTerritoryReparent(graph, "JournalEntry.a", { locatedInUuid: null, administrativeParentUuid: null },
    { ...context, expectedRevision: 1, eventId: "next", at: 11 }))));
  const a = graph[0]; assert.equal(a.hierarchyHistory.length, 2);
  assert.equal(validateTerritory({ ...a, locatedInUuid: "JournalEntry.b" }).ok, false);
  assert.equal(validateTerritory({ ...a, hierarchyHistory: [a.hierarchyHistory[0], a.hierarchyHistory[0]] }).ok, false);
});
test("G6.6: no-op does not increment revision or manufacture history", () => {
  const graph = [territory("a")], plan = unwrap(previewTerritoryReparent(graph, "JournalEntry.a", { locatedInUuid: null, administrativeParentUuid: null }, context));
  assert.equal(plan.inheritedStateRequiresRecalculation, false); assert.strictEqual(unwrap(commitTerritoryReparent(graph, plan)), graph);
});
test("G6.6: malformed audit contexts, reversed timestamps and repeated event IDs fail closed", () => {
  const graph = [territory("a"), territory("b")], parents = { locatedInUuid: "JournalEntry.b", administrativeParentUuid: null };
  for (const patch of [{ reason: "" }, { at: -1 }, { worldTick: -1 }, { sourceRefs: [] }, { eventId: " " }])
    assert.equal(previewTerritoryReparent(graph, "JournalEntry.a", parents, { ...context, ...patch }).ok, false);
});
test("G6.6: long physical hierarchy validates without recursion overflow", () => {
  const graph = Array.from({ length: 5000 }, (_, i) => territory(`node${i}`, { locatedInUuid: i === 0 ? null : `JournalEntry.node${i - 1}` }));
  assert.equal(validateTerritoryGraph(graph).ok, true);
  assert.equal(unwrap(territoryAncestors(graph, "JournalEntry.node4999", "locatedInUuid")).length, 4999);
});
