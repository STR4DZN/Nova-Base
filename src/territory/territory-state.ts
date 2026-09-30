import { ok, type Result } from "../core/contracts/result.js";
import { isJournalEntryUuid, type TypedRef } from "../core/identity/refs.js";
import { boundedInteger, failure, immutable, isJsonData, isNamespaced, isRecord, isSafeInteger, isText, isTimestamp, isTypedRef, isVisibility, revisionGuard } from "../core/validation/value-validation.js";
import type { RelationPartyRef, RelationVisibility } from "../relations/types/relation-types.js";
import { validateRelationPartyRef } from "../relations/types/relation-validation.js";
import { validateTerritory, type Territory } from "./territory-hierarchy.js";

export interface TerritorialSource {
  readonly id: string; readonly sourceRef: TypedRef; readonly visibility: RelationVisibility;
  readonly startsAtWorldTick: number; readonly expiresAtWorldTick: number | null;
}
export interface TerritoryClaim extends TerritorialSource {
  readonly claimantRef: RelationPartyRef; readonly claimType: string; readonly lifecycle: "active" | "ended" | "superseded";
  readonly contested: boolean; readonly strength: number | null; readonly inherited: boolean;
}
export interface ClaimRecognition extends TerritorialSource {
  readonly claimId: string; readonly recognizingRef: RelationPartyRef; readonly position: "positive" | "negative" | "unknown";
}
export interface TerritoryPresence extends TerritorialSource {
  readonly partyRef: RelationPartyRef; readonly presenceType: string; readonly amount: number | null; readonly active: boolean;
}
export interface InfluenceAxis {
  readonly axisId: string; readonly base: number; readonly minimum: number; readonly maximum: number;
  readonly decay: { readonly amount: number; readonly periodTicks: number; readonly fromWorldTick: number; readonly baseline: number } | null;
}
export interface InfluenceModifier extends TerritorialSource { readonly axisId: string; readonly delta: number; readonly active: boolean; }
export interface TerritoryInfluence extends TerritorialSource {
  readonly partyRef: RelationPartyRef; readonly axes: readonly InfluenceAxis[]; readonly modifiers: readonly InfluenceModifier[]; readonly active: boolean;
}
/** Explicit/policy rights only. Agreement rights are resolved from the Agreement owner, never copied here. */
export interface TerritoryRight extends TerritorialSource {
  readonly beneficiaryRef: RelationPartyRef; readonly rightType: string; readonly inherited: boolean; readonly revocable: boolean;
  readonly active: boolean; readonly conditionRefs: readonly TypedRef[]; readonly grants: readonly string[];
}
export interface TerritoryLink extends TerritorialSource {
  readonly targetTerritoryUuid: string; readonly linkType: string; readonly direction: "both" | "outbound" | "inbound";
  readonly status: "operational" | "limited" | "closed" | "destroyed";
  readonly cost: number | null; readonly capacity: number | null; readonly dependencyRefs: readonly TypedRef[];
}
export interface TerritoryOccupation extends TerritorialSource {
  readonly occupierRef: RelationPartyRef; readonly lifecycle: "established" | "contested" | "stable" | "withdrawing" | "ended";
  readonly presenceIds: readonly string[]; readonly controlClaimIds: readonly string[];
}
export interface TerritoryStateEvent {
  readonly id: string; readonly at: number; readonly worldTick: number; readonly kind: string; readonly reason: string;
  readonly sourceRefs: readonly TypedRef[]; readonly targetIds: readonly string[];
  readonly before: unknown; readonly after: unknown;
}
export interface TerritoryState {
  readonly territory: Territory; readonly claims: readonly TerritoryClaim[]; readonly recognitions: readonly ClaimRecognition[];
  readonly presence: readonly TerritoryPresence[]; readonly influence: readonly TerritoryInfluence[];
  readonly rights: readonly TerritoryRight[]; readonly links: readonly TerritoryLink[]; readonly occupations: readonly TerritoryOccupation[];
  readonly events: readonly TerritoryStateEvent[];
}
export const emptyTerritoryState = (territory: Territory): TerritoryState => ({ territory, claims: [], recognitions: [], presence: [], influence: [], rights: [], links: [], occupations: [], events: [] });
export function temporalSourceIsEffective(s: TerritorialSource, tick: number): boolean {
  return isTimestamp(tick) && tick >= s.startsAtWorldTick && (s.expiresAtWorldTick === null || tick < s.expiresAtWorldTick);
}
const sourceValid = (s: unknown): s is TerritorialSource => isRecord(s) && isText(s.id) && isTypedRef(s.sourceRef) && isVisibility(s.visibility)
  && isTimestamp(s.startsAtWorldTick) && (s.expiresAtWorldTick === null || isTimestamp(s.expiresAtWorldTick) && s.expiresAtWorldTick > s.startsAtWorldTick);
const partyValid = (p: unknown) => validateRelationPartyRef(p).ok;
const refList = (x: unknown) => Array.isArray(x) && x.every(isTypedRef);
const textList = (x: unknown) => Array.isArray(x) && x.every(isText) && new Set(x).size === x.length;
const nonnegativeOrNull = (x: unknown) => x === null || isTimestamp(x);
const validators: Record<string, (x: Record<string, unknown>) => boolean> = {
  claims: x => partyValid(x.claimantRef) && isNamespaced(x.claimType) && ["active", "ended", "superseded"].includes(x.lifecycle as string)
    && typeof x.contested === "boolean" && nonnegativeOrNull(x.strength) && typeof x.inherited === "boolean",
  recognitions: x => isText(x.claimId) && partyValid(x.recognizingRef) && ["positive", "negative", "unknown"].includes(x.position as string),
  presence: x => partyValid(x.partyRef) && isNamespaced(x.presenceType) && nonnegativeOrNull(x.amount) && typeof x.active === "boolean",
  rights: x => partyValid(x.beneficiaryRef) && isNamespaced(x.rightType) && typeof x.inherited === "boolean" && typeof x.revocable === "boolean"
    && typeof x.active === "boolean" && refList(x.conditionRefs) && textList(x.grants) && (x.grants as string[]).every(isNamespaced),
  links: x => isJournalEntryUuid(x.targetTerritoryUuid) && isNamespaced(x.linkType) && ["both", "outbound", "inbound"].includes(x.direction as string)
    && ["operational", "limited", "closed", "destroyed"].includes(x.status as string) && nonnegativeOrNull(x.cost) && nonnegativeOrNull(x.capacity) && refList(x.dependencyRefs),
  occupations: x => partyValid(x.occupierRef) && ["established", "contested", "stable", "withdrawing", "ended"].includes(x.lifecycle as string)
    && textList(x.presenceIds) && textList(x.controlClaimIds),
  influence: x => {
    if (!partyValid(x.partyRef) || typeof x.active !== "boolean" || !Array.isArray(x.axes) || !x.axes.length || !Array.isArray(x.modifiers)) return false;
    const axes = new Set<string>();
    for (const a of x.axes) {
      if (!isRecord(a) || !isNamespaced(a.axisId) || axes.has(a.axisId) || !isSafeInteger(a.minimum) || !isSafeInteger(a.maximum) || a.maximum < a.minimum
        || !isSafeInteger(a.base) || a.base < a.minimum || a.base > a.maximum) return false;
      if (a.decay !== null && (!isRecord(a.decay) || !isTimestamp(a.decay.amount) || !isTimestamp(a.decay.periodTicks) || a.decay.periodTicks < 1
        || !isTimestamp(a.decay.fromWorldTick) || !isSafeInteger(a.decay.baseline) || a.decay.baseline < a.minimum || a.decay.baseline > a.maximum)) return false;
      axes.add(a.axisId);
    }
    const ids = new Set<string>();
    for (const m of x.modifiers) {
      if (!sourceValid(m) || !isRecord(m) || ids.has(m.id as string) || !axes.has(m.axisId as string) || !isSafeInteger(m.delta) || typeof m.active !== "boolean") return false;
      ids.add(m.id as string);
    }
    return true;
  }
};
export function validateTerritoryState(raw: unknown): Result<TerritoryState> {
  if (!isRecord(raw) || !isJsonData(raw)) return failure("DM_TERRITORY_STATE_INVALID", "Territory state must be JSON data");
  const t = validateTerritory(raw.territory); if (!t.ok) return t;
  for (const [key, validator] of Object.entries(validators)) {
    const list = raw[key]; if (!Array.isArray(list)) return failure("DM_TERRITORY_STATE_INVALID", "Missing territorial source collection");
    const ids = new Set<string>();
    for (const value of list) {
      if (!sourceValid(value) || !isRecord(value) || ids.has(value.id as string) || !validator(value))
        return failure("DM_TERRITORY_SOURCE_INVALID", "Invalid territorial source or duplicate identity");
      ids.add(value.id as string);
    }
  }
  const state = raw as unknown as TerritoryState;
  for (const r of state.recognitions) if (!state.claims.some(c => c.id === r.claimId)) return failure("DM_TERRITORY_RECOGNITION_ORPHAN", "Recognition refers to an unavailable claim");
  for (const o of state.occupations) if (o.presenceIds.some(id => !state.presence.some(p => p.id === id))
    || o.controlClaimIds.some(id => !state.claims.some(c => c.id === id && c.claimType === "domain-manager:control")))
    return failure("DM_TERRITORY_OCCUPATION_ORPHAN", "Occupation requires existing presence and control claims");
  if (state.links.some(l => l.targetTerritoryUuid === t.value.uuid)) return failure("DM_TERRITORY_LINK_INVALID", "A territory cannot link to itself");
  if (!Array.isArray(raw.events)) return failure("DM_TERRITORY_HISTORY_INVALID", "Territory history must be a list");
  const ids = new Set<string>(); let at = t.value.createdAt;
  for (const e of state.events) {
    if (!isRecord(e) || !isText(e.id) || ids.has(e.id) || !isNamespaced(e.kind) || !isText(e.reason) || !isTimestamp(e.at)
      || e.at < at || e.at > t.value.updatedAt || !isTimestamp(e.worldTick) || !refList(e.sourceRefs) || !e.sourceRefs.length
      || !textList(e.targetIds) || !e.targetIds.length || e.before === undefined || e.after === undefined)
      return failure("DM_TERRITORY_HISTORY_INVALID", "Invalid territorial event audit");
    at = e.at; ids.add(e.id);
  }
  if (state.events.length + t.value.hierarchyHistory.length > t.value.revision) return failure("DM_TERRITORY_HISTORY_INVALID", "Territory revision precedes audited changes");
  return ok(immutable(structuredClone(raw)) as unknown as TerritoryState);
}
export interface TerritoryChangeContext {
  readonly expectedRevision: number; readonly eventId: string; readonly at: number; readonly worldTick: number;
  readonly reason: string; readonly sourceRefs: readonly TypedRef[];
}
export type TerritorySourceCollection = "claims" | "recognitions" | "presence" | "influence" | "rights" | "links" | "occupations";
export type TerritoryAction =
  | { readonly kind: "claim"; readonly value: TerritoryClaim }
  | { readonly kind: "recognition"; readonly value: ClaimRecognition }
  | { readonly kind: "presence"; readonly value: TerritoryPresence }
  | { readonly kind: "influence"; readonly value: TerritoryInfluence }
  | { readonly kind: "right"; readonly value: TerritoryRight }
  | { readonly kind: "link"; readonly value: TerritoryLink }
  | { readonly kind: "occupation"; readonly value: TerritoryOccupation }
  | { readonly kind: "end-claim" | "contest-claim" | "revoke-right" | "end-presence" | "end-occupation"; readonly id: string }
  | { readonly kind: "update-link"; readonly id: string; readonly status: TerritoryLink["status"] };
const collectionFor: Record<string, string> = { claim: "claims", recognition: "recognitions", presence: "presence", influence: "influence", right: "rights", link: "links", occupation: "occupations" };
export function changeTerritoryState(s: TerritoryState, c: TerritoryChangeContext, action: TerritoryAction): Result<TerritoryState> {
  const valid = validateTerritoryState(s); if (!valid.ok) return valid;
  const stale = revisionGuard(s.territory.revision, c.expectedRevision); if (stale) return stale;
  if (!isJsonData(action) || !isText(c.eventId) || s.events.some(e => e.id === c.eventId) || s.territory.hierarchyHistory.some(e => e.id === c.eventId)
    || !isTimestamp(c.at) || c.at < s.territory.updatedAt || !isTimestamp(c.worldTick) || !isText(c.reason) || !refList(c.sourceRefs) || !c.sourceRefs.length)
    return failure("DM_TERRITORY_CHANGE_INVALID", "Invalid territorial audit context");
  let next: TerritoryState = structuredClone(s), before: unknown = null, after: unknown = null, id: string;
  if ("value" in action) {
    const collection = collectionFor[action.kind] as TerritorySourceCollection; const list: readonly TerritorialSource[] = s[collection];
    if (!collection || !sourceValid(action.value) || list.some(x => x.id === action.value.id)) return failure("DM_TERRITORY_SOURCE_INVALID", "Source ID already exists or malformed source");
    id = action.value.id; after = action.value; next = { ...next, [collection]: [...list, action.value] };
  } else {
    id = action.id;
    const collection = action.kind === "end-claim" || action.kind === "contest-claim" ? "claims" : action.kind === "revoke-right" ? "rights"
      : action.kind === "end-presence" ? "presence" : action.kind === "end-occupation" ? "occupations" : action.kind === "update-link" ? "links" : null;
    if (!collection) return failure("DM_TERRITORY_CHANGE_INVALID", "Unknown territorial action");
    const list = s[collection], target = list.find(x => x.id === id); if (!target) return failure("DM_TERRITORY_SOURCE_NOT_FOUND", "Territorial source unavailable", "not-found");
    before = target;
    if (action.kind === "end-claim") {
      if ((target as TerritoryClaim).lifecycle === "superseded") return failure("DM_TERRITORY_CLAIM_TERMINAL", "Superseded claim history cannot be rewritten");
      after = { ...target, lifecycle: "ended" };
    } else if (action.kind === "contest-claim") {
      if ((target as TerritoryClaim).lifecycle !== "active") return failure("DM_TERRITORY_CLAIM_TERMINAL", "Ended claim cannot be contested again");
      after = { ...target, contested: true };
    }
    else if (action.kind === "revoke-right") {
      if (!(target as TerritoryRight).revocable) return failure("DM_TERRITORY_RIGHT_NOT_REVOCABLE", "Right policy forbids revocation", "permission");
      after = { ...target, active: false };
    } else if (action.kind === "end-presence") after = { ...target, active: false };
    else if (action.kind === "end-occupation") after = { ...target, lifecycle: "ended" };
    else if (action.kind === "update-link") after = { ...target, status: action.status };
    else return failure("DM_TERRITORY_CHANGE_INVALID", "Unknown territorial action");
    if (JSON.stringify(before) === JSON.stringify(after)) return ok(s);
    next = { ...next, [collection]: list.map(x => x.id === id ? after : x) } as TerritoryState;
  }
  const event: TerritoryStateEvent = { id: c.eventId, at: c.at, worldTick: c.worldTick, kind: `domain-manager:${action.kind}`,
    reason: c.reason, sourceRefs: c.sourceRefs, targetIds: [id], before, after };
  return validateTerritoryState({ ...next, territory: { ...next.territory, revision: next.territory.revision + 1, updatedAt: c.at }, events: [...next.events, event] });
}
/** Filter hidden sources before resolving. No invisible modifier can alter a public number. */
export function resolveTerritoryInfluence(s: TerritoryState, tick: number, canSee: (v: RelationVisibility) => boolean): readonly {
  readonly influenceId: string; readonly partyRef: RelationPartyRef; readonly axisId: string; readonly base: number; readonly decay: number; readonly modifiers: number; readonly value: number;
}[] {
  if (!isTimestamp(tick) || !canSee(s.territory.visibility)) return [];
  return s.influence.filter(i => i.active && temporalSourceIsEffective(i, tick) && canSee(i.visibility)).flatMap(i => i.axes.map(a => {
    let base = BigInt(a.base);
    if (a.decay !== null && tick >= a.decay.fromWorldTick) {
      const n = (BigInt(tick) - BigInt(a.decay.fromWorldTick)) / BigInt(a.decay.periodTicks), amount = n * BigInt(a.decay.amount), baseline = BigInt(a.decay.baseline);
      base = base > baseline ? (base - amount < baseline ? baseline : base - amount) : (base + amount > baseline ? baseline : base + amount);
    }
    const modifiers = i.modifiers.filter(m => m.active && m.axisId === a.axisId && temporalSourceIsEffective(m, tick) && canSee(m.visibility))
      .reduce((n, m) => n + BigInt(m.delta), 0n);
    return { influenceId: i.id, partyRef: i.partyRef, axisId: a.axisId, base: a.base,
      decay: boundedInteger(base - BigInt(a.base), Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      modifiers: boundedInteger(modifiers, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), value: boundedInteger(base + modifiers, a.minimum, a.maximum) };
  }));
}
export function projectTerritoryState(s: TerritoryState, canSee: (v: RelationVisibility) => boolean): TerritoryState | null {
  if (!canSee(s.territory.visibility)) return null;
  const fields: Record<string, readonly string[]> = {
    claims: ["claimantRef", "claimType", "lifecycle", "contested", "strength", "inherited"], recognitions: ["claimId", "recognizingRef", "position"],
    presence: ["partyRef", "presenceType", "amount", "active"], influence: ["partyRef", "active", "axes", "modifiers"],
    rights: ["beneficiaryRef", "rightType", "inherited", "revocable", "active", "conditionRefs", "grants"],
    links: ["targetTerritoryUuid", "linkType", "direction", "status", "cost", "capacity", "dependencyRefs"],
    occupations: ["occupierRef", "lifecycle", "presenceIds", "controlClaimIds"], modifiers: ["axisId", "delta", "active"] };
  const ref = (r: any) => ({ type: r.type, ...(r.id !== undefined ? { id: r.id } : {}), ...(r.uuid !== undefined ? { uuid: r.uuid } : {}), ...(r.domainUuid !== undefined ? { domainUuid: r.domainUuid } : {}) });
  const projectSource = <T extends TerritorialSource>(value: T, collection: string): T => {
    const row = value as unknown as Record<string, unknown>, projected = Object.fromEntries(["id", "sourceRef", "visibility", "startsAtWorldTick", "expiresAtWorldTick", ...fields[collection]].map(k => [k, row[k]]));
    for (const key of ["sourceRef", "claimantRef", "recognizingRef", "partyRef", "beneficiaryRef", "occupierRef"]) if (projected[key]) projected[key] = ref(projected[key]);
    for (const key of ["conditionRefs", "dependencyRefs"]) if (Array.isArray(projected[key])) projected[key] = (projected[key] as any[]).map(ref);
    return projected as unknown as T;
  };
  const claims = s.claims.filter(x => canSee(x.visibility)).map(x => projectSource(x, "claims")), claimIds = new Set(claims.map(c => c.id));
  const presence = s.presence.filter(x => canSee(x.visibility)).map(x => projectSource(x, "presence")), presenceIds = new Set(presence.map(p => p.id));
  const publicOnly = !canSee("secret") || !canSee("restricted");
  return immutable(structuredClone({
    territory: { schemaVersion: s.territory.schemaVersion, uuid: s.territory.uuid, revision: s.territory.revision, label: s.territory.label,
      kind: s.territory.kind, scale: s.territory.scale, visibility: s.territory.visibility, createdAt: s.territory.createdAt, updatedAt: s.territory.updatedAt,
      locatedInUuid: s.territory.locatedInUuid, administrativeParentUuid: s.territory.administrativeParentUuid,
      geography: publicOnly ? {} : s.territory.geography, hierarchyHistory: publicOnly ? [] : s.territory.hierarchyHistory },
    claims, recognitions: s.recognitions.filter(x => claimIds.has(x.claimId) && canSee(x.visibility)).map(x => projectSource(x, "recognitions")), presence,
    influence: s.influence.filter(x => canSee(x.visibility)).map(x => ({ ...projectSource(x, "influence"), axes: x.axes.map(a => ({ axisId: a.axisId, base: a.base, minimum: a.minimum, maximum: a.maximum,
      decay: a.decay === null ? null : { amount: a.decay.amount, periodTicks: a.decay.periodTicks, fromWorldTick: a.decay.fromWorldTick, baseline: a.decay.baseline } })),
      modifiers: x.modifiers.filter(m => canSee(m.visibility)).map(m => projectSource(m, "modifiers")) })),
    rights: s.rights.filter(x => canSee(x.visibility)).map(x => projectSource(x, "rights")), links: s.links.filter(x => canSee(x.visibility)).map(x => projectSource(x, "links")),
    occupations: s.occupations.filter(x => canSee(x.visibility) && x.presenceIds.every(id => presenceIds.has(id)) && x.controlClaimIds.every(id => claimIds.has(id))).map(x => projectSource(x, "occupations")),
    events: publicOnly ? [] : s.events
  }));
}
