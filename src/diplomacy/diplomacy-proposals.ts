import { ok, type Result } from "../core/contracts/result.js";
import { failure, immutable, isJsonData, isRecord, isText, isTimestamp, revisionGuard } from "../core/validation/value-validation.js";
import { createTransactionalHandler } from "../commands/command-registry.js";
import { validateGmOnlyCommandPermission } from "../facilities/commands/facility-permissions.js";
import { lockKey } from "../mutations/lock-keys.js";
import { diplomacyMutationDefinition } from "./diplomacy-mutation.js";
import { DIPLOMACY_OWNERS, diplomacyIntentLocks, prepareOwnerIntent, validateOwnerIntent, type OwnerIntent, type OwnerCommandOptions } from "./owner-commands.js";
import { diplomacyViewerControls, diplomacyViewerIsGm } from "./diplomacy-permissions.js";
import { validateDiplomacyQuery } from "./diplomacy-query.js";
export interface DiplomacyProposal {
  readonly id: string; readonly revision: number; readonly label: string; readonly visibility: "restricted";
  readonly lifecycle: "pending" | "approved" | "rejected"; readonly requesterUserId: string;
  readonly createdAt: number; readonly original: OwnerIntent;
  readonly decision: null | { readonly reviewerUserId: string; readonly at: number; readonly reason: string; readonly approvedIntent: OwnerIntent | null };
}
export function validateDiplomacyProposal(raw: unknown): Result<DiplomacyProposal> {
  if (!isRecord(raw) || !isJsonData(raw) || !isText(raw.id) || !isTimestamp(raw.revision) || !isText(raw.label)
    || raw.visibility !== "restricted" || !["pending", "approved", "rejected"].includes(raw.lifecycle as string)
    || !isText(raw.requesterUserId) || !isTimestamp(raw.createdAt)) return failure("DM_DIPLOMACY_PROPOSAL_INVALID", "Invalid proposal record");
  const intent = validateOwnerIntent(raw.original); if (!intent.ok) return intent;
  if (raw.lifecycle === "pending" ? raw.decision !== null || raw.revision !== 0
    : !isRecord(raw.decision) || !isText(raw.decision.reviewerUserId) || !isTimestamp(raw.decision.at) || raw.decision.at < raw.createdAt
      || !isText(raw.decision.reason) || raw.revision !== 1 || (raw.lifecycle === "approved" ? !validateOwnerIntent(raw.decision.approvedIntent).ok : raw.decision.approvedIntent !== null))
    return failure("DM_DIPLOMACY_PROPOSAL_INVALID", "Invalid proposal decision audit");
  return ok(immutable(structuredClone(raw)) as unknown as DiplomacyProposal);
}
export function registerDiplomacyProposals(o: OwnerCommandOptions): void {
  const submitSchema = (p: unknown) => isRecord(p) && isText(p.id) && validateOwnerIntent(p.intent).ok
    ? ok(p) : failure("DM_DIPLOMACY_PROPOSAL_INVALID", "Proposal needs a stable ID and semantic intent");
  const submit = diplomacyMutationDefinition("proposal", o, ctx => [lockKey.diplomacy("proposal", ctx.command.payload.id),
    ...diplomacyIntentLocks(ctx.command.payload.intent, o)], async fresh => {
    const ctx = fresh.context, p = ctx.command.payload, intent = p.intent as OwnerIntent;
    if (fresh.entity) return failure("DM_DIPLOMACY_ALREADY_EXISTS", "Proposal already exists", "conflict");
    if (!ctx.senderUserId) return failure("DM_SECURITY_PERMISSION_DENIED", "Authenticated proposer required", "permission");
    if (!diplomacyViewerIsGm(ctx) && intent.kind === "reputation" && intent.mode === "modify"
      && isRecord(intent.action) && ["add-track", "configure-track"].includes(intent.action.kind as string))
      return failure("DM_SECURITY_PERMISSION_DENIED", "Existing reputation policy configuration requires the GM", "permission");
    const owner = DIPLOMACY_OWNERS[intent.kind], existing = intent.mode === "modify" ? o.store.get(intent.kind, intent.id) : null;
    if (intent.mode === "modify" && !existing) return failure("DM_DIPLOMACY_NOT_FOUND", "Entity unavailable", "not-found");
    const source = existing?.data ?? intent.data, valid = owner.validate(source, o.store.list("territory").map(e => e.data as any));
    if (!valid.ok) return valid;
    const controls = await diplomacyViewerControls(ctx, owner.parties(valid.value), o.domains, o.controllers);
    if (!diplomacyViewerIsGm(ctx) && (!controls || owner.identity(valid.value).visibility === "secret"))
      return failure("DM_SECURITY_PERMISSION_DENIED", "Proposer must control a visible participating Domain", "permission");
    // Validate the semantic proposal now; approval repeats this against freshly locked state.
    const prepared = await prepareOwnerIntent(intent, ctx, o); if (!prepared.ok) return prepared;
    const data: DiplomacyProposal = { id: p.id, revision: 0, label: owner.identity(valid.value).label, visibility: "restricted", lifecycle: "pending",
      requesterUserId: ctx.senderUserId, createdAt: ctx.receivedAtReal, original: structuredClone(intent), decision: null };
    return ok({ writes: [{ before: null, after: { schemaVersion: 1, kind: "proposal", id: p.id, revision: 0, data, receipts: [] } }],
      effects: [], result: { id: p.id, revision: 0, lifecycle: "pending" } });
  });
  o.registry.register({ type: "diplomacy:submit-proposal", visibility: "public", transactional: true,
    permissionValidator: ctx => {
      const existing = o.store.get("proposal", ctx.command.payload.id as string)?.data as DiplomacyProposal | undefined;
      return !existing || existing.requesterUserId === ctx.senderUserId ? ok(true)
        : failure("DM_SECURITY_PERMISSION_DENIED", "Proposal unavailable to this requester", "permission");
    },
    schemaValidator: submitSchema, mutationDefinition: submit, handler: createTransactionalHandler(o.coordinator, submit) });
  const decideSchema = (p: unknown) => isRecord(p) && isText(p.id) && isTimestamp(p.expectedRevision)
    && ["approve", "reject"].includes(p.decision as string) && isText(p.reason)
    && (p.editedIntent === undefined || validateOwnerIntent(p.editedIntent).ok) ? ok(p) : failure("DM_DIPLOMACY_PROPOSAL_INVALID", "Invalid proposal review");
  const decide = diplomacyMutationDefinition("proposal", o, ctx => {
    const p = ctx.command.payload, proposal = o.store.get("proposal", p.id)?.data as DiplomacyProposal | undefined;
    return [lockKey.diplomacy("proposal", p.id), ...(proposal ? diplomacyIntentLocks(p.editedIntent ?? proposal.original, o) : [])];
  }, async fresh => {
    if (!fresh.entity) return failure("DM_DIPLOMACY_NOT_FOUND", "Proposal unavailable", "not-found");
    const checked = validateDiplomacyProposal(fresh.entity.data); if (!checked.ok) return checked;
    const proposal = checked.value, ctx = fresh.context, p = ctx.command.payload, stale = revisionGuard(proposal.revision, p.expectedRevision); if (stale) return stale;
    if (proposal.lifecycle !== "pending") return failure("DM_DIPLOMACY_PROPOSAL_CLOSED", "Proposal already reviewed", "conflict");
    const approvedIntent = p.decision === "approve" ? (p.editedIntent ?? proposal.original) as OwnerIntent : null;
    if (approvedIntent && (approvedIntent.id !== proposal.original.id || approvedIntent.kind !== proposal.original.kind || approvedIntent.mode !== proposal.original.mode))
      return failure("DM_DIPLOMACY_PROPOSAL_INVALID", "Edited review must preserve target identity and operation mode");
    const prepared = approvedIntent ? await prepareOwnerIntent(approvedIntent, ctx, o) : ok({ writes: [], effects: [], result: null }); if (!prepared.ok) return prepared;
    const data: DiplomacyProposal = { ...proposal, revision: 1, lifecycle: approvedIntent ? "approved" : "rejected",
      decision: { reviewerUserId: ctx.senderUserId!, at: ctx.receivedAtReal, reason: p.reason, approvedIntent } };
    return ok({ writes: [{ before: fresh.entity, after: { ...fresh.entity, revision: 1, data } }, ...prepared.value.writes],
      effects: prepared.value.effects, result: { id: proposal.id, revision: 1, lifecycle: data.lifecycle, target: prepared.value.result } });
  });
  o.registry.register({ type: "diplomacy:decide-proposal", visibility: "public", transactional: true, permissionValidator: validateGmOnlyCommandPermission,
    schemaValidator: decideSchema, mutationDefinition: decide, handler: createTransactionalHandler(o.coordinator, decide) });
  o.registry.register({ type: "diplomacy:query-proposals", visibility: "public", schemaValidator: validateDiplomacyQuery,
    handler: async (ctx): Promise<Result<unknown>> => {
      const p = ctx.command.payload, isGm = diplomacyViewerIsGm(ctx), visible = o.store.list("proposal").map(e => e.data as DiplomacyProposal)
        .filter(x => isGm || x.requesterUserId === ctx.senderUserId).filter(x => !p.id || x.id === p.id)
        .filter(x => !p.search || x.label.toLocaleLowerCase().includes(p.search.toLocaleLowerCase()));
      if (p.id) { if (!visible[0]) return failure("DM_DIPLOMACY_NOT_FOUND", "Proposal unavailable", "not-found");
        const available = o.recovery.fenceRegistry.assertKeysAvailable([lockKey.diplomacy("proposal", p.id)]);
        if (!available.ok) return available;
        const proposal = visible[0];
        if (isGm || !proposal.decision?.approvedIntent) return ok(proposal);
        const redact = (value: unknown): unknown => {
          if (Array.isArray(value)) return value.filter(x => !isRecord(x) || x.visibility !== "secret").map(redact);
          if (!isRecord(value)) return value;
          if (value.visibility === "secret") return null;
          return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
        };
        return ok({ ...proposal, decision: { ...proposal.decision, approvedIntent: redact(proposal.decision.approvedIntent) } }); }
      const available = visible.filter(x => o.recovery.fenceRegistry.assertKeysAvailable([lockKey.diplomacy("proposal", x.id)]).ok);
      return ok({ items: available.slice(p.offset ?? 0, (p.offset ?? 0) + (p.limit ?? 30)).map(x => ({ id: x.id, label: x.label, lifecycle: x.lifecycle, revision: x.revision })),
        total: available.length, offset: p.offset ?? 0, limit: p.limit ?? 30, isGm });
    } });
}
