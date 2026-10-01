import { ok, type Result } from "../core/contracts/result.js";
import { failure, immutable, isTimestamp } from "../core/validation/value-validation.js";
import { canonicalJsonStringify } from "../commands/command-dedupe-store.js";
import type { TypedRef } from "../core/identity/refs.js";
import type { RelationPartyRef } from "../relations/types/relation-types.js";
import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { DiplomacyEntityStore } from "./diplomacy-store.js";
import type { DomainReadRepository } from "../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../domains/domain-controller-provider.js";
import type { RecoveryService } from "../mutations/recovery-service.js";
import type { TerritoryState } from "../territory/territory-state.js";
import type { TerritoryParentAxis } from "../territory/territory-hierarchy.js";
import { resolveTerritoryRights } from "../territory/territory-rights.js";
import { agreementOwner, type AgreementOwnerData } from "../agreements/agreement-owner.js";
import { resolveAgreementGrants, type RightTermPayload } from "../agreements/agreement-obligations.js";
import { diplomacyViewerControls, diplomacyViewerIsGm } from "./diplomacy-permissions.js";
import { lockKey } from "../mutations/lock-keys.js";
import { queryVisibleTerritoryLineage } from "./territory-visible-lineage.js";
export type TerritoryRightStatus = "effective" | "inactive" | "source-inactive" | "scheduled" | "expired" | "conditions-unconfirmed";
export interface TerritoryRightView {
  readonly origin: { readonly kind: "territory" | "agreement"; readonly id: string; readonly label: string; readonly revision: number };
  readonly sourceTerritoryUuid: string; readonly sourceTerritoryLabel: string; readonly sourceTerritoryRevision: number;
  readonly rightId: string; readonly rightType: string; readonly beneficiaryRef: RelationPartyRef;
  readonly inherited: boolean; readonly propagates: boolean; readonly revocable: boolean; readonly sourceActive: boolean;
  readonly startsAtWorldTick: number; readonly expiresAtWorldTick: number | null; readonly grants: readonly string[];
  readonly status: TerritoryRightStatus; readonly conditions: readonly { readonly ref: TypedRef; readonly confirmed: boolean | null }[];
}
export interface TerritoryRightsReport { readonly axis: TerritoryParentAxis; readonly worldTick: number; readonly effectiveCount: number; readonly entries: readonly TerritoryRightView[]; }
const cleanRef = <T extends TypedRef>(r: T): T => ({ type: r.type, ...(r.id !== undefined ? { id: r.id } : {}), ...(r.uuid !== undefined ? { uuid: r.uuid } : {}),
  ...("domainUuid" in r ? { domainUuid: r.domainUuid } : {}) } as T);
/** Rights of every visible beneficiary, including sources with no capability grant. This query never executes grants. */
export async function queryTerritoryRights(target: TerritoryState, axis: TerritoryParentAxis, tick: number, ctx: AuthenticatedCommandContext,
  store: DiplomacyEntityStore, domains: DomainReadRepository, controllers: DomainControllerProvider, recovery: RecoveryService,
  conditionSatisfied?: (ref: TypedRef) => boolean): Promise<Result<TerritoryRightsReport>> {
  if (!isTimestamp(tick)) return failure("DM_TERRITORY_RIGHTS_TIME_INVALID", "Rights require an explicit world tick");
  const graph = await queryVisibleTerritoryLineage(target, axis, ctx, store, domains, controllers, recovery), entries: TerritoryRightView[] = [];
  if (!graph.length) return ok(immutable({ axis, worldTick: tick, effectiveCount: 0, entries }));
  const sources = new Map(graph.map(s => [s.territory.uuid, s.territory])), memo = new Map<string, boolean>();
  const confirm = (ref: TypedRef): boolean => {
    const key = canonicalJsonStringify(cleanRef(ref)); if (memo.has(key)) return memo.get(key)!;
    let value = false; try { value = conditionSatisfied?.(cleanRef(ref)) === true; } catch { /* unavailable provider cannot authorize a right */ }
    memo.set(key, value); return value;
  };
  const describe = (sourceActive: boolean, starts: number, expires: number | null, refs: readonly TypedRef[], effective: boolean, agreement = false) => {
    const eligible = sourceActive && tick >= starts && (expires === null || tick < expires);
    const conditions = refs.map(ref => ({ ref: cleanRef(ref), confirmed: eligible ? confirm(ref) : null }));
    const status: TerritoryRightStatus = !sourceActive ? agreement ? "source-inactive" : "inactive" : tick < starts ? "scheduled"
      : expires !== null && tick >= expires ? "expired" : effective ? "effective" : "conditions-unconfirmed";
    return { conditions, status };
  };
  const rightsByBeneficiary = new Map<string, Set<string>>();
  for (const s of graph) for (const r of s.rights) {
    if (s.territory.uuid !== target.territory.uuid && !r.inherited) continue;
    const beneficiaryKey = canonicalJsonStringify(r.beneficiaryRef);
    if (!rightsByBeneficiary.has(beneficiaryKey)) {
      const resolved = resolveTerritoryRights(graph, target.territory.uuid, r.beneficiaryRef, { worldTick: tick, inheritanceAxis: axis, canSee: () => true, conditionSatisfied: confirm });
      if (!resolved.ok) return resolved;
      rightsByBeneficiary.set(beneficiaryKey, new Set(resolved.value.map(v => JSON.stringify([v.sourceTerritoryUuid, v.rightId]))));
    }
    entries.push({ origin: { kind: "territory", id: s.territory.uuid, label: s.territory.label, revision: s.territory.revision },
      sourceTerritoryUuid: s.territory.uuid, sourceTerritoryLabel: s.territory.label, sourceTerritoryRevision: s.territory.revision,
      rightId: r.id, rightType: r.rightType, beneficiaryRef: r.beneficiaryRef, inherited: s.territory.uuid !== target.territory.uuid,
      propagates: r.inherited, revocable: r.revocable, sourceActive: r.active, startsAtWorldTick: r.startsAtWorldTick, expiresAtWorldTick: r.expiresAtWorldTick, grants: r.grants,
      ...describe(r.active, r.startsAtWorldTick, r.expiresAtWorldTick, r.conditionRefs, rightsByBeneficiary.get(beneficiaryKey)!.has(JSON.stringify([s.territory.uuid, r.id]))) });
  }
  const isGm = diplomacyViewerIsGm(ctx), ids = new Set(store.list("agreement").map(e => e.id));
  for (const row of await store.adapter.loadAll()) if (row.kind === "agreement") ids.add(row.id);
  for (const id of ids) {
    if (!recovery.fenceRegistry.assertKeysAvailable([lockKey.diplomacy("agreement", id)]).ok) continue;
    const row = await store.freshRead("agreement", id); if (!row) continue;
    const valid = agreementOwner.validate(row.data, graph); if (!valid.ok) continue;
    const data = valid.value as AgreementOwnerData, a = data.state.agreement;
    if (a.id !== row.id || a.revision !== row.revision) continue;
    const controlled = await diplomacyViewerControls(ctx, agreementOwner.parties(data), domains, controllers);
    const canSee = (v: string) => isGm || v === "public" || v === "restricted" && controlled;
    if (!canSee(a.visibility)) continue;
    const terms = a.terms.filter(t => t.type === "domain-manager:right" && canSee(t.visibility)
      && sources.has((t.payload as RightTermPayload).territoryUuid)
      && ((t.payload as RightTermPayload).territoryUuid === target.territory.uuid || (t.payload as RightTermPayload).inherited));
    const resolved = resolveAgreementGrants({ ...a, terms }, data.definition, tick, confirm, () => true), effectiveIds = new Set(resolved.rights.map(r => r.termId));
    for (const term of terms) {
      const p = term.payload as RightTermPayload, origin = sources.get(p.territoryUuid)!, beneficiary = a.parties.find(v => v.id === p.beneficiaryPartyId)!.ref;
      const starts = Math.max(a.duration.startsAtWorldTick ?? 0, p.startsAtWorldTick ?? 0), ends = [a.duration.expiresAtWorldTick, p.expiresAtWorldTick].filter(v => v !== null) as number[];
      const expires = ends.length ? Math.min(...ends) : null, active = data.definition.effectiveLifecycles.includes(a.lifecycle as "active" | "breached");
      entries.push({ origin: { kind: "agreement", id: a.id, label: a.label, revision: a.revision }, sourceTerritoryUuid: origin.uuid,
        sourceTerritoryLabel: origin.label, sourceTerritoryRevision: origin.revision, rightId: term.id, rightType: p.rightType, beneficiaryRef: cleanRef(beneficiary),
        inherited: origin.uuid !== target.territory.uuid, propagates: p.inherited, revocable: p.revocable, sourceActive: active,
        startsAtWorldTick: starts, expiresAtWorldTick: expires, grants: p.grants,
        ...describe(active, starts, expires, p.conditionRefs, effectiveIds.has(term.id), true) });
    }
  }
  return ok(immutable({ axis, worldTick: tick, effectiveCount: entries.filter(r => r.status === "effective").length, entries }));
}
