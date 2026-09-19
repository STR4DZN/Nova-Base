import { createOpaqueId } from "../../core/identity/ids.js";
import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { DomainRecord } from "../../domains/domain-schema.js";
import { PROJECTS_CAPABILITY_ID } from "../project-data.js";
import {
  applyProjectEntry,
  type ProjectDefinition,
  type ProjectEntry,
  type ProjectEntrySourceKind,
  type ProjectInstance,
  type ProjectLifecycle,
  validateProjectInstance,
  validateProjectLifecycleTransition
} from "../types/project-types.js";
import type { ProjectContributorRef } from "../types/project-entry-types.js";
import type { ProgressResolver } from "../resolvers/progress-resolver-types.js";
import type {
  ProjectAdvanceBatchPlan,
  ProjectAdvancePlan,
  ProjectBlocker,
  ProjectCancellationPolicy,
  ProjectReceipt,
  ProjectRequirementEvaluation,
  RequirementEvaluationStatus
} from "./project-plan-types.js";

export interface ProjectAdvanceEvaluationContext {
  readonly project: ProjectInstance;
  readonly definition: ProjectDefinition;
  readonly domain: DomainRecord;
  readonly proposedDelta?: number;
  readonly expectedRevision?: number;
  readonly contributors?: readonly ProjectContributorRef[];
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly resolver?: ProgressResolver;
}

export interface ProjectAdvanceCommitOptions {
  readonly sourceKind?: ProjectEntrySourceKind;
  readonly sourceRef?: string;
  readonly userId?: string | null;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly autoComplete?: boolean;
}

/**
 * Pure evaluation of preconditions and projected delta for advancing a project (Master Spec §15.3, §15.4, Anexo 07 §2.6).
 * Never mutates any state. Returns a serializable ProjectAdvancePlan.
 */
export function evaluateProjectAdvancePlan(
  context: ProjectAdvanceEvaluationContext
): ProjectAdvancePlan {
  const { project, definition, domain } = context;
  const blockers: ProjectBlocker[] = [];
  const warnings: string[] = [];

  const expectedRevision = context.expectedRevision !== undefined
    ? context.expectedRevision
    : project.revision;

  // 1. Optimistic Concurrency Revision Check
  if (project.revision !== expectedRevision) {
    blockers.push({
      code: "DM_PROJECT_REVISION_MISMATCH",
      category: "revision",
      message: `Project revision mismatch: expected ${expectedRevision}, found ${project.revision}`,
      details: { expected: expectedRevision, actual: project.revision }
    });
  }

  // 2. Lifecycle State Check (Master Spec §15.4)
  if (project.lifecycle === "paused") {
    blockers.push({
      code: "DM_PROJECT_PAUSED",
      category: "lifecycle",
      message: `Cannot advance project '${project.id}' because it is paused. Resume the project first`,
      details: { lifecycle: project.lifecycle }
    });
  } else if (project.lifecycle === "blocked") {
    blockers.push({
      code: "DM_PROJECT_BLOCKED",
      category: "lifecycle",
      message: `Cannot advance project '${project.id}' because it is blocked: ${project.blockedReason ?? "unspecified reason"}`,
      details: { lifecycle: project.lifecycle, blockedReason: project.blockedReason }
    });
  } else if (
    project.lifecycle === "completed" ||
    project.lifecycle === "failed" ||
    project.lifecycle === "cancelled" ||
    project.lifecycle === "archived"
  ) {
    blockers.push({
      code: "DM_PROJECT_TERMINAL",
      category: "lifecycle",
      message: `Cannot advance project '${project.id}' in terminal lifecycle '${project.lifecycle}'`,
      details: { lifecycle: project.lifecycle }
    });
  } else if (project.lifecycle !== "active") {
    blockers.push({
      code: "DM_PROJECT_NOT_ACTIVE",
      category: "lifecycle",
      message: `Project '${project.id}' is not in active state (current lifecycle: '${project.lifecycle}')`,
      details: { lifecycle: project.lifecycle }
    });
  }

  // 3. Domain Capability Check
  const enabledCaps = domain.definition.capabilities.enabled;
  if (!enabledCaps.includes(PROJECTS_CAPABILITY_ID)) {
    blockers.push({
      code: "DM_PROJECT_CAPABILITY_MISSING",
      category: "capability",
      message: `Domain '${project.domainUuid}' does not have the '${PROJECTS_CAPABILITY_ID}' capability enabled`,
      details: { capabilityId: PROJECTS_CAPABILITY_ID }
    });
  }

  // 4. Requirements Evaluation (categories "advance" and "continuous")
  const requirementEvaluations: ProjectRequirementEvaluation[] = [];
  for (const req of definition.requirements) {
    if (req.category === "advance" || req.category === "continuous") {
      let status: RequirementEvaluationStatus = "satisfied";
      let message: string | undefined;

      if (req.type === "capability") {
        const requiredCap = req.targetRef ?? String(req.value ?? "");
        if (!enabledCaps.includes(requiredCap)) {
          status = "unsatisfied";
          message = `Required capability '${requiredCap}' is not enabled on domain`;
        }
      } else if (req.type === "facility") {
        const targetFac = req.targetRef;
        if (targetFac && context.parameters?.availableFacilities) {
          const available = context.parameters.availableFacilities as readonly string[];
          if (!available.includes(targetFac)) {
            status = "unsatisfied";
            message = `Required facility '${targetFac}' is not available`;
          }
        } else {
          status = "unavailable";
          message = `Facility evaluation for '${targetFac ?? "unknown"}' is not currently available`;
        }
      } else if (req.type === "custom") {
        if (context.parameters?.customRequirements) {
          const customMap = context.parameters.customRequirements as Record<string, boolean>;
          if (customMap[req.id] !== true) {
            status = "unsatisfied";
            message = `Custom requirement '${req.id}' is not satisfied`;
          }
        } else {
          status = "unsatisfied";
          message = `Custom requirement '${req.id}' was not provided in evaluation context`;
        }
      }

      requirementEvaluations.push({
        requirementId: req.id,
        category: req.category,
        type: req.type,
        status,
        message,
        targetRef: req.targetRef,
        value: req.value
      });

      if (status !== "satisfied") {
        blockers.push({
          code: "DM_PROJECT_REQUIREMENT_UNSATISFIED",
          category: "requirement",
          message: message ?? `Requirement '${req.id}' is ${status}`,
          details: { requirementId: req.id, status }
        });
      }
    }
  }

  // 5. Delta Calculation (Resolver or Explicit proposed delta)
  let proposedDelta = 1;
  if (context.proposedDelta !== undefined) {
    if (!Number.isSafeInteger(context.proposedDelta)) {
      blockers.push({
        code: "DM_PROJECT_DELTA_INVALID",
        category: "requirement",
        message: `Proposed progress delta must be a safe integer: received ${String(context.proposedDelta)}`,
        details: { proposedDelta: context.proposedDelta }
      });
    } else {
      proposedDelta = context.proposedDelta;
    }
  } else if (context.resolver !== undefined) {
    const resolutionRes = context.resolver.resolve({
      project,
      definition,
      domainUuid: project.domainUuid,
      sourceKind: "command",
      contributor: context.contributors && context.contributors.length > 0 ? context.contributors[0] : null,
      parameters: context.parameters
    });

    if (resolutionRes.ok) {
      proposedDelta = resolutionRes.value.deltaWork;
      if (resolutionRes.value.warnings && resolutionRes.value.warnings.length > 0) {
        warnings.push(...resolutionRes.value.warnings);
      }
    } else {
      blockers.push({
        code: resolutionRes.error.code,
        category: "workforce",
        message: resolutionRes.error.message,
        details: resolutionRes.error.details
      });
    }
  }

  // 6. Completion Projection (Integer Goal Clamping per DEC-086, DEC-090)
  const projectedCompleted = project.clampProgress !== false
    ? Math.min(project.workRequired, Math.max(0, project.workCompleted + proposedDelta))
    : project.workCompleted + proposedDelta;
  const wouldComplete = projectedCompleted >= project.workRequired;

  const planId = createOpaqueId("plan");

  return {
    planId,
    projectId: project.id,
    domainUuid: project.domainUuid,
    expectedRevision,
    proposedDelta,
    requirements: Object.freeze(requirementEvaluations),
    contributors: Object.freeze([...(context.contributors ?? [])]),
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    isSatisfied: blockers.length === 0,
    wouldComplete,
    evaluatedAt: Date.now()
  };
}

/**
 * Commits an advance plan to a ProjectInstance (Master Spec §15.3, §15.4, Anexo 07 §2.6).
 * Pure function returning the updated ProjectInstance and audit ProjectReceipt.
 */
export function commitProjectAdvance(
  plan: ProjectAdvancePlan,
  project: ProjectInstance,
  options?: ProjectAdvanceCommitOptions
): Result<
  {
    readonly updatedProject: ProjectInstance;
    readonly receipt: ProjectReceipt;
  },
  PublicError
> {
  // 1. Precondition Satisfaction Check
  if (!plan.isSatisfied) {
    const blockerMsgs = plan.blockers.map((b) => `[${b.code}] ${b.message}`).join("; ");
    return err(
      createPublicError({
        code: "DM_PROJECT_ADVANCE_BLOCKED",
        category: "conflict",
        message: `Cannot commit project advance: plan is blocked (${blockerMsgs})`,
        details: { blockers: plan.blockers }
      })
    );
  }

  // 2. Optimistic Concurrency Check
  if (project.revision !== plan.expectedRevision) {
    return err(
      createPublicError({
        code: "DM_PROJECT_REVISION_MISMATCH",
        category: "conflict",
        message: `Project revision mismatch: plan expects revision ${plan.expectedRevision}, but project is at revision ${project.revision}`,
        details: { expected: plan.expectedRevision, actual: project.revision }
      })
    );
  }

  // 3. Lifecycle Check
  if (project.lifecycle !== "active") {
    return err(
      createPublicError({
        code: "DM_PROJECT_INVALID_TRANSITION",
        category: "validation",
        message: `Cannot advance project in lifecycle '${project.lifecycle}'. Must be 'active'`,
        details: { lifecycle: project.lifecycle }
      })
    );
  }

  const now = Date.now();
  const entryId = createOpaqueId("prj");
  const sourceKind = options?.sourceKind ?? "command";
  const sourceRef = options?.sourceRef ?? plan.planId;
  const reasonCode = options?.reasonCode ?? (plan.wouldComplete ? "PROJECT_COMPLETED" : "PROJECT_ADVANCED");

  // 4. Calculate clamped target unitsAfter
  const rawUnitsAfter = project.workCompleted + plan.proposedDelta;
  const nonNegative = Math.max(0, rawUnitsAfter);
  const clampedUnitsAfter = project.clampProgress !== false
    ? Math.min(project.workRequired, nonNegative)
    : nonNegative;

  const sequence = (project.entries?.length ?? 0) + 1;
  const entry: ProjectEntry = {
    id: entryId,
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence,
    unitsDelta: plan.proposedDelta,
    unitsBefore: project.workCompleted,
    unitsAfter: clampedUnitsAfter,
    sourceKind,
    sourceRef,
    requestedByUserId: options?.userId ?? null,
    contributor: plan.contributors && plan.contributors.length > 0 ? plan.contributors[0] : null,
    timestamp: now,
    reasonCode,
    note: options?.note
  };

  // 5. Completion transition check
  const isGoalMet = clampedUnitsAfter >= project.workRequired;
  const shouldComplete = isGoalMet && (options?.autoComplete ?? false);
  const targetLifecycle: ProjectLifecycle = shouldComplete ? "completed" : "active";

  if (shouldComplete) {
    const transitionRes = validateProjectLifecycleTransition(project.lifecycle, "completed");
    if (!transitionRes.ok) {
      return transitionRes;
    }
  }

  // Apply entry to project
  const applyRes = applyProjectEntry(project, entry);
  if (!applyRes.ok) {
    return applyRes;
  }

  let updatedProject = applyRes.value;
  if (shouldComplete) {
    updatedProject = {
      ...updatedProject,
      lifecycle: "completed",
      completedAt: now
    };
  }

  // 6. Generate ProjectReceipt
  const receipt: ProjectReceipt = {
    receiptId: createOpaqueId("rep"),
    projectId: project.id,
    domainUuid: project.domainUuid,
    action: shouldComplete ? "complete" : "advance",
    revisionBefore: project.revision,
    revisionAfter: updatedProject.revision,
    lifecycleBefore: project.lifecycle,
    lifecycleAfter: updatedProject.lifecycle,
    workCompletedBefore: project.workCompleted,
    workCompletedAfter: updatedProject.workCompleted,
    unitsDelta: plan.proposedDelta,
    entryCreated: entry,
    blockedReason: project.blockedReason,
    appliedAt: now,
    reasonCode,
    note: options?.note
  };

  return ok({
    updatedProject,
    receipt
  });
}

/**
 * Transitions a project to "blocked" with a diagnostic reason (Master Spec §15.4, Anexo 07 §2.5).
 */
export function blockProject(
  project: ProjectInstance,
  params: {
    readonly reason: string;
    readonly expectedRevision?: number;
    readonly sourceRef?: string;
    readonly userId?: string | null;
    readonly note?: string;
  }
): Result<
  {
    readonly updatedProject: ProjectInstance;
    readonly receipt: ProjectReceipt;
  },
  PublicError
> {
  const expectedRevision = params.expectedRevision !== undefined
    ? params.expectedRevision
    : project.revision;

  if (project.revision !== expectedRevision) {
    return err(
      createPublicError({
        code: "DM_PROJECT_REVISION_MISMATCH",
        category: "conflict",
        message: `Project revision mismatch: expected revision ${expectedRevision}, but project is at revision ${project.revision}`,
        details: { expected: expectedRevision, actual: project.revision }
      })
    );
  }

  const reason = params.reason.trim();
  if (!reason) {
    return err(
      createPublicError({
        code: "DM_PROJECT_BLOCK_REASON_REQUIRED",
        category: "validation",
        message: "Blocking a project requires a non-empty reason string"
      })
    );
  }

  const transitionRes = validateProjectLifecycleTransition(project.lifecycle, "blocked");
  if (!transitionRes.ok) {
    return transitionRes;
  }

  const now = Date.now();
  const entryId = createOpaqueId("prj");
  const sequence = (project.entries?.length ?? 0) + 1;
  const entry: ProjectEntry = {
    id: entryId,
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence,
    unitsDelta: 0,
    unitsBefore: project.workCompleted,
    unitsAfter: project.workCompleted,
    sourceKind: "command",
    sourceRef: params.sourceRef ?? "blockProject",
    requestedByUserId: params.userId ?? null,
    timestamp: now,
    reasonCode: "PROJECT_BLOCKED",
    note: params.note ? `${reason} — ${params.note}` : reason
  };

  const transitioningProject: ProjectInstance = {
    ...project,
    lifecycle: "blocked",
    blockedReason: reason
  };

  const applyRes = applyProjectEntry(transitioningProject, entry);
  if (!applyRes.ok) {
    return applyRes;
  }

  const updatedProject = applyRes.value;

  const receipt: ProjectReceipt = {
    receiptId: createOpaqueId("rep"),
    projectId: project.id,
    domainUuid: project.domainUuid,
    action: "block",
    revisionBefore: project.revision,
    revisionAfter: updatedProject.revision,
    lifecycleBefore: project.lifecycle,
    lifecycleAfter: updatedProject.lifecycle,
    workCompletedBefore: project.workCompleted,
    workCompletedAfter: updatedProject.workCompleted,
    unitsDelta: 0,
    entryCreated: entry,
    blockedReason: reason,
    appliedAt: now,
    reasonCode: "PROJECT_BLOCKED",
    note: params.note
  };

  return ok({
    updatedProject,
    receipt
  });
}

/**
 * Transitions a project out of "blocked" state to "active" or "paused" (Master Spec §15.4, Anexo 07 §2.5).
 */
export function unblockProject(
  project: ProjectInstance,
  params?: {
    readonly targetLifecycle?: "active" | "paused";
    readonly expectedRevision?: number;
    readonly sourceRef?: string;
    readonly userId?: string | null;
    readonly note?: string;
  }
): Result<
  {
    readonly updatedProject: ProjectInstance;
    readonly receipt: ProjectReceipt;
  },
  PublicError
> {
  const expectedRevision = params?.expectedRevision !== undefined
    ? params.expectedRevision
    : project.revision;

  if (project.revision !== expectedRevision) {
    return err(
      createPublicError({
        code: "DM_PROJECT_REVISION_MISMATCH",
        category: "conflict",
        message: `Project revision mismatch: expected revision ${expectedRevision}, but project is at revision ${project.revision}`,
        details: { expected: expectedRevision, actual: project.revision }
      })
    );
  }

  if (project.lifecycle !== "blocked") {
    return err(
      createPublicError({
        code: "DM_PROJECT_INVALID_TRANSITION",
        category: "validation",
        message: `Cannot unblock project in lifecycle '${project.lifecycle}'. Project is not blocked`,
        details: { lifecycle: project.lifecycle }
      })
    );
  }

  const targetLifecycle: ProjectLifecycle = params?.targetLifecycle ?? "active";
  const transitionRes = validateProjectLifecycleTransition(project.lifecycle, targetLifecycle);
  if (!transitionRes.ok) {
    return transitionRes;
  }

  const now = Date.now();
  const entryId = createOpaqueId("prj");
  const sequence = (project.entries?.length ?? 0) + 1;
  const entry: ProjectEntry = {
    id: entryId,
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence,
    unitsDelta: 0,
    unitsBefore: project.workCompleted,
    unitsAfter: project.workCompleted,
    sourceKind: "command",
    sourceRef: params?.sourceRef ?? "unblockProject",
    requestedByUserId: params?.userId ?? null,
    timestamp: now,
    reasonCode: "PROJECT_UNBLOCKED",
    note: params?.note
  };

  const transitioningProject: ProjectInstance = {
    ...project,
    lifecycle: targetLifecycle,
    blockedReason: null
  };

  const applyRes = applyProjectEntry(transitioningProject, entry);
  if (!applyRes.ok) {
    return applyRes;
  }

  const updatedProject = applyRes.value;

  const receipt: ProjectReceipt = {
    receiptId: createOpaqueId("rep"),
    projectId: project.id,
    domainUuid: project.domainUuid,
    action: "unblock",
    revisionBefore: project.revision,
    revisionAfter: updatedProject.revision,
    lifecycleBefore: project.lifecycle,
    lifecycleAfter: updatedProject.lifecycle,
    workCompletedBefore: project.workCompleted,
    workCompletedAfter: updatedProject.workCompleted,
    unitsDelta: 0,
    entryCreated: entry,
    blockedReason: null,
    appliedAt: now,
    reasonCode: "PROJECT_UNBLOCKED",
    note: params?.note
  };

  return ok({
    updatedProject,
    receipt
  });
}

/**
 * Transitions a project to "paused" (Master Spec §15.4, Anexo 07 §2.7).
 * Preserves workforce and reservations while stopping active advance.
 */
export function pauseProject(
  project: ProjectInstance,
  params?: {
    readonly expectedRevision?: number;
    readonly sourceRef?: string;
    readonly userId?: string | null;
    readonly note?: string;
  }
): Result<
  {
    readonly updatedProject: ProjectInstance;
    readonly receipt: ProjectReceipt;
  },
  PublicError
> {
  const expectedRevision = params?.expectedRevision !== undefined
    ? params.expectedRevision
    : project.revision;

  if (project.revision !== expectedRevision) {
    return err(
      createPublicError({
        code: "DM_PROJECT_REVISION_MISMATCH",
        category: "conflict",
        message: `Project revision mismatch: expected revision ${expectedRevision}, but project is at revision ${project.revision}`,
        details: { expected: expectedRevision, actual: project.revision }
      })
    );
  }

  const transitionRes = validateProjectLifecycleTransition(project.lifecycle, "paused");
  if (!transitionRes.ok) {
    return transitionRes;
  }

  const now = Date.now();
  const entryId = createOpaqueId("prj");
  const sequence = (project.entries?.length ?? 0) + 1;
  const entry: ProjectEntry = {
    id: entryId,
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence,
    unitsDelta: 0,
    unitsBefore: project.workCompleted,
    unitsAfter: project.workCompleted,
    sourceKind: "command",
    sourceRef: params?.sourceRef ?? "pauseProject",
    requestedByUserId: params?.userId ?? null,
    timestamp: now,
    reasonCode: "PROJECT_PAUSED",
    note: params?.note
  };

  const transitioningProject: ProjectInstance = {
    ...project,
    lifecycle: "paused"
  };

  const applyRes = applyProjectEntry(transitioningProject, entry);
  if (!applyRes.ok) {
    return applyRes;
  }

  const updatedProject = applyRes.value;

  const receipt: ProjectReceipt = {
    receiptId: createOpaqueId("rep"),
    projectId: project.id,
    domainUuid: project.domainUuid,
    action: "pause",
    revisionBefore: project.revision,
    revisionAfter: updatedProject.revision,
    lifecycleBefore: project.lifecycle,
    lifecycleAfter: updatedProject.lifecycle,
    workCompletedBefore: project.workCompleted,
    workCompletedAfter: updatedProject.workCompleted,
    unitsDelta: 0,
    entryCreated: entry,
    blockedReason: project.blockedReason,
    appliedAt: now,
    reasonCode: "PROJECT_PAUSED",
    note: params?.note
  };

  return ok({
    updatedProject,
    receipt
  });
}

/**
 * Resumes a paused project back to "active" (Master Spec §15.4, Anexo 07 §2.7).
 */
export function resumeProject(
  project: ProjectInstance,
  params?: {
    readonly expectedRevision?: number;
    readonly sourceRef?: string;
    readonly userId?: string | null;
    readonly note?: string;
  }
): Result<
  {
    readonly updatedProject: ProjectInstance;
    readonly receipt: ProjectReceipt;
  },
  PublicError
> {
  const expectedRevision = params?.expectedRevision !== undefined
    ? params.expectedRevision
    : project.revision;

  if (project.revision !== expectedRevision) {
    return err(
      createPublicError({
        code: "DM_PROJECT_REVISION_MISMATCH",
        category: "conflict",
        message: `Project revision mismatch: expected revision ${expectedRevision}, but project is at revision ${project.revision}`,
        details: { expected: expectedRevision, actual: project.revision }
      })
    );
  }

  if (project.lifecycle !== "paused") {
    return err(
      createPublicError({
        code: "DM_PROJECT_INVALID_TRANSITION",
        category: "validation",
        message: `Cannot resume project in lifecycle '${project.lifecycle}'. Must be 'paused'`,
        details: { lifecycle: project.lifecycle }
      })
    );
  }

  const transitionRes = validateProjectLifecycleTransition(project.lifecycle, "active");
  if (!transitionRes.ok) {
    return transitionRes;
  }

  const now = Date.now();
  const entryId = createOpaqueId("prj");
  const sequence = (project.entries?.length ?? 0) + 1;
  const entry: ProjectEntry = {
    id: entryId,
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence,
    unitsDelta: 0,
    unitsBefore: project.workCompleted,
    unitsAfter: project.workCompleted,
    sourceKind: "command",
    sourceRef: params?.sourceRef ?? "resumeProject",
    requestedByUserId: params?.userId ?? null,
    timestamp: now,
    reasonCode: "PROJECT_RESUMED",
    note: params?.note
  };

  const transitioningProject: ProjectInstance = {
    ...project,
    lifecycle: "active"
  };

  const applyRes = applyProjectEntry(transitioningProject, entry);
  if (!applyRes.ok) {
    return applyRes;
  }

  const updatedProject = applyRes.value;

  const receipt: ProjectReceipt = {
    receiptId: createOpaqueId("rep"),
    projectId: project.id,
    domainUuid: project.domainUuid,
    action: "resume",
    revisionBefore: project.revision,
    revisionAfter: updatedProject.revision,
    lifecycleBefore: project.lifecycle,
    lifecycleAfter: updatedProject.lifecycle,
    workCompletedBefore: project.workCompleted,
    workCompletedAfter: updatedProject.workCompleted,
    unitsDelta: 0,
    entryCreated: entry,
    blockedReason: project.blockedReason,
    appliedAt: now,
    reasonCode: "PROJECT_RESUMED",
    note: params?.note
  };

  return ok({
    updatedProject,
    receipt
  });
}

/**
 * Cancels a project according to ProjectCancellationPolicy (Master Spec §15.4, Anexo 07 §2.7).
 * Pure function: transitions lifecycle to 'cancelled', increments revision, appends audit entry.
 */
export function cancelProject(
  project: ProjectInstance,
  params?: {
    readonly policy?: ProjectCancellationPolicy;
    readonly expectedRevision?: number;
    readonly sourceRef?: string;
    readonly userId?: string | null;
    readonly note?: string;
  }
): Result<
  {
    readonly updatedProject: ProjectInstance;
    readonly receipt: ProjectReceipt;
  },
  PublicError
> {
  const expectedRevision = params?.expectedRevision !== undefined
    ? params.expectedRevision
    : project.revision;

  if (project.revision !== expectedRevision) {
    return err(
      createPublicError({
        code: "DM_PROJECT_REVISION_MISMATCH",
        category: "conflict",
        message: `Project revision mismatch: expected revision ${expectedRevision}, but project is at revision ${project.revision}`,
        details: { expected: expectedRevision, actual: project.revision }
      })
    );
  }

  const transitionRes = validateProjectLifecycleTransition(project.lifecycle, "cancelled");
  if (!transitionRes.ok) {
    return transitionRes;
  }

  const now = Date.now();
  const entryId = createOpaqueId("prj");
  const reasonCode = params?.policy?.reasonCode ?? "PROJECT_CANCELLED";
  const sequence = (project.entries?.length ?? 0) + 1;

  const entry: ProjectEntry = {
    id: entryId,
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence,
    unitsDelta: 0,
    unitsBefore: project.workCompleted,
    unitsAfter: project.workCompleted,
    sourceKind: "command",
    sourceRef: params?.sourceRef ?? "cancelProject",
    requestedByUserId: params?.userId ?? null,
    timestamp: now,
    reasonCode,
    note: params?.note
  };

  const transitioningProject: ProjectInstance = {
    ...project,
    lifecycle: "cancelled"
  };

  const applyRes = applyProjectEntry(transitioningProject, entry);
  if (!applyRes.ok) {
    return applyRes;
  }

  const updatedProject = applyRes.value;

  const receipt: ProjectReceipt = {
    receiptId: createOpaqueId("rep"),
    projectId: project.id,
    domainUuid: project.domainUuid,
    action: "cancel",
    revisionBefore: project.revision,
    revisionAfter: updatedProject.revision,
    lifecycleBefore: project.lifecycle,
    lifecycleAfter: updatedProject.lifecycle,
    workCompletedBefore: project.workCompleted,
    workCompletedAfter: updatedProject.workCompleted,
    unitsDelta: 0,
    entryCreated: entry,
    blockedReason: project.blockedReason,
    appliedAt: now,
    reasonCode,
    note: params?.note
  };

  return ok({
    updatedProject,
    receipt
  });
}

/**
 * Evaluates a batch of project advance plans (Master Spec Anexo 07 §2.6).
 */
export function evaluateProjectAdvanceBatchPlan(batch: {
  readonly domainUuid: string;
  readonly items: readonly ProjectAdvanceEvaluationContext[];
  readonly mode?: "atomic" | "best-effort";
}): ProjectAdvanceBatchPlan {
  const plans = batch.items.map((item) => evaluateProjectAdvancePlan(item));
  const mode = batch.mode ?? "atomic";
  const isSatisfied = mode === "best-effort"
    ? plans.some((p) => p.isSatisfied)
    : plans.every((p) => p.isSatisfied);

  return {
    batchPlanId: createOpaqueId("plan"),
    domainUuid: batch.domainUuid,
    plans: Object.freeze(plans),
    mode,
    isSatisfied,
    evaluatedAt: Date.now()
  };
}

/**
 * Commits a batch of advance plans (Master Spec Anexo 07 §2.6).
 * Atomic mode commits all or none; best-effort mode commits satisfied plans and skips unsatisfied ones.
 */
export function commitProjectAdvanceBatch(
  batchPlan: ProjectAdvanceBatchPlan,
  projectsMap: ReadonlyMap<string, ProjectInstance>,
  options?: ProjectAdvanceCommitOptions
): Result<
  {
    readonly updatedProjects: readonly ProjectInstance[];
    readonly receipts: readonly ProjectReceipt[];
  },
  PublicError
> {
  if (batchPlan.mode === "atomic" && !batchPlan.isSatisfied) {
    return err(
      createPublicError({
        code: "DM_PROJECT_BATCH_BLOCKED",
        category: "conflict",
        message: "Atomic project advance batch cannot commit: one or more plans are unsatisfied"
      })
    );
  }

  const updatedProjects: ProjectInstance[] = [];
  const receipts: ProjectReceipt[] = [];

  for (const plan of batchPlan.plans) {
    if (!plan.isSatisfied) {
      if (batchPlan.mode === "atomic") {
        return err(
          createPublicError({
            code: "DM_PROJECT_ADVANCE_BLOCKED",
            category: "conflict",
            message: `Plan for project '${plan.projectId}' is not satisfied in atomic batch`
          })
        );
      }
      continue;
    }

    const project = projectsMap.get(plan.projectId);
    if (!project) {
      if (batchPlan.mode === "atomic") {
        return err(
          createPublicError({
            code: "DM_PROJECT_NOT_FOUND",
            category: "not-found",
            message: `Project '${plan.projectId}' not found in batch projects map`
          })
        );
      }
      continue;
    }

    const commitRes = commitProjectAdvance(plan, project, options);
    if (!commitRes.ok) {
      if (batchPlan.mode === "atomic") {
        return commitRes;
      }
      continue;
    }

    updatedProjects.push(commitRes.value.updatedProject);
    receipts.push(commitRes.value.receipt);
  }

  return ok({
    updatedProjects: Object.freeze(updatedProjects),
    receipts: Object.freeze(receipts)
  });
}
