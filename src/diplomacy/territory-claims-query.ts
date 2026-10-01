import { queryVisibleTerritoryLineage } from "./territory-visible-lineage.js";
import { ok, type Result } from "../core/contracts/result.js";
import { immutable } from "../core/validation/value-validation.js";
import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { DiplomacyEntityStore } from "./diplomacy-store.js";
import type { DomainReadRepository } from "../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../domains/domain-controller-provider.js";
import type { RecoveryService } from "../mutations/recovery-service.js";
import { type TerritoryState, type TerritoryClaim } from "../territory/territory-state.js";
import { resolveTerritoryClaims } from "../territory/territory-rights.js";
import type { TerritoryParentAxis } from "../territory/territory-hierarchy.js";
export interface EffectiveTerritoryClaimView {
  readonly sourceTerritoryUuid: string; readonly sourceTerritoryLabel: string; readonly sourceRevision: number;
  readonly inherited: boolean; readonly claim: TerritoryClaim;
}
/** Read-only projection: each source uses its own authenticated audience; no traversal across an unavailable origin. */
export async function queryVisibleTerritoryClaims(target: TerritoryState, axis: TerritoryParentAxis, tick: number,
  ctx: AuthenticatedCommandContext, store: DiplomacyEntityStore, domains: DomainReadRepository, controllers: DomainControllerProvider,
  recovery: RecoveryService): Promise<Result<readonly EffectiveTerritoryClaimView[]>> {
  const graph = await queryVisibleTerritoryLineage(target, axis, ctx, store, domains, controllers, recovery);
  if (!graph.length) return ok([]);
  const resolved = resolveTerritoryClaims(graph, target.territory.uuid, { worldTick: tick, inheritanceAxis: axis, canSee: () => true });
  if (!resolved.ok) return resolved;
  const origins = new Map(graph.map(s => [s.territory.uuid, s.territory]));
  return ok(immutable(resolved.value.map(row => ({ ...row, sourceTerritoryLabel: origins.get(row.sourceTerritoryUuid)!.label,
    sourceRevision: origins.get(row.sourceTerritoryUuid)!.revision }))));
}
