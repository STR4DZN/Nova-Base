import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";

/**
 * Canonical Downtime Scopes (Master Spec §17, DEC-2751-2900 §4.1).
 */
export type DowntimeScope = "individual" | "group" | "domain" | "flexible";

export const DOWNTIME_SCOPES: readonly DowntimeScope[] = Object.freeze([
  "individual",
  "group",
  "domain",
  "flexible"
]);

/**
 * Canonical Downtime Lifecycle states (Master Spec §17, DEC-2751-2900 §4.2).
 */
export type DowntimeLifecycle =
  | "draft"
  | "planned"
  | "ready"
  | "inProgress"
  | "paused"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

export const DOWNTIME_LIFECYCLE_STATES: readonly DowntimeLifecycle[] = Object.freeze([
  "draft",
  "planned",
  "ready",
  "inProgress",
  "paused",
  "blocked",
  "completed",
  "cancelled",
  "failed"
]);

/**
 * Permitted downtime lifecycle state transitions (Master Spec DEC-2751 §4.2).
 */
const LEGAL_DOWNTIME_TRANSITIONS: Readonly<Record<DowntimeLifecycle, readonly DowntimeLifecycle[]>> = Object.freeze({
  draft: Object.freeze<DowntimeLifecycle[]>(["planned", "ready", "cancelled"]),
  planned: Object.freeze<DowntimeLifecycle[]>(["ready", "inProgress", "blocked", "cancelled"]),
  ready: Object.freeze<DowntimeLifecycle[]>(["inProgress", "planned", "blocked", "cancelled"]),
  inProgress: Object.freeze<DowntimeLifecycle[]>(["paused", "blocked", "completed", "failed", "cancelled"]),
  paused: Object.freeze<DowntimeLifecycle[]>(["inProgress", "cancelled", "failed"]),
  blocked: Object.freeze<DowntimeLifecycle[]>(["inProgress", "ready", "planned", "cancelled", "failed"]),
  completed: Object.freeze<DowntimeLifecycle[]>([]),
  cancelled: Object.freeze<DowntimeLifecycle[]>([]),
  failed: Object.freeze<DowntimeLifecycle[]>(["planned"])
});

/**
 * Validates a proposed lifecycle state transition for a Downtime activity.
 */
export function validateDowntimeLifecycleTransition(
  from: DowntimeLifecycle,
  to: DowntimeLifecycle
): Result<void, PublicError> {
  if (from === to) {
    return ok(undefined);
  }

  const allowed = LEGAL_DOWNTIME_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INVALID_LIFECYCLE_TRANSITION",
        category: "validation",
        message: `Illegal downtime lifecycle transition from '${from}' to '${to}'`
      })
    );
  }

  return ok(undefined);
}

/**
 * Participant types supported by Downtime activities (Master Spec §17, DEC-2751 §4.3).
 * Rule: participant ≠ Foundry User.
 */
export type DowntimeParticipantType = "notable" | "group" | "actor" | "narrative";

export const DOWNTIME_PARTICIPANT_TYPES: readonly DowntimeParticipantType[] = Object.freeze([
  "notable",
  "group",
  "actor",
  "narrative"
]);

export interface DowntimeParticipant {
  readonly participantRef: string;
  readonly participantType: DowntimeParticipantType;
  readonly role: string; // e.g. "owner", "participant", "assistant", "supervisor"
  readonly name?: string;
  readonly capacityConsumed?: number;
}

export function validateDowntimeParticipant(raw: unknown): Result<DowntimeParticipant, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_PARTICIPANT_INVALID",
        category: "validation",
        message: "DowntimeParticipant must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.participantRef !== "string" || candidate.participantRef.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_PARTICIPANT_INVALID",
        category: "validation",
        message: "DowntimeParticipant participantRef is required and must be non-empty"
      })
    );
  }

  if (
    typeof candidate.participantType !== "string" ||
    !DOWNTIME_PARTICIPANT_TYPES.includes(candidate.participantType as DowntimeParticipantType)
  ) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_PARTICIPANT_INVALID",
        category: "validation",
        message: `DowntimeParticipant participantType '${String(candidate.participantType)}' is invalid`
      })
    );
  }

  if (typeof candidate.role !== "string" || candidate.role.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_PARTICIPANT_INVALID",
        category: "validation",
        message: "DowntimeParticipant role is required and must be non-empty"
      })
    );
  }

  let capacityConsumed: number | undefined;
  if (candidate.capacityConsumed !== undefined) {
    if (
      typeof candidate.capacityConsumed !== "number" ||
      !Number.isSafeInteger(candidate.capacityConsumed) ||
      candidate.capacityConsumed < 0
    ) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_PARTICIPANT_INVALID",
          category: "validation",
          message: "DowntimeParticipant capacityConsumed must be a non-negative safe integer"
        })
      );
    }
    capacityConsumed = candidate.capacityConsumed;
  }

  const participant: DowntimeParticipant = {
    participantRef: candidate.participantRef.trim(),
    participantType: candidate.participantType as DowntimeParticipantType,
    role: candidate.role.trim(),
    name: typeof candidate.name === "string" ? candidate.name.trim() : undefined,
    capacityConsumed
  };

  return ok(participant);
}

/**
 * Milestone or stage within a multi-stage Downtime activity (Master Spec DEC-2751 §4.4).
 */
export interface DowntimeStageDefinition {
  readonly id: string;
  readonly label: string;
  readonly durationTicks: number;
  readonly description?: string;
  readonly outcomes?: readonly DowntimeOutcomeDefinition[];
}

/**
 * Declarative outcome produced upon completing or resolving a Downtime activity (Master Spec §17, DEC-2751 §4.7).
 */
export interface DowntimeOutcomeDefinition {
  readonly id: string;
  readonly type: string; // namespaced, e.g. "economy:grant-resource", "project:advance-project", "facility:apply-condition"
  readonly label: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly visibility?: "public" | "gm-only";
  readonly optional?: boolean;
}

/**
 * Receipt proving execution of a Downtime outcome.
 */
export interface DowntimeOutcomeReceipt {
  readonly outcomeId: string;
  readonly appliedAt: number;
  readonly tick?: number | null;
  readonly success: boolean;
  readonly childReceiptId?: string;
  readonly note?: string;
}

/**
 * Reusable Downtime template / definition (Master Spec §17, DEC-2751-2900 §4.1).
 */
export interface DowntimeDefinition {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly scope: DowntimeScope;
  readonly defaultDurationTicks?: number | null;
  readonly minParticipants?: number;
  readonly maxParticipants?: number;
  readonly allowedParticipantRoles?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
  readonly requiredFacilityDefinitions?: readonly string[];
  readonly costs?: readonly { readonly resourceId: string; readonly amount: number }[];
  readonly stages?: readonly DowntimeStageDefinition[];
  readonly outcomeDefinitions?: readonly DowntimeOutcomeDefinition[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function isNamespacedDowntimeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value)
  );
}

export function validateDowntimeDefinition(raw: unknown): Result<DowntimeDefinition, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_DEFINITION_INVALID",
        category: "validation",
        message: "DowntimeDefinition must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. ID (namespaced)
  if (!isNamespacedDowntimeId(candidate.id)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INVALID_ID",
        category: "validation",
        message: `DowntimeDefinition ID must be namespaced (e.g. 'domain-manager:crafting'): received '${String(candidate.id)}'`
      })
    );
  }

  // 2. Version
  const version = typeof candidate.version === "number" ? candidate.version : 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_DEFINITION_INVALID",
        category: "validation",
        message: "DowntimeDefinition version must be a positive safe integer >= 1"
      })
    );
  }

  // 3. Label
  if (typeof candidate.label !== "string" || candidate.label.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_DEFINITION_INVALID",
        category: "validation",
        message: "DowntimeDefinition label is required and must be non-empty"
      })
    );
  }

  // 4. Scope
  const scope = typeof candidate.scope === "string" ? candidate.scope : "individual";
  if (!DOWNTIME_SCOPES.includes(scope as DowntimeScope)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_DEFINITION_INVALID",
        category: "validation",
        message: `Invalid downtime scope: '${String(candidate.scope)}'`
      })
    );
  }

  // 5. Default duration ticks if present
  let defaultDurationTicks: number | null = null;
  if (candidate.defaultDurationTicks !== undefined && candidate.defaultDurationTicks !== null) {
    if (
      typeof candidate.defaultDurationTicks !== "number" ||
      !Number.isSafeInteger(candidate.defaultDurationTicks) ||
      candidate.defaultDurationTicks < 0
    ) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_DEFINITION_INVALID",
          category: "validation",
          message: "DowntimeDefinition defaultDurationTicks must be a non-negative safe integer or null"
        })
      );
    }
    defaultDurationTicks = candidate.defaultDurationTicks;
  }

  // 6. Min/max participants
  let minParticipants: number | undefined;
  if (candidate.minParticipants !== undefined) {
    if (
      typeof candidate.minParticipants !== "number" ||
      !Number.isSafeInteger(candidate.minParticipants) ||
      candidate.minParticipants < 0
    ) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_DEFINITION_INVALID",
          category: "validation",
          message: "minParticipants must be a non-negative safe integer"
        })
      );
    }
    minParticipants = candidate.minParticipants;
  }

  let maxParticipants: number | undefined;
  if (candidate.maxParticipants !== undefined) {
    if (
      typeof candidate.maxParticipants !== "number" ||
      !Number.isSafeInteger(candidate.maxParticipants) ||
      candidate.maxParticipants < 1
    ) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_DEFINITION_INVALID",
          category: "validation",
          message: "maxParticipants must be a positive safe integer >= 1"
        })
      );
    }
    if (minParticipants !== undefined && candidate.maxParticipants < minParticipants) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_DEFINITION_INVALID",
          category: "validation",
          message: "maxParticipants cannot be less than minParticipants"
        })
      );
    }
    maxParticipants = candidate.maxParticipants;
  }

  // 7. Tags
  if (candidate.tags !== undefined && !Array.isArray(candidate.tags)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_DEFINITION_INVALID",
        category: "validation",
        message: "tags must be an array of strings"
      })
    );
  }

  const validated: DowntimeDefinition = {
    id: candidate.id.trim(),
    version,
    label: candidate.label.trim(),
    description: typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    category: typeof candidate.category === "string" ? candidate.category.trim() : undefined,
    tags: Object.freeze([...((candidate.tags as string[]) ?? []).map((t) => String(t).trim())]),
    scope: scope as DowntimeScope,
    defaultDurationTicks,
    minParticipants,
    maxParticipants,
    allowedParticipantRoles: candidate.allowedParticipantRoles && Array.isArray(candidate.allowedParticipantRoles)
      ? Object.freeze([...(candidate.allowedParticipantRoles as string[]).map((r) => String(r).trim())])
      : undefined,
    requiredCapabilities: candidate.requiredCapabilities && Array.isArray(candidate.requiredCapabilities)
      ? Object.freeze([...(candidate.requiredCapabilities as string[]).map((c) => String(c).trim())])
      : undefined,
    requiredFacilityDefinitions: candidate.requiredFacilityDefinitions && Array.isArray(candidate.requiredFacilityDefinitions)
      ? Object.freeze([...(candidate.requiredFacilityDefinitions as string[]).map((f) => String(f).trim())])
      : undefined,
    costs: candidate.costs && Array.isArray(candidate.costs)
      ? Object.freeze([...(candidate.costs as { resourceId: string; amount: number }[])])
      : undefined,
    stages: candidate.stages && Array.isArray(candidate.stages)
      ? Object.freeze([...(candidate.stages as DowntimeStageDefinition[])])
      : undefined,
    outcomeDefinitions: candidate.outcomeDefinitions && Array.isArray(candidate.outcomeDefinitions)
      ? Object.freeze([...(candidate.outcomeDefinitions as DowntimeOutcomeDefinition[])])
      : undefined,
    metadata: candidate.metadata && typeof candidate.metadata === "object"
      ? Object.freeze({ ...(candidate.metadata as Record<string, unknown>) })
      : undefined
  };

  return ok(validated);
}

/**
 * Concrete Downtime activity instance (Master Spec §17, DEC-2751-2900 §4.1).
 */
export interface DowntimeInstance {
  readonly id: string;
  readonly domainUuid?: string | null;
  readonly definitionId: string;
  readonly customDefinition?: DowntimeDefinition | null;
  readonly name: string;
  readonly description?: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly lifecycle: DowntimeLifecycle;
  readonly scope: DowntimeScope;
  readonly participants: readonly DowntimeParticipant[];
  readonly facilityRefs?: readonly string[];
  readonly locationRef?: string | null;
  readonly durationTicks?: number | null; // null indicates indefinite duration
  readonly elapsedTicks: number;
  readonly currentStageIndex?: number;
  readonly outcomesApplied?: readonly DowntimeOutcomeReceipt[];
  readonly tags: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number | null;
  readonly cancelledAt?: number | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function validateDowntimeInstance(raw: unknown): Result<DowntimeInstance, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INSTANCE_INVALID",
        category: "validation",
        message: "DowntimeInstance must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. ID
  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INSTANCE_INVALID",
        category: "validation",
        message: "DowntimeInstance id is required and must be non-empty"
      })
    );
  }

  // 2. Definition ID
  if (typeof candidate.definitionId !== "string" || candidate.definitionId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INSTANCE_INVALID",
        category: "validation",
        message: "DowntimeInstance definitionId is required and must be non-empty"
      })
    );
  }

  // 3. Name
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INSTANCE_INVALID",
        category: "validation",
        message: "DowntimeInstance name is required and must be non-empty"
      })
    );
  }

  // 4. SchemaVersion
  const schemaVersion = typeof candidate.schemaVersion === "number" ? candidate.schemaVersion : 1;
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INSTANCE_INVALID",
        category: "validation",
        message: "DowntimeInstance schemaVersion must be a positive safe integer >= 1"
      })
    );
  }

  // 5. Revision
  const revision = typeof candidate.revision === "number" ? candidate.revision : 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INSTANCE_INVALID",
        category: "validation",
        message: "DowntimeInstance revision must be a safe integer >= 0"
      })
    );
  }

  // 6. Lifecycle
  if (
    typeof candidate.lifecycle !== "string" ||
    !DOWNTIME_LIFECYCLE_STATES.includes(candidate.lifecycle as DowntimeLifecycle)
  ) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INVALID_LIFECYCLE",
        category: "validation",
        message: `DowntimeInstance lifecycle '${String(candidate.lifecycle)}' is invalid`
      })
    );
  }

  // 7. Scope
  const scope = typeof candidate.scope === "string" ? candidate.scope : "individual";
  if (!DOWNTIME_SCOPES.includes(scope as DowntimeScope)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INSTANCE_INVALID",
        category: "validation",
        message: `DowntimeInstance scope '${String(candidate.scope)}' is invalid`
      })
    );
  }

  // 8. Participants
  const participants: DowntimeParticipant[] = [];
  if (candidate.participants !== undefined) {
    if (!Array.isArray(candidate.participants)) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_INSTANCE_INVALID",
          category: "validation",
          message: "DowntimeInstance participants must be an array"
        })
      );
    }
    for (const part of candidate.participants) {
      const vPart = validateDowntimeParticipant(part);
      if (!vPart.ok) {
        return err(vPart.error);
      }
      participants.push(vPart.value);
    }
  }

  // 9. Duration and elapsed ticks
  let durationTicks: number | null = null;
  if (candidate.durationTicks !== undefined && candidate.durationTicks !== null) {
    if (
      typeof candidate.durationTicks !== "number" ||
      !Number.isSafeInteger(candidate.durationTicks) ||
      candidate.durationTicks < 0
    ) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_INSTANCE_INVALID",
          category: "validation",
          message: "DowntimeInstance durationTicks must be a non-negative safe integer or null"
        })
      );
    }
    durationTicks = candidate.durationTicks;
  }

  const elapsedTicks = typeof candidate.elapsedTicks === "number" ? candidate.elapsedTicks : 0;
  if (!Number.isSafeInteger(elapsedTicks) || elapsedTicks < 0) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INSTANCE_INVALID",
        category: "validation",
        message: "DowntimeInstance elapsedTicks must be a non-negative safe integer"
      })
    );
  }

  // 10. Timestamps
  const createdAt = typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now();
  const updatedAt = typeof candidate.updatedAt === "number" ? candidate.updatedAt : createdAt;

  const instance: DowntimeInstance = {
    id: candidate.id.trim(),
    domainUuid: typeof candidate.domainUuid === "string" ? candidate.domainUuid.trim() : null,
    definitionId: candidate.definitionId.trim(),
    customDefinition: candidate.customDefinition ? (candidate.customDefinition as DowntimeDefinition) : null,
    name: candidate.name.trim(),
    description: typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    schemaVersion,
    revision,
    lifecycle: candidate.lifecycle as DowntimeLifecycle,
    scope: scope as DowntimeScope,
    participants: Object.freeze(participants),
    facilityRefs: candidate.facilityRefs && Array.isArray(candidate.facilityRefs)
      ? Object.freeze([...(candidate.facilityRefs as string[]).map((f) => String(f).trim())])
      : undefined,
    locationRef: typeof candidate.locationRef === "string" ? candidate.locationRef.trim() : null,
    durationTicks,
    elapsedTicks,
    currentStageIndex: typeof candidate.currentStageIndex === "number" ? candidate.currentStageIndex : undefined,
    outcomesApplied: candidate.outcomesApplied && Array.isArray(candidate.outcomesApplied)
      ? Object.freeze([...(candidate.outcomesApplied as DowntimeOutcomeReceipt[])])
      : undefined,
    tags: Object.freeze([...((candidate.tags as string[]) ?? []).map((t) => String(t).trim())]),
    createdAt,
    updatedAt,
    completedAt: typeof candidate.completedAt === "number" ? candidate.completedAt : null,
    cancelledAt: typeof candidate.cancelledAt === "number" ? candidate.cancelledAt : null,
    metadata: candidate.metadata && typeof candidate.metadata === "object"
      ? Object.freeze({ ...(candidate.metadata as Record<string, unknown>) })
      : undefined
  };

  return ok(instance);
}

/**
 * Evaluates whether a downtime activity has reached completion.
 * Rule: "indefinite downtime não auto-completa" (Master Spec §17).
 */
export function isDowntimeComplete(instance: DowntimeInstance): boolean {
  if (instance.lifecycle === "completed") {
    return true;
  }
  if (instance.durationTicks === null || instance.durationTicks === undefined) {
    // Indefinite downtime never auto-completes
    return false;
  }
  return instance.elapsedTicks >= instance.durationTicks;
}

export interface DowntimeProgress {
  readonly isIndefinite: boolean;
  readonly percent: number | null;
  readonly elapsedTicks: number;
  readonly durationTicks: number | null;
}

/**
 * Derives the progress state for a Downtime instance.
 * Rule: Indefinite downtime returns percent: null (no fake 100%).
 */
export function calculateDowntimeProgress(instance: DowntimeInstance): DowntimeProgress {
  const isIndefinite = instance.durationTicks === null || instance.durationTicks === undefined;
  if (isIndefinite) {
    return {
      isIndefinite: true,
      percent: null,
      elapsedTicks: instance.elapsedTicks,
      durationTicks: null
    };
  }

  const total = instance.durationTicks as number;
  const percent = total > 0
    ? Math.min(100, Math.max(0, Math.floor((instance.elapsedTicks / total) * 100)))
    : 100;

  return {
    isIndefinite: false,
    percent,
    elapsedTicks: instance.elapsedTicks,
    durationTicks: total
  };
}

