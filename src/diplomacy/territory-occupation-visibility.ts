import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { OwnerCommandOptions, OwnerIntent } from "./owner-commands.js";
import { diplomacyViewerControls, diplomacyViewerIsGm } from "./diplomacy-permissions.js";
import { territoryOwner } from "../territory/territory-owner.js";
import { projectTerritoryState, type TerritoryState } from "../territory/territory-state.js";
import { isRecord } from "../core/validation/value-validation.js";
/** The caller supplies freshly persisted, validated state; unavailable and private references share one result. */
export async function territoryOccupationIntentVisible(intent: OwnerIntent, source: TerritoryState, ctx: AuthenticatedCommandContext,
  options: OwnerCommandOptions, checkDeclaredVisibility = true): Promise<boolean> {
  const controls = await diplomacyViewerControls(ctx, territoryOwner.parties(source), options.domains, options.controllers);
  const canSee = (v: string) => diplomacyViewerIsGm(ctx) || v === "public" || v === "restricted" && controls;
  const view = projectTerritoryState(source, canSee);
  if (!view) return false;
  const allowed = (value: unknown): boolean => {
    if (!isRecord(value) || checkDeclaredVisibility && !canSee(value.visibility as string) || !Array.isArray(value.presenceIds) || !Array.isArray(value.controlClaimIds)) return false;
    if ((checkDeclaredVisibility || intent.mode === "modify") && source.occupations.some(o => o.id === value.id) && !view.occupations.some(o => o.id === value.id)) return false;
    return value.presenceIds.every(id => view.presence.some(p => p.id === id))
      && value.controlClaimIds.every(id => view.claims.some(c => c.id === id && c.claimType === "domain-manager:control"));
  };
  if (intent.mode === "create") return (intent.data as TerritoryState).occupations.every(allowed);
  if (isRecord(intent.action) && intent.action.kind === "occupation") return allowed(intent.action.value);
  if (isRecord(intent.action) && intent.action.kind === "end-occupation") return view.occupations.some(o => o.id === (intent.action as { id: unknown }).id);
  return true;
}
