import type { Result } from "../core/contracts/result.js";
import type { RelationPartyRef, RelationVisibility } from "../relations/types/relation-types.js";
import type { TypedRef } from "../core/identity/refs.js";
import type { TerritoryState } from "../territory/territory-state.js";
export interface DiplomacyOwnerContext {
  readonly expectedRevision: number; readonly eventId: string; readonly at: number; readonly worldTick: number;
  readonly reason: string; readonly sourceRefs: readonly TypedRef[];
}
export interface DiplomacyViewerContext {
  readonly isGm: boolean; readonly at: number; readonly worldTick: number; readonly canSee: (v: RelationVisibility) => boolean;
  readonly historyOffset: number; readonly historyLimit: number;
}
export interface DiplomacyOwner {
  validate(data: unknown, territories: readonly TerritoryState[]): Result<unknown>;
  identity(data: unknown): { readonly id: string; readonly revision: number; readonly visibility: RelationVisibility; readonly label: string };
  parties(data: unknown): readonly RelationPartyRef[];
  change(data: unknown, action: unknown, c: DiplomacyOwnerContext, territories: readonly TerritoryState[]): Result<unknown>;
  project(data: unknown, c: DiplomacyViewerContext): Result<unknown>;
}
export const historyWindow = <T>(items: readonly T[], c: DiplomacyViewerContext): readonly T[] => items.slice(c.historyOffset, c.historyOffset + c.historyLimit);
