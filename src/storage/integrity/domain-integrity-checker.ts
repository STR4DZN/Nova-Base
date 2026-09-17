import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { isJournalEntryUuid } from "../../core/identity/refs.js";
import { resolveEffectiveCapabilities, type CapabilityRegistry } from "../../domains/domain-capabilities.js";
import { validateDomainHierarchy, type DomainHierarchyNode } from "../../domains/domain-hierarchy-validator.js";
import { DOMAIN_SCHEMA_VERSION, type DomainRecord } from "../../domains/domain-schema.js";
import { validateDomainRecord } from "../../domains/domain-validator.js";

export type DomainIntegritySeverity = "error" | "warning";

export interface DomainIntegrityDocument {
  readonly id: string;
  readonly uuid: string;
  readonly name: string;
  readonly record: unknown;
  readonly decodeError?: PublicError;
}

export interface DomainIntegrityIssue {
  readonly code: `DM_${string}`;
  readonly severity: DomainIntegritySeverity;
  readonly message: string;
  readonly domainId?: string;
  readonly details?: unknown;
}

export interface DomainIntegrityReport {
  readonly checked: number;
  readonly healthy: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly issues: readonly DomainIntegrityIssue[];
}

export interface DomainIntegrityCheckerOptions {
  readonly expectedSchemaVersion?: number;
  readonly capabilityRegistry: CapabilityRegistry;
}

function issue(
  code: `DM_${string}`,
  severity: DomainIntegritySeverity,
  message: string,
  domainId?: string,
  details?: unknown
): DomainIntegrityIssue {
  return { code, severity, message, domainId, details };
}

export function createDomainIntegrityReport(
  checked: number,
  issues: readonly DomainIntegrityIssue[]
): DomainIntegrityReport {
  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.length - errorCount;
  return Object.freeze({
    checked,
    healthy: errorCount === 0,
    errorCount,
    warningCount,
    issues: Object.freeze([...issues])
  });
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addRecoverableShapeDiagnostics(
  value: unknown,
  domainId: string,
  expectedSchemaVersion: number,
  issues: DomainIntegrityIssue[]
): void {
  if (!isRecord(value)) return;
  if (typeof value.schemaVersion === "number" && value.schemaVersion !== expectedSchemaVersion) {
    issues.push(issue(
      "DM_DOMAIN_SCHEMA_MISMATCH",
      "error",
      "Domain schemaVersion is not the expected canonical version",
      domainId,
      { expected: expectedSchemaVersion, actual: value.schemaVersion }
    ));
  }
  if (typeof value.revision === "number" && (!Number.isSafeInteger(value.revision) || value.revision < 0)) {
    issues.push(issue(
      "DM_DOMAIN_REVISION_INVALID",
      "error",
      "Domain revision is not a safe non-negative integer",
      domainId,
      { revision: value.revision }
    ));
  }
  if (isRecord(value.state) && isRecord(value.metadata)) {
    const lifecycle = value.state.lifecycle;
    const archivedAt = value.metadata.archivedAt;
    if (lifecycle === "active" || lifecycle === "inactive" || lifecycle === "archived") {
      const archived = lifecycle === "archived";
      if ((archived && archivedAt === null) || (!archived && archivedAt !== null)) {
        issues.push(issue(
          "DM_DOMAIN_LIFECYCLE_INCONSISTENT",
          "error",
          "Domain lifecycle and archivedAt are inconsistent",
          domainId,
          { lifecycle, archivedAt }
        ));
      }
    }
  }
}

function lifecycleIsValid(value: unknown): value is DomainRecord["state"]["lifecycle"] {
  return value === "active" || value === "inactive" || value === "archived";
}

function addLifecycleIssues(
  record: Partial<DomainRecord>,
  domainId: string,
  issues: DomainIntegrityIssue[]
): void {
  const lifecycle = record.state?.lifecycle;
  if (!lifecycleIsValid(lifecycle)) {
    issues.push(issue(
      "DM_DOMAIN_LIFECYCLE_INVALID",
      "error",
      "Domain lifecycle is not a supported value",
      domainId,
      { lifecycle }
    ));
    return;
  }

  const archivedAt = record.metadata?.archivedAt;
  const isArchived = lifecycle === "archived";
  if ((isArchived && archivedAt === null) || (!isArchived && archivedAt !== null)) {
    issues.push(issue(
      "DM_DOMAIN_LIFECYCLE_INCONSISTENT",
      "error",
      "Domain lifecycle and archivedAt are inconsistent",
      domainId,
      { lifecycle, archivedAt }
    ));
  }
}

function addCapabilityIssues(
  record: Partial<DomainRecord>,
  domainId: string,
  registry: CapabilityRegistry,
  issues: DomainIntegrityIssue[]
): void {
  const capabilities = record.definition?.capabilities;
  if (capabilities === undefined) return;
  const resolved = resolveEffectiveCapabilities(capabilities, registry);
  if (!resolved.ok) {
    issues.push(issue(
      resolved.error.code,
      "error",
      resolved.error.message,
      domainId,
      resolved.error.details
    ));
    return;
  }

  for (const warning of resolved.warnings ?? []) {
    issues.push(issue(
      warning.code,
      warning.code === "DM_CAPABILITY_CONFIG_INVALID" ? "error" : "warning",
      warning.message,
      domainId,
      warning.details
    ));
  }

  if (!resolved.value.some((capability) => capability.enabled && capability.functional)) {
    issues.push(issue(
      "DM_NO_FUNCTIONAL_CAPABILITY",
      "error",
      "Domain has no enabled functional capability",
      domainId
    ));
  }
}

function addSchemaIssues(
  document: DomainIntegrityDocument,
  expectedSchemaVersion: number,
  capabilityRegistry: CapabilityRegistry,
  issues: DomainIntegrityIssue[],
  hierarchyNodes: DomainHierarchyNode[]
): void {
  if (document.decodeError !== undefined) {
    issues.push(issue(
      "DM_DOMAIN_PAYLOAD_INVALID",
      "error",
      "Domain payload could not be decoded",
      document.id,
      { sourceCode: document.decodeError.code }
    ));
    return;
  }

  let validation;
  try {
    validation = validateDomainRecord(document.record);
  } catch {
    validation = { ok: false as const, error: createPublicError({
      code: "DM_DOMAIN_SCHEMA_MISMATCH",
      category: "integrity",
      message: "Domain schema validation threw unexpectedly"
    }) };
  }

  if (!validation.ok) {
    issues.push(issue(
      "DM_DOMAIN_SCHEMA_MISMATCH",
      "error",
      "Domain record failed schema validation",
      document.id,
      { sourceCode: validation.error.code }
    ));
    addRecoverableShapeDiagnostics(document.record, document.id, expectedSchemaVersion, issues);
    return;
  }

  const record = document.record as DomainRecord;
  if (record.schemaVersion !== expectedSchemaVersion) {
    issues.push(issue(
      "DM_DOMAIN_SCHEMA_MISMATCH",
      "error",
      "Domain schemaVersion is not the expected canonical version",
      document.id,
      { expected: expectedSchemaVersion, actual: record.schemaVersion }
    ));
  }
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) {
    issues.push(issue(
      "DM_DOMAIN_REVISION_INVALID",
      "error",
      "Domain revision is not a safe non-negative integer",
      document.id,
      { revision: record.revision }
    ));
  }

  addLifecycleIssues(record, document.id, issues);
  addCapabilityIssues(record, document.id, capabilityRegistry, issues);
  hierarchyNodes.push({
    uuid: document.uuid,
    parentDomainUuid: record.definition.hierarchy.parentDomainUuid
  });
}

export class DomainIntegrityChecker {
  private readonly expectedSchemaVersion: number;
  private readonly capabilityRegistry: CapabilityRegistry;

  constructor(options: DomainIntegrityCheckerOptions) {
    this.expectedSchemaVersion = options.expectedSchemaVersion ?? DOMAIN_SCHEMA_VERSION;
    this.capabilityRegistry = options.capabilityRegistry;
  }

  check(documents: readonly DomainIntegrityDocument[]): DomainIntegrityReport {
    const issues: DomainIntegrityIssue[] = [];
    const hierarchyNodes: DomainHierarchyNode[] = [];
    const seenIds = new Set<string>();
    const seenUuids = new Set<string>();

    for (const document of documents) {
      if (seenIds.has(document.id)) {
        issues.push(issue(
          "DM_DOMAIN_DUPLICATE_ID",
          "error",
          "Multiple Domain documents use the same ID",
          document.id
        ));
      }
      seenIds.add(document.id);

      if (seenUuids.has(document.uuid)) {
        issues.push(issue(
          "DM_DOMAIN_DUPLICATE_UUID",
          "error",
          "Multiple Domain documents use the same UUID",
          document.id,
          { uuid: document.uuid }
        ));
      }
      seenUuids.add(document.uuid);

      if (!isJournalEntryUuid(document.uuid)) {
        issues.push(issue(
          "DM_DOMAIN_UUID_INVALID",
          "error",
          "Domain UUID must be a full JournalEntry UUID",
          document.id,
          { uuid: document.uuid }
        ));
      }

      if (typeof document.id !== "string" || document.id.trim().length === 0) {
        issues.push(issue(
          "DM_DOMAIN_ID_INVALID",
          "error",
          "Domain ID cannot be empty",
          document.id
        ));
      }
      if (typeof document.name !== "string" || document.name.trim().length === 0) {
        issues.push(issue(
          "DM_DOMAIN_NAME_INVALID",
          "error",
          "Domain name cannot be empty",
          document.id
        ));
      }
      addSchemaIssues(document, this.expectedSchemaVersion, this.capabilityRegistry, issues, hierarchyNodes);
    }

    const hierarchy = validateDomainHierarchy(hierarchyNodes);
    if (!hierarchy.ok) {
      issues.push(issue(
        hierarchy.error.code,
        "error",
        hierarchy.error.message,
        undefined,
        hierarchy.error.details
      ));
    } else {
      for (const warning of hierarchy.warnings ?? []) {
        const details = warning.details as { nodeUuid?: string; parentUuid?: string } | undefined;
        issues.push(issue(
          "DM_DOMAIN_BROKEN_PARENT",
          "warning",
          warning.message,
          undefined,
          { nodeUuid: details?.nodeUuid, parentUuid: details?.parentUuid }
        ));
      }
    }

    return createDomainIntegrityReport(documents.length, issues);
  }
}
