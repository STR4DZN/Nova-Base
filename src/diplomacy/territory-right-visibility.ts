import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { OwnerCommandOptions, OwnerIntent } from "./owner-commands.js";
import { diplomacyViewerControls, diplomacyViewerIsGm } from "./diplomacy-permissions.js";
import { territoryOwner } from "../territory/territory-owner.js";
import { projectTerritoryState, type TerritoryState } from "../territory/territory-state.js";
import { isRecord } from "../core/validation/value-validation.js";
/** Fresh validated local sources only; inherited and Agreement rights are never revocation targets here. */
export async function territoryRightIntentVisible(intent: OwnerIntent, source: TerritoryState, ctx: AuthenticatedCommandContext,
  options: OwnerCommandOptions, checkDeclaredVisibility = true): Promise<boolean> {
  const controls = await diplomacyViewerControls(ctx, territoryOwner.parties(source), options.domains, options.controllers);
  const canSee = (v: string) => diplomacyViewerIsGm(ctx) || v === "public" || v === "restricted" && controls;
  const view = projectTerritoryState(source, canSee);
  if (!view) return false;
  const allowed = (value: unknown): boolean => isRecord(value) && (!checkDeclaredVisibility || canSee(value.visibility as string))
    && (!source.rights.some(r => r.id === value.id) || view.rights.some(r => r.id === value.id));
  if (intent.mode === "create") return (intent.data as TerritoryState).rights.every(allowed);
  if (isRecord(intent.action) && intent.action.kind === "right") return allowed(intent.action.value);
  if (isRecord(intent.action) && intent.action.kind === "revoke-right") return view.rights.some(r => r.id === (intent.action as { id: unknown }).id);
  return true;
}
