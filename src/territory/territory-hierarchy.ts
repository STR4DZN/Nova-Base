import { ok, type Result } from "../core/contracts/result.js";
import { isJournalEntryUuid, type TypedRef } from "../core/identity/refs.js";
import { failure, immutable, isJsonData, isNamespaced, isRecord, isText, isTimestamp, isTypedRef, isVisibility, revisionGuard } from "../core/validation/value-validation.js";
import type { RelationVisibility } from "../relations/types/relation-types.js";

/** One spatial hierarchy, shared by locations and territories. Administrative ancestry is independent. */
export interface TerritoryParents { readonly locatedInUuid: string | null; readonly administrativeParentUuid: string | null; }
export interface TerritoryHierarchyEvent {
  readonly id: string; readonly at: number; readonly worldTick: number; readonly reason: string;
  readonly sourceRefs: readonly TypedRef[]; readonly before: TerritoryParents; readonly after: TerritoryParents;
}
export interface Territory extends TerritoryParents {
  readonly schemaVersion: 1; readonly uuid: string; readonly revision: number; readonly label: string;
  readonly kind: string; readonly scale: string; readonly visibility: RelationVisibility;
  readonly createdAt: number; readonly updatedAt: number; readonly geography: Readonly<Record<string, unknown>>;
  readonly hierarchyHistory: readonly TerritoryHierarchyEvent[];
}
export type TerritoryParentAxis = keyof TerritoryParents;
const parentsValid = (p: unknown): p is TerritoryParents => isRecord(p)
  && (p.locatedInUuid === null || isJournalEntryUuid(p.locatedInUuid))
  && (p.administrativeParentUuid === null || isJournalEntryUuid(p.administrativeParentUuid));
const sameParents = (a: TerritoryParents, b: TerritoryParents) => a.locatedInUuid === b.locatedInUuid && a.administrativeParentUuid === b.administrativeParentUuid;
const parentsOf = (t: Territory): TerritoryParents => ({ locatedInUuid: t.locatedInUuid, administrativeParentUuid: t.administrativeParentUuid });
export function validateTerritory(raw: unknown): Result<Territory> {
  if (!isRecord(raw) || !isJsonData(raw) || raw.schemaVersion !== 1 || !isJournalEntryUuid(raw.uuid)
    || !isTimestamp(raw.revision) || !isText(raw.label) || !isNamespaced(raw.kind) || !isText(raw.scale)
    || !isVisibility(raw.visibility) || !parentsValid(raw) || raw.locatedInUuid === raw.uuid || raw.administrativeParentUuid === raw.uuid
    || !isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt) || raw.updatedAt < raw.createdAt
    || !isRecord(raw.geography) || !Array.isArray(raw.hierarchyHistory))
    return failure("DM_TERRITORY_INVALID", "Invalid territory identity, hierarchy or metadata");
  let before: TerritoryParents | null = null, at = raw.createdAt; const ids = new Set<string>();
  for (const e of raw.hierarchyHistory) {
    if (!isRecord(e) || !isText(e.id) || ids.has(e.id) || !isTimestamp(e.at) || e.at < at || e.at > raw.updatedAt
      || !isTimestamp(e.worldTick) || !isText(e.reason) || !Array.isArray(e.sourceRefs) || !e.sourceRefs.length || !e.sourceRefs.every(isTypedRef)
      || !parentsValid(e.before) || !parentsValid(e.after) || sameParents(e.before, e.after)
      || (before !== null && !sameParents(before, e.before)) || e.after.locatedInUuid === raw.uuid || e.after.administrativeParentUuid === raw.uuid)
      return failure("DM_TERRITORY_HISTORY_INVALID", "Invalid hierarchy audit chain");
    before = e.after; at = e.at; ids.add(e.id);
  }
  if (before !== null && !sameParents(before, raw as unknown as Territory)) return failure("DM_TERRITORY_HISTORY_INVALID", "Hierarchy differs from latest audited change");
  if (raw.revision < raw.hierarchyHistory.length) return failure("DM_TERRITORY_HISTORY_INVALID", "Revision precedes hierarchy events");
  return ok(immutable(structuredClone(raw)) as unknown as Territory);
}
/** Iterative graph validation: long ancestry chains never recurse through the JS call stack. */
export function validateTerritoryGraph(input: readonly Territory[]): Result<readonly Territory[]> {
  const nodes = new Map<string, Territory>();
  for (const t of input) {
    const valid = validateTerritory(t); if (!valid.ok) return valid;
    if (nodes.has(t.uuid)) return failure("DM_TERRITORY_DUPLICATE", "Duplicate spatial entity");
    nodes.set(t.uuid, valid.value);
  }
  for (const axis of ["locatedInUuid", "administrativeParentUuid"] as const) {
    const done = new Set<string>();
    for (const t of nodes.values()) {
      const path = new Set<string>(); let current: Territory | undefined = t;
      while (current && !done.has(current.uuid)) {
        if (path.has(current.uuid)) return failure("DM_TERRITORY_CYCLE", "Spatial or administrative hierarchy contains a cycle");
        path.add(current.uuid); const parent: string | null = current[axis];
        if (parent !== null && !nodes.has(parent)) return failure("DM_TERRITORY_PARENT_MISSING", "Referenced parent is unavailable", "not-found");
        current = parent === null ? undefined : nodes.get(parent);
      }
      for (const uuid of path) done.add(uuid);
    }
  }
  return ok(immutable([...nodes.values()]));
}
export function territoryAncestors(graph: readonly Territory[], uuid: string, axis: TerritoryParentAxis): Result<readonly string[]> {
  const nodes = new Map(graph.map(t => [t.uuid, t])), result: string[] = [], seen = new Set<string>([uuid]);
  let node = nodes.get(uuid); if (!node) return failure("DM_TERRITORY_NOT_FOUND", "Territory unavailable", "not-found");
  while (node[axis] !== null) {
    const parent = node[axis]!;
    if (seen.has(parent)) return failure("DM_TERRITORY_CYCLE", "Hierarchy contains a cycle");
    seen.add(parent); result.push(parent); node = nodes.get(parent);
    if (!node) return failure("DM_TERRITORY_PARENT_MISSING", "Parent unavailable", "not-found");
  }
  return ok(result);
}
export interface TerritoryReparentContext {
  readonly expectedRevision: number; readonly eventId: string; readonly at: number; readonly worldTick: number;
  readonly reason: string; readonly sourceRefs: readonly TypedRef[];
}
export interface TerritoryReparentPlan {
  readonly territoryUuid: string; readonly expectedRevisions: Readonly<Record<string, number>>;
  readonly before: TerritoryParents; readonly after: TerritoryParents;
  readonly affectedPhysicalDescendants: readonly string[]; readonly affectedAdministrativeDescendants: readonly string[];
  readonly inheritedStateRequiresRecalculation: boolean; readonly context: TerritoryReparentContext;
}
export function previewTerritoryReparent(graph: readonly Territory[], uuid: string, after: TerritoryParents, c: TerritoryReparentContext): Result<TerritoryReparentPlan> {
  const valid = validateTerritoryGraph(graph); if (!valid.ok) return valid;
  const t = graph.find(x => x.uuid === uuid); if (!t) return failure("DM_TERRITORY_NOT_FOUND", "Territory unavailable", "not-found");
  const stale = revisionGuard(t.revision, c.expectedRevision); if (stale) return stale;
  if (!parentsValid(after) || !isText(c.eventId) || t.hierarchyHistory.some(e => e.id === c.eventId)
    || !isTimestamp(c.at) || c.at < t.updatedAt || !isTimestamp(c.worldTick) || !isText(c.reason)
    || !Array.isArray(c.sourceRefs) || !c.sourceRefs.length || !c.sourceRefs.every(isTypedRef))
    return failure("DM_TERRITORY_REPARENT_INVALID", "Reparent requires valid parents, revision and audit context");
  const before = parentsOf(t), changed = !sameParents(before, after);
  const next: Territory = changed ? { ...t, ...after, revision: t.revision + 1, updatedAt: c.at,
    hierarchyHistory: [...t.hierarchyHistory, { id: c.eventId, at: c.at, worldTick: c.worldTick, reason: c.reason, sourceRefs: c.sourceRefs, before, after }] } : t;
  const check = validateTerritoryGraph(graph.map(x => x.uuid === uuid ? next : x)); if (!check.ok) return check;
  const descendants = (axis: TerritoryParentAxis): readonly string[] => {
    const children = new Map<string, string[]>();
    for (const x of graph) if (x[axis] !== null) { const siblings = children.get(x[axis]!) ?? []; siblings.push(x.uuid); children.set(x[axis]!, siblings); }
    const found: string[] = [], queue = [...children.get(uuid) ?? []];
    for (let i = 0; i < queue.length; i++) { const child = queue[i]; found.push(child); queue.push(...children.get(child) ?? []); }
    return found;
  };
  return ok(immutable(structuredClone({ territoryUuid: uuid, before, after, context: c,
    expectedRevisions: Object.fromEntries(graph.map(x => [x.uuid, x.revision])), affectedPhysicalDescendants: descendants("locatedInUuid"),
    affectedAdministrativeDescendants: descendants("administrativeParentUuid"), inheritedStateRequiresRecalculation: changed })));
}
/** Commit rechecks the graph snapshot. The runtime owns locks and durable writes. */
export function commitTerritoryReparent(graph: readonly Territory[], plan: TerritoryReparentPlan): Result<readonly Territory[]> {
  if (graph.length !== Object.keys(plan.expectedRevisions).length || graph.some(t => plan.expectedRevisions[t.uuid] !== t.revision))
    return failure("DM_REVISION_CONFLICT", "Hierarchy changed after preview", "conflict");
  const fresh = previewTerritoryReparent(graph, plan.territoryUuid, plan.after, plan.context); if (!fresh.ok) return fresh;
  const t = graph.find(x => x.uuid === plan.territoryUuid)!;
  if (sameParents(fresh.value.before, fresh.value.after)) return ok(graph);
  const next: Territory = { ...t, ...plan.after, revision: t.revision + 1, updatedAt: plan.context.at,
    hierarchyHistory: [...t.hierarchyHistory, { id: plan.context.eventId, at: plan.context.at, worldTick: plan.context.worldTick,
      reason: plan.context.reason, sourceRefs: plan.context.sourceRefs, before: fresh.value.before, after: plan.after }] };
  return validateTerritoryGraph(graph.map(x => x.uuid === t.uuid ? next : x));
}
