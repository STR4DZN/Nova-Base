import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import { PeopleRepository } from "../repositories/people-repository.js";
import type { WorkforceReservationPort } from "./workforce-reservation-port.js";
import { ok, type Result } from "../../core/contracts/result.js";
import type { PublicError } from "../../core/contracts/public-error.js";
import type { Reservation } from "../assignments/assignment-types.js";

/** Never exposed on module.api; its caller owns authority, locks and recovery. */
export class WorkforceReservationService implements WorkforceReservationPort {
  readonly #repository: PeopleRepository;

  constructor(domains: DomainRepositoryContract) {
    this.#repository = new PeopleRepository(domains);
  }

  async getReservations(domainUuid: string): Promise<Result<readonly Reservation[]>> {
    const people = await this.#repository.getPeopleData(domainUuid);
    if (!people.ok) return people;
    return ok(people.value.reservations);
  }

  async allocateWorkforceReservation(params: {
    domainUuid: string;
    projectId: string;
    amount: number;
    workforceTypeId?: string;
    userId?: string | null;
    reservationId?: string;
    operationRef?: string;
  }): Promise<Result<{ readonly reservationId: string }, PublicError>> {
    return this.#repository.allocateReservation({
      domainUuid: params.domainUuid,
      targetRef: `project:${params.projectId}`,
      amount: params.amount,
      workforceTypeId: params.workforceTypeId,
      reservationId: params.reservationId,
      operationRef: params.operationRef
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

  async restoreWorkforceReservation(params: {
    domainUuid: string;
    projectId: string;
    reservationId?: string;
    userId?: string | null;
  }): Promise<Result<void, PublicError>> {
    return this.#repository.restoreReservation({
      domainUuid: params.domainUuid,
      targetRef: `project:${params.projectId}`,
      reservationId: params.reservationId
    });
  }
}
