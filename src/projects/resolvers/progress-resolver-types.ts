import type { PublicError } from "../../core/contracts/public-error.js";
import type { Result } from "../../core/contracts/result.js";
import type { ProjectContributorRef, ProjectEntrySourceKind } from "../types/project-entry-types.js";
import type { ProjectDefinition, ProjectInstance } from "../types/project-types.js";

/**
 * Read-only context provided to a ProgressResolver (Master Spec §15.3, Anexo 07 §2.1).
 * Resolvers MUST NOT mutate the input project or definition.
 */
export interface ProjectProgressContext {
  readonly project: ProjectInstance;
  readonly definition: ProjectDefinition;
  readonly domainUuid: string;
  readonly requestedUnits?: number;
  readonly contributor?: ProjectContributorRef | null;
  readonly sourceKind: ProjectEntrySourceKind;
  readonly sourceRef?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly worldTime?: number | null;
  readonly realTime?: number;
}

/**
 * Step detail for progress resolution auditing.
 */
export interface ProjectProgressBreakdownStep {
  readonly step: string;
  readonly delta: number;
  readonly note?: string;
}

/**
 * Resolution output calculated purely by a ProgressResolver.
 */
export interface ProjectProgressResolution {
  readonly deltaWork: number;
  readonly reasonCode: string;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly effectiveWorkforce?: number;
  readonly breakdown?: readonly ProjectProgressBreakdownStep[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Contract for extensible project progress resolvers (Master Spec §15.3, Anexo 07 §2.1).
 */
export interface ProgressResolver {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  resolve(context: ProjectProgressContext): Result<ProjectProgressResolution, PublicError>;
}
