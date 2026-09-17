// tests/commands/envelope-and-receipt-adversarial.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// src/core/contracts/public-error.ts
function createPublicError(error) {
  return Object.freeze({ ...error });
}

// src/core/contracts/result.ts
function ok(value, warnings) {
  return warnings === void 0 ? { ok: true, value } : { ok: true, value, warnings };
}
function err(error) {
  return { ok: false, error };
}

// src/core/identity/ids.ts
function createOpaqueId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
function isOpaqueId(value, prefix) {
  if (typeof value !== "string") return false;
  const pattern = prefix === void 0 ? /^(cmd|tx|prj|rel|rep|led|resv|req|role)_[0-9a-f-]{36}$/ : new RegExp(`^${prefix}_[0-9a-f-]{36}$`);
  return pattern.test(value);
}

// src/commands/command-envelope.ts
var COMMAND_CONTRACT_VERSION_V1 = 1;
function createCommandId() {
  return createOpaqueId("cmd");
}
function isCommandId(value) {
  return isOpaqueId(value, "cmd");
}
function isCommandType(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed !== value) return false;
  return /^[a-z0-9-]+:[a-z0-9-]+$/.test(value);
}
function isJsonSafe(value, seen = /* @__PURE__ */ new WeakSet()) {
  if (value === null || value === void 0) return true;
  const type = typeof value;
  if (type === "number") return Number.isFinite(value);
  if (type === "string" || type === "boolean") return true;
  if (type === "function" || type === "symbol" || type === "bigint") return false;
  if (typeof value === "object") {
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isJsonSafe(item, seen)) return false;
      }
      return true;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      return false;
    }
    for (const key of Object.keys(value)) {
      if (!isJsonSafe(value[key], seen)) return false;
    }
    return true;
  }
  return false;
}
function validateCommandEnvelope(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_ENVELOPE_INVALID",
        category: "validation",
        message: "Command envelope must be a non-null object"
      })
    );
  }
  const candidate = input;
  const contractVersion = candidate.contractVersion;
  if (typeof contractVersion !== "number" || !Number.isSafeInteger(contractVersion) || contractVersion <= 0) {
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
  const payload = candidate.payload;
  if (payload === void 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_PAYLOAD_REQUIRED",
        category: "validation",
        message: "Command payload is required"
      })
    );
  }
  if (!isJsonSafe(payload)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_PAYLOAD_NOT_JSON_SAFE",
        category: "validation",
        message: "Command payload must be JSON-safe without functions, symbols, or circular references"
      })
    );
  }
  const issuedAtReal = candidate.issuedAtReal;
  if (typeof issuedAtReal !== "number" || !Number.isSafeInteger(issuedAtReal) || issuedAtReal <= 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_ISSUED_AT_INVALID",
        category: "validation",
        message: "issuedAtReal must be a positive safe integer timestamp"
      })
    );
  }
  const expectedRevision = candidate.expectedRevision;
  if (expectedRevision !== void 0 && (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_EXPECTED_REVISION_INVALID",
        category: "validation",
        message: "expectedRevision must be a non-negative safe integer when provided"
      })
    );
  }
  const expectedRevisions = candidate.expectedRevisions;
  if (expectedRevisions !== void 0) {
    if (typeof expectedRevisions !== "object" || expectedRevisions === null || Array.isArray(expectedRevisions)) {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_EXPECTED_REVISIONS_INVALID",
          category: "validation",
          message: "expectedRevisions must be an object map of target to non-negative revision integer"
        })
      );
    }
    for (const [key, rev] of Object.entries(expectedRevisions)) {
      if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev < 0 || key.trim().length === 0) {
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
  const targetRefs = candidate.targetRefs;
  if (targetRefs !== void 0) {
    if (!Array.isArray(targetRefs) || targetRefs.some((r) => typeof r !== "string" || r.trim().length === 0)) {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_TARGET_REFS_INVALID",
          category: "validation",
          message: "targetRefs must be an array of non-empty strings when provided"
        })
      );
    }
  }
  const authorityEpoch = candidate.authorityEpoch;
  if (authorityEpoch !== void 0 && (typeof authorityEpoch !== "number" || !Number.isSafeInteger(authorityEpoch) || authorityEpoch < 0)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_AUTHORITY_EPOCH_INVALID",
        category: "validation",
        message: "authorityEpoch must be a non-negative safe integer when provided"
      })
    );
  }
  const reason = candidate.reason;
  if (reason !== void 0 && typeof reason !== "string") {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_REASON_INVALID",
        category: "validation",
        message: "reason must be a string when provided"
      })
    );
  }
  const validated = Object.freeze({
    contractVersion,
    commandId,
    type,
    payload,
    issuedAtReal,
    ...expectedRevision !== void 0 ? { expectedRevision } : {},
    ...expectedRevisions !== void 0 ? { expectedRevisions: Object.freeze({ ...expectedRevisions }) } : {},
    ...targetRefs !== void 0 ? { targetRefs: Object.freeze([...targetRefs]) } : {},
    ...authorityEpoch !== void 0 ? { authorityEpoch } : {},
    ...reason !== void 0 ? { reason } : {}
  });
  return ok(validated);
}

// src/commands/command-dedupe-store.ts
function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  const obj = value;
  const sortedKeys = Object.keys(obj).sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson(obj[key]);
  }
  return result;
}
function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalizeJson(value));
}
function computeFingerprint(value) {
  const json = canonicalJsonStringify(value);
  let h1 = 2166136261;
  let h2 = 2166136261;
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ ch >> 8, 16777619);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `fp_${hex1}${hex2}`;
}
function computeCommandFingerprint(command) {
  return computeFingerprint({
    type: command.type,
    payload: command.payload,
    expectedRevision: command.expectedRevision ?? null,
    expectedRevisions: command.expectedRevisions ?? null
  });
}

// src/mutations/plans/plan-contract.ts
function createMutationPlan(params) {
  const now = params.now ?? Date.now();
  const blockers = Object.freeze(params.blockers ? [...params.blockers] : []);
  const warnings = Object.freeze(params.warnings ? [...params.warnings] : []);
  const writeSet = Object.freeze(params.writeSet.map((op) => Object.freeze({ ...op })));
  const lockKeys = Object.freeze([...params.lockKeys]);
  const expectedRevisions = Object.freeze({ ...params.expectedRevisions });
  const readSetRevisions = params.readSetRevisions ? Object.freeze({ ...params.readSetRevisions }) : void 0;
  const planId = params.planId ?? `plan_${params.commandId}_${now}`;
  const fingerprint = computeFingerprint({
    commandId: params.commandId,
    writeSet,
    expectedRevisions,
    blockers,
    warnings
  });
  return Object.freeze({
    commandId: params.commandId,
    planId,
    fingerprint,
    lockKeys,
    writeSet,
    expectedRevisions,
    readSetRevisions,
    warnings,
    blockers,
    isExecutable: blockers.length === 0,
    summary: params.summary,
    customData: params.customData,
    createdAt: now
  });
}

// src/mutations/receipt-contract.ts
function createMutationReceipt(params) {
  const executedAt = params.executedAt ?? Date.now();
  const receiptId = params.receiptId ?? `rcpt_${params.commandId}_${executedAt}`;
  return Object.freeze({
    receiptId,
    commandId: params.commandId,
    transactionId: params.transactionId,
    correlationId: params.correlationId,
    status: params.status,
    changed: params.changed,
    resultingRevisions: Object.freeze({ ...params.resultingRevisions }),
    warnings: Object.freeze(params.warnings ? [...params.warnings] : []),
    summary: params.summary,
    result: params.result,
    error: params.error,
    executedAt,
    childReceipts: params.childReceipts ? Object.freeze([...params.childReceipts]) : void 0
  });
}
function sanitizeReceiptForPublic(receipt) {
  return Object.freeze({
    receiptId: receipt.receiptId,
    commandId: receipt.commandId,
    correlationId: receipt.correlationId,
    status: receipt.status,
    changed: receipt.changed,
    resultingRevisions: receipt.resultingRevisions,
    warnings: receipt.warnings,
    summary: receipt.summary,
    result: receipt.result,
    error: receipt.error,
    executedAt: receipt.executedAt
  });
}

// tests/commands/envelope-and-receipt-adversarial.test.ts
test("Adversarial G2-AUD-019: validateCommandEnvelope rejects payload containing undefined at any depth", () => {
  const envelopeWithUndefined = {
    contractVersion: 1,
    commandId: createCommandId(),
    type: "domain:create",
    payload: {
      name: "Domain Alpha",
      extra: void 0
      // Must NOT be accepted because JSON.stringify drops undefined!
    },
    issuedAtReal: Date.now()
  };
  const result = validateCommandEnvelope(envelopeWithUndefined);
  assert.equal(result.ok, false, "Envelope containing undefined must be rejected");
  assert.equal(result.error?.code, "DM_VALIDATION_COMMAND_PAYLOAD_NOT_JSON_SAFE");
});
test("Adversarial G2-AUD-020: validateCommandEnvelope rejects oversized payloads or excessive nesting depth", () => {
  let deepPayload = { value: 1 };
  for (let i = 0; i < 20; i++) {
    deepPayload = { nested: deepPayload };
  }
  const envelopeWithDeepNesting = {
    contractVersion: 1,
    commandId: createCommandId(),
    type: "domain:create",
    payload: deepPayload,
    issuedAtReal: Date.now()
  };
  const resultDeep = validateCommandEnvelope(envelopeWithDeepNesting);
  assert.equal(resultDeep.ok, false, "Deeply nested payload must be rejected");
  assert.equal(resultDeep.error?.code, "DM_VALIDATION_COMMAND_PAYLOAD_TOO_DEEP");
  const hugeString = "X".repeat(7e4);
  const envelopeHuge = {
    contractVersion: 1,
    commandId: createCommandId(),
    type: "domain:create",
    payload: { bigData: hugeString },
    issuedAtReal: Date.now()
  };
  const resultHuge = validateCommandEnvelope(envelopeHuge);
  assert.equal(resultHuge.ok, false, "Payload exceeding 64KB must be rejected");
  assert.equal(resultHuge.error?.code, "DM_VALIDATION_COMMAND_PAYLOAD_TOO_LARGE");
});
test("Adversarial G2-AUD-021: computeCommandFingerprint includes targetRefs in canonical intent", () => {
  const cmdA = {
    contractVersion: 1,
    commandId: createCommandId(),
    type: "domain:reparent",
    payload: { parentId: "p1" },
    targetRefs: ["domain:a", "domain:b"],
    issuedAtReal: Date.now()
  };
  const cmdB = {
    ...cmdA,
    targetRefs: ["domain:a", "domain:c"]
    // Different target
  };
  const fpA = computeCommandFingerprint(cmdA);
  const fpB = computeCommandFingerprint(cmdB);
  assert.notEqual(fpA, fpB, "Commands with different targetRefs must produce different fingerprints");
});
test("Adversarial G2-AUD-017: createMutationPlan is deeply immutable against caller-side object mutation", () => {
  const mutablePayload = {
    domainName: "Initial Name",
    nestedConfig: { active: true }
  };
  const plan = createMutationPlan({
    commandId: createCommandId(),
    lockKeys: ["domain:1"],
    writeSet: [
      {
        targetRef: "domain:1",
        operationType: "update",
        payload: mutablePayload
      }
    ],
    summary: "Deep immutability test"
  });
  mutablePayload.domainName = "TAMPERED Name";
  mutablePayload.nestedConfig.active = false;
  const planPayload = plan.writeSet[0].payload;
  assert.equal(planPayload.domainName, "Initial Name", "Plan payload must not change when caller object is mutated");
  assert.equal(planPayload.nestedConfig.active, true, "Plan nested payload must not change");
});
test("Adversarial G2-AUD-018: sanitizeReceiptForPublic redacts sensitive fields in result and error.details", () => {
  const receipt = createMutationReceipt({
    commandId: createCommandId(),
    status: "executed",
    changed: true,
    transactionId: "tx_secret_internal_id",
    result: {
      domainId: "dom_1",
      apiKey: "secret-token-12345",
      userPasswordHash: "hash-secret"
    },
    error: createPublicError({
      code: "DM_TEST_ERROR",
      category: "internal",
      message: "Internal error",
      details: {
        authorizationHeader: "Bearer secret-jwt-here"
      }
    })
  });
  const publicReceipt = sanitizeReceiptForPublic(receipt);
  assert.equal(publicReceipt.transactionId, void 0);
  const pubResult = publicReceipt.result;
  assert.equal(pubResult.apiKey, "[REDACTED]");
  assert.equal(pubResult.userPasswordHash, "[REDACTED]");
  assert.equal(pubResult.domainId, "dom_1");
  const pubErrorDetails = publicReceipt.error?.details;
  assert.equal(pubErrorDetails.authorizationHeader, "[REDACTED]");
});
