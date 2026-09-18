import type { DomainPeopleData } from "../../people/people-data.js";
import type { PopulationGroup, PopulationResolution, PopulationState } from "../../people/population/population-types.js";
import { calculatePopulation } from "../../people/population/population-calculator.js";
import type { Notable } from "../../people/notables/notable-types.js";
import type { DomainRole, RoleDefinition } from "../../people/roles/role-types.js";
import { DEFAULT_ROLE_DEFINITIONS } from "../../people/roles/role-types.js";
import type { OperationalGroup, OperationalGroupDefinition } from "../../people/operational-groups/operational-group-types.js";
import { DEFAULT_OPERATIONAL_GROUP_DEFINITIONS } from "../../people/operational-groups/operational-group-types.js";
import type { Assignment, Reservation } from "../../people/assignments/assignment-types.js";
import { calculateWorkforce } from "../../people/workforce/workforce-calculator.js";
import type { WorkforceReport } from "../../people/workforce/workforce-types.js";
import { createDefaultCapabilityResolver } from "../../aggregation/capability-resolver.js";
import type { DomainEffectiveCapabilitiesReport } from "../../aggregation/people-grants.js";
import type { ViewerIdentity } from "../viewer-identity.js";

export interface ViewerPeopleContext {
  readonly domainUuid: string;
  readonly viewer: ViewerIdentity;
  readonly population: {
    readonly state: PopulationState;
    readonly resolution: PopulationResolution;
  };
  readonly populationGroups: readonly PopulationGroup[];
  readonly notables: readonly Notable[];
  readonly roles: readonly DomainRole[];
  readonly operationalGroups: readonly OperationalGroup[];
  readonly assignments: readonly Assignment[];
  readonly reservations: readonly Reservation[];
  readonly workforce: WorkforceReport;
  readonly capabilities: DomainEffectiveCapabilitiesReport;
}

export interface AdministrativePeopleContext extends ViewerPeopleContext {
  readonly rawPeopleData: DomainPeopleData;
  readonly hiddenSecretCounts: {
    readonly populationGroups: number;
    readonly notables: number;
    readonly roles: number;
    readonly operationalGroups: number;
    readonly assignments: number;
    readonly reservations: number;
  };
}

export function isEntityVisible(
  entity: { readonly id?: string; readonly visibility?: "public" | "restricted" | "secret" },
  viewer: ViewerIdentity
): boolean {
  if (viewer.isGm) {
    return true;
  }
  const vis = entity.visibility ?? "public";
  if (vis === "secret") {
    return false;
  }
  if (vis === "restricted") {
    if (!viewer.allowedRestrictedRefs || !entity.id) {
      return false;
    }
    return viewer.allowedRestrictedRefs.includes(entity.id);
  }
  return true;
}

export class PeopleProjectionService {
  readonly #roleDefinitions: readonly RoleDefinition[];
  readonly #groupDefinitions: readonly OperationalGroupDefinition[];

  constructor(options: {
    roleDefinitions?: readonly RoleDefinition[];
    groupDefinitions?: readonly OperationalGroupDefinition[];
  } = {}) {
    this.#roleDefinitions = options.roleDefinitions ?? DEFAULT_ROLE_DEFINITIONS;
    this.#groupDefinitions = options.groupDefinitions ?? DEFAULT_OPERATIONAL_GROUP_DEFINITIONS;
  }

  project(
    domainUuid: string,
    rawPeople: DomainPeopleData,
    viewer: ViewerIdentity,
    options: { nowReal?: number; nowWorld?: number; domainCapabilities?: readonly string[] } = {}
  ): ViewerPeopleContext | AdministrativePeopleContext {
    if (viewer.isGm) {
      return this.#projectAdministrative(domainUuid, rawPeople, viewer, options);
    }
    return this.#projectViewer(domainUuid, rawPeople, viewer, options);
  }

  #projectAdministrative(
    domainUuid: string,
    rawPeople: DomainPeopleData,
    viewer: ViewerIdentity,
    options: { nowReal?: number; nowWorld?: number; domainCapabilities?: readonly string[] }
  ): AdministrativePeopleContext {
    const popRes = calculatePopulation(rawPeople.population, rawPeople.populationGroups);
    const workforce = calculateWorkforce(rawPeople, { nowReal: options.nowReal, nowWorld: options.nowWorld });
    const resolver = createDefaultCapabilityResolver();
    const capabilities = resolver.resolveEffectiveCapabilities({
      domainUuid,
      domainRecord: options.domainCapabilities ? {
        schemaVersion: 1,
        definition: {
          name: "Administrative View",
          capabilities: { enabled: [...options.domainCapabilities] }
        }
      } as any : undefined,
      peopleData: rawPeople,
      roleDefinitions: this.#roleDefinitions,
      operationalGroupDefinitions: this.#groupDefinitions
    });

    const hiddenSecretCounts = {
      populationGroups: rawPeople.populationGroups.filter((g) => g.visibility === "secret").length,
      notables: rawPeople.notables.filter((n) => n.visibility === "secret").length,
      roles: rawPeople.roles.filter((r) => r.visibility === "secret").length,
      operationalGroups: rawPeople.operationalGroups.filter((g) => g.visibility === "secret").length,
      assignments: (rawPeople.assignments ?? []).filter((a) => a.visibility === "secret").length,
      reservations: (rawPeople.reservations ?? []).filter((r) => r.visibility === "secret").length
    };

    return Object.freeze({
      domainUuid,
      viewer,
      population: Object.freeze({
        state: rawPeople.population,
        resolution: popRes
      }),
      populationGroups: rawPeople.populationGroups,
      notables: rawPeople.notables,
      roles: rawPeople.roles,
      operationalGroups: rawPeople.operationalGroups,
      assignments: Object.freeze(rawPeople.assignments ?? []),
      reservations: Object.freeze(rawPeople.reservations ?? []),
      workforce,
      capabilities,
      rawPeopleData: rawPeople,
      hiddenSecretCounts
    });
  }

  #projectViewer(
    domainUuid: string,
    rawPeople: DomainPeopleData,
    viewer: ViewerIdentity,
    options: { nowReal?: number; nowWorld?: number; domainCapabilities?: readonly string[] }
  ): ViewerPeopleContext {
    // 1. Filter PopulationGroups using fail-closed visibility
    const visiblePopGroups = rawPeople.populationGroups.filter((g) => isEntityVisible(g, viewer));
    const hiddenPopGroupIds = new Set<string>(
      rawPeople.populationGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id)
    );

    // 2. Filter Notables using fail-closed visibility
    const visibleNotables = rawPeople.notables.filter((n) => isEntityVisible(n, viewer));
    const hiddenNotableIds = new Set<string>(
      rawPeople.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id)
    );

    // 3. Deep projection of Roles: filter non-visible roles, and strip hidden occupants
    const visibleRoles: DomainRole[] = rawPeople.roles
      .filter((r) => isEntityVisible(r, viewer))
      .map((r) => {
        const visibleOccupants = r.occupants.filter((occId) => !hiddenNotableIds.has(occId));
        if (visibleOccupants.length === r.occupants.length) return r;
        return {
          ...r,
          occupants: Object.freeze(visibleOccupants)
        };
      });

    // 4. Deep projection of OperationalGroups: filter non-visible groups, and strip hidden members
    const visibleOpGroups: OperationalGroup[] = rawPeople.operationalGroups
      .filter((g) => isEntityVisible(g, viewer))
      .map((g) => {
        const visibleMembers = g.members.filter((mId) => !hiddenNotableIds.has(mId));
        if (visibleMembers.length === g.members.length) return g;
        return {
          ...g,
          members: Object.freeze(visibleMembers)
        };
      });
    const hiddenOpGroupIds = new Set<string>(
      rawPeople.operationalGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id)
    );

    // 5. Filter Assignments & Reservations (hidden visibility or pointing to hidden sources)
    const visibleAssignments = (rawPeople.assignments ?? []).filter((a) => {
      if (!isEntityVisible(a, viewer)) return false;
      if (hiddenPopGroupIds.has(a.sourceRef)) return false;
      if (hiddenOpGroupIds.has(a.sourceRef)) return false;
      if (hiddenNotableIds.has(a.sourceRef)) return false;
      return true;
    });

    const visibleReservations = (rawPeople.reservations ?? []).filter((r) => {
      if (!isEntityVisible(r, viewer)) return false;
      if (hiddenPopGroupIds.has(r.sourceRef)) return false;
      if (hiddenOpGroupIds.has(r.sourceRef)) return false;
      if (hiddenNotableIds.has(r.sourceRef)) return false;
      return true;
    });

    // 6. Population projection: if state itself is not visible, redact completely
    let projectedPopState = rawPeople.population;
    const isPopStateVisible = isEntityVisible({ id: "population", visibility: rawPeople.population.visibility }, viewer);
    if (!isPopStateVisible) {
      projectedPopState = {
        mode: "manual",
        total: null,
        precision: "unknown",
        visibility: rawPeople.population.visibility
      };
    }

    // Calculate population strictly from visible groups
    const popRes = calculatePopulation(projectedPopState, visiblePopGroups);

    // 7. Projected People Data for derived calculations
    const projectedPeopleData: DomainPeopleData = {
      schemaVersion: rawPeople.schemaVersion,
      population: projectedPopState,
      populationGroups: Object.freeze(visiblePopGroups),
      notables: Object.freeze(visibleNotables),
      roles: Object.freeze(visibleRoles),
      operationalGroups: Object.freeze(visibleOpGroups),
      assignments: Object.freeze(visibleAssignments),
      reservations: Object.freeze(visibleReservations)
    };

    // Derived workforce computed strictly on projected visible data
    const workforce = calculateWorkforce(projectedPeopleData, { nowReal: options.nowReal, nowWorld: options.nowWorld });

    // Derived capabilities computed strictly on projected visible data
    const resolver = createDefaultCapabilityResolver();
    const capabilities = resolver.resolveEffectiveCapabilities({
      domainUuid,
      domainRecord: options.domainCapabilities ? {
        schemaVersion: 1,
        definition: {
          name: "Viewer View",
          capabilities: { enabled: [...options.domainCapabilities] }
        }
      } as any : undefined,
      peopleData: projectedPeopleData,
      roleDefinitions: this.#roleDefinitions,
      operationalGroupDefinitions: this.#groupDefinitions
    });

    return Object.freeze({
      domainUuid,
      viewer,
      population: Object.freeze({
        state: projectedPopState,
        resolution: popRes
      }),
      populationGroups: Object.freeze(visiblePopGroups),
      notables: Object.freeze(visibleNotables),
      roles: Object.freeze(visibleRoles),
      operationalGroups: Object.freeze(visibleOpGroups),
      assignments: Object.freeze(visibleAssignments),
      reservations: Object.freeze(visibleReservations),
      workforce,
      capabilities
    });
  }
}
