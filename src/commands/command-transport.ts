import type { PublicError } from "../core/contracts/public-error.js";
import type { Result } from "../core/contracts/result.js";
import type { CommandId, DomainCommand } from "./command-envelope.js";
import type { OperationSource } from "./authenticated-command-context.js";
import { sanitizeDiagnosticsValue } from "../diagnostics/sanitize.js";

/**
 * Transport receipt statuses as defined by Master Spec DEC-541–552 and §11.3.
 */
export type TransportReceiptStatus =
  | "delivered"
  | "acknowledged"
  | "executed"
  | "rejected"
  | "timed_out";

/**
 * Minimal transport-level response / receipt.
 *
 * Represents the transport-level outcome of a command transmission,
 * distinct from domain application state.
 */
export interface TransportReceipt<T = unknown> {
  readonly commandId: CommandId;
  readonly status: TransportReceiptStatus;
  readonly correlationId?: string;
  readonly result?: T;
  readonly error?: PublicError;
  readonly transportTimestamp: number;
}

/**
 * Deeply sanitizes a TransportReceipt for public transmission over remote transport.
 *
 * Enforces G2-AUD-018: Redacts sensitive keys (tokens, passwords, secrets, etc.)
 * in both `result` and `error.details`.
 */
export function sanitizeTransportReceiptForPublic<T = unknown>(
  receipt: TransportReceipt<T>
): TransportReceipt<T> {
  const sanitizedError = receipt.error
    ? Object.freeze({
        code: receipt.error.code,
        category: receipt.error.category,
        message: receipt.error.message,
        details:
          receipt.error.details !== undefined
            ? (sanitizeDiagnosticsValue(receipt.error.details) as any)
            : undefined,
        retryable: receipt.error.retryable,
        userActionRequired: receipt.error.userActionRequired,
        correlationId: receipt.error.correlationId
      })
    : undefined;

  return Object.freeze({
    commandId: receipt.commandId,
    status: receipt.status,
    correlationId: receipt.correlationId,
    result:
      receipt.result !== undefined
        ? (sanitizeDiagnosticsValue(receipt.result) as T)
        : undefined,
    error: sanitizedError,
    transportTimestamp: receipt.transportTimestamp
  });
}

export interface TransportSendOptions {
  readonly timeoutMs?: number;
  readonly correlationId?: string;
}

/**
 * Transport-level metadata providing the verified sender identity.
 *
 * INVARIANT: senderUserId is established by the transport (e.g. authenticated socket
 * session) and MUST NOT be influenced by client-provided payload data.
 */
export interface TransportInboundContext {
  readonly senderUserId: string | null;
  readonly transportName: string;
  readonly receivedAtReal: number;
  readonly operationSource?: OperationSource;
}

export interface TransportInboundMessage<TPayload = unknown> {
  readonly rawEnvelope: DomainCommand<TPayload> | unknown;
  readonly transportContext: TransportInboundContext;
}

export type TransportInboundHandler<TResponse = unknown> = (
  message: TransportInboundMessage
) => Promise<Result<TransportReceipt<TResponse>, PublicError>>;

/**
 * Pure CommandTransport abstraction contract.
 *
 * Allows clients to dispatch commands to the Primary Authority and allows
 * the Primary Authority host to receive inbound commands with authenticated
 * transport contexts.
 *
 * Master DEC-541–552:
 * - Transport is abstracted behind CommandTransport.
 * - Business logic does NOT import or depend on socketlib or native socket directly.
 * - Transport implementation may vary across Foundry versions; authority semantics do not.
 */
export interface CommandTransport {
  readonly name: string;
  readonly isAvailable: boolean;

  send<TPayload, TResponse = unknown>(
    command: DomainCommand<TPayload>,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>>;

  getStatus?<TResponse = unknown>(
    commandId: CommandId
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>>;

  registerInboundHandler(
    handler: TransportInboundHandler
  ): () => void;
}
