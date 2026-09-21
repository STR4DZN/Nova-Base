import type { DomainReadRepository } from "../../storage/repositories/domain-repository.js";
import { PeopleRepository } from "../repositories/people-repository.js";
import { PeopleProjectionService, type ViewerPeopleContext, type AdministrativePeopleContext } from "../../projection/people/people-projection-service.js";
import { PeopleAggregationService, type PeopleAggregationQueryOptions, type PeopleAggregateResult } from "../../aggregation/people-aggregation.js";
import { resolveCurrentViewer, type ViewerIdentity } from "../../projection/viewer-identity.js";
import type { DomainPeopleData } from "../people-data.js";
import type { PopulationGroup, PopulationResolution, PopulationState } from "../population/population-types.js";
import type { Notable, NotableStatusReport } from "../notables/notable-types.js";
import type { DomainRole, RoleDefinition } from "../roles/role-types.js";
import type { OperationalGroup, OperationalGroupDefinition } from "../operational-groups/operational-group-types.js";
import type { Assignment, Reservation } from "../assignments/assignment-types.js";
import type { WorkforceReport } from "../workforce/workforce-types.js";
import type { DomainRecord } from "../../domains/domain-schema.js";
import { resolvePeopleEffectiveCapabilities, type DomainEffectiveCapabilitiesReport } from "../../aggregation/people-grants.js";
import { buildPeopleViewModel, type PeoplePresenterOptions, type PeopleSubsystemViewModel } from "../../ui/domain-patterns/people/people-presenter.js";
import { renderPeopleSubsystemHtml } from "../../ui/domain-patterns/people/people-view.js";
import { PeopleApplication } from "../../ui/domain-patterns/people/people-app.js";
import type { CommandBus } from "../../commands/command-bus.js";
import { ok, type Result } from "../../core/contracts/result.js";
import type { PublicError } from "../../core/contracts/public-error.js";

export interface PeopleServiceOptions {
  readonly roleDefinitions?: readonly RoleDefinition[];
  readonly groupDefinitions?: readonly OperationalGroupDefinition[];
  readonly commandBus?: CommandBus;
}

export interface PublicPeopleApi {
  getViewerContext(
    domainUuid: string,
    viewer?: Partial<ViewerIdentity>,
    options?: { nowReal?: number; nowWorld?: number; domainCapabilities?: readonly string[] }
  ): Promise<Result<ViewerPeopleContext | AdministrativePeopleContext>>;

  getPopulation(
    domainUuid: string,
    viewer?: Partial<ViewerIdentity>
  ): Promise<Result<{ state: PopulationState; resolution: PopulationResolution }>>;

  getPopulationGroups(
    domainUuid: string,
    viewer?: Partial<ViewerIdentity>
  ): Promise<Result<readonly PopulationGroup[]>>;

  getPopulationGroup(
    domainUuid: string,
    groupId: string,
    viewer?: Partial<ViewerIdentity>
  ): Promise<Result<PopulationGroup>>;

  getNotables(
    domainUuid: string,
    viewer?: Partial<ViewerIdentity>
  ): Promise<Result<readonly Notable[]>>;

  getNotable(
    domainUuid: string,
    notableId: string,
    viewer?: Partial<ViewerIdentity>
  ): Promise<Result<Notable>>;

  getNotableStatus(
    domainUuid: string,
    notableId: string,
    actorResolver?: (uuid: string) => { name: string; img?: string } | null | undefined,
    viewer?: Partial<ViewerIdentity>
  ): Promise<Result<NotableStatusReport>>;

  getRoles(
    domainUuid: string,
    viewer?: Partial<ViewerIdentity>
  ): Promise<Result<readonly DomainRole[]>>;

  getRole(
    domainUuid: string,
    roleId: string,
    viewer?: Partial<ViewerIdentity>
  ): Promise<Result<DomainRole>>;

  getOperationalGroups(
    domainUuid: string,
    viewer?: Partial<ViewerIdentity>
  ): Promise<Result<readonly OperationalGroup[]>>;

  getOperationalGroup(
    domainUuid: string,
    groupId: string,
    viewer?: Partial<ViewerIdentity>
  ): Promise<Result<OperationalGroup>>;

  getWorkforce(
    domainUuid: string,
    viewer?: Partial<ViewerIdentity>,
    options?: { nowReal?: number; nowWorld?: number } | number
  ): Promise<Result<WorkforceReport>>;

  getAssignments(
    domainUuid: string,
    viewer?: Partial<ViewerIdentity>,
    options?: { nowReal?: number; nowWorld?: number }
  ): Promise<Result<readonly Assignment[]>>;

  getReservations(
    domainUuid: string,
    viewer?: Partial<ViewerIdentity>,
    options?: { nowReal?: number; nowWorld?: number }
  ): Promise<Result<readonly Reservation[]>>;

  allocateWorkforceReservation(params: {
    domainUuid: string;
    projectId: string;
    amount: number;
    workforceTypeId?: string;
    userId?: string | null;
  }): Promise<Result<{ readonly reservationId: string }, PublicError>>;

  releaseWorkforceReservation(params: {
    domainUuid: string;
    projectId: string;
    reservationId?: string;
    userId?: string | null;
  }): Promise<Result<void, PublicError>>;

  getAggregate(
    rootDomainUuid: string,
    options?: PeopleAggregationQueryOptions
  ): Result<PeopleAggregateResult>;

  getAggregate(
    rootDomainUuid: string,
    options?: PeopleAggregationQueryOptions
  ): Result<PeopleAggregateResult>;

  getEffectiveCapabilities(
    domainInput: { record: DomainRecord } | DomainRecord,
    roleDefinitions?: readonly RoleDefinition[],
    operationalGroupDefinitions?: readonly OperationalGroupDefinition[]
  ): DomainEffectiveCapabilitiesReport;

  buildViewModel(
    domainInput: { record: DomainRecord } | DomainRecord,
    options?: Partial<PeoplePresenterOptions>
  ): PeopleSubsystemViewModel;

  renderSubsystemHtml(vm: PeopleSubsystemViewModel): string;

  openApp?(
    domainUuid: string,
    options?: { viewer?: Partial<ViewerIdentity>; commandBus?: CommandBus }
  ): PeopleApplication;
}

export class PeopleService implements PublicPeopleApi {
  readonly #domains: DomainReadRepository;
  #commandBus?: CommandBus;
  readonly #repository: PeopleRepository;
  readonly #projection: PeopleProjectionService;
  readonly #aggregation: PeopleAggregationService;

  constructor(domains: DomainReadRepository, options: PeopleServiceOptions = {}) {
    this.#domains = domains;
    this.#commandBus = options.commandBus;
    this.#repository = new PeopleRepository(domains as any);
    this.#projection = new PeopleProjectionService({
      roleDefinitions: options.roleDefinitions,
      groupDefinitions: options.groupDefinitions
    });
    this.#aggregation = new PeopleAggregationService(domains);
  }

  setCommandBus(bus: CommandBus): void {
    this.#commandBus = bus;
  }

  /**
   * Internal/Authority-only raw people data access. Not part of PublicPeopleApi.
   */
  async getPeopleData(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<DomainPeopleData>> {
    const viewer = resolveCurrentViewer(callerViewer);
    const rawRes = await this.#repository.getPeopleData(domainUuid);
    if (!rawRes.ok) return rawRes;

    if (viewer.isGm) {
      return rawRes;
    }

    // Fail-safe projection: sanitize and redact secrets for non-GM caller
    const projected = this.#projection.project(domainUuid, rawRes.value, viewer);
    return ok({
      schemaVersion: rawRes.value.schemaVersion,
      population: projected.population.state,
      populationGroups: projected.populationGroups,
      notables: projected.notables,
      roles: projected.roles,
      operationalGroups: projected.operationalGroups,
      assignments: projected.assignments,
      reservations: projected.reservations
    });
  }

  async getViewerContext(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>,
    options: { nowReal?: number; nowWorld?: number; domainCapabilities?: readonly string[] } = {}
  ): Promise<Result<ViewerPeopleContext | AdministrativePeopleContext>> {
    const viewer = resolveCurrentViewer(callerViewer);
    const dataRes = await this.#repository.getPeopleData(domainUuid);
    if (!dataRes.ok) return dataRes;
    return ok(this.#projection.project(domainUuid, dataRes.value, viewer, options));
  }

  async getPopulation(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<{ state: PopulationState; resolution: PopulationResolution }>> {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer);
    if (!ctxRes.ok) return ctxRes;
    return ok({
      state: ctxRes.value.population.state,
      resolution: ctxRes.value.population.resolution
    });
  }

  async getPopulationGroups(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<readonly PopulationGroup[]>> {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.populationGroups);
  }

  async getPopulationGroup(
    domainUuid: string,
    groupId: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<PopulationGroup>> {
    const viewer = resolveCurrentViewer(callerViewer);
    return this.#repository.getPopulationGroup(domainUuid, groupId, { viewer });
  }

  async getNotables(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<readonly Notable[]>> {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.notables);
  }

  async getNotable(
    domainUuid: string,
    notableId: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<Notable>> {
    const viewer = resolveCurrentViewer(callerViewer);
    return this.#repository.getNotable(domainUuid, notableId, { viewer });
  }

  async getNotableStatus(
    domainUuid: string,
    notableId: string,
    actorResolver?: (uuid: string) => { name: string; img?: string } | null | undefined,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<NotableStatusReport>> {
    const viewer = resolveCurrentViewer(callerViewer);
    return this.#repository.getNotableStatus(domainUuid, notableId, actorResolver, { viewer });
  }

  async getRoles(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<readonly DomainRole[]>> {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.roles);
  }

  async getRole(
    domainUuid: string,
    roleId: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<DomainRole>> {
    const viewer = resolveCurrentViewer(callerViewer);
    return this.#repository.getRole(domainUuid, roleId, { viewer });
  }

  async getOperationalGroups(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<readonly OperationalGroup[]>> {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.operationalGroups);
  }

  async getOperationalGroup(
    domainUuid: string,
    groupId: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<OperationalGroup>> {
    const viewer = resolveCurrentViewer(callerViewer);
    return this.#repository.getOperationalGroup(domainUuid, groupId, { viewer });
  }

  async getWorkforce(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>,
    options?: { nowReal?: number; nowWorld?: number } | number
  ): Promise<Result<WorkforceReport>> {
    const viewer = resolveCurrentViewer(callerViewer);
    const optObj = typeof options === "number" ? { nowReal: options } : options;
    const ctxRes = await this.getViewerContext(domainUuid, viewer, optObj);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.workforce);
  }

  async getAssignments(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>,
    options?: { nowReal?: number; nowWorld?: number }
  ): Promise<Result<readonly Assignment[]>> {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer, options);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.assignments);
  }

  async getReservations(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>,
    options?: { nowReal?: number; nowWorld?: number }
  ): Promise<Result<readonly Reservation[]>> {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer, options);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.reservations);
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
    options: Partial<PeoplePresenterOptions> = {}
  ): PeopleSubsystemViewModel {
    const viewer = resolveCurrentViewer();
    // Security: Non-GM caller CANNOT elevate viewerIsGm to true!
    const effectiveIsGm = viewer.isGm ? (options.viewerIsGm ?? true) : false;
    return buildPeopleViewModel(domainInput as any, {
      ...options,
      viewerIsGm: effectiveIsGm,
      allowedRestrictedRefs: viewer.allowedRestrictedRefs
    });
  }

  renderSubsystemHtml(vm: PeopleSubsystemViewModel): string {
    return renderPeopleSubsystemHtml(vm);
  }

  openApp(
    domainUuid: string,
    options?: { viewer?: Partial<ViewerIdentity>; commandBus?: CommandBus }
  ): PeopleApplication {
    const bus = options?.commandBus ?? this.#commandBus;
    if (!bus) {
      throw new Error("CommandBus is required to open PeopleApplication");
    }
    return new PeopleApplication({
      domainUuid,
      commandBus: bus,
      peopleApi: this,
      domains: this.#domains,
      viewer: options?.viewer
    });
  }

  async allocateWorkforceReservation(params: {
    domainUuid: string;
    projectId: string;
    amount: number;
    workforceTypeId?: string;
    userId?: string | null;
  }): Promise<Result<{ readonly reservationId: string }, PublicError>> {
    return this.#repository.allocateReservation({
      domainUuid: params.domainUuid,
      targetRef: `project:${params.projectId}`,
      amount: params.amount,
      workforceTypeId: params.workforceTypeId
    });
  }

  async releaseWorkforceReservation(params: {
    domainUuid: string;
    projectId: string;
    reservationId?: string;
    userId?: string | null;
  }): Promise<Result<void, PublicError>> {
    return this.#repository.releaseReservation({
      domainUuid: params.domainUuid,
      targetRef: `project:${params.projectId}`,
      reservationId: params.reservationId
    });
  }
}
