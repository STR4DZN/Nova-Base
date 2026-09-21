import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { ProjectEntry } from "./project-entry-types.js";
import { validateProjectEntry } from "./project-entry-types.js";

export {
  type ProjectEntry,
  type ProjectEntrySourceKind,
  type ProjectContributorRef,
  PROJECT_ENTRY_SOURCE_KINDS,
  validateProjectEntry,
  applyProjectEntry
} from "./project-entry-types.js";

/**
 * Canonical Project lifecycle states (Master Spec §15.4, §15.5, Anexo 07 §1.4).
 * - "initializing": internal technical state during atomic start to prevent partial start (Master §15.5).
 */
export type ProjectLifecycle =
  | "draft"
  | "planned"
  | "approved"
  | "initializing"
  | "active"
  | "blocked"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived";

export const PROJECT_LIFECYCLE_STATES: readonly ProjectLifecycle[] = Object.freeze([
  "draft",
  "planned",
  "approved",
  "initializing",
  "active",
  "blocked",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "archived"
]);

/**
 * Permitted lifecycle state transitions (Master Spec §15.4, Anexo 07 §1.4).
 */
const LEGAL_TRANSITIONS: Readonly<Record<ProjectLifecycle, readonly ProjectLifecycle[]>> = Object.freeze({
  draft: Object.freeze<ProjectLifecycle[]>(["planned", "cancelled", "archived"]),
  planned: Object.freeze<ProjectLifecycle[]>(["draft", "approved", "cancelled", "archived"]),
  approved: Object.freeze<ProjectLifecycle[]>(["initializing", "active", "paused", "cancelled", "archived"]),
  initializing: Object.freeze<ProjectLifecycle[]>(["active", "blocked", "failed", "approved"]),
  active: Object.freeze<ProjectLifecycle[]>(["blocked", "paused", "completed", "failed", "cancelled"]),
  blocked: Object.freeze<ProjectLifecycle[]>(["active", "paused", "failed", "cancelled"]),
  paused: Object.freeze<ProjectLifecycle[]>(["active", "cancelled", "archived"]),
  completed: Object.freeze<ProjectLifecycle[]>(["archived"]),
  failed: Object.freeze<ProjectLifecycle[]>(["archived", "draft"]),
  cancelled: Object.freeze<ProjectLifecycle[]>(["archived", "draft"]),
  archived: Object.freeze<ProjectLifecycle[]>([])
});

/**
 * Validates a proposed lifecycle state transition for a Project.
 * Reopening completed projects requires explicit allowReopen option (DEC-2306-2450 §1.4).
 */
export function validateProjectLifecycleTransition(
  from: ProjectLifecycle,
  to: ProjectLifecycle,
  options?: { readonly allowReopen?: boolean }
): Result<void, PublicError> {
  if (from === to) {
    return ok(undefined);
  }

  // Explicit reopen override for terminal states
  if (options?.allowReopen) {
    if (from === "completed" && (to === "active" || to === "approved")) {
      return ok(undefined);
    }
    if (from === "archived" && (to === "draft" || to === "planned")) {
      return ok(undefined);
    }
  }

  const allowed = LEGAL_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INVALID_TRANSITION",
        category: "validation",
        message: `Illegal project lifecycle transition from '${from}' to '${to}'`
      })
    );
  }

  return ok(undefined);
}

/**
 * Cost timing policies for project resource consumption (DEC-2306-2450 §2.7).
 */
export type ProjectCostTiming = "upfront" | "reserved" | "progressive" | "onCompletion";

export interface ProjectCostDefinition {
  readonly resourceId: string;
  readonly amountMinor: number;
  readonly timing: ProjectCostTiming;
  readonly optional?: boolean;
}

export type ProjectRequirementCategory = "start" | "advance" | "continuous" | "completion";

export interface ProjectRequirementDefinition {
  readonly id: string;
  readonly category: ProjectRequirementCategory;
  readonly type: string;
  readonly targetRef?: string;
  readonly value?: unknown;
  readonly label?: string;
}

export interface ProjectRewardDefinition {
  readonly type: "facility" | "facility:create" | "resource" | "resource:credit" | "capability" | "custom" | string;
  readonly targetRef?: string;
  readonly value?: unknown;
  readonly label?: string;
}

/**
 * Reusable Project template / definition (Master Spec §15.2, Anexo 07 §1.1, §7.1).
 */
export interface ProjectDefinition {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly progressResolverId: string;
  readonly defaultWorkRequired: number;
  readonly requirements: readonly ProjectRequirementDefinition[];
  readonly costs: readonly ProjectCostDefinition[];
  readonly rewards: readonly ProjectRewardDefinition[];
  readonly autoComplete?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function isNamespacedProjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value)
  );
}

export function validateProjectDefinition(raw: unknown): Result<ProjectDefinition, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_INVALID",
        category: "validation",
        message: "ProjectDefinition must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. ID (namespaced)
  if (!isNamespacedProjectId(candidate.id)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INVALID_ID",
        category: "validation",
        message: `ProjectDefinition ID must be namespaced (e.g. 'domain-manager:construction'): received '${String(candidate.id)}'`
      })
    );
  }

  // 2. Version
  const version = typeof candidate.version === "number" ? candidate.version : 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_INVALID",
        category: "validation",
        message: "ProjectDefinition version must be a positive safe integer >= 1"
      })
    );
  }

  // 3. Label
  if (typeof candidate.label !== "string" || candidate.label.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_INVALID",
        category: "validation",
        message: "ProjectDefinition label is required and must be non-empty"
      })
    );
  }

  // 4. Progress resolver ID
  const resolverId = candidate.progressResolverId ?? "domain-manager:standard";
  if (!isNamespacedProjectId(resolverId)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_INVALID",
        category: "validation",
        message: `ProjectDefinition progressResolverId must be namespaced: received '${String(resolverId)}'`
      })
    );
  }

  // 5. Default work required (safe positive integer)
  if (
    typeof candidate.defaultWorkRequired !== "number" ||
    !Number.isSafeInteger(candidate.defaultWorkRequired) ||
    candidate.defaultWorkRequired < 1
  ) {
    return err(
      createPublicError({
        code: "DM_PROJECT_WORK_REQUIRED_INVALID",
        category: "validation",
        message: "ProjectDefinition defaultWorkRequired must be a positive safe integer >= 1"
      })
    );
  }

  // 6. Tags
  if (candidate.tags !== undefined && !Array.isArray(candidate.tags)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_INVALID",
        category: "validation",
        message: "ProjectDefinition tags must be an array of strings"
      })
    );
  }

  // 7. Costs validation
  if (candidate.costs !== undefined && !Array.isArray(candidate.costs)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_INVALID",
        category: "validation",
        message: "ProjectDefinition costs must be an array"
      })
    );
  }
  const costs: ProjectCostDefinition[] = [];
  if (Array.isArray(candidate.costs)) {
    for (let i = 0; i < candidate.costs.length; i++) {
      const c = candidate.costs[i];
      if (!c || typeof c !== "object") {
        return err(
          createPublicError({
            code: "DM_PROJECT_DEFINITION_INVALID",
            category: "validation",
            message: `Invalid cost definition at index ${i}`
          })
        );
      }
      if (typeof c.resourceId !== "string" || !c.resourceId.trim()) {
        return err(
          createPublicError({
            code: "DM_PROJECT_DEFINITION_INVALID",
            category: "validation",
            message: `Cost at index ${i} missing required resourceId`
          })
        );
      }
      if (typeof c.amountMinor !== "number" || !Number.isSafeInteger(c.amountMinor) || c.amountMinor <= 0) {
        return err(
          createPublicError({
            code: "DM_PROJECT_DEFINITION_INVALID",
            category: "validation",
            message: `Cost at index ${i} amountMinor must be a positive safe integer`
          })
        );
      }
      const validTimings = ["upfront", "reserved", "progressive", "onCompletion"];
      if (typeof c.timing !== "string" || !validTimings.includes(c.timing)) {
        return err(
          createPublicError({
            code: "DM_PROJECT_DEFINITION_INVALID",
            category: "validation",
            message: `Cost at index ${i} timing must be one of: ${validTimings.join(", ")}`
          })
        );
      }
      costs.push({
        resourceId: c.resourceId.trim(),
        amountMinor: c.amountMinor,
        timing: c.timing as ProjectCostTiming,
        optional: Boolean(c.optional)
      });
    }
  }

  // 8. Requirements validation
  if (candidate.requirements !== undefined && !Array.isArray(candidate.requirements)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_INVALID",
        category: "validation",
        message: "ProjectDefinition requirements must be an array"
      })
    );
  }

  // 9. Rewards validation
  if (candidate.rewards !== undefined && !Array.isArray(candidate.rewards)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DEFINITION_INVALID",
        category: "validation",
        message: "ProjectDefinition rewards must be an array"
      })
    );
  }

  const validated: ProjectDefinition = {
    id: candidate.id.trim(),
    version,
    label: candidate.label.trim(),
    description: typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    category: typeof candidate.category === "string" ? candidate.category.trim() : undefined,
    tags: Object.freeze([...((candidate.tags as string[]) ?? []).map((t) => String(t).trim())]),
    progressResolverId: String(resolverId).trim(),
    defaultWorkRequired: candidate.defaultWorkRequired,
    requirements: Object.freeze([...((candidate.requirements as ProjectRequirementDefinition[]) ?? [])]),
    costs: Object.freeze(costs),
    rewards: Object.freeze([...((candidate.rewards as ProjectRewardDefinition[]) ?? [])]),
    autoComplete: Boolean(candidate.autoComplete),
    metadata: candidate.metadata && typeof candidate.metadata === "object"
      ? Object.freeze({ ...(candidate.metadata as Record<string, unknown>) })
      : undefined
  };

  return ok(validated);
}

/**
 * Concrete Project instance running on a Domain (Master Spec §15.2, §15.3, Anexo 07 §1.1, §7.1).
 */
export interface ProjectInstance {
  readonly id: string;
  readonly domainUuid: string;
  readonly definitionId: string;
  readonly customDefinition?: ProjectDefinition | null;
  readonly name: string;
  readonly description?: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly lifecycle: ProjectLifecycle;
  readonly workRequired: number;
  readonly workCompleted: number;
  readonly clampProgress?: boolean;
  readonly priority?: number;
  readonly tags: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number | null;
  readonly blockedReason?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly entries?: readonly ProjectEntry[];
}

export function validateProjectInstance(raw: unknown): Result<ProjectInstance, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INSTANCE_INVALID",
        category: "validation",
        message: "ProjectInstance must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. ID
  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INSTANCE_INVALID",
        category: "validation",
        message: "ProjectInstance id is required and must be non-empty"
      })
    );
  }

  // 2. Domain UUID
  if (typeof candidate.domainUuid !== "string" || candidate.domainUuid.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INSTANCE_INVALID",
        category: "validation",
        message: "ProjectInstance domainUuid is required and must be non-empty"
      })
    );
  }

  // 3. Definition ID
  if (typeof candidate.definitionId !== "string" || candidate.definitionId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INSTANCE_INVALID",
        category: "validation",
        message: "ProjectInstance definitionId is required and must be non-empty"
      })
    );
  }

  // 4. Custom definition if provided
  if (candidate.customDefinition !== undefined && candidate.customDefinition !== null) {
    const customRes = validateProjectDefinition(candidate.customDefinition);
    if (!customRes.ok) {
      return customRes;
    }
  }

  // 5. Name
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INSTANCE_INVALID",
        category: "validation",
        message: "ProjectInstance name is required and must be non-empty"
      })
    );
  }

  // 6. SchemaVersion
  const schemaVersion = typeof candidate.schemaVersion === "number" ? candidate.schemaVersion : 1;
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INSTANCE_INVALID",
        category: "validation",
        message: "ProjectInstance schemaVersion must be a positive safe integer >= 1"
      })
    );
  }

  // 7. Revision
  const revision = typeof candidate.revision === "number" ? candidate.revision : 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INSTANCE_INVALID",
        category: "validation",
        message: "ProjectInstance revision must be a safe integer >= 0"
      })
    );
  }

  // 8. Lifecycle
  if (
    typeof candidate.lifecycle !== "string" ||
    !PROJECT_LIFECYCLE_STATES.includes(candidate.lifecycle as ProjectLifecycle)
  ) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INVALID_LIFECYCLE",
        category: "validation",
        message: `ProjectInstance lifecycle '${String(candidate.lifecycle)}' is invalid. Valid states: ${PROJECT_LIFECYCLE_STATES.join(", ")}`
      })
    );
  }

  // 9. Work required (safe positive integer)
  if (
    typeof candidate.workRequired !== "number" ||
    !Number.isSafeInteger(candidate.workRequired) ||
    candidate.workRequired < 1
  ) {
    return err(
      createPublicError({
        code: "DM_PROJECT_WORK_REQUIRED_INVALID",
        category: "validation",
        message: "ProjectInstance workRequired must be a positive safe integer >= 1"
      })
    );
  }

  // 10. Work completed (safe non-negative integer)
  if (
    typeof candidate.workCompleted !== "number" ||
    !Number.isSafeInteger(candidate.workCompleted) ||
    candidate.workCompleted < 0
  ) {
    return err(
      createPublicError({
        code: "DM_PROJECT_WORK_COMPLETED_INVALID",
        category: "validation",
        message: "ProjectInstance workCompleted must be a safe integer >= 0"
      })
    );
  }

  // 11. Timestamps
  const createdAt = typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now();
  const updatedAt = typeof candidate.updatedAt === "number" ? candidate.updatedAt : createdAt;

  // 12. Entries if provided
  let validatedEntries: ProjectEntry[] = [];
  if (candidate.entries !== undefined && candidate.entries !== null) {
    if (!Array.isArray(candidate.entries)) {
      return err(
        createPublicError({
          code: "DM_PROJECT_INSTANCE_INVALID",
          category: "validation",
          message: "ProjectInstance entries must be an array"
        })
      );
    }
    const entryIds = new Set<string>();
    for (let i = 0; i < candidate.entries.length; i++) {
      const eRes = validateProjectEntry(candidate.entries[i]);
      if (!eRes.ok) {
        return eRes;
      }
      if (entryIds.has(eRes.value.id)) {
        return err(
          createPublicError({
            code: "DM_PROJECT_ENTRY_DUPLICATE_ID",
            category: "conflict",
            message: `Duplicate entry ID in project: ${eRes.value.id}`
          })
        );
      }
      entryIds.add(eRes.value.id);
      validatedEntries.push(eRes.value);
    }
  }

  const instance: ProjectInstance = {
    id: candidate.id.trim(),
    domainUuid: candidate.domainUuid.trim(),
    definitionId: candidate.definitionId.trim(),
    customDefinition: candidate.customDefinition
      ? (candidate.customDefinition as ProjectDefinition)
      : null,
    name: candidate.name.trim(),
    description: typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    schemaVersion,
    revision,
    lifecycle: candidate.lifecycle as ProjectLifecycle,
    workRequired: candidate.workRequired,
    workCompleted: candidate.workCompleted,
    clampProgress: candidate.clampProgress !== undefined ? Boolean(candidate.clampProgress) : true,
    priority: typeof candidate.priority === "number" && Number.isSafeInteger(candidate.priority) ? candidate.priority : undefined,
    tags: Object.freeze([...((candidate.tags as string[]) ?? []).map((t) => String(t).trim())]),
    createdAt,
    updatedAt,
    completedAt: typeof candidate.completedAt === "number" ? candidate.completedAt : null,
    blockedReason: typeof candidate.blockedReason === "string" ? candidate.blockedReason.trim() : null,
    metadata: candidate.metadata && typeof candidate.metadata === "object"
      ? Object.freeze({ ...(candidate.metadata as Record<string, unknown>) })
      : undefined,
    entries: Object.freeze(validatedEntries)
  };

  return ok(instance);
}

export interface ProjectProgress {
  readonly workCompleted: number;
  readonly workRequired: number;
  readonly percent: number;
  readonly isComplete: boolean;
  readonly remainingUnits: number;
}

/**
 * Pure helper for derived project progress metrics (Master Spec §15.3, DEC-086, DEC-087, DEC-090).
 * - Completed work units and required work units are strictly safe integers.
 * - Percentage is derived: Math.floor((completed / required) * 100).
 * - Clamp ensures percentage does not exceed 100% unless clamp is disabled.
 */
export function calculateProjectProgress(
  projectOrWorkCompleted: ProjectInstance | number,
  workRequired?: number,
  clamp: boolean = true
): ProjectProgress {
  let completed: number;
  let required: number;
  let shouldClamp = clamp;

  if (typeof projectOrWorkCompleted === "object" && projectOrWorkCompleted !== null) {
    completed = projectOrWorkCompleted.workCompleted;
    required = projectOrWorkCompleted.workRequired;
    shouldClamp = projectOrWorkCompleted.clampProgress ?? true;
  } else {
    completed = projectOrWorkCompleted;
    required = workRequired ?? 0;
  }

  if (!Number.isSafeInteger(completed) || !Number.isSafeInteger(required) || required <= 0) {
    return {
      workCompleted: Number.isSafeInteger(completed) ? completed : 0,
      workRequired: Number.isSafeInteger(required) ? required : 0,
      percent: 0,
      isComplete: false,
      remainingUnits: Math.max(0, Number.isSafeInteger(required) ? required : 0)
    };
  }

  const rawPercent = (completed / required) * 100;
  const percent = shouldClamp ? Math.min(100, Math.max(0, Math.floor(rawPercent))) : Math.floor(rawPercent);
  const isComplete = completed >= required;
  const remainingUnits = Math.max(0, required - completed);

  return {
    workCompleted: completed,
    workRequired: required,
    percent,
    isComplete,
    remainingUnits
  };
}

