import { createPublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { CommandBus } from "../../commands/command-bus.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../commands/command-envelope.js";
import type {
  PeopleRepairAction,
  PeopleRepairPayload,
  PeopleRepairReceiptResult
} from "../commands/repair-commands.js";

export interface PeopleRepairResult {
  readonly domainUuid: string;
  readonly repaired: boolean;
  readonly summary: string;
  readonly changes: readonly string[];
}

export class PeopleRepairTool {
  readonly #commandBus: CommandBus;

  constructor(commandBus: CommandBus) {
    if (!commandBus || typeof (commandBus as any).execute !== "function") {
      throw new TypeError("PeopleRepairTool requires an authorized CommandBus instance");
    }
    this.#commandBus = commandBus;
  }

  get commandBus(): CommandBus {
    return this.#commandBus;
  }

  async relinkNotable(
    domainUuid: string,
    oldNotableId: string,
    newNotableId: string
  ): Promise<Result<PeopleRepairResult>> {
    return this.#dispatchRepair(domainUuid, {
      type: "relink-notable",
      oldNotableId,
      newNotableId
    });
  }

  async purgeDanglingOccupants(domainUuid: string): Promise<Result<PeopleRepairResult>> {
    return this.#dispatchRepair(domainUuid, {
      type: "purge-dangling-occupants"
    });
  }

  async repairExplicitGroupSizes(domainUuid: string): Promise<Result<PeopleRepairResult>> {
    return this.#dispatchRepair(domainUuid, {
      type: "repair-explicit-group-sizes"
    });
  }

  async pruneExpiredReservations(
    domainUuid: string,
    nowReal: number = Date.now(),
    nowWorld?: number
  ): Promise<Result<PeopleRepairResult>> {
    return this.#dispatchRepair(domainUuid, {
      type: "prune-expired-reservations",
      nowReal,
      nowWorld
    });
  }

  async pruneEndedAssignments(
    domainUuid: string,
    nowWorld: number
  ): Promise<Result<PeopleRepairResult>> {
    return this.#dispatchRepair(domainUuid, {
      type: "prune-ended-assignments",
      nowWorld
    });
  }

  async #dispatchRepair(
    domainUuid: string,
    operation: PeopleRepairAction
  ): Promise<Result<PeopleRepairResult>> {
    const cmd: DomainCommand<PeopleRepairPayload> = {
      contractVersion: COMMAND_CONTRACT_VERSION_V1,
      commandId: createCommandId(),
      type: "people:repair",
      payload: {
        domainUuid,
        operation
      },
      issuedAtReal: Date.now()
    };

    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(
        res.value.error ??
          createPublicError({
            code: "DM_COMMAND_REJECTED",
            category: "internal",
            message: "Repair command was rejected by authority"
          })
      );
    }

    const receiptResult = res.value.result as PeopleRepairReceiptResult;
    return ok({
      domainUuid: receiptResult.domainUuid,
      repaired: receiptResult.repaired,
      summary: receiptResult.summary,
      changes: receiptResult.changes
    });
  }
}
