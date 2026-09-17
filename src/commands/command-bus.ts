import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { ok, type Result } from "../core/contracts/result.js";
import type { AuthorityElectionUser } from "../authority/primary-authority-election.js";
import type { PrimaryAuthorityService } from "../authority/primary-authority-service.js";
import {
  createAuthenticatedCommandContext,
  type OperationSource
} from "./authenticated-command-context.js";
import {
  validateCommandEnvelope,
  type CommandId,
  type DomainCommand
} from "./command-envelope.js";
import type { CommandRegistry } from "./command-registry.js";
import type {
  CommandTransport,
  TransportInboundContext,
  TransportInboundMessage,
  TransportReceipt
} from "./command-transport.js";
import { RateLimiter } from "./rate-limiter.js";
import {
  CommandDedupeStore,
  computeCommandFingerprint
} from "./command-dedupe-store.js";

import type { MutationCoordinator } from "../mutations/mutation-coordinator.js";
import { CommandQueue, type CommandQueueDiagnostics } from "./command-queue.js";
import type { CommandStatusReport } from "./command-dedupe-store.js";

export interface CommandBusOptions {
  readonly registry: CommandRegistry;
  readonly authorityService: PrimaryAuthorityService<AuthorityElectionUser>;
  readonly coordinator?: MutationCoordinator;
  readonly transport?: CommandTransport;
  readonly rateLimiter?: RateLimiter;
  readonly dedupeStore?: CommandDedupeStore;
  readonly commandQueue?: CommandQueue;
}

/**
 * CommandBus — Central command dispatcher on the Primary Authority host.
 *
 * Implements the normative authority command pipeline (Master Spec §11.2, §11.4, DEC-541–572, DEC-803–807):
 * 1. Runtime envelope validation fail-closed.
 * 2. Authority election verification and local host validation (DM_AUTHORITY_NOT_LOCAL).
 * 3. Authenticated context establishment (strictly from transport context, detecting payload spoofing).
 * 4. Preservation of trusted operation provenance for local authority executions.
 * 5. Explicit FIFO command scheduling & cancellation on authority host.
 * 6. Handler lookup in CommandRegistry.
 * 7. Boundary enforcement: internal-only commands are strictly rejected if received via network/external transport.
 * 8. Defensive rate limiting per user and per command type.
 * 9. Runtime schema validation before permission evaluation.
 * 10. Permission validation prior to handler invocation.
 * 11. Transactional command enforcement via MutationCoordinator.
 * 12. In-memory Dedupe Store & Command Status query.
 */
export class CommandBus {
  readonly #registry: CommandRegistry;
  readonly #authorityService: PrimaryAuthorityService<AuthorityElectionUser>;
  readonly #coordinator: MutationCoordinator | null;
  readonly #rateLimiter: RateLimiter;
  readonly #dedupeStore: CommandDedupeStore;
  readonly #commandQueue: CommandQueue;
  readonly #transportCleanups = new Set<() => void>();

  constructor(options: CommandBusOptions) {
    this.#registry = options.registry;
    this.#authorityService = options.authorityService;
    this.#coordinator = options.coordinator ?? null;
    this.#rateLimiter = options.rateLimiter ?? new RateLimiter();
    this.#dedupeStore = options.dedupeStore ?? new CommandDedupeStore();
    this.#commandQueue = options.commandQueue ?? new CommandQueue();

    if (options.transport) {
      this.attachTransport(options.transport);
    }
  }

  attachTransport(transport: CommandTransport): () => void {
    const unregister = transport.registerInboundHandler(this.dispatchInbound.bind(this));
    let unregistered = false;
    const cleanup = () => {
      if (!unregistered) {
        unregistered = true;
        unregister();
      }
    };
    this.#transportCleanups.add(cleanup);
    return () => {
      cleanup();
      this.#transportCleanups.delete(cleanup);
    };
  }

  destroy(): void {
    for (const cleanup of this.#transportCleanups) {
      cleanup();
    }
    this.#transportCleanups.clear();
    this.#commandQueue.clear();
  }

  getCommandStatus<TResult = unknown>(commandId: CommandId): CommandStatusReport<TResult> {
    return this.#dedupeStore.getStatus<TResult>(commandId);
  }

  cancelCommand(
    commandId: CommandId,
    requesterUserId: string | null,
    isGM: boolean,
    reason?: string
  ): Result<void, PublicError> {
    return this.#commandQueue.cancel(commandId, requesterUserId, isGM, reason);
  }

  getQueueDiagnostics(): CommandQueueDiagnostics {
    return this.#commandQueue.getDiagnostics();
  }

  /**
   * Dispatches an inbound command message received via transport.
   */
  async dispatchInbound<TResponse = unknown>(
    message: TransportInboundMessage
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>> {
    const now = Date.now();

    // 1. Validate Command Envelope
    const envelopeResult = validateCommandEnvelope(message.rawEnvelope);
    if (!envelopeResult.ok) {
      const dummyId = ("cmd_" + "0".repeat(32)) as CommandId;
      return ok({
        commandId: dummyId,
        status: "rejected",
        error: envelopeResult.error,
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    const command = envelopeResult.value;

    // 2. Verify Authority Status & Host Eligibility (G2-AUD-005)
    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is currently elected or available"
        }),
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    if (!this.#authorityService.isCurrentUser()) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_AUTHORITY_NOT_LOCAL",
          category: "permission",
          message: "Current client host is not the active primary authority"
        }),
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    // 3. Create Authenticated Context & Validate Sender Identity (G2-AUD-006)
    const source: OperationSource =
      message.transportContext.transportName === "local"
        ? (message.transportContext.operationSource ?? { type: "system" })
        : { type: "user" };

    const authContextResult = createAuthenticatedCommandContext({
      command,
      transportContext: message.transportContext,
      authorityUserId: authorityStatus.authorityUserId,
      authorityEpoch: authorityStatus.authorityEpoch,
      source
    });

    if (!authContextResult.ok) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: authContextResult.error,
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    const context = authContextResult.value;

    // 3b. Enqueue into Authority Command Queue (G2-AUD-015)
    const queueEntry = this.#commandQueue.enqueue(
      command,
      message.transportContext.senderUserId
    );

    if (queueEntry.status === "cancelled") {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_COMMAND_CANCELLED",
          category: "busy",
          message: `Command was cancelled: ${queueEntry.cancelReason ?? "Unknown reason"}`
        }),
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    // 4. Handler Lookup
    const registration = this.#registry.get(command.type);
    if (!registration) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_COMMAND_HANDLER_NOT_FOUND",
          category: "not-found",
          message: `No handler registered for command type '${command.type}'`
        }),
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    // 5. Public vs Internal Command Boundary Check (Master §11.4, DEC-803)
    if (
      registration.visibility === "internal" &&
      message.transportContext.transportName !== "local"
    ) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_SECURITY_INTERNAL_ONLY_COMMAND",
          category: "permission",
          message: `Command '${command.type}' is internal-only and cannot be called via remote transport`
        }),
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    // 6. Defensive Rate Limiting Check (Master §11.2, DEC-787–793)
    const rateLimitResult = this.#rateLimiter.checkAndConsume(
      context.senderUserId,
      command.type,
      now
    );
    if (!rateLimitResult.ok) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: rateLimitResult.error,
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    // 7. Runtime Schema Validation (Master §11.2, DEC-573)
    if (registration.schemaValidator) {
      const schemaResult = registration.schemaValidator(command.payload);
      if (!schemaResult.ok) {
        return ok({
          commandId: command.commandId,
          status: "rejected",
          error: schemaResult.error,
          transportTimestamp: now
        } as TransportReceipt<TResponse>);
      }
    }

    // 8. Permission Validation (Master §11.2, DEC-573–582)
    if (registration.permissionValidator) {
      const permResult = registration.permissionValidator(context);
      if (!permResult.ok) {
        return ok({
          commandId: command.commandId,
          status: "rejected",
          error: permResult.error,
          transportTimestamp: now
        } as TransportReceipt<TResponse>);
      }
    }

    // 9. Dedupe Claim & Fingerprint Conflict Detection (Master §11.2, §11.3, DEC-593–602)
    const fingerprint = computeCommandFingerprint(command);
    const claimResult = this.#dedupeStore.claim<TResponse>(
      command.commandId,
      fingerprint,
      now
    );

    if (!claimResult.ok) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: claimResult.error,
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    if (claimResult.value.isReplay) {
      if (claimResult.value.receipt) {
        return ok(claimResult.value.receipt);
      }
      if (claimResult.value.inFlightPromise) {
        const awaitedReceipt = await claimResult.value.inFlightPromise;
        return ok(awaitedReceipt);
      }
    }

    // Pre-execution cancellation check
    if (queueEntry.abortController.signal.aborted) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_COMMAND_CANCELLED",
          category: "busy",
          message: `Command was cancelled in queue: ${queueEntry.cancelReason ?? "Unknown reason"}`
        }),
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    this.#commandQueue.markRunning(command.commandId);

    // 10. Execute Handler / Transactional Coordinator (G2-AUD-007)
    let finalReceipt: TransportReceipt<TResponse>;

    try {
      if (registration.transactional && registration.mutationDefinition) {
        if (!this.#coordinator) {
          finalReceipt = {
            commandId: command.commandId,
            status: "rejected",
            error: createPublicError({
              code: "DM_TRANSACTIONAL_COORDINATOR_REQUIRED",
              category: "integrity",
              message: `Transactional command '${command.type}' requires MutationCoordinator, but none is configured`
            }),
            transportTimestamp: now
          };
        } else {
          this.#commandQueue.markCommitting(command.commandId);
          const coordRes = await this.#coordinator.execute<any, any>(
            context,
            registration.mutationDefinition,
            { signal: queueEntry.abortController.signal }
          );
          if (!coordRes.ok) {
            finalReceipt = {
              commandId: command.commandId,
              status: "rejected",
              error: coordRes.error,
              transportTimestamp: now
            };
          } else {
            const receipt = coordRes.value;
            finalReceipt = {
              commandId: command.commandId,
              status: receipt.status === "executed" ? "executed" : "rejected",
              result: receipt.result as TResponse,
              error: receipt.error,
              transportTimestamp: now
            };
          }
        }
      } else {
        const handlerResult = await registration.handler(context);
        if (!handlerResult.ok) {
          finalReceipt = {
            commandId: command.commandId,
            status: "rejected",
            error: handlerResult.error,
            transportTimestamp: now
          };
        } else {
          finalReceipt = {
            commandId: command.commandId,
            status: "executed",
            result: handlerResult.value as TResponse,
            transportTimestamp: now
          };
        }
      }
    } catch (err) {
      finalReceipt = {
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_COMMAND_EXECUTION_FAILED",
          category: "internal",
          message: err instanceof Error ? err.message : "Unexpected command execution error"
        }),
        transportTimestamp: now
      };
    }

    this.#commandQueue.markFinished(command.commandId, finalReceipt.status === "executed");
    this.#dedupeStore.recordResult(command.commandId, finalReceipt);
    return ok(finalReceipt);
  }

  /**
   * Executes a command within the local authority host context (e.g. ticks, internal orchestration).
   *
   * Enforces G2-AUD-005 (authority host guard) and G2-AUD-006 (trusted provenance preservation).
   */
  async executeLocal<TPayload, TResult = unknown>(
    command: DomainCommand<TPayload>,
    source: OperationSource = { type: "system" }
  ): Promise<Result<TransportReceipt<TResult>, PublicError>> {
    if (!this.#authorityService.isCurrentUser()) {
      const commandId =
        typeof command === "object" && command !== null && "commandId" in command
          ? (command.commandId as CommandId)
          : (("cmd_" + "0".repeat(32)) as CommandId);

      return ok({
        commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_AUTHORITY_NOT_LOCAL",
          category: "permission",
          message: "Local command execution requires current client to be the primary authority"
        }),
        transportTimestamp: Date.now()
      } as TransportReceipt<TResult>);
    }

    const inboundContext: TransportInboundContext = {
      senderUserId: null,
      transportName: "local",
      receivedAtReal: Date.now(),
      operationSource: source
    };

    const message: TransportInboundMessage<TPayload> = {
      rawEnvelope: command,
      transportContext: inboundContext
    };

    return this.dispatchInbound<TResult>(message);
  }
}
