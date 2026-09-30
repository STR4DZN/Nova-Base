import { ok, type Result } from "../core/contracts/result.js";
import { canonicalJsonStringify } from "../commands/command-dedupe-store.js";
import { failure, immutable, isJsonData, isRecord, isText, isTimestamp, isTypedRef, revisionGuard } from "../core/validation/value-validation.js";
import type { DiplomacyOwnerContext } from "../diplomacy/owner-contract.js";
import type { TypedRef } from "../core/identity/refs.js";
import { validateReputationTrackDefinition, validateReputationRecord, ReputationTrackRegistry,
  type ReputationRecord, type ReputationTrackDefinition } from "./reputation-model.js";

export interface ReputationConfigurationEvent {
  readonly id: string; readonly kind: "track-added" | "track-configured"; readonly trackId: string;
  readonly beforeVersion: number | null; readonly afterVersion: number;
  readonly beforeDecayWorldTick: number | null; readonly afterDecayWorldTick: number | null;
  readonly at: number; readonly worldTick: number; readonly reason: string; readonly source: TypedRef;
}
export interface ConfigurableReputationData {
  readonly definitions: readonly ReputationTrackDefinition[]; readonly record: ReputationRecord;
  readonly configurationHistory?: readonly ReputationConfigurationEvent[];
}
export function validateReputationConfigurationHistory(raw: unknown, data: ConfigurableReputationData): Result<readonly ReputationConfigurationEvent[]> {
  if (!Array.isArray(raw) || !isJsonData(raw)) return failure("DM_REPUTATION_CONFIGURATION_INVALID", "Configuration audit must be a JSON list");
  const ids = new Set<string>(), versions = new Map<string, number>(); let at = data.record.createdAt;
  for (const e of raw) {
    if (!isRecord(e) || !isText(e.id) || ids.has(e.id) || !isText(e.trackId)
      || !["track-added", "track-configured"].includes(e.kind as string)
      || !isTimestamp(e.at) || e.at < at || e.at > data.record.updatedAt || !isTimestamp(e.worldTick)
      || !isText(e.reason) || !isTypedRef(e.source) || !isTimestamp(e.afterVersion) || e.afterVersion < 1
      || (e.beforeVersion !== null && (!isTimestamp(e.beforeVersion) || e.beforeVersion < 1 || e.afterVersion <= e.beforeVersion))
      || (e.kind === "track-added" ? e.beforeVersion !== null || versions.has(e.trackId)
        : e.beforeVersion === null || versions.has(e.trackId) && versions.get(e.trackId) !== e.beforeVersion)
      || !data.definitions.some(d => d.id === e.trackId && d.version === e.afterVersion)
      || e.beforeVersion !== null && !data.definitions.some(d => d.id === e.trackId && d.version === e.beforeVersion)
      || (e.beforeDecayWorldTick !== null && !isTimestamp(e.beforeDecayWorldTick))
      || (e.afterDecayWorldTick !== null && !isTimestamp(e.afterDecayWorldTick)))
      return failure("DM_REPUTATION_CONFIGURATION_INVALID", "Invalid configuration history, version chain or source");
    ids.add(e.id); versions.set(e.trackId, e.afterVersion); at = e.at;
  }
  if ([...versions].some(([id, version]) => data.record.tracks.find(t => t.definitionId === id)?.definitionVersion !== version))
    return failure("DM_REPUTATION_CONFIGURATION_INVALID", "Active track version diverges from configuration audit");
  return ok(immutable(structuredClone(raw)) as readonly ReputationConfigurationEvent[]);
}
export function changeReputationConfiguration(data: ConfigurableReputationData, action: Record<string, unknown>,
  c: DiplomacyOwnerContext): Result<ConfigurableReputationData> {
  if (action.kind !== "add-track" && action.kind !== "configure-track")
    return failure("DM_REPUTATION_CONFIGURATION_INVALID", "Unsupported configuration operation");
  const registryBefore = new ReputationTrackRegistry();
  for (const d of data.definitions) { const r = registryBefore.register(d); if (!r.ok) return r; }
  const validBefore = validateReputationRecord(data.record, registryBefore); if (!validBefore.ok) return validBefore;
  const historyBefore = validateReputationConfigurationHistory(data.configurationHistory ?? [], data); if (!historyBefore.ok) return historyBefore;
  const stale = revisionGuard(data.record.revision, c.expectedRevision); if (stale) return stale;
  if (!isTimestamp(c.at) || c.at < data.record.updatedAt || !isTimestamp(c.worldTick) || !isText(c.eventId)
    || !isText(c.reason) || !isTypedRef(c.sourceRefs[0])
    || data.configurationHistory?.some(e => e.id === c.eventId) || data.record.entries.some(e => e.id === c.eventId))
    return failure("DM_REPUTATION_CONFIGURATION_INVALID", "Invalid configuration audit context");
  const oldTrack = action.kind === "configure-track" ? data.record.tracks.find(t => t.definitionId === action.trackId) : undefined;
  let definition: ReputationTrackDefinition, initialScore: number, beforeVersion: number | null = null;
  let beforeDecayWorldTick: number | null = null, afterDecayWorldTick: number | null = null;
  if (action.kind === "add-track") {
    const validated = validateReputationTrackDefinition(action.definition); if (!validated.ok) return validated;
    definition = validated.value;
    if (data.record.tracks.some(t => t.definitionId === definition.id))
      return failure("DM_REPUTATION_TRACK_ALREADY_EXISTS", "Record already has this track", "conflict");
    initialScore = (action.initialScore ?? definition.baseline) as number;
    afterDecayWorldTick = definition.decay ? c.worldTick : null;
  } else {
    if (!oldTrack) return failure("DM_REPUTATION_TRACK_UNAVAILABLE", "Record track unavailable", "not-found");
    const old = data.definitions.find(d => d.id === oldTrack.definitionId && d.version === oldTrack.definitionVersion)!;
    if (!isRecord(action.policy)) return failure("DM_REPUTATION_CONFIGURATION_INVALID", "Track policy must be structured");
    const validated = validateReputationTrackDefinition({ ...action.policy, id: old.id, version: old.version }); if (!validated.ok) return validated;
    const candidate = validated.value;
    if (candidate.minimum !== old.minimum || candidate.maximum !== old.maximum)
      return failure("DM_REPUTATION_RANGE_IMMUTABLE", "Existing track ranges preserve score history; create a new track for another range");
    if (canonicalJsonStringify(candidate) === canonicalJsonStringify(old)) return ok(data);
    if (!isTimestamp(action.definitionVersion) || action.definitionVersion <= old.version)
      return failure("DM_REPUTATION_VERSION_INVALID", "Configuration requires an unused higher definition version");
    definition = { ...candidate, version: action.definitionVersion };
    initialScore = oldTrack.initialScore; beforeVersion = old.version; beforeDecayWorldTick = oldTrack.lastDecayWorldTick;
    const clockChanged = candidate.baseline !== old.baseline || canonicalJsonStringify(candidate.decay) !== canonicalJsonStringify(old.decay);
    afterDecayWorldTick = !candidate.decay ? null : clockChanged ? c.worldTick : oldTrack.lastDecayWorldTick;
  }
  const existing = data.definitions.find(d => d.id === definition.id && d.version === definition.version);
  if (existing && canonicalJsonStringify(existing) !== canonicalJsonStringify(definition))
    return failure("DM_DIPLOMACY_DEFINITION_CONFLICT", "Exact definition version already has another snapshot", "conflict");
  const definitions = existing ? data.definitions : [...data.definitions, definition];
  const registry = new ReputationTrackRegistry();
  for (const d of definitions) { const r = registry.register(d); if (!r.ok) return r; } registry.freeze();
  const track = { definitionId: definition.id, definitionVersion: definition.version, initialScore,
    score: oldTrack?.score ?? initialScore, lastDecayWorldTick: afterDecayWorldTick };
  const record = validateReputationRecord({ ...data.record, revision: data.record.revision + 1, updatedAt: c.at,
    tracks: oldTrack ? data.record.tracks.map(t => t === oldTrack ? track : t) : [...data.record.tracks, track] }, registry);
  if (!record.ok) return record;
  const event: ReputationConfigurationEvent = { id: c.eventId, kind: action.kind === "add-track" ? "track-added" : "track-configured",
    trackId: definition.id, beforeVersion, afterVersion: definition.version, beforeDecayWorldTick, afterDecayWorldTick,
    at: c.at, worldTick: c.worldTick, reason: c.reason, source: c.sourceRefs[0] };
  const next = { definitions, record: record.value, configurationHistory: [...(data.configurationHistory ?? []), event] };
  const audit = validateReputationConfigurationHistory(next.configurationHistory, next); return audit.ok ? ok(immutable(next)) : audit;
}
