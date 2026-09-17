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
  DOMAIN_MANAGER_SOCKET_CHANNEL,
  type FoundrySocketLike,
  type FoundrySocketRuntimeLike,
  type SocketlibSocketLike,
  type SocketRequestPacket,
  type SocketStatusQueryPacket
} from "../../src/commands/foundry-command-transport-adapter.js";
import { ok } from "../../src/core/contracts/result.js";

class TrackableSocket implements FoundrySocketLike {
  readonly emitted: Array<{ event: string; args: unknown[] }> = [];
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  emit(event: string, ...args: unknown[]): void {
    this.emitted.push({ event, args });
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        queueMicrotask(() => fn(...args));
      }
    }
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(callback);
  }
}

function createHarnessAuthority(
  currentUserId: string | null,
  authorityUserId: string | null = "gm-1"
) {
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
      authorityUserId,
      authorityEpoch: 1,
      initialized: true
    }
  );
}

function createTestCmd(type = "domain:create", payload: Record<string, unknown> = {}): DomainCommand<Record<string, unknown>> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

/**
 * TESTE A — Socketlib ausente
 * Com:
 *   game.socket = disponível
 *   socketlib = ausente
 *   client != Primary Authority
 * transport.send() deve retornar:
 *   DM_TRANSPORT_UNAVAILABLE
 * e não emitir DM_CMD_REQUEST no module.domain-manager.
 */
test("Teste A: Socketlib ausente — transport.send() retorna DM_TRANSPORT_UNAVAILABLE e não emite DM_CMD_REQUEST no socket nativo", async () => {
  const socket = new TrackableSocket();
  const authorityService = createHarnessAuthority("player-1", "gm-1");
  const runtime: FoundrySocketRuntimeLike = {
    socket,
    user: { id: "player-1", isGM: false }
  };

  const transport = new FoundryCommandTransportAdapter({
    runtime,
    authorityService
    // socketlib omitido / ausente
  });

  assert.equal(transport.isAvailable, false, "Transport must not be available when socketlib is absent for non-authority client");

  const cmd = createTestCmd();
  const result = await transport.send(cmd);

  assert.equal(result.ok, false, "Send must fail when Socketlib is absent");
  if (!result.ok) {
    assert.equal(result.error.code, "DM_TRANSPORT_UNAVAILABLE");
  }

  // Verifica que NENHUM emit ocorreu no canal module.domain-manager com DM_CMD_REQUEST
  const requestEmit = socket.emitted.find(
    (e) =>
      e.event === DOMAIN_MANAGER_SOCKET_CHANNEL &&
      (e.args[0] as any)?.kind === "DM_CMD_REQUEST"
  );
  assert.equal(requestEmit, undefined, "No DM_CMD_REQUEST should ever be emitted over native socket channel");
  assert.equal(socket.emitted.length, 0, "Socket must have zero emits");

  transport.destroy();
});

/**
 * TESTE B — Bypass pelo native socket
 * Com Socketlib ativo, emitir diretamente no canal nativo um packet:
 *   DM_CMD_REQUEST
 * O handler do CommandBus não pode executar.
 */
test("Teste B: Bypass pelo native socket — DM_CMD_REQUEST no canal nativo não executa handler do CommandBus", async () => {
  const sharedSocket = new TrackableSocket();
  const gmAuthority = createHarnessAuthority("gm-1", "gm-1");

  let registeredExecuteCommand: Function | null = null;
  const gmSocketlib: SocketlibSocketLike = {
    register: (name, fn) => {
      if (name === "executeCommand") registeredExecuteCommand = fn;
    },
    executeAsUser: async () => ({})
  };

  const gmRuntime: FoundrySocketRuntimeLike = {
    socket: sharedSocket,
    user: { id: "gm-1", isGM: true }
  };

  const gmTransport = new FoundryCommandTransportAdapter({
    runtime: gmRuntime,
    authorityService: gmAuthority,
    socketlib: gmSocketlib
  });

  const registry = new CommandRegistry();
  let busHandlerExecuted = false;
  registry.register({
    type: "domain:create",
    version: 1,
    schemaValidator: () => ok(undefined),
    permissionValidator: () => ok(undefined),
    handler: async () => {
      busHandlerExecuted = true;
      return ok({ created: true });
    }
  });

  const bus = new CommandBus({
    transport: gmTransport,
    authorityService: gmAuthority,
    registry
  });

  // Atacante tenta enviar DM_CMD_REQUEST diretamente pelo canal broadcast nativo
  const maliciousPacket: SocketRequestPacket = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_REQUEST",
    correlationId: "corr_malicious_native_bypass",
    command: createTestCmd("domain:create"),
    declaredSenderUserId: "player-1",
    targetAuthorityUserId: "gm-1",
    targetAuthorityEpoch: 1
  };

  sharedSocket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, maliciousPacket, { userId: "player-1" });

  await new Promise((r) => setTimeout(r, 25));

  assert.equal(busHandlerExecuted, false, "CommandBus handler must NOT execute from native socket broadcast packet");

  // O canal nativo também não deve receber nenhuma resposta emitida pelo adapter
  const responseEmit = sharedSocket.emitted.find(
    (e) => (e.args[0] as any)?.correlationId === "corr_malicious_native_bypass" && (e.args[0] as any)?.kind === "DM_CMD_RESPONSE"
  );
  assert.equal(responseEmit, undefined, "Adapter must not emit response on native socket");

  gmTransport.destroy();
});

/**
 * TESTE C — Status query bypass
 * DM_CMD_STATUS_QUERY enviado diretamente pelo canal nativo não pode consultar o estado autoritativo.
 */
test("Teste C: Status query bypass — DM_CMD_STATUS_QUERY no canal nativo não consulta estado autoritativo", async () => {
  const sharedSocket = new TrackableSocket();
  const gmAuthority = createHarnessAuthority("gm-1", "gm-1");

  const gmSocketlib: SocketlibSocketLike = {
    register: () => {},
    executeAsUser: async () => ({})
  };

  const gmTransport = new FoundryCommandTransportAdapter({
    runtime: { socket: sharedSocket, user: { id: "gm-1", isGM: true } },
    authorityService: gmAuthority,
    socketlib: gmSocketlib
  });

  let statusQueried = false;
  gmTransport.registerStatusQueryHandler(async (commandId) => {
    statusQueried = true;
    return ok({
      commandId,
      status: "applied",
      transportTimestamp: Date.now()
    });
  });

  // Atacante tenta enviar DM_CMD_STATUS_QUERY diretamente pelo canal nativo
  const statusPacket: SocketStatusQueryPacket = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_STATUS_QUERY",
    correlationId: "corr_status_native_bypass",
    commandId: "cmd_0123456789abcdef0123456789abcdef" as CommandId,
    targetAuthorityUserId: "gm-1",
    targetAuthorityEpoch: 1,
    declaredSenderUserId: "player-1"
  };

  sharedSocket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, statusPacket, { userId: "player-1" });

  await new Promise((r) => setTimeout(r, 25));

  assert.equal(statusQueried, false, "Status query handler must NOT be queried from native socket packet");

  // Nenhuma resposta emitida no socket nativo
  const responseEmit = sharedSocket.emitted.find(
    (e) => (e.args[0] as any)?.kind === "DM_CMD_STATUS_RESPONSE"
  );
  assert.equal(responseEmit, undefined, "Adapter must not emit status response on native socket");

  gmTransport.destroy();
});

/**
 * TESTE D — Regressão Socketlib
 * Confirmar novamente:
 *   player -> Primary Authority via executeAsUser;
 *   this.socketdata.userId é o sender real;
 *   spoofing falha closed;
 *   resposta retorna pela Promise RPC.
 */
test("Teste D: Regressão Socketlib — player -> Primary Authority via executeAsUser, sender autenticado, anti-spoofing e Promise RPC", async () => {
  const gmRegistry = new Map<string, Function>();

  const gmSocketlib: SocketlibSocketLike = {
    register: (name, fn) => {
      gmRegistry.set(name, fn);
    },
    executeAsUser: async () => {
      throw new Error("GM should not call executeAsUser in this test");
    }
  };

  const playerSocketlib: SocketlibSocketLike = {
    register: () => {},
    executeAsUser: async (handlerName, targetUserId, ...args) => {
      assert.equal(targetUserId, "gm-1", "RPC must be directed exclusively to Primary Authority gm-1");
      const fn = gmRegistry.get(handlerName);
      if (!fn) throw new Error(`Handler '${handlerName}' not found on GM`);

      // Socketlib sets this.socketdata.userId strictly to the caller player-1
      const context = { socketdata: { userId: "player-1" } };
      return fn.call(context, ...args);
    }
  };

  // 1. GM Authority Setup
  const gmAuthority = createHarnessAuthority("gm-1", "gm-1");
  const gmTransport = new FoundryCommandTransportAdapter({
    runtime: { user: { id: "gm-1", isGM: true } },
    authorityService: gmAuthority,
    socketlib: gmSocketlib
  });

  const registry = new CommandRegistry();
  let executedSender: string | null = null;
  registry.register({
    type: "domain:create",
    version: 1,
    schemaValidator: () => ok(undefined),
    permissionValidator: () => ok(undefined),
    handler: async (ctx) => {
      executedSender = ctx.senderUserId;
      return ok({ domainId: "dom_new_123" });
    }
  });

  const bus = new CommandBus({
    transport: gmTransport,
    authorityService: gmAuthority,
    registry
  });

  // 2. Player Client Setup
  const playerAuthority = createHarnessAuthority("player-1", "gm-1");
  const playerTransport = new FoundryCommandTransportAdapter({
    runtime: { user: { id: "player-1", isGM: false } },
    authorityService: playerAuthority,
    socketlib: playerSocketlib
  });

  // 2a. Fluxo legítimo: player-1 envia via executeAsUser
  const validCmd = createTestCmd("domain:create", { name: "Test Domain" });
  const validResult = await playerTransport.send(validCmd);

  assert.equal(validResult.ok, true, "Legitimate RPC dispatch must succeed");
  if (validResult.ok) {
    if (validResult.value.status === "rejected") {
      assert.fail(`Valid send rejected unexpectedly: ${JSON.stringify(validResult.value.error)}`);
    }
    assert.equal(validResult.value.status, "executed");
    assert.deepEqual(validResult.value.result, { domainId: "dom_new_123" });
  }
  assert.equal(executedSender, "player-1", "CommandBus execution context must receive authentic player-1 sender");

  // 2b. Spoofing: player tenta declarar outro userId (declaredSenderUserId = "player-2")
  const spoofedSocketlib: SocketlibSocketLike = {
    register: () => {},
    executeAsUser: async (handlerName, targetUserId, packet: any) => {
      const fn = gmRegistry.get(handlerName);
      if (!fn) throw new Error("Handler not found");
      // Player-1 session, but packet declared player-2
      const context = { socketdata: { userId: "player-1" } };
      const packetWithSpoofedSender = {
        ...packet,
        declaredSenderUserId: "player-2"
      };
      return fn.call(context, packetWithSpoofedSender);
    }
  };

  const spoofingPlayerTransport = new FoundryCommandTransportAdapter({
    runtime: { user: { id: "player-1", isGM: false } },
    authorityService: playerAuthority,
    socketlib: spoofedSocketlib
  });

  const spoofResult = await spoofingPlayerTransport.send(createTestCmd("domain:create"));
  assert.equal(spoofResult.ok, true, "Transport returns receipt");
  if (spoofResult.ok) {
    assert.equal(spoofResult.value.status, "rejected", "Spoofing attempt must be rejected");
    assert.equal(spoofResult.value.error?.code, "DM_SECURITY_SENDER_SPOOFED");
  }

  gmTransport.destroy();
  playerTransport.destroy();
  spoofingPlayerTransport.destroy();
});

test("getStatus(): remote client requires Socketlib, otherwise fails closed with DM_TRANSPORT_UNAVAILABLE", async () => {
  const playerAuthority = createHarnessAuthority("player-1", "gm-1");

  // Sem Socketlib
  const transportWithoutSocketlib = new FoundryCommandTransportAdapter({
    runtime: { user: { id: "player-1", isGM: false } },
    authorityService: playerAuthority
  });

  const res1 = await transportWithoutSocketlib.getStatus("cmd_0123456789abcdef0123456789abcdef" as CommandId);
  assert.equal(res1.ok, false);
  assert.equal(res1.error.code, "DM_TRANSPORT_UNAVAILABLE");

  // Com Socketlib
  let executedTargetUser: string | null = null;
  let executedCommandId: string | null = null;
  const mockSocketlib: SocketlibSocketLike = {
    register: () => {},
    executeAsUser: async (handlerName, targetUserId, commandId) => {
      executedTargetUser = targetUserId;
      executedCommandId = commandId as string;
      return ok({
        commandId: commandId as any,
        status: "executed",
        transportTimestamp: Date.now()
      });
    }
  };

  const transportWithSocketlib = new FoundryCommandTransportAdapter({
    runtime: { user: { id: "player-1", isGM: false } },
    authorityService: playerAuthority,
    socketlib: mockSocketlib
  });

  const res2 = await transportWithSocketlib.getStatus("cmd_0123456789abcdef0123456789abcdef" as CommandId);
  assert.equal(res2.ok, true);
  assert.equal(executedTargetUser, "gm-1");
  assert.equal(executedCommandId, "cmd_0123456789abcdef0123456789abcdef");

  transportWithoutSocketlib.destroy();
  transportWithSocketlib.destroy();
});

