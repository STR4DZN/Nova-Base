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
  #socketListener: ((packet: unknown, ...args: unknown[]) => void) | null = null;
  readonly #pendingRequests = new Map<
    string,
    {
      resolve: (value: Result<TransportReceipt<unknown>, PublicError>) => void;
      reject: (reason: unknown) => void;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();

  constructor(options: FoundryCommandTransportAdapterOptions) {
    this.#runtime = options.runtime ?? resolveFoundryRuntime();
    this.#authorityService = options.authorityService;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 10000;
    this.#senderResolver = options.senderResolver;
    this.#socketlib = options.socketlib ?? resolveSocketlib() ?? null;

    this.#initSocketlib();
    this.#initSocketListener();
  }

  get isAvailable(): boolean {
    if (this.#authorityService.isCurrentUser()) {
      return true;
    }
    const hasTransport = Boolean(this.#socketlib) || Boolean(this.#runtime.socket);
    return hasTransport && this.#authorityService.getStatus().available;
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
    if (this.#socketListener && this.#runtime.socket?.off) {
      this.#runtime.socket.off(DOMAIN_MANAGER_SOCKET_CHANNEL, this.#socketListener);
    }
    this.#socketListener = null;
    this.#inboundHandler = null;
    this.#statusQueryHandler = null;

    for (const [, pending] of this.#pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.resolve(
        err(
          createPublicError({
            code: "DM_TRANSPORT_ABORTED",
            category: "busy",
            message: "Transport adapter destroyed while request was pending"
          })
        )
      );
    }
    this.#pendingRequests.clear();
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

    // Remote socket fallback path: dispatch to authority via socket
    return this.#sendRemoteSocket(command, options);
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

    return this.#sendStatusQuerySocket<TResponse>(commandId, authorityStatus);
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

  async #sendRemoteSocket<TPayload, TResponse>(
    command: DomainCommand<TPayload>,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>> {
    const socket = this.#runtime.socket;
    if (!socket) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_UNAVAILABLE",
          category: "busy",
          message: "Foundry socket runtime is not available"
        })
      );
    }

    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is available for socket transmission"
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

    if (this.#pendingRequests.has(correlationId)) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_CORRELATION_COLLISION",
          category: "conflict",
          message: `Pending request with correlationId '${correlationId}' already exists`
        })
      );
    }

    const timeoutMs = options?.timeoutMs ?? this.#defaultTimeoutMs;

    const requestPacket: SocketRequestPacket = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_REQUEST",
      correlationId,
      command,
      targetAuthorityUserId: authorityStatus.authorityUserId,
      targetAuthorityEpoch: authorityStatus.authorityEpoch,
      declaredSenderUserId: senderUserId
    };

    return new Promise<Result<TransportReceipt<TResponse>, PublicError>>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.#pendingRequests.delete(correlationId);
          resolve(
            err(
              createPublicError({
                code: "DM_TRANSPORT_TIMEOUT",
                category: "timeout",
                message: `Command socket request timed out after ${timeoutMs}ms`
              })
            )
          );
        }, timeoutMs);
      }

      this.#pendingRequests.set(correlationId, {
        resolve: (res) => resolve(res as Result<TransportReceipt<TResponse>, PublicError>),
        reject,
        timer
      });

      try {
        socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, requestPacket, { userId: senderUserId });
      } catch (error) {
        if (timer) clearTimeout(timer);
        this.#pendingRequests.delete(correlationId);
        resolve(
          err(
            createPublicError({
              code: "DM_TRANSPORT_SEND_FAILED",
              category: "provider",
              message: error instanceof Error ? error.message : "Socket emit failed"
            })
          )
        );
      }
    });
  }

  async #sendStatusQuerySocket<TResponse>(
    commandId: CommandId,
    authorityStatus: { authorityUserId: string | null; authorityEpoch: number }
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>> {
    const socket = this.#runtime.socket;
    if (!socket) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_UNAVAILABLE",
          category: "busy",
          message: "Foundry socket runtime is not available"
        })
      );
    }

    const senderUserId = this.currentUserId;
    if (!senderUserId) {
      return err(
        createPublicError({
          code: "DM_AUTH_UNAUTHENTICATED",
          category: "permission",
          message: "Cannot query status without an active user session"
        })
      );
    }

    const correlationId = `status_corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const packet: SocketStatusQueryPacket = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_STATUS_QUERY",
      correlationId,
      commandId,
      targetAuthorityUserId: authorityStatus.authorityUserId!,
      targetAuthorityEpoch: authorityStatus.authorityEpoch,
      declaredSenderUserId: senderUserId
    };

    return new Promise<Result<TransportReceipt<TResponse>, PublicError>>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (this.#defaultTimeoutMs > 0) {
        timer = setTimeout(() => {
          this.#pendingRequests.delete(correlationId);
          resolve(
            err(
              createPublicError({
                code: "DM_TRANSPORT_TIMEOUT",
                category: "timeout",
                message: `Status query socket request timed out after ${this.#defaultTimeoutMs}ms`
              })
            )
          );
        }, this.#defaultTimeoutMs);
      }

      this.#pendingRequests.set(correlationId, {
        resolve: (res) => resolve(res as Result<TransportReceipt<TResponse>, PublicError>),
        reject,
        timer
      });

      try {
        socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, packet, { userId: senderUserId });
      } catch (error) {
        if (timer) clearTimeout(timer);
        this.#pendingRequests.delete(correlationId);
        resolve(
          err(
            createPublicError({
              code: "DM_TRANSPORT_SEND_FAILED",
              category: "provider",
              message: error instanceof Error ? error.message : "Socket status query emit failed"
            })
          )
        );
      }
    });
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

  #initSocketListener(): void {
    const socket = this.#runtime.socket;
    if (!socket) return;

    this.#socketListener = (packet: unknown, ...args: unknown[]) => {
      this.#handleSocketPacket(packet, ...args).catch((err) => {
        console.error("[Domain Manager] Error processing socket packet:", err);
      });
    };

    socket.on(DOMAIN_MANAGER_SOCKET_CHANNEL, this.#socketListener);
  }

  async #handleSocketPacket(packet: unknown, ...args: unknown[]): Promise<void> {
    if (isSocketResponsePacket(packet)) {
      this.#handleResponsePacket(packet, ...args);
      return;
    }

    if (isSocketStatusResponsePacket(packet)) {
      this.#handleResponsePacket(packet as any, ...args);
      return;
    }

    if (isSocketStatusQueryPacket(packet)) {
      await this.#handleStatusQueryPacket(packet, ...args);
      return;
    }

    if (isSocketRequestPacket(packet)) {
      await this.#handleRequestPacket(packet, ...args);
      return;
    }
  }

  #handleResponsePacket(packet: SocketResponsePacket, ...transportArgs: unknown[]): void {
    const currentId = this.currentUserId;
    // Discard response if not targeted to this client
    if (currentId && packet.targetUserId !== currentId) {
      return;
    }

    const pending = this.#pendingRequests.get(packet.correlationId);
    if (!pending) return;

    // G2-AUD-003: Verify that response originated from the active elected Primary Authority
    const authorityStatus = this.#authorityService.getStatus();
    if (
      !authorityStatus.available ||
      !authorityStatus.authorityUserId ||
      packet.authorityUserId !== authorityStatus.authorityUserId ||
      packet.authorityEpoch !== authorityStatus.authorityEpoch
    ) {
      // Discard forged or stale response packet
      return;
    }

    // G2-AUD-003: Verify that transport layer arguments confirm the response came strictly from Primary Authority
    let responseSender: string | null = null;
    if (this.#senderResolver) {
      responseSender = this.#senderResolver(packet, ...transportArgs);
    } else if (transportArgs.length > 0) {
      const firstArg = transportArgs[0];
      if (typeof firstArg === "string" && firstArg.trim().length > 0) {
        responseSender = firstArg.trim();
      } else if (typeof firstArg === "object" && firstArg !== null) {
        const candidate = firstArg as Record<string, unknown>;
        if (typeof candidate.userId === "string" && candidate.userId.trim().length > 0) {
          responseSender = candidate.userId.trim();
        } else if (typeof candidate.id === "string" && candidate.id.trim().length > 0) {
          responseSender = candidate.id.trim();
        }
      }
    }

    if (responseSender === null || responseSender !== authorityStatus.authorityUserId) {
      // Discard forged response packet from non-authority client or unverified transport sender!
      return;
    }

    this.#pendingRequests.delete(packet.correlationId);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.resolve(packet.response);
  }

  async #handleStatusQueryPacket(
    packet: SocketStatusQueryPacket,
    ...transportArgs: unknown[]
  ): Promise<void> {
    if (
      !this.#authorityService.isCurrentUser() ||
      (packet.targetAuthorityUserId !== undefined && packet.targetAuthorityUserId !== this.currentUserId)
    ) {
      return;
    }

    const socket = this.#runtime.socket;
    if (!socket) return;

    const authorityStatus = this.#authorityService.getStatus();
    const declaredSenderUserId = packet.declaredSenderUserId;

    // Authenticate sender
    let authenticatedSenderUserId: string | null = null;
    if (this.#senderResolver) {
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

    if (authenticatedSenderUserId === null || authenticatedSenderUserId !== declaredSenderUserId) {
      return; // Discard unauthenticated or spoofed status query
    }

    const res = this.#statusQueryHandler
      ? await this.#statusQueryHandler(packet.commandId)
      : err(
          createPublicError({
            code: "DM_COMMAND_NOT_FOUND",
            category: "not-found",
            message: "Status query handler is not registered on authority"
          })
        );

    const sanitizedRes = res.ok ? ok(sanitizeTransportReceiptForPublic(res.value)) : res;

    const responsePacket: SocketStatusResponsePacket = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_STATUS_RESPONSE",
      correlationId: packet.correlationId,
      targetUserId: authenticatedSenderUserId,
      authorityUserId: authorityStatus.authorityUserId!,
      authorityEpoch: authorityStatus.authorityEpoch,
      response: sanitizedRes
    };

    try {
      socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, responsePacket, { userId: authorityStatus.authorityUserId });
    } catch (err) {
      console.error("[Domain Manager] Failed to emit status query response:", err);
    }
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

  async #handleRequestPacket(packet: SocketRequestPacket, ...transportArgs: unknown[]): Promise<void> {
    if (
      !this.#authorityService.isCurrentUser() ||
      (packet.targetAuthorityUserId !== undefined && packet.targetAuthorityUserId !== this.currentUserId)
    ) {
      return; // Silently ignore: not directed to this host
    }

    const socket = this.#runtime.socket;
    if (!socket) {
      return;
    }

    const authorityStatus = this.#authorityService.getStatus();
    const declaredSenderUserId =
      (typeof packet.declaredSenderUserId === "string" && packet.declaredSenderUserId.trim().length > 0
        ? packet.declaredSenderUserId.trim()
        : null) ??
      (typeof packet.senderUserId === "string" && packet.senderUserId.trim().length > 0
        ? packet.senderUserId.trim()
        : "");

    const response = await this.#processInboundRequest(packet, undefined, ...transportArgs);

    const responsePacket: SocketResponsePacket = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_RESPONSE",
      correlationId: packet.correlationId,
      targetUserId: declaredSenderUserId,
      authorityUserId: authorityStatus.authorityUserId!,
      authorityEpoch: authorityStatus.authorityEpoch,
      response
    };

    try {
      socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, responsePacket, { userId: authorityStatus.authorityUserId });
    } catch (error) {
      console.error("[Domain Manager] Failed to emit command response:", error);
    }
  }
}
