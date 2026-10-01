import { ok, type Result } from "../core/contracts/result.js";
import { failure, immutable, isNamespaced, isRecord, isText, isTimestamp, isTypedRef } from "../core/validation/value-validation.js";
import type { TypedRef } from "../core/identity/refs.js";
import type { ReputationEntry, ReputationRecord } from "./reputation-model.js";
export const REPUTATION_ENTRY_KINDS = ["adjustment", "reversal", "decay"] as const;
export const reputationEntryLabels: Readonly<Record<ReputationEntry["kind"], string>> = Object.freeze({ adjustment: "Ajuste", reversal: "Reversão", decay: "Decadência" });
export interface ReputationHistoryFilter {
  readonly trackId?: string; readonly kind?: ReputationEntry["kind"];
  readonly sourceType?: string; readonly source?: TypedRef;
  readonly fromWorldTick?: number; readonly toWorldTick?: number;
}
export function validateReputationHistoryFilter(raw: unknown): Result<ReputationHistoryFilter> {
  const keys = ["trackId", "kind", "sourceType", "source", "fromWorldTick", "toWorldTick"];
  if (!isRecord(raw) || Object.keys(raw).some(k => !keys.includes(k))
    || raw.trackId !== undefined && !isNamespaced(raw.trackId)
    || raw.kind !== undefined && !REPUTATION_ENTRY_KINDS.includes(raw.kind as ReputationEntry["kind"])
    || raw.sourceType !== undefined && !isText(raw.sourceType)
    || raw.source !== undefined && (!isTypedRef(raw.source) || Object.keys(raw.source).some(k => !["type", "id", "uuid"].includes(k)))
    || raw.sourceType !== undefined && raw.source !== undefined && (raw.source as TypedRef).type !== raw.sourceType
    || raw.fromWorldTick !== undefined && !isTimestamp(raw.fromWorldTick)
    || raw.toWorldTick !== undefined && !isTimestamp(raw.toWorldTick)
    || raw.fromWorldTick !== undefined && raw.toWorldTick !== undefined && (raw.fromWorldTick as number) > (raw.toWorldTick as number))
    return failure("DM_REPUTATION_HISTORY_FILTER_INVALID", "Selecione filtros e um intervalo de ticks válidos.");
  return ok(immutable(structuredClone(raw)) as ReputationHistoryFilter);
}
export function reputationSourceValue(ref: TypedRef): string { return ref.uuid ?? ref.id!; }
export function reputationSourceKind(ref: TypedRef): "id" | "uuid" { return ref.uuid !== undefined ? "uuid" : "id"; }
function sameSource(a: TypedRef, b: TypedRef): boolean {
  return a.type === b.type && reputationSourceKind(a) === reputationSourceKind(b) && reputationSourceValue(a) === reputationSourceValue(b);
}
export interface ReputationSourceBreakdown {
  readonly trackId: string; readonly source: TypedRef; readonly entries: number;
  /** Exact applied integer sums serialized as decimal strings, never added across track scales. */
  readonly gains: string; readonly losses: string; readonly net: string;
  readonly byKind: Readonly<Record<ReputationEntry["kind"], number>>;
  readonly firstAt: number; readonly lastAt: number;
}
export interface ReputationHistoryView {
  readonly entries: readonly ReputationEntry[];
  readonly reputationHistory: {
    readonly filters: ReputationHistoryFilter; readonly total: number; readonly offset: number; readonly limit: number;
    readonly byKind: Readonly<Record<ReputationEntry["kind"], number>>;
    readonly sources: { readonly items: readonly ReputationSourceBreakdown[]; readonly total: number; readonly offset: number; readonly limit: number };
  };
}
const kinds = (): Record<ReputationEntry["kind"], number> => ({ adjustment: 0, reversal: 0, decay: 0 });
/** Read model over canonical, already validated GM data. Independent entry and source pages. */
export function projectReputationHistory(record: ReputationRecord, filters: ReputationHistoryFilter = {}, offset = 0, limit = 30,
  sourceOffset = 0, sourceLimit = 30): Result<ReputationHistoryView> {
  const checked = validateReputationHistoryFilter(filters); if (!checked.ok) return checked;
  if (![offset, limit, sourceOffset, sourceLimit].every(isTimestamp) || limit > 100 || sourceLimit < 1 || sourceLimit > 100)
    return failure("DM_REPUTATION_HISTORY_FILTER_INVALID", "Paginação do histórico inválida.");
  if (filters.trackId && !record.tracks.some(t => t.definitionId === filters.trackId))
    return failure("DM_REPUTATION_TRACK_UNAVAILABLE", "Trilha de reputação indisponível.", "not-found");
  const entries = record.entries.filter(e => (!filters.trackId || e.trackId === filters.trackId) && (!filters.kind || e.kind === filters.kind)
    && (!filters.sourceType || e.source.type === filters.sourceType) && (!filters.source || sameSource(e.source, filters.source))
    && (filters.fromWorldTick === undefined || e.worldTick !== null && e.worldTick >= filters.fromWorldTick)
    && (filters.toWorldTick === undefined || e.worldTick !== null && e.worldTick <= filters.toWorldTick));
  const byKind = kinds(), groups = new Map<string, { trackId: string; source: TypedRef; entries: number; gains: bigint; losses: bigint;
    byKind: Record<ReputationEntry["kind"], number>; firstAt: number; lastAt: number }>();
  for (const e of entries) {
    byKind[e.kind]++; const key = JSON.stringify([e.trackId, e.source.type, reputationSourceKind(e.source), reputationSourceValue(e.source)]);
    let group = groups.get(key); if (!group) { group = { trackId: e.trackId, source: e.source, entries: 0, gains: 0n, losses: 0n, byKind: kinds(), firstAt: e.at, lastAt: e.at }; groups.set(key, group); }
    group.entries++; group.byKind[e.kind]++; group.lastAt = e.at;
    if (e.delta > 0) group.gains += BigInt(e.delta); else group.losses += BigInt(e.delta);
  }
  const sources = [...groups.values()].slice(sourceOffset, sourceOffset + sourceLimit).map(g => ({ ...g,
    gains: g.gains.toString(), losses: g.losses.toString(), net: (g.gains + g.losses).toString() }));
  return ok(immutable(structuredClone({ entries: entries.slice(offset, offset + limit), reputationHistory: {
    filters: checked.value, total: entries.length, offset, limit, byKind, sources: { items: sources, total: groups.size, offset: sourceOffset, limit: sourceLimit } } })));
}
