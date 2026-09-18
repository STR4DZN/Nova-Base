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
import { CommandQueue } from "../../src/commands/command-queue.js";
import { RateLimiter } from "../../src/commands/rate-limiter.js";
import {
  FoundryCommandTransportAdapter,
  type FoundrySocketLike,
  type FoundrySocketRuntimeLike,
  type SocketlibSocketLike,
  type SocketRequestPacket,
  type SocketResponsePacket,
  DOMAIN_MANAGER_SOCKET_CHANNEL
} from "../../src/commands/foundry-command-transport-adapter.js";
import { G2DiagnosticsProvider } from "../../src/diagnostics/g2-diagnostics-provider.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { TransactionStore } from "../../src/mutations/transaction-store.js";
import { ok, err } from "../../src/core/contracts/result.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";
import type { TransportReceipt } from "../../src/commands/command-transport.js";

// Mock socket mesh forwarding all arguments
class TestSocketMesh implements FoundrySocketLike {
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly emitted: Array<{ event: string; args: unknown[] }> = [];

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
    this.emitted.push({ event, args });
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        queueMicrotask(() => handler(...args));
      }
    }
  }
}

function createHarnessAuthority(
  currentUserId: string | null = "gm-1",
  authorityUserId: string | null = "gm-1",
  users = [
    { id: "gm-1", isGM: true, active: true },
    { id: "gm-2", isGM: true, active: true },
    { id: "player-1", isGM: false, active: true },
    { id: "player-2", isGM: false, active: true },
    { id: "player-inactive", isGM: false, active: false }
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

function createTestCmd(type: string, payload: unknown = {}): DomainCommand<unknown> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

// ============================================================================
// G2-AUD-002: Authentic Sender Extraction & Anti-Spoofing
// ============================================================================

test("G2-AUD-002: Remote packet spoofing another player is rejected (player-1 declares player-2)", async () => {
  const mesh = new TestSocketMesh();
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const runtime: FoundrySocketRuntimeLike = {
    socket: mesh,
    user: { id: "gm-1", isGM: true },
    users: {
      get: (id: string) => {
        const list = [
          { id: "gm-1", active: true, isGM: true },
          { id: "player-1", active: true, isGM: false },
          { id: "player-2", active: true, isGM: false }
        ];
        return list.find((u) => u.id === id);
      }
    }
  };

  let registeredExecuteCommand: Function | null = null;
  const mockSocketlib: SocketlibSocketLike = {
    register: (name, fn) => {
      if (name === "executeCommand") registeredExecuteCommand = fn;
    },
    executeAsUser: async () => ({})
  };

  const transport = new FoundryCommandTransportAdapter({
    runtime,
    authorityService,
    socketlib: mockSocketlib
  });

  let handlerRan = false;
  transport.registerInboundHandler(async () => {
    handlerRan = true;
    return ok({ commandId: "cmd_test" as any, status: "executed", transportTimestamp: Date.now() });
  });

  // Packet claims declaredSenderUserId = player-2, but transport says player-1
  const spoofedPacket: SocketRequestPacket = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_REQUEST",
    correlationId: "corr_spoof_player",
    command: createTestCmd("domain:ping"),
    declaredSenderUserId: "player-2",
    targetAuthorityUserId: "gm-1",
    targetAuthorityEpoch: 1
  };

  // 1. Native socket bypass attempt: native socket has no listener, handler must NOT run
  mesh.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, spoofedPacket, { userId: "player-1" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(handlerRan, false, "Native socket bypass must not invoke handler");

  // 2. Socketlib RPC spoofing attempt: verified transport says player-1 but declared says player-2
  assert.ok(registeredExecuteCommand);
  const rpcResult = await (registeredExecuteCommand as Function).call(
    { socketdata: { userId: "player-1" } },
    spoofedPacket
  );
  assert.equal(rpcResult.ok, true);
  assert.equal(rpcResult.value.status, "rejected");
  assert.equal(rpcResult.value.error?.code, "DM_SECURITY_SENDER_SPOOFED");

  transport.destroy();
});

test("G2-AUD-002: Remote packet claiming local Primary Authority is rejected with DM_SECURITY_SENDER_SPOOFED", async () => {
  const mesh = new TestSocketMesh();
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const runtime: FoundrySocketRuntimeLike = {
    socket: mesh,
    user: { id: "gm-1", isGM: true },
    users: { get: (id: string) => ({ id, active: true, isGM: id.startsWith("gm") }) }
  };

  let registeredExecuteCommand: Function | null = null;
  const mockSocketlib: SocketlibSocketLike = {
    register: (name, fn) => {
      if (name === "executeCommand") registeredExecuteCommand = fn;
    },
    executeAsUser: async () => ({})
  };

  const transport = new FoundryCommandTransportAdapter({
    runtime,
    authorityService,
    socketlib: mockSocketlib
  });

  let handlerRan = false;
  transport.registerInboundHandler(async () => {
    handlerRan = true;
    return ok({ commandId: "cmd_test" as any, status: "executed", transportTimestamp: Date.now() });
  });

  // Player claims declaredSenderUserId = gm-1
  const spoofedPacket: SocketRequestPacket = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_REQUEST",
    correlationId: "corr_spoof_gm",
    command: createTestCmd("domain:ping"),
    declaredSenderUserId: "gm-1",
    targetAuthorityUserId: "gm-1"
  };

  // 1. Native socket bypass attempt
  mesh.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, spoofedPacket, { userId: "player-1" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(handlerRan, false, "Native socket must not invoke handler");

  // 2. Socketlib RPC spoofing attempt
  assert.ok(registeredExecuteCommand);
  const rpcResult = await (registeredExecuteCommand as Function).call(
    { socketdata: { userId: "player-1" } },
    spoofedPacket
  );
  assert.equal(rpcResult.ok, true);
  assert.equal(rpcResult.value.status, "rejected");
  assert.equal(rpcResult.value.error?.code, "DM_SECURITY_SENDER_SPOOFED");

  transport.destroy();
});

test("G2-AUD-002: Remote packet with unverified transport sender fails closed with DM_AUTH_UNAUTHENTICATED", async () => {
  const mesh = new TestSocketMesh();
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const runtime: FoundrySocketRuntimeLike = {
    socket: mesh,
    user: { id: "gm-1", isGM: true },
    users: { get: (id: string) => ({ id, active: true, isGM: id.startsWith("gm") }) }
  };

  let registeredExecuteCommand: Function | null = null;
  const mockSocketlib: SocketlibSocketLike = {
    register: (name, fn) => {
      if (name === "executeCommand") registeredExecuteCommand = fn;
    },
    executeAsUser: async () => ({})
  };

  const transport = new FoundryCommandTransportAdapter({
    runtime,
    authorityService,
    socketlib: mockSocketlib
  });

  let handlerRan = false;
  transport.registerInboundHandler(async () => {
    handlerRan = true;
    return ok({ commandId: "cmd_test" as any, status: "executed", transportTimestamp: Date.now() });
  });

  const anonymousPacket: SocketRequestPacket = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_REQUEST",
    correlationId: "corr_no_transport_auth",
    command: createTestCmd("domain:ping"),
    declaredSenderUserId: "player-1",
    targetAuthorityUserId: "gm-1"
  };

  // 1. Native socket bypass attempt
  mesh.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, anonymousPacket);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(handlerRan, false, "Native socket must not invoke handler");

  // 2. Direct Socketlib invocation without verified transport session
  assert.ok(registeredExecuteCommand);
  const rpcResult = await (registeredExecuteCommand as Function).call(undefined, anonymousPacket);
  assert.equal(rpcResult.ok, true);
  assert.equal(rpcResult.value.status, "rejected");
  assert.equal(rpcResult.value.error?.code, "DM_AUTH_UNAUTHENTICATED");

  transport.destroy();
});

test("G2-AUD-002: Remote packet from disconnected user is rejected with DM_SECURITY_SENDER_UNKNOWN", async () => {
  const mesh = new TestSocketMesh();
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const runtime: FoundrySocketRuntimeLike = {
    socket: mesh,
    user: { id: "gm-1", isGM: true },
    users: {
      get: (id: string) => {
        if (id === "player-inactive") return { id, active: false, isGM: false };
        return undefined;
      }
    }
  };

  let registeredExecuteCommand: Function | null = null;
  const mockSocketlib: SocketlibSocketLike = {
    register: (name, fn) => {
      if (name === "executeCommand") registeredExecuteCommand = fn;
    },
    executeAsUser: async () => ({})
  };

  const transport = new FoundryCommandTransportAdapter({
    runtime,
    authorityService,
    socketlib: mockSocketlib
  });

  transport.registerInboundHandler(async () => {
    return ok({
      commandId: "cmd-dummy" as any,
      status: "applied",
      executionEpoch: 1,
      observedStateEpoch: 1,
      metrics: { queueWaitMs: 0, executionDurationMs: 0, totalDurationMs: 0 }
    });
  });

  const packet: SocketRequestPacket = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_REQUEST",
    correlationId: "corr_inactive",
    command: createTestCmd("domain:ping"),
    declaredSenderUserId: "player-inactive",
    targetAuthorityUserId: "gm-1"
  };

  // 1. Native socket bypass attempt
  mesh.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, packet, { userId: "player-inactive" });
  await new Promise((r) => setTimeout(r, 20));

  // 2. Socketlib invocation with inactive user
  assert.ok(registeredExecuteCommand);
  const rpcResult = await (registeredExecuteCommand as Function).call(
    { socketdata: { userId: "player-inactive" } },
    packet
  );
  assert.equal(rpcResult.ok, true);
  assert.equal(rpcResult.value.status, "rejected");
  assert.equal(rpcResult.value.error?.code, "DM_SECURITY_SENDER_UNKNOWN");

  transport.destroy();
});

// ============================================================================
// G2-AUD-003: Forged Response Packet Protection
// ============================================================================

test("G2-AUD-003: Forged response packet on native channel does NOT resolve or compromise caller transport", async () => {
  const mesh = new TestSocketMesh();
  const playerAuthority = createHarnessAuthority("player-1", "gm-1");
  const playerRuntime: FoundrySocketRuntimeLike = {
    socket: mesh,
    user: { id: "player-1", isGM: false }
  };

  const playerTransport = new FoundryCommandTransportAdapter({
    runtime: playerRuntime,
    authorityService: playerAuthority
  });

  // Without Socketlib, remote send immediately fails closed and does NOT listen for forged responses on socket
  const cmd = createTestCmd("domain:action");
  const sendResult = await playerTransport.send(cmd);
  assert.equal(sendResult.ok, false);
  assert.equal(sendResult.error.code, "DM_TRANSPORT_UNAVAILABLE");

  // Native broadcast of forged response cannot affect or inject state
  const forgedResponse = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_RESPONSE",
    correlationId: "corr_forged_test",
    targetUserId: "player-1",
    authorityUserId: "gm-1",
    authorityEpoch: 1,
    response: ok({
      commandId: cmd.commandId,
      status: "executed",
      result: { forged: true, secretBypassed: true },
      transportTimestamp: Date.now()
    })
  };
  mesh.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, forgedResponse, { userId: "player-2" });

  playerTransport.destroy();
});

// ============================================================================
// G2-AUD-004: Socketlib Directed RPC — No Secondary GM Leakage
// ============================================================================

test("G2-AUD-004: Socketlib directed RPC routes only to Primary GM; Secondary GM receives nothing", async () => {
  // Mock Socketlib system with per-client function registry
  const clientRegistries = new Map<string, Map<string, Function>>();
  let secondaryGMReceivedExecution = false;

  function createMockSocketlib(clientId: string): SocketlibSocketLike {
    if (!clientRegistries.has(clientId)) {
      clientRegistries.set(clientId, new Map());
    }
    const myRegistry = clientRegistries.get(clientId)!;

    return {
      register: (name, func) => {
        myRegistry.set(name, func);
      },
      executeAsUser: async (handlerName, targetUserId, ...args) => {
        if (targetUserId === "gm-2") {
          secondaryGMReceivedExecution = true;
        }
        const targetRegistry = clientRegistries.get(targetUserId);
        const fn = targetRegistry?.get(handlerName);
        if (!fn) throw new Error(`Function '${handlerName}' not registered on user '${targetUserId}'`);
        return fn.call({ socketdata: { userId: clientId } }, ...args);
      }
    };
  }

  // 1. Primary GM instance
  const gmAuthority = createHarnessAuthority("gm-1", "gm-1");
  const gmTransport = new FoundryCommandTransportAdapter({
    runtime: { user: { id: "gm-1", isGM: true } },
    authorityService: gmAuthority,
    socketlib: createMockSocketlib("gm-1")
  });

  let gmExecuted = false;
  gmTransport.registerInboundHandler(async (msg) => {
    gmExecuted = true;
    return ok({
      commandId: (msg.rawEnvelope as any).commandId,
      status: "executed",
      result: { processedBy: "gm-1" },
      transportTimestamp: Date.now()
    });
  });

  // 2. Player instance
  const playerAuthority = createHarnessAuthority("player-1", "gm-1");
  const playerTransport = new FoundryCommandTransportAdapter({
    runtime: { user: { id: "player-1", isGM: false } },
    authorityService: playerAuthority,
    socketlib: createMockSocketlib("player-1")
  });

  const cmd = createTestCmd("domain:mutate", { amount: 50 });
  const result = await playerTransport.send(cmd);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.status, "executed");
    assert.deepEqual(result.value.result, { processedBy: "gm-1" });
  }

  // Primary GM ran handler
  assert.equal(gmExecuted, true);
  // Secondary GM NEVER received or ran handler
  assert.equal(secondaryGMReceivedExecution, false);

  gmTransport.destroy();
  playerTransport.destroy();
});

// ============================================================================
// G2-AUD-014: Authoritative Status Query & Retry Without Duplicate Execution
// ============================================================================

test("G2-AUD-014: Remote command status query & retry with same commandId returns receipt without duplicate write", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();
  const queue = new CommandQueue();

  let executionCount = 0;
  registry.register({
    type: "domain:transfer",
    visibility: "public",
    handler: async () => {
      executionCount++;
      return ok({ balance: 100, executionCount });
    }
  });

  const bus = new CommandBus({
    registry,
    authorityService,
    commandQueue: queue
  });

  // Inbound transport message
  const cmd = createTestCmd("domain:transfer");
  const inboundMessage = {
    rawEnvelope: cmd,
    transportContext: {
      senderUserId: "player-1",
      transportName: "network",
      receivedAtReal: Date.now()
    }
  };

  // First execution
  const res1 = await bus.dispatchInbound(inboundMessage);
  assert.equal(res1.ok, true);
  assert.equal(executionCount, 1);

  // Status query via bus.queryCommandStatus
  const statusRes = await bus.queryCommandStatus(cmd.commandId);
  assert.equal(statusRes.ok, true);
  if (statusRes.ok) {
    assert.equal(statusRes.value.status, "executed");
    assert.deepEqual(statusRes.value.result, { balance: 100, executionCount: 1 });
  }

  // Retry with the SAME commandId (simulating timeout recovery)
  const res2 = await bus.dispatchInbound(inboundMessage);
  assert.equal(res2.ok, true);
  // Write was NOT duplicated
  assert.equal(executionCount, 1);
  if (res2.ok) {
    assert.deepEqual(res2.value.result, { balance: 100, executionCount: 1 });
  }

  bus.destroy();
});

// ============================================================================
// G2-AUD-015: CommandQueue Real Concurrency Scheduler & Cancellation
// ============================================================================

test("G2-AUD-015: CommandQueue enforces real concurrency limit & strict FIFO on slow handler", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();
  // Concurrency = 1 (single execution slot)
  const queue = new CommandQueue({ maxConcurrency: 1 });

  const executionLog: string[] = [];

  registry.register({
    type: "domain:slow",
    visibility: "public",
    handler: async (ctx) => {
      const id = (ctx.command.payload as any).id;
      executionLog.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 25));
      executionLog.push(`end-${id}`);
      return ok({ id });
    }
  });

  const bus = new CommandBus({
    registry,
    authorityService,
    commandQueue: queue
  });

  const cmd1 = createTestCmd("domain:slow", { id: 1 });
  const cmd2 = createTestCmd("domain:slow", { id: 2 });

  // Launch both simultaneously
  const p1 = bus.dispatchInbound({
    rawEnvelope: cmd1,
    transportContext: { senderUserId: "player-1", transportName: "network", receivedAtReal: Date.now() }
  });
  const p2 = bus.dispatchInbound({
    rawEnvelope: cmd2,
    transportContext: { senderUserId: "player-2", transportName: "network", receivedAtReal: Date.now() + 1 }
  });

  await Promise.all([p1, p2]);

  // Under maxConcurrency = 1, must be strictly serialized in FIFO order:
  assert.deepEqual(executionLog, ["start-1", "end-1", "start-2", "end-2"]);

  bus.destroy();
});

test("G2-AUD-015: Command cancelled while waiting in queue never runs handler and unblocks next waiter immediately", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();
  const queue = new CommandQueue({ maxConcurrency: 1 });

  const executionLog: string[] = [];

  registry.register({
    type: "domain:slow",
    visibility: "public",
    handler: async (ctx) => {
      const id = (ctx.command.payload as any).id;
      executionLog.push(`run-${id}`);
      await new Promise((r) => setTimeout(r, 30));
      return ok({ id });
    }
  });

  const bus = new CommandBus({
    registry,
    authorityService,
    commandQueue: queue
  });

  const cmd1 = createTestCmd("domain:slow", { id: 1 });
  const cmd2 = createTestCmd("domain:slow", { id: 2 });
  const cmd3 = createTestCmd("domain:slow", { id: 3 });

  // 1 starts running, 2 and 3 are queued
  const p1 = bus.dispatchInbound({
    rawEnvelope: cmd1,
    transportContext: { senderUserId: "player-1", transportName: "network", receivedAtReal: Date.now() }
  });
  const p2 = bus.dispatchInbound({
    rawEnvelope: cmd2,
    transportContext: { senderUserId: "player-2", transportName: "network", receivedAtReal: Date.now() + 1 }
  });
  const p3 = bus.dispatchInbound({
    rawEnvelope: cmd3,
    transportContext: { senderUserId: "player-3", transportName: "network", receivedAtReal: Date.now() + 2 }
  });

  // Give microtask time to enqueue cmd2 and cmd3
  await new Promise((r) => setTimeout(r, 5));

  // Cancel cmd2 while it is waiting in queue!
  const cancelRes = bus.cancelCommand(cmd2.commandId, "player-2", false, "User cancelled request");
  assert.equal(cancelRes.ok, true);

  const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

  assert.equal(res1.ok, true);
  assert.equal(res1.value.status, "executed");

  assert.equal(res2.ok, true);
  assert.equal(res2.value.status, "rejected");
  assert.equal(res2.value.error?.code, "DM_COMMAND_CANCELLED");

  assert.equal(res3.ok, true);
  assert.equal(res3.value.status, "executed");

  // Handler for cmd2 was NEVER executed!
  assert.deepEqual(executionLog, ["run-1", "run-3"]);

  bus.destroy();
});

// ============================================================================
// G2-AUD-018: Public Output Sanitization Boundary
// ============================================================================

test("G2-AUD-018: CommandBus + Transport sanitizes sensitive nested tokens, passwords and secrets in results and errors", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();

  registry.register({
    type: "domain:sensitive-success",
    visibility: "public",
    handler: async () => {
      return ok({
        nested: {
          apiToken: "SECRET_TOKEN_XYZ",
          password: "SUPER_SECRET_PASSWORD",
          secretKey: "TOP_SECRET"
        },
        safe: "public_value"
      });
    }
  });

  registry.register({
    type: "domain:sensitive-failure",
    visibility: "public",
    handler: async () => {
      return err({
        code: "DM_AUTH_FAILED" as const,
        category: "permission" as const,
        message: "Failed",
        details: {
          sessionToken: "TOKEN_LEAK",
          userSecret: "SECRET_VAL",
          safeInfo: "ok"
        }
      });
    }
  });

  const bus = new CommandBus({
    registry,
    authorityService
  });

  // 1. Success path with sensitive result
  const successMsg = {
    rawEnvelope: createTestCmd("domain:sensitive-success"),
    transportContext: { senderUserId: "player-1", transportName: "network", receivedAtReal: Date.now() }
  };
  const successRes = await bus.dispatchInbound(successMsg);
  assert.equal(successRes.ok, true);
  if (successRes.ok) {
    const res = successRes.value.result as any;
    assert.equal(res.safe, "public_value");
    assert.equal(res.nested.apiToken, "[REDACTED]");
    assert.equal(res.nested.password, "[REDACTED]");
    assert.equal(res.nested.secretKey, "[REDACTED]");
  }

  // 2. Failure path with sensitive error.details
  const failureMsg = {
    rawEnvelope: createTestCmd("domain:sensitive-failure"),
    transportContext: { senderUserId: "player-1", transportName: "network", receivedAtReal: Date.now() }
  };
  const failureRes = await bus.dispatchInbound(failureMsg);
  assert.equal(failureRes.ok, true);
  if (failureRes.ok) {
    assert.equal(failureRes.value.status, "rejected");
    const details = failureRes.value.error?.details as any;
    assert.equal(details.safeInfo, "ok");
    assert.equal(details.sessionToken, "[REDACTED]");
    assert.equal(details.userSecret, "[REDACTED]");
  }

  bus.destroy();
});

// ============================================================================
// G2-AUD-028: Pre-Validation Rate Limiting & Diagnostics Abuse Tracking
// ============================================================================

test("G2-AUD-028: Pre-validation rate limiter blocks malformed/unknown command spam and tracks abuse in Diagnostics", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();
  const queue = new CommandQueue();
  const lockManager = new LockManager();
  const transactionStore = new TransactionStore();

  const rateLimiter = new RateLimiter({
    preValidationRule: { windowMs: 1000, maxRequests: 3 }
  });

  const bus = new CommandBus({
    registry,
    authorityService,
    commandQueue: queue,
    rateLimiter
  });

  const diags = new G2DiagnosticsProvider({
    authorityService,
    lockManager,
    commandQueue: queue,
    transactionStore,
    registry,
    transport: { name: "test", isAvailable: true, registerInboundHandler: () => () => {} } as any,
    rateLimiter
  });

  const spamSender = "attacker-user";

  // Send 3 malformed commands (consumed by pre-validation)
  for (let i = 0; i < 3; i++) {
    const res = await bus.dispatchInbound({
      rawEnvelope: { invalid: true, notACommand: true },
      transportContext: { senderUserId: spamSender, transportName: "network", receivedAtReal: Date.now() }
    });
    assert.equal(res.ok, true);
    assert.equal(res.value.status, "rejected");
    assert.ok(res.value.error?.code.startsWith("DM_VALIDATION_"));
  }

  // 4th and 5th commands must be rejected by PRE-VALIDATION rate limit before envelope inspection!
  const res4 = await bus.dispatchInbound({
    rawEnvelope: { somethingElse: true },
    transportContext: { senderUserId: spamSender, transportName: "network", receivedAtReal: Date.now() }
  });
  assert.equal(res4.ok, true);
  assert.equal(res4.value.status, "rejected");
  assert.equal(res4.value.error?.code, "DM_RATE_LIMIT_EXCEEDED");
  assert.match(res4.value.error?.message ?? "", /Pre-validation request rate limit exceeded/);

  // Verify abuse tracking in G2DiagnosticsProvider
  const snapshot = diags.getSnapshot();
  assert.ok(snapshot.abuse);
  assert.ok(snapshot.abuse.totalIncidents >= 4);

  const attackerAbuse = snapshot.abuse.records.filter((r) => r.senderUserId === spamSender);
  assert.ok(attackerAbuse.length >= 2, "Should record malformed_envelope and pre_validation_limit_exceeded");
  const preValAbuse = attackerAbuse.find((r) => r.reason === "pre_validation_limit_exceeded");
  assert.ok(preValAbuse);
  assert.ok(preValAbuse.count >= 1);

  bus.destroy();
});

// ============================================================================
// CICLO 2 ADVERSARIAL TESTS
// ============================================================================

test("Ciclo 2 - G2-AUD-002: Socketlib authenticates via this.socketdata.userId; caller-passed transportSession/args are ignored", async () => {
  const clientRegistries = new Map<string, Map<string, Function>>();

  function createMockSocketlib(clientId: string): SocketlibSocketLike {
    if (!clientRegistries.has(clientId)) clientRegistries.set(clientId, new Map());
    const myRegistry = clientRegistries.get(clientId)!;

    return {
      register: (name, func) => {
        myRegistry.set(name, func);
      },
      executeAsUser: async (handlerName, targetUserId, ...args) => {
        const targetRegistry = clientRegistries.get(targetUserId);
        const fn = targetRegistry?.get(handlerName);
        if (!fn) throw new Error(`Function '${handlerName}' not registered`);
        // Real Socketlib invocation: sets this.socketdata = { userId: clientId }
        return fn.call({ socketdata: { userId: clientId } }, ...args);
      }
    };
  }

  const gmAuthority = createHarnessAuthority("gm-1", "gm-1");
  const gmTransport = new FoundryCommandTransportAdapter({
    runtime: {
      user: { id: "gm-1", isGM: true },
      users: {
        get: (id: string) => {
          const u = [{ id: "gm-1", active: true }, { id: "player-1", active: true }, { id: "player-2", active: true }];
          return u.find((x) => x.id === id);
        }
      }
    },
    authorityService: gmAuthority,
    socketlib: createMockSocketlib("gm-1")
  });

  let seenSenderInHandler: string | null = null;
  gmTransport.registerInboundHandler(async (msg) => {
    seenSenderInHandler = msg.transportContext.senderUserId;
    return ok({
      commandId: (msg.rawEnvelope as any).commandId,
      status: "executed",
      result: { executed: true },
      transportTimestamp: Date.now()
    });
  });

  // Case A: player-1 sends authentic packet (declaredSenderUserId: "player-1")
  const player1Transport = new FoundryCommandTransportAdapter({
    runtime: { user: { id: "player-1", isGM: false } },
    authorityService: createHarnessAuthority("player-1", "gm-1"),
    socketlib: createMockSocketlib("player-1")
  });

  const cmdA = createTestCmd("domain:ping");
  const resA = await player1Transport.send(cmdA);
  assert.equal(resA.ok, true);
  assert.equal(seenSenderInHandler, "player-1");

  // Case B: Attacker attempts to spoof by calling executeAsUser directly or passing fake session args
  // player-1 calls executeCommand with packet declaring "player-2"
  const fakePacket: SocketRequestPacket = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_REQUEST",
    correlationId: "corr_spoof_test",
    command: createTestCmd("domain:ping"),
    declaredSenderUserId: "player-2" // Attacker claims to be player-2
  };

  const p1Socketlib = createMockSocketlib("player-1");
  // Attacker invokes RPC directly and passes malicious extra argument { senderUserId: "player-2" }
  const resB = await p1Socketlib.executeAsUser(
    "executeCommand",
    "gm-1",
    fakePacket,
    { senderUserId: "player-2" } // Attacker attempts argument injection
  );

  // Must be rejected with DM_SECURITY_SENDER_SPOOFED because Socketlib authenticates as player-1
  assert.equal(resB.ok, true);
  assert.equal(resB.value.status, "rejected");
  assert.equal(resB.value.error?.code, "DM_SECURITY_SENDER_SPOOFED");

  // Case C: RPC invocation without socketdata (fails closed)
  const fn = clientRegistries.get("gm-1")?.get("executeCommand")!;
  const resC = await fn.call({}, fakePacket);
  assert.equal(resC.ok, true);
  assert.equal(resC.value.status, "rejected");
  assert.equal(resC.value.error?.code, "DM_AUTH_UNAUTHENTICATED");

  gmTransport.destroy();
  player1Transport.destroy();
});

test("Ciclo 2 - CommandQueue: Success increments completedCount, failure increments failedCount", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();
  const queue = new CommandQueue({ maxConcurrency: 10 });

  registry.register({
    type: "domain:ok",
    visibility: "public",
    handler: async () => ok({ result: "success" })
  });

  registry.register({
    type: "domain:fail",
    visibility: "public",
    handler: async () => err(createPublicError({ code: "DM_TEST_FAIL", category: "validation", message: "fail" }))
  });

  const bus = new CommandBus({
    registry,
    authorityService,
    commandQueue: queue
  });

  // Execute 3 successful commands
  for (let i = 0; i < 3; i++) {
    const res = await bus.dispatchInbound({
      rawEnvelope: createTestCmd("domain:ok"),
      transportContext: { senderUserId: "player-1", transportName: "network", receivedAtReal: Date.now() }
    });
    assert.equal(res.ok, true);
    assert.equal(res.value.status, "executed");
  }

  // Execute 2 failed commands
  for (let i = 0; i < 2; i++) {
    const res = await bus.dispatchInbound({
      rawEnvelope: createTestCmd("domain:fail"),
      transportContext: { senderUserId: "player-1", transportName: "network", receivedAtReal: Date.now() }
    });
    assert.equal(res.ok, true);
    assert.equal(res.value.status, "rejected");
  }

  const diags = queue.getDiagnostics();
  assert.equal(diags.completedCount, 3, "completedCount must be 3");
  assert.equal(diags.failedCount, 2, "failedCount must be 2");
  assert.equal(diags.queuedCount, 0, "queuedCount must be 0");
  assert.equal(diags.runningCount, 0, "runningCount must be 0");

  bus.destroy();
});

test("Ciclo 2 - CommandQueue: Schema, permission, and dedupe rejections leave NO queued ghosts", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();
  const queue = new CommandQueue({ maxConcurrency: 10 });

  registry.register({
    type: "domain:schema-test",
    visibility: "public",
    schemaValidator: (payload: any) => {
      if (!payload?.validField) {
        return err(createPublicError({ code: "DM_INVALID_SCHEMA", category: "validation", message: "Invalid field" }));
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => {
      if (ctx.senderUserId !== "authorized-user") {
        return err(createPublicError({ code: "DM_PERMISSION_DENIED", category: "permission", message: "Denied" }));
      }
      return ok(undefined);
    },
    handler: async () => ok({ done: true })
  });

  const bus = new CommandBus({
    registry,
    authorityService,
    commandQueue: queue
  });

  // 1. Schema rejection
  const res1 = await bus.dispatchInbound({
    rawEnvelope: createTestCmd("domain:schema-test", { invalid: true }),
    transportContext: { senderUserId: "authorized-user", transportName: "network", receivedAtReal: Date.now() }
  });
  assert.equal(res1.ok, true);
  assert.equal(res1.value.status, "rejected");
  assert.equal(res1.value.error?.code, "DM_INVALID_SCHEMA");

  let diags = queue.getDiagnostics();
  assert.equal(diags.queuedCount, 0, "No queued ghost after schema rejection");
  assert.equal(diags.runningCount, 0);

  // 2. Permission rejection
  const res2 = await bus.dispatchInbound({
    rawEnvelope: createTestCmd("domain:schema-test", { validField: true }),
    transportContext: { senderUserId: "unauthorized-user", transportName: "network", receivedAtReal: Date.now() }
  });
  assert.equal(res2.ok, true);
  assert.equal(res2.value.status, "rejected");
  assert.equal(res2.value.error?.code, "DM_PERMISSION_DENIED");

  diags = queue.getDiagnostics();
  assert.equal(diags.queuedCount, 0, "No queued ghost after permission rejection");
  assert.equal(diags.runningCount, 0);

  // 3. Dedupe conflict (same commandId with different payload)
  const sharedCmdId = createCommandId();
  const res3a = await bus.dispatchInbound({
    rawEnvelope: {
      contractVersion: COMMAND_CONTRACT_VERSION_V1,
      commandId: sharedCmdId,
      type: "domain:schema-test",
      payload: { validField: "first" },
      issuedAtReal: Date.now()
    },
    transportContext: { senderUserId: "authorized-user", transportName: "network", receivedAtReal: Date.now() }
  });
  assert.equal(res3a.ok, true);
  assert.equal(res3a.value.status, "executed");

  const res3b = await bus.dispatchInbound({
    rawEnvelope: {
      contractVersion: COMMAND_CONTRACT_VERSION_V1,
      commandId: sharedCmdId,
      type: "domain:schema-test",
      payload: { validField: "second" },
      issuedAtReal: Date.now()
    },
    transportContext: { senderUserId: "authorized-user", transportName: "network", receivedAtReal: Date.now() }
  });
  assert.equal(res3b.ok, true);
  assert.equal(res3b.value.status, "rejected");
  assert.equal(res3b.value.error?.code, "DM_COMMAND_ID_REUSE_MISMATCH");

  diags = queue.getDiagnostics();
  assert.equal(diags.queuedCount, 0, "No queued ghost after dedupe mismatch");
  assert.equal(diags.runningCount, 0);
  assert.equal(diags.completedCount, 1);

  bus.destroy();
});

test("Ciclo 2 - 10 players / domains: independent commands demonstrate real concurrency (maxActive > 1)", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();
  const queue = new CommandQueue({ maxConcurrency: 10 });
  const lockManager = new LockManager();

  let activeCount = 0;
  let maxActiveObserved = 0;

  registry.register({
    type: "domain:independent-action",
    visibility: "public",
    handler: async (ctx) => {
      const domainId = (ctx.command.payload as any).domainId;
      const acquired = await lockManager.acquireLocks({ keys: [domainId], ownerId: `cmd_${domainId}`, timeoutMs: 1000 });
      assert.equal(acquired.ok, true);

      activeCount++;
      if (activeCount > maxActiveObserved) {
        maxActiveObserved = activeCount;
      }

      await new Promise((r) => setTimeout(r, 30));

      activeCount--;
      if (acquired.ok) acquired.value.release();
      return ok({ domainId });
    }
  });

  const bus = new CommandBus({
    registry,
    authorityService,
    commandQueue: queue
  });

  const start = Date.now();
  const promises = Array.from({ length: 10 }, (_, i) => {
    const domainId = `domain-${i}`;
    return bus.dispatchInbound({
      rawEnvelope: createTestCmd("domain:independent-action", { domainId }),
      transportContext: { senderUserId: `player-${i}`, transportName: "network", receivedAtReal: Date.now() }
    });
  });

  const results = await Promise.all(promises);
  const elapsed = Date.now() - start;

  for (const res of results) {
    assert.equal(res.ok, true);
    assert.equal(res.value.status, "executed");
  }

  // Real concurrency proof: maxActive observed > 1 and elapsed is well under serial execution
  assert.ok(maxActiveObserved >= 4, `maxActiveObserved should be >= 4, got ${maxActiveObserved}`);
  assert.ok(elapsed < 1000, `10 parallel 30ms commands should finish well under 1000ms, elapsed: ${elapsed}ms`);
  assert.equal(lockManager.getDiagnostics().filter((l) => l.currentOwnerId !== null).length, 0, "No residual locks");

  bus.destroy();
});

test("Ciclo 2 - 10 commands on the SAME domain: serialized by LockManager (maxActive == 1)", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();
  const queue = new CommandQueue({ maxConcurrency: 10 });
  const lockManager = new LockManager();

  let activeInDomain = 0;
  let maxActiveInDomain = 0;

  registry.register({
    type: "domain:same-domain-action",
    visibility: "public",
    handler: async (ctx) => {
      const lockKey = "domain:shared-world";
      const cmdId = ctx.command.commandId;
      const acquired = await lockManager.acquireLocks({ keys: [lockKey], ownerId: cmdId, timeoutMs: 2000 });
      assert.equal(acquired.ok, true);

      activeInDomain++;
      if (activeInDomain > maxActiveInDomain) {
        maxActiveInDomain = activeInDomain;
      }

      await new Promise((r) => setTimeout(r, 10));

      activeInDomain--;
      if (acquired.ok) acquired.value.release();
      return ok({ cmdId });
    }
  });

  const bus = new CommandBus({
    registry,
    authorityService,
    commandQueue: queue
  });

  const promises = Array.from({ length: 10 }, (_, i) => {
    return bus.dispatchInbound({
      rawEnvelope: createTestCmd("domain:same-domain-action", { idx: i }),
      transportContext: { senderUserId: `player-${i % 3}`, transportName: "network", receivedAtReal: Date.now() }
    });
  });

  const results = await Promise.all(promises);
  for (const res of results) {
    assert.equal(res.ok, true);
    assert.equal(res.value.status, "executed");
  }

  assert.equal(maxActiveInDomain, 1, "Only 1 command at a time inside the shared domain");
  assert.equal(lockManager.getDiagnostics().filter((l) => l.currentOwnerId !== null).length, 0);

  bus.destroy();
});

test("Ciclo 2 - Mixed Domains A and B: serialize within domain, run in parallel across domains", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();
  const queue = new CommandQueue({ maxConcurrency: 10 });
  const lockManager = new LockManager();

  let activeA = 0;
  let maxActiveA = 0;
  let activeB = 0;
  let maxActiveB = 0;
  let concurrentCrossDomain = false;

  registry.register({
    type: "domain:partitioned",
    visibility: "public",
    handler: async (ctx) => {
      const partition = (ctx.command.payload as any).partition as "A" | "B";
      const lockKey = `domain:${partition}`;
      const cmdId = ctx.command.commandId;
      const acquired = await lockManager.acquireLocks({ keys: [lockKey], ownerId: cmdId, timeoutMs: 2000 });
      assert.equal(acquired.ok, true);

      if (partition === "A") {
        activeA++;
        if (activeA > maxActiveA) maxActiveA = activeA;
      } else {
        activeB++;
        if (activeB > maxActiveB) maxActiveB = activeB;
      }

      if (activeA > 0 && activeB > 0) {
        concurrentCrossDomain = true;
      }

      await new Promise((r) => setTimeout(r, 20));

      if (partition === "A") activeA--;
      else activeB--;

      if (acquired.ok) acquired.value.release();
      return ok({ partition });
    }
  });

  const bus = new CommandBus({
    registry,
    authorityService,
    commandQueue: queue
  });

  const promises = [
    ...Array.from({ length: 5 }, () =>
      bus.dispatchInbound({
        rawEnvelope: createTestCmd("domain:partitioned", { partition: "A" }),
        transportContext: { senderUserId: "player-1", transportName: "network", receivedAtReal: Date.now() }
      })
    ),
    ...Array.from({ length: 5 }, () =>
      bus.dispatchInbound({
        rawEnvelope: createTestCmd("domain:partitioned", { partition: "B" }),
        transportContext: { senderUserId: "player-2", transportName: "network", receivedAtReal: Date.now() }
      })
    )
  ];

  const results = await Promise.all(promises);
  for (const res of results) {
    assert.equal(res.ok, true);
    assert.equal(res.value.status, "executed");
  }

  assert.equal(maxActiveA, 1, "Domain A never exceeded 1 active lock");
  assert.equal(maxActiveB, 1, "Domain B never exceeded 1 active lock");
  assert.equal(concurrentCrossDomain, true, "Domain A and Domain B executed concurrently");
  assert.equal(lockManager.getDiagnostics().filter((l) => l.currentOwnerId !== null).length, 0);

  bus.destroy();
});

test("Ciclo 2 - Concurrency=10: cancellation/timeout does not leave permits or locks stuck, subsequent commands acquire immediately", async () => {
  const authorityService = createHarnessAuthority("gm-1", "gm-1");
  const registry = new CommandRegistry();
  const queue = new CommandQueue({ maxConcurrency: 10 });
  const lockManager = new LockManager();

  // 1. Slow holder on domain:contested
  registry.register({
    type: "domain:slow-holder",
    visibility: "public",
    handler: async (ctx) => {
      const lockKey = "domain:contested";
      const acquired = await lockManager.acquireLocks({ keys: [lockKey], ownerId: ctx.command.commandId, timeoutMs: 1000 });
      assert.equal(acquired.ok, true);
      await new Promise((r) => setTimeout(r, 60));
      if (acquired.ok) acquired.value.release();
      return ok({ holder: "done" });
    }
  });

  // 2. Contender that times out on domain:contested
  registry.register({
    type: "domain:contender",
    visibility: "public",
    handler: async (ctx) => {
      const lockKey = "domain:contested";
      const acquired = await lockManager.acquireLocks({ keys: [lockKey], ownerId: ctx.command.commandId, timeoutMs: 20 });
      if (!acquired.ok) {
        return err(acquired.error);
      }
      if (acquired.ok) acquired.value.release();
      return ok({ contender: "done" });
    }
  });

  // 3. Independent parallel commands
  let activeParallel = 0;
  let maxActiveParallel = 0;
  registry.register({
    type: "domain:parallel-work",
    visibility: "public",
    handler: async (ctx) => {
      const domainId = (ctx.command.payload as any).domainId;
      const acquired = await lockManager.acquireLocks({ keys: [domainId], ownerId: ctx.command.commandId, timeoutMs: 1000 });
      assert.equal(acquired.ok, true);
      activeParallel++;
      if (activeParallel > maxActiveParallel) maxActiveParallel = activeParallel;
      await new Promise((r) => setTimeout(r, 30));
      activeParallel--;
      if (acquired.ok) acquired.value.release();
      return ok({ domainId });
    }
  });

  const bus = new CommandBus({
    registry,
    authorityService,
    commandQueue: queue
  });

  // A. Dispatch holder
  const pHolder = bus.dispatchInbound({
    rawEnvelope: createTestCmd("domain:slow-holder"),
    transportContext: { senderUserId: "player-1", transportName: "network", receivedAtReal: Date.now() }
  });

  // Small delay to ensure holder acquires lock
  await new Promise((r) => setTimeout(r, 5));

  // B. Dispatch contenders that will time out
  const pTimeouts = Array.from({ length: 3 }, (_, i) =>
    bus.dispatchInbound({
      rawEnvelope: createTestCmd("domain:contender", { idx: i }),
      transportContext: { senderUserId: `player-${i + 2}`, transportName: "network", receivedAtReal: Date.now() }
    })
  );

  // C. Dispatch contender to be cancelled while waiting
  const cancelCmd = createTestCmd("domain:contender", { willCancel: true });
  const pCancel = bus.dispatchInbound({
    rawEnvelope: cancelCmd,
    transportContext: { senderUserId: "player-9", transportName: "network", receivedAtReal: Date.now() }
  });

  // D. Dispatch 5 parallel independent domain commands
  const pParallels = Array.from({ length: 5 }, (_, i) =>
    bus.dispatchInbound({
      rawEnvelope: createTestCmd("domain:parallel-work", { domainId: `domain:indep-${i}` }),
      transportContext: { senderUserId: `player-${i + 4}`, transportName: "network", receivedAtReal: Date.now() }
    })
  );

  // Cancel command C
  bus.cancelCommand(cancelCmd.commandId, "player-9", false, "User cancelled");

  // Await all
  const [resHolder, ...resRest] = await Promise.all([pHolder, ...pTimeouts, pCancel, ...pParallels]);

  assert.equal(resHolder.ok, true);
  assert.equal(resHolder.value.status, "executed");

  // Timeout results (first 3 of rest)
  const resTimeouts = resRest.slice(0, 3);
  for (const t of resTimeouts) {
    assert.equal(t.ok, true);
    assert.equal(t.value.status, "rejected");
    assert.equal(t.value.error?.code, "DM_LOCK_TIMEOUT");
  }

  // Cancelled result
  const resCancel = resRest[3];
  assert.equal(resCancel.ok, true);
  assert.equal(resCancel.value.status, "rejected");

  // Parallel results (last 5 of rest)
  const resParallels = resRest.slice(4);
  for (const p of resParallels) {
    assert.equal(p.ok, true);
    assert.equal(p.value.status, "executed");
  }

  // Proof that parallel work executed concurrently while contested domain was held/timed out
  assert.ok(maxActiveParallel >= 2, `maxActiveParallel should be >= 2, got ${maxActiveParallel}`);

  // CRITICAL AUDIT ASSERTIONS: No permits or locks stuck!
  const diags = queue.getDiagnostics();
  assert.equal(diags.runningCount, 0, "No permits stuck in runningCount");
  assert.equal(diags.queuedCount, 0, "No entries stuck in queuedCount");
  assert.equal(lockManager.getDiagnostics().filter((l) => l.currentOwnerId !== null).length, 0, "No locks stuck");

  // PROOF OF NO PERMIT LEAKS: Execute 10 fresh commands in parallel immediately
  let freshActive = 0;
  let maxFreshActive = 0;
  registry.register({
    type: "domain:fresh-burst",
    visibility: "public",
    handler: async (ctx) => {
      const domainId = (ctx.command.payload as any).domainId;
      const acquired = await lockManager.acquireLocks({ keys: [domainId], ownerId: ctx.command.commandId, timeoutMs: 1000 });
      assert.equal(acquired.ok, true);
      freshActive++;
      if (freshActive > maxFreshActive) maxFreshActive = freshActive;
      await new Promise((r) => setTimeout(r, 20));
      freshActive--;
      if (acquired.ok) acquired.value.release();
      return ok({ domainId });
    }
  });

  const freshPromises = Array.from({ length: 10 }, (_, i) =>
    bus.dispatchInbound({
      rawEnvelope: createTestCmd("domain:fresh-burst", { domainId: `domain:fresh-${i}` }),
      transportContext: { senderUserId: `player-${i}`, transportName: "network", receivedAtReal: Date.now() }
    })
  );

  const freshResults = await Promise.all(freshPromises);
  for (const r of freshResults) {
    assert.equal(r.ok, true);
    assert.equal(r.value.status, "executed");
  }

  assert.ok(maxFreshActive >= 4, `All 10 slots available! maxFreshActive should be >= 4, got ${maxFreshActive}`);
  assert.equal(queue.getDiagnostics().runningCount, 0);
  assert.equal(lockManager.getDiagnostics().filter((l) => l.currentOwnerId !== null).length, 0);

  bus.destroy();
});

test("Ciclo 2 - Handoff validator: ANTIGRAVITY_HANDOFF.md does not reference obsolete G2.2a or outdated test count", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const content = await fs.readFile(path.join(process.cwd(), "ANTIGRAVITY_HANDOFF.md"), "utf8");

  assert.ok(!content.includes("G2.2a"), "ANTIGRAVITY_HANDOFF.md must not point to obsolete G2.2a");
  assert.ok(!content.includes("108/108"), "ANTIGRAVITY_HANDOFF.md must not reference old 108 test count");
  assert.ok(content.includes("G3"), "ANTIGRAVITY_HANDOFF.md must establish Gate G3 as next gate");
  assert.ok(content.includes("Gate G2"), "ANTIGRAVITY_HANDOFF.md must confirm Gate G2 completion");
});

