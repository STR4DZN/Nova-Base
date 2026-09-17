import assert from "node:assert/strict";
import test from "node:test";
import { RateLimiter } from "../../src/commands/rate-limiter.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { ok, err } from "../../src/core/contracts/result.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";
import type { TransportInboundMessage } from "../../src/commands/command-transport.js";

function createAuthorityService(currentUserId: string | null = "gm-1") {
  const users = [
    { id: "gm-1", isGM: true, active: true },
    { id: "player-1", isGM: false, active: true },
    { id: "player-2", isGM: false, active: true }
  ];

  return new PrimaryAuthorityService(
    {
      getUsers: () => users,
      getPreferredUserId: () => null,
      getCurrentUserId: () => currentUserId
    },
    {
      authorityUserId: "gm-1",
      authorityEpoch: 1,
      initialized: true
    }
  );
}

function createTestCommand(type: string, payload: unknown = {}): DomainCommand<unknown> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

test("RateLimiter enforces sliding window limits and respects command-specific rules", () => {
  const limiter = new RateLimiter({
    defaultRule: { windowMs: 1000, maxRequests: 2 },
    commandRules: {
      "domain:burst": { windowMs: 1000, maxRequests: 5 }
    }
  });

  const now = 1000000;

  // Default rule allows 2 requests
  assert.equal(limiter.checkAndConsume("user-1", "domain:create", now).ok, true);
  assert.equal(limiter.checkAndConsume("user-1", "domain:create", now + 100).ok, true);
  const excess = limiter.checkAndConsume("user-1", "domain:create", now + 200);
  assert.equal(excess.ok, false);
  if (!excess.ok) {
    assert.equal(excess.error.code, "DM_RATE_LIMIT_EXCEEDED");
    assert.equal(excess.error.category, "busy");
  }

  // Different user is not blocked
  assert.equal(limiter.checkAndConsume("user-2", "domain:create", now + 200).ok, true);

  // Command-specific rule allows up to 5 requests
  for (let i = 0; i < 5; i++) {
    assert.equal(limiter.checkAndConsume("user-1", "domain:burst", now + i * 10).ok, true);
  }
  assert.equal(limiter.checkAndConsume("user-1", "domain:burst", now + 60).ok, false);

  // After window expires, requests are allowed again
  assert.equal(limiter.checkAndConsume("user-1", "domain:create", now + 1500).ok, true);
});

test("CommandBus executes schemaValidator before permissionValidator and handler", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  let schemaValidated = false;
  let permissionValidated = false;
  let handlerExecuted = false;

  interface RenamePayload {
    name: string;
  }

  registry.register<RenamePayload, { done: boolean }>({
    type: "domain:rename-validated",
    visibility: "public",
    schemaValidator: (payload: unknown) => {
      schemaValidated = true;
      if (typeof payload !== "object" || payload === null) {
        return err(
          createPublicError({
            code: "DM_VALIDATION_FAILED",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.name !== "string" || p.name.trim().length === 0) {
        return err(
          createPublicError({
            code: "DM_VALIDATION_FAILED",
            category: "validation",
            message: "name must be a non-empty string"
          })
        );
      }
      return ok({ name: p.name });
    },
    permissionValidator: () => {
      permissionValidated = true;
      return ok(true);
    },
    handler: async () => {
      handlerExecuted = true;
      return ok({ done: true });
    }
  });

  const bus = new CommandBus({ registry, authorityService });

  // 1. Invalid payload: schemaValidator fails, permission and handler NOT called
  const invalidMsg: TransportInboundMessage = {
    rawEnvelope: createTestCommand("domain:rename-validated", { name: "" }),
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  const invalidRes = await bus.dispatchInbound(invalidMsg);
  assert.equal(invalidRes.ok, true);
  if (invalidRes.ok) {
    assert.equal(invalidRes.value.status, "rejected");
    assert.equal(invalidRes.value.error?.code, "DM_VALIDATION_FAILED");
    assert.equal(invalidRes.value.error?.category, "validation");
  }
  assert.equal(schemaValidated, true);
  assert.equal(permissionValidated, false);
  assert.equal(handlerExecuted, false);

  // 2. Valid payload: all stages succeed
  schemaValidated = false;
  permissionValidated = false;
  handlerExecuted = false;

  const validMsg: TransportInboundMessage = {
    rawEnvelope: createTestCommand("domain:rename-validated", { name: "Valid Realm" }),
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  const validRes = await bus.dispatchInbound(validMsg);
  assert.equal(validRes.ok, true);
  if (validRes.ok) {
    assert.equal(validRes.value.status, "executed");
    assert.deepEqual(validRes.value.result, { done: true });
  }
  assert.equal(schemaValidated, true);
  assert.equal(permissionValidated, true);
  assert.equal(handlerExecuted, true);
});

test("CommandBus blocks execution when permissionValidator denies access", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  let handlerExecuted = false;

  registry.register({
    type: "domain:delete",
    visibility: "public",
    permissionValidator: (ctx) => {
      if (ctx.senderUserId !== "gm-1") {
        return err(
          createPublicError({
            code: "DM_PERMISSION_DENIED",
            category: "permission",
            message: "Only the GM can delete a domain"
          })
        );
      }
      return ok(true);
    },
    handler: async () => {
      handlerExecuted = true;
      return ok({ deleted: true });
    }
  });

  const bus = new CommandBus({ registry, authorityService });

  // Player attempts delete -> rejected
  const playerMsg: TransportInboundMessage = {
    rawEnvelope: createTestCommand("domain:delete"),
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  const playerRes = await bus.dispatchInbound(playerMsg);
  assert.equal(playerRes.ok, true);
  if (playerRes.ok) {
    assert.equal(playerRes.value.status, "rejected");
    assert.equal(playerRes.value.error?.code, "DM_PERMISSION_DENIED");
    assert.equal(playerRes.value.error?.category, "permission");
  }
  assert.equal(handlerExecuted, false);

  // GM attempts delete -> allowed
  const gmMsg: TransportInboundMessage = {
    rawEnvelope: createTestCommand("domain:delete"),
    transportContext: {
      senderUserId: "gm-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  const gmRes = await bus.dispatchInbound(gmMsg);
  assert.equal(gmRes.ok, true);
  if (gmRes.ok) {
    assert.equal(gmRes.value.status, "executed");
  }
  assert.equal(handlerExecuted, true);
});

test("CommandBus enforces rate limiting across multiple requests from the same user", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  registry.register({
    type: "domain:ping",
    visibility: "public",
    handler: async () => ok({ pong: true })
  });

  const rateLimiter = new RateLimiter({
    defaultRule: { windowMs: 1000, maxRequests: 2 }
  });

  const bus = new CommandBus({ registry, authorityService, rateLimiter });

  const makeMsg = (userId: string) => ({
    rawEnvelope: createTestCommand("domain:ping"),
    transportContext: {
      senderUserId: userId,
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  });

  // Request 1 and 2 from player-1 succeed
  const res1 = await bus.dispatchInbound(makeMsg("player-1"));
  assert.equal(res1.ok && res1.value.status === "executed", true);

  const res2 = await bus.dispatchInbound(makeMsg("player-1"));
  assert.equal(res2.ok && res2.value.status === "executed", true);

  // Request 3 from player-1 is rate limited
  const res3 = await bus.dispatchInbound(makeMsg("player-1"));
  assert.equal(res3.ok, true);
  if (res3.ok) {
    assert.equal(res3.value.status, "rejected");
    assert.equal(res3.value.error?.code, "DM_RATE_LIMIT_EXCEEDED");
  }

  // Player 2 is unaffected and succeeds
  const resPlayer2 = await bus.dispatchInbound(makeMsg("player-2"));
  assert.equal(resPlayer2.ok && resPlayer2.value.status === "executed", true);
});
