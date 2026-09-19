import type { DomainRecord } from "../domains/domain-schema.js";
import type { ProjectInstance } from "./types/project-types.js";
import { validateProjectInstance } from "./types/project-types.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { createPublicError, type PublicError } from "../core/contracts/public-error.js";

export const PROJECTS_CAPABILITY_ID = "domain-manager:projects" as const;
export const PROJECTS_CAPABILITY_ALIAS = "domain:projects" as const;
export const PROJECTS_SCHEMA_VERSION = 1 as const;

/**
 * Domain-level capability data payload for Projects (Master Spec §15, DEC-083).
 * Stored in domain.definition.capabilities.config["domain-manager:projects"].
 */
export interface DomainProjectsData {
  readonly schemaVersion: typeof PROJECTS_SCHEMA_VERSION;
  readonly projects: readonly ProjectInstance[];
}

/**
 * Creates default initial project capability data for a domain.
 */
export function createDefaultDomainProjectsData(): DomainProjectsData {
  return {
    schemaVersion: PROJECTS_SCHEMA_VERSION,
    projects: Object.freeze([])
  };
}

/**
 * Validates a DomainProjectsData object.
 * Enforces schemaVersion, projects array, individual project instance validity, and unique IDs.
 */
export function validateDomainProjectsData(raw: unknown): Result<DomainProjectsData, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_DATA_INVALID",
        category: "validation",
        message: "DomainProjectsData must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (candidate.schemaVersion !== PROJECTS_SCHEMA_VERSION) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INVALID_SCHEMA_VERSION",
        category: "validation",
        message: `Invalid Projects schemaVersion: ${String(candidate.schemaVersion)}. Expected ${PROJECTS_SCHEMA_VERSION}`
      })
    );
  }

  if (!Array.isArray(candidate.projects)) {
    return err(
      createPublicError({
        code: "DM_PROJECT_INVALID_PROJECTS_LIST",
        category: "validation",
        message: "DomainProjectsData projects must be an array"
      })
    );
  }

  const validatedProjects: ProjectInstance[] = [];
  const projectIds = new Set<string>();

  for (let i = 0; i < candidate.projects.length; i++) {
    const p = candidate.projects[i];
    const pRes = validateProjectInstance(p);
    if (!pRes.ok) {
      return pRes;
    }
    const val = pRes.value;
    if (projectIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PROJECT_DUPLICATE_ID",
          category: "validation",
          message: `Duplicate project instance ID found: ${val.id}`
        })
      );
    }
    projectIds.add(val.id);
    validatedProjects.push(val);
  }

  return ok({
    schemaVersion: PROJECTS_SCHEMA_VERSION,
    projects: Object.freeze(validatedProjects)
  });
}

/**
 * Retrieves and validates the DomainProjectsData from a DomainRecord, or returns default if not configured.
 */
export function tryGetDomainProjectsData(
  domain: DomainRecord | { record: DomainRecord }
): Result<DomainProjectsData, PublicError> {
  const record = "record" in domain ? domain.record : domain;
  const config = record?.definition?.capabilities?.config ?? {};
  const rawProjects = config[PROJECTS_CAPABILITY_ID] ?? config[PROJECTS_CAPABILITY_ALIAS];
  if (!rawProjects) {
    return ok(createDefaultDomainProjectsData());
  }

  return validateDomainProjectsData(rawProjects);
}

/**
 * Convenience accessor that throws if domain projects data is corrupted.
 */
export function getDomainProjectsData(
  domain: DomainRecord | { record: DomainRecord }
): DomainProjectsData {
  const res = tryGetDomainProjectsData(domain);
  if (!res.ok) {
    throw new Error(`Domain projects data corruption: [${res.error.code}] ${res.error.message}`);
  }
  return res.value;
}

/**
 * Immutably attaches updated DomainProjectsData to a DomainRecord, ensuring the capability is enabled.
 */
export function withDomainProjectsData(
  domain: DomainRecord,
  projectsData: DomainProjectsData
): DomainRecord {
  const currentEnabled = domain.definition.capabilities.enabled;
  const newEnabled = currentEnabled.includes(PROJECTS_CAPABILITY_ID)
    ? currentEnabled
    : Object.freeze([...currentEnabled, PROJECTS_CAPABILITY_ID]);

  const newConfig = Object.freeze({
    ...domain.definition.capabilities.config,
    [PROJECTS_CAPABILITY_ID]: projectsData
  });

  return {
    ...domain,
    definition: {
      ...domain.definition,
      capabilities: {
        enabled: newEnabled,
        config: newConfig
      }
    }
  };
}
