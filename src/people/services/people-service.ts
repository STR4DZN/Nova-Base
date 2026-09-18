import type { DomainReadRepository } from "../../storage/repositories/domain-repository.js";
import { PeopleRepository } from "../repositories/people-repository.js";
import { PeopleProjectionService, type ViewerPeopleContext, type AdministrativePeopleContext } from "../../projection/people/people-projection-service.js";
import { PeopleAggregationService, type PeopleAggregationQueryOptions, type PeopleAggregateResult } from "../../aggregation/people-aggregation.js";
import type { ViewerIdentity } from "../../projection/viewer-identity.js";
import type { DomainPeopleData } from "../people-data.js";
import type { PopulationGroup, PopulationResolution, PopulationState } from "../population/population-types.js";
import type { Notable } from "../notables/notable-types.js";
import type { DomainRole, RoleDefinition } from "../roles/role-types.js";
import type { OperationalGroup, OperationalGroupDefinition } from "../operational-groups/operational-group-types.js";
import type { Assignment, Reservation } from "../assignments/assignment-types.js";
import type { WorkforceReport } from "../workforce/workforce-types.js";
import type { DomainRecord } from "../../domains/domain-schema.js";
import { resolvePeopleEffectiveCapabilities, type DomainEffectiveCapabilitiesReport } from "../../aggregation/people-grants.js";
import { buildPeopleViewModel, type PeoplePresenterOptions, type PeopleSubsystemViewModel } from "../../ui/domain-patterns/people/people-presenter.js";
import { renderPeopleSubsystemHtml, escapeHtml, escapeAttribute } from "../../ui/domain-patterns/people/people-view.js";
import { ok, type Result } from "../../core/contracts/result.js";

export interface PeopleServiceOptions {
  readonly roleDefinitions?: readonly RoleDefinition[];
  readonly groupDefinitions?: readonly OperationalGroupDefinition[];
}

export class PeopleService {
  readonly #repository: PeopleRepository;
  readonly #projection: PeopleProjectionService;
  readonly #aggregation: PeopleAggregationService;

  constructor(domains: DomainReadRepository, options: PeopleServiceOptions = {}) {
    this.#repository = new PeopleRepository(domains as any);
    this.#projection = new PeopleProjectionService({
      roleDefinitions: options.roleDefinitions,
      groupDefinitions: options.groupDefinitions
    });
    this.#aggregation = new PeopleAggregationService(domains);
  }

  async getPeopleData(domainUuid: string): Promise<Result<DomainPeopleData>> {
    return this.#repository.getPeopleData(domainUuid);
  }

  async getViewerContext(
    domainUuid: string,
    viewer: ViewerIdentity,
    options: { nowReal?: number; domainCapabilities?: readonly string[] } = {}
  ): Promise<Result<ViewerPeopleContext | AdministrativePeopleContext>> {
    const dataRes = await this.#repository.getPeopleData(domainUuid);
    if (!dataRes.ok) return dataRes;
    return ok(this.#projection.project(domainUuid, dataRes.value, viewer, options));
  }

  async getPopulation(
    domainUuid: string,
    viewer?: ViewerIdentity
  ): Promise<Result<{ state: PopulationState; resolution: PopulationResolution }>> {
    if (viewer && !viewer.isGm) {
      const ctxRes = await this.getViewerContext(domainUuid, viewer);
      if (!ctxRes.ok) return ctxRes;
      return ok({
        state: ctxRes.value.population.state,
        resolution: ctxRes.value.population.resolution
      });
    }
    return this.#repository.getPopulation(domainUuid);
  }

  async getPopulationGroups(
    domainUuid: string,
    viewer?: ViewerIdentity
  ): Promise<Result<readonly PopulationGroup[]>> {
    if (viewer && !viewer.isGm) {
      const ctxRes = await this.getViewerContext(domainUuid, viewer);
      if (!ctxRes.ok) return ctxRes;
      return ok(ctxRes.value.populationGroups);
    }
    return this.#repository.getPopulationGroups(domainUuid);
  }

  async getNotables(
    domainUuid: string,
    viewer?: ViewerIdentity
  ): Promise<Result<readonly Notable[]>> {
    return this.#repository.getNotables(domainUuid, { viewerIsGm: viewer ? viewer.isGm : true });
  }

  async getRoles(
    domainUuid: string,
    viewer?: ViewerIdentity
  ): Promise<Result<readonly DomainRole[]>> {
    return this.#repository.getRoles(domainUuid, { viewerIsGm: viewer ? viewer.isGm : true });
  }

  async getOperationalGroups(
    domainUuid: string,
    viewer?: ViewerIdentity
  ): Promise<Result<readonly OperationalGroup[]>> {
    return this.#repository.getOperationalGroups(domainUuid, { viewerIsGm: viewer ? viewer.isGm : true });
  }

  async getWorkforce(
    domainUuid: string,
    viewer?: ViewerIdentity,
    nowReal?: number
  ): Promise<Result<WorkforceReport>> {
    if (viewer && !viewer.isGm) {
      const ctxRes = await this.getViewerContext(domainUuid, viewer, { nowReal });
      if (!ctxRes.ok) return ctxRes;
      return ok(ctxRes.value.workforce);
    }
    return this.#repository.getWorkforce(domainUuid, nowReal);
  }

  async getAssignments(
    domainUuid: string,
    viewer?: ViewerIdentity
  ): Promise<Result<readonly Assignment[]>> {
    if (viewer && !viewer.isGm) {
      const ctxRes = await this.getViewerContext(domainUuid, viewer);
      if (!ctxRes.ok) return ctxRes;
      return ok(ctxRes.value.assignments);
    }
    return this.#repository.getAssignments(domainUuid);
  }

  async getReservations(
    domainUuid: string,
    viewer?: ViewerIdentity
  ): Promise<Result<readonly Reservation[]>> {
    if (viewer && !viewer.isGm) {
      const ctxRes = await this.getViewerContext(domainUuid, viewer);
      if (!ctxRes.ok) return ctxRes;
      return ok(ctxRes.value.reservations);
    }
    return this.#repository.getReservations(domainUuid);
  }

  getAggregate(
    rootDomainUuid: string,
    options: PeopleAggregationQueryOptions = {}
  ): Result<PeopleAggregateResult> {
    return this.#aggregation.queryPeopleAggregate(rootDomainUuid, options);
  }

  getEffectiveCapabilities(
    domainInput: { record: DomainRecord } | DomainRecord,
    roleDefinitions?: readonly RoleDefinition[],
    operationalGroupDefinitions?: readonly OperationalGroupDefinition[]
  ): DomainEffectiveCapabilitiesReport {
    return resolvePeopleEffectiveCapabilities(domainInput as any, roleDefinitions, operationalGroupDefinitions);
  }

  buildViewModel(
    domainInput: { record: DomainRecord } | DomainRecord,
    options: PeoplePresenterOptions
  ): PeopleSubsystemViewModel {
    return buildPeopleViewModel(domainInput as any, options);
  }

  renderSubsystemHtml(vm: PeopleSubsystemViewModel): string {
    return renderPeopleSubsystemHtml(vm);
  }
}
