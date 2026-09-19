import type { ProjectContributorRef, ProjectEntry } from "../types/project-entry-types.js";
import type {
  ProjectCostTiming,
  ProjectInstance,
  ProjectLifecycle,
  ProjectRequirementCategory,
  ProjectRewardDefinition
} from "../types/project-types.js";

/**
 * Structured blocker preventing project advancement or start (Master Spec §15.4, Anexo 07 §2.5).
 */
export interface ProjectBlocker {
  readonly code: string;
  readonly message: string;
  readonly category: "requirement" | "economy" | "workforce" | "capability" | "revision" | "lifecycle";
  readonly details?: unknown;
}

/**
 * Status of an individual requirement evaluation (Master Spec Anexo 07 §2.5).
 */
export type RequirementEvaluationStatus = "satisfied" | "unsatisfied" | "unavailable" | "error";

export interface ProjectRequirementEvaluation {
  readonly requirementId: string;
  readonly category: ProjectRequirementCategory;
  readonly type: string;
  readonly status: RequirementEvaluationStatus;
  readonly message?: string;
  readonly targetRef?: string;
  readonly value?: unknown;
}

/**
 * Economic reservation intent generated during project planning (Master Spec §15.7, DEC-093, Anexo 07 §2.7).
 * Communicates reservation needs to Economy without direct balance mutation.
 */
export interface ProjectEconomicReservationIntent {
  readonly resourceId: string;
  readonly amountMinor: number;
  readonly timing: ProjectCostTiming;
  readonly accountAvailableMinor?: number;
  readonly isAvailable: boolean;
  readonly reason?: string;
}

/**
 * Workforce intent generated during project planning (Master Spec §15.6, Anexo 07 §2.4).
 * Evaluates contributor allocation without mutating People data.
 */
export interface ProjectWorkforceIntent {
  readonly requiredUnits?: number;
  readonly assignedContributors: readonly ProjectContributorRef[];
  readonly isSufficient: boolean;
  readonly notes?: readonly string[];
}

/**
 * Pre-execution plan evaluating all preconditions to start a project (Master Spec §15.5, Anexo 07 §1.5).
 */
export interface ProjectStartPlan {
  readonly planId: string;
  readonly projectId: string;
  readonly domainUuid: string;
  readonly expectedRevision: number;
  readonly targetLifecycle: "active" | "initializing";
  readonly requirements: readonly ProjectRequirementEvaluation[];
  readonly economicReservations: readonly ProjectEconomicReservationIntent[];
  readonly workforceIntent?: ProjectWorkforceIntent | null;
  readonly blockers: readonly ProjectBlocker[];
  readonly warnings: readonly string[];
  readonly isSatisfied: boolean;
  readonly evaluatedAt: number;
}

/**
 * Side effect intended or generated during project advance (Master Spec Anexo 07 §2.6).
 */
export interface ProjectAdvanceSideEffect {
  readonly type: "facility" | "economy" | "people" | "custom";
  readonly targetRef?: string;
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Pre-execution plan evaluating all preconditions to advance a project (Master Spec §15.3, §15.4, Anexo 07 §2.6).
 */
export interface ProjectAdvancePlan {
  readonly planId: string;
  readonly projectId: string;
  readonly domainUuid: string;
  readonly expectedRevision: number;
  readonly proposedDelta: number;
  readonly requirements: readonly ProjectRequirementEvaluation[];
  readonly contributors: readonly ProjectContributorRef[];
  readonly sideEffects?: readonly ProjectAdvanceSideEffect[];
  readonly blockers: readonly ProjectBlocker[];
  readonly warnings: readonly string[];
  readonly isSatisfied: boolean;
  readonly wouldComplete: boolean;
  readonly evaluatedAt: number;
}

/**
 * Policy governing cancellation of a project (Master Spec Anexo 07 §2.7).
 */
export interface ProjectCancellationPolicy {
  readonly refundPolicy?: "none" | "unspent-only" | "full";
  readonly releaseReservations?: boolean;
  readonly reasonCode?: string;
  readonly note?: string;
}

/**
 * Action type recorded in a ProjectReceipt.
 */
export type ProjectReceiptAction =
  | "start"
  | "advance"
  | "block"
  | "unblock"
  | "pause"
  | "resume"
  | "cancel"
  | "complete";

/**
 * Immutable audit receipt resulting from committing a project lifecycle or progress mutation (Master Spec Anexo 07 §1.1, §2.6).
 */
export interface ProjectReceipt {
  readonly receiptId: string;
  readonly projectId: string;
  readonly domainUuid: string;
  readonly action: ProjectReceiptAction;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly lifecycleBefore: ProjectLifecycle;
  readonly lifecycleAfter: ProjectLifecycle;
  readonly workCompletedBefore: number;
  readonly workCompletedAfter: number;
  readonly unitsDelta: number;
  readonly entryCreated?: ProjectEntry;
  readonly blockedReason?: string | null;
  readonly economicReceiptIds?: readonly string[];
  readonly childReceiptIds?: readonly string[];
  readonly appliedAt: number;
  readonly reasonCode: string;
  readonly note?: string;
}

/**
 * Batch plan evaluating multiple project advance actions simultaneously (Master Spec Anexo 07 §2.6).
 */
export interface ProjectAdvanceBatchPlan {
  readonly batchPlanId: string;
  readonly domainUuid: string;
  readonly plans: readonly ProjectAdvancePlan[];
  readonly mode: "atomic" | "best-effort";
  readonly isSatisfied: boolean;
  readonly evaluatedAt: number;
}

/**
 * Child receipt recording cross-service mutation outputs (Master Spec §15.4, Anexo 07 §1.6).
 */
export interface ChildReceipt {
  readonly childReceiptId: string;
  readonly subsystem: "facility" | "economy" | "domain" | "people" | "custom";
  readonly action: string;
  readonly targetRef?: string;
  readonly payload?: unknown;
  readonly success: boolean;
  readonly appliedAt: number;
  readonly error?: string;
}

/**
 * Coordinated side effect planned during project completion (Master Spec §15.4, DEC-096).
 */
export interface ProjectCompletionSideEffect {
  readonly id: string;
  readonly type: "facility" | "resource" | "capability" | "custom";
  readonly targetRef?: string;
  readonly value?: unknown;
  readonly description?: string;
}

/**
 * Pre-execution plan evaluating all preconditions to complete a project (Master Spec §15.4, Anexo 07 §1.6).
 * Ensures completion is never a simple checkbox, but an evaluated transaction with coordinated outputs.
 */
export interface ProjectCompletionPlan {
  readonly planId: string;
  readonly projectId: string;
  readonly domainUuid: string;
  readonly expectedRevision: number;
  readonly workRequired: number;
  readonly workCompleted: number;
  readonly requirements: readonly ProjectRequirementEvaluation[];
  readonly plannedRewards: readonly ProjectRewardDefinition[];
  readonly sideEffects: readonly ProjectCompletionSideEffect[];
  readonly blockers: readonly ProjectBlocker[];
  readonly warnings: readonly string[];
  readonly isSatisfied: boolean;
  readonly evaluatedAt: number;
}

/**
 * Coordinated outcome resulting from committing a ProjectCompletionPlan (Master Spec §15.4).
 */
export interface ProjectCompletionOutcome {
  readonly updatedProject: ProjectInstance;
  readonly receipt: ProjectReceipt;
  readonly childReceipts: readonly ChildReceipt[];
  readonly partialFailure: boolean;
}

