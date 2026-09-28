/**
 * RecoveryStep — Standardized journal step model for composite transactions
 * (Master Remediation §15, INV-03, INV-04, INV-05).
 */
export type RecoveryStepSubsystem =
  | "economy"
  | "people"
  | "facility"
  | "project"
  | "downtime"
  | "custom";

export type RecoveryStepState =
  | "planned"
  | "applied"
  | "compensating"
  | "compensated"
  | "unknown";

export interface RecoveryStep<TIntent = unknown, TReceipt = unknown> {
  readonly stepId: string;
  readonly subsystem: RecoveryStepSubsystem;
  readonly operation: string;
  readonly targetRef?: string;
  readonly idempotencyKey: string;
  readonly state: RecoveryStepState;
  readonly intent: TIntent;
  readonly receipt?: TReceipt;
  readonly compensationReceipt?: unknown;
}

export interface CompositeRecoveryData {
  readonly type: string;
  readonly operationId?: string;
  readonly parentRef: string;
  readonly parentBefore?: unknown;
  readonly parentExpectedAfter?: unknown;
  readonly steps: readonly RecoveryStep[];
  readonly phase:
    | "prepared"
    | "executing"
    | "committing"
    | "needs-recovery"
    | "completed"
    | "failed";
  readonly [key: string]: unknown;
}
