import type { Result } from "../../core/contracts/result.js";
import type { PublicError } from "../../core/contracts/public-error.js";
import type { Reservation } from "../assignments/assignment-types.js";

/** Internal port for coordinated Project operations and their recovery only. */
export interface WorkforceReservationPort {
  allocateWorkforceReservation(params: {
    domainUuid: string;
    projectId: string;
    amount: number;
    workforceTypeId?: string;
    userId?: string | null;
    reservationId?: string;
    operationRef?: string;
  }): Promise<Result<{ readonly reservationId: string }, PublicError>>;

  releaseWorkforceReservation(params: {
    domainUuid: string;
    projectId: string;
    reservationId?: string;
    userId?: string | null;
  }): Promise<Result<void, PublicError>>;

  restoreWorkforceReservation(params: {
    domainUuid: string;
    projectId: string;
    reservationId?: string;
    userId?: string | null;
  }): Promise<Result<void, PublicError>>;

  getReservations(domainUuid: string): Promise<Result<readonly Reservation[]>>;
}
