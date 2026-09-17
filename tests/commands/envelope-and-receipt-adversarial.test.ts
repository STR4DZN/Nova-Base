import test from "node:test";
import assert from "node:assert/strict";
import { validateCommandEnvelope, createCommandId } from "../../src/commands/command-envelope.js";
import { computeCommandFingerprint, CommandDedupeStore } from "../../src/commands/command-dedupe-store.js";
import { createMutationPlan } from "../../src/mutations/plans/plan-contract.js";
import { createMutationReceipt, sanitizeReceiptForPublic } from "../../src/mutations/receipt-contract.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";

test("Adversarial G2-AUD-019: validateCommandEnvelope rejects payload containing undefined at any depth", () => {
  const envelopeWithUndefined = {
    contractVersion: 1,
    commandId: createCommandId(),
    type: "domain:create",
    payload: {
      name: "Domain Alpha",
      extra: undefined // Must NOT be accepted because JSON.stringify drops undefined!
    },
    issuedAtReal: Date.now()
  };

  const result = validateCommandEnvelope(envelopeWithUndefined);
  assert.equal(result.ok, false, "Envelope containing undefined must be rejected");
  assert.equal(result.error?.code, "DM_VALIDATION_COMMAND_PAYLOAD_NOT_JSON_SAFE");
});

test("Adversarial G2-AUD-020: validateCommandEnvelope rejects oversized payloads or excessive nesting depth", () => {
  // Deeply nested payload > 16 levels
  let deepPayload: any = { value: 1 };
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

  // Huge payload > 64KB
  const hugeString = "X".repeat(70000);
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
    targetRefs: ["domain:a", "domain:c"] // Different target
  };

  const fpA = computeCommandFingerprint(cmdA as any);
  const fpB = computeCommandFingerprint(cmdB as any);

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

  // Caller attempts to mutate the payload after plan creation
  mutablePayload.domainName = "TAMPERED Name";
  mutablePayload.nestedConfig.active = false;

  const planPayload = plan.writeSet[0].payload as any;
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

  // transactionId must be omitted
  assert.equal((publicReceipt as any).transactionId, undefined);

  // Secrets in result must be redacted
  const pubResult = publicReceipt.result as any;
  assert.equal(pubResult.apiKey, "[REDACTED]");
  assert.equal(pubResult.userPasswordHash, "[REDACTED]");
  assert.equal(pubResult.domainId, "dom_1");

  // Secrets in error.details must be redacted
  const pubErrorDetails = publicReceipt.error?.details as any;
  assert.equal(pubErrorDetails.authorizationHeader, "[REDACTED]");
});
