import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type {
  CurrencyProvider,
  ProviderHealth,
  ResourceProviderBalanceResult
} from "./provider-types.js";

export const MANUAL_CURRENCY_PROVIDER_ID = "domain-manager:manual-currency";

export class ManualCurrencyProvider implements CurrencyProvider {
  readonly providerId = MANUAL_CURRENCY_PROVIDER_ID;
  readonly contractVersion = 1;
  readonly family = "currency" as const;
  readonly label = "Manual World Currency Provider";
  readonly capabilities = Object.freeze(["read", "write"]);
  readonly isReadOnly = false;
  readonly #balances = new Map<string, number>();
  #isHealthy = true;

  getHealth(): ProviderHealth {
    return {
      status: this.#isHealthy ? "healthy" : "unavailable",
      message: this.#isHealthy ? "Manual currency online" : "Manual currency simulated offline",
      lastCheckedAt: Date.now()
    };
  }

  setHealthy(healthy: boolean): void {
    this.#isHealthy = healthy;
  }

  hasCapability(cap: string): boolean {
    return this.capabilities.includes(cap);
  }

  async getCurrencyBalance(targetRef: string): Promise<Result<number, PublicError>> {
    if (!this.#isHealthy) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_UNAVAILABLE",
          category: "provider",
          message: `Manual currency provider is unavailable for target '${targetRef}'`
        })
      );
    }
    return ok(this.#balances.get(targetRef) ?? 0);
  }

  async mutateCurrency(
    targetRef: string,
    deltaMinor: number,
    _reason: string
  ): Promise<Result<{ newBalanceMinor: number }, PublicError>> {
    if (!this.#isHealthy) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_UNAVAILABLE",
          category: "provider",
          message: `Manual currency provider is unavailable for target '${targetRef}'`
        })
      );
    }
    const current = this.#balances.get(targetRef) ?? 0;
    const next = current + deltaMinor;
    this.#balances.set(targetRef, next);
    return ok({ newBalanceMinor: next });
  }

  async readBalance(
    domainUuid: string,
    resourceId: string,
    providerRef: string
  ): Promise<Result<ResourceProviderBalanceResult, PublicError>> {
    const key = providerRef || `${domainUuid}:${resourceId}`;
    const balRes = await this.getCurrencyBalance(key);
    if (!balRes.ok) return balRes;
    return ok({ balanceMinor: balRes.value, isStale: false });
  }

  async mutateBalance(
    domainUuid: string,
    resourceId: string,
    providerRef: string,
    deltaMinor: number,
    reason: string
  ): Promise<Result<{ newBalanceMinor: number }, PublicError>> {
    const key = providerRef || `${domainUuid}:${resourceId}`;
    return this.mutateCurrency(key, deltaMinor, reason);
  }

  async applyDelta(params: {
    readonly domainUuid: string;
    readonly resourceId: string;
    readonly providerRef: string;
    readonly deltaMinor: number;
    readonly reason: string;
  }): Promise<Result<{ newBalanceMinor: number }, PublicError>> {
    return this.mutateBalance(
      params.domainUuid,
      params.resourceId,
      params.providerRef,
      params.deltaMinor,
      params.reason
    );
  }

  setBalance(targetRef: string, balanceMinor: number): void {
    this.#balances.set(targetRef, balanceMinor);
  }
}
