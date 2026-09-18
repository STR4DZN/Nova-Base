import type { DomainRecord } from "../../../domains/domain-schema.js";
import type { DomainDocument } from "../../../storage/repositories/domain-repository.js";
import { getDomainPeopleData, type DomainPeopleData } from "../../../people/people-data.js";
import { calculatePopulation } from "../../../people/population/population-calculator.js";
import type { PopulationResolution, PopulationState } from "../../../people/population/population-types.js";
import { resolveNotableStatus, type Notable, type NotableStatusReport } from "../../../people/notables/notable-types.js";
import { evaluateRole, type RoleEvaluation, DEFAULT_ROLE_DEFINITIONS, type RoleDefinition } from "../../../people/roles/role-types.js";
import type { OperationalGroup } from "../../../people/operational-groups/operational-group-types.js";
import { calculateWorkforce } from "../../../people/workforce/workforce-calculator.js";
import type { WorkforceReport } from "../../../people/workforce/workforce-types.js";
import { resolvePeopleEffectiveCapabilities, type DomainEffectiveCapabilitiesReport } from "../../../aggregation/people-grants.js";

export interface PeoplePresenterOptions {
  readonly viewerIsGm: boolean;
  readonly nowReal?: number;
  readonly actorResolver?: (uuid: string) => { name: string; img?: string } | null | undefined;
  readonly customRoleDefinitions?: readonly RoleDefinition[];
  readonly allowedRestrictedRefs?: readonly string[];
}

export interface NotableViewModel {
  readonly notable: Notable;
  readonly status: NotableStatusReport;
  readonly isSecret: boolean;
  readonly badgeClass: string;
}

export interface RoleViewModel {
  readonly evaluation: RoleEvaluation;
  readonly isSecret: boolean;
  readonly statusClass: "vacant" | "understaffed" | "filled";
}

export interface OperationalGroupViewModel {
  readonly group: OperationalGroup;
  readonly isSecret: boolean;
  readonly statusClass: "active" | "inactive" | "disbanded";
}

export interface PeopleSubsystemViewModel {
  readonly domainUuid: string;
  readonly viewerIsGm: boolean;
  readonly population: {
    readonly state: PopulationState;
    readonly resolution: PopulationResolution;
    readonly formattedTotal: string;
  };
  readonly notables: readonly NotableViewModel[];
  readonly roles: readonly RoleViewModel[];
  readonly operationalGroups: readonly OperationalGroupViewModel[];
  readonly workforce: WorkforceReport;
  readonly capabilities: DomainEffectiveCapabilitiesReport;
}

import { PeopleProjectionService } from "../../../projection/people/people-projection-service.js";

export function buildPeopleViewModel(
  domainInput: DomainDocument | DomainRecord,
  options: PeoplePresenterOptions
): PeopleSubsystemViewModel {
  const record: DomainRecord = "record" in domainInput ? domainInput.record : domainInput;
  const domainUuid = "uuid" in domainInput ? domainInput.uuid : "unknown";
  const people: DomainPeopleData = getDomainPeopleData(record);

  const projectionService = new PeopleProjectionService({
    roleDefinitions: options.customRoleDefinitions
  });
  const context = projectionService.project(
    domainUuid,
    people,
    { userId: "viewer", isGm: options.viewerIsGm },
    {
      nowReal: options.nowReal,
      domainCapabilities: record.definition?.capabilities?.enabled
    }
  );

  // 1. Population formatting
  let formattedTotal: string;
  if (context.population.resolution.total === null) {
    formattedTotal = "Unknown";
  } else {
    formattedTotal = `${context.population.resolution.total.toLocaleString("en-US")}${
      context.population.resolution.precision === "estimated" ? " (est.)" : ""
    }`;
  }

  // 2. Notables ViewModels
  const notableVMs: NotableViewModel[] = context.notables.map((n) => {
    const status = resolveNotableStatus(n, options.actorResolver);
    let badgeClass = "healthy";
    if (status.isBrokenRef) badgeClass = "broken";

    return {
      notable: n,
      status,
      isSecret: n.visibility === "secret",
      badgeClass
    };
  });

  // 3. Roles ViewModels
  const roleDefs = options.customRoleDefinitions ?? DEFAULT_ROLE_DEFINITIONS;
  const roleVMs: RoleViewModel[] = context.roles.map((r) => {
    const evaluation = evaluateRole(r, roleDefs, context.operationalGroups);
    let statusClass: "vacant" | "understaffed" | "filled" = "filled";
    if (evaluation.isVacant) statusClass = "vacant";
    else if (evaluation.isUnderstaffed) statusClass = "understaffed";

    return {
      evaluation,
      isSecret: r.visibility === "secret",
      statusClass
    };
  });

  // 4. Operational Groups ViewModels
  const opgVMs: OperationalGroupViewModel[] = context.operationalGroups.map((g) => ({
    group: g,
    isSecret: g.visibility === "secret",
    statusClass: g.lifecycle
  }));

  return {
    domainUuid,
    viewerIsGm: options.viewerIsGm,
    population: {
      state: context.population.state,
      resolution: context.population.resolution,
      formattedTotal
    },
    notables: Object.freeze(notableVMs),
    roles: Object.freeze(roleVMs),
    operationalGroups: Object.freeze(opgVMs),
    workforce: context.workforce,
    capabilities: context.capabilities
  };
}
