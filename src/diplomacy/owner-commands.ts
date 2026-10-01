import { ok, type Result } from "../core/contracts/result.js";
import { canonicalJsonStringify } from "../commands/command-dedupe-store.js";
import { createTransactionalHandler, type CommandRegistry } from "../commands/command-registry.js";
import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import { validateGmOnlyCommandPermission } from "../facilities/commands/facility-permissions.js";
import { failure, isJsonData, isRecord, isText, isTimestamp, revisionGuard } from "../core/validation/value-validation.js";
import { lockKey } from "../mutations/lock-keys.js";
import { normalizeDomainId, type TypedRef } from "../core/identity/refs.js";
import type { DomainReadRepository } from "../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../domains/domain-controller-provider.js";
import { relationOwner } from "../relations/relation-owner.js";
import { validateRelationUniqueness } from "../relations/types/relation-validation.js";
import type { RelationOwnerData } from "../relations/relation-owner.js";
import { reputationOwner } from "../reputation/reputation-owner.js";
import { agreementOwner, type AgreementOwnerData } from "../agreements/agreement-owner.js";
import { collectAgreementOwnerOperations, obligationTerm, type ObligationTermPayload, type AgreementOwnerOperation } from "../agreements/agreement-obligations.js";
import { territoryOwner, disputeOwner } from "../territory/territory-owner.js";
import { validateTerritoryGraph, previewTerritoryReparent, commitTerritoryReparent } from "../territory/territory-hierarchy.js";
import { validateTerritoryState, type TerritoryState } from "../territory/territory-state.js";
import { previewTerritoryClaimsImpact, type TerritoryClaimsImpactPreview } from "../territory/territory-claims-impact.js";
import { isTerritoryPreviewSnapshot, territoryPreviewSnapshot, type TerritoryPreviewSnapshot } from "./territory-preview-snapshot.js";
import { previewTerritoryTransfer, commitTerritoryTransfer, type TerritoryTransferTarget } from "../territory/territory-transfer.js";
import type { DiplomacyOwner, DiplomacyOwnerContext } from "./owner-contract.js";
import type { DiplomacyEntity, DiplomacyKind } from "./diplomacy-store.js";
import { diplomacyMutationDefinition, type DiplomacyMutationOptions, type DiplomacyPreparedWrite, type DiplomacyWrite } from "./diplomacy-mutation.js";
import { queryDiplomacyOwner, validateDiplomacyQuery } from "./diplomacy-query.js";
import { tryGetDomainPeopleData } from "../people/people-data.js";
import type { RelationPartyRef } from "../relations/types/relation-types.js";
export const DIPLOMACY_OWNERS: Readonly<Record<Exclude<DiplomacyKind, "proposal">, DiplomacyOwner>> = Object.freeze({
  relation: relationOwner, reputation: reputationOwner, agreement: agreementOwner, territory: territoryOwner, dispute: disputeOwner });
export const DIPLOMACY_NAMESPACES = { relation: "relations", reputation: "reputation", agreement: "agreements", territory: "territory", dispute: "disputes" } as const;
export interface OwnerIntent { readonly kind: Exclude<DiplomacyKind, "proposal">; readonly mode: "create" | "modify";
  readonly id: string; readonly expectedRevision?: number; readonly data?: unknown; readonly action?: unknown; readonly reason: string;
  readonly previewSnapshot?: TerritoryPreviewSnapshot; }
export interface OwnerCommandOptions extends DiplomacyMutationOptions {
  readonly registry: CommandRegistry; readonly domains: DomainReadRepository; readonly controllers: DomainControllerProvider;
  readonly worldTick: () => number;
  readonly conditionSatisfied?: (ref: TypedRef) => boolean;
}
export function validateOwnerIntent(raw: unknown): Result<OwnerIntent> {
  if (!isRecord(raw) || !isJsonData(raw) || !Object.hasOwn(DIPLOMACY_OWNERS, raw.kind as string) || (raw.mode !== "create" && raw.mode !== "modify")
    || !isText(raw.id) || !isText(raw.reason) || (raw.mode === "modify" && (!isTimestamp(raw.expectedRevision) || !isRecord(raw.action)))
    || (raw.mode === "create" && !isRecord(raw.data))) return failure("DM_DIPLOMACY_INTENT_INVALID", "Invalid semantic owner intent");
  if (raw.previewSnapshot !== undefined && (raw.kind !== "territory" || raw.mode !== "modify" || !isRecord(raw.action)
    || raw.action.kind !== "reparent" || !isTerritoryPreviewSnapshot(raw.previewSnapshot)))
    return failure("DM_DIPLOMACY_INTENT_INVALID", "Preview snapshot requires a territory reparent intent");
  return ok(raw as unknown as OwnerIntent);
}
/** Conservative dependency locks are rechecked against the actual semantic effect plan after fresh-read. */
export function diplomacyIntentLocks(intent: OwnerIntent, o: OwnerCommandOptions, includeLinkTargets = true): readonly string[] {
  const locks = new Set<string>([lockKey.diplomacy(intent.kind, intent.id)]);
  if (intent.mode === "create" || intent.kind === "reputation" && isRecord(intent.action)
    && ["add-track", "configure-track"].includes(intent.action.kind as string)) locks.add("diplomacy:catalog");
  if (intent.kind === "territory" || intent.kind === "dispute") locks.add(lockKey.territoryGraph());
  const scan = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(scan); return; } if (!isRecord(x)) return;
    for (const [key, value] of Object.entries(x)) {
      if (typeof value === "string" && value.startsWith("JournalEntry.") && (key === "domainUuid" || x.type === "domain" && key === "uuid")) locks.add(lockKey.domain(value));
      else if (typeof value === "object" && value !== null) scan(value);
    }
  };
  scan(intent); scan(o.store.get(intent.kind, intent.id)?.data);
  if (intent.kind === "territory" && isRecord(intent.action) && Array.isArray(intent.action.targets))
    for (const t of intent.action.targets) if (isRecord(t) && isText(t.territoryUuid)) locks.add(lockKey.diplomacy("territory", t.territoryUuid));
  if (intent.kind === "territory" && includeLinkTargets) {
    const action = intent.action as any, prior = o.store.get("territory", intent.id)?.data as TerritoryState | undefined;
    const links = intent.mode === "create" ? (intent.data as TerritoryState)?.links ?? []
      : action?.kind === "link" ? [action.value] : action?.kind === "update-link" ? prior?.links.filter(l => l.id === action.id) ?? [] : [];
    for (const link of links) if (isRecord(link) && isText(link.targetTerritoryUuid)) locks.add(lockKey.diplomacy("territory", link.targetTerritoryUuid));
  }
  return [...locks].sort();
}
function mutationContext(ctx: AuthenticatedCommandContext, revision: number, o: OwnerCommandOptions, reason: string): DiplomacyOwnerContext {
  return { expectedRevision: revision, eventId: ctx.command.commandId, at: ctx.receivedAtReal, worldTick: o.worldTick(), reason,
    sourceRefs: [{ type: "command", id: ctx.command.commandId }] };
}
async function validatePartyReferences(parties: readonly RelationPartyRef[], o: OwnerCommandOptions): Promise<Result<void>> {
  for (const party of parties) {
    const uuid = party.type === "domain" ? party.uuid : party.domainUuid;
    if (uuid) {
      const d = await o.domains.read(normalizeDomainId(uuid)); if (!d.ok) return failure("DM_DIPLOMACY_PARTY_UNAVAILABLE", "Referenced Domain unavailable", "not-found");
      if (party.type !== "domain") {
        const people = tryGetDomainPeopleData(d.value.record), collection = { populationGroup: "populationGroups", operationalGroup: "operationalGroups", notable: "notables" }[party.type as "populationGroup" | "operationalGroup" | "notable"];
        if (!people.ok || !collection || !(people.value as any)[collection].some((p: any) => p.id === party.id))
          return failure("DM_DIPLOMACY_PARTY_UNAVAILABLE", "Referenced People entity unavailable", "not-found");
      }
    } else if (party.type === "actor") {
      const actor = (globalThis as any).fromUuid ? await (globalThis as any).fromUuid(party.uuid) : (globalThis as any).game?.actors?.get?.(party.uuid?.slice(6));
      if (!actor) return failure("DM_DIPLOMACY_PARTY_UNAVAILABLE", "Referenced Actor unavailable", "not-found");
    } else if (party.type !== "narrative") return failure("DM_DIPLOMACY_PARTY_PROVIDER_UNAVAILABLE", "Referenced party provider unavailable", "not-found");
  }
  return ok(undefined);
}
export async function prepareOwnerIntent(intent: OwnerIntent, ctx: AuthenticatedCommandContext, o: OwnerCommandOptions, includeClaimPreview = false): Promise<Result<DiplomacyPreparedWrite>> {
  const owner = DIPLOMACY_OWNERS[intent.kind]; let before = await o.store.freshRead(intent.kind, intent.id);
  const reparent = intent.kind === "territory" && intent.mode === "modify" && (intent.action as any)?.kind === "reparent";
  let territories = o.store.list("territory").map(e => e.data as TerritoryState);
  if (intent.kind === "territory" || intent.kind === "dispute") {
    const ids = new Set(o.store.list("territory").map(e => e.id));
    if (reparent) for (const e of await o.store.adapter.loadAll()) if (e.kind === "territory") ids.add(e.id);
    for (const id of ids) await o.store.freshRead("territory", id);
    if (reparent) {
      const available = o.recovery.fenceRegistry.assertKeysAvailable([...ids].map(id => lockKey.diplomacy("territory", id))); if (!available.ok) return available;
      for (const e of o.store.list("territory")) { const valid = validateTerritoryState(e.data);
        if (!valid.ok) return valid;
        if (valid.value.territory.uuid !== e.id || valid.value.territory.revision !== e.revision)
          return failure("DM_TERRITORY_INVALID", "Territory identity or revision differs from its durable envelope");
      }
    }
    territories = o.store.list("territory").map(e => e.data as TerritoryState);
    if (reparent) before = o.store.get("territory", intent.id);
  }
  let claimInheritanceImpact: TerritoryClaimsImpactPreview | undefined, previewSnapshot: TerritoryPreviewSnapshot | undefined;
  let data: unknown, revision: number;
  if (intent.mode === "create") {
    if (before) return failure("DM_DIPLOMACY_ALREADY_EXISTS", "Entity already exists", "conflict");
    const valid = owner.validate(intent.data, territories); if (!valid.ok) return valid; data = valid.value;
    const identity = owner.identity(data);
    if (identity.id !== intent.id || identity.revision !== 0) return failure("DM_DIPLOMACY_CREATE_INVALID", "New entity must have matching identity and revision zero");
    if (intent.kind === "agreement" && (data as AgreementOwnerData).state.agreement.lifecycle !== "draft")
      return failure("DM_AGREEMENT_CREATE_INVALID", "New agreement must start as a draft");
    if (intent.kind === "agreement" && (data as AgreementOwnerData).executedOperations?.length)
      return failure("DM_AGREEMENT_CREATE_INVALID", "New agreement cannot declare previously executed owner operations");
    if (intent.kind === "relation") {
      const candidate = data as RelationOwnerData;
      const unique = validateRelationUniqueness(candidate.state.relation, candidate.definition,
        o.store.list("relation").map(e => (e.data as RelationOwnerData).state.relation));
      if (!unique.ok) return unique;
    }
    if (intent.kind === "reputation") {
      const next = data as import("../reputation/reputation-owner.js").ReputationOwnerData;
      if (next.configurationHistory?.length) return failure("DM_REPUTATION_CREATE_INVALID", "New reputation cannot claim prior configuration events");
      data = { ...next, record: { ...next.record, tracks: next.record.tracks.map(t => {
        const d = next.definitions.find(d => d.id === t.definitionId && d.version === t.definitionVersion)!;
        return { ...t, lastDecayWorldTick: d.decay ? o.worldTick() : null };
      }) } };
      const stamped = owner.validate(data, territories); if (!stamped.ok) return stamped; data = stamped.value;
    }
    // Versioned Definition snapshots cannot conflict with already stored exact versions.
    const definitions = (d: any): readonly any[] => d.definitions ?? (d.definition ? [d.definition] : []);
    for (const definition of definitions(data)) for (const e of o.store.list(intent.kind)) for (const old of definitions(e.data))
      if (old.id === definition.id && old.version === definition.version && canonicalJsonStringify(old) !== canonicalJsonStringify(definition))
        return failure("DM_DIPLOMACY_DEFINITION_CONFLICT", "Exact definition version already has a different snapshot", "conflict");
    revision = 0;
  } else {
    if (!before) return failure("DM_DIPLOMACY_NOT_FOUND", "Entity unavailable", "not-found");
    const stale = revisionGuard(before.revision, intent.expectedRevision!); if (stale) return stale;
    const c = mutationContext(ctx, before.revision, o, intent.reason), action = intent.action as Record<string, unknown>;
    if (intent.kind === "territory" && action.kind === "reparent") {
      const snapshot = territoryPreviewSnapshot(intent, territories, c.worldTick);
      if (intent.previewSnapshot && (snapshot.worldTick !== intent.previewSnapshot.worldTick || snapshot.fingerprint !== intent.previewSnapshot.fingerprint))
        return failure("DM_TERRITORY_PREVIEW_STALE", "Os territórios ou o relógio mudaram. Confira uma nova prévia antes de confirmar.", "conflict");
      const plan = previewTerritoryReparent(territories.map(s => s.territory), intent.id, action.parents as any, c); if (!plan.ok) return plan;
      const changed = commitTerritoryReparent(territories.map(s => s.territory), plan.value); if (!changed.ok) return changed;
      data = { ...(before.data as TerritoryState), territory: changed.value.find(t => t.uuid === intent.id)! };
      if (includeClaimPreview) {
        const impacts = previewTerritoryClaimsImpact(territories, territories.map(s => s.territory.uuid === intent.id ? data as TerritoryState : s), intent.id, c.worldTick);
        if (!impacts.ok) return impacts; claimInheritanceImpact = impacts.value; previewSnapshot = snapshot;
      }
    } else if (intent.kind === "territory" && action.kind === "transfer") {
      if (!Array.isArray(action.targets) || !action.targets.some(t => isRecord(t) && t.territoryUuid === intent.id))
        return failure("DM_TERRITORY_TRANSFER_INVALID", "Transfer must include the command's primary territory");
      const plan = previewTerritoryTransfer(territories, action.targets as readonly TerritoryTransferTarget[], c); if (!plan.ok) return plan;
      const changed = commitTerritoryTransfer(territories, plan.value); if (!changed.ok) return changed;
      const writes: DiplomacyWrite[] = changed.value.filter(s => plan.value.targets.some(t => t.territoryUuid === s.territory.uuid)).map(s => {
        const prior = o.store.get("territory", s.territory.uuid)!;
        return { before: prior, after: { ...prior, revision: s.territory.revision, data: s } };
      });
      const references = await validatePartyReferences(writes.flatMap(w => owner.parties(w.after.data)), o); if (!references.ok) return references;
      return ok({ writes, effects: [], result: { kind: "territory", id: intent.id, revision: writes.find(w => w.after.id === intent.id)?.after.revision ?? before.revision,
        changed: true, transferred: writes.map(w => ({ id: w.after.id, revision: w.after.revision })) } });
    } else {
      let effectiveAction: unknown = intent.action;
      if (intent.kind === "reputation" && action.kind === "configure-track") {
        let maxVersion = 0;
        for (const e of o.store.list("reputation")) for (const d of (e.data as import("../reputation/reputation-owner.js").ReputationOwnerData).definitions)
          if (d.id === action.trackId) maxVersion = Math.max(maxVersion, d.version);
        if (maxVersion === Number.MAX_SAFE_INTEGER) return failure("DM_REPUTATION_VERSION_INVALID", "Definition version cannot be incremented");
        effectiveAction = { ...action, definitionVersion: maxVersion + 1 };
      }
      const changed = owner.change(before.data, effectiveAction, c, territories); if (!changed.ok) return changed; data = changed.value; }
    const valid = owner.validate(data, territories); if (!valid.ok) return valid; data = valid.value; revision = owner.identity(data).revision;
  }
  // Configuration adds immutable content under the same catalog lock as creates.
  if (intent.kind === "reputation") {
    const next = data as import("../reputation/reputation-owner.js").ReputationOwnerData;
    for (const d of next.definitions) for (const e of o.store.list("reputation"))
      for (const old of (e.data as import("../reputation/reputation-owner.js").ReputationOwnerData).definitions)
        if (d.id === old.id && d.version === old.version && canonicalJsonStringify(d) !== canonicalJsonStringify(old))
          return failure("DM_DIPLOMACY_DEFINITION_CONFLICT", "Exact reputation definition version already has another snapshot", "conflict");
  }
  // Resolve referenced Domains through their owner, not a permissive Journal getter.
  const references = await validatePartyReferences(owner.parties(data), o); if (!references.ok) return references;
  if (intent.kind === "territory") {
    const candidate = data as TerritoryState, all = [...territories.filter(s => s.territory.uuid !== intent.id), candidate];
    const graph = validateTerritoryGraph(all.map(s => s.territory)); if (!graph.ok) return graph;
    const action = intent.action as any, referencedLinks = intent.mode === "create" ? candidate.links
      : action?.kind === "link" ? candidate.links.filter(l => l.id === action.value?.id)
      : action?.kind === "update-link" ? candidate.links.filter(l => l.id === action.id) : [];
    const available = o.recovery.fenceRegistry.assertKeysAvailable(referencedLinks.map(l => lockKey.diplomacy("territory", l.targetTerritoryUuid)));
    if (!available.ok) return available;
    if (candidate.links.some(l => !all.some(s => s.territory.uuid === l.targetTerritoryUuid))) return failure("DM_TERRITORY_LINK_TARGET_MISSING", "Link target unavailable", "not-found");
  }
  const effects: AgreementOwnerOperation[] = [];
  if (intent.kind === "agreement") {
    const next = data as AgreementOwnerData, old = before?.data as AgreementOwnerData | undefined;
    const prior = old?.executedOperations ?? [];
    effects.push(...collectAgreementOwnerOperations(next.state.agreement, next.definition, o.worldTick()).filter(op => !prior.includes(canonicalJsonStringify(op))));
    const action = intent.action;
    if (isRecord(action) && action.kind === "obligation" && action.applyConsequences === true) {
      const obligation = next.state.obligations.find(x => x.id === action.obligationId);
      if (!isRecord(action.action) || action.action.kind !== "decide" || action.action.lifecycle !== "breached" || obligation?.lifecycle !== "breached")
        return failure("DM_AGREEMENT_CONSEQUENCE_INVALID", "Consequences require an explicit confirmed breach decision");
      const term = obligationTerm(next.state.agreement, obligation!);
      for (const op of (term?.payload as ObligationTermPayload | undefined)?.consequences ?? []) {
        const consequence = { ...op, id: `${obligation!.id}:${op.id}` };
        if (!prior.includes(canonicalJsonStringify(consequence))) effects.push(consequence);
      }
    }
    data = { ...next, executedOperations: [...prior, ...effects.map(op => canonicalJsonStringify(op))] };
  }
  const after: DiplomacyEntity = { schemaVersion: 1, kind: intent.kind, id: intent.id, revision, data, receipts: before?.receipts ?? [] };
  return ok({ writes: [{ before, after }], effects, result: { kind: intent.kind, id: intent.id, revision, changed: !before || revision !== before.revision,
    ...(claimInheritanceImpact ? { claimInheritanceImpact, previewSnapshot } : {}) } });
}
export function registerOwnerCommands(o: OwnerCommandOptions): void {
  o.registry.register({ type: "territory:preview", visibility: "public", permissionValidator: validateGmOnlyCommandPermission,
    schemaValidator: p => validateOwnerIntent({ ...(isRecord(p) ? p : {}), kind: "territory", mode: "modify" }),
    handler: async (ctx): Promise<Result<unknown>> => {
      const intent = { ...ctx.command.payload, kind: "territory", mode: "modify" } as OwnerIntent;
      const available = o.recovery.fenceRegistry.assertKeysAvailable(diplomacyIntentLocks(intent, o)); if (!available.ok) return available;
      const prepared = await prepareOwnerIntent(intent, ctx, o, true); if (!prepared.ok) return prepared;
      const impact = prepared.value.result as { claimInheritanceImpact?: TerritoryClaimsImpactPreview; previewSnapshot?: TerritoryPreviewSnapshot };
      return ok({ id: intent.id, expectedRevision: intent.expectedRevision, facilityOwnershipChanges: 0,
        ...(impact.claimInheritanceImpact ? { claimInheritanceImpact: impact.claimInheritanceImpact, previewSnapshot: impact.previewSnapshot } : {}),
        changes: prepared.value.writes.map(w => ({ id: w.after.id, before: w.before?.data ?? null, after: w.after.data })) });
    } });
  for (const [kind, owner] of Object.entries(DIPLOMACY_OWNERS) as [Exclude<DiplomacyKind, "proposal">, DiplomacyOwner][]) {
    const namespace = DIPLOMACY_NAMESPACES[kind];
    for (const mode of ["create", "modify"] as const) {
      const intentFor = (ctx: AuthenticatedCommandContext<any>) => ({ ...ctx.command.payload, kind, mode } as OwnerIntent);
      const definition = diplomacyMutationDefinition(kind, o, ctx => diplomacyIntentLocks(intentFor(ctx), o), fresh => prepareOwnerIntent(intentFor(fresh.context), fresh.context, o));
      o.registry.register({ type: `${namespace}:${mode}`, visibility: "public", transactional: true, permissionValidator: validateGmOnlyCommandPermission,
        schemaValidator: p => validateOwnerIntent({ ...(isRecord(p) ? p : {}), kind, mode }), mutationDefinition: definition,
        handler: createTransactionalHandler(o.coordinator, definition) });
    }
    o.registry.register({ type: `${namespace}:query`, visibility: "public", schemaValidator: raw => validateDiplomacyQuery(raw, kind),
      handler: ctx => queryDiplomacyOwner(ctx, kind, owner, o.store, o.domains, o.controllers, o.recovery, o.worldTick()) });
  }
}
