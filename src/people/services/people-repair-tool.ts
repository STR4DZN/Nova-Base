import { createPublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { MutationCoordinator } from "../../mutations/mutation-coordinator.js";
import { CommandBus } from "../../commands/command-bus.js";
import { CommandRegistry } from "../../commands/command-registry.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../commands/command-envelope.js";
import type { PrimaryAuthorityService } from "../../authority/primary-authority-service.js";
import {
  registerRepairCommandHandlers,
  type PeopleRepairAction,
  type PeopleRepairPayload,
  type PeopleRepairReceiptResult
} from "../commands/repair-commands.js";

export interface PeopleRepairResult {
  readonly domainUuid: string;
  readonly repaired: boolean;
  readonly summary: string;
  readonly changes: readonly string[];
}

export class PeopleRepairTool {
  readonly #commandBus: CommandBus;
  readonly #domains?: DomainRepositoryContract;
  readonly #coordinator?: MutationCoordinator;

  constructor(
    commandBusOrDomains: CommandBus | DomainRepositoryContract,
    coordinator?: MutationCoordinator,
    commandBus?: CommandBus
  ) {
    if ("execute" in commandBusOrDomains || "executeLocal" in commandBusOrDomains) {
      this.#commandBus = commandBusOrDomains as CommandBus;
    } else if (commandBus) {
      this.#commandBus = commandBus;
      this.#domains = commandBusOrDomains as DomainRepositoryContract;
      this.#coordinator = coordinator;
    } else {
      // Direct construction with (domains, coordinator) — wire transactional pipeline
      this.#domains = commandBusOrDomains as DomainRepositoryContract;
      this.#coordinator = coordinator;
      const registry = new CommandRegistry();
      if (coordinator) {
        registerRepairCommandHandlers(registry, coordinator, this.#domains);
      }
      const authority = {
        isCurrentUser: () => true,
        getCurrent: () => "local-authority",
        getStatus: () => ({ authorityUserId: "local-authority", authorityEpoch: 1, available: true })
      } as unknown as PrimaryAuthorityService<any>;
      this.#commandBus = new CommandBus({
        registry,
        coordinator: coordinator!,
        authorityService: authority
      });
    }
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
