import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import type { AuthorityElectionUser } from "../authority/primary-authority-election.js";
import type { PrimaryAuthorityService } from "../authority/primary-authority-service.js";
import type { DomainCommand } from "./command-envelope.js";
import type {
  CommandTransport,
  TransportInboundContext,
  TransportInboundHandler,
  TransportInboundMessage,
  TransportReceipt,
  TransportSendOptions
} from "./command-transport.js";

export const DOMAIN_MANAGER_SOCKET_CHANNEL = "module.domain-manager";

export interface FoundrySocketLike {
  emit(event: string, data: unknown): void;
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

export type SocketSenderResolver = (
  packet: unknown,
  ...args: unknown[]
) => string | null;

export interface FoundryCommandTransportAdapterOptions {
  readonly runtime?: FoundrySocketRuntimeLike;
  readonly authorityService: PrimaryAuthorityService<AuthorityElectionUser>;
  readonly defaultTimeoutMs?: number;
  readonly senderResolver?: SocketSenderResolver;
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

function resolveFoundryRuntime(): FoundrySocketRuntimeLike {
  const globals = globalThis as unknown as {
    game?: FoundrySocketRuntimeLike;
  };
  return globals.game ?? {};
}

/**
 * Foundry VTT CommandTransport adapter.
 *
 * Implements:
 * - Local loopback when the current client is the Primary Authority (zero serialization overhead).
 * - Directed socket dispatch to Primary Authority when running on player / secondary GM clients (G2-AUD-004).
 * - Authenticated sender extraction: establishes sender identity from verified transport session (G2-AUD-002).
 * - Verified authority response checking: ensures responses come strictly from the elected Primary Authority (G2-AUD-003).
 * - CorrelationId collision prevention (G2-AUD-027).
 * - Fail-closed behavior when authority is unavailable or socket times out.
 */
export class FoundryCommandTransportAdapter implements CommandTransport {
  readonly name = "foundry-socket";
  readonly #runtime: FoundrySocketRuntimeLike;
  readonly #authorityService: PrimaryAuthorityService<AuthorityElectionUser>;
  readonly #defaultTimeoutMs: number;
  readonly #senderResolver?: SocketSenderResolver;
  #inboundHandler: TransportInboundHandler | null = null;
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

    this.#initSocketListener();
  }

  get isAvailable(): boolean {
    if (this.#authorityService.isCurrentUser()) {
      return true;
    }
    return Boolean(this.#runtime.socket) && this.#authorityService.getStatus().available;
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

  destroy(): void {
    if (this.#socketListener && this.#runtime.socket?.off) {
      this.#runtime.socket.off(DOMAIN_MANAGER_SOCKET_CHANNEL, this.#socketListener);
    }
    this.#socketListener = null;
    this.#inboundHandler = null;

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

    // Fast path: if the current client is the Primary Authority, execute locally without socket serialization
    if (this.#authorityService.isCurrentUser()) {
      return this.#sendLocalLoopback(command);
    }

    // Remote client path: dispatch to authority via socket
    return this.#sendRemoteSocket(command, options);
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
        socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, requestPacket);
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

    if (transportArgs.length > 0) {
      const responseSender =
        typeof transportArgs[0] === "string"
          ? transportArgs[0]
          : typeof transportArgs[0] === "object" && transportArgs[0] !== null
            ? ((transportArgs[0] as any).userId ?? (transportArgs[0] as any).id)
            : null;
      if (responseSender && responseSender !== authorityStatus.authorityUserId) {
        return; // Forged response packet from non-authority client
      }
    }

    this.#pendingRequests.delete(packet.correlationId);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.resolve(packet.response);
  }

  async #handleRequestPacket(packet: SocketRequestPacket, ...transportArgs: unknown[]): Promise<void> {
    const declaredSenderUserId =
      (typeof packet.declaredSenderUserId === "string" && packet.declaredSenderUserId.trim().length > 0
        ? packet.declaredSenderUserId.trim()
        : null) ??
      (typeof packet.senderUserId === "string" && packet.senderUserId.trim().length > 0
        ? packet.senderUserId.trim()
        : "");

    // G2-AUD-004: Only the targeted Primary Authority processes inbound command requests
    if (
      !this.#authorityService.isCurrentUser() ||
      (packet.targetAuthorityUserId !== undefined && packet.targetAuthorityUserId !== this.currentUserId)
    ) {
      return; // Silently ignore: not directed to this host
    }

    const socket = this.#runtime.socket;
    if (!socket || !this.#inboundHandler) {
      return;
    }

    const authorityStatus = this.#authorityService.getStatus();

    // Verify authority epoch matches (if specified in request)
    if (packet.targetAuthorityEpoch !== undefined && packet.targetAuthorityEpoch !== authorityStatus.authorityEpoch) {
      const commandId =
        typeof packet.command === "object" && packet.command !== null
          ? ((packet.command as Record<string, unknown>).commandId as string) ?? ("cmd_" + "0".repeat(32))
          : ("cmd_" + "0".repeat(32));

      const responsePacket: SocketResponsePacket = {
        protocol: "dm-command-v1",
        kind: "DM_CMD_RESPONSE",
        correlationId: packet.correlationId,
        targetUserId: declaredSenderUserId,
        authorityUserId: authorityStatus.authorityUserId!,
        authorityEpoch: authorityStatus.authorityEpoch,
        response: ok({
          commandId: commandId as any,
          status: "rejected",
          error: createPublicError({
            code: "DM_AUTHORITY_EPOCH_MISMATCH",
            category: "conflict",
            message: `Command targeted epoch ${packet.targetAuthorityEpoch}, but current authority epoch is ${authorityStatus.authorityEpoch}`
          }),
          transportTimestamp: Date.now()
        })
      };

      try {
        socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, responsePacket);
      } catch (err) {
        console.error("[Domain Manager] Failed to emit epoch mismatch response:", err);
      }
      return;
    }

    // G2-AUD-002: Authenticated sender extraction from transport layer
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

    // If transport provides no argument, fall back to declaredSenderUserId
    if (authenticatedSenderUserId === null) {
      authenticatedSenderUserId = declaredSenderUserId;
    }

    const commandId =
      typeof packet.command === "object" && packet.command !== null
        ? ((packet.command as Record<string, unknown>).commandId as string) ?? ("cmd_" + "0".repeat(32))
        : ("cmd_" + "0".repeat(32));

    // ANTI-SPOOFING INVARIANT (DEC-565–572, G2-AUD-002):
    // 1. Remote socket packet claiming to be the local Primary Authority is inherently spoofed.
    // 2. Divergence between claimed/declared sender and transport-authenticated sender is rejected.
    const localUserId = this.currentUserId;
    if (
      (localUserId !== null && (declaredSenderUserId === localUserId || authenticatedSenderUserId === localUserId)) ||
      (authorityStatus.authorityUserId !== null && (declaredSenderUserId === authorityStatus.authorityUserId || authenticatedSenderUserId === authorityStatus.authorityUserId))
    ) {
      const responsePacket: SocketResponsePacket = {
        protocol: "dm-command-v1",
        kind: "DM_CMD_RESPONSE",
        correlationId: packet.correlationId,
        targetUserId: declaredSenderUserId,
        authorityUserId: authorityStatus.authorityUserId!,
        authorityEpoch: authorityStatus.authorityEpoch,
        response: ok({
          commandId: commandId as any,
          status: "rejected",
          error: createPublicError({
            code: "DM_SECURITY_SENDER_SPOOFED",
            category: "permission",
            message: `Remote socket packet cannot claim identity of the local Primary Authority '${declaredSenderUserId}'`
          }),
          transportTimestamp: Date.now()
        })
      };

      try {
        socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, responsePacket);
      } catch (error) {
        console.error("[Domain Manager] Failed to emit spoofing rejection response:", error);
      }
      return;
    }

    if (authenticatedSenderUserId !== declaredSenderUserId) {
      const responsePacket: SocketResponsePacket = {
        protocol: "dm-command-v1",
        kind: "DM_CMD_RESPONSE",
        correlationId: packet.correlationId,
        targetUserId: declaredSenderUserId,
        authorityUserId: authorityStatus.authorityUserId!,
        authorityEpoch: authorityStatus.authorityEpoch,
        response: ok({
          commandId: commandId as any,
          status: "rejected",
          error: createPublicError({
            code: "DM_SECURITY_SENDER_SPOOFED",
            category: "permission",
            message: `Declared sender '${declaredSenderUserId}' does not match transport authenticated sender '${authenticatedSenderUserId}'`
          }),
          transportTimestamp: Date.now()
        })
      };

      try {
        socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, responsePacket);
      } catch (error) {
        console.error("[Domain Manager] Failed to emit spoofing rejection response:", error);
      }
      return;
    }

    // Verify sender exists and is active if users collection is present
    if (this.#runtime.users) {
      const senderUser = this.#runtime.users.get(authenticatedSenderUserId);
      if (!senderUser || senderUser.active === false) {
        const responsePacket: SocketResponsePacket = {
          protocol: "dm-command-v1",
          kind: "DM_CMD_RESPONSE",
          correlationId: packet.correlationId,
          targetUserId: declaredSenderUserId,
          authorityUserId: authorityStatus.authorityUserId!,
          authorityEpoch: authorityStatus.authorityEpoch,
          response: ok({
            commandId: commandId as any,
            status: "rejected",
            error: createPublicError({
              code: "DM_SECURITY_SENDER_UNKNOWN",
              category: "permission",
              message: `Remote socket sender '${authenticatedSenderUserId}' is not an active connected user`
            }),
            transportTimestamp: Date.now()
          })
        };

        try {
          socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, responsePacket);
        } catch (error) {
          console.error("[Domain Manager] Failed to emit unknown sender rejection response:", error);
        }
        return;
      }
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

    const responsePacket: SocketResponsePacket = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_RESPONSE",
      correlationId: packet.correlationId,
      targetUserId: authenticatedSenderUserId,
      authorityUserId: authorityStatus.authorityUserId!,
      authorityEpoch: authorityStatus.authorityEpoch,
      response
    };

    try {
      socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, responsePacket);
    } catch (error) {
      console.error("[Domain Manager] Failed to emit command response:", error);
    }
  }
}
