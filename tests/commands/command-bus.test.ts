import assert from "node:assert/strict";
import test from "node:test";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import {
  CommandRegistry,
  CommandRegistryCollisionError,
  CommandRegistryFrozenError
} from "../../src/commands/command-registry.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import { ok } from "../../src/core/contracts/result.js";
import type { TransportInboundMessage } from "../../src/commands/command-transport.js";

function createAuthorityService(currentUserId: string | null = "gm-1") {
  const users = [
    { id: "gm-1", isGM: true, active: true },
    { id: "player-1", isGM: false, active: true },
    { id: "gm-2", isGM: true, active: true }
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

test("CommandRegistry registers public and internal handlers and validates namespaced type", () => {
  const registry = new CommandRegistry();

  registry.register({
    type: "domain:create",
    visibility: "public",
    handler: async () => ok({ id: "dom-1" })
  });

  registry.register({
    type: "system:purge",
    visibility: "internal",
    handler: async () => ok({ purged: true })
  });

  assert.equal(registry.has("domain:create"), true);
  assert.equal(registry.get("domain:create")?.visibility, "public");
  assert.equal(registry.get("system:purge")?.visibility, "internal");

  // Invalid namespace
  assert.throws(
    () =>
      registry.register({
        type: "invalidTypeWithoutColon",
        visibility: "public",
        handler: async () => ok({})
      }),
    TypeError
  );

  // Duplicate registration collision
  assert.throws(
    () =>
      registry.register({
        type: "domain:create",
        visibility: "public",
        handler: async () => ok({})
      }),
    CommandRegistryCollisionError
  );

  // Freezing blocks new registrations
  registry.freeze();
  assert.throws(
    () =>
      registry.register({
        type: "domain:archive",
        visibility: "public",
        handler: async () => ok({})
      }),
    CommandRegistryFrozenError
  );
});

test("CommandBus executes public command successfully via transport", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  registry.register({
    type: "domain:rename",
    visibility: "public",
    handler: async (ctx) => {
      const payload = ctx.command.payload as { newName: string };
      return ok({ renamedTo: payload.newName, executedBy: ctx.senderUserId });
    }
  });

  const bus = new CommandBus({ registry, authorityService });

  const command = createTestCommand("domain:rename", { newName: "New Realm" });
  const inboundMessage: TransportInboundMessage = {
    rawEnvelope: command,
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  const receiptResult = await bus.dispatchInbound(inboundMessage);

  assert.equal(receiptResult.ok, true);
  if (receiptResult.ok) {
    assert.equal(receiptResult.value.status, "executed");
    assert.equal(receiptResult.value.commandId, command.commandId);
    assert.deepEqual(receiptResult.value.result, {
      renamedTo: "New Realm",
      executedBy: "player-1"
    });
  }
});

test("CommandBus rejects missing handler with DM_COMMAND_HANDLER_NOT_FOUND", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();
  const bus = new CommandBus({ registry, authorityService });

  const command = createTestCommand("unknown:action");
  const inboundMessage: TransportInboundMessage = {
    rawEnvelope: command,
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  const receiptResult = await bus.dispatchInbound(inboundMessage);

  assert.equal(receiptResult.ok, true);
  if (receiptResult.ok) {
    assert.equal(receiptResult.value.status, "rejected");
    assert.equal(receiptResult.value.error?.code, "DM_COMMAND_HANDLER_NOT_FOUND");
  }
});

test("CommandBus rejects malformed command envelope with DM_COMMAND_ENVELOPE_INVALID", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();
  const bus = new CommandBus({ registry, authorityService });

  const malformedEnvelope = {
    contractVersion: "not-a-number",
    commandId: "invalid-id"
  };

  const inboundMessage: TransportInboundMessage = {
    rawEnvelope: malformedEnvelope,
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  const receiptResult = await bus.dispatchInbound(inboundMessage);

  assert.equal(receiptResult.ok, true);
  if (receiptResult.ok) {
    assert.equal(receiptResult.value.status, "rejected");
    assert.equal(
      receiptResult.value.error?.code,
      "DM_VALIDATION_COMMAND_CONTRACT_VERSION_INVALID"
    );
    assert.equal(receiptResult.value.error?.category, "validation");
  }
});

test("CommandBus rejects internal-only command called via remote transport even by GM", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  registry.register({
    type: "system:admin-purge",
    visibility: "internal",
    handler: async () => ok({ purged: true })
  });

  const bus = new CommandBus({ registry, authorityService });

  // 1. Player calls internal command -> REJECTED
  const playerCmd = createTestCommand("system:admin-purge");
  const playerMsg: TransportInboundMessage = {
    rawEnvelope: playerCmd,
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };
  const playerReceipt = await bus.dispatchInbound(playerMsg);
  assert.equal(playerReceipt.ok, true);
  if (playerReceipt.ok) {
    assert.equal(playerReceipt.value.status, "rejected");
    assert.equal(playerReceipt.value.error?.code, "DM_SECURITY_INTERNAL_ONLY_COMMAND");
  }

  // 2. Secondary GM calls internal command via socket -> REJECTED
  const gmCmd = createTestCommand("system:admin-purge");
  const gmMsg: TransportInboundMessage = {
    rawEnvelope: gmCmd,
    transportContext: {
      senderUserId: "gm-2",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };
  const gmReceipt = await bus.dispatchInbound(gmMsg);
  assert.equal(gmReceipt.ok, true);
  if (gmReceipt.ok) {
    assert.equal(gmReceipt.value.status, "rejected");
    assert.equal(gmReceipt.value.error?.code, "DM_SECURITY_INTERNAL_ONLY_COMMAND");
  }
});

test("CommandBus allows internal command via executeLocal", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  registry.register({
    type: "system:tick",
    visibility: "internal",
    handler: async (ctx) => ok({ tick: true, source: ctx.source.type })
  });

  const bus = new CommandBus({ registry, authorityService });

  const command = createTestCommand("system:tick");
  const receiptResult = await bus.executeLocal(command, { type: "tick" });

  assert.equal(receiptResult.ok, true);
  if (receiptResult.ok) {
    assert.equal(receiptResult.value.status, "executed");
    assert.deepEqual(receiptResult.value.result, { tick: true, source: "tick" });
  }
});

test("CommandBus rejects payload spoofing attempts with DM_SECURITY_SENDER_SPOOFED", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  registry.register({
    type: "domain:update",
    visibility: "public",
    handler: async () => ok({ updated: true })
  });

  const bus = new CommandBus({ registry, authorityService });

  // Player sends payload trying to claim they are gm-1
  const spoofedCmd = createTestCommand("domain:update", {
    userId: "gm-1",
    data: "malicious"
  });

  const inboundMessage: TransportInboundMessage = {
    rawEnvelope: spoofedCmd,
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  const receiptResult = await bus.dispatchInbound(inboundMessage);

  assert.equal(receiptResult.ok, true);
  if (receiptResult.ok) {
    assert.equal(receiptResult.value.status, "rejected");
    assert.equal(receiptResult.value.error?.code, "DM_SECURITY_SENDER_SPOOFED");
  }
});

test("CommandBus handles handler execution failure safely without throwing", async () => {
  const authorityService = createAuthorityService("gm-1");
  const registry = new CommandRegistry();

  registry.register({
    type: "domain:fail",
    visibility: "public",
    handler: async () => {
      throw new Error("Simulated unexpected crash in handler");
    }
  });

  const bus = new CommandBus({ registry, authorityService });

  const command = createTestCommand("domain:fail");
  const inboundMessage: TransportInboundMessage = {
    rawEnvelope: command,
    transportContext: {
      senderUserId: "player-1",
      transportName: "foundry-socket",
      receivedAtReal: Date.now()
    }
  };

  const receiptResult = await bus.dispatchInbound(inboundMessage);

  assert.equal(receiptResult.ok, true);
  if (receiptResult.ok) {
    assert.equal(receiptResult.value.status, "rejected");
    assert.equal(receiptResult.value.error?.code, "DM_COMMAND_EXECUTION_FAILED");
  }
});
