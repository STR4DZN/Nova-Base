import { ok, type Result } from "../core/contracts/result.js";
import { immutable } from "../core/validation/value-validation.js";
import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { DiplomacyEntityStore } from "./diplomacy-store.js";
import type { DomainReadRepository } from "../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../domains/domain-controller-provider.js";
import type { RecoveryService } from "../mutations/recovery-service.js";
import { diplomacyViewerControls, diplomacyViewerIsGm } from "./diplomacy-permissions.js";
import { lockKey } from "../mutations/lock-keys.js";
import { territoryOwner } from "../territory/territory-owner.js";
import { validateTerritoryState, projectTerritoryState, type TerritoryState, type TerritoryClaim } from "../territory/territory-state.js";
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
  const isGm = diplomacyViewerIsGm(ctx);
  const project = async (state: TerritoryState): Promise<TerritoryState | null> => {
    const controls = await diplomacyViewerControls(ctx, territoryOwner.parties(state), domains, controllers);
    return projectTerritoryState(state, v => isGm || v === "public" || v === "restricted" && controls);
  };
  const first = await project(target); if (!first) return ok([]);
  const sources: TerritoryState[] = [first], seen = new Set([target.territory.uuid]); let current = first, cycle = false;
  while (current.territory[axis]) {
    const uuid = current.territory[axis]!;
    if (seen.has(uuid)) { cycle = true; break; }
    seen.add(uuid);
    if (!recovery.fenceRegistry.assertKeysAvailable([lockKey.diplomacy("territory", uuid), lockKey.territoryGraph()]).ok) break;
    const row = await store.freshRead("territory", uuid); if (!row) break;
    const valid = validateTerritoryState(row.data); if (!valid.ok || valid.value.territory.uuid !== uuid || valid.value.territory.revision !== row.revision) break;
    const visible = await project(valid.value); if (!visible) break;
    sources.push(visible); current = visible;
  }
  // A cycle contributes no inherited claims. Unavailable tails are indistinguishable from roots in this projection.
  const lineage = cycle ? sources.slice(0, 1) : sources;
  const graph = lineage.map((s, i) => ({ ...s, territory: { ...s.territory, [axis]: lineage[i + 1]?.territory.uuid ?? null } }));
  const resolved = resolveTerritoryClaims(graph, target.territory.uuid, { worldTick: tick, inheritanceAxis: axis, canSee: () => true });
  if (!resolved.ok) return resolved;
  const origins = new Map(lineage.map(s => [s.territory.uuid, s.territory]));
  return ok(immutable(resolved.value.map(row => ({ ...row, sourceTerritoryLabel: origins.get(row.sourceTerritoryUuid)!.label,
    sourceRevision: origins.get(row.sourceTerritoryUuid)!.revision }))));
}
