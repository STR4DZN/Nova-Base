import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryCommandTransport,
  InMemoryTransportHub
} from "../../src/commands/in-memory-command-transport.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { ok } from "../../src/core/contracts/result.js";
import type { TransportReceipt } from "../../src/commands/command-transport.js";

function createTestCommand(): DomainCommand<{ action: string }> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "domain:test",
    payload: { action: "run" },
    issuedAtReal: Date.now()
  };
}

test("InMemoryCommandTransport executes loopback when current user is authority", async () => {
  const transport = new InMemoryCommandTransport({
    currentUserId: "gm-1",
    getAuthorityUserId: () => "gm-1"
  });

  let receivedSender: string | null = null;
  transport.registerInboundHandler(async (msg) => {
    receivedSender = msg.transportContext.senderUserId;
    return ok({
      commandId: (msg.rawEnvelope as DomainCommand<unknown>).commandId,
      status: "executed",
      transportTimestamp: Date.now()
    } satisfies TransportReceipt);
  });

  const command = createTestCommand();
  const res = await transport.send(command);

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.status, "executed");
    assert.equal(res.value.commandId, command.commandId);
  }
  assert.equal(receivedSender, "gm-1");
});

test("InMemoryCommandTransport routes through InMemoryTransportHub to authority peer", async () => {
  const hub = new InMemoryTransportHub();

  const gmTransport = new InMemoryCommandTransport(
    {
      currentUserId: "gm-1",
      getAuthorityUserId: () => "gm-1"
    },
    hub
  );

  const playerTransport = new InMemoryCommandTransport(
    {
      currentUserId: "player-1",
      getAuthorityUserId: () => "gm-1"
    },
    hub
  );

  let gmReceivedSender: string | null = null;
  gmTransport.registerInboundHandler(async (msg) => {
    gmReceivedSender = msg.transportContext.senderUserId;
    return ok({
      commandId: (msg.rawEnvelope as DomainCommand<unknown>).commandId,
      status: "executed",
      transportTimestamp: Date.now()
    } satisfies TransportReceipt);
  });

  const command = createTestCommand();
  const res = await playerTransport.send(command);

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.status, "executed");
    assert.equal(res.value.commandId, command.commandId);
  }
  assert.equal(gmReceivedSender, "player-1");
});

test("InMemoryCommandTransport fails closed if authority peer is unreachable", async () => {
  const hub = new InMemoryTransportHub();

  const playerTransport = new InMemoryCommandTransport(
    {
      currentUserId: "player-1",
      getAuthorityUserId: () => "offline-gm"
    },
    hub
  );

  const res = await playerTransport.send(createTestCommand());
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, "DM_TRANSPORT_NO_RECEIVER");
  }
});

test("InMemoryCommandTransport respects timeout and packet drop simulation", async () => {
  const transport = new InMemoryCommandTransport({
    currentUserId: "gm-1",
    dropPackets: true
  });

  const res = await transport.send(createTestCommand());
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, "DM_TRANSPORT_TIMEOUT");
  }
});
