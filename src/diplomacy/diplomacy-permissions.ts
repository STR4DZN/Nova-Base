import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { DomainReadRepository } from "../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../domains/domain-controller-provider.js";
import { normalizeDomainId } from "../core/identity/refs.js";
import type { RelationPartyRef } from "../relations/types/relation-types.js";
export function diplomacyViewerIsGm(ctx: AuthenticatedCommandContext): boolean {
  return ctx.senderUserId === ctx.authorityUserId || !!(ctx.senderUserId && (globalThis as any).game?.users?.get?.(ctx.senderUserId)?.isGM);
}
export async function diplomacyViewerControls(ctx: AuthenticatedCommandContext, parties: readonly RelationPartyRef[],
  domains: DomainReadRepository, controllers: DomainControllerProvider): Promise<boolean> {
  if (!ctx.senderUserId) return false;
  for (const party of parties) {
    const uuid = party.type === "domain" ? party.uuid : party.domainUuid; if (!uuid) continue;
    const doc = await domains.read(normalizeDomainId(uuid)); if (!doc.ok) continue;
    if (await controllers.isDomainController(normalizeDomainId(uuid), ctx.senderUserId, { document: doc.value, record: doc.value.record })) return true;
  }
  return false;
}
