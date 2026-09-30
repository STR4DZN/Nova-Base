import { err, ok, type Result } from "../core/contracts/result.js";
import { createPublicError } from "../core/contracts/public-error.js";
import { canonicalJsonStringify } from "../commands/command-dedupe-store.js";
import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { MutationCoordinator, MutationDefinition, FreshStateWithRevision } from "../mutations/mutation-coordinator.js";
import { createMutationPlan } from "../mutations/plans/plan-contract.js";
import { CompositeMutationSession } from "../mutations/composite-mutation-session.js";
import type { TransactionStore } from "../mutations/transaction-store.js";
import type { RecoveryService } from "../mutations/recovery-service.js";
import type { RecoveryStep } from "../mutations/recovery-step.js";
import { lockKey } from "../mutations/lock-keys.js";
import { failure, isRecord } from "../core/validation/value-validation.js";
import { assertDiplomacyEntity, diplomacyFingerprint, type DiplomacyEntity, type DiplomacyEntityStore, type DiplomacyKind } from "./diplomacy-store.js";
import { prepareAgreementOwnerOperations, executeAgreementOwnerOperations, type AgreementEffectOwnerRegistry, type AgreementOwnerOperationPlan } from "../agreements/agreement-owner-operations.js";
import type { AgreementOwnerOperation } from "../agreements/agreement-obligations.js";
export interface DiplomacyWrite { readonly before: DiplomacyEntity | null; readonly after: DiplomacyEntity; }
export interface DiplomacyMutationOptions {
  readonly store: DiplomacyEntityStore; readonly coordinator: MutationCoordinator; readonly transactions: TransactionStore;
  readonly recovery: RecoveryService; readonly effectOwners: AgreementEffectOwnerRegistry;
}
export interface DiplomacyMutationPayload { readonly id: string; readonly expectedRevision?: number; readonly reason: string; }
export interface DiplomacyFresh extends FreshStateWithRevision {
  readonly entity: DiplomacyEntity | null; readonly context: AuthenticatedCommandContext<any>;
}
export interface DiplomacyPreparedWrite {
  readonly writes: readonly DiplomacyWrite[]; readonly effects: readonly AgreementOwnerOperation[]; readonly result: unknown;
}
export interface DiplomacyDurablePlan extends DiplomacyPreparedWrite {
  readonly authorityEpoch: number; readonly effectsPlan: AgreementOwnerOperationPlan; readonly fingerprint: string;
}
/** Pure owner plans feed the existing transaction kernel; no business state lives in this helper. */
export function diplomacyMutationDefinition(kind: DiplomacyKind, o: DiplomacyMutationOptions,
  getLocks: (ctx: AuthenticatedCommandContext<any>) => readonly string[],
  prepare: (fresh: DiplomacyFresh) => Promise<Result<DiplomacyPreparedWrite>>): MutationDefinition<any, unknown, DiplomacyFresh> {
  return {
    getLockKeys: getLocks,
    async freshRead(context) {
      try { const entity = await o.store.freshRead(kind, context.command.payload.id);
        return ok({ entity, revision: entity?.revision ?? 0, context }); }
      catch { return storageError(); }
    },
    async buildPlan(ctx, fresh) {
      const fingerprint = diplomacyFingerprint(ctx.command.type, ctx.command.payload), prior = fresh.entity?.receipts.find(r => r.commandId === ctx.command.commandId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) return failure("DM_COMMAND_ID_CONFLICT", "Command ID already has a different durable payload", "conflict");
        return ok(createMutationPlan({ commandId: ctx.command.commandId, lockKeys: getLocks(ctx), writeSet: [],
          customData: { writes: [], effects: [], effectsPlan: { operations: [], lockKeys: [] }, result: prior.result ?? { kind, id: fresh.entity!.id, revision: prior.revision, changed: prior.changed }, authorityEpoch: ctx.authorityEpoch, fingerprint } }));
      }
      const built = await prepare(fresh); if (!built.ok) return built;
      const effectsPlan = prepareAgreementOwnerOperations(built.value.effects, o.effectOwners); if (!effectsPlan.ok) return effectsPlan;
      const locks = getLocks(ctx);
      if (effectsPlan.value.lockKeys.some(k => !locks.includes(k))) return failure("DM_TX_LOCKSET_DIVERGENCE", "Effect targets changed during preparation", "conflict");
      const writes = built.value.writes.map(w => ({ before: w.before, after: { ...w.after,
        receipts: [...w.after.receipts, { commandId: ctx.command.commandId, fingerprint, revision: w.after.revision,
          changed: w.before === null || w.before.revision !== w.after.revision, result: built.value.result }] } }));
      return ok(createMutationPlan({ commandId: ctx.command.commandId, lockKeys: locks,
        writeSet: writes.map(w => ({ targetRef: lockKey.diplomacy(w.after.kind, w.after.id), operationType: w.before ? "update" : "create", payload: w.after })),
        customData: { ...built.value, writes, effectsPlan: effectsPlan.value, authorityEpoch: ctx.authorityEpoch, fingerprint } }));
    },
    async commit(plan) {
      const data = plan.customData as DiplomacyDurablePlan;
      if (!data.writes.length) return ok({ result: data.result, changed: false, resultingRevisions: {} });
      const prepared = await CompositeMutationSession.prepare({ commandId: plan.commandId, authorityEpoch: data.authorityEpoch,
        lockKeys: plan.lockKeys, expectedLockKeys: plan.lockKeys, transactionStore: o.transactions, recoveryService: o.recovery,
        recoveryType: "diplomacy:write", parentRef: plan.writeSet[0].targetRef, safeAutoRecovery: true,
        initialRecoveryData: { writes: data.writes, effects: data.effects, fingerprint: data.fingerprint, result: data.result } });
      if (!prepared.ok) return prepared;
      const session = prepared.value;
      const entering = await session.enterCommitting(); if (!entering.ok) return session.failAndCompensate(entering.error);
      const effects = await executeAgreementOwnerOperations(data.effectsPlan, o.effectOwners, session);
      if (!effects.ok) return session.failAndCompensate(effects.error);
      for (const w of data.writes) {
        const saved = await session.runChildStep({ stepId: `entity:${w.after.kind}:${w.after.id}`, subsystem: "custom", operation: "diplomacy:save",
          targetRef: lockKey.diplomacy(w.after.kind, w.after.id), intent: w,
          execute: async () => { try { await o.store.stage(w.after); return ok({ kind: w.after.kind, id: w.after.id, revision: w.after.revision }); }
            catch { return storageError(); } } });
        if (!saved.ok) return session.failAndCompensate(saved.error);
      }
      const done = await session.commitDurably(data.result); if (!done.ok) return done;
      for (const w of data.writes) o.store.publish(w.after);
      return ok({ result: done.value, changed: data.writes.some(w => !w.before || w.before.revision !== w.after.revision),
        resultingRevisions: Object.fromEntries(data.writes.map(w => [lockKey.diplomacy(w.after.kind, w.after.id), w.after.revision])) });
    }
  };
}
export function storageError(): Result<never> { return err(createPublicError({ code: "DM_DIPLOMACY_STORAGE_ERROR", category: "internal",
  message: "Diplomacy persistence could not be confirmed", details: { outcome: "unknown" } })); }
/** Reconcile before-images/after-images, then finish the approved durable plan exactly once.
 * Divergent state never gets overwritten. RecoveryService explicitly supports committed reconciliation. */
export function registerDiplomacyRecovery(o: DiplomacyMutationOptions): void {
  o.recovery.registerCompensator("diplomacy:write", async record => {
    const data = record.recoveryData;
    if (!isRecord(data) || !Array.isArray(data.writes) || !Array.isArray(data.effects)) return failure("DM_RECOVERY_RECONCILIATION_UNCERTAIN", "Durable diplomacy intent unavailable", "conflict");
    const writes = data.writes as readonly DiplomacyWrite[];
    try {
      for (const w of writes) {
        assertDiplomacyEntity(w.after); if (w.before !== null) assertDiplomacyEntity(w.before);
        if (!record.lockKeys.includes(lockKey.diplomacy(w.after.kind, w.after.id))
          || w.before && (w.before.kind !== w.after.kind || w.before.id !== w.after.id || w.after.revision < w.before.revision))
          return failure("DM_RECOVERY_RECONCILIATION_UNCERTAIN", "Invalid durable write identity or locks", "conflict");
        const current = await o.store.adapter.read(w.after.kind, w.after.id);
        if (canonicalJsonStringify(current) !== canonicalJsonStringify(w.before) && canonicalJsonStringify(current) !== canonicalJsonStringify(w.after))
          return failure("DM_RECOVERY_RECONCILIATION_UNCERTAIN", "Diplomacy state diverges from recorded durable intent", "conflict");
      }
      const effectPlan = prepareAgreementOwnerOperations(data.effects as readonly AgreementOwnerOperation[], o.effectOwners);
      if (!effectPlan.ok) return effectPlan;
      if (effectPlan.value.lockKeys.some(k => !record.lockKeys.includes(k))) return failure("DM_TX_LOCKSET_DIVERGENCE", "Recovery effect lacks recorded locks", "conflict");
      for (const op of effectPlan.value.operations) {
        const owner = o.effectOwners.get(op.ownerId); if (!owner) return failure("DM_AGREEMENT_OWNER_UNAVAILABLE", "Effect owner unavailable during recovery", "not-found");
        const operationRef = `${record.transactionId}:agreement-effect:${op.id}`, context = { commandId: record.commandId, authorityEpoch: record.authorityEpoch,
          idempotencyKey: operationRef, operationRef };
        const r = await owner.reconcile(op, context); if (!r.ok) return r;
        if (r.value === "unknown") return failure("DM_RECOVERY_RECONCILIATION_UNCERTAIN", "Agreement owner outcome is unknown", "conflict");
        let receipt: unknown = { operationId: op.id, operationRef, reconciled: "applied" };
        if (r.value === "not-applied") {
          const intent = await o.transactions.patchDurable(record.transactionId, current => ({ ...current, recoveryData: { ...current.recoveryData!,
            steps: [...((current.recoveryData as { steps?: readonly RecoveryStep[] })?.steps ?? []).filter(s => s.stepId !== `agreement-effect:${op.id}`),
              { stepId: `agreement-effect:${op.id}`, subsystem: owner.subsystem, operation: op.operation, idempotencyKey: operationRef,
                operationRef, state: "executing", intent: op }] } })); if (!intent.ok) return intent;
          const execute = await owner.execute(op, { ...context, commandId: `recovery_${record.transactionId}` }); if (!execute.ok) return execute;
          receipt = execute.value;
        }
        const confirmed = await o.transactions.patchDurable(record.transactionId, current => ({ ...current, recoveryData: { ...current.recoveryData!,
          steps: [...((current.recoveryData as { steps?: readonly RecoveryStep[] })?.steps ?? []).filter(s => s.stepId !== `agreement-effect:${op.id}`),
            { stepId: `agreement-effect:${op.id}`, subsystem: owner.subsystem, operation: op.operation, idempotencyKey: operationRef,
              operationRef, state: "applied", intent: op, receipt }] } })); if (!confirmed.ok) return confirmed;
      }
      for (const w of writes) {
        const current = await o.store.adapter.read(w.after.kind, w.after.id);
        if (canonicalJsonStringify(current) !== canonicalJsonStringify(w.after)) await o.store.stage(w.after);
      }
      const committed = await o.transactions.transitionDurable(record.transactionId, "committed", record.authorityEpoch, "Reconciled diplomacy plan and owner receipts");
      if (!committed.ok) return committed;
      for (const w of writes) o.store.publish(w.after);
      return ok(undefined);
    } catch { return storageError(); }
  });
}
