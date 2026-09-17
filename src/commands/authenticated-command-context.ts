import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import type { DomainCommand } from "./command-envelope.js";
import type { TransportInboundContext } from "./command-transport.js";

export type OperationSourceType =
  | "user"
  | "system"
  | "tick"
  | "project"
  | "event"
  | "provider"
  | "migration";

export interface OperationSource {
  readonly type: OperationSourceType;
  readonly ref?: string;
}

/**
 * AuthenticatedCommandContext as specified by Master Spec DEC-565–572.
 *
 * Separates the received client intent from the authenticated context
 * provided by the transport/runtime.
 *
 * INVARIANT: senderUserId is derived EXCLUSIVELY from the transport boundary
 * or technical authority context. It is NEVER read or trusted from command.payload.
 */
export interface AuthenticatedCommandContext<TPayload = unknown> {
  readonly command: DomainCommand<TPayload>;
  readonly senderUserId: string | null;
  readonly authorityUserId: string;
  readonly authorityEpoch: number;
  readonly receivedAtReal: number;
  readonly source: OperationSource;
}

export interface CreateAuthenticatedCommandContextParams<TPayload = unknown> {
  readonly command: DomainCommand<TPayload>;
  readonly transportContext: TransportInboundContext;
  readonly authorityUserId: string;
  readonly authorityEpoch: number;
  readonly receivedAtReal?: number;
  readonly source?: OperationSource;
}

/**
 * Checks if the payload contains any user identity field that diverges from
 * the authenticated transport sender.
 *
 * DEC-565: "Divergência entre claimed user e sender real é rejeitada/logada."
 */
function detectClaimedUserDivergence(
  payload: unknown,
  authenticatedSenderUserId: string | null
): string | null {
  if (typeof payload !== "object" || payload === null) return null;

  const candidate = payload as Record<string, unknown>;

  // Check top-level user id fields commonly used in spoofing attempts
  const claimed =
    candidate.userId ??
    candidate.claimedUserId ??
    candidate.senderUserId ??
    candidate.senderId;

  if (typeof claimed === "string" && claimed.trim().length > 0) {
    if (claimed !== authenticatedSenderUserId) {
      return claimed;
    }
  }

  // Check nested candidate.user.id
  if (typeof candidate.user === "object" && candidate.user !== null) {
    const nestedUser = candidate.user as Record<string, unknown>;
    if (typeof nestedUser.id === "string" && nestedUser.id.trim().length > 0) {
      if (nestedUser.id !== authenticatedSenderUserId) {
        return nestedUser.id;
      }
    }
  }

  return null;
}

/**
 * Boundary factory that constructs an AuthenticatedCommandContext.
 *
 * Enforces:
 * 1. Authenticated sender is taken strictly from transportContext.senderUserId.
 * 2. If payload contains a claimed user diverging from the authenticated sender,
 *    it is rejected with a security PublicError (DM_SECURITY_SENDER_SPOOFED).
 * 3. Authority identity and epoch must be valid.
 * 4. Result is an immutable context.
 */
export function createAuthenticatedCommandContext<TPayload = unknown>(
  params: CreateAuthenticatedCommandContextParams<TPayload>
): Result<AuthenticatedCommandContext<TPayload>, PublicError> {
  const { command, transportContext, authorityUserId, authorityEpoch } = params;

  if (typeof authorityUserId !== "string" || authorityUserId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_AUTHORITY_IDENTITY_INVALID",
        category: "validation",
        message: "authorityUserId must be a non-empty string"
      })
    );
  }

  if (!Number.isSafeInteger(authorityEpoch) || authorityEpoch < 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_AUTHORITY_EPOCH_INVALID",
        category: "validation",
        message: "authorityEpoch must be a non-negative safe integer"
      })
    );
  }

  const authenticatedSenderUserId = transportContext.senderUserId;

  // DEC-565: Validate claimed user divergence in payload against authenticated sender
  const divergentClaimedUser = detectClaimedUserDivergence(command.payload, authenticatedSenderUserId);
  if (divergentClaimedUser !== null) {
    return err(
      createPublicError({
        code: "DM_SECURITY_SENDER_SPOOFED",
        category: "permission",
        message: `Claimed user '${divergentClaimedUser}' in payload does not match authenticated transport sender '${authenticatedSenderUserId ?? "none"}'`,
        details: {
          claimedUserId: divergentClaimedUser,
          authenticatedSenderUserId
        }
      })
    );
  }

  const receivedAtReal = params.receivedAtReal ?? transportContext.receivedAtReal ?? Date.now();
  if (!Number.isSafeInteger(receivedAtReal) || receivedAtReal <= 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_RECEIVED_AT_INVALID",
        category: "validation",
        message: "receivedAtReal must be a positive safe integer timestamp"
      })
    );
  }

  const source: OperationSource = params.source ?? {
    type: authenticatedSenderUserId !== null ? "user" : "tick"
  };

  const context: AuthenticatedCommandContext<TPayload> = Object.freeze({
    command,
    senderUserId: authenticatedSenderUserId,
    authorityUserId,
    authorityEpoch,
    receivedAtReal,
    source: Object.freeze({ ...source })
  });

  return ok(context);
}
