import assert from "node:assert/strict";
import test from "node:test";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import {
  FoundryCommandTransportAdapter,
  type FoundrySocketLike,
  type FoundrySocketRuntimeLike
} from "../../src/commands/foundry-command-transport-adapter.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { ok } from "../../src/core/contracts/result.js";
import type { TransportReceipt } from "../../src/commands/command-transport.js";

class MockSocket implements FoundrySocketLike {
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly emitted: Array<{ event: string; data: unknown }> = [];

  on(event: string, callback: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(callback);
  }

  emit(event: string, ...args: unknown[]): void {
    this.emitted.push({ event, data: args[0] });
    // In a connected socket mesh, emit broadcasts to other listeners
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        // Asynchronous dispatch to simulate real socket event loop
        queueMicrotask(() => handler(...args));
      }
    }
  }
}

function createTestCommand(): DomainCommand<{ action: string }> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type: "domain:test",
    payload: { action: "run" },
    issuedAtReal: Date.now()
  };
}

function createAuthorityHarness(
  currentUserId: string | null,
  authorityUserId: string | null = "gm-1",
  users: Array<{ id: string; isGM: boolean; active: boolean }> = [
    { id: "gm-1", isGM: true, active: true },
    { id: "player-1", isGM: false, active: true }
  ]
) {
  const environment = {
    getUsers: () => users,
    getPreferredUserId: () => null,
    getCurrentUserId: () => currentUserId
  };

  const service = new PrimaryAuthorityService(environment, {
    authorityUserId,
    authorityEpoch: 1,
    initialized: true
  });

  return service;
}

test("FoundryCommandTransportAdapter performs local loopback when current user is primary authority", async () => {
  const authorityService = createAuthorityHarness("gm-1", "gm-1");

  const socket = new MockSocket();
  const runtime: FoundrySocketRuntimeLike = {
    socket,
    user: { id: "gm-1", name: "Gamemaster", isGM: true }
  };

  const transport = new FoundryCommandTransportAdapter({
    runtime,
    authorityService
  });

  let receivedContextSender: string | null = null;
  transport.registerInboundHandler(async (msg) => {
    receivedContextSender = msg.transportContext.senderUserId;
    return ok({
      commandId: (msg.rawEnvelope as DomainCommand<unknown>).commandId,
      status: "executed",
      transportTimestamp: Date.now()
    } satisfies TransportReceipt);
  });

  const command = createTestCommand();
  const result = await transport.send(command);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.status, "executed");
    assert.equal(result.value.commandId, command.commandId);
  }

  // Sender should be gm-1 directly from local context
  assert.equal(receivedContextSender, "gm-1");
  // In loopback mode, no socket emit should occur
  assert.equal(socket.emitted.length, 0);

  transport.destroy();
});

test("FoundryCommandTransportAdapter dispatches via Socketlib RPC when client is not authority", async () => {
  const gmRegistry = new Map<string, Function>();
  const gmSocketlib: SocketlibSocketLike = {
    register: (name, fn) => { gmRegistry.set(name, fn); },
    executeAsUser: async () => { throw new Error("Not implemented in test"); }
  };

  const playerSocketlib: SocketlibSocketLike = {
    register: () => {},
    executeAsUser: async (handlerName, targetUserId, ...args) => {
      assert.equal(targetUserId, "gm-1");
      const fn = gmRegistry.get(handlerName);
      if (!fn) throw new Error(`Handler '${handlerName}' not found on GM`);
      return fn.call({ socketdata: { userId: "player-1" } }, ...args);
    }
  };

  // 1. Setup GM Authority instance
  const gmAuthority = createAuthorityHarness("gm-1", "gm-1");
  const gmRuntime: FoundrySocketRuntimeLike = {
    user: { id: "gm-1", name: "Gamemaster", isGM: true }
  };
  const gmTransport = new FoundryCommandTransportAdapter({
    runtime: gmRuntime,
    authorityService: gmAuthority,
    socketlib: gmSocketlib
  });

  let gmReceivedSender: string | null = null;
  gmTransport.registerInboundHandler(async (msg) => {
    gmReceivedSender = msg.transportContext.senderUserId;
    return ok({
      commandId: (msg.rawEnvelope as DomainCommand<unknown>).commandId,
      status: "executed",
      transportTimestamp: Date.now()
    } satisfies TransportReceipt);
  });

  // 2. Setup Player instance
  const playerAuthority = createAuthorityHarness("player-1", "gm-1");
  const playerRuntime: FoundrySocketRuntimeLike = {
    user: { id: "player-1", name: "Player One", isGM: false }
  };
  const playerTransport = new FoundryCommandTransportAdapter({
    runtime: playerRuntime,
    authorityService: playerAuthority,
    socketlib: playerSocketlib
  });

  const command = createTestCommand();
  const result = await playerTransport.send(command);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.status, "executed");
    assert.equal(result.value.commandId, command.commandId);
  }

  // The GM received the authenticated sender as player-1
  assert.equal(gmReceivedSender, "player-1");

  gmTransport.destroy();
  playerTransport.destroy();
});

test("FoundryCommandTransportAdapter rejects send if authority is not available", async () => {
  const authorityService = createAuthorityHarness("player-1", null, []);

  const socket = new MockSocket();
  const runtime: FoundrySocketRuntimeLike = {
    socket,
    user: { id: "player-1", name: "Player One", isGM: false }
  };

  const transport = new FoundryCommandTransportAdapter({
    runtime,
    authorityService
  });

  const result = await transport.send(createTestCommand());

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "DM_AUTHORITY_UNAVAILABLE");
  }

  transport.destroy();
});

test("FoundryCommandTransportAdapter fails closed with DM_TRANSPORT_UNAVAILABLE when Socketlib is absent for remote dispatch", async () => {
  const sharedSocket = new MockSocket();
  const authorityService = createAuthorityHarness("player-1", "gm-1");
  const runtime: FoundrySocketRuntimeLike = {
    socket: sharedSocket,
    user: { id: "player-1", name: "Player One", isGM: false }
  };

  const transport = new FoundryCommandTransportAdapter({
    runtime,
    authorityService
  });

  assert.equal(transport.isAvailable, false);
  const result = await transport.send(createTestCommand());

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "DM_TRANSPORT_UNAVAILABLE");
  }

  // Socket emit should NEVER occur
  assert.equal(sharedSocket.emitted.length, 0);

  transport.destroy();
});

test("FoundryCommandTransportAdapter rejects unauthenticated send", async () => {
  const runtime: FoundrySocketRuntimeLike = {
    user: null // unauthenticated
  };

  const mockSocketlib: SocketlibSocketLike = {
    register: () => {},
    executeAsUser: async () => ({})
  };

  // Remote authority
  const remoteAuthority = createAuthorityHarness(null, "gm-1");

  const transport = new FoundryCommandTransportAdapter({
    runtime,
    authorityService: remoteAuthority,
    socketlib: mockSocketlib
  });

  const result = await transport.send(createTestCommand());

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "DM_AUTH_UNAUTHENTICATED");
  }

  transport.destroy();
});

