import { ok, type Result } from "../core/contracts/result.js";
import { canonicalJsonStringify } from "../commands/command-dedupe-store.js";
import { failure, immutable, isTimestamp } from "../core/validation/value-validation.js";
import type { TypedRef } from "../core/identity/refs.js";
import { agreementOwner, type AgreementOwnerData } from "../agreements/agreement-owner.js";
import { validateTerritoryGraph, type TerritoryParentAxis } from "./territory-hierarchy.js";
import { projectTerritoryState, validateTerritoryState, type TerritoryState } from "./territory-state.js";
import { cleanRightRef, resolveTerritoryRightViews, type TerritoryRightView } from "./territory-rights-view-model.js";
export interface RightConditionEvaluation { readonly key: string; readonly confirmed: boolean; }
/** One authority evaluation per sanitized condition, shared across both graphs and axes. */
export function rightConditionContext(provider?: (ref: TypedRef) => boolean) {
  const memo = new Map<string, boolean>();
  return {
    confirm(ref: TypedRef): boolean {
      const clean = cleanRightRef(ref), key = canonicalJsonStringify(clean);
      if (!memo.has(key)) { let confirmed = false; try { confirmed = provider?.(clean) === true; } catch { /* unconfirmed conditions do not confer rights */ }
        memo.set(key, confirmed); }
      return memo.get(key)!;
    },
    evaluations(): readonly RightConditionEvaluation[] { return immutable([...memo].sort(([a], [b]) => a.localeCompare(b)).map(([key, confirmed]) => ({ key, confirmed }))); }
  };
}
export interface TerritoryRightImpact {
  readonly territoryUuid: string; readonly label: string; readonly revision: number; readonly localCount: number;
  readonly before: readonly TerritoryRightView[]; readonly after: readonly TerritoryRightView[];
  readonly added: readonly TerritoryRightView[]; readonly removed: readonly TerritoryRightView[]; readonly retained: readonly TerritoryRightView[];
}
export interface TerritoryRightsImpactPreview {
  readonly worldTick: number;
  readonly axes: readonly { readonly axis: TerritoryParentAxis; readonly changed: boolean; readonly territories: readonly TerritoryRightImpact[] }[];
}
/** GM reparent review: effective inherited rights only. No grants or writes are executed. */
export function previewTerritoryRightsImpact(before: readonly TerritoryState[], after: readonly TerritoryState[], agreements: readonly AgreementOwnerData[],
  uuid: string, tick: number, conditions = rightConditionContext()): Result<TerritoryRightsImpactPreview> {
  if (!isTimestamp(tick)) return failure("DM_TERRITORY_RIGHTS_TIME_INVALID", "Rights impact preview requires an explicit world tick");
  for (const states of [before, after]) {
    for (const s of states) { const valid = validateTerritoryState(s); if (!valid.ok) return valid; }
    const valid = validateTerritoryGraph(states.map(s => s.territory)); if (!valid.ok) return valid;
  }
  const ids = new Set<string>();
  for (const data of agreements) {
    const valid = agreementOwner.validate(data, before); if (!valid.ok) return valid;
    const id = data.state.agreement.id; if (ids.has(id)) return failure("DM_AGREEMENT_STATE_INVALID", "Duplicate rights origin"); ids.add(id);
  }
  const b = before.find(s => s.territory.uuid === uuid), a = after.find(s => s.territory.uuid === uuid);
  if (!b || !a) return failure("DM_TERRITORY_NOT_FOUND", "Rights impact target unavailable", "not-found");
  const projectedBefore = before.map(s => projectTerritoryState(s, () => true)!), projectedAfter = after.map(s => projectTerritoryState(s, () => true)!);
  const resolve = (states: readonly TerritoryState[], id: string, axis: TerritoryParentAxis) => resolveTerritoryRightViews(states, id, axis, tick, agreements, conditions.confirm);
  const key = (r: TerritoryRightView) => canonicalJsonStringify([r.origin.kind, r.origin.id, r.sourceTerritoryUuid, r.rightId, r.beneficiaryRef]);
  const axes: TerritoryRightsImpactPreview["axes"][number][] = [];
  for (const axis of ["locatedInUuid", "administrativeParentUuid"] as const) {
    const changed = b.territory[axis] !== a.territory[axis], territories: TerritoryRightImpact[] = [];
    if (changed) {
      const children = new Map<string, string[]>();
      for (const s of before) { const parent = s.territory[axis]; if (parent) children.set(parent, [...children.get(parent) ?? [], s.territory.uuid]); }
      const affected = [uuid]; for (let i = 0; i < affected.length; i++) affected.push(...children.get(affected[i]) ?? []);
      for (const id of affected) {
        const bv = resolve(projectedBefore, id, axis); if (!bv.ok) return bv;
        const av = resolve(projectedAfter, id, axis); if (!av.ok) return av;
        const effective = (r: TerritoryRightView) => r.status === "effective", br = bv.value.entries.filter(r => r.inherited && effective(r)), ar = av.value.entries.filter(r => r.inherited && effective(r));
        const bKeys = new Set(br.map(key)), aKeys = new Set(ar.map(key)), t = before.find(s => s.territory.uuid === id)!.territory;
        territories.push({ territoryUuid: id, label: t.label, revision: t.revision, localCount: bv.value.entries.filter(r => !r.inherited && effective(r)).length,
          before: br, after: ar, added: ar.filter(r => !bKeys.has(key(r))), removed: br.filter(r => !aKeys.has(key(r))), retained: ar.filter(r => bKeys.has(key(r))) });
      }
    }
    axes.push({ axis, changed, territories });
  }
  return ok(immutable({ worldTick: tick, axes }));
}
