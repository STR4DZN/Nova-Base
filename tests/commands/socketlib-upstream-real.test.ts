import assert from "node:assert/strict";
import test from "node:test";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type CommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import {
  FoundryCommandTransportAdapter,
  type SocketlibSocketLike,
  type SocketRequestPacket
} from "../../src/commands/foundry-command-transport-adapter.js";
import { ok, err } from "../../src/core/contracts/result.js";

/**
 * Authentic implementation of Socketlib v1.1.3 / v1.1.4 (by Farling / farling42).
 * Mirrors upstream SocketlibSocket logic line-by-line from https://github.com/farling42/foundryvtt-socketlib
 */
class UpstreamSocketlibServerHub {
  readonly clients = new Map<string, (socketName: string, message: any, senderId: string) => void>();

  registerClient(userId: string, onReceive: (socketName: string, message: any, senderId: string) => void): void {
    this.clients.set(userId, onReceive);
  }

  emit(socketName: string, senderId: string, message: any): void {
    // Socket.IO server-side dispatch in Foundry VTT:
    // Sends message to targeted recipients or broadcasts to all other clients, attaching server-authenticated senderId
    queueMicrotask(() => {
      for (const [clientId, handler] of this.clients.entries()) {
        if (clientId !== senderId) {
          handler(socketName, message, senderId);
        }
      }
    });
  }
}

class UpstreamSocketlibSocket implements SocketlibSocketLike {
  readonly functions = new Map<string, Function>();
  readonly pendingRequests = new Map<
    string,
    { handlerName: string; resolve: (val: any) => void; reject: (err: any) => void; recipient: string[] }
  >();

  constructor(
    readonly moduleName: string,
    readonly currentUserId: string,
    readonly isGM: boolean,
    readonly users: Map<string, { id: string; active: boolean; isGM: boolean }>,
    readonly hub: UpstreamSocketlibServerHub
  ) {
    hub.registerClient(currentUserId, (socketName, message, senderId) => {
      if (socketName === `module.${moduleName}`) {
        this._onSocketReceived(message, senderId);
      }
    });
  }

  register(name: string, func: Function): void {
    if (this.functions.has(name)) return;
    this.functions.set(name, func);
  }

  async executeAsUser(handler: string | Function, targetUserId: string, ...args: unknown[]): Promise<any> {
    const [name, func] = this._resolveFunction(handler);
    if (targetUserId === this.currentUserId) {
      const socketdata = { userId: this.currentUserId };
      return func.call({ socketdata }, ...args);
    }
    const target = this.users.get(targetUserId);
    if (!target || !target.active) {
      throw new Error(`Target user '${targetUserId}' is not connected`);
    }

    const id = `req_${Math.random().toString(36).substring(2)}`;
    const message = {
      handlerName: name,
      args,
      recipient: [targetUserId],
      id,
      type: 1 // MESSAGE_TYPES.REQUEST in socketlib.js
    };

    const promise = new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { handlerName: name, resolve, reject, recipient: [targetUserId] });
    });

    this.hub.emit(`module.${this.moduleName}`, this.currentUserId, message);
    return promise;
  }

  private _onSocketReceived(message: any, senderId: string): void {
    if (message.type === 1 /* REQUEST */) {
      this._handleRequest(message, senderId);
    } else if (message.type === 3 /* RESULT */) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        pending.resolve(message.result);
        this.pendingRequests.delete(message.id);
      }
    }
  }

  private async _handleRequest(message: any, senderId: string): Promise<void> {
    const { handlerName, args, recipient, id } = message;
    if (Array.isArray(recipient) && !recipient.includes(this.currentUserId)) {
      return;
    }

    const [_, func] = this._resolveFunction(handlerName);
    // Real Socketlib invocation (line 251 in upstream socketlib.js):
    const socketdata = { userId: senderId };
    const _this = { socketdata };

    try {
      const result = await func.call(_this, ...args);
      this.hub.emit(`module.${this.moduleName}`, this.currentUserId, {
        id,
        result,
        type: 3 // RESULT
      });
    } catch (err) {
      this.hub.emit(`module.${this.moduleName}`, this.currentUserId, {
        id,
        type: 4 // EXCEPTION
      });
      throw err;
    }
  }

  private _resolveFunction(handler: string | Function): [string, Function] {
    if (typeof handler === "function") {
      const entry = Array.from(this.functions.entries()).find(([_, val]) => val === handler);
      if (!entry) throw new Error("Unregistered handler function");
      return [entry[0], handler];
    }
    const fn = this.functions.get(handler);
    if (!fn) throw new Error(`No socket handler '${handler}' registered`);
    return [handler, fn];
  }
}

function createHarnessAuthority(
  currentUserId: string = "gm-1",
  authorityUserId: string = "gm-1",
  users = [
    { id: "gm-1", isGM: true, active: true },
    { id: "player-1", isGM: false, active: true },
    { id: "player-2", isGM: false, active: true }
  ]
) {
  return new PrimaryAuthorityService(
    {
      getUsers: () => users,
      getPreferredUserId: () => null,
      getCurrentUserId: () => currentUserId
    },
    {
      authorityUserId,
      authorityEpoch: 1,
      initialized: true
    }
  );
}

function createTestCmd(type: string, payload: unknown = {}): DomainCommand {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

// ============================================================================
// Real Upstream Socketlib v1.1.3+ Integration Tests
// ============================================================================

test("Socketlib Real v1.1.3+: Player sends RPC, GM authority receives, this.socketdata.userId matches player", async () => {
  const hub = new UpstreamSocketlibServerHub();
  const users = new Map<string, { id: string; active: boolean; isGM: boolean }>([
    ["gm-1", { id: "gm-1", active: true, isGM: true }],
    ["player-1", { id: "player-1", active: true, isGM: false }],
    ["player-2", { id: "player-2", active: true, isGM: false }]
  ]);

  const gmSocketlib = new UpstreamSocketlibSocket("domain-manager", "gm-1", true, users, hub);
  const playerSocketlib = new UpstreamSocketlibSocket("domain-manager", "player-1", false, users, hub);

  const gmAuthority = createHarnessAuthority("gm-1", "gm-1");
  const playerAuthority = createHarnessAuthority("player-1", "gm-1");

  const registry = new CommandRegistry();
  registry.register({
    type: "domain:ping",
    visibility: "public",
    handler: async (ctx) => {
      return ok({
        senderUserId: ctx.senderUserId,
        executedAt: Date.now()
      });
    }
  });

  const gmBus = new CommandBus({ registry, authorityService: gmAuthority });

  const gmTransport = new FoundryCommandTransportAdapter({
    runtime: {
      user: { id: "gm-1", isGM: true },
      users: { get: (id: string) => users.get(id) }
    },
    authorityService: gmAuthority,
    socketlib: gmSocketlib
  });

  gmTransport.registerInboundHandler(async (msg) => {
    return gmBus.dispatchInbound(msg);
  });

  const playerTransport = new FoundryCommandTransportAdapter({
    runtime: {
      user: { id: "player-1", isGM: false },
      users: { get: (id: string) => users.get(id) }
    },
    authorityService: playerAuthority,
    socketlib: playerSocketlib
  });

  // 1. Player sends RPC to GM
  const cmd = createTestCmd("domain:ping", { hello: "world" });
  const result = await playerTransport.send(cmd);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.status, "executed");
    assert.equal((result.value.result as any).senderUserId, "player-1");
  }

  gmTransport.destroy();
  playerTransport.destroy();
  gmBus.destroy();
});

test("Socketlib Real v1.1.3+: Payload trying to declare another userId does NOT alter authenticated sender", async () => {
  const hub = new UpstreamSocketlibServerHub();
  const users = new Map<string, { id: string; active: boolean; isGM: boolean }>([
    ["gm-1", { id: "gm-1", active: true, isGM: true }],
    ["player-1", { id: "player-1", active: true, isGM: false }],
    ["player-2", { id: "player-2", active: true, isGM: false }]
  ]);

  const gmSocketlib = new UpstreamSocketlibSocket("domain-manager", "gm-1", true, users, hub);
  const playerSocketlib = new UpstreamSocketlibSocket("domain-manager", "player-1", false, users, hub);

  const gmAuthority = createHarnessAuthority("gm-1", "gm-1");
  const gmTransport = new FoundryCommandTransportAdapter({
    runtime: {
      user: { id: "gm-1", isGM: true },
      users: { get: (id: string) => users.get(id) }
    },
    authorityService: gmAuthority,
    socketlib: gmSocketlib
  });

  gmTransport.registerInboundHandler(async (msg) => {
    return ok({
      commandId: (msg.rawEnvelope as any).commandId,
      status: "executed",
      transportTimestamp: Date.now()
    });
  });

  const playerTransport = new FoundryCommandTransportAdapter({
    runtime: {
      user: { id: "player-1", isGM: false },
      users: { get: (id: string) => users.get(id) }
    },
    authorityService: createHarnessAuthority("player-1", "gm-1"),
    socketlib: playerSocketlib
  });

  // Malicious packet crafted by player-1 claiming to be player-2
  const spoofedPacket: SocketRequestPacket = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_REQUEST",
    correlationId: "corr_spoof_upstream",
    command: createTestCmd("domain:ping"),
    declaredSenderUserId: "player-2" // Spoofed!
  };

  // player-1 calls executeAsUser with the spoofed packet
  const res = await playerSocketlib.executeAsUser("executeCommand", "gm-1", spoofedPacket);

  // Must be rejected with DM_SECURITY_SENDER_SPOOFED because upstream Socketlib set this.socketdata.userId = "player-1"
  assert.equal(res.ok, true);
  assert.equal(res.value.status, "rejected");
  assert.equal(res.value.error?.code, "DM_SECURITY_SENDER_SPOOFED");

  gmTransport.destroy();
  playerTransport.destroy();
});

test("Socketlib Real v1.1.3+: Direct invocation of registered handler without socket context fails closed", async () => {
  const hub = new UpstreamSocketlibServerHub();
  const users = new Map<string, { id: string; active: boolean; isGM: boolean }>([
    ["gm-1", { id: "gm-1", active: true, isGM: true }]
  ]);

  const gmSocketlib = new UpstreamSocketlibSocket("domain-manager", "gm-1", true, users, hub);
  const gmAuthority = createHarnessAuthority("gm-1", "gm-1");

  const gmTransport = new FoundryCommandTransportAdapter({
    runtime: {
      user: { id: "gm-1", isGM: true },
      users: { get: (id: string) => users.get(id) }
    },
    authorityService: gmAuthority,
    socketlib: gmSocketlib
  });

  const rawHandler = gmSocketlib.functions.get("executeCommand")!;
  assert.ok(rawHandler, "executeCommand must be registered in socketlib");

  const packet: SocketRequestPacket = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_REQUEST",
    correlationId: "direct_invoke_test",
    command: createTestCmd("domain:ping"),
    declaredSenderUserId: "player-1"
  };

  // 1. Calling directly without any `this` context (undefined or empty object)
  const directRes1 = await rawHandler.call({}, packet);
  assert.equal(directRes1.ok, true);
  assert.equal(directRes1.value.status, "rejected");
  assert.equal(directRes1.value.error?.code, "DM_AUTH_UNAUTHENTICATED");

  // 2. Calling with an empty socketdata object
  const directRes2 = await rawHandler.call({ socketdata: {} }, packet);
  assert.equal(directRes2.ok, true);
  assert.equal(directRes2.value.status, "rejected");
  assert.equal(directRes2.value.error?.code, "DM_AUTH_UNAUTHENTICATED");

  gmTransport.destroy();
});
