import { ok, type Result } from "../core/contracts/result.js";
import { failure, immutable, isJsonData, isRecord, isTimestamp } from "../core/validation/value-validation.js";
import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import { lockKey } from "../mutations/lock-keys.js";
import { DIPLOMACY_KINDS, type DiplomacyKind } from "./diplomacy-store.js";
import { DIPLOMACY_OWNERS, type OwnerCommandOptions } from "./owner-commands.js";
import { diplomacyViewerControls, diplomacyViewerIsGm } from "./diplomacy-permissions.js";
import type { DiplomacyProposal } from "./diplomacy-proposals.js";
import { obligationTerm, resolveAgreementCompliance } from "../agreements/agreement-obligations.js";
import type { AgreementOwnerData } from "../agreements/agreement-owner.js";
import type { ReputationOwnerData } from "../reputation/reputation-owner.js";
export const OVERVIEW_FILTERS = ["all", "breaches", "overdue", "expiring", "disputes", "proposals", "changes"] as const;
export type DiplomacyOverviewFilter = typeof OVERVIEW_FILTERS[number];
export interface DiplomacyOverviewQuery {
  readonly offset?: number; readonly limit?: number; readonly search?: string;
  readonly filter?: DiplomacyOverviewFilter; readonly expiryHorizonTicks?: number; readonly recentHours?: number;
}
export function validateDiplomacyOverviewQuery(raw: unknown): Result<DiplomacyOverviewQuery> {
  if (!isRecord(raw) || !isJsonData(raw) || Object.keys(raw).some(k => !["offset", "limit", "search", "filter", "expiryHorizonTicks", "recentHours"].includes(k))
    || raw.offset !== undefined && !isTimestamp(raw.offset)
    || raw.limit !== undefined && (!isTimestamp(raw.limit) || raw.limit < 1 || raw.limit > 100)
    || raw.search !== undefined && (typeof raw.search !== "string" || raw.search.length > 200)
    || raw.filter !== undefined && !OVERVIEW_FILTERS.includes(raw.filter as DiplomacyOverviewFilter)
    || raw.expiryHorizonTicks !== undefined && (!isTimestamp(raw.expiryHorizonTicks) || raw.expiryHorizonTicks > 1_000_000)
    || raw.recentHours !== undefined && (!isTimestamp(raw.recentHours) || raw.recentHours < 1 || raw.recentHours > 720))
    return failure("DM_DIPLOMACY_OVERVIEW_QUERY_INVALID", "Invalid overview filter, page or time window");
  return ok(raw as DiplomacyOverviewQuery);
}
export type DiplomacyOverviewReason = "breach" | "overdue" | "expiry-due" | "expiring" | "dispute" | "proposal" | "recent";
/** Minimal facts admitted by the authenticated audience and recovery fences before aggregation. */
export interface DiplomacyOverviewFact {
  readonly kind: DiplomacyKind; readonly id: string; readonly label: string; readonly revision: number; readonly lifecycle: string;
  readonly updatedAt?: number; readonly expiresAtWorldTick?: number | null; readonly confirmedBreach?: boolean; readonly overdue?: boolean;
}
export interface DiplomacyOverviewItem {
  readonly kind: DiplomacyKind; readonly id: string; readonly label: string; readonly revision: number; readonly lifecycle: string;
  readonly reasons: readonly DiplomacyOverviewReason[]; readonly changedAtReal?: number; readonly expiresAtWorldTick?: number;
}
export interface DiplomacyOverview {
  readonly items: readonly DiplomacyOverviewItem[]; readonly total: number; readonly offset: number; readonly limit: number;
  readonly isGm: boolean; readonly worldTick: number; readonly asOfReal: number;
  readonly expiryHorizonTicks: number; readonly recentHours: number; readonly filter: DiplomacyOverviewFilter;
  readonly summary: { readonly records: Readonly<Record<DiplomacyKind, number>>; readonly attention: number;
    readonly breaches: number; readonly overdue: number; readonly expiring: number; readonly disputes: number; readonly proposals: number;
    readonly changes: number | null };
}
const rank: Record<DiplomacyOverviewReason, number> = { breach: 0, overdue: 1, "expiry-due": 2, dispute: 3, proposal: 4, expiring: 5, recent: 6 };
const match = (r: readonly DiplomacyOverviewReason[], f: DiplomacyOverviewFilter) => f === "all" || r.includes(
  ({ breaches: "breach", overdue: "overdue", disputes: "dispute", proposals: "proposal", changes: "recent", expiring: "expiring" } as const)[f])
  || f === "expiring" && r.includes("expiry-due");
/** No persisted counters, wall-clock reads, lifecycle transitions or automatic breach decisions. */
export function buildDiplomacyOverview(facts: readonly DiplomacyOverviewFact[], query: DiplomacyOverviewQuery, isGm: boolean,
  worldTick: number, asOfReal: number): Result<DiplomacyOverview> {
  const valid = validateDiplomacyOverviewQuery(query); if (!valid.ok) return valid;
  if (!isTimestamp(worldTick) || !isTimestamp(asOfReal)) return failure("DM_DIPLOMACY_OVERVIEW_TIME_INVALID", "Explicit overview clocks required");
  const offset = query.offset ?? 0, limit = query.limit ?? 30, filter = query.filter ?? "all", expiryHorizonTicks = query.expiryHorizonTicks ?? 10, recentHours = query.recentHours ?? 24;
  const summary = { records: Object.fromEntries(DIPLOMACY_KINDS.map(k => [k, 0])) as Record<DiplomacyKind, number>, attention: 0,
    breaches: 0, overdue: 0, expiring: 0, disputes: 0, proposals: 0, changes: isGm ? 0 : null as number | null };
  const rows: DiplomacyOverviewItem[] = [];
  for (const f of facts) {
    if (query.search && !f.label.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())) continue;
    summary.records[f.kind]++;
    const reasons: DiplomacyOverviewReason[] = [];
    if (f.kind === "agreement") {
      if (f.lifecycle === "breached" || f.confirmedBreach) { reasons.push("breach"); summary.breaches++; }
      if (["active", "breached"].includes(f.lifecycle)) {
        if (f.overdue) { reasons.push("overdue"); summary.overdue++; }
        if (f.expiresAtWorldTick !== null && f.expiresAtWorldTick !== undefined
          && BigInt(f.expiresAtWorldTick) <= BigInt(worldTick) + BigInt(expiryHorizonTicks)) {
          reasons.push(f.expiresAtWorldTick <= worldTick ? "expiry-due" : "expiring"); summary.expiring++;
        }
      }
    }
    if (f.kind === "dispute" && ["latent", "active", "escalated", "frozen"].includes(f.lifecycle)) { reasons.push("dispute"); summary.disputes++; }
    if (f.kind === "proposal" && f.lifecycle === "pending") { reasons.push("proposal"); summary.proposals++; }
    const recent = isGm && f.updatedAt !== undefined && f.updatedAt > 0 && f.updatedAt <= asOfReal && f.updatedAt >= asOfReal - recentHours * 3_600_000;
    if (reasons.length) summary.attention++;
    if (recent) { reasons.push("recent"); summary.changes!++; }
    if (!reasons.length) continue;
    rows.push({ kind: f.kind, id: f.id, label: f.label, revision: f.revision, lifecycle: f.lifecycle, reasons,
      ...(recent ? { changedAtReal: f.updatedAt } : {}),
      ...(reasons.includes("expiring") || reasons.includes("expiry-due") ? { expiresAtWorldTick: f.expiresAtWorldTick! } : {}) });
  }
  const filtered = rows.filter(r => match(r.reasons, filter));
  const key = (r: DiplomacyOverviewItem) => JSON.stringify([r.kind, r.id]);
  filtered.sort((a, b) => Math.min(...a.reasons.map(r => rank[r])) - Math.min(...b.reasons.map(r => rank[r]))
    || (b.changedAtReal ?? 0) - (a.changedAtReal ?? 0) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return ok(immutable({ items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit, isGm, worldTick, asOfReal,
    expiryHorizonTicks, recentHours, filter, summary }));
}
export async function queryDiplomacyOverview(ctx: AuthenticatedCommandContext<DiplomacyOverviewQuery>, o: OwnerCommandOptions): Promise<Result<DiplomacyOverview>> {
  const isGm = diplomacyViewerIsGm(ctx), facts: DiplomacyOverviewFact[] = [], worldTick = o.worldTick();
  for (const kind of DIPLOMACY_KINDS) for (const row of o.store.list(kind)) {
    const fence = o.recovery.fenceRegistry.assertKeysAvailable([lockKey.diplomacy(kind, row.id),
      ...(kind === "territory" || kind === "dispute" ? [lockKey.territoryGraph()] : [])]);
    if (!fence.ok) continue;
    let fact: DiplomacyOverviewFact;
    if (kind === "proposal") {
      const p = row.data as DiplomacyProposal;
      if (!isGm && p.requesterUserId !== ctx.senderUserId) continue;
      fact = { kind, id: p.id, label: p.label, revision: p.revision, lifecycle: p.lifecycle,
        ...(isGm ? { updatedAt: p.decision?.at ?? p.createdAt } : {}) };
    } else {
      const owner = DIPLOMACY_OWNERS[kind], identity = owner.identity(row.data);
      // A public record can contain restricted terms: participant checks also apply to its children.
      const controlled = !isGm && await diplomacyViewerControls(ctx, owner.parties(row.data), o.domains, o.controllers);
      const canSee = (v: string) => isGm || v === "public" || v === "restricted" && controlled;
      if (!canSee(identity.visibility)) continue;
      const data = row.data as any, entity = kind === "relation" ? data.state.relation : kind === "reputation" ? data.record
        : kind === "agreement" ? data.state.agreement : kind === "territory" ? data.territory : data;
      fact = { kind, id: identity.id, label: identity.label, revision: identity.revision, lifecycle: entity.lifecycle ?? "active",
        ...(isGm ? { updatedAt: (kind === "reputation" ? (row.data as ReputationOwnerData).configurationHistory ?? [] : []).reduce((at, e) => Math.max(at, e.at), Math.max(entity.updatedAt, entity.createdAt)) } : {}) };
      if (kind === "agreement") {
        const { state } = row.data as AgreementOwnerData, compliance = resolveAgreementCompliance(state, worldTick); if (!compliance.ok) return compliance;
        const visible = compliance.value.filter(c => {
          const obligation = state.obligations.find(x => x.id === c.obligationId), term = obligation && obligationTerm(state.agreement, obligation);
          return c.applicable && term !== undefined && canSee(term.visibility);
        });
        fact = { ...fact, expiresAtWorldTick: state.agreement.duration.expiresAtWorldTick,
          confirmedBreach: visible.some(c => c.confirmedBreach), overdue: visible.some(c => c.pastGrace && ["pending", "due"].includes(c.lifecycle)) };
      }
    }
    facts.push(fact);
  }
  return buildDiplomacyOverview(facts, ctx.command.payload, isGm, worldTick, ctx.receivedAtReal);
}
export function registerDiplomacyOverview(o: OwnerCommandOptions): void {
  o.registry.register({ type: "diplomacy:overview", visibility: "public", schemaValidator: validateDiplomacyOverviewQuery,
    handler: ctx => queryDiplomacyOverview(ctx, o) });
}
