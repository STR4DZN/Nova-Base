import { createOpaqueId } from "../../core/identity/ids.js";
import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { DomainRecord } from "../../domains/domain-schema.js";
import { tryGetDomainEconomyData } from "../../economy/economy-data.js";
import { PROJECTS_CAPABILITY_ID } from "../project-data.js";
import {
  applyProjectEntry,
  type ProjectDefinition,
  type ProjectEntry,
  type ProjectInstance,
  validateProjectLifecycleTransition
} from "../types/project-types.js";
import type {
  ProjectBlocker,
  ProjectEconomicReservationIntent,
  ProjectRequirementEvaluation,
  ProjectStartPlan,
  ProjectWorkforceIntent,
  RequirementEvaluationStatus
} from "./project-plan-types.js";
import type { ProjectContributorRef } from "../types/project-entry-types.js";

export interface ProjectStartEvaluationContext {
  readonly project: ProjectInstance;
  readonly definition: ProjectDefinition;
  readonly domain: DomainRecord;
  readonly expectedRevision?: number;
  readonly targetLifecycle?: "active" | "initializing";
  readonly contributors?: readonly ProjectContributorRef[];
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly availableResources?: Readonly<Record<string, number>>;
}

/**
 * Pure evaluation function for ProjectStartPlan (Master Spec §15.5, Anexo 07 §1.5).
 * Evaluates all start preconditions (requirements, economy reservations, workforce, capabilities, revisions)
 * without performing any mutations on Domain, People, or Economy.
 */
export function evaluateProjectStartPlan(
  context: ProjectStartEvaluationContext
): ProjectStartPlan {
  const { project, definition, domain } = context;
  const blockers: ProjectBlocker[] = [];
  const warnings: string[] = [];

  const expectedRevision = context.expectedRevision !== undefined
    ? context.expectedRevision
    : project.revision;
  const targetLifecycle = context.targetLifecycle ?? "active";

  // 1. Optimistic Concurrency Revision Check
  if (project.revision !== expectedRevision) {
    blockers.push({
      code: "DM_PROJECT_REVISION_MISMATCH",
      category: "revision",
      message: `Project revision mismatch: expected ${expectedRevision}, found ${project.revision}`,
      details: { expected: expectedRevision, actual: project.revision }
    });
  }

  // 2. Lifecycle State Transition Check (Master Spec §15.5)
  const STARTABLE_LIFECYCLES = ["draft", "planned", "approved", "initializing"] as const;
  if (!STARTABLE_LIFECYCLES.includes(project.lifecycle as (typeof STARTABLE_LIFECYCLES)[number])) {
    blockers.push({
      code: "DM_PROJECT_INVALID_TRANSITION",
      category: "lifecycle",
      message: `Cannot start project from lifecycle '${project.lifecycle}'. Project must be in draft, planned, approved, or initializing state`,
      details: { from: project.lifecycle, to: targetLifecycle }
    });
  }
  if (targetLifecycle !== "active" && targetLifecycle !== "initializing") {
    blockers.push({
      code: "DM_PROJECT_INVALID_TRANSITION",
      category: "lifecycle",
      message: `Invalid target lifecycle for start plan: '${targetLifecycle}'. Target must be 'active' or 'initializing'`,
      details: { from: project.lifecycle, to: targetLifecycle }
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

  // 4. Requirements Evaluation (categories "start" and "continuous")
  const requirementEvaluations: ProjectRequirementEvaluation[] = [];
  for (const req of definition.requirements) {
    if (req.category === "start" || req.category === "continuous") {
      let status: RequirementEvaluationStatus = "satisfied";
      let message: string | undefined;

      if (req.type === "capability") {
        const requiredCap = req.targetRef ?? String(req.value ?? "");
        if (!enabledCaps.includes(requiredCap)) {
          status = "unsatisfied";
          message = `Required capability '${requiredCap}' is not enabled on domain`;
        }
      } else if (req.type === "facility") {
        // External facility requirement check
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
          if (customMap[req.id] === false) {
            status = "unsatisfied";
            message = `Custom requirement '${req.id}' is unsatisfied`;
          }
        }
      }

      if (status !== "satisfied") {
        blockers.push({
          code: "DM_PROJECT_REQUIREMENT_UNSATISFIED",
          category: "requirement",
          message: message ?? `Requirement '${req.id}' (${req.type}) is ${status}`,
          details: { requirementId: req.id, status, type: req.type }
        });
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
    }
  }

  // 5. Economic Costs & Reservation Evaluation (timing: "upfront" or "reserved")
  const economicReservations: ProjectEconomicReservationIntent[] = [];
  // Resolve domain economy accounts if available
  const economyDataRes = tryGetDomainEconomyData(domain);
  const domainAccounts = economyDataRes.ok ? economyDataRes.value.accounts : [];

  for (const cost of definition.costs) {
    if (cost.timing === "upfront" || cost.timing === "reserved") {
      let availableMinor = 0;
      if (
        context.availableResources &&
        typeof context.availableResources[cost.resourceId] === "number"
      ) {
        availableMinor = context.availableResources[cost.resourceId];
      } else {
        const account = domainAccounts.find((a) => a.resourceId === cost.resourceId);
        if (account && account.mode === "native") {
          availableMinor = account.balanceMinor;
        }
      }

      const isAvailable = availableMinor >= cost.amountMinor;
      if (!isAvailable && !cost.optional) {
        blockers.push({
          code: "DM_PROJECT_INSUFFICIENT_FUNDS",
          category: "economy",
          message: `Insufficient funds for resource '${cost.resourceId}': required ${cost.amountMinor} minor, available ${availableMinor} minor`,
          details: {
            resourceId: cost.resourceId,
            requiredMinor: cost.amountMinor,
            availableMinor
          }
        });
      }

      economicReservations.push({
        resourceId: cost.resourceId,
        amountMinor: cost.amountMinor,
        timing: cost.timing,
        accountAvailableMinor: availableMinor,
        isAvailable,
        reason: `${cost.timing} cost for project ${project.id}`
      });
    }
  }

  // 6. Workforce Intent Evaluation
  let workforceIntent: ProjectWorkforceIntent | null = null;
  const assignedContributors = context.contributors ?? [];
  if (assignedContributors.length > 0 || context.parameters?.workforceRequired) {
    const requiredUnits = typeof context.parameters?.workforceRequired === "number"
      ? (context.parameters.workforceRequired as number)
      : undefined;
    const isSufficient = requiredUnits !== undefined
      ? assignedContributors.length >= requiredUnits
      : true;

    if (!isSufficient) {
      blockers.push({
        code: "DM_PROJECT_WORKFORCE_INSUFFICIENT",
        category: "workforce",
        message: `Assigned contributors (${assignedContributors.length}) does not meet required workforce (${requiredUnits})`,
        details: { assigned: assignedContributors.length, required: requiredUnits }
      });
    }

    workforceIntent = {
      requiredUnits,
      assignedContributors: Object.freeze([...assignedContributors]),
      isSufficient
    };
  }

  const isSatisfied = blockers.length === 0;

  return Object.freeze({
    planId: createOpaqueId("plan"),
    projectId: project.id,
    domainUuid: project.domainUuid,
    expectedRevision,
    targetLifecycle,
    requirements: Object.freeze(requirementEvaluations),
    economicReservations: Object.freeze(economicReservations),
    workforceIntent,
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    isSatisfied,
    evaluatedAt: Date.now()
  });
}

/**
 * Commits a satisfied ProjectStartPlan, transitioning the ProjectInstance to active/initializing
 * and appending an opening entry to the project progress history.
 */
export function commitProjectStartPlan(
  plan: ProjectStartPlan,
  project: ProjectInstance,
  options?: { readonly timestamp?: number; readonly userId?: string | null }
): Result<{ readonly project: ProjectInstance; readonly plan: ProjectStartPlan }, PublicError> {
  if (!plan.isSatisfied) {
    return err(
      createPublicError({
        code: "DM_PROJECT_START_BLOCKED",
        category: "conflict",
        message: `Project start plan is blocked by ${plan.blockers.length} blocker(s)`,
        details: { blockers: plan.blockers }
      })
    );
  }

  if (project.id !== plan.projectId || project.domainUuid !== plan.domainUuid) {
    return err(
      createPublicError({
        code: "DM_PROJECT_MISMATCH",
        category: "conflict",
        message: "ProjectInstance does not match ProjectStartPlan"
      })
    );
  }

  if (project.revision !== plan.expectedRevision) {
    return err(
      createPublicError({
        code: "DM_PROJECT_REVISION_MISMATCH",
        category: "conflict",
        message: `Project revision has changed since plan was evaluated: expected ${plan.expectedRevision}, current ${project.revision}`
      })
    );
  }

  const timestamp = options?.timestamp ?? Date.now();
  const sequence = (project.entries?.length ?? 0) + 1;

  const startEntry: ProjectEntry = {
    id: createOpaqueId("prj"),
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence,
    unitsDelta: 0,
    unitsBefore: project.workCompleted,
    unitsAfter: project.workCompleted,
    sourceKind: "command",
    reasonCode: "PROJECT_STARTED",
    requestedByUserId: options?.userId ?? null,
    timestamp,
    note: `Project transitioned from '${project.lifecycle}' to '${plan.targetLifecycle}' via plan ${plan.planId}`
  };

  // Intermediate state transition with updated lifecycle
  const transitioningProject: ProjectInstance = {
    ...project,
    lifecycle: plan.targetLifecycle
  };

  const applyRes = applyProjectEntry(transitioningProject, startEntry);
  if (!applyRes.ok) {
    return applyRes;
  }

  return ok({
    project: applyRes.value,
    plan
  });
}
