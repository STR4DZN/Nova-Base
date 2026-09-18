import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import type { CommandId } from "../../commands/command-envelope.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { ResourceDefinitionRegistry } from "../definitions/resource-registry.js";
import type { ResourceDefinition } from "../definitions/resource-definition-types.js";
import type { LedgerStore } from "../ledger/ledger-store.js";
import type { LedgerEntry, LedgerEntryKind, LedgerEntrySource } from "../ledger/ledger-types.js";
import type { ReservationStore } from "../reservations/reservation-store.js";
import type { Reservation, ReservationSource } from "../reservations/reservation-types.js";
import { LockManager } from "../../mutations/lock-manager.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import type { RecoveryService } from "../../mutations/recovery-service.js";
import { createTransactionRecord } from "../../mutations/transaction-record.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";
import type { ThresholdService } from "../thresholds/threshold-service.js";
import {
  type DerivedResourceAccount,
  type NativeResourceAccount,
  type ProviderResourceAccount,
  type ResourceAccount,
  type ResourceAccountMode,
  type ResourceVisibility,
  validateResourceAccount
} from "../accounts/account-types.js";
import {
  type DomainEconomyData,
  getDomainEconomyData,
  tryGetDomainEconomyData,
  withDomainEconomyData
} from "../economy-data.js";
import {
  buildAdjustPlan,
  buildConvertPlan,
  buildTransferPlan,
  type EconomyPlan
} from "../plans/economy-plan.js";
import {
  evaluateCapacity,
  resolveEffectiveCapacity
} from "../accounts/capacity-resolver.js";

export type DerivedAccountResolver = (
  domainUuid: string,
  account: DerivedResourceAccount
) => Promise<Result<{ balanceMinor: number; isStale?: boolean }, PublicError>>;

export interface EconomyServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly resourceRegistry: ResourceDefinitionRegistry;
  readonly ledgerStore: LedgerStore;
  readonly reservationStore: ReservationStore;
  readonly lockManager?: LockManager;
  readonly transactionStore?: TransactionStore;
  readonly recoveryService?: RecoveryService;
  readonly providerRegistry?: ProviderRegistry;
  readonly thresholdService?: ThresholdService;
  readonly derivedResolvers?: Map<string, DerivedAccountResolver>;
}

export interface CreateAccountParams {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly mode?: ResourceAccountMode;
  readonly initialBalanceMinor?: number;
  readonly baseCapacityMinor?: number | null;
  readonly visibility?: ResourceVisibility;
  readonly providerId?: string;
  readonly providerRef?: string;
  readonly resolverId?: string;
  readonly reason?: string;
  readonly userId?: string;
}

export interface CloseAccountParams {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly reason?: string;
  readonly userId?: string;
}

export interface AdjustParams {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly deltaMinor?: number;
  readonly targetBalanceMinor?: number;
  readonly reason: string;
  readonly userId?: string;
  readonly commandId?: CommandId;
  readonly authorityEpoch?: number;
}

export interface TransferParams {
  readonly sourceDomainUuid: string;
  readonly targetDomainUuid: string;
  readonly resourceId: string;
  readonly amountMinor: number;
  readonly reason?: string;
  readonly userId?: string;
  readonly commandId?: CommandId;
  readonly authorityEpoch?: number;
}

export interface ConvertParams {
  readonly domainUuid: string;
  readonly fromResourceId: string;
  readonly toResourceId: string;
  readonly fromAmountMinor: number;
  readonly toAmountMinor: number;
  readonly rateDescription?: string;
  readonly rateRatio?: { numerator: number; denominator: number };
  readonly policyRef?: string;
  readonly reason?: string;
  readonly userId?: string;
  readonly commandId?: CommandId;
  readonly authorityEpoch?: number;
}

export interface ReserveParams {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly amountMinor: number;
  readonly source: ReservationSource;
  readonly expiresAtWorld?: number | null;
  readonly expiresAtReal?: number | null;
}

export interface ConsumeReservationParams {
  readonly domainUuid: string;
  readonly reservationId: string;
  readonly amountMinor: number;
  readonly reason?: string;
  readonly userId?: string;
  readonly commandId?: CommandId;
  readonly authorityEpoch?: number;
}

export interface ReleaseReservationParams {
  readonly domainUuid: string;
  readonly reservationId: string;
  readonly amountMinor?: number;
  readonly reason?: string;
  readonly userId?: string;
}

export interface ReversalParams {
  readonly domainUuid: string;
  readonly entryId: string;
  readonly reason: string;
  readonly userId?: string;
}

export class EconomyService {
  readonly #domains: DomainRepositoryContract;
  readonly #resourceRegistry: ResourceDefinitionRegistry;
  readonly #ledgerStore: LedgerStore;
  readonly #reservationStore: ReservationStore;
  readonly #lockManager: LockManager;
  readonly #transactionStore?: TransactionStore;
  readonly #recoveryService?: RecoveryService;
  readonly #providerRegistry?: ProviderRegistry;
  readonly #thresholdService?: ThresholdService;
  readonly #derivedResolvers?: Map<string, DerivedAccountResolver>;

  constructor(options: EconomyServiceOptions) {
    this.#domains = options.domains;
    this.#resourceRegistry = options.resourceRegistry;
    this.#ledgerStore = options.ledgerStore;
    this.#reservationStore = options.reservationStore;
    this.#lockManager = options.lockManager ?? new LockManager();
    this.#transactionStore = options.transactionStore;
    this.#recoveryService = options.recoveryService;
    this.#providerRegistry = options.providerRegistry;
    this.#thresholdService = options.thresholdService;
    this.#derivedResolvers = options.derivedResolvers;

    if (this.#recoveryService) {
      this.#registerRecoveryCompensators(this.#recoveryService);
    }
  }

  get registry(): ResourceDefinitionRegistry {
    return this.#resourceRegistry;
  }

  get ledgerStore(): LedgerStore {
    return this.#ledgerStore;
  }

  get reservationStore(): ReservationStore {
    return this.#reservationStore;
  }

  get providerRegistry(): ProviderRegistry | undefined {
    return this.#providerRegistry;
  }

  get thresholdService(): ThresholdService | undefined {
    return this.#thresholdService;
  }

  getResourceDefinition(resourceId: string): ResourceDefinition | undefined {
    return this.#resourceRegistry.get(resourceId);
  }

  async getAccount(
    domainUuid: string,
    resourceId: string
  ): Promise<Result<ResourceAccount | undefined, PublicError>> {
    const docRes = await this.#domains.read(this.#cleanUuid(domainUuid));
    if (!docRes.ok) {
      return docRes;
    }
    const econDataRes = tryGetDomainEconomyData(docRes.value.record);
    if (!econDataRes.ok) {
      return econDataRes;
    }
    const acc = econDataRes.value.accounts.find((a) => a.resourceId === resourceId);
    return ok(acc);
  }

  async getAllAccounts(
    domainUuid: string
  ): Promise<Result<readonly ResourceAccount[], PublicError>> {
    const docRes = await this.#domains.read(this.#cleanUuid(domainUuid));
    if (!docRes.ok) {
      return docRes;
    }
    const econDataRes = tryGetDomainEconomyData(docRes.value.record);
    if (!econDataRes.ok) {
      return econDataRes;
    }
    return ok(econDataRes.value.accounts);
  }

  async getAccountAvailability(
    domainUuid: string,
    resourceId: string
  ): Promise<
    Result<
      | {
          account: ResourceAccount;
          balanceMinor: number;
          reservedMinor: number;
          availableMinor: number;
          effectiveCapacityMinor: number | null;
          isStale?: boolean;
          isUnavailable?: boolean;
        }
      | undefined,
      PublicError
    >
  > {
    const accRes = await this.getAccount(domainUuid, resourceId);
    if (!accRes.ok) {
      return accRes;
    }
    const acc = accRes.value;
    if (!acc) {
      return ok(undefined);
    }

    if (acc.mode === "native") {
      const reservedMinor = this.#reservationStore.getReservedTotal(domainUuid, resourceId);
      const availableMinor = acc.balanceMinor - reservedMinor;
      const def = this.#resourceRegistry.get(resourceId);
      const effectiveCap = resolveEffectiveCapacity(acc.baseCapacityMinor, [], def);

      return ok({
        account: acc,
        balanceMinor: acc.balanceMinor,
        reservedMinor,
        availableMinor,
        effectiveCapacityMinor: effectiveCap.effectiveCapacityMinor
      });
    }

    if (acc.mode === "provider") {
      let balanceMinor = 0;
      let capacityMinor: number | null = null;
      let isStale = false;
      let isUnavailable = false;

      if (this.#providerRegistry) {
        const provider = this.#providerRegistry.get(acc.providerId);
        if (provider && "readBalance" in provider) {
          const balRes = await (provider as any).readBalance(domainUuid, resourceId, acc.providerRef);
          if (balRes?.ok) {
            balanceMinor = balRes.value.balanceMinor;
            capacityMinor = balRes.value.effectiveCapacityMinor ?? null;
            isStale = Boolean(balRes.value.isStale);
          } else {
            isUnavailable = true;
          }
        } else {
          isUnavailable = true;
        }
      } else {
        isUnavailable = true;
      }

      const reservedMinor = this.#reservationStore.getReservedTotal(domainUuid, resourceId);
      const availableMinor = balanceMinor - reservedMinor;
      return ok({
        account: acc,
        balanceMinor,
        reservedMinor,
        availableMinor,
        effectiveCapacityMinor: capacityMinor,
        isStale,
        isUnavailable
      });
    }

    // Derived mode: resolve via registered resolver or flag as unavailable (G4-AUD-006)
    const reservedMinor = this.#reservationStore.getReservedTotal(domainUuid, resourceId);
    let balanceMinor = 0;
    let isUnavailable = true;
    let isStale = false;

    if (this.#derivedResolvers) {
      const resolver = this.#derivedResolvers.get(acc.resolverId);
      if (resolver) {
        const res = await resolver(domainUuid, acc);
        if (res.ok) {
          balanceMinor = res.value.balanceMinor;
          isStale = Boolean(res.value.isStale);
          isUnavailable = false;
        }
      }
    }

    return ok({
      account: acc,
      balanceMinor,
      reservedMinor,
      availableMinor: balanceMinor - reservedMinor,
      effectiveCapacityMinor: null,
      isStale,
      isUnavailable
    });
  }

  async createAccount(
    params: CreateAccountParams
  ): Promise<Result<ResourceAccount, PublicError>> {
    const def = this.#resourceRegistry.get(params.resourceId);
    if (!def) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_NOT_FOUND",
          category: "not-found",
          message: `Resource '${params.resourceId}' is not registered`
        })
      );
    }

    const mode = params.mode ?? "native";
    let newAccount: ResourceAccount;

    if (mode === "provider") {
      if (!params.providerId || !params.providerRef) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: "Provider account requires providerId and providerRef"
          })
        );
      }
      newAccount = {
        mode: "provider",
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        providerId: params.providerId,
        providerRef: params.providerRef,
        visibility: params.visibility ?? "public",
        status: "active"
      };
    } else if (mode === "derived") {
      if (!params.resolverId) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: "Derived account requires resolverId"
          })
        );
      }
      newAccount = {
        mode: "derived",
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        resolverId: params.resolverId,
        visibility: params.visibility ?? "public",
        status: "active"
      };
    } else {
      const initialBalance = params.initialBalanceMinor ?? 0;
      if (!Number.isSafeInteger(initialBalance)) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "initialBalanceMinor must be a safe integer"
          })
        );
      }
      if (!def.allowNegative && initialBalance < 0) {
        return err(
          createPublicError({
            code: "DM_ECON_NEGATIVE_NOT_ALLOWED",
            category: "validation",
            message: `Resource '${params.resourceId}' does not allow negative balances`
          })
        );
      }

      newAccount = {
        mode: "native",
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        balanceMinor: initialBalance,
        baseCapacityMinor: params.baseCapacityMinor ?? null,
        visibility: params.visibility ?? "public",
        status: "active"
      };
    }

    const valRes = validateResourceAccount(newAccount);
    if (!valRes.ok) {
      return valRes;
    }

    const lockKey = `domain:${params.domainUuid}`;
    const txId = createOpaqueId("tx");
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `create-account:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;

    try {
      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;

      const econData = getDomainEconomyData(doc.record);
      const existing = econData.accounts.find((a) => a.resourceId === params.resourceId);
      if (existing) {
        if (existing.status === "closed") {
          // Re-activate closed account
          const reactivated: ResourceAccount = {
            ...newAccount,
            ...(newAccount.mode === "native"
              ? { balanceMinor: params.initialBalanceMinor ?? 0 }
              : {})
          } as ResourceAccount;
          const updatedAccounts = econData.accounts.map((a) =>
            a.resourceId === params.resourceId ? reactivated : a
          );
          const updatedRecord = withDomainEconomyData(doc.record, {
            ...econData,
            accounts: Object.freeze(updatedAccounts)
          });
          const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
          if (!updateRes.ok) return updateRes;
          return ok(reactivated);
        }

        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_ALREADY_EXISTS",
            category: "conflict",
            message: `Account for resource '${params.resourceId}' already exists in domain '${params.domainUuid}'`
          })
        );
      }

      const updatedAccounts = [...econData.accounts, newAccount];
      const updatedEconData: DomainEconomyData = {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      };

      const updatedRecord = withDomainEconomyData(doc.record, updatedEconData);
      const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateRes.ok) return updateRes;

      if (newAccount.mode === "native" && newAccount.balanceMinor !== 0) {
        this.#ledgerStore.append({
          domainUuid: params.domainUuid,
          resourceId: params.resourceId,
          deltaMinor: newAccount.balanceMinor,
          kind: "opening-balance",
          source: {
            type: "init",
            reason: params.reason ?? "Account creation opening balance",
            userId: params.userId
          }
        });
        await this.#ledgerStore.flush();
      }

      return ok(newAccount);
    } finally {
      await lockRes.value.release();
    }
  }

  async closeAccount(
    params: CloseAccountParams
  ): Promise<Result<{ success: boolean; softClosed?: boolean }, PublicError>> {
    const lockKey = `domain:${params.domainUuid}`;
    const txId = createOpaqueId("tx");
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `close-account:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;

    try {
      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;

      const econData = getDomainEconomyData(doc.record);
      const acc = econData.accounts.find((a) => a.resourceId === params.resourceId);
      if (!acc) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Account for resource '${params.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }

      if (acc.mode === "native") {
        if (acc.balanceMinor !== 0) {
          return err(
            createPublicError({
              code: "DM_ECON_ACCOUNT_NOT_EMPTY",
              category: "validation",
              message: `Cannot close account '${params.resourceId}' with non-zero balance: ${acc.balanceMinor}`
            })
          );
        }

        const activeReserved = this.#reservationStore.getReservedTotal(params.domainUuid, params.resourceId);
        if (activeReserved > 0) {
          return err(
            createPublicError({
              code: "DM_ECON_ACCOUNT_HAS_RESERVATIONS",
              category: "validation",
              message: `Cannot close account '${params.resourceId}' with active reservations total: ${activeReserved}`
            })
          );
        }
      }

      const hasHistory = this.#ledgerStore.query({
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        limit: 1
      }).length > 0;

      let updatedAccounts: ResourceAccount[];
      let softClosed = false;

      if (hasHistory) {
        // Soft-close: keep account record with status "closed" preserving linkage and audit history (DEC-16798, G4-AUD-010)
        softClosed = true;
        updatedAccounts = econData.accounts.map((a) =>
          a.resourceId === params.resourceId
            ? { ...a, status: "closed" as const, closedAt: Date.now() }
            : a
        );
      } else {
        updatedAccounts = econData.accounts.filter((a) => a.resourceId !== params.resourceId);
      }

      const updatedEconData: DomainEconomyData = {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      };

      const updatedRecord = withDomainEconomyData(doc.record, updatedEconData);
      const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateRes.ok) return updateRes;

      return ok({ success: true, softClosed });
    } finally {
      await lockRes.value.release();
    }
  }

  async previewAdjust(params: AdjustParams): Promise<Result<EconomyPlan, PublicError>> {
    const def = this.#resourceRegistry.get(params.resourceId);
    if (!def) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_NOT_FOUND",
          category: "not-found",
          message: `Resource '${params.resourceId}' is not registered`
        })
      );
    }

    const accRes = await this.getAccount(params.domainUuid, params.resourceId);
    if (!accRes.ok) return accRes;
    const account = accRes.value?.mode === "native" ? accRes.value : undefined;

    const effectiveCap = resolveEffectiveCapacity(account?.baseCapacityMinor ?? null, [], def);

    const plan = buildAdjustPlan({
      domainUuid: params.domainUuid,
      resourceId: params.resourceId,
      deltaMinor: params.deltaMinor,
      targetBalanceMinor: params.targetBalanceMinor,
      reason: params.reason,
      userId: params.userId,
      account,
      definition: def,
      effectiveCapacityMinor: effectiveCap.effectiveCapacityMinor
    });

    return ok(plan);
  }

  async commitAdjust(
    params: AdjustParams
  ): Promise<
    Result<
      {
        account: ResourceAccount;
        entry?: LedgerEntry;
        isNoop?: boolean;
      },
      PublicError
    >
  > {
    const lockKey = `domain:${params.domainUuid}`;
    const txId = createOpaqueId("tx");
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `adjust:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;

    try {
      const def = this.#resourceRegistry.get(params.resourceId);
      if (!def) {
        return err(
          createPublicError({
            code: "DM_ECON_RESOURCE_NOT_FOUND",
            category: "not-found",
            message: `Resource '${params.resourceId}' is not registered`
          })
        );
      }

      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;

      const econData = getDomainEconomyData(doc.record);
      const accIndex = econData.accounts.findIndex((a) => a.resourceId === params.resourceId);
      if (accIndex < 0) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Account for resource '${params.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }

      const existingAccount = econData.accounts[accIndex];

      if (existingAccount.mode === "derived") {
        return err(
          createPublicError({
            code: "DM_ECON_DERIVED_ACCOUNT_READ_ONLY",
            category: "validation",
            message: `Account '${params.resourceId}' is derived and cannot be adjusted manually`
          })
        );
      }

      if (existingAccount.mode === "provider") {
        const providerAccount = existingAccount as ProviderResourceAccount;
        if (!this.#providerRegistry) {
          return err(
            createPublicError({
              code: "DM_ECON_PROVIDER_UNAVAILABLE",
              category: "provider",
              message: "Provider registry is not available"
            })
          );
        }
        const provider = this.#providerRegistry.get(providerAccount.providerId);
        if (!provider || !("mutateBalance" in provider)) {
          return err(
            createPublicError({
              code: "DM_ECON_PROVIDER_UNAVAILABLE",
              category: "provider",
              message: `Provider '${providerAccount.providerId}' is unavailable or does not support balance mutations`
            })
          );
        }
        const delta = params.deltaMinor ?? 0;
        if (delta === 0) {
          return ok({
            account: providerAccount,
            entry: undefined,
            isNoop: true
          });
        }

        const transactionId = createOpaqueId("tx");
        const cmdId = params.commandId ?? (createOpaqueId("cmd") as any);
        const epoch = params.authorityEpoch ?? 1;

        const txRecord = createTransactionRecord({
          transactionId,
          commandId: cmdId,
          authorityEpoch: epoch,
          lockKeys: [lockKey],
          safeAutoRecovery: true,
          recoveryData: {
            type: "economy:provider-adjust",
            domainUuid: params.domainUuid,
            resourceId: params.resourceId,
            providerId: providerAccount.providerId,
            providerRef: providerAccount.providerRef,
            deltaMinor: delta,
            reason: params.reason,
            userId: params.userId
          }
        });

        this.#transactionStore?.save(txRecord);
        this.#transactionStore?.transition(transactionId, "claimed", epoch);
        this.#transactionStore?.transition(transactionId, "prepared", epoch);
        this.#transactionStore?.transition(transactionId, "committing", epoch);
        await this.#transactionStore?.flush();

        const mutRes = await (provider as any).mutateBalance(
          params.domainUuid,
          params.resourceId,
          providerAccount.providerRef,
          delta,
          params.reason
        );
        if (!mutRes.ok) {
          this.#transactionStore?.transition(transactionId, "failed", epoch, mutRes.error.message);
          await this.#transactionStore?.flush();
          return mutRes;
        }

        const entryRes = this.#ledgerStore.append({
          domainUuid: params.domainUuid,
          resourceId: params.resourceId,
          deltaMinor: delta,
          kind: "adjustment",
          transactionId,
          source: {
            type: "adjustment",
            ref: providerAccount.providerRef,
            reason: params.reason,
            userId: params.userId
          }
        });

        if (!entryRes.ok) {
          this.#transactionStore?.transition(
            transactionId,
            "needs-recovery",
            epoch,
            "Failed to append ledger entry after provider mutation"
          );
          await this.#transactionStore?.flush();
          return entryRes;
        }

        await this.#ledgerStore.flush();

        this.#transactionStore?.transition(
          transactionId,
          "committed",
          epoch,
          "Provider adjust completed cleanly"
        );
        await this.#transactionStore?.flush();

        this.#evaluateThresholds(
          params.domainUuid,
          params.resourceId,
          mutRes.value.balanceMinor,
          null
        );

        return ok({
          account: providerAccount,
          entry: entryRes.value,
          isNoop: false,
          transactionId
        });
      }

      const nativeAccount = existingAccount as NativeResourceAccount;
      const effectiveCap = resolveEffectiveCapacity(nativeAccount.baseCapacityMinor, [], def);

      const plan = buildAdjustPlan({
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        deltaMinor: params.deltaMinor,
        targetBalanceMinor: params.targetBalanceMinor,
        reason: params.reason,
        userId: params.userId,
        account: nativeAccount,
        definition: def,
        effectiveCapacityMinor: effectiveCap.effectiveCapacityMinor
      });

      if (!plan.isExecutable) {
        return err(
          plan.blockers[0] ??
            createPublicError({
              code: "DM_ECON_PLAN_INVALID",
              category: "validation",
              message: "Adjust plan is not executable"
            })
        );
      }

      // Master §14.8 / DEC-17114: Delta zero is a no-op without mutating domain or creating ledger entry
      if (plan.isNoop || !plan.ledgerIntents[0] || plan.ledgerIntents[0].deltaMinor === 0) {
        return ok({
          account: existingAccount,
          entry: undefined,
          isNoop: true
        });
      }

      const intent = plan.ledgerIntents[0];
      const newBalance = existingAccount.balanceMinor + intent.deltaMinor;

      const updatedAccount: NativeResourceAccount = {
        ...existingAccount,
        balanceMinor: newBalance
      };

      const updatedAccounts = [...econData.accounts];
      updatedAccounts[accIndex] = updatedAccount;

      const updatedRecord = withDomainEconomyData(doc.record, {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      });

      const updateDocRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateDocRes.ok) return updateDocRes;

      const entryRes = this.#ledgerStore.append({
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        deltaMinor: intent.deltaMinor,
        kind: intent.kind,
        source: intent.source
      });

      if (!entryRes.ok) {
        // Rollback domain balance on ledger append failure
        await this.#domains.update(doc);
        return entryRes;
      }

      await this.#ledgerStore.flush();

      this.#evaluateThresholds(
        params.domainUuid,
        params.resourceId,
        updatedAccount.balanceMinor,
        updatedAccount.baseCapacityMinor
      );

      return ok({
        account: updatedAccount,
        entry: entryRes.value
      });
    } finally {
      await lockRes.value.release();
    }
  }

  async previewTransfer(params: TransferParams): Promise<Result<EconomyPlan, PublicError>> {
    const def = this.#resourceRegistry.get(params.resourceId);
    if (!def) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_NOT_FOUND",
          category: "not-found",
          message: `Resource '${params.resourceId}' is not registered`
        })
      );
    }

    const srcAccRes = await this.getAccount(params.sourceDomainUuid, params.resourceId);
    if (!srcAccRes.ok) return srcAccRes;
    const srcAccount = srcAccRes.value?.mode === "native" ? srcAccRes.value : undefined;

    const tgtAccRes = await this.getAccount(params.targetDomainUuid, params.resourceId);
    if (!tgtAccRes.ok) return tgtAccRes;
    const tgtAccount = tgtAccRes.value?.mode === "native" ? tgtAccRes.value : undefined;

    const srcReserved = this.#reservationStore.getReservedTotal(
      params.sourceDomainUuid,
      params.resourceId
    );
    const tgtEffectiveCap = resolveEffectiveCapacity(tgtAccount?.baseCapacityMinor ?? null, [], def);

    const plan = buildTransferPlan({
      sourceDomainUuid: params.sourceDomainUuid,
      targetDomainUuid: params.targetDomainUuid,
      resourceId: params.resourceId,
      amountMinor: params.amountMinor,
      reason: params.reason,
      userId: params.userId,
      sourceAccount: srcAccount,
      sourceReservedMinor: srcReserved,
      targetAccount: tgtAccount,
      definition: def,
      targetCapacityMinor: tgtEffectiveCap.effectiveCapacityMinor
    });

    return ok(plan);
  }

  async commitTransfer(
    params: TransferParams
  ): Promise<
    Result<
      {
        sourceAccount: NativeResourceAccount;
        targetAccount: NativeResourceAccount;
        debitEntry: LedgerEntry;
        creditEntry: LedgerEntry;
        transactionId: string;
      },
      PublicError
    >
  > {
    if (params.sourceDomainUuid === params.targetDomainUuid) {
      return err(
        createPublicError({
          code: "DM_ECON_TRANSFER_SAME_DOMAIN",
          category: "validation",
          message: "Transfer source and target domain cannot be the same"
        })
      );
    }

    // Deterministic ordered multi-key locking (DEC-603–620, DEC-17227)
    const lockKeys = [params.sourceDomainUuid, params.targetDomainUuid]
      .sort((a, b) => a.localeCompare(b))
      .map((u) => `domain:${u}`);

    const transactionId = createOpaqueId("tx");
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `transfer:${transactionId}`,
      keys: lockKeys
    });
    if (!lockRes.ok) return lockRes;

    try {
      const def = this.#resourceRegistry.get(params.resourceId);
      if (!def) {
        return err(
          createPublicError({
            code: "DM_ECON_RESOURCE_NOT_FOUND",
            category: "not-found",
            message: `Resource '${params.resourceId}' is not registered`
          })
        );
      }

      // Fresh read of source
      const srcDocRes = await this.#domains.read(this.#cleanUuid(params.sourceDomainUuid));
      if (!srcDocRes.ok) return srcDocRes;
      const srcDoc = srcDocRes.value;

      // Fresh read of target
      const tgtDocRes = await this.#domains.read(this.#cleanUuid(params.targetDomainUuid));
      if (!tgtDocRes.ok) return tgtDocRes;
      const tgtDoc = tgtDocRes.value;

      const srcEcon = getDomainEconomyData(srcDoc.record);
      const srcAccIndex = srcEcon.accounts.findIndex((a) => a.resourceId === params.resourceId);
      if (srcAccIndex < 0 || srcEcon.accounts[srcAccIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Source domain '${params.sourceDomainUuid}' does not have a native account for '${params.resourceId}'`
          })
        );
      }
      const srcAccount = srcEcon.accounts[srcAccIndex] as NativeResourceAccount;

      const tgtEcon = getDomainEconomyData(tgtDoc.record);
      const tgtAccIndex = tgtEcon.accounts.findIndex((a) => a.resourceId === params.resourceId);
      if (tgtAccIndex < 0 || tgtEcon.accounts[tgtAccIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Target domain '${params.targetDomainUuid}' does not have a native account for '${params.resourceId}'`
          })
        );
      }
      const tgtAccount = tgtEcon.accounts[tgtAccIndex] as NativeResourceAccount;

      const srcReserved = this.#reservationStore.getReservedTotal(
        params.sourceDomainUuid,
        params.resourceId
      );
      const tgtEffectiveCap = resolveEffectiveCapacity(tgtAccount.baseCapacityMinor, [], def);

      const plan = buildTransferPlan({
        sourceDomainUuid: params.sourceDomainUuid,
        targetDomainUuid: params.targetDomainUuid,
        resourceId: params.resourceId,
        amountMinor: params.amountMinor,
        reason: params.reason,
        userId: params.userId,
        sourceAccount: srcAccount,
        sourceReservedMinor: srcReserved,
        targetAccount: tgtAccount,
        definition: def,
        targetCapacityMinor: tgtEffectiveCap.effectiveCapacityMinor
      });

      if (!plan.isExecutable) {
        return err(
          plan.blockers[0] ??
            createPublicError({
              code: "DM_ECON_PLAN_INVALID",
              category: "validation",
              message: "Transfer plan is not executable"
            })
        );
      }

      // Register durable TransactionRecord (G4-AUD-002, DEC-17222)
      const cmdId = params.commandId ?? (createOpaqueId("cmd") as CommandId);
      const epoch = params.authorityEpoch ?? 1;
      const txRecord = createTransactionRecord({
        transactionId,
        commandId: cmdId,
        authorityEpoch: epoch,
        lockKeys,
        safeAutoRecovery: true,
        recoveryData: {
          type: "economy:transfer",
          sourceDomainUuid: params.sourceDomainUuid,
          targetDomainUuid: params.targetDomainUuid,
          resourceId: params.resourceId,
          amountMinor: params.amountMinor,
          sourceInitialBalance: srcAccount.balanceMinor,
          targetInitialBalance: tgtAccount.balanceMinor,
          sourceInitialDoc: srcDoc,
          targetInitialDoc: tgtDoc
        }
      });
      this.#transactionStore?.save(txRecord);
      this.#transactionStore?.transition(transactionId, "claimed", epoch);
      this.#transactionStore?.transition(transactionId, "prepared", epoch);
      this.#transactionStore?.transition(transactionId, "committing", epoch);
      await this.#transactionStore?.flush();

      // Execute balance updates
      const updatedSrcAccount: NativeResourceAccount = {
        ...srcAccount,
        balanceMinor: srcAccount.balanceMinor - params.amountMinor
      };
      const updatedTgtAccount: NativeResourceAccount = {
        ...tgtAccount,
        balanceMinor: tgtAccount.balanceMinor + params.amountMinor
      };

      const srcAccounts = [...srcEcon.accounts];
      srcAccounts[srcAccIndex] = updatedSrcAccount;
      const updatedSrcRecord = withDomainEconomyData(srcDoc.record, {
        ...srcEcon,
        accounts: Object.freeze(srcAccounts)
      });

      const tgtAccounts = [...tgtEcon.accounts];
      tgtAccounts[tgtAccIndex] = updatedTgtAccount;
      const updatedTgtRecord = withDomainEconomyData(tgtDoc.record, {
        ...tgtEcon,
        accounts: Object.freeze(tgtAccounts)
      });

      // Write source domain
      const updateSrcRes = await this.#domains.update({ ...srcDoc, record: updatedSrcRecord });
      if (!updateSrcRes.ok) {
        this.#transactionStore?.transition(transactionId, "failed", epoch, "Failed to update source domain");
        await this.#transactionStore?.flush();
        return updateSrcRes;
      }

      // Write target domain
      const updateTgtRes = await this.#domains.update({ ...tgtDoc, record: updatedTgtRecord });
      if (!updateTgtRes.ok) {
        // Multi-write partial failure: Rollback source domain!
        const rollbackRes = await this.#domains.update({
          ...srcDoc,
          record: {
            ...srcDoc.record,
            revision: updateSrcRes.value.revision
          }
        });
        if (rollbackRes.ok) {
          this.#transactionStore?.transition(
            transactionId,
            "failed",
            epoch,
            "Rolled back source domain after target update failure"
          );
        } else {
          this.#transactionStore?.transition(
            transactionId,
            "needs-recovery",
            epoch,
            "Rollback of source domain failed; needs manual or auto recovery"
          );
        }
        await this.#transactionStore?.flush();
        return updateTgtRes;
      }

      // Append ledger entries sharing transactionId (DEC-17219–17222)
      const debitEntryRes = this.#ledgerStore.append({
        domainUuid: params.sourceDomainUuid,
        resourceId: params.resourceId,
        deltaMinor: -params.amountMinor,
        kind: "transfer-debit",
        transactionId,
        source: {
          type: "transfer",
          ref: `transfer_to:${params.targetDomainUuid}`,
          reason: params.reason,
          userId: params.userId
        }
      });
      if (!debitEntryRes.ok) {
        this.#transactionStore?.transition(
          transactionId,
          "needs-recovery",
          epoch,
          "Failed to append debit ledger entry"
        );
        await this.#transactionStore?.flush();
        return debitEntryRes;
      }

      const creditEntryRes = this.#ledgerStore.append({
        domainUuid: params.targetDomainUuid,
        resourceId: params.resourceId,
        deltaMinor: params.amountMinor,
        kind: "transfer-credit",
        transactionId,
        source: {
          type: "transfer",
          ref: `transfer_from:${params.sourceDomainUuid}`,
          reason: params.reason,
          userId: params.userId
        }
      });
      if (!creditEntryRes.ok) {
        this.#transactionStore?.transition(
          transactionId,
          "needs-recovery",
          epoch,
          "Failed to append credit ledger entry"
        );
        await this.#transactionStore?.flush();
        return creditEntryRes;
      }

      await this.#ledgerStore.flush();
      this.#transactionStore?.transition(
        transactionId,
        "committed",
        epoch,
        "Transfer completed cleanly"
      );
      await this.#transactionStore?.flush();

      this.#evaluateThresholds(
        params.sourceDomainUuid,
        params.resourceId,
        updatedSrcAccount.balanceMinor,
        updatedSrcAccount.baseCapacityMinor
      );
      this.#evaluateThresholds(
        params.targetDomainUuid,
        params.resourceId,
        updatedTgtAccount.balanceMinor,
        updatedTgtAccount.baseCapacityMinor
      );

      return ok({
        sourceAccount: updatedSrcAccount,
        targetAccount: updatedTgtAccount,
        debitEntry: debitEntryRes.value,
        creditEntry: creditEntryRes.value,
        transactionId
      });
    } finally {
      await lockRes.value.release();
    }
  }

  async previewConvert(params: ConvertParams): Promise<Result<EconomyPlan, PublicError>> {
    const fromDef = this.#resourceRegistry.get(params.fromResourceId);
    if (!fromDef) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_NOT_FOUND",
          category: "not-found",
          message: `Resource '${params.fromResourceId}' is not registered`
        })
      );
    }
    const toDef = this.#resourceRegistry.get(params.toResourceId);
    if (!toDef) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_NOT_FOUND",
          category: "not-found",
          message: `Resource '${params.toResourceId}' is not registered`
        })
      );
    }

    const fromAccRes = await this.getAccount(params.domainUuid, params.fromResourceId);
    if (!fromAccRes.ok) return fromAccRes;
    const fromAccount = fromAccRes.value?.mode === "native" ? fromAccRes.value : undefined;

    const toAccRes = await this.getAccount(params.domainUuid, params.toResourceId);
    if (!toAccRes.ok) return toAccRes;
    const toAccount = toAccRes.value?.mode === "native" ? toAccRes.value : undefined;

    const fromReserved = this.#reservationStore.getReservedTotal(
      params.domainUuid,
      params.fromResourceId
    );
    const toEffectiveCap = resolveEffectiveCapacity(toAccount?.baseCapacityMinor ?? null, [], toDef);

    const plan = buildConvertPlan({
      domainUuid: params.domainUuid,
      fromResourceId: params.fromResourceId,
      toResourceId: params.toResourceId,
      fromAmountMinor: params.fromAmountMinor,
      toAmountMinor: params.toAmountMinor,
      rateDescription: params.rateDescription,
      reason: params.reason,
      userId: params.userId,
      fromAccount,
      fromReservedMinor: fromReserved,
      toAccount,
      fromDefinition: fromDef,
      toDefinition: toDef,
      toCapacityMinor: toEffectiveCap.effectiveCapacityMinor
    });

    return ok(plan);
  }

  async commitConvert(
    params: ConvertParams
  ): Promise<
    Result<
      {
        fromAccount: NativeResourceAccount;
        toAccount: NativeResourceAccount;
        debitEntry: LedgerEntry;
        creditEntry: LedgerEntry;
        transactionId: string;
      },
      PublicError
    >
  > {
    const lockKey = `domain:${params.domainUuid}`;
    const transactionId = createOpaqueId("tx");
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `convert:${transactionId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;

    try {
      const fromDef = this.#resourceRegistry.get(params.fromResourceId);
      if (!fromDef) {
        return err(
          createPublicError({
            code: "DM_ECON_RESOURCE_NOT_FOUND",
            category: "not-found",
            message: `Resource '${params.fromResourceId}' is not registered`
          })
        );
      }
      const toDef = this.#resourceRegistry.get(params.toResourceId);
      if (!toDef) {
        return err(
          createPublicError({
            code: "DM_ECON_RESOURCE_NOT_FOUND",
            category: "not-found",
            message: `Resource '${params.toResourceId}' is not registered`
          })
        );
      }

      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;

      const econData = getDomainEconomyData(doc.record);
      const fromAccIndex = econData.accounts.findIndex((a) => a.resourceId === params.fromResourceId);
      if (fromAccIndex < 0 || econData.accounts[fromAccIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Source account '${params.fromResourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }
      const fromAccount = econData.accounts[fromAccIndex] as NativeResourceAccount;

      const toAccIndex = econData.accounts.findIndex((a) => a.resourceId === params.toResourceId);
      if (toAccIndex < 0 || econData.accounts[toAccIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Destination account '${params.toResourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }
      const toAccount = econData.accounts[toAccIndex] as NativeResourceAccount;

      const fromReserved = this.#reservationStore.getReservedTotal(
        params.domainUuid,
        params.fromResourceId
      );
      const toEffectiveCap = resolveEffectiveCapacity(toAccount.baseCapacityMinor, [], toDef);

      const plan = buildConvertPlan({
        domainUuid: params.domainUuid,
        fromResourceId: params.fromResourceId,
        toResourceId: params.toResourceId,
        fromAmountMinor: params.fromAmountMinor,
        toAmountMinor: params.toAmountMinor,
        rateDescription: params.rateDescription,
        reason: params.reason,
        userId: params.userId,
        fromAccount,
        fromReservedMinor: fromReserved,
        toAccount,
        fromDefinition: fromDef,
        toDefinition: toDef,
        toCapacityMinor: toEffectiveCap.effectiveCapacityMinor
      });

      if (!plan.isExecutable) {
        return err(
          plan.blockers[0] ??
            createPublicError({
              code: "DM_ECON_PLAN_INVALID",
              category: "validation",
              message: "Convert plan is not executable"
            })
        );
      }

      // Register transaction record
      const cmdId = params.commandId ?? (createOpaqueId("cmd") as CommandId);
      const epoch = params.authorityEpoch ?? 1;
      const txRecord = createTransactionRecord({
        transactionId,
        commandId: cmdId,
        authorityEpoch: epoch,
        lockKeys: [lockKey],
        safeAutoRecovery: true,
        recoveryData: {
          type: "economy:convert",
          domainUuid: params.domainUuid,
          fromResourceId: params.fromResourceId,
          toResourceId: params.toResourceId,
          fromAmountMinor: params.fromAmountMinor,
          toAmountMinor: params.toAmountMinor,
          fromInitialBalance: fromAccount.balanceMinor,
          toInitialBalance: toAccount.balanceMinor
        }
      });
      this.#transactionStore?.save(txRecord);
      this.#transactionStore?.transition(transactionId, "claimed", epoch);
      this.#transactionStore?.transition(transactionId, "prepared", epoch);
      this.#transactionStore?.transition(transactionId, "committing", epoch);
      await this.#transactionStore?.flush();

      const updatedFromAccount: NativeResourceAccount = {
        ...fromAccount,
        balanceMinor: fromAccount.balanceMinor - params.fromAmountMinor
      };
      const updatedToAccount: NativeResourceAccount = {
        ...toAccount,
        balanceMinor: toAccount.balanceMinor + params.toAmountMinor
      };

      const updatedAccounts = [...econData.accounts];
      updatedAccounts[fromAccIndex] = updatedFromAccount;
      updatedAccounts[toAccIndex] = updatedToAccount;

      const updatedRecord = withDomainEconomyData(doc.record, {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      });

      const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateRes.ok) {
        this.#transactionStore?.transition(transactionId, "failed", epoch, "Failed to update domain document");
        await this.#transactionStore?.flush();
        return updateRes;
      }

      const rateReason =
        params.reason ??
        params.rateDescription ??
        (params.rateRatio
          ? `Rate: ${params.rateRatio.numerator}/${params.rateRatio.denominator}`
          : "Currency/Resource conversion");

      const debitEntryRes = this.#ledgerStore.append({
        domainUuid: params.domainUuid,
        resourceId: params.fromResourceId,
        deltaMinor: -params.fromAmountMinor,
        kind: "conversion-debit",
        transactionId,
        source: {
          type: "conversion",
          ref: `converted_to:${params.toResourceId}`,
          reason: rateReason,
          userId: params.userId
        }
      });
      if (!debitEntryRes.ok) {
        this.#transactionStore?.transition(transactionId, "needs-recovery", epoch, "Failed to append conversion debit entry");
        await this.#transactionStore?.flush();
        return debitEntryRes;
      }

      const creditEntryRes = this.#ledgerStore.append({
        domainUuid: params.domainUuid,
        resourceId: params.toResourceId,
        deltaMinor: params.toAmountMinor,
        kind: "conversion-credit",
        transactionId,
        source: {
          type: "conversion",
          ref: `converted_from:${params.fromResourceId}`,
          reason: rateReason,
          userId: params.userId
        }
      });
      if (!creditEntryRes.ok) {
        this.#transactionStore?.transition(transactionId, "needs-recovery", epoch, "Failed to append conversion credit entry");
        await this.#transactionStore?.flush();
        return creditEntryRes;
      }

      await this.#ledgerStore.flush();
      this.#transactionStore?.transition(transactionId, "committed", epoch, "Conversion completed cleanly");
      await this.#transactionStore?.flush();

      this.#evaluateThresholds(
        params.domainUuid,
        params.fromResourceId,
        updatedFromAccount.balanceMinor,
        updatedFromAccount.baseCapacityMinor
      );
      this.#evaluateThresholds(
        params.domainUuid,
        params.toResourceId,
        updatedToAccount.balanceMinor,
        updatedToAccount.baseCapacityMinor
      );

      return ok({
        fromAccount: updatedFromAccount,
        toAccount: updatedToAccount,
        debitEntry: debitEntryRes.value,
        creditEntry: creditEntryRes.value,
        transactionId
      });
    } finally {
      await lockRes.value.release();
    }
  }

  async reserve(params: ReserveParams): Promise<Result<Reservation, PublicError>> {
    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `reserve:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;

    try {
      const accRes = await this.getAccount(params.domainUuid, params.resourceId);
      if (!accRes.ok) return accRes;
      const acc = accRes.value;
      if (!acc || acc.mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Native account '${params.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }

      const currentReserved = this.#reservationStore.getReservedTotal(
        params.domainUuid,
        params.resourceId
      );
      const available = acc.balanceMinor - currentReserved;

      if (params.amountMinor > available) {
        return err(
          createPublicError({
            code: "DM_ECON_INSUFFICIENT_AVAILABLE",
            category: "validation",
            message: `Cannot reserve ${params.amountMinor}: only ${available} available (balance: ${acc.balanceMinor}, reserved: ${currentReserved})`
          })
        );
      }

      // Reservation does NOT alter balance, does NOT create LedgerEntry (DEC-17049–17054)
      const res = this.#reservationStore.create({
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        originalAmountMinor: params.amountMinor,
        source: params.source,
        expiresAtWorld: params.expiresAtWorld,
        expiresAtReal: params.expiresAtReal
      });
      if (res.ok) {
        await this.#reservationStore.flush();
        this.#evaluateThresholds(
          params.domainUuid,
          params.resourceId,
          acc.balanceMinor,
          acc.baseCapacityMinor
        );
      }
      return res;
    } finally {
      await lockRes.value.release();
    }
  }

  async consumeReservation(
    params: ConsumeReservationParams
  ): Promise<
    Result<
      {
        reservation: Reservation;
        entry: LedgerEntry;
        account: NativeResourceAccount;
      },
      PublicError
    >
  > {
    // 1. Read reservation read-only first WITHOUT mutating
    const existing = this.#reservationStore.get(params.reservationId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "validation",
          message: `Reservation '${params.reservationId}' not found`
        })
      );
    }

    // 2. Strict domain check (G4-AUD-003): reservation MUST belong to params.domainUuid
    if (existing.domainUuid !== params.domainUuid) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_DOMAIN_MISMATCH",
          category: "permission",
          message: `Reservation '${params.reservationId}' belongs to domain '${existing.domainUuid}', not '${params.domainUuid}'`
        })
      );
    }

    // 3. Acquire canonical lock on domain
    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `consume-reservation:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;

    try {
      // 4. Re-read reservation and domain under lock
      const lockedRes = this.#reservationStore.get(params.reservationId);
      if (!lockedRes) {
        return err(
          createPublicError({
            code: "DM_ECON_RESERVATION_NOT_FOUND",
            category: "validation",
            message: `Reservation '${params.reservationId}' not found`
          })
        );
      }
      if (lockedRes.domainUuid !== params.domainUuid) {
        return err(
          createPublicError({
            code: "DM_ECON_RESERVATION_DOMAIN_MISMATCH",
            category: "permission",
            message: `Reservation '${params.reservationId}' belongs to domain '${lockedRes.domainUuid}', not '${params.domainUuid}'`
          })
        );
      }

      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;

      const econData = getDomainEconomyData(doc.record);
      const accIndex = econData.accounts.findIndex((a) => a.resourceId === lockedRes.resourceId);
      if (accIndex < 0 || econData.accounts[accIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Account '${lockedRes.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }
      const account = econData.accounts[accIndex] as NativeResourceAccount;

      // 5. Check balance
      if (account.balanceMinor < params.amountMinor) {
        return err(
          createPublicError({
            code: "DM_ECON_INSUFFICIENT_BALANCE",
            category: "validation",
            message: `Insufficient balance: account has ${account.balanceMinor}, required ${params.amountMinor}`
          })
        );
      }

      // 6. Consume reservation
      const consumeRes = this.#reservationStore.consume(params.reservationId, params.amountMinor, {
        reason: params.reason,
        userId: params.userId
      });
      if (!consumeRes.ok) return consumeRes;
      const { reservation, consumedAmount } = consumeRes.value;

      // 7. Update domain balance
      const updatedAccount: NativeResourceAccount = {
        ...account,
        balanceMinor: account.balanceMinor - consumedAmount
      };
      const updatedAccounts = [...econData.accounts];
      updatedAccounts[accIndex] = updatedAccount;
      const updatedRecord = withDomainEconomyData(doc.record, {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      });

      const updateDocRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateDocRes.ok) {
        // Rollback reservation consumption if domain update fails!
        this.#reservationStore.rollbackConsume(lockedRes, consumedAmount, {
          reason: "Rollback after failed domain balance update",
          userId: params.userId
        });
        await this.#reservationStore.flush();
        return updateDocRes;
      }

      // 8. Append consumption entry to ledger referencing reservationId (DEC-17072–17073)
      const entryRes = this.#ledgerStore.append({
        domainUuid: params.domainUuid,
        resourceId: reservation.resourceId,
        deltaMinor: -consumedAmount,
        kind: "consumption",
        reservationId: reservation.id,
        source: {
          type: reservation.source.type,
          ref: reservation.source.ref,
          reason: params.reason ?? "Reservation consumption",
          userId: params.userId
        }
      });
      if (!entryRes.ok) {
        // Rollback domain update and reservation consumption if ledger append fails
        await this.#domains.update({
          ...doc,
          record: {
            ...doc.record,
            revision: updateDocRes.value.revision
          }
        });
        this.#reservationStore.rollbackConsume(lockedRes, consumedAmount, {
          reason: "Rollback after failed ledger append",
          userId: params.userId
        });
        await this.#reservationStore.flush();
        return entryRes;
      }

      await this.#ledgerStore.flush();
      await this.#reservationStore.flush();

      this.#evaluateThresholds(
        params.domainUuid,
        reservation.resourceId,
        updatedAccount.balanceMinor,
        updatedAccount.baseCapacityMinor
      );

      return ok({
        reservation,
        entry: entryRes.value,
        account: updatedAccount
      });
    } finally {
      await lockRes.value.release();
    }
  }

  async releaseReservation(
    params: ReleaseReservationParams
  ): Promise<Result<{ reservation: Reservation; releasedAmount: number }, PublicError>> {
    // 1. Read reservation read-only first (G4-AUD-003)
    const existing = this.#reservationStore.get(params.reservationId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "validation",
          message: `Reservation '${params.reservationId}' not found`
        })
      );
    }

    // 2. Strict domain check (G4-AUD-003)
    if (existing.domainUuid !== params.domainUuid) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_DOMAIN_MISMATCH",
          category: "permission",
          message: `Reservation '${params.reservationId}' belongs to domain '${existing.domainUuid}', not '${params.domainUuid}'`
        })
      );
    }

    // 3. Acquire lock on domain
    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `release-reservation:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;

    try {
      // 4. Re-read and re-validate under lock
      const lockedRes = this.#reservationStore.get(params.reservationId);
      if (!lockedRes) {
        return err(
          createPublicError({
            code: "DM_ECON_RESERVATION_NOT_FOUND",
            category: "validation",
            message: `Reservation '${params.reservationId}' not found`
          })
        );
      }
      if (lockedRes.domainUuid !== params.domainUuid) {
        return err(
          createPublicError({
            code: "DM_ECON_RESERVATION_DOMAIN_MISMATCH",
            category: "permission",
            message: `Reservation '${params.reservationId}' belongs to domain '${lockedRes.domainUuid}', not '${params.domainUuid}'`
          })
        );
      }

      const relRes = this.#reservationStore.release(params.reservationId, params.amountMinor, {
        reason: params.reason,
        userId: params.userId
      });
      if (relRes.ok) {
        await this.#reservationStore.flush();
        const accRes = await this.getAccount(params.domainUuid, lockedRes.resourceId);
        if (accRes.ok && accRes.value?.mode === "native") {
          this.#evaluateThresholds(
            params.domainUuid,
            lockedRes.resourceId,
            accRes.value.balanceMinor,
            accRes.value.baseCapacityMinor
          );
        }
      }
      return relRes;
    } finally {
      await lockRes.value.release();
    }
  }

  async reverseLedgerEntry(
    params: ReversalParams
  ): Promise<Result<{ reversalEntry: LedgerEntry; account: NativeResourceAccount }, PublicError>> {
    const originalEntry = this.#ledgerStore.get(params.entryId);
    if (!originalEntry) {
      return err(
        createPublicError({
          code: "DM_ECON_LEDGER_NOT_FOUND",
          category: "not-found",
          message: `Ledger entry '${params.entryId}' not found`
        })
      );
    }

    if (originalEntry.domainUuid !== params.domainUuid) {
      return err(
        createPublicError({
          code: "DM_ECON_DOMAIN_MISMATCH",
          category: "validation",
          message: `Entry '${params.entryId}' belongs to domain '${originalEntry.domainUuid}', not '${params.domainUuid}'`
        })
      );
    }

    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `reversal:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;

    try {
      if (this.#ledgerStore.isReversed(params.entryId)) {
        return err(
          createPublicError({
            code: "DM_ECON_REVERSAL_ALREADY_EXISTS",
            category: "conflict",
            message: `Entry '${params.entryId}' has already been reversed`
          })
        );
      }

      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;

      const econData = getDomainEconomyData(doc.record);
      const accIndex = econData.accounts.findIndex((a) => a.resourceId === originalEntry.resourceId);
      if (accIndex < 0 || econData.accounts[accIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Account '${originalEntry.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }

      const targetAccount = econData.accounts[accIndex] as NativeResourceAccount;
      const newBalance = targetAccount.balanceMinor - originalEntry.deltaMinor;

      const def = this.#resourceRegistry.get(originalEntry.resourceId);
      if (def && !def.allowNegative && newBalance < 0) {
        return err(
          createPublicError({
            code: "DM_ECON_NEGATIVE_NOT_ALLOWED",
            category: "validation",
            message: `Reversal would cause balance to drop below zero (${newBalance}) for resource '${originalEntry.resourceId}'`
          })
        );
      }

      // Update domain balance
      const updatedAccount: NativeResourceAccount = {
        ...targetAccount,
        balanceMinor: newBalance
      };
      const updatedAccounts = [...econData.accounts];
      updatedAccounts[accIndex] = updatedAccount;
      const updatedRecord = withDomainEconomyData(doc.record, {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      });

      const updateDocRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateDocRes.ok) return updateDocRes;

      // Append reversal entry to ledger
      const reversalRes = this.#ledgerStore.createReversal(
        params.entryId,
        params.reason,
        params.userId
      );
      if (!reversalRes.ok) {
        // Rollback domain update if reversal entry creation fails
        await this.#domains.update(doc);
        return reversalRes;
      }

      await this.#ledgerStore.flush();

      this.#evaluateThresholds(
        params.domainUuid,
        originalEntry.resourceId,
        updatedAccount.balanceMinor,
        updatedAccount.baseCapacityMinor
      );

      return ok({
        reversalEntry: reversalRes.value,
        account: updatedAccount
      });
    } finally {
      await lockRes.value.release();
    }
  }

  #cleanUuid(domainUuid: string): string {
    return domainUuid.trim();
  }

  #evaluateThresholds(
    domainUuid: string,
    resourceId: string,
    balanceMinor: number,
    capacityMinor?: number | null
  ): void {
    if (!this.#thresholdService) return;
    const reservedMinor = this.#reservationStore.getReservedTotal(domainUuid, resourceId);
    const availableMinor = balanceMinor - reservedMinor;
    this.#thresholdService.evaluateCrossings(domainUuid, resourceId, {
      balanceMinor,
      reservedMinor,
      availableMinor,
      capacityMinor
    });
  }

  #registerRecoveryCompensators(recoveryService: RecoveryService): void {
    recoveryService.registerCompensator("economy:transfer", async (record) => {
      const data = record.recoveryData as Record<string, any> | undefined;
      if (!data || !data.sourceDomainUuid || !data.targetDomainUuid || !data.resourceId || !data.amountMinor) {
        return ok(undefined);
      }

      const srcCleanUuid = this.#cleanUuid(data.sourceDomainUuid);
      const tgtCleanUuid = this.#cleanUuid(data.targetDomainUuid);

      const srcRes = await this.#domains.read(srcCleanUuid);
      if (!srcRes.ok) return srcRes;
      const srcDoc = srcRes.value;

      const tgtRes = await this.#domains.read(tgtCleanUuid);
      if (!tgtRes.ok) return tgtRes;
      const tgtDoc = tgtRes.value;

      const srcEcon = getDomainEconomyData(srcDoc.record);
      const tgtEcon = getDomainEconomyData(tgtDoc.record);

      const srcAccIndex = srcEcon.accounts.findIndex((a) => a.resourceId === data.resourceId);
      const tgtAccIndex = tgtEcon.accounts.findIndex((a) => a.resourceId === data.resourceId);
      if (srcAccIndex < 0 || tgtAccIndex < 0) return ok(undefined);

      const srcAccount = srcEcon.accounts[srcAccIndex] as NativeResourceAccount;
      const tgtAccount = tgtEcon.accounts[tgtAccIndex] as NativeResourceAccount;

      // 1. Inspect ledger entries associated with this transaction
      const txEntries = this.#ledgerStore.query({ transactionId: record.transactionId });
      const hasDebitEntry = txEntries.some(
        (e) => e.kind === "transfer-debit" && e.domainUuid === data.sourceDomainUuid
      );
      const hasCreditEntry = txEntries.some(
        (e) => e.kind === "transfer-credit" && e.domainUuid === data.targetDomainUuid
      );
      const hasCompensatingDebitReversal = txEntries.some(
        (e) => e.source?.type === "recovery" && e.domainUuid === data.sourceDomainUuid
      );
      const hasCompensatingCreditReversal = txEntries.some(
        (e) => e.source?.type === "recovery" && e.domainUuid === data.targetDomainUuid
      );

      // 2. Inspect balance states relative to initial balances stored in recoveryData
      const sourceInitialBalance: number =
        typeof data.sourceInitialBalance === "number" ? data.sourceInitialBalance : srcAccount.balanceMinor;
      const targetInitialBalance: number =
        typeof data.targetInitialBalance === "number" ? data.targetInitialBalance : tgtAccount.balanceMinor;
      const amountMinor: number = data.amountMinor;

      const srcIsDebited = srcAccount.balanceMinor === sourceInitialBalance - amountMinor;
      const tgtIsCredited = tgtAccount.balanceMinor === targetInitialBalance + amountMinor;

      // Decision Matrix:
      // Case A: Both ledger entries exist AND both balances were updated -> Clean completion before crash!
      if (hasDebitEntry && hasCreditEntry && srcIsDebited && tgtIsCredited) {
        if (this.#transactionStore) {
          this.#transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Reconciliation confirmed both domain writes and ledger entries completed"
          );
          await this.#transactionStore.flush();
        }
        return ok(undefined);
      }

      // Case B / C / D: Needs compensation to restore invariant mass and ledger consistency
      // If source balance is debited, restore it to initial
      if (srcIsDebited) {
        const restoredSrcAccount: NativeResourceAccount = {
          ...srcAccount,
          balanceMinor: sourceInitialBalance
        };
        const updatedAccounts = [...srcEcon.accounts];
        updatedAccounts[srcAccIndex] = restoredSrcAccount;
        const updatedRecord = withDomainEconomyData(srcDoc.record, {
          ...srcEcon,
          accounts: Object.freeze(updatedAccounts)
        });
        const updateRes = await this.#domains.update({ ...srcDoc, record: updatedRecord });
        if (!updateRes.ok) return updateRes;
      }

      // If target balance is credited, restore it to initial
      if (tgtIsCredited) {
        const restoredTgtAccount: NativeResourceAccount = {
          ...tgtAccount,
          balanceMinor: targetInitialBalance
        };
        const updatedAccounts = [...tgtEcon.accounts];
        updatedAccounts[tgtAccIndex] = restoredTgtAccount;
        const updatedRecord = withDomainEconomyData(tgtDoc.record, {
          ...tgtEcon,
          accounts: Object.freeze(updatedAccounts)
        });
        const updateRes = await this.#domains.update({ ...tgtDoc, record: updatedRecord });
        if (!updateRes.ok) return updateRes;
      }

      // Ledger Reversals:
      // Only append a compensating ledger entry if the debit/credit entry actually existed in the ledger!
      let ledgerMutated = false;
      if (hasDebitEntry && !hasCompensatingDebitReversal) {
        this.#ledgerStore.append({
          domainUuid: data.sourceDomainUuid,
          resourceId: data.resourceId,
          deltaMinor: amountMinor,
          kind: "adjustment",
          transactionId: record.transactionId,
          source: {
            type: "recovery",
            reason: `Recovery compensation for failed transfer ${record.transactionId}`
          }
        });
        ledgerMutated = true;
      }

      if (hasCreditEntry && !hasCompensatingCreditReversal) {
        this.#ledgerStore.append({
          domainUuid: data.targetDomainUuid,
          resourceId: data.resourceId,
          deltaMinor: -amountMinor,
          kind: "adjustment",
          transactionId: record.transactionId,
          source: {
            type: "recovery",
            reason: `Recovery compensation for failed transfer ${record.transactionId}`
          }
        });
        ledgerMutated = true;
      }

      if (ledgerMutated) {
        await this.#ledgerStore.flush();
      }

      return ok(undefined);
    });

    recoveryService.registerCompensator("economy:convert", async (record) => {
      const data = record.recoveryData as Record<string, any> | undefined;
      if (
        !data ||
        !data.domainUuid ||
        !data.fromResourceId ||
        !data.toResourceId ||
        !data.fromAmountMinor ||
        !data.toAmountMinor
      ) {
        return ok(undefined);
      }

      const cleanUuid = this.#cleanUuid(data.domainUuid);
      const docRes = await this.#domains.read(cleanUuid);
      if (!docRes.ok) return docRes;
      const doc = docRes.value;
      const econ = getDomainEconomyData(doc.record);

      const fromIndex = econ.accounts.findIndex((a) => a.resourceId === data.fromResourceId);
      const toIndex = econ.accounts.findIndex((a) => a.resourceId === data.toResourceId);
      if (fromIndex < 0 || toIndex < 0) return ok(undefined);

      const fromAcc = econ.accounts[fromIndex] as NativeResourceAccount;
      const toAcc = econ.accounts[toIndex] as NativeResourceAccount;

      // 1. Inspect ledger entries
      const txEntries = this.#ledgerStore.query({ transactionId: record.transactionId, domainUuid: data.domainUuid });
      const hasFromDebitEntry = txEntries.some((e) => e.kind === "conversion-debit" && e.resourceId === data.fromResourceId);
      const hasToCreditEntry = txEntries.some((e) => e.kind === "conversion-credit" && e.resourceId === data.toResourceId);
      const hasCompensatingFromReversal = txEntries.some(
        (e) => e.source?.type === "recovery" && e.resourceId === data.fromResourceId
      );
      const hasCompensatingToReversal = txEntries.some(
        (e) => e.source?.type === "recovery" && e.resourceId === data.toResourceId
      );

      // 2. Inspect balance states
      const fromInitialBalance: number =
        typeof data.fromInitialBalance === "number" ? data.fromInitialBalance : fromAcc.balanceMinor;
      const toInitialBalance: number =
        typeof data.toInitialBalance === "number" ? data.toInitialBalance : toAcc.balanceMinor;
      const fromAmountMinor: number = data.fromAmountMinor;
      const toAmountMinor: number = data.toAmountMinor;

      const fromIsDebited = fromAcc.balanceMinor === fromInitialBalance - fromAmountMinor;
      const toIsCredited = toAcc.balanceMinor === toInitialBalance + toAmountMinor;

      // Case A: Complete
      if (hasFromDebitEntry && hasToCreditEntry && fromIsDebited && toIsCredited) {
        if (this.#transactionStore) {
          this.#transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Reconciliation confirmed conversion completed cleanly"
          );
          await this.#transactionStore.flush();
        }
        return ok(undefined);
      }

      // Compensate balances
      let needsDomainUpdate = false;
      const updatedAccounts = [...econ.accounts];

      if (fromIsDebited) {
        updatedAccounts[fromIndex] = {
          ...fromAcc,
          balanceMinor: fromInitialBalance
        };
        needsDomainUpdate = true;
      }

      if (toIsCredited) {
        updatedAccounts[toIndex] = {
          ...toAcc,
          balanceMinor: toInitialBalance
        };
        needsDomainUpdate = true;
      }

      if (needsDomainUpdate) {
        const updatedRecord = withDomainEconomyData(doc.record, {
          ...econ,
          accounts: Object.freeze(updatedAccounts)
        });
        const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
        if (!updateRes.ok) return updateRes;
      }

      // Reconcile ledger: only compensate entries that were actually written
      let ledgerMutated = false;
      if (hasFromDebitEntry && !hasCompensatingFromReversal) {
        this.#ledgerStore.append({
          domainUuid: data.domainUuid,
          resourceId: data.fromResourceId,
          deltaMinor: fromAmountMinor,
          kind: "adjustment",
          transactionId: record.transactionId,
          source: {
            type: "recovery",
            reason: `Recovery compensation for failed conversion ${record.transactionId}`
          }
        });
        ledgerMutated = true;
      }

      if (hasToCreditEntry && !hasCompensatingToReversal) {
        this.#ledgerStore.append({
          domainUuid: data.domainUuid,
          resourceId: data.toResourceId,
          deltaMinor: -toAmountMinor,
          kind: "adjustment",
          transactionId: record.transactionId,
          source: {
            type: "recovery",
            reason: `Recovery compensation for failed conversion ${record.transactionId}`
          }
        });
        ledgerMutated = true;
      }

      if (ledgerMutated) {
        await this.#ledgerStore.flush();
      }

      return ok(undefined);
    });

    recoveryService.registerCompensator("economy:provider-adjust", async (record) => {
      const data = record.recoveryData as Record<string, any> | undefined;
      if (!data || !data.domainUuid || !data.resourceId || !data.deltaMinor) {
        return ok(undefined);
      }

      const txEntries = this.#ledgerStore.query({ transactionId: record.transactionId });
      const hasLedgerEntry = txEntries.length > 0;

      if (hasLedgerEntry) {
        if (this.#transactionStore) {
          this.#transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Reconciliation confirmed provider adjustment completed cleanly"
          );
          await this.#transactionStore.flush();
        }
        return ok(undefined);
      }

      // Revert provider balance mutation
      if (this.#providerRegistry && data.providerId) {
        const provider = this.#providerRegistry.get(data.providerId);
        if (provider && "mutateBalance" in provider && typeof (provider as any).mutateBalance === "function") {
          await (provider as any).mutateBalance(
            data.domainUuid,
            data.resourceId,
            data.providerRef ?? "",
            -data.deltaMinor,
            `Recovery compensation for aborted adjustment ${record.transactionId}`
          );
        }
      }

      return ok(undefined);
    });
  }
}
