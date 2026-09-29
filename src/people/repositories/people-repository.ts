import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import { PeopleReadRepository } from "./people-read-repository.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import type { PublicError } from "../../core/contracts/public-error.js";
import { ok, type Result } from "../../core/contracts/result.js";
import { tryGetDomainPeopleData, withDomainPeopleData } from "../people-data.js";
import type { Reservation } from "../assignments/assignment-types.js";

export type { PeopleRepositoryViewerOptions } from "./people-read-repository.js";

/** Internal repository: mutations require the writable domain contract. */
export class PeopleRepository extends PeopleReadRepository {
  readonly #domainRepository: DomainRepositoryContract;

  constructor(domainRepository: DomainRepositoryContract) {
    super(domainRepository);
    this.#domainRepository = domainRepository;
  }

  async allocateReservation(params: {
    domainUuid: string;
    targetRef: string;
    amount: number;
    workforceTypeId?: string;
    sourceRef?: string;
    visibility?: "public" | "secret";
    reservationId?: string;
    operationRef?: string;
  }): Promise<Result<{ readonly reservationId: string }, PublicError>> {
    const id = params.domainUuid.startsWith("JournalEntry.") ? params.domainUuid.slice("JournalEntry.".length) : params.domainUuid;
    const domainRes = await this.#domainRepository.read(id);
    if (!domainRes.ok) return domainRes;
    const peopleDataRes = tryGetDomainPeopleData(domainRes.value.record);
    if (!peopleDataRes.ok) return peopleDataRes;
    const peopleData = peopleDataRes.value;

    const resvId = params.reservationId ?? createOpaqueId("resv");
    const existing = peopleData.reservations.find(
      (r) => r.id === resvId || (params.operationRef && r.operationRef === params.operationRef)
    );
    if (existing && existing.status === "active") {
      return ok({ reservationId: existing.id });
    }

    const reservation: Reservation = {
      id: resvId,
      sourceRef: params.sourceRef ?? `domain:${id}`,
      targetRef: params.targetRef,
      workforceTypeId: params.workforceTypeId ?? "general",
      amount: params.amount,
      status: "active",
      visibility: params.visibility ?? "public",
      ...(params.operationRef ? { operationRef: params.operationRef } : {})
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

  async restoreReservation(params: {
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
    let modified = false;
    const updatedReservations = peopleData.reservations.map((r) => {
      const matchTarget = params.targetRef && r.targetRef === params.targetRef;
      const matchId = params.reservationId && r.id === params.reservationId;
      if ((matchTarget || matchId) && r.status === "released") {
        modified = true;
        return { ...r, status: "active" as const };
      }
      return r;
    });
    if (!modified) return ok(undefined);
    const updatedRecord = withDomainPeopleData(domainRes.value.record, {
      ...peopleData,
      reservations: Object.freeze(updatedReservations)
    });
    const updateRes = await this.#domainRepository.update({ ...domainRes.value, record: updatedRecord });
    if (!updateRes.ok) return updateRes;
    return ok(undefined);
  }
}
