import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type {
  ProviderHealth,
  ResourceProvider,
  ResourceProviderBalanceResult
} from "./provider-types.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import { tryGetDomainEconomyData } from "../economy-data.js";
import type { NativeResourceAccount } from "../accounts/account-types.js";

export const NATIVE_RESOURCE_PROVIDER_ID = "domain-manager:native-provider";

export class NativeResourceProvider implements ResourceProvider {
  readonly providerId = NATIVE_RESOURCE_PROVIDER_ID;
  readonly contractVersion = 1;
  readonly family = "resource-storage" as const;
  readonly label = "Canonical Native Resource Storage";
  readonly capabilities = Object.freeze(["read", "write", "atomic-balance"]);
  readonly isReadOnly = false;
  readonly #domains: DomainRepositoryContract;

  constructor(domains: DomainRepositoryContract) {
    this.#domains = domains;
  }

  getHealth(): ProviderHealth {
    return {
      status: "healthy",
      message: "Native repository online",
      lastCheckedAt: Date.now()
    };
  }

  hasCapability(cap: string): boolean {
    return this.capabilities.includes(cap);
  }

  async readBalance(
    domainUuid: string,
    resourceId: string,
    _providerRef: string
  ): Promise<Result<ResourceProviderBalanceResult, PublicError>> {
    const cleanId = domainUuid.trim().startsWith("JournalEntry.")
      ? domainUuid.trim().slice("JournalEntry.".length)
      : domainUuid.trim();
    const docRes = await this.#domains.read(cleanId);
    if (!docRes.ok) return docRes;

    const econRes = tryGetDomainEconomyData(docRes.value.record);
    if (!econRes.ok) return econRes;

    const acc = econRes.value.accounts.find(
      (a) => a.resourceId === resourceId && a.mode === "native"
    ) as NativeResourceAccount | undefined;

    if (!acc) {
      return err(
        createPublicError({
          code: "DM_ECON_ACCOUNT_NOT_FOUND",
          category: "not-found",
          message: `Native account for '${resourceId}' not found in domain '${domainUuid}'`
        })
      );
    }

    return ok({
      balanceMinor: acc.balanceMinor,
      effectiveCapacityMinor: acc.baseCapacityMinor,
      isStale: false
    });
  }
}
