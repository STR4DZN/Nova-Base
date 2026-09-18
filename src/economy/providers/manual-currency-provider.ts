import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type {
  CurrencyProvider,
  ProviderHealth,
  ResourceProviderBalanceResult
} from "./provider-types.js";
import {
  type ManualCurrencyStorageAdapter,
  type ManualCurrencySnapshot,
  MANUAL_CURRENCY_STORAGE_SCHEMA_VERSION,
  FoundryJournalManualCurrencyStorageAdapter
} from "../storage/manual-currency-storage-adapter.js";

export const MANUAL_CURRENCY_PROVIDER_ID = "domain-manager:manual-currency";

export class ManualCurrencyProvider implements CurrencyProvider {
  readonly providerId = MANUAL_CURRENCY_PROVIDER_ID;
  readonly contractVersion = 1;
  readonly family = "currency" as const;
  readonly label = "Manual World Currency Provider";
  readonly capabilities = Object.freeze(["read", "write"]);
  readonly isReadOnly = false;
  readonly #balances = new Map<string, number>();
  readonly #storageAdapter?: ManualCurrencyStorageAdapter;
  #persistQueue: Promise<void> = Promise.resolve();
  #lastPersistError: Error | null = null;
  #isHealthy = true;

  constructor(options?: { readonly storageAdapter?: ManualCurrencyStorageAdapter }) {
    this.#storageAdapter = options?.storageAdapter ?? new FoundryJournalManualCurrencyStorageAdapter();
  }

  async rehydrate(): Promise<void> {
    if (!this.#storageAdapter) return;
    const snapshot = await this.#storageAdapter.loadSnapshot();
    if (snapshot) {
      this.#balances.clear();
      for (const [key, bal] of Object.entries(snapshot.balances)) {
        this.#balances.set(key, bal);
      }
      this.#operations.clear();
      if (snapshot.operations) {
        for (const [key, op] of Object.entries(snapshot.operations)) {
          this.#operations.set(key, op);
        }
      }
    }
  }

  #schedulePersist(): void {
    if (!this.#storageAdapter) return;
    this.#persistQueue = this.#persistQueue
      .then(async () => {
        await this.#persist();
      })
      .catch((err: unknown) => {
        this.#lastPersistError = err instanceof Error ? err : new Error(String(err));
      });
  }

  async #persist(): Promise<void> {
    if (!this.#storageAdapter) return;
    const balancesObj: Record<string, number> = {};
    for (const [k, v] of this.#balances.entries()) {
      balancesObj[k] = v;
    }
    const operationsObj: Record<string, { deltaMinor: number; timestamp: number }> = {};
    for (const [k, v] of this.#operations.entries()) {
      operationsObj[k] = v;
    }
    const snapshot: ManualCurrencySnapshot = {
      schemaVersion: MANUAL_CURRENCY_STORAGE_SCHEMA_VERSION,
      balances: balancesObj,
      operations: operationsObj,
      updatedAt: Date.now()
    };
    await this.#storageAdapter.saveSnapshot(snapshot);
  }

  async flush(): Promise<void> {
    this.#schedulePersist();
    await this.#persistQueue;
    if (this.#lastPersistError) {
      const err = this.#lastPersistError;
      this.#lastPersistError = null;
      throw err;
    }
  }

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

  readonly #operations = new Map<string, { deltaMinor: number; timestamp: number }>();

  async mutateCurrency(
    targetRef: string,
    deltaMinor: number,
    _reason: string,
    options?: { readonly operationRef?: string }
  ): Promise<Result<{ newBalanceMinor: number; outcome?: "success"; providerTransactionRef?: string }, PublicError>> {
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
    if (options?.operationRef) {
      this.#operations.set(options.operationRef, { deltaMinor, timestamp: Date.now() });
    }
    this.#schedulePersist();
    return ok({
      newBalanceMinor: next,
      outcome: "success",
      ...(options?.operationRef ? { providerTransactionRef: options.operationRef } : {})
    });
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
    reason: string,
    options?: { readonly operationRef?: string }
  ): Promise<Result<{ newBalanceMinor: number; outcome?: "success"; providerTransactionRef?: string }, PublicError>> {
    const key = providerRef || `${domainUuid}:${resourceId}`;
    return this.mutateCurrency(key, deltaMinor, reason, options);
  }

  async reconcile(
    _domainUuidOrTargetRef: string,
    _resourceIdOrOpRef: string,
    providerRef?: string,
    operationRef?: string
  ): Promise<Result<{ written: boolean; outcome: "written" | "not-written" | "unknown"; currentBalanceMinor?: number }, PublicError>> {
    const opKey = operationRef ?? _resourceIdOrOpRef;
    const balKey = providerRef ?? _domainUuidOrTargetRef;
    const currentBalance = this.#balances.get(balKey) ?? 0;

    if (!this.#isHealthy) {
      return ok({
        written: false,
        outcome: "unknown",
        currentBalanceMinor: currentBalance
      });
    }

    const op = this.#operations.get(opKey);
    if (op) {
      return ok({
        written: true,
        outcome: "written",
        currentBalanceMinor: currentBalance
      });
    }

    return ok({
      written: false,
      outcome: "not-written",
      currentBalanceMinor: currentBalance
    });
  }

  async applyDelta(params: {
    readonly domainUuid: string;
    readonly resourceId: string;
    readonly providerRef: string;
    readonly deltaMinor: number;
    readonly reason: string;
    readonly options?: { readonly operationRef?: string };
  }): Promise<Result<{ newBalanceMinor: number; outcome?: "success"; providerTransactionRef?: string }, PublicError>> {
    return this.mutateBalance(
      params.domainUuid,
      params.resourceId,
      params.providerRef,
      params.deltaMinor,
      params.reason,
      params.options
    );
  }

  setBalance(targetRef: string, balanceMinor: number): void {
    this.#balances.set(targetRef, balanceMinor);
    this.#schedulePersist();
  }
}
