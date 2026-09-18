import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { ResourceDefinitionRegistry } from "../definitions/resource-registry.js";
import type { ResourceDefinition } from "../definitions/resource-definition-types.js";
import type { LedgerStore } from "../ledger/ledger-store.js";
import type { LedgerEntry, LedgerEntryKind, LedgerEntrySource } from "../ledger/ledger-types.js";
import type { ReservationStore } from "../reservations/reservation-store.js";
import type { Reservation, ReservationSource } from "../reservations/reservation-types.js";
import { LockManager } from "../../mutations/lock-manager.js";
import {
  type NativeResourceAccount,
  type ResourceAccount,
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

export interface EconomyServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly resourceRegistry: ResourceDefinitionRegistry;
  readonly ledgerStore: LedgerStore;
  readonly reservationStore: ReservationStore;
  readonly lockManager?: LockManager;
}

export interface CreateAccountParams {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly initialBalanceMinor?: number;
  readonly baseCapacityMinor?: number | null;
  readonly visibility?: ResourceVisibility;
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
}

export interface TransferParams {
  readonly sourceDomainUuid: string;
  readonly targetDomainUuid: string;
  readonly resourceId: string;
  readonly amountMinor: number;
  readonly reason?: string;
  readonly userId?: string;
}

export interface ConvertParams {
  readonly domainUuid: string;
  readonly fromResourceId: string;
  readonly toResourceId: string;
  readonly fromAmountMinor: number;
  readonly toAmountMinor: number;
  readonly rateDescription?: string;
  readonly reason?: string;
  readonly userId?: string;
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
}

export interface ReleaseReservationParams {
  readonly domainUuid: string;
  readonly reservationId: string;
  readonly amountMinor?: number;
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

  constructor(options: EconomyServiceOptions) {
    this.#domains = options.domains;
    this.#resourceRegistry = options.resourceRegistry;
    this.#ledgerStore = options.ledgerStore;
    this.#reservationStore = options.reservationStore;
    this.#lockManager = options.lockManager ?? new LockManager();
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
          account: NativeResourceAccount;
          balanceMinor: number;
          reservedMinor: number;
          availableMinor: number;
          effectiveCapacityMinor: number | null;
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
    if (!acc || acc.mode !== "native") {
      return ok(undefined);
    }

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

  async createAccount(
    params: CreateAccountParams
  ): Promise<Result<NativeResourceAccount, PublicError>> {
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

    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
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
      if (econData.accounts.some((a) => a.resourceId === params.resourceId)) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_ALREADY_EXISTS",
            category: "conflict",
            message: `Account for resource '${params.resourceId}' already exists in domain '${params.domainUuid}'`
          })
        );
      }

      const newAccount: NativeResourceAccount = {
        mode: "native",
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        balanceMinor: initialBalance,
        baseCapacityMinor: params.baseCapacityMinor ?? null,
        ...(params.visibility ? { visibility: params.visibility } : {})
      };

      const valRes = validateResourceAccount(newAccount);
      if (!valRes.ok) return valRes;

      const updatedEconData: DomainEconomyData = {
        ...econData,
        accounts: Object.freeze([...econData.accounts, valRes.value])
      };

      const updatedRecord = withDomainEconomyData(doc.record, updatedEconData);
      const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateRes.ok) return updateRes;

      // If initial balance > 0, generate opening-balance LedgerEntry (DEC-16810)
      if (initialBalance !== 0) {
        this.#ledgerStore.append({
          domainUuid: params.domainUuid,
          resourceId: params.resourceId,
          deltaMinor: initialBalance,
          kind: "opening-balance",
          source: {
            type: "account-creation",
            reason: params.reason ?? "Account initial opening balance",
            userId: params.userId
          }
        });
      }

      return ok(newAccount);
    } finally {
      await lockRes.value.release();
    }
  }

  async closeAccount(
    params: CloseAccountParams
  ): Promise<Result<{ success: boolean }, PublicError>> {
    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
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

      const updatedAccounts = econData.accounts.filter((a) => a.resourceId !== params.resourceId);
      const updatedEconData: DomainEconomyData = {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      };

      const updatedRecord = withDomainEconomyData(doc.record, updatedEconData);
      const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateRes.ok) return updateRes;

      return ok({ success: true });
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
  ): Promise<Result<{ account: NativeResourceAccount; entry: LedgerEntry }, PublicError>> {
    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `adjust:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;

    try {
      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;

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

      const econData = getDomainEconomyData(doc.record);
      const accIndex = econData.accounts.findIndex((a) => a.resourceId === params.resourceId);
      if (accIndex < 0 || econData.accounts[accIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Native account for resource '${params.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }

      const existingAccount = econData.accounts[accIndex] as NativeResourceAccount;
      const effectiveCap = resolveEffectiveCapacity(existingAccount.baseCapacityMinor, [], def);

      const plan = buildAdjustPlan({
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        deltaMinor: params.deltaMinor,
        targetBalanceMinor: params.targetBalanceMinor,
        reason: params.reason,
        userId: params.userId,
        account: existingAccount,
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

      if (!entryRes.ok) return entryRes;

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

      // Write both domains
      const updateSrcRes = await this.#domains.update({ ...srcDoc, record: updatedSrcRecord });
      if (!updateSrcRes.ok) return updateSrcRes;

      const updateTgtRes = await this.#domains.update({ ...tgtDoc, record: updatedTgtRecord });
      if (!updateTgtRes.ok) return updateTgtRes;

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
      if (!debitEntryRes.ok) return debitEntryRes;

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
      if (!creditEntryRes.ok) return creditEntryRes;

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
      if (!updateRes.ok) return updateRes;

      const debitEntryRes = this.#ledgerStore.append({
        domainUuid: params.domainUuid,
        resourceId: params.fromResourceId,
        deltaMinor: -params.fromAmountMinor,
        kind: "conversion-debit",
        transactionId,
        source: {
          type: "conversion",
          ref: `converted_to:${params.toResourceId}`,
          reason: params.reason ?? params.rateDescription,
          userId: params.userId
        }
      });
      if (!debitEntryRes.ok) return debitEntryRes;

      const creditEntryRes = this.#ledgerStore.append({
        domainUuid: params.domainUuid,
        resourceId: params.toResourceId,
        deltaMinor: params.toAmountMinor,
        kind: "conversion-credit",
        transactionId,
        source: {
          type: "conversion",
          ref: `converted_from:${params.fromResourceId}`,
          reason: params.reason ?? params.rateDescription,
          userId: params.userId
        }
      });
      if (!creditEntryRes.ok) return creditEntryRes;

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
      return this.#reservationStore.create({
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        originalAmountMinor: params.amountMinor,
        source: params.source,
        expiresAtWorld: params.expiresAtWorld,
        expiresAtReal: params.expiresAtReal
      });
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
    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `consume-reservation:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;

    try {
      const consumeRes = this.#reservationStore.consume(params.reservationId, params.amountMinor);
      if (!consumeRes.ok) return consumeRes;
      const { reservation, consumedAmount } = consumeRes.value;

      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;

      const econData = getDomainEconomyData(doc.record);
      const accIndex = econData.accounts.findIndex((a) => a.resourceId === reservation.resourceId);
      if (accIndex < 0 || econData.accounts[accIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Account '${reservation.resourceId}' not found for consuming reservation`
          })
        );
      }

      const existingAccount = econData.accounts[accIndex] as NativeResourceAccount;
      const updatedAccount: NativeResourceAccount = {
        ...existingAccount,
        balanceMinor: existingAccount.balanceMinor - consumedAmount
      };

      const updatedAccounts = [...econData.accounts];
      updatedAccounts[accIndex] = updatedAccount;

      const updatedRecord = withDomainEconomyData(doc.record, {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      });

      const updateDocRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateDocRes.ok) return updateDocRes;

      // Append consumption entry to ledger referencing reservationId (DEC-17072–17073)
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
      if (!entryRes.ok) return entryRes;

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
    // Release does NOT alter balance, does NOT create LedgerEntry (DEC-17082–17087)
    return this.#reservationStore.release(params.reservationId, params.amountMinor);
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
            message: `Native account for resource '${originalEntry.resourceId}' not found`
          })
        );
      }

      const existingAccount = econData.accounts[accIndex] as NativeResourceAccount;

      // createReversal enforces anti-double reversal and rejects reversing a reversal (DEC-17198–17207)
      const reversalRes = this.#ledgerStore.createReversal(
        params.entryId,
        params.reason,
        params.userId
      );
      if (!reversalRes.ok) return reversalRes;
      const reversalEntry = reversalRes.value;

      const newBalance = existingAccount.balanceMinor + reversalEntry.deltaMinor;
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

      return ok({
        reversalEntry,
        account: updatedAccount
      });
    } finally {
      await lockRes.value.release();
    }
  }

  #cleanUuid(uuid: string): string {
    return uuid.startsWith("JournalEntry.") ? uuid.slice("JournalEntry.".length) : uuid;
  }
}
