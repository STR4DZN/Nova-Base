import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { createOpaqueId, isOpaqueId } from "../core/identity/ids.js";

/**
 * Supported contract version for DomainCommand envelopes.
 */
export const COMMAND_CONTRACT_VERSION_V1 = 1;

/**
 * Branded identifier for domain commands, conforming to Master Spec §11.3 and DEC-0339–0360.
 */
export type CommandId = `cmd_${string}`;

export function createCommandId(): CommandId {
  return createOpaqueId("cmd") as CommandId;
}

export function isCommandId(value: unknown): value is CommandId {
  return isOpaqueId(value, "cmd");
}

export type ExpectedRevisions = Readonly<Record<string, number>>;

/**
 * Canonical DomainCommand envelope as specified by Master Spec §11.3 and DEC-553–564.
 *
 * Represents client intent before transport and authority processing.
 * Does NOT include authenticated sender identity; sender identity is established
 * exclusively by the transport boundary (DEC-565–572).
 */
export interface DomainCommand<TPayload = unknown> {
  readonly contractVersion: number;
  readonly commandId: CommandId;
  readonly type: string;
  readonly payload: TPayload;
  readonly issuedAtReal: number;
  readonly expectedRevision?: number;
  readonly expectedRevisions?: ExpectedRevisions;
  readonly targetRefs?: readonly string[];
  readonly authorityEpoch?: number;
  readonly reason?: string;
}

/**
 * Command type namespacing check (<namespace>:<action>), matching DEC-553.
 */
export function isCommandType(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed !== value) return false;
  return /^[a-z0-9-]+:[a-z0-9-]+$/.test(value);
}

export const MAX_COMMAND_PAYLOAD_BYTES = 65536; // 64 KB
export const MAX_COMMAND_PAYLOAD_DEPTH = 16;
export const MAX_COMMAND_PAYLOAD_KEYS = 500;
export const MAX_COMMAND_PAYLOAD_ARRAY_ITEMS = 1000;

interface JsonSafeCheckResult {
  readonly ok: boolean;
  readonly reason?: "not_json_safe" | "too_deep" | "too_large";
}

/**
 * Recursively verifies that a payload is strictly JSON-safe.
 * Rejects undefined, functions, symbols, bigints, circular references, and excessive depth.
 */
function checkPayloadJsonSafe(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): JsonSafeCheckResult {
  if (value === undefined) {
    return { ok: false, reason: "not_json_safe" };
  }
  if (value === null) {
    return { ok: true };
  }
  const type = typeof value;
  if (type === "number") {
    return Number.isFinite(value) ? { ok: true } : { ok: false, reason: "not_json_safe" };
  }
  if (type === "string" || type === "boolean") {
    return { ok: true };
  }
  if (type === "function" || type === "symbol" || type === "bigint") {
    return { ok: false, reason: "not_json_safe" };
  }

  if (typeof value === "object") {
    if (depth > MAX_COMMAND_PAYLOAD_DEPTH) {
      return { ok: false, reason: "too_deep" };
    }
    if (seen.has(value)) {
      return { ok: false, reason: "not_json_safe" };
    }
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length > MAX_COMMAND_PAYLOAD_ARRAY_ITEMS) {
        return { ok: false, reason: "too_large" };
      }
      for (const item of value) {
        const res = checkPayloadJsonSafe(item, depth + 1, seen);
        if (!res.ok) return res;
      }
      return { ok: true };
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      return { ok: false, reason: "not_json_safe" };
    }

    const keys = Object.keys(value);
    if (keys.length > MAX_COMMAND_PAYLOAD_KEYS) {
      return { ok: false, reason: "too_large" };
    }
    for (const key of keys) {
      const child = (value as Record<string, unknown>)[key];
      const res = checkPayloadJsonSafe(child, depth + 1, seen);
      if (!res.ok) return res;
    }
    return { ok: true };
  }

  return { ok: false, reason: "not_json_safe" };
}

export function isJsonSafe(value: unknown): boolean {
  return checkPayloadJsonSafe(value).ok;
}

/**
 * Validates a candidate command envelope according to canonical rules.
 * Fails closed with structured PublicError.
 */
export function validateCommandEnvelope<TPayload = unknown>(
  input: unknown
): Result<DomainCommand<TPayload>, PublicError> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_ENVELOPE_INVALID",
        category: "validation",
        message: "Command envelope must be a non-null object"
      })
    );
  }

  // Enforce maximum raw byte limit on input
  try {
    const rawLength = JSON.stringify(input).length;
    if (rawLength > MAX_COMMAND_PAYLOAD_BYTES) {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_PAYLOAD_TOO_LARGE",
          category: "validation",
          message: `Command envelope size (${rawLength} bytes) exceeds maximum allowable limit of ${MAX_COMMAND_PAYLOAD_BYTES} bytes`
        })
      );
    }
  } catch {
    // If JSON.stringify fails (e.g. BigInt/circular), deep validation below will catch it
  }

  const candidate = input as Record<string, unknown>;

  // contractVersion
  const contractVersion = candidate.contractVersion;
  if (
    typeof contractVersion !== "number" ||
    !Number.isSafeInteger(contractVersion) ||
    contractVersion <= 0
  ) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_CONTRACT_VERSION_INVALID",
        category: "validation",
        message: "contractVersion must be a positive safe integer"
      })
    );
  }

  if (contractVersion !== COMMAND_CONTRACT_VERSION_V1) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_CONTRACT_VERSION_UNSUPPORTED",
        category: "validation",
        message: `Unsupported command contract version: ${contractVersion}. Expected: ${COMMAND_CONTRACT_VERSION_V1}`
      })
    );
  }

  // commandId
  const commandId = candidate.commandId;
  if (!isCommandId(commandId)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_ID_INVALID",
        category: "validation",
        message: "commandId must be a valid opaque ID with 'cmd' prefix and UUID format"
      })
    );
  }

  // type
  const type = candidate.type;
  if (!isCommandType(type)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_TYPE_INVALID",
        category: "validation",
        message: "type must be a non-empty namespaced string (<namespace>:<action>)"
      })
    );
  }

  // payload
  const payload = candidate.payload;
  if (payload === undefined) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_PAYLOAD_REQUIRED",
        category: "validation",
        message: "Command payload is required"
      })
    );
  }

  const safeCheck = checkPayloadJsonSafe(payload);
  if (!safeCheck.ok) {
    if (safeCheck.reason === "too_deep") {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_PAYLOAD_TOO_DEEP",
          category: "validation",
          message: `Command payload exceeds maximum nesting depth of ${MAX_COMMAND_PAYLOAD_DEPTH}`
        })
      );
    }
    if (safeCheck.reason === "too_large") {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_PAYLOAD_TOO_LARGE",
          category: "validation",
          message: "Command payload exceeds maximum allowable keys or array items limit"
        })
      );
    }
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_PAYLOAD_NOT_JSON_SAFE",
        category: "validation",
        message: "Command payload must be strictly JSON-safe without undefined, functions, symbols, or circular references"
      })
    );
  }

  // issuedAtReal
  const issuedAtReal = candidate.issuedAtReal;
  if (
    typeof issuedAtReal !== "number" ||
    !Number.isSafeInteger(issuedAtReal) ||
    issuedAtReal <= 0
  ) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_ISSUED_AT_INVALID",
        category: "validation",
        message: "issuedAtReal must be a positive safe integer timestamp"
      })
    );
  }

  // expectedRevision (optional)
  const expectedRevision = candidate.expectedRevision;
  if (
    expectedRevision !== undefined &&
    (typeof expectedRevision !== "number" ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0)
  ) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_EXPECTED_REVISION_INVALID",
        category: "validation",
        message: "expectedRevision must be a non-negative safe integer when provided"
      })
    );
  }

  // expectedRevisions (optional)
  const expectedRevisions = candidate.expectedRevisions;
  if (expectedRevisions !== undefined) {
    if (
      typeof expectedRevisions !== "object" ||
      expectedRevisions === null ||
      Array.isArray(expectedRevisions)
    ) {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_EXPECTED_REVISIONS_INVALID",
          category: "validation",
          message: "expectedRevisions must be an object map of target to non-negative revision integer"
        })
      );
    }
    for (const [key, rev] of Object.entries(expectedRevisions)) {
      if (
        typeof rev !== "number" ||
        !Number.isSafeInteger(rev) ||
        rev < 0 ||
        key.trim().length === 0
      ) {
        return err(
          createPublicError({
            code: "DM_VALIDATION_COMMAND_EXPECTED_REVISIONS_INVALID",
            category: "validation",
            message: `expectedRevisions contains invalid entry for '${key}': revision must be a non-negative safe integer`
          })
        );
      }
    }
  }

  // targetRefs (optional)
  const targetRefs = candidate.targetRefs;
  if (targetRefs !== undefined) {
    if (
      !Array.isArray(targetRefs) ||
      targetRefs.some((r) => typeof r !== "string" || r.trim().length === 0)
    ) {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_TARGET_REFS_INVALID",
          category: "validation",
          message: "targetRefs must be an array of non-empty strings when provided"
        })
      );
    }
  }

  // authorityEpoch (optional)
  const authorityEpoch = candidate.authorityEpoch;
  if (
    authorityEpoch !== undefined &&
    (typeof authorityEpoch !== "number" ||
      !Number.isSafeInteger(authorityEpoch) ||
      authorityEpoch < 0)
  ) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_AUTHORITY_EPOCH_INVALID",
        category: "validation",
        message: "authorityEpoch must be a non-negative safe integer when provided"
      })
    );
  }

  // reason (optional)
  const reason = candidate.reason;
  if (reason !== undefined && typeof reason !== "string") {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_REASON_INVALID",
        category: "validation",
        message: "reason must be a string when provided"
      })
    );
  }

  const validated: DomainCommand<TPayload> = Object.freeze({
    contractVersion,
    commandId,
    type,
    payload: payload as TPayload,
    issuedAtReal,
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    ...(expectedRevisions !== undefined
      ? { expectedRevisions: Object.freeze({ ...(expectedRevisions as Record<string, number>) }) }
      : {}),
    ...(targetRefs !== undefined ? { targetRefs: Object.freeze([...targetRefs]) } : {}),
    ...(authorityEpoch !== undefined ? { authorityEpoch } : {}),
    ...(reason !== undefined ? { reason } : {})
  });

  return ok(validated);
}
