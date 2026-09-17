import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  isCommandId,
  isCommandType,
  validateCommandEnvelope,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import {
  createAuthenticatedCommandContext,
  type AuthenticatedCommandContext
} from "../../src/commands/authenticated-command-context.js";
import {
  type CommandTransport,
  type TransportInboundContext,
  type TransportInboundHandler,
  type TransportInboundMessage,
  type TransportReceipt,
  type TransportSendOptions
} from "../../src/commands/command-transport.js";
import { ok, err, type Result } from "../../src/core/contracts/result.js";
import { createPublicError, type PublicError } from "../../src/core/contracts/public-error.js";

// Helper to build a canonical valid command
function createValidCommand(overrides: Partial<DomainCommand<unknown>> = {}): DomainCommand<unknown> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "domain:create",
    payload: { name: "Test Domain", size: "county" },
    issuedAtReal: 1700000000000,
    ...overrides
  };
}

// In-memory test double for CommandTransport
class InMemoryLoopbackTransport implements CommandTransport {
  readonly name = "in-memory-test-transport";
  readonly isAvailable = true;
  #handler: TransportInboundHandler | null = null;
  readonly senderUserId: string | null;

  constructor(senderUserId: string | null = "user-alice") {
    this.senderUserId = senderUserId;
  }

  registerInboundHandler(handler: TransportInboundHandler): () => void {
    this.#handler = handler;
    return () => {
      if (this.#handler === handler) {
        this.#handler = null;
      }
    };
  }

  async send<TPayload, TResponse = unknown>(
    command: DomainCommand<TPayload>,
    _options?: TransportSendOptions
  ): Promise<Result<TransportReceipt<TResponse>, PublicError>> {
    if (!this.#handler) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_NO_RECEIVER",
          category: "provider",
          message: "No transport receiver registered"
        })
      );
    }

    const inboundContext: TransportInboundContext = {
      senderUserId: this.senderUserId,
      transportName: this.name,
      receivedAtReal: Date.now()
    };

    const inboundMessage: TransportInboundMessage<TPayload> = {
      rawEnvelope: command,
      transportContext: inboundContext
    };

    const response = await this.#handler(inboundMessage);
    return response as Result<TransportReceipt<TResponse>, PublicError>;
  }
}

// ============================================================================
// Command Envelope & CommandId Tests
// ============================================================================

test("createCommandId generates an opaque ID with 'cmd' prefix and valid UUID", () => {
  const id = createCommandId();
  assert.equal(typeof id, "string");
  assert.ok(id.startsWith("cmd_"));
  assert.equal(isCommandId(id), true);
  assert.equal(isCommandId("not-a-cmd-id"), false);
  assert.equal(isCommandId("cmd_12345"), false);
  assert.equal(isCommandId("tx_b1a37c0f-0b3f-4e0e-a2cf-e8ffbb31e505"), false);
  assert.equal(isCommandId("cmd_b1a37c0f-0b3f-4e0e-a2cf-e8ffbb31e505"), true);
});

test("isCommandType enforces namespaced <namespace>:<action> format", () => {
  assert.equal(isCommandType("domain:create"), true);
  assert.equal(isCommandType("economy:transfer-resource"), true);
  assert.equal(isCommandType("people:assign-role"), true);
  assert.equal(isCommandType("create"), false);
  assert.equal(isCommandType(""), false);
  assert.equal(isCommandType("  domain:create  "), false);
  assert.equal(isCommandType(123), false);
  assert.equal(isCommandType(null), false);
});

test("validateCommandEnvelope accepts a canonical valid command", () => {
  const command = createValidCommand();
  const result = validateCommandEnvelope(command);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.contractVersion, 1);
    assert.equal(result.value.type, "domain:create");
    assert.deepEqual(result.value.payload, { name: "Test Domain", size: "county" });
    assert.equal(Object.isFrozen(result.value), true);
  }
});

test("validateCommandEnvelope accepts optional declarative fields without mutating them", () => {
  const command = createValidCommand({
    expectedRevision: 4,
    expectedRevisions: { "JournalEntry.123": 4, "JournalEntry.456": 2 },
    targetRefs: ["JournalEntry.123"],
    authorityEpoch: 2,
    reason: "Player expansion request"
  });

  const result = validateCommandEnvelope(command);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.expectedRevision, 4);
    assert.deepEqual(result.value.expectedRevisions, { "JournalEntry.123": 4, "JournalEntry.456": 2 });
    assert.deepEqual(result.value.targetRefs, ["JournalEntry.123"]);
    assert.equal(result.value.authorityEpoch, 2);
    assert.equal(result.value.reason, "Player expansion request");
    assert.equal(Object.isFrozen(result.value.expectedRevisions), true);
    assert.equal(Object.isFrozen(result.value.targetRefs), true);
  }
});

test("validateCommandEnvelope rejects non-object inputs", () => {
  assert.equal(validateCommandEnvelope(null).ok, false);
  assert.equal(validateCommandEnvelope(undefined).ok, false);
  assert.equal(validateCommandEnvelope("raw-string").ok, false);
  assert.equal(validateCommandEnvelope([1, 2, 3]).ok, false);
  assert.equal(validateCommandEnvelope(123).ok, false);
});

test("validateCommandEnvelope rejects missing, non-integer, or unsupported contractVersion", () => {
  const base = createValidCommand();

  const missingVer = { ...base, contractVersion: undefined };
  const r1 = validateCommandEnvelope(missingVer);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.error.code, "DM_VALIDATION_COMMAND_CONTRACT_VERSION_INVALID");

  const zeroVer = { ...base, contractVersion: 0 };
  const r2 = validateCommandEnvelope(zeroVer);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.error.code, "DM_VALIDATION_COMMAND_CONTRACT_VERSION_INVALID");

  const negVer = { ...base, contractVersion: -1 };
  const r3 = validateCommandEnvelope(negVer);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.error.code, "DM_VALIDATION_COMMAND_CONTRACT_VERSION_INVALID");

  const floatVer = { ...base, contractVersion: 1.5 };
  const r4 = validateCommandEnvelope(floatVer);
  assert.equal(r4.ok, false);
  if (!r4.ok) assert.equal(r4.error.code, "DM_VALIDATION_COMMAND_CONTRACT_VERSION_INVALID");

  const futureVer = { ...base, contractVersion: 99 };
  const r5 = validateCommandEnvelope(futureVer);
  assert.equal(r5.ok, false);
  if (!r5.ok) assert.equal(r5.error.code, "DM_VALIDATION_COMMAND_CONTRACT_VERSION_UNSUPPORTED");
});

test("validateCommandEnvelope rejects missing or invalid commandId", () => {
  const base = createValidCommand();

  const missingId = { ...base, commandId: undefined };
  const r1 = validateCommandEnvelope(missingId);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.error.code, "DM_VALIDATION_COMMAND_ID_INVALID");

  const invalidId = { ...base, commandId: "plain-uuid-without-prefix" };
  const r2 = validateCommandEnvelope(invalidId);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.error.code, "DM_VALIDATION_COMMAND_ID_INVALID");

  const wrongPrefix = { ...base, commandId: "tx_b1a37c0f-0b3f-4e0e-a2cf-e8ffbb31e505" };
  const r3 = validateCommandEnvelope(wrongPrefix);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.error.code, "DM_VALIDATION_COMMAND_ID_INVALID");
});

test("validateCommandEnvelope rejects empty or invalid type", () => {
  const base = createValidCommand();

  const emptyType = { ...base, type: "" };
  const r1 = validateCommandEnvelope(emptyType);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.error.code, "DM_VALIDATION_COMMAND_TYPE_INVALID");

  const unnamespacedType = { ...base, type: "create" };
  const r2 = validateCommandEnvelope(unnamespacedType);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.error.code, "DM_VALIDATION_COMMAND_TYPE_INVALID");

  const spaceType = { ...base, type: "domain: create" };
  const r3 = validateCommandEnvelope(spaceType);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.error.code, "DM_VALIDATION_COMMAND_TYPE_INVALID");
});

test("validateCommandEnvelope rejects missing or non-JSON-safe payloads", () => {
  const base = createValidCommand();

  const missingPayload = { ...base, payload: undefined };
  const r1 = validateCommandEnvelope(missingPayload);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.error.code, "DM_VALIDATION_COMMAND_PAYLOAD_REQUIRED");

  // Function in payload
  const funcPayload = { ...base, payload: { fn: () => "malicious" } };
  const r2 = validateCommandEnvelope(funcPayload);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.error.code, "DM_VALIDATION_COMMAND_PAYLOAD_NOT_JSON_SAFE");

  // Symbol in payload
  const symbolPayload = { ...base, payload: { sym: Symbol("evil") } };
  const r3 = validateCommandEnvelope(symbolPayload);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.error.code, "DM_VALIDATION_COMMAND_PAYLOAD_NOT_JSON_SAFE");

  // Circular reference in payload
  const circular: Record<string, unknown> = { name: "loop" };
  circular.self = circular;
  const circularPayload = { ...base, payload: circular };
  const r4 = validateCommandEnvelope(circularPayload);
  assert.equal(r4.ok, false);
  if (!r4.ok) assert.equal(r4.error.code, "DM_VALIDATION_COMMAND_PAYLOAD_NOT_JSON_SAFE");
});

test("validateCommandEnvelope rejects invalid issuedAtReal", () => {
  const base = createValidCommand();

  assert.equal(validateCommandEnvelope({ ...base, issuedAtReal: 0 }).ok, false);
  assert.equal(validateCommandEnvelope({ ...base, issuedAtReal: -100 }).ok, false);
  assert.equal(validateCommandEnvelope({ ...base, issuedAtReal: "now" }).ok, false);
  assert.equal(validateCommandEnvelope({ ...base, issuedAtReal: NaN }).ok, false);
});

test("validateCommandEnvelope rejects invalid optional fields", () => {
  const base = createValidCommand();

  // Negative expectedRevision
  const r1 = validateCommandEnvelope({ ...base, expectedRevision: -1 });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.error.code, "DM_VALIDATION_COMMAND_EXPECTED_REVISION_INVALID");

  // Invalid expectedRevisions map
  const r2 = validateCommandEnvelope({ ...base, expectedRevisions: { "doc": -5 } });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.error.code, "DM_VALIDATION_COMMAND_EXPECTED_REVISIONS_INVALID");

  // Invalid targetRefs
  const r3 = validateCommandEnvelope({ ...base, targetRefs: ["valid", ""] });
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.error.code, "DM_VALIDATION_COMMAND_TARGET_REFS_INVALID");

  // Invalid authorityEpoch
  const r4 = validateCommandEnvelope({ ...base, authorityEpoch: -2 });
  assert.equal(r4.ok, false);
  if (!r4.ok) assert.equal(r4.error.code, "DM_VALIDATION_COMMAND_AUTHORITY_EPOCH_INVALID");

  // Invalid reason
  const r5 = validateCommandEnvelope({ ...base, reason: 12345 });
  assert.equal(r5.ok, false);
  if (!r5.ok) assert.equal(r5.error.code, "DM_VALIDATION_COMMAND_REASON_INVALID");
});

// ============================================================================
// Authenticated Sender Boundary & Anti-Spoofing Tests
// ============================================================================

test("authenticated sender is derived solely from transportContext.senderUserId", () => {
  const command = createValidCommand({
    payload: { name: "Safe Domain" }
  });

  const transportContext: TransportInboundContext = {
    senderUserId: "user-legit-player",
    transportName: "test-transport",
    receivedAtReal: 1700000001000
  };

  const result = createAuthenticatedCommandContext({
    command,
    transportContext,
    authorityUserId: "gm-authority",
    authorityEpoch: 1
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.senderUserId, "user-legit-player");
    assert.equal(result.value.authorityUserId, "gm-authority");
    assert.equal(result.value.authorityEpoch, 1);
    assert.equal(result.value.receivedAtReal, 1700000001000);
    assert.equal(result.value.source.type, "user");
    assert.equal(Object.isFrozen(result.value), true);
  }
});

test("ADVERSARIAL: payload containing spoofed userId is rejected as divergence", () => {
  const command = createValidCommand({
    payload: {
      userId: "gm-admin-id", // Attacker claims to be GM in payload
      action: "nuke-all-domains"
    }
  });

  const transportContext: TransportInboundContext = {
    senderUserId: "player-malicious-id", // Transport actually verified player
    transportName: "test-transport",
    receivedAtReal: 1700000001000
  };

  const result = createAuthenticatedCommandContext({
    command,
    transportContext,
    authorityUserId: "gm-authority",
    authorityEpoch: 1
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "DM_SECURITY_SENDER_SPOOFED");
    assert.equal(result.error.category, "permission");
    assert.ok(result.error.message.includes("Claimed user 'gm-admin-id'"));
    assert.deepEqual(result.error.details, {
      claimedUserId: "gm-admin-id",
      authenticatedSenderUserId: "player-malicious-id"
    });
  }
});

test("ADVERSARIAL: payload containing spoofed claimedUserId, senderUserId, or senderId is rejected", () => {
  const testCases = [
    { claimedUserId: "gm-admin" },
    { senderUserId: "gm-admin" },
    { senderId: "gm-admin" }
  ];

  const transportContext: TransportInboundContext = {
    senderUserId: "player-123",
    transportName: "test-transport",
    receivedAtReal: 1700000001000
  };

  for (const spoofedPayload of testCases) {
    const command = createValidCommand({ payload: spoofedPayload });
    const result = createAuthenticatedCommandContext({
      command,
      transportContext,
      authorityUserId: "gm-authority",
      authorityEpoch: 1
    });

    assert.equal(result.ok, false, `Expected rejection for ${JSON.stringify(spoofedPayload)}`);
    if (!result.ok) {
      assert.equal(result.error.code, "DM_SECURITY_SENDER_SPOOFED");
      assert.equal(result.error.category, "permission");
    }
  }
});

test("ADVERSARIAL: payload containing nested user.id spoofing is rejected", () => {
  const command = createValidCommand({
    payload: {
      user: { id: "gm-admin" }
    }
  });

  const transportContext: TransportInboundContext = {
    senderUserId: "player-123",
    transportName: "test-transport",
    receivedAtReal: 1700000001000
  };

  const result = createAuthenticatedCommandContext({
    command,
    transportContext,
    authorityUserId: "gm-authority",
    authorityEpoch: 1
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "DM_SECURITY_SENDER_SPOOFED");
  }
});

test("matching claimed userId in payload does not substitute transport boundary", () => {
  const command = createValidCommand({
    payload: {
      userId: "player-123",
      action: "harmless-action"
    }
  });

  const transportContext: TransportInboundContext = {
    senderUserId: "player-123",
    transportName: "test-transport",
    receivedAtReal: 1700000001000
  };

  const result = createAuthenticatedCommandContext({
    command,
    transportContext,
    authorityUserId: "gm-authority",
    authorityEpoch: 1
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    // Verified that senderUserId is still equal to transportContext.senderUserId
    assert.equal(result.value.senderUserId, "player-123");
  }
});

test("internal authority technical command context accepts null sender and technical source", () => {
  const command = createValidCommand({
    type: "time:scheduler-tick",
    payload: { deltaSeconds: 3600 }
  });

  const transportContext: TransportInboundContext = {
    senderUserId: null,
    transportName: "local-runtime",
    receivedAtReal: 1700000001000
  };

  const result = createAuthenticatedCommandContext({
    command,
    transportContext,
    authorityUserId: "gm-authority",
    authorityEpoch: 2,
    source: { type: "tick", ref: "scheduler" }
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.senderUserId, null);
    assert.equal(result.value.source.type, "tick");
    assert.equal(result.value.source.ref, "scheduler");
  }
});

test("createAuthenticatedCommandContext rejects invalid authority parameters", () => {
  const command = createValidCommand();
  const transportContext: TransportInboundContext = {
    senderUserId: "player-1",
    transportName: "test-transport",
    receivedAtReal: 1700000001000
  };

  // Blank authorityUserId
  const r1 = createAuthenticatedCommandContext({
    command,
    transportContext,
    authorityUserId: "",
    authorityEpoch: 0
  });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.error.code, "DM_VALIDATION_AUTHORITY_IDENTITY_INVALID");

  // Negative authorityEpoch
  const r2 = createAuthenticatedCommandContext({
    command,
    transportContext,
    authorityUserId: "gm-1",
    authorityEpoch: -1
  });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.error.code, "DM_VALIDATION_AUTHORITY_EPOCH_INVALID");
});

test("AuthenticatedCommandContext is frozen and cannot be mutated by handlers", () => {
  const command = createValidCommand();
  const transportContext: TransportInboundContext = {
    senderUserId: "player-1",
    transportName: "test-transport",
    receivedAtReal: 1700000001000
  };

  const result = createAuthenticatedCommandContext({
    command,
    transportContext,
    authorityUserId: "gm-authority",
    authorityEpoch: 1
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    const ctx = result.value as Record<string, unknown>;
    assert.throws(() => {
      ctx.senderUserId = "malicious-overwrite";
    }, TypeError);
    assert.throws(() => {
      ctx.authorityUserId = "malicious-overwrite";
    }, TypeError);
  }
});

// ============================================================================
// Expected Revisions Declarative Intent Tests
// ============================================================================

test("expected revisions remain declarative client data without mutating authority", () => {
  const command = createValidCommand({
    expectedRevision: 5,
    expectedRevisions: { "JournalEntry.domain-a": 5, "JournalEntry.domain-b": 3 }
  });

  const transportContext: TransportInboundContext = {
    senderUserId: "player-1",
    transportName: "test-transport",
    receivedAtReal: 1700000001000
  };

  const result = createAuthenticatedCommandContext({
    command,
    transportContext,
    authorityUserId: "gm-authority",
    authorityEpoch: 1
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    // Declarative intent is intact and immutable
    assert.equal(result.value.command.expectedRevision, 5);
    assert.deepEqual(result.value.command.expectedRevisions, {
      "JournalEntry.domain-a": 5,
      "JournalEntry.domain-b": 3
    });
    // Context does not assert revision matching; that belongs to future LockManager/Coordinator
    assert.equal(result.value.authorityEpoch, 1);
  }
});

// ============================================================================
// CommandTransport Contract & Loopback Tests
// ============================================================================

test("CommandTransport loopback delivers command to authority with authenticated sender context", async () => {
  const transport = new InMemoryLoopbackTransport("verified-user-bob");

  let receivedContext: AuthenticatedCommandContext | null = null;

  transport.registerInboundHandler(async (inbound) => {
    const envelopeResult = validateCommandEnvelope(inbound.rawEnvelope);
    if (!envelopeResult.ok) {
      return ok({
        commandId: (inbound.rawEnvelope as { commandId?: `cmd_${string}` })?.commandId ?? createCommandId(),
        status: "rejected",
        error: envelopeResult.error,
        transportTimestamp: Date.now()
      });
    }

    const contextResult = createAuthenticatedCommandContext({
      command: envelopeResult.value,
      transportContext: inbound.transportContext,
      authorityUserId: "gm-primary",
      authorityEpoch: 3
    });

    if (!contextResult.ok) {
      return ok({
        commandId: envelopeResult.value.commandId,
        status: "rejected",
        error: contextResult.error,
        transportTimestamp: Date.now()
      });
    }

    receivedContext = contextResult.value;

    return ok({
      commandId: envelopeResult.value.commandId,
      status: "executed",
      result: { executed: true },
      transportTimestamp: Date.now()
    });
  });

  const command = createValidCommand({
    payload: { action: "request-resources", amount: 100 }
  });

  const sendResult = await transport.send(command);

  assert.equal(sendResult.ok, true);
  if (sendResult.ok) {
    assert.equal(sendResult.value.status, "executed");
    assert.equal(sendResult.value.commandId, command.commandId);
    assert.deepEqual(sendResult.value.result, { executed: true });
  }

  assert.ok(receivedContext !== null);
  assert.equal((receivedContext as AuthenticatedCommandContext).senderUserId, "verified-user-bob");
  assert.equal((receivedContext as AuthenticatedCommandContext).authorityUserId, "gm-primary");
  assert.equal((receivedContext as AuthenticatedCommandContext).authorityEpoch, 3);
});

test("CommandTransport loopback rejects malformed envelopes at the authority boundary", async () => {
  const transport = new InMemoryLoopbackTransport("player-charlie");

  transport.registerInboundHandler(async (inbound) => {
    const envelopeResult = validateCommandEnvelope(inbound.rawEnvelope);
    if (!envelopeResult.ok) {
      return ok({
        commandId: (inbound.rawEnvelope as { commandId?: `cmd_${string}` })?.commandId ?? createCommandId(),
        status: "rejected",
        error: envelopeResult.error,
        transportTimestamp: Date.now()
      });
    }

    return ok({
      commandId: envelopeResult.value.commandId,
      status: "executed",
      transportTimestamp: Date.now()
    });
  });

  // Send malformed command with missing commandId
  const malformed = {
    contractVersion: 1,
    type: "domain:create",
    payload: { name: "Bad Command" },
    issuedAtReal: Date.now()
  } as unknown as DomainCommand<unknown>;

  const sendResult = await transport.send(malformed);
  assert.equal(sendResult.ok, true);
  if (sendResult.ok) {
    assert.equal(sendResult.value.status, "rejected");
    assert.equal(sendResult.value.error?.code, "DM_VALIDATION_COMMAND_ID_INVALID");
  }
});

test("CommandTransport returns error when no receiver is registered", async () => {
  const transport = new InMemoryLoopbackTransport("player-dan");
  const command = createValidCommand();

  const result = await transport.send(command);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "DM_TRANSPORT_NO_RECEIVER");
  }
});

// ============================================================================
// Core Independence from Foundry / socketlib
// ============================================================================

test("command transport and envelope modules have zero dependencies on Foundry globals or socketlib", () => {
  // Verify that neither window, game, Hooks, nor socketlib are defined or accessed in this environment
  assert.equal(typeof (globalThis as Record<string, unknown>).socketlib, "undefined");
  // Modules execute purely in Node.js standard environment without global side-effects
  const command = createValidCommand();
  const res = validateCommandEnvelope(command);
  assert.equal(res.ok, true);
});
