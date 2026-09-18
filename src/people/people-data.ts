import type { DomainRecord } from "../domains/domain-schema.js";
import type { PopulationGroup, PopulationState } from "./population/population-types.js";
import { validatePopulationGroup, validatePopulationState } from "./population/population-types.js";
import type { Notable } from "./notables/notable-types.js";
import { validateNotable } from "./notables/notable-types.js";
import type { DomainRole } from "./roles/role-types.js";
import { validateDomainRole } from "./roles/role-types.js";
import type { OperationalGroup } from "./operational-groups/operational-group-types.js";
import { validateOperationalGroup } from "./operational-groups/operational-group-types.js";
import type { Assignment, Reservation } from "./assignments/assignment-types.js";
import { validateAssignment, validateReservation } from "./assignments/assignment-types.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { createPublicError } from "../core/contracts/public-error.js";

export const PEOPLE_CAPABILITY_ID = "domain-manager:people" as const;
export const PEOPLE_CAPABILITY_ALIAS = "domain:people" as const;
export const PEOPLE_SCHEMA_VERSION = 1 as const;

export interface DomainPeopleData {
  readonly schemaVersion: typeof PEOPLE_SCHEMA_VERSION;
  readonly population: PopulationState;
  readonly populationGroups: readonly PopulationGroup[];
  readonly notables: readonly Notable[];
  readonly roles: readonly DomainRole[];
  readonly operationalGroups: readonly OperationalGroup[];
  readonly assignments: readonly Assignment[];
  readonly reservations: readonly Reservation[];
}

export function createDefaultDomainPeopleData(): DomainPeopleData {
  return {
    schemaVersion: PEOPLE_SCHEMA_VERSION,
    population: {
      mode: "manual",
      total: null,
      precision: "unknown"
    },
    populationGroups: Object.freeze([]),
    notables: Object.freeze([]),
    roles: Object.freeze([]),
    operationalGroups: Object.freeze([]),
    assignments: Object.freeze([]),
    reservations: Object.freeze([])
  };
}

export function validateDomainPeopleData(raw: unknown): Result<DomainPeopleData> {
  if (!raw || typeof raw !== "object") {
    return err(
      createPublicError({
        code: "DM_PEOPLE_DATA_INVALID",
        category: "validation",
        message: "People data must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (candidate.schemaVersion !== PEOPLE_SCHEMA_VERSION) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_SCHEMA_VERSION",
        category: "validation",
        message: `Invalid People schemaVersion: ${String(candidate.schemaVersion)}. Expected ${PEOPLE_SCHEMA_VERSION}`
      })
    );
  }

  const popResult = validatePopulationState(candidate.population);
  if (!popResult.ok) {
    return popResult;
  }

  if (!Array.isArray(candidate.populationGroups)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_GROUPS",
        category: "validation",
        message: "populationGroups must be an array"
      })
    );
  }

  const validatedGroups: PopulationGroup[] = [];
  const groupIds = new Set<string>();

  for (const g of candidate.populationGroups) {
    const groupResult = validatePopulationGroup(g);
    if (!groupResult.ok) {
      return groupResult;
    }
    if (groupIds.has(groupResult.value.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_GROUP_ID",
          category: "validation",
          message: `Duplicate population group ID found: ${groupResult.value.id}`
        })
      );
    }
    groupIds.add(groupResult.value.id);
    validatedGroups.push(groupResult.value);
  }

  if (candidate.notables !== undefined && !Array.isArray(candidate.notables)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_NOTABLES",
        category: "validation",
        message: "notables must be an array"
      })
    );
  }

  const rawNotables = Array.isArray(candidate.notables) ? candidate.notables : [];
  const validatedNotables: Notable[] = [];
  const notableIds = new Set<string>();
  const notableActorUuids = new Set<string>();

  for (const n of rawNotables) {
    const notableResult = validateNotable(n);
    if (!notableResult.ok) {
      return notableResult;
    }
    const val = notableResult.value;
    if (notableIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_NOTABLE_ID",
          category: "validation",
          message: `Duplicate notable ID found: ${val.id}`
        })
      );
    }
    notableIds.add(val.id);

    if (val.type === "actor") {
      if (notableActorUuids.has(val.actorUuid)) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_DUPLICATE_ACTOR",
            category: "validation",
            message: `Actor '${val.actorUuid}' is already linked to a Notable in this domain`
          })
        );
      }
      notableActorUuids.add(val.actorUuid);
    }
    validatedNotables.push(val);
  }

  if (candidate.roles !== undefined && !Array.isArray(candidate.roles)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_ROLES",
        category: "validation",
        message: "roles must be an array"
      })
    );
  }

  const rawRoles = Array.isArray(candidate.roles) ? candidate.roles : [];
  const validatedRoles: DomainRole[] = [];
  const roleIds = new Set<string>();

  for (const r of rawRoles) {
    const roleResult = validateDomainRole(r);
    if (!roleResult.ok) {
      return roleResult;
    }
    const val = roleResult.value;
    if (roleIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_ROLE_ID",
          category: "validation",
          message: `Duplicate role ID found: ${val.id}`
        })
      );
    }
    roleIds.add(val.id);

    // Verify all occupants reference valid notables in this domain (DEC-0996)
    for (const occupantId of val.occupants) {
      if (!notableIds.has(occupantId)) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_NOT_FOUND",
            category: "not-found",
            message: `Role occupant notable '${occupantId}' does not exist in domain`
          })
        );
      }
    }

    validatedRoles.push(val);
  }

  if (candidate.operationalGroups !== undefined && !Array.isArray(candidate.operationalGroups)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_OPERATIONAL_GROUPS",
        category: "validation",
        message: "operationalGroups must be an array"
      })
    );
  }

  const rawOperationalGroups = Array.isArray(candidate.operationalGroups) ? candidate.operationalGroups : [];
  const validatedOperationalGroups: OperationalGroup[] = [];
  const opgIds = new Set<string>();

  for (const o of rawOperationalGroups) {
    const opgResult = validateOperationalGroup(o);
    if (!opgResult.ok) {
      return opgResult;
    }
    const val = opgResult.value;
    if (opgIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_OPERATIONAL_GROUP_ID",
          category: "validation",
          message: `Duplicate operational group ID found: ${val.id}`
        })
      );
    }
    opgIds.add(val.id);

    // Verify all members reference valid notables in this domain (DEC-1069)
    for (const memberId of val.members) {
      if (!notableIds.has(memberId)) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_NOT_FOUND",
            category: "not-found",
            message: `OperationalGroup member notable '${memberId}' does not exist in domain`
          })
        );
      }
    }

    // Verify populationGroupId references valid populationGroup in this domain if specified (DEC-1062)
    if (val.populationGroupId !== undefined && !groupIds.has(val.populationGroupId)) {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_NOT_FOUND",
          category: "not-found",
          message: `Linked population group '${val.populationGroupId}' does not exist in domain`
        })
      );
    }

    validatedOperationalGroups.push(val);
  }

  if (candidate.assignments !== undefined && !Array.isArray(candidate.assignments)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_ASSIGNMENTS",
        category: "validation",
        message: "assignments must be an array"
      })
    );
  }

  const rawAssignments = Array.isArray(candidate.assignments) ? candidate.assignments : [];
  const validatedAssignments: Assignment[] = [];
  const asgIds = new Set<string>();

  for (const a of rawAssignments) {
    const asgRes = validateAssignment(a);
    if (!asgRes.ok) {
      return asgRes;
    }
    const val = asgRes.value;
    if (asgIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_ASSIGNMENT_ID",
          category: "validation",
          message: `Duplicate assignment ID found: ${val.id}`
        })
      );
    }
    asgIds.add(val.id);
    validatedAssignments.push(val);
  }

  if (candidate.reservations !== undefined && !Array.isArray(candidate.reservations)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_RESERVATIONS",
        category: "validation",
        message: "reservations must be an array"
      })
    );
  }

  const rawReservations = Array.isArray(candidate.reservations) ? candidate.reservations : [];
  const validatedReservations: Reservation[] = [];
  const resvIds = new Set<string>();

  for (const r of rawReservations) {
    const resvRes = validateReservation(r);
    if (!resvRes.ok) {
      return resvRes;
    }
    const val = resvRes.value;
    if (resvIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_RESERVATION_ID",
          category: "validation",
          message: `Duplicate reservation ID found: ${val.id}`
        })
      );
    }
    resvIds.add(val.id);
    validatedReservations.push(val);
  }

  return ok({
    schemaVersion: PEOPLE_SCHEMA_VERSION,
    population: popResult.value,
    populationGroups: Object.freeze(validatedGroups),
    notables: Object.freeze(validatedNotables),
    roles: Object.freeze(validatedRoles),
    operationalGroups: Object.freeze(validatedOperationalGroups),
    assignments: Object.freeze(validatedAssignments),
    reservations: Object.freeze(validatedReservations)
  });
}

export function getDomainPeopleData(domain: DomainRecord | { record: DomainRecord }): DomainPeopleData {
  const record = "record" in domain ? domain.record : domain;
  const config = record?.definition?.capabilities?.config ?? {};
  const rawPeople = config[PEOPLE_CAPABILITY_ID];
  if (!rawPeople) {
    return createDefaultDomainPeopleData();
  }

  const validated = validateDomainPeopleData(rawPeople);
  if (!validated.ok) {
    return createDefaultDomainPeopleData();
  }
  return validated.value;
}

export function withDomainPeopleData(domain: DomainRecord, peopleData: DomainPeopleData): DomainRecord {
  const currentEnabled = domain.definition.capabilities.enabled;
  const newEnabled = currentEnabled.includes(PEOPLE_CAPABILITY_ID)
    ? currentEnabled
    : Object.freeze([...currentEnabled, PEOPLE_CAPABILITY_ID]);

  const newConfig = Object.freeze({
    ...domain.definition.capabilities.config,
    [PEOPLE_CAPABILITY_ID]: peopleData
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
