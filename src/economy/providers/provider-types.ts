import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";

export type ProviderHealthStatus = "healthy" | "degraded" | "unavailable" | "incompatible";

export interface ProviderHealth {
  readonly status: ProviderHealthStatus;
  readonly message?: string;
  readonly lastCheckedAt: number;
}

export type ProviderDataFamily =
  | "currency"
  | "physical-inventory"
  | "derived-resource"
  | "resource-storage";

export interface BaseResourceProvider {
  readonly providerId: string;
  readonly contractVersion: number;
  readonly family: ProviderDataFamily;
  readonly label: string;
  readonly capabilities: readonly string[];
  readonly isReadOnly: boolean;
  getHealth(): ProviderHealth | Promise<ProviderHealth>;
  hasCapability(cap: string): boolean;
}

export interface ResourceProviderBalanceResult {
  readonly balanceMinor: number;
  readonly effectiveCapacityMinor?: number | null;
  readonly isStale?: boolean;
}

export interface ResourceProvider extends BaseResourceProvider {
  readonly family: "derived-resource" | "resource-storage";
  readBalance(
    domainUuid: string,
    resourceId: string,
    providerRef: string
  ): Promise<Result<ResourceProviderBalanceResult, PublicError>>;
  mutateBalance?(
    domainUuid: string,
    resourceId: string,
    providerRef: string,
    deltaMinor: number,
    reason: string
  ): Promise<Result<{ newBalanceMinor: number }, PublicError>>;
}

export interface CurrencyProvider extends BaseResourceProvider {
  readonly family: "currency";
  getCurrencyBalance(targetRef: string): Promise<Result<number, PublicError>>;
  mutateCurrency?(
    targetRef: string,
    deltaMinor: number,
    reason: string
  ): Promise<Result<{ newBalanceMinor: number }, PublicError>>;
}

export interface InventoryItemSummary {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly itemType?: string;
}

export interface InventoryProvider extends BaseResourceProvider {
  readonly family: "physical-inventory";
  listItems(targetRef: string): Promise<Result<readonly InventoryItemSummary[], PublicError>>;
}

export function isNamespacedProviderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value)
  );
}

/**
 * Validates that a provider is healthy enough to perform authoritative operations.
 * Fails closed with DM_ECON_PROVIDER_UNAVAILABLE if unavailable or incompatible.
 */
export async function assertProviderHealthy(
  provider: BaseResourceProvider
): Promise<Result<ProviderHealth, PublicError>> {
  const health = await provider.getHealth();
  if (health.status === "unavailable" || health.status === "incompatible") {
    return err(
      createPublicError({
        code: "DM_ECON_PROVIDER_UNAVAILABLE",
        category: "provider",
        message: `Provider '${provider.providerId}' is ${health.status}: ${health.message ?? "No details provided"}`
      })
    );
  }
  return ok(health);
}

/**
 * Checks whether a debit operation is allowed on a provider balance result.
 * Enforces DEC-16806: Stale cache strictly forbids debits.
 */
export function assertDebitAllowedOnProviderBalance(
  balanceResult: ResourceProviderBalanceResult,
  providerId: string
): Result<void, PublicError> {
  if (balanceResult.isStale) {
    return err(
      createPublicError({
        code: "DM_ECON_PROVIDER_STALE_CACHE",
        category: "provider",
        message: `Provider '${providerId}' balance is stale/cached; debit operations are strictly blocked`
      })
    );
  }
  return ok(undefined);
}
