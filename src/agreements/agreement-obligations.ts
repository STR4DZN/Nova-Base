import { ok, type Result } from "../core/contracts/result.js";
import { canonicalJsonStringify } from "../commands/command-dedupe-store.js";
import { isJournalEntryUuid, type TypedRef } from "../core/identity/refs.js";
import { failure, immutable, isJsonData, isNamespaced, isRecord, isText, isTimestamp, isTypedRef, isVisibility,
  revisionGuard } from "../core/validation/value-validation.js";
import type { RelationPartyRef, RelationVisibility } from "../relations/types/relation-types.js";
import { AgreementTermRegistry, agreementIsEffective, validateAgreementInstance, type AgreementChangeContext,
  type AgreementDefinition, type AgreementInstance, type AgreementTerm } from "./agreement-model.js";

export interface AgreementOwnerOperation {
  readonly id: string; readonly ownerId: string; readonly operation: string;
  readonly targetRefs: readonly TypedRef[]; readonly payload: Readonly<Record<string, unknown>>;
}
export interface ObligationTermPayload extends Readonly<Record<string, unknown>> {
  readonly kind: string; readonly obligatedPartyId: string; readonly beneficiaryPartyId: string | null;
  readonly dueAtWorldTick: number | null; readonly graceTicks: number; readonly overduePolicy: "report" | "allege-breach";
  readonly requirementRef: TypedRef; readonly consequences: readonly AgreementOwnerOperation[];
}
export interface RightTermPayload extends Readonly<Record<string, unknown>> {
  readonly beneficiaryPartyId: string; readonly territoryUuid: string; readonly rightType: string;
  readonly startsAtWorldTick: number | null; readonly expiresAtWorldTick: number | null;
  readonly inherited: boolean; readonly revocable: boolean; readonly conditionRefs: readonly TypedRef[]; readonly grants: readonly string[];
}
export interface CapabilityTermPayload extends Readonly<Record<string, unknown>> {
  readonly beneficiaryPartyId: string; readonly capabilityIds: readonly string[]; readonly scopeRef: TypedRef | null;
  readonly conditionRefs: readonly TypedRef[];
}
const validOperations = (x: unknown): x is readonly AgreementOwnerOperation[] => Array.isArray(x)
  && new Set(x.map(o => isRecord(o) ? o.id : null)).size === x.length && x.every(o => isRecord(o) && isText(o.id)
    && isNamespaced(o.ownerId) && isNamespaced(o.operation) && Array.isArray(o.targetRefs) && o.targetRefs.length > 0
    && o.targetRefs.every(isTypedRef) && isRecord(o.payload) && isJsonData(o.payload));
const conditionsValid = (x: unknown) => Array.isArray(x) && x.every(isTypedRef);
const namespacedList = (x: unknown, allowEmpty = true): x is readonly string[] => Array.isArray(x)
  && (allowEmpty || x.length > 0) && x.every(isNamespaced) && new Set(x).size === x.length;
export function registerAgreementTermOwners(registry: AgreementTermRegistry): Result<void> {
  const entries: [string, (p: Readonly<Record<string, unknown>>, parties: readonly string[]) => boolean][] = [
    ["domain-manager:obligation", (p, ids) => isNamespaced(p.kind) && ids.includes(p.obligatedPartyId as string)
      && (p.beneficiaryPartyId === null || ids.includes(p.beneficiaryPartyId as string)) && (p.dueAtWorldTick === null || isTimestamp(p.dueAtWorldTick))
      && isTimestamp(p.graceTicks) && (p.overduePolicy === "report" || p.overduePolicy === "allege-breach")
      && isTypedRef(p.requirementRef) && validOperations(p.consequences)],
    ["domain-manager:right", (p, ids) => ids.includes(p.beneficiaryPartyId as string) && isJournalEntryUuid(p.territoryUuid)
      && isNamespaced(p.rightType) && (p.startsAtWorldTick === null || isTimestamp(p.startsAtWorldTick))
      && (p.expiresAtWorldTick === null || isTimestamp(p.expiresAtWorldTick))
      && (p.startsAtWorldTick === null || p.expiresAtWorldTick === null || (p.expiresAtWorldTick as number) > (p.startsAtWorldTick as number))
      && typeof p.inherited === "boolean" && typeof p.revocable === "boolean" && conditionsValid(p.conditionRefs) && namespacedList(p.grants)],
    ["domain-manager:capability", (p, ids) => ids.includes(p.beneficiaryPartyId as string) && namespacedList(p.capabilityIds, false)
      && (p.scopeRef === null || isTypedRef(p.scopeRef)) && conditionsValid(p.conditionRefs)],
    ["domain-manager:owner-operation", p => validOperations(p.operations)]
  ];
  for (const [id, validate] of entries) {
    const r = registry.register(id, (p, ids) => validate(p, ids) ? ok(undefined) : failure("DM_AGREEMENT_TERM_PAYLOAD_INVALID", "Invalid structured term owner payload"));
    if (!r.ok) return r;
  }
  return ok(undefined);
}
export const OBLIGATION_LIFECYCLES = ["pending", "due", "satisfied", "waived", "breached", "expired", "cancelled"] as const;
export type ObligationLifecycle = typeof OBLIGATION_LIFECYCLES[number];
export interface ObligationEvidence {
  readonly id: string; readonly ref: TypedRef; readonly statement: string; readonly position: "support" | "contest";
  readonly visibility: RelationVisibility; readonly at: number;
}
export interface ObligationEvent {
  readonly id: string; readonly kind: "evidence" | "allege" | "contest" | "decide";
  readonly at: number; readonly worldTick: number; readonly reason: string; readonly sourceRefs: readonly TypedRef[];
  readonly before: ObligationLifecycle; readonly after: ObligationLifecycle; readonly evidenceId: string | null;
}
export interface AgreementObligation {
  readonly id: string; readonly termId: string; readonly revision: number; readonly lifecycle: ObligationLifecycle;
  readonly termsSource: { readonly kind: "proposal" | "amendment"; readonly id: string };
  readonly allegedBreach: boolean; readonly contested: boolean; readonly evidence: readonly ObligationEvidence[]; readonly events: readonly ObligationEvent[];
}
export interface AgreementState { readonly agreement: AgreementInstance; readonly obligations: readonly AgreementObligation[]; }
export function obligationTerm(a: AgreementInstance, o: AgreementObligation): AgreementTerm | undefined {
  const terms = o.termsSource.kind === "amendment" ? a.amendments.find(x => x.id === o.termsSource.id)?.afterTerms
    : a.proposals.find(x => x.id === o.termsSource.id && x.lifecycle === "enacted")?.rounds.at(-1)?.terms;
  return terms?.find(t => t.id === o.termId && t.type === "domain-manager:obligation");
}
const sameTerm = (a: AgreementTerm | undefined, b: AgreementTerm | undefined) => a !== undefined && b !== undefined
  && canonicalJsonStringify(a) === canonicalJsonStringify(b);
export function validateAgreementState(raw: unknown, d: AgreementDefinition, registry: AgreementTermRegistry): Result<AgreementState> {
  if (!isRecord(raw) || !isJsonData(raw) || !Array.isArray(raw.obligations)) return failure("DM_AGREEMENT_STATE_INVALID", "Invalid agreement state envelope");
  const a = validateAgreementInstance(raw.agreement, d, registry); if (!a.ok) return a;
  const ids = new Set<string>(), terms = new Set<string>();
  for (const o of raw.obligations) {
    if (!isRecord(o) || !isText(o.id) || ids.has(o.id) || !isText(o.termId) || !isRecord(o.termsSource)
      || (o.termsSource.kind !== "proposal" && o.termsSource.kind !== "amendment") || !isText(o.termsSource.id)
      || terms.has(JSON.stringify([o.termId, o.termsSource])) || !obligationTerm(a.value, o as unknown as AgreementObligation) || !isTimestamp(o.revision)
      || !OBLIGATION_LIFECYCLES.includes(o.lifecycle as ObligationLifecycle) || typeof o.allegedBreach !== "boolean" || typeof o.contested !== "boolean"
      || !Array.isArray(o.evidence) || !Array.isArray(o.events)) return failure("DM_AGREEMENT_OBLIGATION_INVALID", "Invalid or orphan obligation");
    const evidenceIds = new Set<string>();
    for (const e of o.evidence) {
      if (!isRecord(e) || !isText(e.id) || evidenceIds.has(e.id) || !isTypedRef(e.ref) || !isText(e.statement) || !isVisibility(e.visibility)
        || (e.position !== "support" && e.position !== "contest") || !isTimestamp(e.at) || e.at < a.value.createdAt || e.at > a.value.updatedAt)
        return failure("DM_AGREEMENT_EVIDENCE_INVALID", "Invalid evidence source, identity, visibility or chronology");
      evidenceIds.add(e.id);
    }
    const eventIds = new Set<string>(); let lifecycle: ObligationLifecycle = "pending", at = a.value.createdAt;
    for (const e of o.events) {
      if (!isRecord(e) || !isText(e.id) || eventIds.has(e.id) || !["evidence", "allege", "contest", "decide"].includes(e.kind as string)
        || !isTimestamp(e.at) || e.at < at || e.at > a.value.updatedAt || !isTimestamp(e.worldTick) || !isText(e.reason)
        || !Array.isArray(e.sourceRefs) || !e.sourceRefs.length || !e.sourceRefs.every(isTypedRef) || e.before !== lifecycle
        || !OBLIGATION_LIFECYCLES.includes(e.after as ObligationLifecycle) || (e.kind !== "decide" && e.before !== e.after)
        || (e.kind === "evidence" ? !evidenceIds.has(e.evidenceId as string) : e.evidenceId !== null))
        return failure("DM_AGREEMENT_OBLIGATION_HISTORY_INVALID", "Broken obligation event history");
      eventIds.add(e.id); lifecycle = e.after as ObligationLifecycle; at = e.at;
    }
    if (lifecycle !== o.lifecycle || o.revision !== o.events.length) return failure("DM_AGREEMENT_OBLIGATION_HISTORY_INVALID", "Obligation state diverges from events");
    ids.add(o.id); terms.add(JSON.stringify([o.termId, o.termsSource]));
  }
  return ok(immutable(structuredClone(raw)) as unknown as AgreementState);
}
/** Creates only new active term instances. Removed/replaced obligations remain historical. */
export function initializeAgreementObligations(a: AgreementInstance, existing: readonly AgreementObligation[] = []): readonly AgreementObligation[] {
  const amendment = a.amendments.at(-1), initial = a.proposals.find(p => p.purpose === "initial" && p.lifecycle === "enacted");
  const termsSource = amendment ? { kind: "amendment" as const, id: amendment.id } : initial ? { kind: "proposal" as const, id: initial.id } : null;
  if (!termsSource) return existing;
  const created = a.terms.filter(t => t.type === "domain-manager:obligation"
    && !existing.some(o => sameTerm(obligationTerm(a, o), t))).map(t => ({ id: `${a.id}:${termsSource.id}:${t.id}`, termId: t.id, termsSource,
    revision: 0, lifecycle: "pending" as const, allegedBreach: false, contested: false, evidence: [], events: [] }));
  return immutable(structuredClone([...existing, ...created]));
}
export type ObligationAction = { readonly kind: "evidence"; readonly evidence: ObligationEvidence }
  | { readonly kind: "allege" | "contest" } | { readonly kind: "decide"; readonly lifecycle: ObligationLifecycle };
export function changeObligation(state: AgreementState, d: AgreementDefinition, registry: AgreementTermRegistry,
  obligationId: string, expectedObligationRevision: number, c: AgreementChangeContext, action: ObligationAction): Result<AgreementState> {
  const valid = validateAgreementState(state, d, registry); if (!valid.ok) return valid;
  const a = state.agreement, stale = revisionGuard(a.revision, c.expectedRevision); if (stale) return stale;
  const o = state.obligations.find(x => x.id === obligationId); if (!o) return failure("DM_AGREEMENT_OBLIGATION_NOT_FOUND", "Obligation unavailable", "not-found");
  const conflict = revisionGuard(o.revision, expectedObligationRevision); if (conflict) return conflict;
  if (!isText(c.eventId) || o.events.some(e => e.id === c.eventId) || !isTimestamp(c.at) || c.at < a.updatedAt || !isTimestamp(c.worldTick)
    || !isText(c.reason) || !c.sourceRefs.length || !c.sourceRefs.every(isTypedRef) || !isJsonData(action))
    return failure("DM_AGREEMENT_OBLIGATION_CHANGE_INVALID", "Invalid obligation mutation context");
  let next = structuredClone(o);
  if (action.kind === "evidence") {
    if (o.evidence.some(e => e.id === action.evidence.id) || action.evidence.at !== c.at) return failure("DM_AGREEMENT_EVIDENCE_INVALID", "Duplicate or mismatched evidence time");
    next = { ...next, evidence: [...o.evidence, action.evidence], contested: o.contested || action.evidence.position === "contest" };
  } else if (action.kind === "allege" || action.kind === "contest") {
    if (action.kind === "allege" ? o.allegedBreach : o.contested) return ok(state);
    next = { ...next, allegedBreach: o.allegedBreach || action.kind === "allege", contested: o.contested || action.kind === "contest" };
  } else if (action.kind === "decide") {
    if (!OBLIGATION_LIFECYCLES.includes(action.lifecycle)) return failure("DM_AGREEMENT_OBLIGATION_LIFECYCLE_INVALID", "Unknown obligation state");
    if (o.lifecycle === action.lifecycle) return ok(state);
    if (["satisfied", "waived", "expired", "cancelled"].includes(o.lifecycle)) return failure("DM_AGREEMENT_OBLIGATION_LIFECYCLE_INVALID", "Terminal obligation cannot be silently reopened");
    next = { ...next, lifecycle: action.lifecycle, allegedBreach: action.lifecycle === "breached" ? true : o.allegedBreach, contested: false };
  } else return failure("DM_AGREEMENT_OBLIGATION_CHANGE_INVALID", "Unknown obligation operation");
  const event: ObligationEvent = { id: c.eventId, kind: action.kind, at: c.at, worldTick: c.worldTick, reason: c.reason,
    sourceRefs: c.sourceRefs, before: o.lifecycle, after: next.lifecycle, evidenceId: action.kind === "evidence" ? action.evidence.id : null };
  next = { ...next, revision: o.revision + 1, events: [...o.events, event] };
  return validateAgreementState({ agreement: { ...a, revision: a.revision + 1, updatedAt: c.at },
    obligations: state.obligations.map(x => x.id === o.id ? next : x) }, d, registry);
}
export interface ObligationCompliance {
  readonly applicable: boolean;
  readonly obligationId: string; readonly lifecycle: ObligationLifecycle; readonly pastGrace: boolean;
  readonly allegedBreach: boolean; readonly confirmedBreach: boolean; readonly contested: boolean;
}
export function resolveAgreementCompliance(state: AgreementState, worldTick: number): Result<readonly ObligationCompliance[]> {
  if (!isTimestamp(worldTick)) return failure("DM_AGREEMENT_COMPLIANCE_TIME_INVALID", "Compliance requires explicit world tick");
  return ok(state.obligations.map(o => {
    const term = obligationTerm(state.agreement, o);
    const applicable = state.agreement.terms.some(t => sameTerm(t, term));
    const p = applicable ? term?.payload as ObligationTermPayload | undefined : undefined;
    const due = p?.dueAtWorldTick !== null && p?.dueAtWorldTick !== undefined && worldTick >= p.dueAtWorldTick;
    const pastGrace = !!due && BigInt(worldTick) > BigInt(p!.dueAtWorldTick!) + BigInt(p!.graceTicks);
    const pending = o.lifecycle === "pending" || o.lifecycle === "due";
    return { obligationId: o.id, applicable, lifecycle: pending && due ? "due" : o.lifecycle, pastGrace,
      allegedBreach: o.allegedBreach || (pending && pastGrace && p?.overduePolicy === "allege-breach"),
      confirmedBreach: o.lifecycle === "breached", contested: o.contested };
  }));
}
export interface DerivedAgreementRight {
  readonly id: string; readonly agreementId: string; readonly termId: string; readonly beneficiaryRef: RelationPartyRef;
  readonly sourceVisibility: RelationVisibility; readonly payload: RightTermPayload;
}
export interface DerivedAgreementCapability {
  readonly capabilityId: string; readonly agreementId: string; readonly termId: string; readonly beneficiaryRef: RelationPartyRef;
  readonly scopeRef: TypedRef | null; readonly sourceVisibility: RelationVisibility;
}
export function resolveAgreementGrants(a: AgreementInstance, d: AgreementDefinition, worldTick: number,
  conditionSatisfied: (ref: TypedRef) => boolean, canSee: (v: RelationVisibility) => boolean): { rights: readonly DerivedAgreementRight[]; capabilities: readonly DerivedAgreementCapability[] } {
  const rights: DerivedAgreementRight[] = [], capabilities: DerivedAgreementCapability[] = [];
  if (!canSee(a.visibility) || !agreementIsEffective(a, d, worldTick)) return { rights, capabilities };
  for (const t of a.terms) {
    if (!canSee(t.visibility)) continue;
    if (t.type === "domain-manager:right") {
      const p = t.payload as RightTermPayload, beneficiaryRef = a.parties.find(x => x.id === p.beneficiaryPartyId)?.ref;
      if (!beneficiaryRef || (p.startsAtWorldTick !== null && worldTick < p.startsAtWorldTick) || (p.expiresAtWorldTick !== null && worldTick >= p.expiresAtWorldTick)
        || !p.conditionRefs.every(conditionSatisfied)) continue;
      rights.push({ id: `${a.id}:${t.id}`, agreementId: a.id, termId: t.id, beneficiaryRef, sourceVisibility: t.visibility, payload: p });
      for (const capabilityId of p.grants) capabilities.push({ capabilityId, agreementId: a.id, termId: t.id, beneficiaryRef,
        scopeRef: { type: "territory", uuid: p.territoryUuid }, sourceVisibility: t.visibility });
    } else if (t.type === "domain-manager:capability") {
      const p = t.payload as CapabilityTermPayload, beneficiaryRef = a.parties.find(x => x.id === p.beneficiaryPartyId)?.ref;
      if (!beneficiaryRef || !p.conditionRefs.every(conditionSatisfied)) continue;
      for (const capabilityId of p.capabilityIds) capabilities.push({ capabilityId, agreementId: a.id, termId: t.id, beneficiaryRef,
        scopeRef: p.scopeRef, sourceVisibility: t.visibility });
    }
  }
  return { rights: immutable(structuredClone(rights)), capabilities: immutable(structuredClone(capabilities)) };
}
/** Owner-operation intents are declarations. The owning service executes them through the shared transaction kernel. */
export function collectAgreementOwnerOperations(a: AgreementInstance, d: AgreementDefinition, worldTick: number): readonly AgreementOwnerOperation[] {
  if (!agreementIsEffective(a, d, worldTick)) return [];
  return immutable(structuredClone(a.terms.filter(t => t.type === "domain-manager:owner-operation").flatMap(t =>
    (t.payload.operations ?? []) as readonly AgreementOwnerOperation[])));
}
