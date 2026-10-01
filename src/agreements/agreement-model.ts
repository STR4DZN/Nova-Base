import { isJsonSafe } from "../commands/command-envelope.js";
import { ok, type Result } from "../core/contracts/result.js";
import type { TypedRef } from "../core/identity/refs.js";
import { isJsonData, failure, immutable, isNamespaced, isRecord, isText, isTimestamp, isTypedRef, isVisibility,
  revisionGuard } from "../core/validation/value-validation.js";
import type { RelationParty, RelationVisibility } from "../relations/types/relation-types.js";
import { validateRelationPartyRef } from "../relations/types/relation-validation.js";
import { mergeAgreementTermSelection } from "./agreement-term-selection.js";

export const AGREEMENT_LIFECYCLES = ["draft", "proposed", "pendingApproval", "active", "suspended", "breached", "expired", "terminated"] as const;
export type AgreementLifecycle = typeof AGREEMENT_LIFECYCLES[number];
export interface AgreementDefinition {
  readonly id: string; readonly version: number; readonly label: string; readonly minParties: number; readonly maxParties: number | null;
  readonly allowedPartyRoles: readonly string[]; readonly allowedTermTypes: readonly string[];
  readonly amendmentRequiresApproval: boolean; readonly automaticRenewalAllowed: boolean;
  readonly effectiveLifecycles: readonly ("active" | "breached")[];
}
export interface AgreementTerm {
  readonly id: string; readonly type: string; readonly title: string; readonly text: string | null;
  readonly visibility: RelationVisibility; readonly partyIds: readonly string[]; readonly payload: Readonly<Record<string, unknown>>;
}
export interface AgreementDuration { readonly startsAtWorldTick: number | null; readonly expiresAtWorldTick: number | null; }
export interface AgreementProposalRound {
  readonly round: number; readonly terms: readonly AgreementTerm[]; readonly duration: AgreementDuration;
  readonly offeredByPartyId: string; readonly at: number; readonly acceptedPartyIds: readonly string[]; readonly rejectedPartyIds: readonly string[];
}
export interface AgreementProposal {
  readonly id: string; readonly revision: number; readonly purpose: "initial" | "amendment";
  readonly lifecycle: "open" | "accepted" | "rejected" | "expired" | "enacted";
  readonly expiresAtWorldTick: number | null; readonly rounds: readonly AgreementProposalRound[];
}
export interface AgreementEvent {
  readonly id: string; readonly kind: AgreementAction["kind"]; readonly reason: string; readonly at: number;
  readonly worldTick: number; readonly sourceRefs: readonly TypedRef[]; readonly proposalId: string | null; readonly proposalRound: number | null;
}
export interface AgreementAmendment {
  readonly id: string; readonly proposalId: string | null; readonly beforeTerms: readonly AgreementTerm[]; readonly afterTerms: readonly AgreementTerm[];
  readonly beforeDuration: AgreementDuration; readonly afterDuration: AgreementDuration; readonly appliedAt: number;
}
export interface AgreementInstance {
  readonly schemaVersion: 1; readonly id: string; readonly definitionId: string; readonly definitionVersion: number; readonly revision: number;
  readonly label: string; readonly visibility: RelationVisibility; readonly parties: readonly RelationParty[]; readonly terms: readonly AgreementTerm[];
  readonly duration: AgreementDuration; readonly lifecycle: AgreementLifecycle; readonly createdAt: number; readonly updatedAt: number;
  readonly proposals: readonly AgreementProposal[]; readonly amendments: readonly AgreementAmendment[]; readonly events: readonly AgreementEvent[];
  readonly supersedesId: string | null;
}
export class AgreementTermRegistry {
  readonly #validators = new Map<string, (payload: Readonly<Record<string, unknown>>, partyIds: readonly string[]) => Result<void>>(); #frozen = false;
  constructor() { this.#validators.set("domain-manager:narrative", () => ok(undefined)); }
  register(id: string, validator: (payload: Readonly<Record<string, unknown>>, partyIds: readonly string[]) => Result<void>): Result<void> {
    if (this.#frozen || this.#validators.has(id)) return failure("DM_AGREEMENT_TERM_REGISTRY_CONFLICT", "Term registry frozen or duplicate type", "conflict");
    if (!isNamespaced(id) || typeof validator !== "function") return failure("DM_AGREEMENT_TERM_TYPE_INVALID", "Invalid term validator");
    this.#validators.set(id, validator); return ok(undefined);
  }
  validate(term: AgreementTerm): Result<void> { const validator = this.#validators.get(term.type);
    return validator ? validator(term.payload, term.partyIds) : failure("DM_AGREEMENT_TERM_PROVIDER_UNAVAILABLE", "Term owner/validator unavailable", "not-found"); }
  freeze(): void { this.#frozen = true; }
}
export function validateAgreementDefinition(raw: unknown): Result<AgreementDefinition> {
  if (!isRecord(raw) || !isJsonData(raw) || !isNamespaced(raw.id) || !isTimestamp(raw.version) || raw.version < 1 || !isText(raw.label)
    || !isTimestamp(raw.minParties) || raw.minParties < 2 || (raw.maxParties !== null && (!isTimestamp(raw.maxParties) || raw.maxParties < raw.minParties))
    || !Array.isArray(raw.allowedPartyRoles) || !raw.allowedPartyRoles.length || !raw.allowedPartyRoles.every(isText)
    || new Set(raw.allowedPartyRoles).size !== raw.allowedPartyRoles.length || !Array.isArray(raw.allowedTermTypes)
    || !raw.allowedTermTypes.length || !raw.allowedTermTypes.every(isNamespaced) || new Set(raw.allowedTermTypes).size !== raw.allowedTermTypes.length
    || typeof raw.amendmentRequiresApproval !== "boolean" || typeof raw.automaticRenewalAllowed !== "boolean"
    || !Array.isArray(raw.effectiveLifecycles) || !raw.effectiveLifecycles.includes("active")
    || raw.effectiveLifecycles.some(x => x !== "active" && x !== "breached") || new Set(raw.effectiveLifecycles).size !== raw.effectiveLifecycles.length)
    return failure("DM_AGREEMENT_DEFINITION_INVALID", "Invalid agreement definition, parties, term types or effectiveness policy");
  return ok(immutable(structuredClone(raw)) as unknown as AgreementDefinition);
}
const validDuration = (x: unknown): x is AgreementDuration => isRecord(x)
  && (x.startsAtWorldTick === null || isTimestamp(x.startsAtWorldTick)) && (x.expiresAtWorldTick === null || isTimestamp(x.expiresAtWorldTick))
  && (x.startsAtWorldTick === null || x.expiresAtWorldTick === null || x.expiresAtWorldTick > x.startsAtWorldTick);
export function validateAgreementTerms(raw: unknown, d: Pick<AgreementDefinition, "allowedTermTypes">, partyIds: readonly string[], registry: AgreementTermRegistry): Result<readonly AgreementTerm[]> {
  if (!Array.isArray(raw) || !isJsonData(raw)) return failure("DM_AGREEMENT_TERMS_INVALID", "Terms must be a JSON array");
  const ids = new Set<string>();
  for (const t of raw) {
    if (!isRecord(t) || !isText(t.id) || ids.has(t.id) || !d.allowedTermTypes.includes(t.type as string) || !isText(t.title)
      || (t.text !== null && typeof t.text !== "string") || !isVisibility(t.visibility) || !isRecord(t.payload)
      || !Array.isArray(t.partyIds) || t.partyIds.some(x => !partyIds.includes(x)) || new Set(t.partyIds).size !== t.partyIds.length)
      return failure("DM_AGREEMENT_TERM_INVALID", "Invalid term identity/type, party or payload");
    const checked = registry.validate(t as unknown as AgreementTerm); if (!checked.ok) return checked; ids.add(t.id);
  }
  return ok(raw as readonly AgreementTerm[]);
}
export function validateAgreementInstance(raw: unknown, d: AgreementDefinition, registry: AgreementTermRegistry): Result<AgreementInstance> {
  const definition = validateAgreementDefinition(d); if (!definition.ok) return definition;
  if (!isRecord(raw) || !isJsonData(raw) || raw.schemaVersion !== 1 || !isText(raw.id) || raw.definitionId !== d.id || raw.definitionVersion !== d.version
    || !isTimestamp(raw.revision) || !isText(raw.label) || !isVisibility(raw.visibility) || !AGREEMENT_LIFECYCLES.includes(raw.lifecycle as AgreementLifecycle)
    || !isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt) || raw.updatedAt < raw.createdAt || !validDuration(raw.duration)
    || !Array.isArray(raw.parties) || raw.parties.length < d.minParties || (d.maxParties !== null && raw.parties.length > d.maxParties)
    || !Array.isArray(raw.proposals) || !Array.isArray(raw.amendments) || !Array.isArray(raw.events)
    || (raw.supersedesId !== null && (!isText(raw.supersedesId) || raw.supersedesId === raw.id)))
    return failure("DM_AGREEMENT_INSTANCE_INVALID", "Invalid agreement identity, duration, parties, history or lifecycle");
  const parties = new Set<string>(), refs = new Set<string>();
  for (const p of raw.parties) {
    if (!isRecord(p) || !isText(p.id) || parties.has(p.id) || !d.allowedPartyRoles.includes(p.role as string))
      return failure("DM_AGREEMENT_PARTY_INVALID", "Invalid or duplicate agreement party");
    const ref = validateRelationPartyRef(p.ref); if (!ref.ok) return ref;
    const key = JSON.stringify([ref.value.type, ref.value.uuid ?? ref.value.id, ref.value.domainUuid ?? null]);
    if (refs.has(key)) return failure("DM_AGREEMENT_PARTY_INVALID", "Party reference duplicated"); parties.add(p.id); refs.add(key);
  }
  const ids = [...parties], terms = validateAgreementTerms(raw.terms, d, ids, registry); if (!terms.ok) return terms;
  const proposalIds = new Set<string>(); let open = 0;
  for (const p of raw.proposals) {
    if (!isRecord(p) || !isText(p.id) || proposalIds.has(p.id) || !isTimestamp(p.revision) || (p.purpose !== "initial" && p.purpose !== "amendment")
      || !["open", "accepted", "rejected", "expired", "enacted"].includes(p.lifecycle as string)
      || (p.expiresAtWorldTick !== null && !isTimestamp(p.expiresAtWorldTick)) || !Array.isArray(p.rounds) || !p.rounds.length)
      return failure("DM_AGREEMENT_PROPOSAL_INVALID", "Invalid proposal identity/revision/lifecycle");
    proposalIds.add(p.id); if (p.lifecycle === "open" || p.lifecycle === "accepted") open++;
    let lastAt = raw.createdAt;
    for (let i = 0; i < p.rounds.length; i++) { const r = p.rounds[i];
      if (!isRecord(r) || r.round !== i + 1 || !parties.has(r.offeredByPartyId as string) || !isTimestamp(r.at) || r.at < lastAt || r.at > raw.updatedAt
        || !validDuration(r.duration) || !Array.isArray(r.acceptedPartyIds) || !Array.isArray(r.rejectedPartyIds)
        || r.acceptedPartyIds.some(x => !parties.has(x)) || r.rejectedPartyIds.some(x => !parties.has(x))
        || new Set([...r.acceptedPartyIds, ...r.rejectedPartyIds]).size !== r.acceptedPartyIds.length + r.rejectedPartyIds.length)
        return failure("DM_AGREEMENT_ROUND_INVALID", "Invalid proposal snapshot, votes or chronology");
      const checked = validateAgreementTerms(r.terms, d, ids, registry); if (!checked.ok) return checked; lastAt = r.at;
    }
    const final = p.rounds.at(-1)!;
    if ((p.lifecycle === "accepted" || p.lifecycle === "enacted") && (final.acceptedPartyIds.length !== ids.length || final.rejectedPartyIds.length))
      return failure("DM_AGREEMENT_PROPOSAL_INVALID", "Accepted proposal lacks unanimous acceptance");
  }
  if (open > 1) return failure("DM_AGREEMENT_PROPOSAL_CONFLICT", "Only one open amendment/proposal at a time");
  const amendmentIds = new Set<string>();
  for (const a of raw.amendments) {
    if (!isRecord(a) || !isText(a.id) || amendmentIds.has(a.id) || (a.proposalId !== null && !proposalIds.has(a.proposalId as string))
      || !isTimestamp(a.appliedAt) || a.appliedAt < raw.createdAt || a.appliedAt > raw.updatedAt || !validDuration(a.beforeDuration) || !validDuration(a.afterDuration))
      return failure("DM_AGREEMENT_AMENDMENT_INVALID", "Invalid amendment snapshot");
    const before = validateAgreementTerms(a.beforeTerms, d, ids, registry), after = validateAgreementTerms(a.afterTerms, d, ids, registry);
    if (!before.ok) return before; if (!after.ok) return after; amendmentIds.add(a.id);
  }
  const eventIds = new Set<string>(); let lastAt = raw.createdAt;
  for (const e of raw.events) {
    if (!isRecord(e) || !isText(e.id) || eventIds.has(e.id) || !ACTION_KINDS.includes(e.kind as AgreementAction["kind"])
      || !isText(e.reason) || !isTimestamp(e.at) || e.at < lastAt || e.at > raw.updatedAt || !isTimestamp(e.worldTick)
      || !Array.isArray(e.sourceRefs) || !e.sourceRefs.length || !e.sourceRefs.every(isTypedRef)
      || (e.proposalId !== null && !proposalIds.has(e.proposalId as string)) || (e.proposalRound !== null && (!isTimestamp(e.proposalRound) || e.proposalRound < 1)))
      return failure("DM_AGREEMENT_EVENT_INVALID", "Invalid append-oriented agreement event");
    eventIds.add(e.id); lastAt = e.at;
  }
  return ok(immutable(structuredClone(raw)) as unknown as AgreementInstance);
}
export interface AgreementChangeContext {
  readonly expectedRevision: number; readonly eventId: string; readonly at: number; readonly worldTick: number;
  readonly reason: string; readonly sourceRefs: readonly TypedRef[];
}
export type AgreementAction =
  | { readonly kind: "propose" | "amend"; readonly proposalId: string; readonly partyId: string; readonly terms: readonly AgreementTerm[];
      readonly duration: AgreementDuration; readonly proposalExpiresAtWorldTick: number | null; readonly amendmentId?: string; readonly baseTermIds?: readonly string[] }
  | { readonly kind: "counter"; readonly proposalId: string; readonly expectedProposalRevision: number; readonly partyId: string;
      readonly terms: readonly AgreementTerm[]; readonly duration: AgreementDuration; readonly baseTermIds?: readonly string[] }
  | { readonly kind: "accept" | "reject"; readonly proposalId: string; readonly expectedProposalRevision: number; readonly partyId: string }
  | { readonly kind: "activate"; readonly proposalId: string; readonly expectedProposalRevision: number; readonly amendmentId?: string }
  | { readonly kind: "suspend" | "resume" | "breach" | "expire" | "terminate" }
  | { readonly kind: "expire-proposal"; readonly proposalId: string; readonly expectedProposalRevision: number }
  | { readonly kind: "renew"; readonly expiresAtWorldTick: number; readonly automatic: boolean };
const ACTION_KINDS: readonly AgreementAction["kind"][] = ["propose", "amend", "counter", "accept", "reject", "activate", "suspend", "resume", "breach", "expire", "terminate", "expire-proposal", "renew"];
export function agreementIsEffective(a: AgreementInstance, d: AgreementDefinition, worldTick: number): boolean {
  return isTimestamp(worldTick) && d.effectiveLifecycles.includes(a.lifecycle as "active" | "breached")
    && (a.duration.startsAtWorldTick === null || worldTick >= a.duration.startsAtWorldTick)
    && (a.duration.expiresAtWorldTick === null || worldTick < a.duration.expiresAtWorldTick);
}
export function changeAgreement(a: AgreementInstance, d: AgreementDefinition, registry: AgreementTermRegistry,
  c: AgreementChangeContext, action: AgreementAction): Result<AgreementInstance> {
  const valid = validateAgreementInstance(a, d, registry); if (!valid.ok) return valid;
  const stale = revisionGuard(a.revision, c.expectedRevision); if (stale) return stale;
  if (!isJsonSafe(action) || !isText(c.eventId) || a.events.some(e => e.id === c.eventId) || !isTimestamp(c.at) || c.at < a.updatedAt
    || !isTimestamp(c.worldTick) || !isText(c.reason) || !c.sourceRefs.length || !c.sourceRefs.every(isTypedRef))
    return failure("DM_AGREEMENT_CHANGE_INVALID", "Invalid command context or duplicate event");
  let next = structuredClone(a), proposal: AgreementProposal | undefined;
  if ("proposalId" in action && action.kind !== "propose" && action.kind !== "amend") {
    proposal = a.proposals.find(p => p.id === action.proposalId);
    if (!proposal) return failure("DM_AGREEMENT_PROPOSAL_NOT_FOUND", "Proposal unavailable", "not-found");
    const conflict = revisionGuard(proposal.revision, "expectedProposalRevision" in action ? action.expectedProposalRevision : -1); if (conflict) return conflict;
    if (action.kind !== "expire-proposal" && proposal.expiresAtWorldTick !== null && c.worldTick >= proposal.expiresAtWorldTick)
      return failure("DM_AGREEMENT_PROPOSAL_EXPIRED", "Proposal is past its acceptance deadline", "conflict");
  }
  const setProposal = (p: AgreementProposal) => { next = { ...next, proposals: next.proposals.map(x => x.id === p.id ? p : x) }; };
  if (action.kind === "propose" || action.kind === "amend") {
    if ((action.kind === "propose" && a.lifecycle !== "draft") || (action.kind === "amend" && !["active", "breached", "suspended"].includes(a.lifecycle))
      || !isText(action.proposalId) || a.proposals.some(p => p.id === action.proposalId || p.lifecycle === "open" || p.lifecycle === "accepted")
      || !a.parties.some(p => p.id === action.partyId) || !validDuration(action.duration)
      || (action.proposalExpiresAtWorldTick !== null && (!isTimestamp(action.proposalExpiresAtWorldTick) || action.proposalExpiresAtWorldTick <= c.worldTick)))
      return failure("DM_AGREEMENT_PROPOSAL_CONFLICT", "Invalid proposal, source lifecycle, party or deadline", "conflict");
    const selected = action.baseTermIds === undefined ? ok(action.terms) : mergeAgreementTermSelection(a.terms, action.terms, action.baseTermIds);
    if (!selected.ok) return selected;
    const terms = validateAgreementTerms(selected.value, d, a.parties.map(p => p.id), registry); if (!terms.ok) return terms;
    if (action.kind === "amend" && !d.amendmentRequiresApproval) {
      if (!isText(action.amendmentId) || a.amendments.some(x => x.id === action.amendmentId)) return failure("DM_AGREEMENT_AMENDMENT_INVALID", "Amendment requires unique audit ID");
      next = { ...next, terms: terms.value, duration: action.duration, amendments: [...a.amendments, { id: action.amendmentId,
        proposalId: null, beforeTerms: a.terms, afterTerms: terms.value, beforeDuration: a.duration, afterDuration: action.duration, appliedAt: c.at }] };
    } else next = { ...next, lifecycle: action.kind === "propose" ? "proposed" : a.lifecycle, proposals: [...a.proposals, {
      id: action.proposalId, revision: 0, purpose: action.kind === "propose" ? "initial" : "amendment", lifecycle: "open",
      expiresAtWorldTick: action.proposalExpiresAtWorldTick, rounds: [{ round: 1, offeredByPartyId: action.partyId, at: c.at,
        terms: terms.value, duration: action.duration, acceptedPartyIds: [], rejectedPartyIds: [] }] }] };
  } else if (action.kind === "counter") {
    if (proposal!.lifecycle !== "open" || !a.parties.some(p => p.id === action.partyId) || !validDuration(action.duration))
      return failure("DM_AGREEMENT_COUNTER_INVALID", "Counter requires an open proposal and valid party/duration");
    const selected = action.baseTermIds === undefined ? ok(action.terms) : mergeAgreementTermSelection(proposal!.rounds.at(-1)!.terms, action.terms, action.baseTermIds);
    if (!selected.ok) return selected;
    const terms = validateAgreementTerms(selected.value, d, a.parties.map(p => p.id), registry); if (!terms.ok) return terms;
    if (proposal!.rounds.length === Number.MAX_SAFE_INTEGER) return failure("DM_AGREEMENT_ROUND_OVERFLOW", "Too many proposal rounds");
    setProposal({ ...proposal!, revision: proposal!.revision + 1, rounds: [...proposal!.rounds, { round: proposal!.rounds.length + 1,
      terms: terms.value, duration: action.duration, offeredByPartyId: action.partyId, at: c.at, acceptedPartyIds: [], rejectedPartyIds: [] }] });
    if (proposal!.purpose === "initial") next = { ...next, lifecycle: "proposed" };
  } else if (action.kind === "accept" || action.kind === "reject") {
    if (proposal!.lifecycle !== "open" || !a.parties.some(p => p.id === action.partyId)) return failure("DM_AGREEMENT_VOTE_INVALID", "Vote requires an open proposal and valid party");
    const round = proposal!.rounds.at(-1)!;
    if (round.acceptedPartyIds.includes(action.partyId) || round.rejectedPartyIds.includes(action.partyId)) return ok(a);
    const voted = { ...round, acceptedPartyIds: action.kind === "accept" ? [...round.acceptedPartyIds, action.partyId] : round.acceptedPartyIds,
      rejectedPartyIds: action.kind === "reject" ? [...round.rejectedPartyIds, action.partyId] : round.rejectedPartyIds };
    setProposal({ ...proposal!, revision: proposal!.revision + 1, lifecycle: action.kind === "reject" ? "rejected"
      : voted.acceptedPartyIds.length === a.parties.length ? "accepted" : "open", rounds: [...proposal!.rounds.slice(0, -1), voted] });
    if (proposal!.purpose === "initial") next = { ...next, lifecycle: action.kind === "reject" ? "draft" : "pendingApproval" };
  } else if (action.kind === "activate") {
    if (proposal!.lifecycle !== "accepted" || (proposal!.purpose === "initial" ? a.lifecycle !== "pendingApproval" : !["active", "breached", "suspended"].includes(a.lifecycle)))
      return failure("DM_AGREEMENT_ACTIVATION_INVALID", "Agreement activation requires accepted current terms");
    const round = proposal!.rounds.at(-1)!, duration = { ...round.duration, startsAtWorldTick: round.duration.startsAtWorldTick ?? c.worldTick };
    if (!validDuration(duration) || (duration.expiresAtWorldTick !== null && duration.expiresAtWorldTick <= c.worldTick))
      return failure("DM_AGREEMENT_ACTIVATION_INVALID", "Agreement duration has already expired");
    if (proposal!.purpose === "amendment") {
      if (!isText(action.amendmentId) || a.amendments.some(x => x.id === action.amendmentId)) return failure("DM_AGREEMENT_AMENDMENT_INVALID", "Amendment requires unique audit ID");
      next = { ...next, amendments: [...a.amendments, { id: action.amendmentId, proposalId: proposal!.id, beforeTerms: a.terms,
        afterTerms: round.terms, beforeDuration: a.duration, afterDuration: duration, appliedAt: c.at }] };
    }
    setProposal({ ...proposal!, revision: proposal!.revision + 1, lifecycle: "enacted" });
    next = { ...next, lifecycle: proposal!.purpose === "initial" ? "active" : a.lifecycle, terms: round.terms, duration };
  } else if (action.kind === "expire-proposal") {
    if (proposal!.lifecycle === "expired") return ok(a);
    if (!["open", "accepted"].includes(proposal!.lifecycle) || proposal!.expiresAtWorldTick === null || c.worldTick < proposal!.expiresAtWorldTick)
      return failure("DM_AGREEMENT_PROPOSAL_EXPIRY_INVALID", "Proposal expiry deadline not reached");
    setProposal({ ...proposal!, revision: proposal!.revision + 1, lifecycle: "expired" });
    if (proposal!.purpose === "initial") next = { ...next, lifecycle: "draft" };
  } else if (action.kind === "renew") {
    if (!["active", "breached"].includes(a.lifecycle) || !isTimestamp(action.expiresAtWorldTick) || action.expiresAtWorldTick <= c.worldTick
      || a.duration.expiresAtWorldTick === null || action.expiresAtWorldTick <= a.duration.expiresAtWorldTick
      || (action.automatic && !d.automaticRenewalAllowed)) return failure("DM_AGREEMENT_RENEWAL_INVALID", "Renewal must extend a finite agreement under its policy");
    next = { ...next, duration: { ...a.duration, expiresAtWorldTick: action.expiresAtWorldTick } };
  } else {
    const target: AgreementLifecycle = ({ suspend: "suspended", resume: "active", breach: "breached", expire: "expired", terminate: "terminated" } as const)[action.kind];
    if (!target) return failure("DM_AGREEMENT_ACTION_INVALID", "Unknown agreement operation");
    if (a.lifecycle === target) return ok(a);
    const allowed: Record<string, readonly AgreementLifecycle[]> = { suspend: ["active", "breached"], resume: ["suspended", "breached"],
      breach: ["active", "suspended"], expire: ["active", "suspended", "breached"], terminate: ["draft", "proposed", "pendingApproval", "active", "suspended", "breached"] };
    if (!allowed[action.kind]?.includes(a.lifecycle) || (action.kind === "expire" && (a.duration.expiresAtWorldTick === null || c.worldTick < a.duration.expiresAtWorldTick)))
      return failure("DM_AGREEMENT_LIFECYCLE_INVALID", "Illegal lifecycle transition or expiry not due");
    next = { ...next, lifecycle: target, proposals: ["expired", "terminated"].includes(target) ? next.proposals.map(p =>
      ["open", "accepted"].includes(p.lifecycle) ? { ...p, revision: p.revision + 1, lifecycle: "expired" } : p) : next.proposals };
  }
  const event: AgreementEvent = { id: c.eventId, kind: action.kind, reason: c.reason, at: c.at, worldTick: c.worldTick,
    sourceRefs: c.sourceRefs, proposalId: "proposalId" in action && next.proposals.some(p => p.id === action.proposalId) ? action.proposalId : null,
    proposalRound: "proposalId" in action ? next.proposals.find(p => p.id === action.proposalId)?.rounds.length ?? null : null };
  return validateAgreementInstance({ ...next, revision: a.revision + 1, updatedAt: c.at, events: [...a.events, event] }, d, registry);
}
