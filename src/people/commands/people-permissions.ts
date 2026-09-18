import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import type { DomainDocument, DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DomainRecord } from "../../domains/domain-schema.js";
import type { DomainControllerProvider } from "../../domains/domain-controller-provider.js";

/**
 * Contract for explicit Domain Controller authorization policies.
 * Allows systems/extensions to register trusted controller resolution logic.
 */
export type DomainControllerPolicy = (
  domainId: string,
  userId: string,
  context: {
    readonly record: DomainRecord;
    readonly document?: DomainDocument;
  }
) => boolean | Promise<boolean>;

const activeControllerPolicies = new Set<DomainControllerPolicy>();

/**
 * Registers an explicit Domain Controller policy.
 * Returns an unregister function.
 */
export function registerDomainControllerPolicy(policy: DomainControllerPolicy): () => void {
  activeControllerPolicies.add(policy);
  return () => {
    activeControllerPolicies.delete(policy);
  };
}

/**
 * Clears all registered domain controller policies (primarily for test isolation).
 */
export function clearDomainControllerPolicies(): void {
  activeControllerPolicies.clear();
}

export interface ValidatePeoplePermissionOptions {
  readonly controllerPolicy?: DomainControllerPolicy;
  readonly controllerProvider?: DomainControllerProvider;
}

/**
 * Validates whether the authenticated command sender is authorized to execute People mutations.
 *
 * Master Spec §5.5, §11.2, §13:
 * Canonical sources of truth for Domain Controller authority:
 * 1. Primary Authority itself or local system/tick (ctx.senderUserId === null or ctx.senderUserId === ctx.authorityUserId).
 * 2. Game Master in Foundry (game.users.get(senderUserId)?.isGM).
 * 3. Document Ownership layer in Foundry (ownership[senderUserId] >= 3 / OWNER, or testUserPermission).
 * 4. Explicit Domain Controller Policy: custom trusted controller policy contract.
 *
 * NOTE (DEC-018): `metadata.createdByUserId` is strictly provenance and audit metadata.
 * Historic creation does NOT confer current Domain Controller authorization (e.g. after control transfer or import).
 */
export async function validatePeopleCommandPermission(
  ctx: AuthenticatedCommandContext<any>,
  domains: DomainRepositoryContract,
  domainUuidExtractor?: (payload: any) => string | undefined,
  options?: ValidatePeoplePermissionOptions
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

  // 3. Resolve target domain context
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

  // 4. Foundry Document Ownership layer (3 = OWNER)
  const docOwnership =
    doc.ownership ??
    (doc as any).doc?.ownership ??
    (doc as any).flags?.ownership ??
    (globalThis as any).game?.journal?.get?.(cleanId)?.ownership;

  if (docOwnership) {
    const userOwnership = docOwnership[ctx.senderUserId];
    if (userOwnership >= 3 || userOwnership === "owner" || userOwnership === 3) {
      return ok(true);
    }
  }

  const journalDoc = (globalThis as any).game?.journal?.get?.(cleanId);
  if (journalDoc && typeof journalDoc.testUserPermission === "function") {
    const hasOwnerPermission = journalDoc.testUserPermission(
      gameUser ?? { id: ctx.senderUserId },
      3
    );
    if (hasOwnerPermission) {
      return ok(true);
    }
  }

  // 5. Explicit Domain Controller Provider / Policy contract
  if (options?.controllerProvider) {
    const providerResult = await options.controllerProvider.isDomainController(cleanId, ctx.senderUserId, {
      record,
      document: doc
    });
    if (providerResult) {
      return ok(true);
    }
  }

  if (options?.controllerPolicy) {
    const policyResult = await options.controllerPolicy(cleanId, ctx.senderUserId, {
      record,
      document: doc
    });
    if (policyResult) {
      return ok(true);
    }
  }

  for (const policy of activeControllerPolicies) {
    const policyResult = await policy(cleanId, ctx.senderUserId, {
      record,
      document: doc
    });
    if (policyResult) {
      return ok(true);
    }
  }

  // 6. Fail-closed
  return err(
    createPublicError({
      code: "DM_SECURITY_PERMISSION_DENIED",
      category: "permission",
      message: `User '${ctx.senderUserId}' is not authorized to manage people in domain '${cleanId}'`
    })
  );
}
