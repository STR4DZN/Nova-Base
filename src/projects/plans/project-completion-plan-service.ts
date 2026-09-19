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
  validateProjectLifecycleTransition
} from "../types/project-types.js";
import type {
  ChildReceipt,
  ProjectBlocker,
  ProjectCompletionOutcome,
  ProjectCompletionPlan,
  ProjectCompletionSideEffect,
  ProjectReceipt,
  ProjectRequirementEvaluation,
  RequirementEvaluationStatus
} from "./project-plan-types.js";

export interface ProjectCompletionEvaluationContext {
  readonly project: ProjectInstance;
  readonly definition: ProjectDefinition;
  readonly domain: DomainRecord;
  readonly expectedRevision?: number;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly extraSideEffects?: readonly ProjectCompletionSideEffect[];
}

export type SideEffectHandler = (
  effect: ProjectCompletionSideEffect,
  context: { readonly project: ProjectInstance; readonly domain: DomainRecord }
) => Result<ChildReceipt, PublicError> | ChildReceipt;

export interface ProjectCompletionCommitOptions {
  readonly sourceKind?: ProjectEntrySourceKind;
  readonly sourceRef?: string;
  readonly userId?: string | null;
  readonly note?: string;
  readonly sideEffectHandlers?: Readonly<Record<string, SideEffectHandler>>;
}

/**
 * Pure evaluation function for ProjectCompletionPlan (Master Spec §15.4, Anexo 07 §1.6).
 * Evaluates completion criteria, final requirements, and planned side effects without mutating any state.
 * Completion is NEVER a checkbox (Master Spec §15.4, Anexo 07 §1.6).
 */
export function evaluateProjectCompletionPlan(
  context: ProjectCompletionEvaluationContext
): ProjectCompletionPlan {
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

  // 2. Work Completed vs Work Required Check (DEC-086, DEC-089)
  if (project.workCompleted < project.workRequired) {
    blockers.push({
      code: "DM_PROJECT_INCOMPLETE",
      category: "requirement",
      message: `Project '${project.id}' is not complete: ${project.workCompleted}/${project.workRequired} units completed`,
      details: { workCompleted: project.workCompleted, workRequired: project.workRequired }
    });
  }

  // 3. Lifecycle State Check (Master Spec §15.4)
  if (project.lifecycle === "completed") {
    blockers.push({
      code: "DM_PROJECT_ALREADY_COMPLETED",
      category: "lifecycle",
      message: `Project '${project.id}' is already completed`,
      details: { lifecycle: project.lifecycle }
    });
  } else if (project.lifecycle === "paused") {
    blockers.push({
      code: "DM_PROJECT_PAUSED",
      category: "lifecycle",
      message: `Cannot complete project '${project.id}' because it is paused. Resume the project first`,
      details: { lifecycle: project.lifecycle }
    });
  } else if (project.lifecycle === "blocked") {
    blockers.push({
      code: "DM_PROJECT_BLOCKED",
      category: "lifecycle",
      message: `Cannot complete project '${project.id}' because it is blocked: ${project.blockedReason ?? "unspecified reason"}`,
      details: { lifecycle: project.lifecycle, blockedReason: project.blockedReason }
    });
  } else if (
    project.lifecycle === "failed" ||
    project.lifecycle === "cancelled" ||
    project.lifecycle === "archived"
  ) {
    blockers.push({
      code: "DM_PROJECT_TERMINAL",
      category: "lifecycle",
      message: `Cannot complete project '${project.id}' in terminal lifecycle '${project.lifecycle}'`,
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

  // 4. Domain Capability Check
  const enabledCaps = domain.definition.capabilities.enabled;
  if (!enabledCaps.includes(PROJECTS_CAPABILITY_ID)) {
    blockers.push({
      code: "DM_PROJECT_CAPABILITY_MISSING",
      category: "capability",
      message: `Domain '${project.domainUuid}' does not have the '${PROJECTS_CAPABILITY_ID}' capability enabled`,
      details: { capabilityId: PROJECTS_CAPABILITY_ID }
    });
  }

  // 5. Requirements Evaluation (categories "completion" and "continuous")
  const requirementEvaluations: ProjectRequirementEvaluation[] = [];
  for (const req of definition.requirements) {
    if (req.category === "completion" || req.category === "continuous") {
      let status: RequirementEvaluationStatus = "satisfied";
      let message: string | undefined;

      if (req.type === "capability") {
        const requiredCap = req.targetRef ?? String(req.value ?? "");
        if (!enabledCaps.includes(requiredCap)) {
          status = "unsatisfied";
          message = `Required capability '${requiredCap}' is not enabled on domain for completion`;
        }
      } else if (req.type === "facility") {
        const targetFac = req.targetRef;
        if (targetFac && context.parameters?.availableFacilities) {
          const available = context.parameters.availableFacilities as readonly string[];
          if (!available.includes(targetFac)) {
            status = "unsatisfied";
            message = `Required facility '${targetFac}' is not available for completion`;
          }
        } else {
          status = "unavailable";
          message = `Facility evaluation for '${targetFac ?? "unknown"}' is not available for completion`;
        }
      } else if (req.type === "custom") {
        if (context.parameters?.customRequirements) {
          const customMap = context.parameters.customRequirements as Record<string, boolean>;
          if (customMap[req.id] !== true) {
            status = "unsatisfied";
            message = `Completion requirement '${req.id}' is not satisfied`;
          }
        } else {
          status = "unsatisfied";
          message = `Completion requirement '${req.id}' was not provided in evaluation context`;
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
          message: message ?? `Completion requirement '${req.id}' is ${status}`,
          details: { requirementId: req.id, status }
        });
      }
    }
  }

  // 6. Assemble Planned Rewards & Coordinated Side Effects (DEC-096)
  const sideEffects: ProjectCompletionSideEffect[] = [];

  for (const reward of definition.rewards) {
    sideEffects.push({
      id: createOpaqueId("prj"),
      type: reward.type,
      targetRef: reward.targetRef,
      value: reward.value,
      description: reward.label ?? `Project reward (${reward.type})`
    });
  }

  if (context.extraSideEffects) {
    sideEffects.push(...context.extraSideEffects);
  }

  const planId = createOpaqueId("plan");

  return {
    planId,
    projectId: project.id,
    domainUuid: project.domainUuid,
    expectedRevision,
    workRequired: project.workRequired,
    workCompleted: project.workCompleted,
    requirements: Object.freeze(requirementEvaluations),
    plannedRewards: Object.freeze([...definition.rewards]),
    sideEffects: Object.freeze(sideEffects),
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    isSatisfied: blockers.length === 0,
    evaluatedAt: Date.now()
  };
}

/**
 * Commits a satisfied ProjectCompletionPlan, transitioning the project to 'completed'
 * and executing coordinated side effects with child receipts (Master Spec §15.4, Anexo 07 §1.6).
 * Never hides partial failure: records explicit failure in child receipts and marks partialFailure = true.
 */
export function commitProjectCompletion(
  plan: ProjectCompletionPlan,
  project: ProjectInstance,
  options?: ProjectCompletionCommitOptions
): Result<ProjectCompletionOutcome, PublicError> {
  // 1. Precondition Satisfaction Check
  if (!plan.isSatisfied) {
    const blockerMsgs = plan.blockers.map((b) => `[${b.code}] ${b.message}`).join("; ");
    return err(
      createPublicError({
        code: "DM_PROJECT_COMPLETION_BLOCKED",
        category: "conflict",
        message: `Cannot commit project completion: plan is blocked (${blockerMsgs})`,
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
        message: `Cannot complete project in lifecycle '${project.lifecycle}'. Must be 'active'`,
        details: { lifecycle: project.lifecycle }
      })
    );
  }

  // 4. Progress Check
  if (project.workCompleted < project.workRequired) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INCOMPLETE",
        category: "conflict",
        message: `Cannot complete incomplete project: ${project.workCompleted}/${project.workRequired} units completed`
      })
    );
  }

  // 5. Lifecycle Transition Validation
  const transitionRes = validateProjectLifecycleTransition(project.lifecycle, "completed");
  if (!transitionRes.ok) {
    return transitionRes;
  }

  const now = Date.now();
  const entryId = createOpaqueId("prj");
  const sequence = (project.entries?.length ?? 0) + 1;
  const reasonCode = "PROJECT_COMPLETED";

  // 6. Completion Entry
  const entry: ProjectEntry = {
    id: entryId,
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence,
    unitsDelta: 0,
    unitsBefore: project.workCompleted,
    unitsAfter: project.workCompleted,
    sourceKind: options?.sourceKind ?? "command",
    sourceRef: options?.sourceRef ?? plan.planId,
    requestedByUserId: options?.userId ?? null,
    timestamp: now,
    reasonCode,
    note: options?.note ?? `Project completed via plan ${plan.planId}`
  };

  const transitioningProject: ProjectInstance = {
    ...project,
    lifecycle: "completed",
    completedAt: now
  };

  const applyRes = applyProjectEntry(transitioningProject, entry);
  if (!applyRes.ok) {
    return applyRes;
  }

  const updatedProject = applyRes.value;

  // 7. Process Coordinated Side Effects and Child Receipts
  const childReceipts: ChildReceipt[] = [];
  let partialFailure = false;

  for (const effect of plan.sideEffects) {
    const handler = options?.sideEffectHandlers?.[effect.type];
    if (handler) {
      try {
        const res = handler(effect, { project, domain: { definition: { identity: { id: project.domainUuid } } } as unknown as DomainRecord });
        if ("ok" in res) {
          if (res.ok) {
            childReceipts.push(res.value);
          } else {
            partialFailure = true;
            childReceipts.push({
              childReceiptId: createOpaqueId("rep"),
              subsystem: effect.type === "facility" ? "facility" : effect.type === "resource" ? "economy" : "custom",
              action: `apply_${effect.type}_reward`,
              targetRef: effect.targetRef,
              payload: effect.value,
              success: false,
              appliedAt: now,
              error: res.error.message
            });
          }
        } else {
          childReceipts.push(res);
          if (!res.success) {
            partialFailure = true;
          }
        }
      } catch (errCatch: unknown) {
        partialFailure = true;
        const msg = errCatch instanceof Error ? errCatch.message : String(errCatch);
        childReceipts.push({
          childReceiptId: createOpaqueId("rep"),
          subsystem: effect.type === "facility" ? "facility" : effect.type === "resource" ? "economy" : "custom",
          action: `apply_${effect.type}_reward`,
          targetRef: effect.targetRef,
          payload: effect.value,
          success: false,
          appliedAt: now,
          error: msg
        });
      }
    } else {
      // Default: generate standard coordinated child receipt for registered reward
      childReceipts.push({
        childReceiptId: createOpaqueId("rep"),
        subsystem: effect.type === "facility" ? "facility" : effect.type === "resource" ? "economy" : "custom",
        action: `grant_${effect.type}`,
        targetRef: effect.targetRef,
        payload: effect.value,
        success: true,
        appliedAt: now
      });
    }
  }

  // 8. Generate Parent ProjectReceipt
  const receipt: ProjectReceipt = {
    receiptId: createOpaqueId("rep"),
    projectId: project.id,
    domainUuid: project.domainUuid,
    action: "complete",
    revisionBefore: project.revision,
    revisionAfter: updatedProject.revision,
    lifecycleBefore: project.lifecycle,
    lifecycleAfter: updatedProject.lifecycle,
    workCompletedBefore: project.workCompleted,
    workCompletedAfter: updatedProject.workCompleted,
    unitsDelta: 0,
    entryCreated: entry,
    blockedReason: null,
    childReceiptIds: Object.freeze(childReceipts.map((c) => c.childReceiptId)),
    appliedAt: now,
    reasonCode,
    note: options?.note
  };

  return ok({
    updatedProject,
    receipt,
    childReceipts: Object.freeze(childReceipts),
    partialFailure
  });
}
