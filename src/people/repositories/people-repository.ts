import type { DomainRepository } from "../../storage/repositories/domain-repository.js";
import type { PopulationGroup, PopulationResolution, PopulationState } from "../population/population-types.js";
import { calculatePopulation } from "../population/population-calculator.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createPublicError } from "../../core/contracts/public-error.js";
import { tryGetDomainPeopleData, type DomainPeopleData } from "../people-data.js";
import type { Notable, NotableStatusReport } from "../notables/notable-types.js";
import { resolveNotableStatus } from "../notables/notable-types.js";
import type { DomainRole } from "../roles/role-types.js";
import type { OperationalGroup } from "../operational-groups/operational-group-types.js";
import { calculateWorkforce } from "../workforce/workforce-calculator.js";
import type { WorkforceReport } from "../workforce/workforce-types.js";
import type { Assignment, Reservation } from "../assignments/assignment-types.js";

export class PeopleRepository {
  readonly #domainRepository: DomainRepository;

  constructor(domainRepository: DomainRepository) {
    this.#domainRepository = domainRepository;
  }

  async getPeopleData(domainUuid: string): Promise<Result<DomainPeopleData>> {
    const id = domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
    const domainRes = await this.#domainRepository.read(id);
    if (!domainRes.ok) {
      return domainRes;
    }
    return tryGetDomainPeopleData(domainRes.value.record);
  }

  async getPopulation(
    domainUuid: string
  ): Promise<Result<{ state: PopulationState; resolution: PopulationResolution }>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const { population, populationGroups } = peopleRes.value;
    const resolution = calculatePopulation(population, populationGroups);
    return ok({
      state: population,
      resolution
    });
  }

  async getPopulationGroups(domainUuid: string): Promise<Result<readonly PopulationGroup[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    return ok(peopleRes.value.populationGroups);
  }

  async getPopulationGroup(
    domainUuid: string,
    groupId: string
  ): Promise<Result<PopulationGroup>> {
    const groupsRes = await this.getPopulationGroups(domainUuid);
    if (!groupsRes.ok) {
      return groupsRes;
    }
    const found = groupsRes.value.find((g) => g.id === groupId);
    if (!found) {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_NOT_FOUND",
          category: "not-found",
          message: `PopulationGroup '${groupId}' not found in domain '${domainUuid}'`
        })
      );
    }
    return ok(found);
  }

  async getNotables(
    domainUuid: string,
    options: { viewerIsGm?: boolean } = {}
  ): Promise<Result<readonly Notable[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const notables = peopleRes.value.notables;
    if (options.viewerIsGm) {
      return ok(notables);
    }
    return ok(notables.filter((n) => n.visibility !== "secret"));
  }

  async getNotable(
    domainUuid: string,
    notableId: string,
    options: { viewerIsGm?: boolean } = {}
  ): Promise<Result<Notable>> {
    const notablesRes = await this.getNotables(domainUuid, options);
    if (!notablesRes.ok) {
      return notablesRes;
    }
    const found = notablesRes.value.find((n) => n.id === notableId);
    if (!found) {
      return err(
        createPublicError({
          code: "DM_NOTABLE_NOT_FOUND",
          category: "not-found",
          message: `Notable '${notableId}' not found in domain '${domainUuid}'`
        })
      );
    }
    return ok(found);
  }

  async getNotableStatus(
    domainUuid: string,
    notableId: string,
    actorResolver?: (uuid: string) => { name: string; img?: string } | null | undefined,
    options: { viewerIsGm?: boolean } = {}
  ): Promise<Result<NotableStatusReport>> {
    const notableRes = await this.getNotable(domainUuid, notableId, options);
    if (!notableRes.ok) {
      return notableRes;
    }
    return ok(resolveNotableStatus(notableRes.value, actorResolver));
  }
  async getRoles(
    domainUuid: string,
    options: { viewerIsGm?: boolean } = {}
  ): Promise<Result<readonly DomainRole[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const roles = peopleRes.value.roles;
    if (options.viewerIsGm) {
      return ok(roles);
    }
    return ok(roles.filter((r) => r.visibility !== "secret"));
  }

  async getRole(
    domainUuid: string,
    roleId: string,
    options: { viewerIsGm?: boolean } = {}
  ): Promise<Result<DomainRole>> {
    const rolesRes = await this.getRoles(domainUuid, options);
    if (!rolesRes.ok) {
      return rolesRes;
    }
    const found = rolesRes.value.find((r) => r.id === roleId);
    if (!found) {
      return err(
        createPublicError({
          code: "DM_ROLE_NOT_FOUND",
          category: "not-found",
          message: `Role '${roleId}' not found in domain '${domainUuid}'`
        })
      );
    }
    return ok(found);
  }

  async getOperationalGroups(
    domainUuid: string,
    options: { viewerIsGm?: boolean } = {}
  ): Promise<Result<readonly OperationalGroup[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const groups = peopleRes.value.operationalGroups;
    if (options.viewerIsGm) {
      return ok(groups);
    }
    return ok(groups.filter((g) => g.visibility !== "secret"));
  }

  async getOperationalGroup(
    domainUuid: string,
    groupId: string,
    options: { viewerIsGm?: boolean } = {}
  ): Promise<Result<OperationalGroup>> {
    const groupsRes = await this.getOperationalGroups(domainUuid, options);
    if (!groupsRes.ok) {
      return groupsRes;
    }
    const found = groupsRes.value.find((g) => g.id === groupId);
    if (!found) {
      return err(
        createPublicError({
          code: "DM_OPERATIONAL_GROUP_NOT_FOUND",
          category: "not-found",
          message: `OperationalGroup '${groupId}' not found in domain '${domainUuid}'`
        })
      );
    }
    return ok(found);
  }

  async getWorkforce(
    domainUuid: string,
    nowReal?: number
  ): Promise<Result<WorkforceReport>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    return ok(calculateWorkforce(peopleRes.value, nowReal));
  }

  async getAssignments(
    domainUuid: string
  ): Promise<Result<readonly Assignment[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    return ok(peopleRes.value.assignments ?? []);
  }

  async getReservations(
    domainUuid: string
  ): Promise<Result<readonly Reservation[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    return ok(peopleRes.value.reservations ?? []);
  }
}
