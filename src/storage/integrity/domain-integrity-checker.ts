import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { isJournalEntryUuid } from "../../core/identity/refs.js";
import { resolveEffectiveCapabilities, type CapabilityRegistry } from "../../domains/domain-capabilities.js";
import { validateDomainHierarchy, type DomainHierarchyNode } from "../../domains/domain-hierarchy-validator.js";
import { DOMAIN_SCHEMA_VERSION, type DomainRecord } from "../../domains/domain-schema.js";
import { validateDomainRecord } from "../../domains/domain-validator.js";
import { validateDomainPeopleData } from "../../people/people-data.js";
import { DEFAULT_ROLE_DEFINITIONS } from "../../people/roles/role-types.js";
import { DEFAULT_OPERATIONAL_GROUP_DEFINITIONS } from "../../people/operational-groups/operational-group-types.js";
import { calculateWorkforce } from "../../people/workforce/workforce-calculator.js";
import { defaultAssignmentTargetRegistry } from "../../people/assignments/assignment-types.js";

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

function addPeopleIntegrityIssues(
  record: Partial<DomainRecord>,
  domainId: string,
  issues: DomainIntegrityIssue[]
): void {
  const config = record.definition?.capabilities?.config;
  if (!config || typeof config !== "object") return;

  const rawPeople = (config as Record<string, unknown>)["domain-manager:people"];
  if (rawPeople === undefined || rawPeople === null) return;

  // 1. Validate People schema structure
  const validation = validateDomainPeopleData(rawPeople);
  if (!validation.ok) {
    issues.push(issue(
      validation.error.code as `DM_${string}`,
      "error",
      `People subsystem data corruption: ${validation.error.message}`,
      domainId,
      validation.error.details
    ));
    return;
  }

  const people = validation.value;
  const notableIds = new Set<string>(people.notables.map((n) => n.id));
  const groupIds = new Set<string>(people.operationalGroups.map((g) => g.id));
  const popGroupIds = new Set<string>(people.populationGroups.map((pg) => pg.id));

  // 2. Check Notables
  for (const n of people.notables) {
    if (n.type === "actor") {
      if (typeof n.actorUuid !== "string" || !n.actorUuid.startsWith("Actor.")) {
        issues.push(issue(
          "DM_PEOPLE_INVALID_ACTOR_REF",
          "error",
          `Notable '${n.id}' has invalid Actor reference '${n.actorUuid}'`,
          domainId,
          { notableId: n.id, actorUuid: n.actorUuid }
        ));
      }
    }
  }

  // 3. Check Roles: dangling occupants and group references
  for (const r of people.roles) {
    for (const occupantId of r.occupants) {
      if (!notableIds.has(occupantId)) {
        issues.push(issue(
          "DM_PEOPLE_DANGLING_NOTABLE_REF",
          "error",
          `Role '${r.id}' references non-existent notable '${occupantId}'`,
          domainId,
          { roleId: r.id, notableId: occupantId }
        ));
      }
    }
    if (r.scope === "operational-group" && r.operationalGroupId) {
      if (!groupIds.has(r.operationalGroupId)) {
        issues.push(issue(
          "DM_PEOPLE_DANGLING_GROUP_REF",
          "error",
          `Group role '${r.id}' references non-existent operational group '${r.operationalGroupId}'`,
          domainId,
          { roleId: r.id, operationalGroupId: r.operationalGroupId }
        ));
      }
    }
  }

  // 4. Check OperationalGroups: dangling members and population group references
  for (const g of people.operationalGroups) {
    for (const memberId of g.members) {
      if (!notableIds.has(memberId)) {
        issues.push(issue(
          "DM_PEOPLE_DANGLING_NOTABLE_REF",
          "error",
          `Operational group '${g.id}' references non-existent notable '${memberId}'`,
          domainId,
          { groupId: g.id, notableId: memberId }
        ));
      }
    }
    if (g.populationGroupId && !popGroupIds.has(g.populationGroupId)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_POPULATION_GROUP_REF",
        "error",
        `Operational group '${g.id}' references non-existent population group '${g.populationGroupId}'`,
        domainId,
        { groupId: g.id, populationGroupId: g.populationGroupId }
      ));
    }
  }

  // 5. Check Assignments & Reservations: sourceRef validity
  for (const a of people.assignments) {
    if (a.sourceRef.startsWith("opg_") && !groupIds.has(a.sourceRef as any)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_SOURCE_REF",
        "warning",
        `Assignment '${a.id}' references non-existent operational group '${a.sourceRef}'`,
        domainId,
        { assignmentId: a.id, sourceRef: a.sourceRef }
      ));
    } else if (a.sourceRef.startsWith("pop_") && !popGroupIds.has(a.sourceRef as any)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_SOURCE_REF",
        "warning",
        `Assignment '${a.id}' references non-existent population group '${a.sourceRef}'`,
        domainId,
        { assignmentId: a.id, sourceRef: a.sourceRef }
      ));
    }
  }

  for (const resv of people.reservations) {
    if (resv.sourceRef.startsWith("opg_") && !groupIds.has(resv.sourceRef as any)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_SOURCE_REF",
        "warning",
        `Reservation '${resv.id}' references non-existent operational group '${resv.sourceRef}'`,
        domainId,
        { reservationId: resv.id, sourceRef: resv.sourceRef }
      ));
    } else if (resv.sourceRef.startsWith("pop_") && !popGroupIds.has(resv.sourceRef as any)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_SOURCE_REF",
        "warning",
        `Reservation '${resv.id}' references non-existent population group '${resv.sourceRef}'`,
        domainId,
        { reservationId: resv.id, sourceRef: resv.sourceRef }
      ));
    }
  }

  // 6. Check Roles & OperationalGroups: Unknown definitions
  const knownRoleDefIds = new Set(DEFAULT_ROLE_DEFINITIONS.map((d) => d.id));
  for (const r of people.roles) {
    if (!knownRoleDefIds.has(r.definitionId) && !r.definitionId.startsWith("custom:")) {
      issues.push(issue(
        "DM_PEOPLE_UNKNOWN_ROLE_DEFINITION",
        "warning",
        `Role '${r.id}' uses unrecognized definition '${r.definitionId}'`,
        domainId,
        { roleId: r.id, definitionId: r.definitionId }
      ));
    }
  }

  const knownGroupDefIds = new Set(DEFAULT_OPERATIONAL_GROUP_DEFINITIONS.map((d) => d.id));
  for (const g of people.operationalGroups) {
    if (!knownGroupDefIds.has(g.definitionId) && !g.definitionId.startsWith("custom:")) {
      issues.push(issue(
        "DM_PEOPLE_UNKNOWN_GROUP_DEFINITION",
        "warning",
        `Operational group '${g.id}' uses unrecognized definition '${g.definitionId}'`,
        domainId,
        { groupId: g.id, definitionId: g.definitionId }
      ));
    }
  }

  // 7. Check OperationalGroups: Explicit membership size mismatch
  for (const g of people.operationalGroups) {
    if (g.membershipMode === "explicit" && g.size !== g.members.length) {
      issues.push(issue(
        "DM_PEOPLE_EXPLICIT_MEMBERSHIP_MISMATCH",
        "warning",
        `Explicit operational group '${g.id}' (${g.name}) size (${g.size}) does not match member count (${g.members.length})`,
        domainId,
        { groupId: g.id, size: g.size, memberCount: g.members.length }
      ));
    }
  }

  // 8. Check Assignments & Reservations: targetRef validity
  for (const a of people.assignments) {
    if (!defaultAssignmentTargetRegistry.isValidTarget(a.targetRef)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_TARGET_REF",
        "warning",
        `Assignment '${a.id}' references unrecognized target '${a.targetRef}'`,
        domainId,
        { assignmentId: a.id, targetRef: a.targetRef }
      ));
    }
  }

  for (const resv of people.reservations) {
    if (!defaultAssignmentTargetRegistry.isValidTarget(resv.targetRef)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_TARGET_REF",
        "warning",
        `Reservation '${resv.id}' references unrecognized target '${resv.targetRef}'`,
        domainId,
        { reservationId: resv.id, targetRef: resv.targetRef }
      ));
    }
  }

  // 9. Check Population: Indeterminate sumGroups
  if (people.population.mode === "sumGroups") {
    const hasIndeterminate = people.populationGroups.length === 0 || people.populationGroups.some(
      (pg) => pg.count === null || pg.precision === "unknown"
    );
    if (hasIndeterminate) {
      issues.push(issue(
        "DM_PEOPLE_INDETERMINATE_SUM_GROUPS",
        "warning",
        "Population sumGroups mode contains groups with indeterminate or unknown counts",
        domainId,
        { groupCount: people.populationGroups.length }
      ));
    }
  }

  // 10. Check Workforce Overcommit
  const wfReport = calculateWorkforce(people);
  if (wfReport.isAnyOvercommitted) {
    issues.push(issue(
      "DM_PEOPLE_WORKFORCE_OVERCOMMIT",
      "warning",
      "One or more workforce types are overcommitted in the domain",
      domainId,
      { warnings: wfReport.warnings }
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
  addPeopleIntegrityIssues(record, document.id, issues);
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
