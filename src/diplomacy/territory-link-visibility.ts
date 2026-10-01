import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { OwnerCommandOptions, OwnerIntent } from "./owner-commands.js";
import { diplomacyViewerControls, diplomacyViewerIsGm } from "./diplomacy-permissions.js";
import { territoryOwner } from "../territory/territory-owner.js";
import { projectTerritoryState, validateTerritoryState, type TerritoryState } from "../territory/territory-state.js";
import { isRecord } from "../core/validation/value-validation.js";
import { lockKey } from "../mutations/lock-keys.js";
/** A fresh audience check; unavailable, fenced and invisible references share one admission result. */
export async function visibleTerritory(uuid: string, ctx: AuthenticatedCommandContext, o: OwnerCommandOptions): Promise<TerritoryState | null> {
  if (!o.recovery.fenceRegistry.assertKeysAvailable([lockKey.diplomacy("territory", uuid), lockKey.territoryGraph()]).ok) return null;
  const row = await o.store.freshRead("territory", uuid), valid = row && validateTerritoryState(row.data);
  if (!valid?.ok) return null;
  const controls = await diplomacyViewerControls(ctx, territoryOwner.parties(valid.value), o.domains, o.controllers);
  return projectTerritoryState(valid.value, v => diplomacyViewerIsGm(ctx) || v === "public" || v === "restricted" && controls) ? valid.value : null;
}
export async function territoryLinkIntentVisible(intent: OwnerIntent, source: TerritoryState, ctx: AuthenticatedCommandContext,
  o: OwnerCommandOptions, checkDeclaredVisibility = true): Promise<boolean> {
  const controls = await diplomacyViewerControls(ctx, territoryOwner.parties(source), o.domains, o.controllers);
  const canSee = (v: string) => diplomacyViewerIsGm(ctx) || v === "public" || v === "restricted" && controls;
  if (!canSee(source.territory.visibility)) return false;
  const action = intent.action;
  if (intent.mode === "create") {
    for (const link of (intent.data as TerritoryState).links) if (!await visibleTerritory(link.targetTerritoryUuid, ctx, o)) return false;
  } else if (isRecord(action) && action.kind === "link") {
    const link = action.value;
    if (!isRecord(link) || checkDeclaredVisibility && !canSee(link.visibility as string) || !await visibleTerritory(link.targetTerritoryUuid as string, ctx, o)) return false;
  } else if (isRecord(action) && action.kind === "update-link") {
    const link = source.links.find(l => l.id === action.id);
    if (!link || !canSee(link.visibility) || !await visibleTerritory(link.targetTerritoryUuid, ctx, o)) return false;
  }
  return true;
}
