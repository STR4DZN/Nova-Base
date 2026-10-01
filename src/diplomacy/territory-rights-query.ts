import { ok, type Result } from "../core/contracts/result.js";
import { failure, immutable, isTimestamp } from "../core/validation/value-validation.js";
import type { TypedRef } from "../core/identity/refs.js";
import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { DiplomacyEntityStore } from "./diplomacy-store.js";
import type { DomainReadRepository } from "../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../domains/domain-controller-provider.js";
import type { RecoveryService } from "../mutations/recovery-service.js";
import type { TerritoryState } from "../territory/territory-state.js";
import type { TerritoryParentAxis } from "../territory/territory-hierarchy.js";
import { agreementOwner, type AgreementOwnerData } from "../agreements/agreement-owner.js";
import { diplomacyViewerControls, diplomacyViewerIsGm } from "./diplomacy-permissions.js";
import { lockKey } from "../mutations/lock-keys.js";
import { queryVisibleTerritoryLineage } from "./territory-visible-lineage.js";
import { resolveTerritoryRightViews, type TerritoryRightsReport } from "../territory/territory-rights-view-model.js";
export type { TerritoryRightView, TerritoryRightsReport, TerritoryRightStatus } from "../territory/territory-rights-view-model.js";
/** Rights of every visible beneficiary, including sources with no capability grant. This query never executes grants. */
export async function queryTerritoryRights(target: TerritoryState, axis: TerritoryParentAxis, tick: number, ctx: AuthenticatedCommandContext,
  store: DiplomacyEntityStore, domains: DomainReadRepository, controllers: DomainControllerProvider, recovery: RecoveryService,
  conditionSatisfied?: (ref: TypedRef) => boolean): Promise<Result<TerritoryRightsReport>> {
  if (!isTimestamp(tick)) return failure("DM_TERRITORY_RIGHTS_TIME_INVALID", "Rights require an explicit world tick");
  const graph = await queryVisibleTerritoryLineage(target, axis, ctx, store, domains, controllers, recovery);
  if (!graph.length) return ok(immutable({ axis, worldTick: tick, effectiveCount: 0, entries: [] }));
  const agreements: AgreementOwnerData[] = [];
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
    agreements.push({ ...data, state: { ...data.state, agreement: { ...a, terms: a.terms.filter(t => canSee(t.visibility)) } } });
  }
  return resolveTerritoryRightViews(graph, target.territory.uuid, axis, tick, agreements, conditionSatisfied);
}
