import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import { PEOPLE_CAPABILITY_ID } from "../people-data.js";

/**
 * Validates whether the authenticated command sender is authorized to execute People mutations.
 *
 * Master Spec §11.2, §13, DEC-0573–0582:
 * An operation is authorized if:
 * 1. Sender is the Primary Authority itself or local system/tick (ctx.senderUserId === null or ctx.senderUserId === ctx.authorityUserId).
 * 2. Sender is a Game Master in Foundry (game.users.get(senderUserId)?.isGM).
 * 3. Sender is an authorized Domain Controller:
 *    - Domain creator: metadata.createdByUserId === ctx.senderUserId
 *    - Explicit controller in capability config: domain.definition.capabilities.config.controllers includes senderUserId
 *    - Explicit controller in people config: domain.definition.capabilities.config[PEOPLE_CAPABILITY_ID].controllers includes senderUserId
 *    - Foundry document owner: ownership[senderUserId] >= 3
 */
export async function validatePeopleCommandPermission(
  ctx: AuthenticatedCommandContext<any>,
  domains: DomainRepositoryContract,
  domainUuidExtractor?: (payload: any) => string | undefined
): Promise<Result<boolean, PublicError>> {
  // 1. Local system or Primary Authority
  if (ctx.senderUserId === null || ctx.senderUserId === ctx.authorityUserId) {
    return ok(true);
  }

  // 2. Foundry Game Master
  const gameUser = (globalThis as any).game?.users?.get?.(ctx.senderUserId);
  if (gameUser?.isGM) {
    return ok(true);
  }

  // 3. Domain Controller validation
  const rawDomainUuid =
    (domainUuidExtractor ? domainUuidExtractor(ctx.command.payload) : undefined) ??
    ctx.command.payload?.domainUuid ??
    ctx.command.payload?.id;

  if (typeof rawDomainUuid !== "string" || rawDomainUuid.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: "Permission denied: domain context required to verify authorization"
      })
    );
  }

  const cleanId = rawDomainUuid.startsWith("JournalEntry.")
    ? rawDomainUuid.slice("JournalEntry.".length)
    : rawDomainUuid;

  const docRes = await domains.read(cleanId);
  if (!docRes.ok) {
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: "Permission denied: unable to resolve target domain authorization"
      })
    );
  }

  const doc = docRes.value;
  const record = doc.record;

  // 3a. Creator is Domain Controller
  if (record.metadata?.createdByUserId === ctx.senderUserId) {
    return ok(true);
  }

  // 3b. Explicit controllers in domain capability config
  const generalControllers = (record.definition?.capabilities?.config as any)?.controllers;
  if (Array.isArray(generalControllers) && generalControllers.includes(ctx.senderUserId)) {
    return ok(true);
  }

  // 3c. Explicit controllers in people capability config
  const peopleConfig = (record.definition?.capabilities?.config as any)?.[PEOPLE_CAPABILITY_ID];
  const peopleControllers = peopleConfig?.controllers;
  if (Array.isArray(peopleControllers) && peopleControllers.includes(ctx.senderUserId)) {
    return ok(true);
  }

  // 3d. Foundry document ownership (3 = OWNER)
  const docOwnership = (doc as any).doc?.ownership ?? (doc as any).flags?.ownership;
  if (docOwnership && (docOwnership[ctx.senderUserId] >= 3 || docOwnership[ctx.senderUserId] === "owner")) {
    return ok(true);
  }

  return err(
    createPublicError({
      code: "DM_SECURITY_PERMISSION_DENIED",
      category: "permission",
      message: `User '${ctx.senderUserId}' is not authorized to manage people in domain '${cleanId}'`
    })
  );
}
