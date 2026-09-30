import { ok, type Result } from "../core/contracts/result.js";
import { isJournalEntryUuid, type TypedRef } from "../core/identity/refs.js";
import { failure, immutable, isJsonData, isNamespaced, isRecord, isText, isTimestamp, isTypedRef, isVisibility, revisionGuard } from "../core/validation/value-validation.js";
import { validateRelationPartyRef } from "../relations/types/relation-validation.js";
import type { RelationPartyRef, RelationVisibility } from "../relations/types/relation-types.js";
import type { TerritoryChangeContext, TerritoryState } from "./territory-state.js";
export const DISPUTE_LIFECYCLES = ["latent", "active", "escalated", "frozen", "settled", "abandoned", "superseded"] as const;
export type DisputeLifecycle = typeof DISPUTE_LIFECYCLES[number];
export interface TerritoryDisputeEvent {
  readonly id: string; readonly at: number; readonly worldTick: number; readonly before: DisputeLifecycle; readonly after: DisputeLifecycle;
  readonly reason: string; readonly sourceRefs: readonly TypedRef[]; readonly outcomeRef: TypedRef | null;
}
export interface TerritoryDispute {
  readonly schemaVersion: 1; readonly id: string; readonly label: string; readonly revision: number; readonly disputeType: string;
  readonly territoryUuids: readonly string[]; readonly parties: readonly RelationPartyRef[];
  readonly claimRefs: readonly { readonly territoryUuid: string; readonly claimId: string }[];
  readonly visibility: RelationVisibility; readonly lifecycle: DisputeLifecycle; readonly createdAt: number; readonly updatedAt: number;
  readonly events: readonly TerritoryDisputeEvent[];
}
export function validateTerritoryDispute(raw: unknown, territories: readonly TerritoryState[]): Result<TerritoryDispute> {
  if (!isRecord(raw) || !isJsonData(raw) || raw.schemaVersion !== 1 || !isText(raw.id) || !isText(raw.label) || !isTimestamp(raw.revision)
    || !isNamespaced(raw.disputeType) || !Array.isArray(raw.territoryUuids) || !raw.territoryUuids.length || !raw.territoryUuids.every(isJournalEntryUuid)
    || new Set(raw.territoryUuids).size !== raw.territoryUuids.length || !Array.isArray(raw.parties) || raw.parties.length < 2
    || !raw.parties.every(p => validateRelationPartyRef(p).ok) || new Set(raw.parties.map(p => JSON.stringify(p))).size !== raw.parties.length
    || !Array.isArray(raw.claimRefs) || !isVisibility(raw.visibility) || !DISPUTE_LIFECYCLES.includes(raw.lifecycle as DisputeLifecycle)
    || !isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt) || raw.updatedAt < raw.createdAt || !Array.isArray(raw.events))
    return failure("DM_TERRITORY_DISPUTE_INVALID", "Invalid independent dispute entity");
  if (raw.territoryUuids.some(uuid => !territories.some(s => s.territory.uuid === uuid))) return failure("DM_TERRITORY_DISPUTE_REF_MISSING", "Dispute territory unavailable", "not-found");
  for (const ref of raw.claimRefs) if (!isRecord(ref) || !isJournalEntryUuid(ref.territoryUuid) || !isText(ref.claimId) || !raw.territoryUuids.includes(ref.territoryUuid)
    || !territories.some(s => s.territory.uuid === ref.territoryUuid && s.claims.some(c => c.id === ref.claimId)))
    return failure("DM_TERRITORY_DISPUTE_REF_MISSING", "Dispute claim unavailable", "not-found");
  let lifecycle: DisputeLifecycle = "latent", at = raw.createdAt; const ids = new Set<string>();
  for (const e of raw.events) {
    if (!isRecord(e) || !isText(e.id) || ids.has(e.id) || !isTimestamp(e.at) || e.at < at || e.at > raw.updatedAt || !isTimestamp(e.worldTick)
      || !isText(e.reason) || !Array.isArray(e.sourceRefs) || !e.sourceRefs.length || !e.sourceRefs.every(isTypedRef)
      || e.before !== lifecycle || !DISPUTE_LIFECYCLES.includes(e.after as DisputeLifecycle) || e.before === e.after
      || (e.outcomeRef !== null && !isTypedRef(e.outcomeRef)) || (e.after === "settled" && e.outcomeRef === null)
      || ["settled", "abandoned", "superseded"].includes(lifecycle)) return failure("DM_TERRITORY_DISPUTE_HISTORY_INVALID", "Invalid dispute transition audit chain");
    lifecycle = e.after as DisputeLifecycle; at = e.at; ids.add(e.id);
  }
  if (lifecycle !== raw.lifecycle || raw.revision !== raw.events.length) return failure("DM_TERRITORY_DISPUTE_HISTORY_INVALID", "Dispute state diverges from history");
  return ok(immutable(structuredClone(raw)) as unknown as TerritoryDispute);
}
/** Only an explicit authority outcome settles a dispute. Claim strengths never select a winner. */
export function changeTerritoryDispute(d: TerritoryDispute, territories: readonly TerritoryState[], c: TerritoryChangeContext,
  lifecycle: DisputeLifecycle, outcomeRef: TypedRef | null): Result<TerritoryDispute> {
  const valid = validateTerritoryDispute(d, territories); if (!valid.ok) return valid;
  const stale = revisionGuard(d.revision, c.expectedRevision); if (stale) return stale;
  if (!DISPUTE_LIFECYCLES.includes(lifecycle) || !isText(c.eventId) || d.events.some(e => e.id === c.eventId) || !isTimestamp(c.at)
    || c.at < d.updatedAt || !isTimestamp(c.worldTick) || !isText(c.reason) || !Array.isArray(c.sourceRefs) || !c.sourceRefs.length || !c.sourceRefs.every(isTypedRef)
    || (outcomeRef !== null && !isTypedRef(outcomeRef))) return failure("DM_TERRITORY_DISPUTE_CHANGE_INVALID", "Invalid dispute decision context");
  if (lifecycle === d.lifecycle) return ok(d);
  return validateTerritoryDispute({ ...d, lifecycle, revision: d.revision + 1, updatedAt: c.at, events: [...d.events, {
    ...c, id: c.eventId, before: d.lifecycle, after: lifecycle, outcomeRef }] }, territories);
}
