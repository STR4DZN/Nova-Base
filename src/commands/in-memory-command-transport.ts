import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, type Result } from "../core/contracts/result.js";
import type { DomainCommand } from "./command-envelope.js";
import type {
  CommandTransport,
  TransportInboundContext,
  TransportInboundHandler,
  TransportInboundMessage,
  TransportReceipt,
  TransportSendOptions
} from "./command-transport.js";

export interface InMemoryTransportOptions {
  readonly currentUserId: string | null;
  readonly getAuthorityUserId?: () => string | null;
  readonly simulatedLatencyMs?: number;
  readonly dropPackets?: boolean;
}

/**
 * Shared in-memory router to simulate multi-client network topologies in tests.
 */
export class InMemoryTransportHub {
  readonly #peers = new Map<string, InMemoryCommandTransport>();

  registerPeer(userId: string, transport: InMemoryCommandTransport): () => void {
    this.#peers.set(userId, transport);
    return () => {
      if (this.#peers.get(userId) === transport) {
        this.#peers.delete(userId);
      }
    };
  }

  getPeer(userId: string): InMemoryCommandTransport | undefined {
    return this.#peers.get(userId);
  }

  clear(): void {
    this.#peers.clear();
  }
}

/**
 * In-memory implementation of CommandTransport.
 *
 * Supports:
 * - Direct loopback execution when the current user is the authority.
 * - Multi-peer routing via InMemoryTransportHub for multiplayer integration tests.
 * - Simulation of timeouts, packet drops, and disconnected peers.
 */
export class InMemoryCommandTransport implements CommandTransport {
  readonly name = "in-memory-command-transport";
  #currentUserId: string | null;
  #getAuthorityUserId: () => string | null;
  #hub: InMemoryTransportHub | null = null;
  #inboundHandler: TransportInboundHandler | null = null;
  #simulatedLatencyMs: number;
  #dropPackets: boolean;
  #isAvailable = true;

  constructor(options: InMemoryTransportOptions, hub?: InMemoryTransportHub) {
    this.#currentUserId = options.currentUserId;
    this.#getAuthorityUserId = options.getAuthorityUserId ?? (() => this.#currentUserId);
    this.#simulatedLatencyMs = options.simulatedLatencyMs ?? 0;
    this.#dropPackets = options.dropPackets ?? false;
    this.#hub = hub ?? null;

    if (this.#hub && this.#currentUserId) {
      this.#hub.registerPeer(this.#currentUserId, this);
    }
  }

  get isAvailable(): boolean {
    return this.#isAvailable;
  }

  setAvailable(available: boolean): void {
    this.#isAvailable = available;
  }

  setCurrentUserId(userId: string | null): void {
    this.#currentUserId = userId;
  }

  setDropPackets(drop: boolean): void {
    this.#dropPackets = drop;
  }

  setSimulatedLatencyMs(ms: number): void {
    this.#simulatedLatencyMs = ms;
  }

  registerInboundHandler(handler: TransportInboundHandler): () => void {
    this.#inboundHandler = handler;
    return () => {
      if (this.#inboundHandler === handler) {
        this.#inboundHandler = null;
      }
    };
  }

  async send<TPayload, TResponse = unknown>(
    command: DomainCommand<TPayload>,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>> {
    if (!this.#isAvailable) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_UNAVAILABLE",
          category: "busy",
          message: "Command transport is currently offline/unavailable"
        })
      );
    }

    if (this.#dropPackets) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_TIMEOUT",
          category: "timeout",
          message: "Command transport timed out waiting for authority response"
        })
      );
    }

    if (this.#simulatedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.#simulatedLatencyMs));
    }

    const authorityUserId = this.#getAuthorityUserId();
    if (!authorityUserId) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is currently elected or available"
        })
      );
    }

    const isLocalAuthority = this.#currentUserId === authorityUserId;

    // Target handler resolution
    let targetHandler: TransportInboundHandler | null = null;

    if (isLocalAuthority) {
      targetHandler = this.#inboundHandler;
    } else if (this.#hub) {
      const authorityPeer = this.#hub.getPeer(authorityUserId);
      targetHandler = authorityPeer ? authorityPeer.#inboundHandler : null;
    } else {
      targetHandler = this.#inboundHandler;
    }

    if (!targetHandler) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_NO_RECEIVER",
          category: "provider",
          message: `Primary authority handler for '${authorityUserId}' is not registered or reachable`
        })
      );
    }

    const inboundContext: TransportInboundContext = {
      senderUserId: this.#currentUserId,
      transportName: this.name,
      receivedAtReal: Date.now()
    };

    const inboundMessage: TransportInboundMessage<TPayload> = {
      rawEnvelope: command,
      transportContext: inboundContext
    };

    if (options?.timeoutMs !== undefined && options.timeoutMs > 0) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        const result = await Promise.race([
          targetHandler(inboundMessage),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("TRANSPORT_TIMEOUT"));
            }, options.timeoutMs);
          })
        ]);
        return result as Result<TransportReceipt<TResponse>, PublicError>;
      } catch (error) {
        if (error instanceof Error && error.message === "TRANSPORT_TIMEOUT") {
          return err(
            createPublicError({
              code: "DM_TRANSPORT_TIMEOUT",
              category: "timeout",
              message: `Transport timed out after ${options.timeoutMs}ms`
            })
          );
        }
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    const response = await targetHandler(inboundMessage);
    return response as Result<TransportReceipt<TResponse>, PublicError>;
  }

  async deliverInbound<TResponse = unknown>(
    message: TransportInboundMessage
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>> {
    if (!this.#inboundHandler) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_NO_RECEIVER",
          category: "provider",
          message: "No local inbound handler registered"
        })
      );
    }
    const res = await this.#inboundHandler(message);
    return res as Result<TransportReceipt<TResponse>, PublicError>;
  }
}
