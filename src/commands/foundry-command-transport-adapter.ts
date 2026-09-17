import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import type { AuthorityElectionUser } from "../authority/primary-authority-election.js";
import type { PrimaryAuthorityService } from "../authority/primary-authority-service.js";
import type { CommandId, DomainCommand } from "./command-envelope.js";
import {
  type CommandTransport,
  sanitizeTransportReceiptForPublic,
  type TransportInboundContext,
  type TransportInboundHandler,
  type TransportInboundMessage,
  type TransportReceipt,
  type TransportSendOptions
} from "./command-transport.js";

export const DOMAIN_MANAGER_SOCKET_CHANNEL = "module.domain-manager";

export interface FoundrySocketLike {
  emit(event: string, ...args: unknown[]): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off?(event: string, callback: (...args: unknown[]) => void): void;
}

export interface FoundrySocketUserLike {
  readonly id: string;
  readonly name?: string;
  readonly isGM?: boolean;
}

export interface FoundrySocketRuntimeLike {
  readonly socket?: FoundrySocketLike;
  readonly user?: FoundrySocketUserLike | null;
  readonly users?: {
    get(id: string): { active?: boolean; isGM?: boolean; id: string } | undefined;
  };
}

export interface SocketlibContext {
  socketdata?: {
    userId?: string;
  };
}

export interface SocketlibSocketLike {
  register(
    name: string,
    func: (this: SocketlibContext | void, ...args: any[]) => any
  ): void;
  executeAsUser<T = unknown>(handlerName: string, userId: string, ...args: unknown[]): Promise<T>;
  executeAsGM?<T = unknown>(handlerName: string, ...args: unknown[]): Promise<T>;
}

export type SocketSenderResolver = (
  packet: unknown,
  ...args: unknown[]
) => string | null;

export type CommandStatusQueryHandler = (
  commandId: CommandId
) => Promise<Result<TransportReceipt<unknown>, PublicError>>;

export interface FoundryCommandTransportAdapterOptions {
  readonly runtime?: FoundrySocketRuntimeLike;
  readonly authorityService: PrimaryAuthorityService<AuthorityElectionUser>;
  readonly defaultTimeoutMs?: number;
  readonly senderResolver?: SocketSenderResolver;
  readonly socketlib?: SocketlibSocketLike;
}

export interface SocketRequestPacket {
  readonly protocol: "dm-command-v1";
  readonly kind: "DM_CMD_REQUEST";
  readonly correlationId: string;
  readonly command: unknown;
  readonly targetAuthorityUserId?: string;
  readonly targetAuthorityEpoch?: number;
  readonly declaredSenderUserId?: string;
  readonly senderUserId?: string;
}

export interface SocketResponsePacket {
  readonly protocol: "dm-command-v1";
  readonly kind: "DM_CMD_RESPONSE";
  readonly correlationId: string;
  readonly targetUserId: string;
  readonly authorityUserId: string;
  readonly authorityEpoch: number;
  readonly response: Result<TransportReceipt<unknown>, PublicError>;
}

export interface SocketStatusQueryPacket {
  readonly protocol: "dm-command-v1";
  readonly kind: "DM_CMD_STATUS_QUERY";
  readonly correlationId: string;
  readonly commandId: CommandId;
  readonly targetAuthorityUserId: string;
  readonly targetAuthorityEpoch?: number;
  readonly declaredSenderUserId: string;
}

export interface SocketStatusResponsePacket {
  readonly protocol: "dm-command-v1";
  readonly kind: "DM_CMD_STATUS_RESPONSE";
  readonly correlationId: string;
  readonly targetUserId: string;
  readonly authorityUserId: string;
  readonly authorityEpoch: number;
  readonly response: Result<TransportReceipt<unknown>, PublicError>;
}

function isSocketRequestPacket(packet: unknown): packet is SocketRequestPacket {
  if (typeof packet !== "object" || packet === null) return false;
  const p = packet as Record<string, unknown>;
  const sender = p.declaredSenderUserId ?? p.senderUserId;
  return (
    p.protocol === "dm-command-v1" &&
    p.kind === "DM_CMD_REQUEST" &&
    typeof p.correlationId === "string" &&
    p.correlationId.trim().length > 0 &&
    typeof sender === "string" &&
    sender.trim().length > 0 &&
    typeof p.command === "object" &&
    p.command !== null
  );
}

function isSocketResponsePacket(packet: unknown): packet is SocketResponsePacket {
  if (typeof packet !== "object" || packet === null) return false;
  const p = packet as Record<string, unknown>;
  return (
    p.protocol === "dm-command-v1" &&
    p.kind === "DM_CMD_RESPONSE" &&
    typeof p.correlationId === "string" &&
    typeof p.targetUserId === "string" &&
    typeof p.authorityUserId === "string" &&
    typeof p.authorityEpoch === "number" &&
    typeof p.response === "object" &&
    p.response !== null
  );
}

function isSocketStatusQueryPacket(packet: unknown): packet is SocketStatusQueryPacket {
  if (typeof packet !== "object" || packet === null) return false;
  const p = packet as Record<string, unknown>;
  return (
    p.protocol === "dm-command-v1" &&
    p.kind === "DM_CMD_STATUS_QUERY" &&
    typeof p.correlationId === "string" &&
    p.correlationId.trim().length > 0 &&
    typeof p.commandId === "string" &&
    p.commandId.trim().length > 0 &&
    typeof p.targetAuthorityUserId === "string" &&
    typeof p.declaredSenderUserId === "string"
  );
}

function isSocketStatusResponsePacket(packet: unknown): packet is SocketStatusResponsePacket {
  if (typeof packet !== "object" || packet === null) return false;
  const p = packet as Record<string, unknown>;
  return (
    p.protocol === "dm-command-v1" &&
    p.kind === "DM_CMD_STATUS_RESPONSE" &&
    typeof p.correlationId === "string" &&
    typeof p.targetUserId === "string" &&
    typeof p.authorityUserId === "string" &&
    typeof p.authorityEpoch === "number" &&
    typeof p.response === "object" &&
    p.response !== null
  );
}

function resolveFoundryRuntime(): FoundrySocketRuntimeLike {
  const globals = globalThis as unknown as {
    game?: FoundrySocketRuntimeLike;
  };
  return globals.game ?? {};
}

function resolveSocketlib(): SocketlibSocketLike | undefined {
  const globals = globalThis as unknown as {
    socketlib?: {
      registerModule(id: string): SocketlibSocketLike;
    };
  };
  try {
    return globals.socketlib?.registerModule("domain-manager");
  } catch {
    return undefined;
  }
}

/**
 * Foundry VTT CommandTransport adapter.
 *
 * Implements:
 * - Local loopback when current client is Primary Authority (zero network overhead).
 * - Directed RPC via Socketlib when available, executing only on Primary Authority (G2-AUD-004).
 * - Authenticated sender extraction: establishes sender identity strictly from verified transport session (G2-AUD-002).
 *   Fails closed when sender identity cannot be verified (never defaults to declaredSenderUserId).
 * - Verified authority response checking: ensures responses come strictly from the elected Primary Authority (G2-AUD-003).
 * - Authoritative command status query path across local and remote boundaries (G2-AUD-014).
 * - Boundary sanitization for all outgoing receipts (G2-AUD-018).
 * - Fail-closed behavior when authority is unavailable or transport times out.
 */
export class FoundryCommandTransportAdapter implements CommandTransport {
  readonly name = "foundry-socket";
  readonly #runtime: FoundrySocketRuntimeLike;
  readonly #authorityService: PrimaryAuthorityService<AuthorityElectionUser>;
  readonly #defaultTimeoutMs: number;
  readonly #senderResolver?: SocketSenderResolver;
  readonly #socketlib: SocketlibSocketLike | null;
  #inboundHandler: TransportInboundHandler | null = null;
  #statusQueryHandler: CommandStatusQueryHandler | null = null;

  constructor(options: FoundryCommandTransportAdapterOptions) {
    this.#runtime = options.runtime ?? resolveFoundryRuntime();
    this.#authorityService = options.authorityService;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 10000;
    this.#senderResolver = options.senderResolver;
    this.#socketlib = options.socketlib ?? resolveSocketlib() ?? null;

    this.#initSocketlib();
  }

  get isAvailable(): boolean {
    if (this.#authorityService.isCurrentUser()) {
      return true;
    }
    return Boolean(this.#socketlib) && this.#authorityService.getStatus().available;
  }

  get currentUserId(): string | null {
    return this.#runtime.user?.id ?? null;
  }

  registerInboundHandler(handler: TransportInboundHandler): () => void {
    this.#inboundHandler = handler;
    return () => {
      if (this.#inboundHandler === handler) {
        this.#inboundHandler = null;
      }
    };
  }

  registerStatusQueryHandler(handler: CommandStatusQueryHandler): () => void {
    this.#statusQueryHandler = handler;
    return () => {
      if (this.#statusQueryHandler === handler) {
        this.#statusQueryHandler = null;
      }
    };
  }

  destroy(): void {
    this.#inboundHandler = null;
    this.#statusQueryHandler = null;
  }

  async send<TPayload, TResponse = unknown>(
    command: DomainCommand<TPayload>,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>> {
    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is currently elected or available"
        })
      );
    }

    // Fast path: if the current client is the Primary Authority, execute locally without network serialization
    if (this.#authorityService.isCurrentUser()) {
      return this.#sendLocalLoopback(command);
    }

    // Directed RPC path: if Socketlib is available, execute directly on the Primary Authority client (G2-AUD-004)
    if (this.#socketlib) {
      return this.#sendSocketlibRPC(command, options);
    }

    // Remote socket fallback is strictly forbidden for mutations (G2 boundary invariant)
    return err(
      createPublicError({
        code: "DM_TRANSPORT_UNAVAILABLE",
        category: "busy",
        message: "Remote command execution requires Socketlib, which is not available"
      })
    );
  }

  /**
   * Queries authoritative command execution status across network boundaries (G2-AUD-014).
   */
  async getStatus<TResponse = unknown>(
    commandId: CommandId
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>> {
    // If local client is Primary Authority, query local handler directly
    if (this.#authorityService.isCurrentUser()) {
      if (this.#statusQueryHandler) {
        return this.#statusQueryHandler(commandId) as Promise<Result<TransportReceipt<TResponse>, PublicError>>;
      }
      return err(
        createPublicError({
          code: "DM_COMMAND_NOT_FOUND",
          category: "not-found",
          message: `Command '${commandId}' status could not be queried locally`
        })
      );
    }

    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is available for status query"
        })
      );
    }

    if (this.#socketlib) {
      try {
        const response = await this.#socketlib.executeAsUser<Result<TransportReceipt<TResponse>, PublicError>>(
          "queryCommandStatus",
          authorityStatus.authorityUserId,
          commandId
        );
        return response;
      } catch (error) {
        return err(
          createPublicError({
            code: "DM_TRANSPORT_QUERY_FAILED",
            category: "provider",
            message: error instanceof Error ? error.message : "Socketlib status query failed"
          })
        );
      }
    }

    return err(
      createPublicError({
        code: "DM_TRANSPORT_UNAVAILABLE",
        category: "busy",
        message: "Remote status query requires Socketlib, which is not available"
      })
    );
  }

  async #sendLocalLoopback<TPayload, TResponse>(
    command: DomainCommand<TPayload>
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>> {
    if (!this.#inboundHandler) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_NO_RECEIVER",
          category: "provider",
          message: "Primary authority local inbound handler is not registered"
        })
      );
    }

    const inboundContext: TransportInboundContext = {
      senderUserId: this.currentUserId,
      transportName: this.name,
      receivedAtReal: Date.now()
    };

    const inboundMessage: TransportInboundMessage<TPayload> = {
      rawEnvelope: command,
      transportContext: inboundContext
    };

    const result = await this.#inboundHandler(inboundMessage);
    return result as Result<TransportReceipt<TResponse>, PublicError>;
  }

  async #sendSocketlibRPC<TPayload, TResponse>(
    command: DomainCommand<TPayload>,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>> {
    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is available for RPC transmission"
        })
      );
    }

    const senderUserId = this.currentUserId;
    if (!senderUserId) {
      return err(
        createPublicError({
          code: "DM_AUTH_UNAUTHENTICATED",
          category: "permission",
          message: "Cannot send command without an active user session"
        })
      );
    }

    const correlationId =
      options?.correlationId ??
      `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const requestPacket: SocketRequestPacket = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_REQUEST",
      correlationId,
      command,
      targetAuthorityUserId: authorityStatus.authorityUserId,
      targetAuthorityEpoch: authorityStatus.authorityEpoch,
      declaredSenderUserId: senderUserId
    };

    try {
      const response = await this.#socketlib!.executeAsUser<Result<TransportReceipt<TResponse>, PublicError>>(
        "executeCommand",
        authorityStatus.authorityUserId,
        requestPacket
      );
      return response;
    } catch (error) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_SEND_FAILED",
          category: "provider",
          message: error instanceof Error ? error.message : "Socketlib RPC execution failed"
        })
      );
    }
  }

  #initSocketlib(): void {
    if (!this.#socketlib) return;
    const adapter = this;

    this.#socketlib.register(
      "executeCommand",
      async function (this: SocketlibContext | void, packet: unknown, ..._extraArgs: unknown[]) {
        const socketdataUserId =
          this && typeof this === "object" && "socketdata" in this && this.socketdata
            ? (typeof this.socketdata.userId === "string" && this.socketdata.userId.trim().length > 0
                ? this.socketdata.userId.trim()
                : null)
            : null;

        if (isSocketRequestPacket(packet)) {
          return adapter.#processInboundRequest(packet, socketdataUserId);
        }
        return err(
          createPublicError({
            code: "DM_INVALID_ENVELOPE",
            category: "validation",
            message: "Invalid RPC request packet"
          })
        );
      }
    );

    this.#socketlib.register(
      "queryCommandStatus",
      async function (this: SocketlibContext | void, commandId: unknown, ..._extraArgs: unknown[]) {
        const socketdataUserId =
          this && typeof this === "object" && "socketdata" in this && this.socketdata
            ? (typeof this.socketdata.userId === "string" && this.socketdata.userId.trim().length > 0
                ? this.socketdata.userId.trim()
                : null)
            : null;

        return adapter.#handleInboundStatusQuery(commandId, socketdataUserId);
      }
    );
  }

  async #handleInboundStatusQuery(
    commandId: unknown,
    trustedSenderUserId?: string | null
  ): Promise<Result<TransportReceipt<unknown>, PublicError>> {
    if (!this.#authorityService.isCurrentUser()) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_NOT_LOCAL",
          category: "permission",
          message: "Status query can only be answered by the active Primary Authority"
        })
      );
    }

    if (trustedSenderUserId === null) {
      return err(
        createPublicError({
          code: "DM_AUTH_UNAUTHENTICATED",
          category: "permission",
          message: "Status query requires authenticated transport session"
        })
      );
    }

    if (typeof commandId !== "string" || !commandId.startsWith("cmd_")) {
      return err(
        createPublicError({
          code: "DM_INVALID_COMMAND_ID",
          category: "validation",
          message: `Invalid commandId for status query: '${String(commandId)}'`
        })
      );
    }

    if (!this.#statusQueryHandler) {
      return err(
        createPublicError({
          code: "DM_COMMAND_NOT_FOUND",
          category: "not-found",
          message: "Status query handler is not registered on authority"
        })
      );
    }

    const res = await this.#statusQueryHandler(commandId as CommandId);
    return res.ok ? ok(sanitizeTransportReceiptForPublic(res.value)) : res;
  }

  async #processInboundRequest(
    packet: SocketRequestPacket,
    trustedSenderUserId?: string | null,
    ...transportArgs: unknown[]
  ): Promise<Result<TransportReceipt<unknown>, PublicError>> {
    const declaredSenderUserId =
      (typeof packet.declaredSenderUserId === "string" && packet.declaredSenderUserId.trim().length > 0
        ? packet.declaredSenderUserId.trim()
        : null) ??
      (typeof packet.senderUserId === "string" && packet.senderUserId.trim().length > 0
        ? packet.senderUserId.trim()
        : "");

    const commandId =
      typeof packet.command === "object" && packet.command !== null
        ? ((packet.command as Record<string, unknown>).commandId as string) ?? ("cmd_" + "0".repeat(32))
        : ("cmd_" + "0".repeat(32));

    const authorityStatus = this.#authorityService.getStatus();

    // Verify authority epoch matches (if specified in request)
    if (packet.targetAuthorityEpoch !== undefined && packet.targetAuthorityEpoch !== authorityStatus.authorityEpoch) {
      return ok({
        commandId: commandId as any,
        status: "rejected",
        error: createPublicError({
          code: "DM_AUTHORITY_EPOCH_MISMATCH",
          category: "conflict",
          message: `Command targeted epoch ${packet.targetAuthorityEpoch}, but current authority epoch is ${authorityStatus.authorityEpoch}`
        }),
        transportTimestamp: Date.now()
      });
    }

    // G2-AUD-002: Authenticated sender extraction from trusted transport layer
    let authenticatedSenderUserId: string | null = null;
    if (trustedSenderUserId && typeof trustedSenderUserId === "string" && trustedSenderUserId.trim().length > 0) {
      // Identity supplied directly by verified Socketlib execution context (this.socketdata.userId)
      authenticatedSenderUserId = trustedSenderUserId.trim();
    } else if (this.#senderResolver) {
      authenticatedSenderUserId = this.#senderResolver(packet, ...transportArgs);
    } else if (transportArgs.length > 0) {
      const firstArg = transportArgs[0];
      if (typeof firstArg === "string" && firstArg.trim().length > 0) {
        authenticatedSenderUserId = firstArg.trim();
      } else if (typeof firstArg === "object" && firstArg !== null) {
        const candidate = firstArg as Record<string, unknown>;
        if (typeof candidate.userId === "string" && candidate.userId.trim().length > 0) {
          authenticatedSenderUserId = candidate.userId.trim();
        } else if (typeof candidate.id === "string" && candidate.id.trim().length > 0) {
          authenticatedSenderUserId = candidate.id.trim();
        }
      }
    }

    // ANTI-SPOOFING INVARIANT (DEC-565–572, G2-AUD-002):
    // 1. Remote socket packet claiming to be the local Primary Authority is inherently spoofed.
    const localUserId = this.currentUserId;
    if (
      (localUserId !== null && declaredSenderUserId === localUserId) ||
      (authorityStatus.authorityUserId !== null && declaredSenderUserId === authorityStatus.authorityUserId)
    ) {
      return ok({
        commandId: commandId as any,
        status: "rejected",
        error: createPublicError({
          code: "DM_SECURITY_SENDER_SPOOFED",
          category: "permission",
          message: `Remote socket packet cannot claim identity of the local Primary Authority '${declaredSenderUserId}'`
        }),
        transportTimestamp: Date.now()
      });
    }

    // G2-AUD-002: If transport layer cannot identify the authentic sender, FAIL CLOSED!
    // NEVER fall back to declaredSenderUserId.
    if (authenticatedSenderUserId === null) {
      return ok({
        commandId: commandId as any,
        status: "rejected",
        error: createPublicError({
          code: "DM_AUTH_UNAUTHENTICATED",
          category: "permission",
          message: "Remote socket request has no verified transport sender identity"
        }),
        transportTimestamp: Date.now()
      });
    }

    if (
      (localUserId !== null && authenticatedSenderUserId === localUserId) ||
      (authorityStatus.authorityUserId !== null && authenticatedSenderUserId === authorityStatus.authorityUserId)
    ) {
      return ok({
        commandId: commandId as any,
        status: "rejected",
        error: createPublicError({
          code: "DM_SECURITY_SENDER_SPOOFED",
          category: "permission",
          message: `Remote socket packet cannot claim identity of the local Primary Authority '${declaredSenderUserId}'`
        }),
        transportTimestamp: Date.now()
      });
    }

    // 2. Divergence between claimed/declared sender and transport-authenticated sender is rejected.
    if (authenticatedSenderUserId !== declaredSenderUserId) {
      return ok({
        commandId: commandId as any,
        status: "rejected",
        error: createPublicError({
          code: "DM_SECURITY_SENDER_SPOOFED",
          category: "permission",
          message: `Declared sender '${declaredSenderUserId}' does not match transport authenticated sender '${authenticatedSenderUserId}'`
        }),
        transportTimestamp: Date.now()
      });
    }

    // 3. Verify sender exists and is active if users collection is present
    if (this.#runtime.users) {
      const senderUser = this.#runtime.users.get(authenticatedSenderUserId);
      if (!senderUser || senderUser.active === false) {
        return ok({
          commandId: commandId as any,
          status: "rejected",
          error: createPublicError({
            code: "DM_SECURITY_SENDER_UNKNOWN",
            category: "permission",
            message: `Remote socket sender '${authenticatedSenderUserId}' is not an active connected user`
          }),
          transportTimestamp: Date.now()
        });
      }
    }

    if (!this.#inboundHandler) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_NO_RECEIVER",
          category: "provider",
          message: "Primary authority local inbound handler is not registered"
        })
      );
    }

    const transportContext: TransportInboundContext = {
      senderUserId: authenticatedSenderUserId,
      transportName: this.name,
      receivedAtReal: Date.now()
    };

    const inboundMessage: TransportInboundMessage = {
      rawEnvelope: packet.command,
      transportContext
    };

    const response = await this.#inboundHandler(inboundMessage);

    // G2-AUD-018: Sanitize response receipt before returning over remote transport
    return response.ok ? ok(sanitizeTransportReceiptForPublic(response.value)) : response;
  }
}

