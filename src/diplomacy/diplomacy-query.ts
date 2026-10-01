import { ok, type Result } from "../core/contracts/result.js";
import { failure, isRecord, isTimestamp } from "../core/validation/value-validation.js";
import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { DiplomacyOwner } from "./owner-contract.js";
import type { DiplomacyKind, DiplomacyEntityStore } from "./diplomacy-store.js";
import type { DomainReadRepository } from "../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../domains/domain-controller-provider.js";
import type { RecoveryService } from "../mutations/recovery-service.js";
import { diplomacyViewerControls, diplomacyViewerIsGm } from "./diplomacy-permissions.js";
import { lockKey } from "../mutations/lock-keys.js";
import { isJournalEntryUuid } from "../core/identity/refs.js";
import { validateTerritoryState } from "../territory/territory-state.js";
import { territoryOwner } from "../territory/territory-owner.js";
import { isAgreementLifecycleFilter, matchesAgreementLifecycle, summarizeAgreementLifecycles,
  type AgreementLifecycleFilter } from "../agreements/agreement-dashboard.js";
import { AGREEMENT_LIFECYCLES, type AgreementLifecycle } from "../agreements/agreement-model.js";
import { validateReputationHistoryFilter, type ReputationHistoryFilter } from "../reputation/reputation-history.js";
export interface DiplomacyQuery {
  readonly id?: string; readonly offset?: number; readonly limit?: number; readonly search?: string;
  readonly historyOffset?: number; readonly historyLimit?: number;
  readonly parentUuid?: string | null; readonly treeAxis?: "locatedInUuid" | "administrativeParentUuid";
  readonly agreementLifecycle?: AgreementLifecycleFilter;
  readonly reputationHistory?: ReputationHistoryFilter;
  readonly reputationSourceOffset?: number; readonly reputationSourceLimit?: number;
}
export function validateDiplomacyQuery(raw: unknown, kind?: DiplomacyKind): Result<DiplomacyQuery> {
  if (!isRecord(raw) || (raw.id !== undefined && (typeof raw.id !== "string" || !raw.id))
    || (raw.offset !== undefined && !isTimestamp(raw.offset)) || (raw.limit !== undefined && (!isTimestamp(raw.limit) || raw.limit < 1 || raw.limit > 100))
    || (raw.historyOffset !== undefined && !isTimestamp(raw.historyOffset))
    || (raw.historyLimit !== undefined && (!isTimestamp(raw.historyLimit) || raw.historyLimit > 100))
    || (raw.search !== undefined && (typeof raw.search !== "string" || raw.search.length > 200))
    || (raw.parentUuid !== undefined && raw.parentUuid !== null && !isJournalEntryUuid(raw.parentUuid))
    || (raw.treeAxis !== undefined && !["locatedInUuid", "administrativeParentUuid"].includes(raw.treeAxis as string))
    || (raw.agreementLifecycle !== undefined && (kind !== "agreement" || raw.id !== undefined || !isAgreementLifecycleFilter(raw.agreementLifecycle))))
    return failure("DM_DIPLOMACY_QUERY_INVALID", "Invalid query pagination or agreement state filter");
  if (["reputationHistory", "reputationSourceOffset", "reputationSourceLimit"].some(k => raw[k] !== undefined)) {
    if (kind !== "reputation" || raw.id === undefined
      || raw.reputationSourceOffset !== undefined && !isTimestamp(raw.reputationSourceOffset)
      || raw.reputationSourceLimit !== undefined && (!isTimestamp(raw.reputationSourceLimit) || raw.reputationSourceLimit < 1 || raw.reputationSourceLimit > 100))
      return failure("DM_DIPLOMACY_QUERY_INVALID", "Reputation history filters require a reputation detail query and valid pages");
    if (raw.reputationHistory !== undefined) { const filters = validateReputationHistoryFilter(raw.reputationHistory); if (!filters.ok) return filters; }
  }
  return ok(raw as DiplomacyQuery);
}
export async function queryDiplomacyOwner(ctx: AuthenticatedCommandContext<DiplomacyQuery>, kind: DiplomacyKind, owner: DiplomacyOwner,
  store: DiplomacyEntityStore, domains: DomainReadRepository, controllers: DomainControllerProvider, recovery: RecoveryService,
  worldTick: number): Promise<Result<unknown>> {
  const isGm = diplomacyViewerIsGm(ctx), p = ctx.command.payload;
  const rows = p.id ? [store.get(kind, p.id)].filter(x => x !== null) : kind === "territory" && Object.hasOwn(p, "parentUuid")
    ? store.children(p.parentUuid ?? null, p.treeAxis ?? "locatedInUuid") : store.list(kind), visible: unknown[] = [];
  const offset = p.offset ?? 0, limit = p.limit ?? 30; let count = 0;
  const agreementStates: AgreementLifecycle[] = [];
  const territoryVisible = async (uuid: string): Promise<boolean> => {
    if (!recovery.fenceRegistry.assertKeysAvailable([lockKey.diplomacy("territory", uuid), lockKey.territoryGraph()]).ok) return false;
    const row = await store.freshRead("territory", uuid); if (!row) return false;
    const valid = validateTerritoryState(row.data); if (!valid.ok) return false;
    const state = valid.value;
    return isGm || state.territory.visibility === "public" || state.territory.visibility === "restricted"
      && await diplomacyViewerControls(ctx, territoryOwner.parties(state), domains, controllers);
  };
  if (p.parentUuid && !isGm && !await territoryVisible(p.parentUuid)) return failure("DM_DIPLOMACY_NOT_FOUND", "Tree branch unavailable", "not-found");
  for (const row of rows) {
    if (!row) continue;
    const identity = owner.identity(row.data), controlled = identity.visibility === "restricted" || p.id
      ? await diplomacyViewerControls(ctx, owner.parties(row.data), domains, controllers) : false;
    const canSee = (v: string) => isGm || v === "public" || v === "restricted" && controlled;
    if (!canSee(identity.visibility) || p.search && !identity.label.toLocaleLowerCase().includes(p.search.toLocaleLowerCase())) continue;
    const fenced = recovery.fenceRegistry.assertKeysAvailable([lockKey.diplomacy(kind, row.id), ...(kind === "territory" || kind === "dispute" ? [lockKey.territoryGraph()] : [])]);
    if (!fenced.ok) { if (p.id) return fenced; continue; }
    const lifecycle = kind === "agreement" ? (row.data as any).state?.agreement?.lifecycle
      : (row.data as any).state?.relation?.lifecycle ?? (row.data as any).lifecycle ?? "active";
    if (kind === "agreement" && !p.id) {
      if (!AGREEMENT_LIFECYCLES.includes(lifecycle)) return failure("DM_AGREEMENT_STATE_INVALID", "Agreement state unavailable");
      agreementStates.push(lifecycle);
      if (!matchesAgreementLifecycle(lifecycle, p.agreementLifecycle)) continue;
    }
    if (count++ < offset || visible.length >= limit) continue;
    if (p.id) {
      const detail = owner.project(row.data, { isGm, canSee, at: ctx.receivedAtReal, worldTick,
        historyOffset: p.historyOffset ?? 0, historyLimit: p.historyLimit ?? 30,
        ...(kind === "reputation" ? { reputationHistory: p.reputationHistory, reputationSourceOffset: p.reputationSourceOffset, reputationSourceLimit: p.reputationSourceLimit } : {}) });
      if (!detail.ok) return detail;
      let projected: any = detail.value;
      if (!isGm && kind === "territory") {
        const t = projected.territory, links = [];
        for (const l of projected.links) if (await territoryVisible(l.targetTerritoryUuid)) links.push(l);
        projected = { ...projected, links, territory: { ...t,
          locatedInUuid: t.locatedInUuid && await territoryVisible(t.locatedInUuid) ? t.locatedInUuid : null,
          administrativeParentUuid: t.administrativeParentUuid && await territoryVisible(t.administrativeParentUuid) ? t.administrativeParentUuid : null } };
      }
      if (!isGm && kind === "dispute") {
        const territoryUuids: string[] = []; for (const id of projected.territoryUuids) if (await territoryVisible(id)) territoryUuids.push(id);
        const claimRefs = [];
        for (const ref of projected.claimRefs) {
          if (!territoryUuids.includes(ref.territoryUuid)) continue;
          const territory = store.get("territory", ref.territoryUuid)?.data;
          if (!territory) continue;
          const territoryControlled = await diplomacyViewerControls(ctx, territoryOwner.parties(territory), domains, controllers);
          const detail = territoryOwner.project(territory, { isGm: false, at: ctx.receivedAtReal, worldTick, historyOffset: 0, historyLimit: 0,
            canSee: visibility => visibility === "public" || visibility === "restricted" && territoryControlled });
          if (detail.ok && (detail.value as any).claims.some((claim: any) => claim.id === ref.claimId)) claimRefs.push(ref);
        }
        projected = { ...projected, territoryUuids, claimRefs };
      }
      visible.push(projected);
    } else visible.push({ id: identity.id, revision: identity.revision, label: identity.label,
      lifecycle });
  }
  if (p.id) return visible.length ? ok(visible[0]) : failure("DM_DIPLOMACY_NOT_FOUND", "Entity unavailable", "not-found");
  return ok({ items: visible, total: count, offset, limit, isGm, worldTick,
    ...(kind === "agreement" ? { agreementSummary: summarizeAgreementLifecycles(agreementStates) } : {}) });
}
