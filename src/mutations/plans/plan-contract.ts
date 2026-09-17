import type { CommandId } from "../../commands/command-envelope.js";
import { computeFingerprint } from "../../commands/command-dedupe-store.js";

export type PlanOperationType = "create" | "update" | "delete" | "archive" | "restore" | "reparent";

export interface PlanWriteOperation {
  readonly targetRef: string;
  readonly operationType: PlanOperationType;
  readonly payload?: unknown;
  readonly expectedRevision?: number;
}

/**
 * Normative Mutation Plan contract (Master Spec §11.6, DEC-627–634, DEC-641–648).
 *
 * Produced by services prior to stateful commit.
 */
export interface MutationPlan<TData = unknown> {
  readonly commandId: CommandId;
  readonly planId: string;
  readonly fingerprint: string;
  readonly lockKeys: readonly string[];
  readonly writeSet: readonly PlanWriteOperation[];
  readonly expectedRevisions: Readonly<Record<string, number>>;
  readonly readSetRevisions?: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
  readonly isExecutable: boolean;
  readonly summary?: string;
  readonly customData?: TData;
  readonly createdAt: number;
}

/**
 * Publicly safe preview of a mutation plan.
 *
 * Strips internal write sets, recovery data, and sensitive flags.
 */
export interface PublicPlanPreview {
  readonly commandId: CommandId;
  readonly planId: string;
  readonly fingerprint: string;
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
  readonly isExecutable: boolean;
  readonly summary?: string;
  readonly createdAt: number;
}

export interface CreateMutationPlanParams<TData = unknown> {
  readonly commandId: CommandId;
  readonly planId?: string;
  readonly lockKeys: readonly string[];
  readonly writeSet: readonly PlanWriteOperation[];
  readonly expectedRevisions?: Record<string, number>;
  readonly readSetRevisions?: Record<string, number>;
  readonly warnings?: readonly string[];
  readonly blockers?: readonly string[];
  readonly summary?: string;
  readonly customData?: TData;
  readonly now?: number;
}

function deepCloneAndFreeze<T>(val: T): T {
  if (val === null || typeof val !== "object") {
    return val;
  }
  if (Array.isArray(val)) {
    const arr = val.map((item) => deepCloneAndFreeze(item));
    return Object.freeze(arr) as unknown as T;
  }
  const cloned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    cloned[k] = deepCloneAndFreeze(v);
  }
  return Object.freeze(cloned) as unknown as T;
}

export function createMutationPlan<TData = unknown>(
  params: CreateMutationPlanParams<TData>
): MutationPlan<TData> {
  const now = params.now ?? Date.now();
  const blockers = Object.freeze(params.blockers ? [...params.blockers] : []);
  const warnings = Object.freeze(params.warnings ? [...params.warnings] : []);
  const writeSet = Object.freeze(
    params.writeSet.map((op) =>
      Object.freeze({
        targetRef: op.targetRef,
        operationType: op.operationType,
        expectedRevision: op.expectedRevision,
        payload: deepCloneAndFreeze(op.payload)
      })
    )
  );
  const lockKeys = Object.freeze([...params.lockKeys]);
  const expectedRevisions = Object.freeze({ ...params.expectedRevisions });
  const readSetRevisions = params.readSetRevisions
    ? Object.freeze({ ...params.readSetRevisions })
    : undefined;

  const planId = params.planId ?? `plan_${params.commandId}_${now}`;

  const fingerprint = computeFingerprint({
    commandId: params.commandId,
    writeSet,
    expectedRevisions,
    blockers,
    warnings
  });

  return Object.freeze({
    commandId: params.commandId,
    planId,
    fingerprint,
    lockKeys,
    writeSet,
    expectedRevisions,
    readSetRevisions,
    warnings,
    blockers,
    isExecutable: blockers.length === 0,
    summary: params.summary,
    customData: deepCloneAndFreeze(params.customData),
    createdAt: now
  });
}

export function sanitizePlanForPublic(plan: MutationPlan): PublicPlanPreview {
  return Object.freeze({
    commandId: plan.commandId,
    planId: plan.planId,
    fingerprint: plan.fingerprint,
    warnings: plan.warnings,
    blockers: plan.blockers,
    isExecutable: plan.isExecutable,
    summary: plan.summary,
    createdAt: plan.createdAt
  });
}

/**
 * Compares a preview plan against a confirm plan to detect material drift (DEC-641–648).
 *
 * Returns true if material changes occurred between preview and confirmation,
 * requiring explicit user re-acknowledgement.
 */
export function isPlanMateriallyChanged(
  previewPlan: MutationPlan,
  confirmPlan: MutationPlan
): boolean {
  // If executable state flipped (e.g. now blocked or unblocked)
  if (previewPlan.isExecutable !== confirmPlan.isExecutable) {
    return true;
  }

  // If new blockers appeared
  if (confirmPlan.blockers.some((b) => !previewPlan.blockers.includes(b))) {
    return true;
  }

  // If write set length changed
  if (previewPlan.writeSet.length !== confirmPlan.writeSet.length) {
    return true;
  }

  // If expected revisions for target entities drifted
  for (const [ref, rev] of Object.entries(confirmPlan.expectedRevisions)) {
    if (previewPlan.expectedRevisions[ref] !== rev) {
      return true;
    }
  }

  // If fingerprint matches, definitely identical
  if (previewPlan.fingerprint === confirmPlan.fingerprint) {
    return false;
  }

  return true;
}
