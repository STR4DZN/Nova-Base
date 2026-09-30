import { ok, type Result } from "../core/contracts/result.js";
import { failure, isRecord } from "../core/validation/value-validation.js";
import { historyWindow, type DiplomacyOwner } from "../diplomacy/owner-contract.js";
import { ReputationTrackRegistry, validateReputationRecord, adjustReputation, decayReputation, projectReputation,
  type ReputationRecord, type ReputationTrackDefinition } from "./reputation-model.js";
export interface ReputationOwnerData { readonly definitions: readonly ReputationTrackDefinition[]; readonly record: ReputationRecord; }
export function reputationRegistry(definitions: readonly ReputationTrackDefinition[]): Result<ReputationTrackRegistry> {
  const registry = new ReputationTrackRegistry(); for (const d of definitions) { const r = registry.register(d); if (!r.ok) return r; } registry.freeze(); return ok(registry);
}
export const reputationOwner: DiplomacyOwner = {
  validate(raw): Result<ReputationOwnerData> {
    if (!isRecord(raw) || !Array.isArray(raw.definitions)) return failure("DM_REPUTATION_RECORD_INVALID", "Reputation envelope unavailable");
    const registry = reputationRegistry(raw.definitions); if (!registry.ok) return registry;
    const record = validateReputationRecord(raw.record, registry.value); return record.ok ? ok({ definitions: raw.definitions, record: record.value }) : record;
  },
  identity(data) { return (data as ReputationOwnerData).record; },
  parties(data) { const r = (data as ReputationOwnerData).record; return [r.subjectRef, r.audienceRef]; },
  change(data, action, c) {
    const { definitions, record } = data as ReputationOwnerData, registry = reputationRegistry(definitions); if (!registry.ok) return registry;
    if (!isRecord(action)) return failure("DM_REPUTATION_CHANGE_INVALID", "Invalid reputation action");
    const input = { expectedRevision: c.expectedRevision, entryId: c.eventId, trackId: action.trackId as string,
      delta: action.delta as number, source: c.sourceRefs[0], reason: c.reason, at: c.at, worldTick: c.worldTick,
      ...(action.reversalOf !== undefined ? { reversalOf: action.reversalOf as string } : {}) };
    const changed = action.kind === "adjust" ? adjustReputation(record, registry.value, input, action.reversalOf ? "reversal" : "adjustment")
      : action.kind === "decay" ? decayReputation(record, registry.value, input) : failure("DM_REPUTATION_CHANGE_INVALID", "Unsupported reputation action");
    return changed.ok ? ok({ definitions, record: changed.value }) : changed;
  },
  project(data, c) {
    const { definitions, record } = data as ReputationOwnerData, registry = reputationRegistry(definitions); if (!registry.ok) return registry;
    const p = projectReputation(record, registry.value, c.isGm, c.canSee); if (!p.ok) return p;
    return c.isGm ? ok({ ...(p.value as ReputationRecord), entries: historyWindow(record.entries, c), definitions }) : ok({ ...(p.value as object), revision: record.revision });
  }
};
