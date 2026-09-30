import { ok } from "../core/contracts/result.js";
import { failure, isRecord } from "../core/validation/value-validation.js";
import { isJournalEntryUuid, normalizeDomainId } from "../core/identity/refs.js";
import { createDefaultCapabilityResolver } from "../aggregation/capability-resolver.js";
import { diplomacyViewerControls, diplomacyViewerIsGm } from "./diplomacy-permissions.js";
import type { OwnerCommandOptions } from "./owner-commands.js";
import type { AgreementOwnerData } from "../agreements/agreement-owner.js";
import { projectTerritoryState, type TerritoryState } from "../territory/territory-state.js";
import { lockKey } from "../mutations/lock-keys.js";
import { territoryOwner } from "../territory/territory-owner.js";
export function registerDiplomacyCapabilityCommand(o: OwnerCommandOptions): void {
  o.registry.register({ type: "diplomacy:capabilities", visibility: "public", schemaValidator: p => isRecord(p) && isJournalEntryUuid(p.domainUuid)
    && (p.territoryUuid === undefined || isJournalEntryUuid(p.territoryUuid)) ? ok(p) : failure("DM_DIPLOMACY_QUERY_INVALID", "Capabilities require a valid Domain context"),
    handler: async ctx => {
      const p = ctx.command.payload, isGm = diplomacyViewerIsGm(ctx);
      const unfenced = o.recovery.fenceRegistry.assertKeysAvailable([lockKey.domain(p.domainUuid as string), lockKey.territoryGraph(),
        ...o.store.list("agreement").map(e => lockKey.diplomacy("agreement", e.id))]); if (!unfenced.ok) return unfenced;
      const controlled = await diplomacyViewerControls(ctx, [{ type: "domain", uuid: p.domainUuid as string }], o.domains, o.controllers);
      if (!isGm && !controlled) return failure("DM_SECURITY_PERMISSION_DENIED", "Domain capability context unavailable", "permission");
      const domain = await o.domains.read(normalizeDomainId(p.domainUuid as string)); if (!domain.ok) return domain;
      const agreements: { agreement: AgreementOwnerData["state"]["agreement"]; definition: AgreementOwnerData["definition"] }[] = [];
      for (const row of o.store.list("agreement")) {
        const a = row.data as AgreementOwnerData, maySeeRestricted = isGm || await diplomacyViewerControls(ctx, a.state.agreement.parties.map(p => p.ref), o.domains, o.controllers);
        const canSee = (v: string) => isGm || v === "public" || v === "restricted" && maySeeRestricted;
        if (!canSee(a.state.agreement.visibility)) continue;
        agreements.push({ agreement: { ...a.state.agreement, terms: a.state.agreement.terms.filter(t => canSee(t.visibility)) }, definition: a.definition });
      }
      const canSee = (v: string) => isGm || v === "public" || v === "restricted" && controlled;
      const territories: TerritoryState[] = [];
      for (const row of o.store.list("territory")) {
        const s = row.data as TerritoryState, controlsSource = isGm || await diplomacyViewerControls(ctx,
          territoryOwner.parties(s), o.domains, o.controllers);
        const projected = projectTerritoryState(s, v => isGm || v === "public" || v === "restricted" && controlsSource);
        if (projected) territories.push(projected);
      }
      if (p.territoryUuid && !territories.some(s => s.territory.uuid === p.territoryUuid)) return failure("DM_DIPLOMACY_NOT_FOUND", "Territory capability scope unavailable", "not-found");
      return ok(createDefaultCapabilityResolver().resolveEffectiveCapabilities({ domainUuid: domain.value.uuid, domainDoc: domain.value,
        diplomacy: { worldTick: o.worldTick(), agreements, territories, ...(p.territoryUuid ? { territoryUuid: p.territoryUuid as string } : {}),
          canSee, conditionSatisfied: o.conditionSatisfied ?? (() => false) } }));
    } });
}
