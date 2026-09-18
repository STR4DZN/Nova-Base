import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../../domains/domain-controller-provider.js";

export interface ValidateEconomyPermissionOptions {
  readonly controllerProvider?: DomainControllerProvider;
  readonly gmOnly?: boolean;
}

/**
 * Validates whether the authenticated command sender is authorized to execute Economy operations.
 *
 * Enforces:
 * 1. Local system/Primary Authority (ctx.senderUserId === null or ctx.senderUserId === ctx.authorityUserId) always allowed.
 * 2. Foundry GM always allowed.
 * 3. If gmOnly is true (e.g. adjust, create-account, close-account), non-GM is strictly rejected.
 * 4. Otherwise, verifies Domain Controller / Owner rights on target domain(s).
 */
export async function validateEconomyCommandPermission(
  ctx: AuthenticatedCommandContext<any>,
  domains: DomainRepositoryContract,
  domainUuids: readonly string[],
  options?: ValidateEconomyPermissionOptions
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

  // 3. GM-only operations strictly reject non-GM users
  if (options?.gmOnly) {
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: "Economy operation requires Game Master authorization"
      })
    );
  }

  // 4. Verify Domain Controller / Owner rights on all involved domains
  if (domainUuids.length === 0) {
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: "Permission denied: target domain context required"
      })
    );
  }

  for (const rawDomainUuid of domainUuids) {
    const cleanId = rawDomainUuid.startsWith("JournalEntry.")
      ? rawDomainUuid.slice("JournalEntry.".length)
      : rawDomainUuid;

    const docRes = await domains.read(cleanId);
    if (!docRes.ok) {
      return err(
        createPublicError({
          code: "DM_SECURITY_PERMISSION_DENIED",
          category: "permission",
          message: `Permission denied: unable to resolve target domain '${rawDomainUuid}'`
        })
      );
    }

    const doc = docRes.value;

    // Check Controller Provider if available
    if (options?.controllerProvider) {
      const isController = await options.controllerProvider.isDomainController(
        doc.uuid,
        ctx.senderUserId,
        { record: doc.record, document: doc }
      );
      if (isController) {
        continue;
      }
    }

    // Check Document Ownership (Foundry ownership level 3 = OWNER)
    const ownership = (doc as any).ownership as Record<string, number> | undefined;
    const userLevel = ownership ? (ownership[ctx.senderUserId] ?? ownership.default ?? 0) : 0;
    if (userLevel >= 3) {
      continue;
    }

    // Not authorized on this domain
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: `User '${ctx.senderUserId}' is not authorized as Domain Controller for domain '${rawDomainUuid}'`
      })
    );
  }

  return ok(true);
}
