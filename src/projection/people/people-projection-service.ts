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
    options: { nowReal?: number; domainCapabilities?: readonly string[] } = {}
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
    options: { nowReal?: number; domainCapabilities?: readonly string[] }
  ): AdministrativePeopleContext {
    const popRes = calculatePopulation(rawPeople.population, rawPeople.populationGroups);
    const workforce = calculateWorkforce(rawPeople, options.nowReal);
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
    options: { nowReal?: number; domainCapabilities?: readonly string[] }
  ): ViewerPeopleContext {
    // 1. Filter secret PopulationGroups
    const visiblePopGroups = rawPeople.populationGroups.filter((g) => g.visibility !== "secret");
    const secretGroupIds = new Set<string>(
      rawPeople.populationGroups.filter((g) => g.visibility === "secret").map((g) => g.id)
    );

    // 2. Filter secret Notables
    const visibleNotables = rawPeople.notables.filter((n) => n.visibility !== "secret");
    const secretNotableIds = new Set<string>(
      rawPeople.notables.filter((n) => n.visibility === "secret").map((n) => n.id)
    );

    // 3. Filter secret Roles and remove secret occupants
    const visibleRoles: DomainRole[] = rawPeople.roles
      .filter((r) => r.visibility !== "secret")
      .map((r) => {
        const visibleOccupants = r.occupants.filter((occId) => !secretNotableIds.has(occId));
        if (visibleOccupants.length === r.occupants.length) return r;
        return {
          ...r,
          occupants: Object.freeze(visibleOccupants)
        };
      });

    // 4. Filter secret OperationalGroups and remove secret members
    const visibleOpGroups: OperationalGroup[] = rawPeople.operationalGroups
      .filter((g) => g.visibility !== "secret")
      .map((g) => {
        const visibleMembers = g.members.filter((mId) => !secretNotableIds.has(mId));
        if (visibleMembers.length === g.members.length) return g;
        return {
          ...g,
          members: Object.freeze(visibleMembers)
        };
      });
    const secretOpGroupIds = new Set<string>(
      rawPeople.operationalGroups.filter((g) => g.visibility === "secret").map((g) => g.id)
    );

    // 5. Filter secret Assignments & Reservations (or pointing to secret sources)
    const visibleAssignments = (rawPeople.assignments ?? []).filter((a) => {
      if (a.visibility === "secret") return false;
      if (secretGroupIds.has(a.sourceRef)) return false;
      if (secretOpGroupIds.has(a.sourceRef)) return false;
      if (secretNotableIds.has(a.sourceRef)) return false;
      return true;
    });

    const visibleReservations = (rawPeople.reservations ?? []).filter((r) => {
      if (r.visibility === "secret") return false;
      if (secretGroupIds.has(r.sourceRef)) return false;
      if (secretOpGroupIds.has(r.sourceRef)) return false;
      if (secretNotableIds.has(r.sourceRef)) return false;
      return true;
    });

    // 6. Population projection: if state itself is secret, redact completely
    let projectedPopState = rawPeople.population;
    if (rawPeople.population.visibility === "secret") {
      projectedPopState = {
        mode: "manual",
        total: null,
        precision: "unknown",
        visibility: "secret"
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
    const workforce = calculateWorkforce(projectedPeopleData, options.nowReal);

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
