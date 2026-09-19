import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { ProjectInstance } from "./project-types.js";

/**
 * Valid sources for progress entry generation (Master Spec §15.3, Anexo 07 §2.2).
 */
export type ProjectEntrySourceKind =
  | "manual"
  | "time"
  | "downtime"
  | "assignment"
  | "facility"
  | "command"
  | "integration"
  | "system";

export const PROJECT_ENTRY_SOURCE_KINDS: readonly ProjectEntrySourceKind[] = Object.freeze([
  "manual",
  "time",
  "downtime",
  "assignment",
  "facility",
  "command",
  "integration",
  "system"
]);

/**
 * Logical contributor reference separate from Foundry user (Master Spec §15.6, Anexo 07 §2.4).
 */
export interface ProjectContributorRef {
  readonly type: "notable" | "populationGroup" | "external" | "narrative";
  readonly ref: string;
  readonly label?: string;
}

/**
 * Append-oriented progress ledger entry for projects (Master Spec §15.3, DEC-088, Anexo 07 §2.2).
 */
export interface ProjectEntry {
  readonly id: string;
  readonly projectId: string;
  readonly domainUuid: string;
  readonly sequence: number;
  readonly unitsDelta: number;
  readonly unitsBefore: number;
  readonly unitsAfter: number;
  readonly sourceKind: ProjectEntrySourceKind;
  readonly sourceRef?: string;
  readonly requestedByUserId?: string | null;
  readonly contributor?: ProjectContributorRef | null;
  readonly worldTime?: number | null;
  readonly timestamp: number;
  readonly reasonCode: string;
  readonly note?: string;
  readonly reversesEntryId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Validates the structure and data constraints of a ProjectEntry.
 */
export function validateProjectEntry(raw: unknown): Result<ProjectEntry, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_INVALID",
        category: "validation",
        message: "ProjectEntry must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. ID
  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_INVALID",
        category: "validation",
        message: "ProjectEntry id is required and must be non-empty"
      })
    );
  }

  // 2. projectId
  if (typeof candidate.projectId !== "string" || candidate.projectId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_INVALID",
        category: "validation",
        message: "ProjectEntry projectId is required and must be non-empty"
      })
    );
  }

  // 3. domainUuid
  if (typeof candidate.domainUuid !== "string" || candidate.domainUuid.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_INVALID",
        category: "validation",
        message: "ProjectEntry domainUuid is required and must be non-empty"
      })
    );
  }

  // 4. sequence (safe integer >= 1)
  if (
    typeof candidate.sequence !== "number" ||
    !Number.isSafeInteger(candidate.sequence) ||
    candidate.sequence < 1
  ) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_INVALID",
        category: "validation",
        message: "ProjectEntry sequence must be a positive safe integer >= 1"
      })
    );
  }

  // 5. unitsDelta (safe integer, positive, zero, or negative for setback)
  if (
    typeof candidate.unitsDelta !== "number" ||
    !Number.isSafeInteger(candidate.unitsDelta)
  ) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_INVALID",
        category: "validation",
        message: "ProjectEntry unitsDelta must be a safe integer"
      })
    );
  }

  // 6. unitsBefore (safe integer >= 0)
  if (
    typeof candidate.unitsBefore !== "number" ||
    !Number.isSafeInteger(candidate.unitsBefore) ||
    candidate.unitsBefore < 0
  ) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_INVALID",
        category: "validation",
        message: "ProjectEntry unitsBefore must be a non-negative safe integer >= 0"
      })
    );
  }

  // 7. unitsAfter (safe integer >= 0)
  if (
    typeof candidate.unitsAfter !== "number" ||
    !Number.isSafeInteger(candidate.unitsAfter) ||
    candidate.unitsAfter < 0
  ) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_INVALID",
        category: "validation",
        message: "ProjectEntry unitsAfter must be a non-negative safe integer >= 0"
      })
    );
  }

  // 8. sourceKind
  if (
    typeof candidate.sourceKind !== "string" ||
    !PROJECT_ENTRY_SOURCE_KINDS.includes(candidate.sourceKind as ProjectEntrySourceKind)
  ) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_INVALID",
        category: "validation",
        message: `ProjectEntry sourceKind '${String(candidate.sourceKind)}' is invalid. Valid kinds: ${PROJECT_ENTRY_SOURCE_KINDS.join(", ")}`
      })
    );
  }

  // 9. reasonCode
  if (typeof candidate.reasonCode !== "string" || candidate.reasonCode.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_INVALID",
        category: "validation",
        message: "ProjectEntry reasonCode is required and must be non-empty"
      })
    );
  }

  // 10. contributor validation if present
  let contributor: ProjectContributorRef | null = null;
  if (candidate.contributor !== undefined && candidate.contributor !== null) {
    if (typeof candidate.contributor !== "object" || Array.isArray(candidate.contributor)) {
      return err(
        createPublicError({
          code: "DM_PROJECT_ENTRY_INVALID",
          category: "validation",
          message: "ProjectEntry contributor must be an object"
        })
      );
    }
    const c = candidate.contributor as Record<string, unknown>;
    const validContribTypes = ["notable", "populationGroup", "external", "narrative"];
    if (typeof c.type !== "string" || !validContribTypes.includes(c.type)) {
      return err(
        createPublicError({
          code: "DM_PROJECT_ENTRY_INVALID",
          category: "validation",
          message: `ProjectEntry contributor type must be one of: ${validContribTypes.join(", ")}`
        })
      );
    }
    if (typeof c.ref !== "string" || c.ref.trim().length === 0) {
      return err(
        createPublicError({
          code: "DM_PROJECT_ENTRY_INVALID",
          category: "validation",
          message: "ProjectEntry contributor ref is required"
        })
      );
    }
    contributor = Object.freeze({
      type: c.type as ProjectContributorRef["type"],
      ref: c.ref.trim(),
      label: typeof c.label === "string" ? c.label.trim() : undefined
    });
  }

  // 11. timestamp
  const timestamp = typeof candidate.timestamp === "number" ? candidate.timestamp : Date.now();

  const validated: ProjectEntry = Object.freeze({
    id: candidate.id.trim(),
    projectId: candidate.projectId.trim(),
    domainUuid: candidate.domainUuid.trim(),
    sequence: candidate.sequence,
    unitsDelta: candidate.unitsDelta,
    unitsBefore: candidate.unitsBefore,
    unitsAfter: candidate.unitsAfter,
    sourceKind: candidate.sourceKind as ProjectEntrySourceKind,
    sourceRef: typeof candidate.sourceRef === "string" ? candidate.sourceRef.trim() : undefined,
    requestedByUserId: typeof candidate.requestedByUserId === "string" ? candidate.requestedByUserId.trim() : null,
    contributor,
    worldTime: typeof candidate.worldTime === "number" ? candidate.worldTime : null,
    timestamp,
    reasonCode: candidate.reasonCode.trim(),
    note: typeof candidate.note === "string" ? candidate.note.trim() : undefined,
    reversesEntryId: typeof candidate.reversesEntryId === "string" ? candidate.reversesEntryId.trim() : null,
    metadata: candidate.metadata && typeof candidate.metadata === "object"
      ? Object.freeze({ ...(candidate.metadata as Record<string, unknown>) })
      : undefined
  });

  return ok(validated);
}

/**
 * Pure transition helper that applies a validated ProjectEntry to a ProjectInstance.
 * Enforces:
 * - Domain and project ID match.
 * - Monotonic entry sequence (sequence === current entries length + 1).
 * - Stale state prevention (unitsBefore === project.workCompleted).
 * - Reversal rules: original entry must exist, cannot reverse a reversal, cannot reverse twice (DEC-088, Anexo 07 §2.3).
 * - Clamp logic according to project.clampProgress (DEC-090).
 * - Increments revision and updates updatedAt.
 */
export function applyProjectEntry(
  project: ProjectInstance,
  entry: ProjectEntry
): Result<ProjectInstance, PublicError> {
  if (entry.projectId !== project.id) {
    return err(
      createPublicError({
        code: "DM_PROJECT_MISMATCH",
        category: "conflict",
        message: `ProjectEntry projectId '${entry.projectId}' does not match ProjectInstance id '${project.id}'`
      })
    );
  }

  if (entry.domainUuid !== project.domainUuid) {
    return err(
      createPublicError({
        code: "DM_PROJECT_MISMATCH",
        category: "conflict",
        message: `ProjectEntry domainUuid '${entry.domainUuid}' does not match ProjectInstance domainUuid '${project.domainUuid}'`
      })
    );
  }

  if (entry.unitsBefore !== project.workCompleted) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_STALE",
        category: "conflict",
        message: `ProjectEntry unitsBefore (${entry.unitsBefore}) does not match current project workCompleted (${project.workCompleted})`
      })
    );
  }

  const existingEntries = project.entries ?? [];
  const expectedSequence = existingEntries.length + 1;
  if (entry.sequence !== expectedSequence) {
    return err(
      createPublicError({
        code: "DM_PROJECT_SEQUENCE_INVALID",
        category: "conflict",
        message: `ProjectEntry sequence (${entry.sequence}) is out of order. Expected ${expectedSequence}`
      })
    );
  }

  // Check duplicate entry ID
  if (existingEntries.some((e) => e.id === entry.id)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_DUPLICATE_ID",
        category: "conflict",
        message: `ProjectEntry ID '${entry.id}' already exists in project history`
      })
    );
  }

  // Reversal verification
  if (entry.reversesEntryId) {
    const originalEntry = existingEntries.find((e) => e.id === entry.reversesEntryId);
    if (!originalEntry) {
      return err(
        createPublicError({
          code: "DM_PROJECT_ENTRY_NOT_FOUND",
          category: "not-found",
          message: `Original project entry '${entry.reversesEntryId}' to reverse was not found`
        })
      );
    }

    if (originalEntry.reversesEntryId) {
      return err(
        createPublicError({
          code: "DM_PROJECT_CANNOT_REVERSE_REVERSAL",
          category: "conflict",
          message: `Cannot reverse entry '${originalEntry.id}' because it is already a reversal`
        })
      );
    }

    const alreadyReversed = existingEntries.some((e) => e.reversesEntryId === entry.reversesEntryId);
    if (alreadyReversed) {
      return err(
        createPublicError({
          code: "DM_PROJECT_REVERSAL_ALREADY_EXISTS",
          category: "conflict",
          message: `Entry '${entry.reversesEntryId}' has already been reversed`
        })
      );
    }

    if (entry.unitsDelta !== -originalEntry.unitsDelta) {
      return err(
        createPublicError({
          code: "DM_PROJECT_INVALID_REVERSAL_DELTA",
          category: "validation",
          message: `Reversal unitsDelta (${entry.unitsDelta}) must be exactly the inverse of original entry delta (${-originalEntry.unitsDelta})`
        })
      );
    }
  }

  // Calculate target workCompleted
  const rawUnitsAfter = project.workCompleted + entry.unitsDelta;
  const nonNegative = Math.max(0, rawUnitsAfter);
  const clampedUnitsAfter = project.clampProgress !== false
    ? Math.min(project.workRequired, nonNegative)
    : nonNegative;

  if (entry.unitsAfter !== clampedUnitsAfter) {
    return err(
      createPublicError({
        code: "DM_PROJECT_ENTRY_UNITS_MISMATCH",
        category: "validation",
        message: `ProjectEntry unitsAfter (${entry.unitsAfter}) does not match expected result (${clampedUnitsAfter})`
      })
    );
  }

  const updatedEntries = Object.freeze([...existingEntries, entry]);
  const updatedProject: ProjectInstance = Object.freeze({
    ...project,
    revision: project.revision + 1,
    workCompleted: clampedUnitsAfter,
    entries: updatedEntries,
    updatedAt: entry.timestamp || Date.now()
  });

  return ok(updatedProject);
}
