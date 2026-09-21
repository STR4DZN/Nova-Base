import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";

/**
 * Validates whether the authenticated command sender has Game Master privileges.
 * (Master Spec §5.5, §11.2, §16, G5-REVAL3-006)
 *
 * Strictly restricts execution to:
 * 1. Primary Authority itself or local system/tick (ctx.senderUserId === null or ctx.senderUserId === ctx.authorityUserId).
 * 2. Game Master in Foundry (game.users.get(senderUserId)?.isGM).
 *
 * Non-GM Domain Controllers (e.g. players who own the domain) are STRICTLY REJECTED with DM_SECURITY_PERMISSION_DENIED.
 */
export function validateGmOnlyCommandPermission(
  ctx: AuthenticatedCommandContext<any>
): Result<boolean, PublicError> {
  // 1. Local system or Primary Authority
  if (ctx.senderUserId === null || ctx.senderUserId === ctx.authorityUserId) {
    return ok(true);
  }

  // 2. Foundry Game Master
  const gameUser = (globalThis as any).game?.users?.get?.(ctx.senderUserId);
  if (gameUser?.isGM) {
    return ok(true);
  }

  return err(
    createPublicError({
      code: "DM_SECURITY_PERMISSION_DENIED",
      category: "permission",
      message: `Permission denied: command '${ctx.command?.type ?? "operation"}' requires Game Master privileges`
    })
  );
}
