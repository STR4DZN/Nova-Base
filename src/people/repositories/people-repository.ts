import type { DomainRepository } from "../../storage/repositories/domain-repository.js";
import type { PopulationGroup, PopulationResolution, PopulationState } from "../population/population-types.js";
import { calculatePopulation } from "../population/population-calculator.js";
import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { tryGetDomainPeopleData, withDomainPeopleData, type DomainPeopleData } from "../people-data.js";
import type { Notable, NotableStatusReport } from "../notables/notable-types.js";
import { resolveNotableStatus } from "../notables/notable-types.js";
import type { DomainRole } from "../roles/role-types.js";
import type { OperationalGroup } from "../operational-groups/operational-group-types.js";
import { calculateWorkforce } from "../workforce/workforce-calculator.js";
import type { WorkforceReport } from "../workforce/workforce-types.js";
import type { Assignment, Reservation } from "../assignments/assignment-types.js";
import { isEntityVisible } from "../../projection/people/people-projection-service.js";
import type { ViewerIdentity } from "../../projection/viewer-identity.js";

export interface PeopleRepositoryViewerOptions {
  readonly viewer?: ViewerIdentity;
  readonly viewerIsGm?: boolean;
}

function resolveRepoViewer(options: PeopleRepositoryViewerOptions): ViewerIdentity {
  if (options.viewer) return options.viewer;
  return {
    userId: "repo-caller",
    isGm: options.viewerIsGm ?? false
  };
}

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
    domainUuid: string,
    options: PeopleRepositoryViewerOptions = {}
  ): Promise<Result<{ state: PopulationState; resolution: PopulationResolution }>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    const { population, populationGroups } = peopleRes.value;
    const visibleGroups = populationGroups.filter((g) => isEntityVisible(g, viewer));
    let effectivePopState = population;
    if (!isEntityVisible({ id: "population", visibility: population.visibility }, viewer)) {
      effectivePopState = {
        mode: "manual",
        total: null,
        precision: "unknown",
        visibility: population.visibility
      };
    }
    const resolution = calculatePopulation(effectivePopState, visibleGroups);
    return ok({
      state: effectivePopState,
      resolution
    });
  }

  async getPopulationGroups(
    domainUuid: string,
    options: PeopleRepositoryViewerOptions = {}
  ): Promise<Result<readonly PopulationGroup[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    return ok(peopleRes.value.populationGroups.filter((g) => isEntityVisible(g, viewer)));
  }

  async getPopulationGroup(
    domainUuid: string,
    groupId: string,
    options: PeopleRepositoryViewerOptions = {}
  ): Promise<Result<PopulationGroup>> {
    const groupsRes = await this.getPopulationGroups(domainUuid, options);
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
    options: PeopleRepositoryViewerOptions = {}
  ): Promise<Result<readonly Notable[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    return ok(peopleRes.value.notables.filter((n) => isEntityVisible(n, viewer)));
  }

  async getNotable(
    domainUuid: string,
    notableId: string,
    options: PeopleRepositoryViewerOptions = {}
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
    options: PeopleRepositoryViewerOptions = {}
  ): Promise<Result<NotableStatusReport>> {
    const notableRes = await this.getNotable(domainUuid, notableId, options);
    if (!notableRes.ok) {
      return notableRes;
    }
    return ok(resolveNotableStatus(notableRes.value, actorResolver));
  }

  async getRoles(
    domainUuid: string,
    options: PeopleRepositoryViewerOptions = {}
  ): Promise<Result<readonly DomainRole[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    const hiddenNotableIds = new Set(
      peopleRes.value.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id)
    );
    const visibleRoles = peopleRes.value.roles
      .filter((r) => isEntityVisible(r, viewer))
      .map((r) => {
        const visibleOccupants = r.occupants.filter((occId) => !hiddenNotableIds.has(occId));
        if (visibleOccupants.length === r.occupants.length) return r;
        return {
          ...r,
          occupants: Object.freeze(visibleOccupants)
        };
      });
    return ok(visibleRoles);
  }

  async getRole(
    domainUuid: string,
    roleId: string,
    options: PeopleRepositoryViewerOptions = {}
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
    options: PeopleRepositoryViewerOptions = {}
  ): Promise<Result<readonly OperationalGroup[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    const hiddenNotableIds = new Set(
      peopleRes.value.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id)
    );
    const visibleGroups = peopleRes.value.operationalGroups
      .filter((g) => isEntityVisible(g, viewer))
      .map((g) => {
        const visibleMembers = g.members.filter((mId) => !hiddenNotableIds.has(mId));
        if (visibleMembers.length === g.members.length) return g;
        return {
          ...g,
          members: Object.freeze(visibleMembers)
        };
      });
    return ok(visibleGroups);
  }

  async getOperationalGroup(
    domainUuid: string,
    groupId: string,
    options: PeopleRepositoryViewerOptions = {}
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
    options: { nowReal?: number; nowWorld?: number; viewer?: ViewerIdentity; viewerIsGm?: boolean } | number = {}
  ): Promise<Result<WorkforceReport>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const optObj = typeof options === "number" ? { nowReal: options } : options;
    const viewer = resolveRepoViewer(optObj);

    if (viewer.isGm) {
      return ok(calculateWorkforce(peopleRes.value, { nowReal: optObj.nowReal, nowWorld: optObj.nowWorld }));
    }

    const visibleGroups = peopleRes.value.populationGroups.filter((g) => isEntityVisible(g, viewer));
    const hiddenNotableIds = new Set(peopleRes.value.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id));
    const visibleOpGroups = peopleRes.value.operationalGroups
      .filter((g) => isEntityVisible(g, viewer))
      .map((g) => {
        const visibleMembers = g.members.filter((mId) => !hiddenNotableIds.has(mId));
        if (visibleMembers.length === g.members.length) return g;
        return { ...g, members: Object.freeze(visibleMembers) };
      });

    const hiddenPopGroupIds = new Set<string>(peopleRes.value.populationGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));
    const hiddenOpGroupIds = new Set<string>(peopleRes.value.operationalGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));

    const visibleAssignments = (peopleRes.value.assignments ?? []).filter((a) => {
      if (!isEntityVisible(a, viewer)) return false;
      if (hiddenPopGroupIds.has(a.sourceRef) || hiddenOpGroupIds.has(a.sourceRef) || hiddenNotableIds.has(a.sourceRef)) return false;
      return true;
    });

    const visibleReservations = (peopleRes.value.reservations ?? []).filter((r) => {
      if (!isEntityVisible(r, viewer)) return false;
      if (hiddenPopGroupIds.has(r.sourceRef) || hiddenOpGroupIds.has(r.sourceRef) || hiddenNotableIds.has(r.sourceRef)) return false;
      return true;
    });

    const projectedPeople: DomainPeopleData = {
      ...peopleRes.value,
      populationGroups: Object.freeze(visibleGroups),
      operationalGroups: Object.freeze(visibleOpGroups),
      assignments: Object.freeze(visibleAssignments),
      reservations: Object.freeze(visibleReservations)
    };

    return ok(calculateWorkforce(projectedPeople, { nowReal: optObj.nowReal, nowWorld: optObj.nowWorld }));
  }

  async getAssignments(
    domainUuid: string,
    options: PeopleRepositoryViewerOptions = {}
  ): Promise<Result<readonly Assignment[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    if (viewer.isGm) {
      return ok(peopleRes.value.assignments ?? []);
    }
    const hiddenNotableIds = new Set<string>(peopleRes.value.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id));
    const hiddenPopGroupIds = new Set<string>(peopleRes.value.populationGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));
    const hiddenOpGroupIds = new Set<string>(peopleRes.value.operationalGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));

    return ok((peopleRes.value.assignments ?? []).filter((a) => {
      if (!isEntityVisible(a, viewer)) return false;
      if (hiddenPopGroupIds.has(a.sourceRef) || hiddenOpGroupIds.has(a.sourceRef) || hiddenNotableIds.has(a.sourceRef)) return false;
      return true;
    }));
  }

  async getReservations(
    domainUuid: string,
    options: PeopleRepositoryViewerOptions = {}
  ): Promise<Result<readonly Reservation[]>> {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    if (viewer.isGm) {
      return ok(peopleRes.value.reservations ?? []);
    }
    const hiddenNotableIds = new Set<string>(peopleRes.value.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id));
    const hiddenPopGroupIds = new Set<string>(peopleRes.value.populationGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));
    const hiddenOpGroupIds = new Set<string>(peopleRes.value.operationalGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));

    return ok((peopleRes.value.reservations ?? []).filter((r) => {
      if (!isEntityVisible(r, viewer)) return false;
      if (hiddenPopGroupIds.has(r.sourceRef) || hiddenOpGroupIds.has(r.sourceRef) || hiddenNotableIds.has(r.sourceRef)) return false;
      return true;
    }));
  }

  async allocateReservation(params: {
    domainUuid: string;
    targetRef: string;
    amount: number;
    workforceTypeId?: string;
    sourceRef?: string;
    visibility?: "public" | "secret";
  }): Promise<Result<{ readonly reservationId: string }, PublicError>> {
    const id = params.domainUuid.startsWith("JournalEntry.") ? params.domainUuid.slice("JournalEntry.".length) : params.domainUuid;
    const domainRes = await this.#domainRepository.read(id);
    if (!domainRes.ok) return domainRes;
    const peopleDataRes = tryGetDomainPeopleData(domainRes.value.record);
    if (!peopleDataRes.ok) return peopleDataRes;
    const peopleData = peopleDataRes.value;
    const resvId = createOpaqueId("resv");
    const reservation: Reservation = {
      id: resvId,
      sourceRef: params.sourceRef ?? `domain:${id}`,
      targetRef: params.targetRef,
      workforceTypeId: params.workforceTypeId ?? "general",
      amount: params.amount,
      status: "active",
      visibility: params.visibility ?? "public"
    };
    const updatedRecord = withDomainPeopleData(domainRes.value.record, {
      ...peopleData,
      reservations: Object.freeze([...peopleData.reservations, reservation])
    });
    const updateRes = await this.#domainRepository.update({ ...domainRes.value, record: updatedRecord });
    if (!updateRes.ok) return updateRes;
    return ok({ reservationId: resvId });
  }

  async releaseReservation(params: {
    domainUuid: string;
    targetRef?: string;
    reservationId?: string;
  }): Promise<Result<void, PublicError>> {
    const id = params.domainUuid.startsWith("JournalEntry.") ? params.domainUuid.slice("JournalEntry.".length) : params.domainUuid;
    const domainRes = await this.#domainRepository.read(id);
    if (!domainRes.ok) return domainRes;
    const peopleDataRes = tryGetDomainPeopleData(domainRes.value.record);
    if (!peopleDataRes.ok) return peopleDataRes;
    const peopleData = peopleDataRes.value;
    const updatedReservations = peopleData.reservations.map((r) => {
      const matchTarget = params.targetRef && r.targetRef === params.targetRef;
      const matchId = params.reservationId && r.id === params.reservationId;
      if ((matchTarget || matchId) && r.status === "active") {
        return { ...r, status: "released" as const };
      }
      return r;
    });
    const updatedRecord = withDomainPeopleData(domainRes.value.record, {
      ...peopleData,
      reservations: Object.freeze(updatedReservations)
    });
    const updateRes = await this.#domainRepository.update({ ...domainRes.value, record: updatedRecord });
    if (!updateRes.ok) return updateRes;
    return ok(undefined);
  }
}
