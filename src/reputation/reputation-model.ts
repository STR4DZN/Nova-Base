import { isJsonSafe } from "../commands/command-envelope.js";
import { ok, type Result } from "../core/contracts/result.js";
import { isOpaqueId } from "../core/identity/ids.js";
import type { TypedRef } from "../core/identity/refs.js";
import { boundedInteger, failure, immutable, isNamespaced, isRecord, isSafeInteger,
  isText, isTimestamp, isTypedRef, isVisibility, revisionGuard } from "../core/validation/value-validation.js";
import type { RelationPartyRef, RelationVisibility } from "../relations/types/relation-types.js";
import { validateRelationPartyRef } from "../relations/types/relation-validation.js";

export interface ReputationBand { readonly id: string; readonly label: string; readonly minimum: number; readonly maximum: number; }
export interface ReputationTrackDefinition {
  readonly id: string; readonly version: number; readonly label: string;
  readonly minimum: number; readonly maximum: number; readonly baseline: number;
  readonly visibility: RelationVisibility;
  readonly publicPresentation: "hidden" | "band" | "score";
  readonly bands: readonly ReputationBand[];
  readonly decay: { readonly amount: number; readonly periodTicks: number } | null;
}
export interface ReputationTrack {
  readonly definitionId: string; readonly definitionVersion: number;
  readonly score: number; readonly initialScore: number; readonly lastDecayWorldTick: number | null;
}
export interface ReputationEntry {
  readonly id: string; readonly trackId: string; readonly kind: "adjustment" | "reversal" | "decay";
  readonly delta: number; readonly before: number; readonly after: number;
  readonly source: TypedRef; readonly reason: string; readonly at: number; readonly worldTick: number | null;
  readonly reversalOf: string | null;
}
export interface ReputationRecord {
  readonly schemaVersion: 1; readonly id: string; readonly revision: number; readonly label: string;
  readonly subjectRef: RelationPartyRef; readonly audienceRef: RelationPartyRef;
  readonly visibility: RelationVisibility; readonly createdAt: number; readonly updatedAt: number;
  readonly tracks: readonly ReputationTrack[]; readonly entries: readonly ReputationEntry[];
}
export function validateReputationTrackDefinition(raw: unknown): Result<ReputationTrackDefinition> {
  if (!isRecord(raw) || !isJsonSafe(raw) || !isNamespaced(raw.id) || !isTimestamp(raw.version) || raw.version < 1 || !isText(raw.label)
    || !isSafeInteger(raw.minimum) || !isSafeInteger(raw.maximum) || raw.maximum < raw.minimum || !isSafeInteger(raw.baseline)
    || raw.baseline < raw.minimum || raw.baseline > raw.maximum || !isVisibility(raw.visibility)
    || (raw.publicPresentation !== "hidden" && raw.publicPresentation !== "band" && raw.publicPresentation !== "score") || !Array.isArray(raw.bands))
    return failure("DM_REPUTATION_TRACK_INVALID", "Invalid track ID, version, range, baseline or presentation");
  const ids = new Set<string>(); let previousMax: number | null = null;
  for (const band of raw.bands) {
    if (!isRecord(band) || !isNamespaced(band.id) || ids.has(band.id) || !isText(band.label) || !isSafeInteger(band.minimum)
      || !isSafeInteger(band.maximum) || band.maximum < band.minimum || band.minimum < raw.minimum || band.maximum > raw.maximum
      || (previousMax !== null && band.minimum <= previousMax)) return failure("DM_REPUTATION_BAND_INVALID", "Bands must have unique IDs and sorted non-overlapping integer ranges");
    if (raw.publicPresentation === "band" && BigInt(band.minimum) !== (previousMax === null ? BigInt(raw.minimum) : BigInt(previousMax) + 1n))
      return failure("DM_REPUTATION_BAND_INVALID", "Band-only presentation requires complete range coverage");
    ids.add(band.id); previousMax = band.maximum;
  }
  if (raw.publicPresentation === "band" && previousMax !== raw.maximum) return failure("DM_REPUTATION_BAND_INVALID", "Band-only presentation requires complete range coverage");
  if (raw.decay !== null && (!isRecord(raw.decay) || !isSafeInteger(raw.decay.amount) || raw.decay.amount <= 0
    || !isSafeInteger(raw.decay.periodTicks) || raw.decay.periodTicks <= 0)) return failure("DM_REPUTATION_DECAY_INVALID", "Decay requires positive safe integer amount/period");
  return ok(immutable(structuredClone(raw)) as unknown as ReputationTrackDefinition);
}
export class ReputationTrackRegistry {
  readonly #definitions = new Map<string, ReputationTrackDefinition>(); #frozen = false;
  register(raw: ReputationTrackDefinition): Result<void> {
    if (this.#frozen) return failure("DM_REGISTRY_FROZEN", "Reputation registry is frozen", "conflict");
    const def = validateReputationTrackDefinition(raw); if (!def.ok) return def;
    const key = JSON.stringify([def.value.id, def.value.version]);
    if (this.#definitions.has(key)) return failure("DM_REPUTATION_TRACK_ALREADY_EXISTS", "Track version already exists", "conflict");
    this.#definitions.set(key, def.value); return ok(undefined);
  }
  get(id: string, version: number): ReputationTrackDefinition | undefined { return this.#definitions.get(JSON.stringify([id, version])); }
  list(): readonly ReputationTrackDefinition[] { return Object.freeze([...this.#definitions.values()]); }
  freeze(): void { this.#frozen = true; }
}
export function validateReputationRecord(raw: unknown, registry: ReputationTrackRegistry): Result<ReputationRecord> {
  if (!isRecord(raw) || !isJsonSafe(raw) || raw.schemaVersion !== 1 || !isOpaqueId(raw.id, "rep") || !isTimestamp(raw.revision)
    || !isText(raw.label) || !isVisibility(raw.visibility) || !isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)
    || raw.updatedAt < raw.createdAt || !Array.isArray(raw.tracks) || !raw.tracks.length || !Array.isArray(raw.entries))
    return failure("DM_REPUTATION_RECORD_INVALID", "Invalid reputation identity, timestamps or track/entry lists");
  const subject = validateRelationPartyRef(raw.subjectRef), audience = validateRelationPartyRef(raw.audienceRef);
  if (!subject.ok) return subject; if (!audience.ok) return audience;
  const tracks = new Map<string, ReputationTrack>(), scores = new Map<string, number>(), ids = new Set<string>(), reversed = new Set<string>();
  for (const track of raw.tracks) {
    if (!isRecord(track) || !isNamespaced(track.definitionId) || !isTimestamp(track.definitionVersion) || tracks.has(track.definitionId))
      return failure("DM_REPUTATION_TRACK_INVALID", "Record track IDs must be unique/versioned");
    const def = registry.get(track.definitionId, track.definitionVersion);
    if (!def) return failure("DM_REPUTATION_TRACK_UNAVAILABLE", "Track definition version unavailable", "not-found");
    if (!isSafeInteger(track.score) || !isSafeInteger(track.initialScore) || track.score < def.minimum || track.score > def.maximum
      || track.initialScore < def.minimum || track.initialScore > def.maximum || (track.lastDecayWorldTick !== null && !isTimestamp(track.lastDecayWorldTick)))
      return failure("DM_REPUTATION_SCORE_INVALID", "Track score, initial score or decay time invalid");
    tracks.set(track.definitionId, track as unknown as ReputationTrack); scores.set(track.definitionId, track.initialScore);
  }
  let lastAt = raw.createdAt;
  const entries = new Map<string, ReputationEntry>();
  for (const entry of raw.entries) {
    if (!isRecord(entry) || !isText(entry.id) || ids.has(entry.id) || !isNamespaced(entry.trackId) || !tracks.has(entry.trackId)
      || (entry.kind !== "adjustment" && entry.kind !== "reversal" && entry.kind !== "decay")
      || !isSafeInteger(entry.delta) || !isSafeInteger(entry.before) || !isSafeInteger(entry.after) || scores.get(entry.trackId) !== entry.before
      || BigInt(entry.after) - BigInt(entry.before) !== BigInt(entry.delta) || !isTypedRef(entry.source) || !isText(entry.reason)
      || !isTimestamp(entry.at) || entry.at < lastAt || entry.at > raw.updatedAt || (entry.worldTick !== null && !isTimestamp(entry.worldTick)))
      return failure("DM_REPUTATION_ENTRY_INVALID", "Broken score history, source, delta or event order");
    const track = tracks.get(entry.trackId)!, def = registry.get(track.definitionId, track.definitionVersion)!;
    if (entry.after < def.minimum || entry.after > def.maximum) return failure("DM_REPUTATION_ENTRY_INVALID", "Historical score outside definition range");
    if (entry.kind === "reversal") {
      const original = typeof entry.reversalOf === "string" ? entries.get(entry.reversalOf) : undefined;
      if (!original || original.kind !== "adjustment" || original.trackId !== entry.trackId || original.delta !== -entry.delta || reversed.has(original.id))
        return failure("DM_REPUTATION_REVERSAL_INVALID", "Reversal must compensate an original adjustment once");
      reversed.add(original.id);
    } else if (entry.reversalOf !== null) return failure("DM_REPUTATION_ENTRY_INVALID", "Only reversal entries reference an earlier entry");
    ids.add(entry.id); entries.set(entry.id, entry as unknown as ReputationEntry); scores.set(entry.trackId, entry.after); lastAt = entry.at;
  }
  if ([...tracks].some(([id, t]) => scores.get(id) !== t.score)) return failure("DM_REPUTATION_HISTORY_MISMATCH", "Current score diverges from append-oriented history");
  return ok(immutable(structuredClone(raw)) as unknown as ReputationRecord);
}
export interface ReputationAdjustment {
  readonly expectedRevision: number; readonly entryId: string; readonly trackId: string; readonly delta: number;
  readonly source: TypedRef; readonly reason: string; readonly at: number; readonly worldTick: number | null; readonly reversalOf?: string;
}
export function adjustReputation(record: ReputationRecord, registry: ReputationTrackRegistry, input: ReputationAdjustment,
  kind: ReputationEntry["kind"] = "adjustment"): Result<ReputationRecord> {
  const valid = validateReputationRecord(record, registry); if (!valid.ok) return valid;
  const stale = revisionGuard(record.revision, input.expectedRevision); if (stale) return stale;
  if (!isText(input.entryId) || record.entries.some(e => e.id === input.entryId) || !isSafeInteger(input.delta)
    || !isTimestamp(input.at) || input.at < record.updatedAt || !isTypedRef(input.source) || !isText(input.reason)
    || (input.worldTick !== null && !isTimestamp(input.worldTick))) return failure("DM_REPUTATION_ADJUSTMENT_INVALID", "Invalid adjustment or duplicate entry");
  const track = record.tracks.find(t => t.definitionId === input.trackId); if (!track) return failure("DM_REPUTATION_TRACK_UNAVAILABLE", "Record track missing", "not-found");
  const def = registry.get(track.definitionId, track.definitionVersion)!;
  const sum = BigInt(track.score) + BigInt(input.delta), after = boundedInteger(sum, def.minimum, def.maximum);
  if (kind === "reversal" && BigInt(after) !== sum) return failure("DM_REPUTATION_REVERSAL_OUT_OF_RANGE", "Exact compensation no longer fits the track range");
  const delta = Number(BigInt(after) - BigInt(track.score));
  if (!isSafeInteger(delta)) return failure("DM_REPUTATION_SCORE_OVERFLOW", "Applied score delta exceeds safe integer range");
  if (delta === 0 && kind === "adjustment") return ok(record);
  const entry: ReputationEntry = { id: input.entryId, trackId: input.trackId, kind, delta, before: track.score, after,
    source: input.source, reason: input.reason, at: input.at, worldTick: input.worldTick, reversalOf: input.reversalOf ?? null };
  return validateReputationRecord({ ...record, revision: record.revision + 1, updatedAt: input.at,
    tracks: record.tracks.map(t => t === track ? { ...t, score: after } : t), entries: [...record.entries, entry] }, registry);
}
export function decayReputation(record: ReputationRecord, registry: ReputationTrackRegistry, input: Omit<ReputationAdjustment, "delta">): Result<ReputationRecord> {
  const valid = validateReputationRecord(record, registry); if (!valid.ok) return valid;
  const stale = revisionGuard(record.revision, input.expectedRevision); if (stale) return stale;
  if (!isText(input.entryId) || record.entries.some(e => e.id === input.entryId) || !isTimestamp(input.at)
    || input.at < record.updatedAt || !isTypedRef(input.source) || !isText(input.reason) || input.reversalOf !== undefined)
    return failure("DM_REPUTATION_DECAY_INVALID", "Invalid decay audit context");
  const track = record.tracks.find(t => t.definitionId === input.trackId), def = track ? registry.get(track.definitionId, track.definitionVersion) : undefined;
  if (!track || !def?.decay || track.lastDecayWorldTick === null || !isTimestamp(input.worldTick) || input.worldTick < track.lastDecayWorldTick)
    return failure("DM_REPUTATION_DECAY_UNAVAILABLE", "Decay requires an explicit policy, baseline time and monotonic world tick");
  const periods = Math.floor((input.worldTick - track.lastDecayWorldTick) / def.decay.periodTicks);
  if (!periods) return ok(record);
  const distance = BigInt(def.baseline) - BigInt(track.score), amount = BigInt(periods) * BigInt(def.decay.amount);
  const magnitude = distance < 0n ? -distance : distance, movement = amount < magnitude ? amount : magnitude;
  const delta = Number(distance < 0n ? -movement : movement);
  if (!isSafeInteger(delta)) return failure("DM_REPUTATION_SCORE_OVERFLOW", "Decay delta exceeds safe integer range");
  const changed = adjustReputation(record, registry, { ...input, delta }, "decay"); if (!changed.ok) return changed;
  const next = changed.value;
  const consumedTick = track.lastDecayWorldTick + periods * def.decay.periodTicks;
  return validateReputationRecord({ ...next,
    tracks: next.tracks.map(t => t.definitionId === track.definitionId ? { ...t, lastDecayWorldTick: consumedTick } : t) }, registry);
}
export function projectReputation(record: ReputationRecord, registry: ReputationTrackRegistry, isGM: boolean,
  canSee: (visibility: RelationVisibility) => boolean): Result<unknown> {
  const valid = validateReputationRecord(record, registry); if (!valid.ok) return valid;
  if (!canSee(record.visibility)) return failure("DM_REPUTATION_NOT_FOUND", "Reputation not available", "not-found");
  if (isGM) return ok(structuredClone(record));
  const tracks = record.tracks.flatMap(track => {
    const def = registry.get(track.definitionId, track.definitionVersion)!;
    if (!canSee(def.visibility) || def.publicPresentation === "hidden") return [];
    const band = def.bands.find(b => track.score >= b.minimum && track.score <= b.maximum);
    return [{ definitionId: def.id, label: def.label, band: band?.label ?? null,
      ...(def.publicPresentation === "score" ? { score: track.score } : {}) }];
  });
  // No raw history, numeric before/after, source refs or hidden track counts leak into band-only view.
  return ok({ id: record.id, label: record.label, subjectRef: record.subjectRef, audienceRef: record.audienceRef, tracks });
}
