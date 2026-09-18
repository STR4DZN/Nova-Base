import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { LedgerIntent } from "../ledger/ledger-types.js";
import type { NativeResourceAccount, ResourceAccount } from "../accounts/account-types.js";
import type { ResourceDefinition } from "../definitions/resource-definition-types.js";
import { evaluateCapacity } from "../accounts/capacity-resolver.js";
import { createOpaqueId } from "../../core/identity/ids.js";

export interface ReservationEffect {
  readonly action: "create" | "consume" | "release" | "expire";
  readonly reservationId?: string;
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly amountMinor: number;
  readonly reason?: string;
}

export type EconomyPlanType =
  | "adjust"
  | "transfer"
  | "convert"
  | "reserve"
  | "consume-reservation"
  | "release-reservation"
  | "create-account"
  | "close-account";

export interface EconomyPlan {
  readonly planId: string;
  readonly planType: EconomyPlanType;
  /**
   * Deterministically sorted domain UUIDs for deadlock-free multi-locking (DEC-603–620, DEC-17227).
   */
  readonly domainUuids: readonly string[];
  readonly ledgerIntents: readonly LedgerIntent[];
  readonly reservationEffects: readonly ReservationEffect[];
  readonly warnings: readonly string[];
  readonly blockers: readonly PublicError[];
  readonly isExecutable: boolean;
  readonly createdAt: string;
}

export interface BuildAdjustPlanParams {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly deltaMinor?: number;
  readonly targetBalanceMinor?: number;
  readonly reason: string;
  readonly userId?: string;
  readonly account?: NativeResourceAccount;
  readonly definition: ResourceDefinition;
  readonly effectiveCapacityMinor: number | null;
}

export function buildAdjustPlan(params: BuildAdjustPlanParams): EconomyPlan {
  const warnings: string[] = [];
  const blockers: PublicError[] = [];
  const domainUuids = Object.freeze([params.domainUuid]);

  // Manual adjust requires a non-empty reason (DEC-16875, DEC-17190)
  if (!params.reason || params.reason.trim().length === 0) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_ADJUST_REASON_REQUIRED",
        category: "validation",
        message: "Manual adjustment strictly requires a non-empty reason"
      })
    );
  }

  const currentBalance = params.account ? params.account.balanceMinor : 0;
  let deltaMinor: number;

  if (params.deltaMinor !== undefined) {
    deltaMinor = params.deltaMinor;
  } else if (params.targetBalanceMinor !== undefined) {
    deltaMinor = params.targetBalanceMinor - currentBalance;
  } else {
    blockers.push(
      createPublicError({
        code: "DM_ECON_ADJUST_INVALID",
        category: "validation",
        message: "Adjust requires either deltaMinor or targetBalanceMinor"
      })
    );
    deltaMinor = 0;
  }

  if (!Number.isSafeInteger(deltaMinor)) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `Adjustment delta must be a safe integer: received '${String(deltaMinor)}'`
      })
    );
  }

  // No-op does not produce ledger entries (DEC-16873)
  if (deltaMinor === 0 && blockers.length === 0) {
    warnings.push("Adjustment delta is zero: operation is a no-op");
  }

  const proposedBalance = currentBalance + deltaMinor;
  if (!Number.isSafeInteger(proposedBalance)) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_AMOUNT_OVERFLOW",
        category: "validation",
        message: `Proposed balance ${proposedBalance} overflows safe integer limits`
      })
    );
  }

  // Capacity & bounds check
  const capEval = evaluateCapacity(
    proposedBalance,
    params.effectiveCapacityMinor,
    params.definition.defaultCapacityPolicy,
    params.definition
  );

  if (!capEval.allowed && capEval.error) {
    blockers.push(capEval.error);
  }
  if (capEval.warning) {
    warnings.push(capEval.warning);
  }

  const ledgerIntents: LedgerIntent[] = [];
  if (deltaMinor !== 0 && blockers.length === 0) {
    ledgerIntents.push({
      domainUuid: params.domainUuid,
      resourceId: params.resourceId,
      deltaMinor,
      kind: "adjustment",
      source: {
        type: "manual",
        reason: params.reason.trim(),
        userId: params.userId
      }
    });
  }

  return {
    planId: createOpaqueId("plan"),
    planType: "adjust",
    domainUuids,
    ledgerIntents: Object.freeze(ledgerIntents),
    reservationEffects: Object.freeze([]),
    warnings: Object.freeze(warnings),
    blockers: Object.freeze(blockers),
    isExecutable: blockers.length === 0 && deltaMinor !== 0,
    createdAt: new Date().toISOString()
  };
}

export interface BuildTransferPlanParams {
  readonly sourceDomainUuid: string;
  readonly targetDomainUuid: string;
  readonly resourceId: string;
  readonly amountMinor: number;
  readonly reason?: string;
  readonly userId?: string;
  readonly sourceAccount?: NativeResourceAccount;
  readonly sourceReservedMinor?: number;
  readonly targetAccount?: NativeResourceAccount;
  readonly definition: ResourceDefinition;
  readonly targetCapacityMinor: number | null;
}

export function buildTransferPlan(params: BuildTransferPlanParams): EconomyPlan {
  const warnings: string[] = [];
  const blockers: PublicError[] = [];

  // Deterministic lock ordering: sort domains lexicographically (DEC-603–620, DEC-17227)
  const domainUuids = Object.freeze(
    [params.sourceDomainUuid, params.targetDomainUuid].sort((a, b) => a.localeCompare(b))
  );

  if (params.sourceDomainUuid === params.targetDomainUuid) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_TRANSFER_SAME_DOMAIN",
        category: "validation",
        message: "Transfer source and target domain cannot be the same"
      })
    );
  }

  if (
    typeof params.amountMinor !== "number" ||
    !Number.isSafeInteger(params.amountMinor) ||
    params.amountMinor <= 0
  ) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `Transfer amount must be a positive safe integer: received '${String(params.amountMinor)}'`
      })
    );
  }

  const sourceBalance = params.sourceAccount?.balanceMinor ?? 0;
  const sourceReserved = params.sourceReservedMinor ?? 0;
  const sourceAvailable = sourceBalance - sourceReserved;

  if (params.amountMinor > sourceAvailable) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_INSUFFICIENT_AVAILABLE",
        category: "validation",
        message: `Insufficient available funds for transfer: available is ${sourceAvailable}, requested ${params.amountMinor}`
      })
    );
  }

  const targetBalance = params.targetAccount?.balanceMinor ?? 0;
  const proposedTargetBalance = targetBalance + params.amountMinor;

  const capEval = evaluateCapacity(
    proposedTargetBalance,
    params.targetCapacityMinor,
    params.definition.defaultCapacityPolicy,
    params.definition
  );

  if (!capEval.allowed && capEval.error) {
    blockers.push(capEval.error);
  }
  if (capEval.warning) {
    warnings.push(capEval.warning);
  }

  const ledgerIntents: LedgerIntent[] = [];
  if (blockers.length === 0) {
    // Mass conservation invariant (DEC-17211–17222): exactly equal and opposing delta
    ledgerIntents.push({
      domainUuid: params.sourceDomainUuid,
      resourceId: params.resourceId,
      deltaMinor: -params.amountMinor,
      kind: "transfer-debit",
      source: {
        type: "transfer",
        ref: `transfer_to:${params.targetDomainUuid}`,
        reason: params.reason,
        userId: params.userId
      }
    });

    ledgerIntents.push({
      domainUuid: params.targetDomainUuid,
      resourceId: params.resourceId,
      deltaMinor: params.amountMinor,
      kind: "transfer-credit",
      source: {
        type: "transfer",
        ref: `transfer_from:${params.sourceDomainUuid}`,
        reason: params.reason,
        userId: params.userId
      }
    });
  }

  return {
    planId: createOpaqueId("plan"),
    planType: "transfer",
    domainUuids,
    ledgerIntents: Object.freeze(ledgerIntents),
    reservationEffects: Object.freeze([]),
    warnings: Object.freeze(warnings),
    blockers: Object.freeze(blockers),
    isExecutable: blockers.length === 0,
    createdAt: new Date().toISOString()
  };
}

export interface BuildConvertPlanParams {
  readonly domainUuid: string;
  readonly fromResourceId: string;
  readonly toResourceId: string;
  readonly fromAmountMinor: number;
  readonly toAmountMinor: number;
  readonly rateDescription?: string;
  readonly reason?: string;
  readonly userId?: string;
  readonly fromAccount?: NativeResourceAccount;
  readonly fromReservedMinor?: number;
  readonly toAccount?: NativeResourceAccount;
  readonly fromDefinition: ResourceDefinition;
  readonly toDefinition: ResourceDefinition;
  readonly toCapacityMinor: number | null;
}

export function buildConvertPlan(params: BuildConvertPlanParams): EconomyPlan {
  const warnings: string[] = [];
  const blockers: PublicError[] = [];
  const domainUuids = Object.freeze([params.domainUuid]);

  if (params.fromResourceId === params.toResourceId) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_CONVERT_SAME_RESOURCE",
        category: "validation",
        message: "Conversion source and target resource cannot be the same"
      })
    );
  }

  if (
    typeof params.fromAmountMinor !== "number" ||
    !Number.isSafeInteger(params.fromAmountMinor) ||
    params.fromAmountMinor <= 0
  ) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `fromAmountMinor must be a positive safe integer: received '${String(params.fromAmountMinor)}'`
      })
    );
  }

  if (
    typeof params.toAmountMinor !== "number" ||
    !Number.isSafeInteger(params.toAmountMinor) ||
    params.toAmountMinor <= 0
  ) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `toAmountMinor must be a positive safe integer: received '${String(params.toAmountMinor)}'`
      })
    );
  }

  const fromBalance = params.fromAccount?.balanceMinor ?? 0;
  const fromReserved = params.fromReservedMinor ?? 0;
  const fromAvailable = fromBalance - fromReserved;

  if (params.fromAmountMinor > fromAvailable) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_INSUFFICIENT_AVAILABLE",
        category: "validation",
        message: `Insufficient available funds for conversion: available is ${fromAvailable}, required ${params.fromAmountMinor}`
      })
    );
  }

  const toBalance = params.toAccount?.balanceMinor ?? 0;
  const proposedToBalance = toBalance + params.toAmountMinor;

  const capEval = evaluateCapacity(
    proposedToBalance,
    params.toCapacityMinor,
    params.toDefinition.defaultCapacityPolicy,
    params.toDefinition
  );

  if (!capEval.allowed && capEval.error) {
    blockers.push(capEval.error);
  }
  if (capEval.warning) {
    warnings.push(capEval.warning);
  }

  const ledgerIntents: LedgerIntent[] = [];
  if (blockers.length === 0) {
    ledgerIntents.push({
      domainUuid: params.domainUuid,
      resourceId: params.fromResourceId,
      deltaMinor: -params.fromAmountMinor,
      kind: "conversion-debit",
      source: {
        type: "conversion",
        ref: `converted_to:${params.toResourceId}`,
        reason: params.reason ?? params.rateDescription,
        userId: params.userId
      }
    });

    ledgerIntents.push({
      domainUuid: params.domainUuid,
      resourceId: params.toResourceId,
      deltaMinor: params.toAmountMinor,
      kind: "conversion-credit",
      source: {
        type: "conversion",
        ref: `converted_from:${params.fromResourceId}`,
        reason: params.reason ?? params.rateDescription,
        userId: params.userId
      }
    });
  }

  return {
    planId: createOpaqueId("plan"),
    planType: "convert",
    domainUuids,
    ledgerIntents: Object.freeze(ledgerIntents),
    reservationEffects: Object.freeze([]),
    warnings: Object.freeze(warnings),
    blockers: Object.freeze(blockers),
    isExecutable: blockers.length === 0,
    createdAt: new Date().toISOString()
  };
}
