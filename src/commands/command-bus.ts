import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
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
import {
  type CommandTransport,
  sanitizeTransportReceiptForPublic,
  type TransportInboundContext,
  type TransportInboundMessage,
  type TransportReceipt
} from "./command-transport.js";
import { RateLimiter } from "./rate-limiter.js";
import {
  CommandDedupeStore,
  computeCommandFingerprint
} from "./command-dedupe-store.js";

import type { MutationCoordinator } from "../mutations/mutation-coordinator.js";
import { CommandQueue, type CommandQueueDiagnostics, type QueuedCommandStatus } from "./command-queue.js";
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
  #transport: CommandTransport | null = null;

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
    this.#transport = transport;
    let unregisterStatus: (() => void) | undefined;
    if (
      "registerStatusQueryHandler" in transport &&
      typeof (transport as any).registerStatusQueryHandler === "function"
    ) {
      unregisterStatus = (transport as any).registerStatusQueryHandler((id: CommandId) =>
        this.queryCommandStatus(id)
      );
    }
    const unregister = transport.registerInboundHandler(this.dispatchInbound.bind(this));
    let unregistered = false;
    const cleanup = () => {
      if (!unregistered) {
        unregistered = true;
        if (this.#transport === transport) {
          this.#transport = null;
        }
        unregisterStatus?.();
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
    this.#transport = null;
    this.#commandQueue.clear();
  }

  getCommandStatus<TResult = unknown>(commandId: CommandId): CommandStatusReport<TResult> {
    return this.#dedupeStore.getStatus<TResult>(commandId);
  }

  /**
   * Queries authoritative command execution status across local and remote boundaries (G2-AUD-014).
   *
   * If local host is the Primary Authority, reads directly from local DedupeStore.
   * If running on remote client, delegates to transport.getStatus(commandId).
   */
  async queryCommandStatus<TResult = unknown>(
    commandId: CommandId
  ): Promise<Result<TransportReceipt<TResult>, PublicError>> {
    if (this.#authorityService.isCurrentUser()) {
      const report = this.#dedupeStore.getStatus<TResult>(commandId);
      if (report.receipt) {
        return ok(report.receipt);
      }
      return err(
        createPublicError({
          code: "DM_COMMAND_NOT_FOUND",
          category: "not-found",
          message: `Command '${commandId}' was not found or is currently ${report.state}`
        })
      );
    }

    if (this.#transport?.getStatus) {
      return this.#transport.getStatus<TResult>(commandId);
    }

    return err(
      createPublicError({
        code: "DM_TRANSPORT_NOT_CONFIGURED",
        category: "internal",
        message: "Remote transport does not support status query"
      })
    );
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

    // 1. Fast Pre-Validation Rate Check before expensive parsing or JSON inspection (G2-AUD-028)
    const preRateLimit = this.#rateLimiter.checkPreValidationLimit(
      message.transportContext.senderUserId,
      now
    );
    if (!preRateLimit.ok) {
      this.#rateLimiter.recordAbuse(
        message.transportContext.senderUserId,
        "pre_validation_limit_exceeded",
        now
      );
      const rawId =
        typeof message.rawEnvelope === "object" &&
        message.rawEnvelope !== null &&
        typeof (message.rawEnvelope as any).commandId === "string"
          ? (message.rawEnvelope as any).commandId
          : (("cmd_" + "0".repeat(32)) as CommandId);

      return ok({
        commandId: rawId,
        status: "rejected",
        error: preRateLimit.error,
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    // 2. Validate Command Envelope
    const envelopeResult = validateCommandEnvelope(message.rawEnvelope);
    if (!envelopeResult.ok) {
      this.#rateLimiter.recordAbuse(
        message.transportContext.senderUserId,
        "malformed_envelope",
        now
      );
      const dummyId = ("cmd_" + "0".repeat(32)) as CommandId;
      return ok({
        commandId: dummyId,
        status: "rejected",
        error: envelopeResult.error,
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    const command = envelopeResult.value;

    // 3. Verify Authority Status & Host Eligibility (G2-AUD-005)
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

    // 4. Create Authenticated Context & Validate Sender Identity (G2-AUD-006)
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
      this.#rateLimiter.recordAbuse(
        message.transportContext.senderUserId,
        "auth_context_failed",
        now
      );
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: authContextResult.error,
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    const context = authContextResult.value;

    // 5. Handler Lookup
    const registration = this.#registry.get(command.type);
    if (!registration) {
      this.#rateLimiter.recordAbuse(
        context.senderUserId,
        `unknown_command_type:${command.type}`,
        now
      );
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

    // 6. Public vs Internal Command Boundary Check (Master §11.4, DEC-803)
    if (
      registration.visibility === "internal" &&
      message.transportContext.transportName !== "local"
    ) {
      this.#rateLimiter.recordAbuse(
        context.senderUserId,
        `internal_command_attempt:${command.type}`,
        now
      );
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

    // 7. Defensive Rate Limiting Check (Master §11.2, DEC-787–793)
    const rateLimitResult = this.#rateLimiter.checkAndConsume(
      context.senderUserId,
      command.type,
      now
    );
    if (!rateLimitResult.ok) {
      this.#rateLimiter.recordAbuse(
        context.senderUserId,
        `command_rate_limit_exceeded:${command.type}`,
        now
      );
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: rateLimitResult.error,
        transportTimestamp: now
      } as TransportReceipt<TResponse>);
    }

    // 8. Runtime Schema Validation (Master §11.2, DEC-573)
    if (registration.schemaValidator) {
      const schemaResult = registration.schemaValidator(command.payload);
      if (!schemaResult.ok) {
        this.#rateLimiter.recordAbuse(
          context.senderUserId,
          `invalid_payload_schema:${command.type}`,
          now
        );
        return ok({
          commandId: command.commandId,
          status: "rejected",
          error: schemaResult.error,
          transportTimestamp: now
        } as TransportReceipt<TResponse>);
      }
    }

    // 9. Permission Validation (Master §11.2, DEC-573–582)
    if (registration.permissionValidator) {
      const permResult = registration.permissionValidator(context);
      if (!permResult.ok) {
        this.#rateLimiter.recordAbuse(
          context.senderUserId,
          `permission_denied:${command.type}`,
          now
        );
        return ok({
          commandId: command.commandId,
          status: "rejected",
          error: permResult.error,
          transportTimestamp: now
        } as TransportReceipt<TResponse>);
      }
    }

    // 10. Dedupe Claim & Fingerprint Conflict Detection (Master §11.2, §11.3, DEC-593–602)
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
        const replayReceipt =
          message.transportContext.transportName !== "local"
            ? sanitizeTransportReceiptForPublic(claimResult.value.receipt)
            : claimResult.value.receipt;
        return ok(replayReceipt);
      }
      if (claimResult.value.inFlightPromise) {
        const awaitedReceipt = await claimResult.value.inFlightPromise;
        const sanitizedAwaited =
          message.transportContext.transportName !== "local"
            ? sanitizeTransportReceiptForPublic(awaitedReceipt)
            : awaitedReceipt;
        return ok(sanitizedAwaited);
      }
    }

    // 11. Enqueue into Authority Command Queue with internal-derived priority (G2-AUD-015)
    // Internal policy priority: System/Migration commands get high priority (10); user commands get normal (0).
    const internalPriority = source.type === "system" ? 10 : 0;
    const queueEntry = this.#commandQueue.enqueue(
      command,
      message.transportContext.senderUserId,
      { priority: internalPriority }
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

    // 12. Acquire Scheduler Permit (G2-AUD-015: concurrency and FIFO enforcement)
    try {
      await this.#commandQueue.acquirePermit(command.commandId);
    } catch (queueErr) {
      if ((queueEntry.status as QueuedCommandStatus) !== "cancelled") {
        this.#commandQueue.markFinished(command.commandId, false);
      }
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: queueErr as PublicError,
        transportTimestamp: Date.now()
      } as TransportReceipt<TResponse>);
    }

    // 13. Execute Handler / Transactional Coordinator (G2-AUD-007, G2-AUD-018)
    let finalReceipt: TransportReceipt<TResponse> | undefined = undefined;

    try {
      // Pre-execution cancellation check
      if (queueEntry.abortController.signal.aborted) {
        finalReceipt = {
          commandId: command.commandId,
          status: "rejected",
          error: createPublicError({
            code: "DM_COMMAND_CANCELLED",
            category: "busy",
            message: `Command was cancelled in queue: ${queueEntry.cancelReason ?? "Unknown reason"}`
          }),
          transportTimestamp: now
        };
      } else if (registration.transactional && registration.mutationDefinition) {
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
    } finally {
      if ((queueEntry.status as QueuedCommandStatus) !== "cancelled") {
        const isSuccess = finalReceipt !== undefined && finalReceipt.status === "executed";
        this.#commandQueue.markFinished(command.commandId, isSuccess);
      }
      this.#commandQueue.releasePermit(command.commandId);
    }

    const resolvedReceipt: TransportReceipt<TResponse> =
      finalReceipt ?? {
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_COMMAND_EXECUTION_FAILED",
          category: "internal",
          message: "Command execution ended without a valid receipt"
        }),
        transportTimestamp: now
      };

    this.#dedupeStore.recordResult(command.commandId, resolvedReceipt);

    // 14. Boundary Sanitization for Remote Receivers (G2-AUD-018)
    const receiptToReturn =
      message.transportContext.transportName !== "local"
        ? sanitizeTransportReceiptForPublic(resolvedReceipt)
        : resolvedReceipt;

    return ok(receiptToReturn);
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
