import { ok } from "../core/contracts/result.js";
import { failure, isNamespaced, isRecord, isSafeInteger, isText } from "../core/validation/value-validation.js";
import { isJournalEntryUuid } from "../core/identity/refs.js";
import { lockKey } from "../mutations/lock-keys.js";
import type { EconomyService } from "../economy/services/economy-service.js";
import type { AgreementEffectOwner } from "./agreement-owner-operations.js";
import type { AdjustParams } from "../economy/services/economy-service.js";
export function createEconomyAgreementEffectOwner(economy: EconomyService): AgreementEffectOwner {
  return {
    id: "domain-manager:economy", subsystem: "economy",
    validate(op) {
      const p = op.payload;
      return op.operation === "economy:adjust" && isRecord(p) && isJournalEntryUuid(p.domainUuid) && isNamespaced(p.resourceId)
        && isSafeInteger(p.deltaMinor) && isText(p.reason) && op.targetRefs.length === 1
        && op.targetRefs[0].type === "domain" && op.targetRefs[0].uuid === p.domainUuid
        ? ok(undefined) : failure("DM_AGREEMENT_ECONOMY_EFFECT_INVALID", "Economic term requires a semantic adjustment and matching target Domain");
    },
    getLockKeys(op) { return [lockKey.domain(op.payload.domainUuid as string)]; },
    async execute(op, context) {
      const p = op.payload as unknown as AdjustParams;
      const result = await economy.commitAdjust({ domainUuid: p.domainUuid, resourceId: p.resourceId, deltaMinor: p.deltaMinor, reason: p.reason,
        commandId: context.commandId as AdjustParams["commandId"], authorityEpoch: context.authorityEpoch, lockOwner: context.commandId,
        idempotencyKey: context.operationRef, recoveryOwner: "parent" });
      return result.ok ? ok({ operationId: op.id, receiptRef: { type: "economy-operation", id: context.operationRef }, result: {
        balanceMinor: "balanceMinor" in result.value.account ? result.value.account.balanceMinor : null,
        entryId: result.value.entry?.id ?? null, isNoop: !!result.value.isNoop } }) : result;
    },
    async reconcile(op, context) {
      const p = op.payload as unknown as AdjustParams, account = await economy.getAccount(p.domainUuid, p.resourceId);
      if (!account.ok) return account;
      if (account.value?.mode === "provider") {
        const r = await economy.reconcileProviderAdjustment({ domainUuid: p.domainUuid, resourceId: p.resourceId, operationRef: context.operationRef });
        return r.ok ? ok(r.value.outcome === "fully-applied" ? "applied" : r.value.outcome === "not-applied" ? "not-applied" : "unknown") : r;
      }
      return economy.reconcileAdjustment({ domainUuid: p.domainUuid, resourceId: p.resourceId, operationRef: context.operationRef });
    },
    async compensate(op, context) {
      const p = op.payload as unknown as AdjustParams;
      return economy.compensateAdjustment({ domainUuid: p.domainUuid, resourceId: p.resourceId, originalDeltaMinor: p.deltaMinor!,
        originalOperationRef: context.operationRef, compensationOperationRef: `${context.operationRef}:compensation`, reason: "Agreement effect compensation",
        lockOwner: context.commandId });
    }
  };
}
