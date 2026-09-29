import { err, ok, type Result } from "../core/contracts/result.js";
import { createPublicError } from "../core/contracts/public-error.js";
import type { TypedRef } from "../core/identity/refs.js";
import { failure, immutable, isJsonData, isNamespaced, isText, isTypedRef } from "../core/validation/value-validation.js";
import { assertNoForbiddenLockKeys } from "../mutations/lock-keys.js";
import { canonicalizeLockKeys } from "../mutations/lock-manager.js";
import type { CompositeMutationSession } from "../mutations/composite-mutation-session.js";
import type { RecoveryStepSubsystem } from "../mutations/recovery-step.js";
import type { AgreementOwnerOperation } from "./agreement-obligations.js";

export interface AgreementEffectReceipt { readonly operationId: string; readonly receiptRef: TypedRef; readonly result: unknown; }
export interface AgreementEffectExecutionContext {
  readonly commandId: string; readonly authorityEpoch: number; readonly idempotencyKey: string; readonly operationRef: string;
}
/** Effect adapters call semantic owner APIs, never another owner's flags/balances. */
export interface AgreementEffectOwner {
  readonly id: string; readonly subsystem: RecoveryStepSubsystem;
  validate(operation: AgreementOwnerOperation): Result<void>;
  getLockKeys(operation: AgreementOwnerOperation): readonly string[];
  execute(operation: AgreementOwnerOperation, context: AgreementEffectExecutionContext): Promise<Result<AgreementEffectReceipt>>;
  reconcile(operation: AgreementOwnerOperation, context: AgreementEffectExecutionContext): Promise<Result<"applied" | "not-applied" | "unknown">>;
  compensate(operation: AgreementOwnerOperation, context: AgreementEffectExecutionContext): Promise<Result<unknown>>;
}
export class AgreementEffectOwnerRegistry {
  readonly #owners = new Map<string, AgreementEffectOwner>(); #frozen = false;
  register(owner: AgreementEffectOwner): Result<void> {
    if (this.#frozen || this.#owners.has(owner.id)) return failure("DM_AGREEMENT_OWNER_REGISTRY_CONFLICT", "Owner registry frozen or duplicate ID", "conflict");
    if (!isNamespaced(owner.id) || ![owner.validate, owner.getLockKeys, owner.execute, owner.reconcile, owner.compensate].every(x => typeof x === "function"))
      return failure("DM_AGREEMENT_OWNER_INVALID", "Owner requires validation, locks, execution and recovery contracts");
    this.#owners.set(owner.id, owner); return ok(undefined);
  }
  get(id: string): AgreementEffectOwner | undefined { return this.#owners.get(id); }
  freeze(): void { this.#frozen = true; }
}
export interface AgreementOwnerOperationPlan { readonly operations: readonly AgreementOwnerOperation[]; readonly lockKeys: readonly string[]; }
export function prepareAgreementOwnerOperations(operations: readonly AgreementOwnerOperation[], owners: AgreementEffectOwnerRegistry): Result<AgreementOwnerOperationPlan> {
  if (!isJsonData(operations)) return failure("DM_AGREEMENT_OWNER_OPERATION_INVALID", "Owner intents must be JSON data");
  const ids = new Set<string>(), locks: string[] = [];
  for (const op of operations) {
    if (!isText(op.id) || ids.has(op.id) || !isNamespaced(op.ownerId) || !isNamespaced(op.operation))
      return failure("DM_AGREEMENT_OWNER_OPERATION_INVALID", "Owner operation IDs must be unique and types namespaced");
    const owner = owners.get(op.ownerId); if (!owner) return failure("DM_AGREEMENT_OWNER_UNAVAILABLE", "Required effect owner unavailable", "not-found");
    const valid = owner.validate(op); if (!valid.ok) return valid;
    const keys = owner.getLockKeys(op); if (!keys.length || !keys.every(isText)) return failure("DM_AGREEMENT_OWNER_LOCK_INVALID", "Effect owner must declare its canonical write locks");
    const forbidden = assertNoForbiddenLockKeys(keys); if (!forbidden.ok) return forbidden;
    ids.add(op.id); locks.push(...keys);
  }
  return ok(immutable(structuredClone({ operations, lockKeys: canonicalizeLockKeys(locks) })));
}
/** A prepared, durable session writes each child intent before invoking the owner. */
export async function executeAgreementOwnerOperations(plan: AgreementOwnerOperationPlan, owners: AgreementEffectOwnerRegistry,
  session: CompositeMutationSession): Promise<Result<readonly AgreementEffectReceipt[]>> {
  const prepared = prepareAgreementOwnerOperations(plan.operations, owners); if (!prepared.ok) return prepared;
  if (prepared.value.lockKeys.some(k => !session.lockKeys.includes(k))) return failure("DM_AGREEMENT_OWNER_LOCK_INVALID", "Parent session does not hold all owner locks", "conflict");
  const receipts: AgreementEffectReceipt[] = [];
  for (const op of prepared.value.operations) {
    const owner = owners.get(op.ownerId)!, operationRef = `${session.transactionId}:agreement-effect:${op.id}`;
    const receipt = await session.runChildStep({ stepId: `agreement-effect:${op.id}`, subsystem: owner.subsystem,
      operation: op.operation, intent: op, operationRef, idempotencyKey: operationRef,
      execute: async () => {
        const result = await owner.execute(op, { commandId: session.commandId, authorityEpoch: session.authorityEpoch,
          idempotencyKey: operationRef, operationRef });
        if (!result.ok) return result;
        if (result.value.operationId !== op.id || !isTypedRef(result.value.receiptRef) || !isJsonData(result.value))
          return err(createPublicError({ code: "DM_AGREEMENT_OWNER_RECEIPT_INVALID", category: "internal",
            message: "Owner returned a mismatched or non-serializable receipt", details: { outcome: "unknown" } }));
        return result;
      } });
    if (!receipt.ok) return receipt;
    receipts.push(receipt.value);
  }
  return ok(immutable(structuredClone(receipts)));
}
