import test from "node:test";
import assert from "node:assert/strict";
import {
  FoundryCommandTransportAdapter,
  DOMAIN_MANAGER_SOCKET_CHANNEL,
  type FoundrySocketLike,
  type FoundrySocketRuntimeLike
} from "../../src/commands/foundry-command-transport-adapter.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { ok } from "../../src/core/contracts/result.js";

class FakeSocket implements FoundrySocketLike {
  readonly emitted: Array<{ event: string; data: unknown }> = [];
  #listener: ((packet: unknown) => void) | null = null;

  emit(event: string, data: unknown): void {
    this.emitted.push({ event, data });
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    if (event === DOMAIN_MANAGER_SOCKET_CHANNEL) {
      this.#listener = callback;
    }
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    if (this.#listener === callback) {
      this.#listener = null;
    }
  }

  simulateInbound(packet: unknown): void {
    if (this.#listener) {
      this.#listener(packet);
    }
  }
}

test("Adversarial: FoundryCommandTransportAdapter rejects remote packet spoofing the local Primary Authority", async () => {
  const socket = new FakeSocket();
  const users = [{ id: "gm-primary", isGM: true, active: true }];
  const authorityService = new PrimaryAuthorityService({
    getUsers: () => users,
    getPreferredUserId: () => "gm-primary",
    getCurrentUserId: () => "gm-primary"
  });
  authorityService.resolve();

  const runtime: FoundrySocketRuntimeLike = {
    socket,
    user: { id: "gm-primary", isGM: true }
  };

  const adapter = new FoundryCommandTransportAdapter({
    runtime,
    authorityService
  });

  let handlerInvoked = false;
  adapter.registerInboundHandler(async () => {
    handlerInvoked = true;
    return ok({
      commandId: "cmd_0123456789abcdef0123456789abcdef" as any,
      status: "executed",
      transportTimestamp: Date.now()
    });
  });

  // Malicious packet sent over socket claiming senderUserId is "gm-primary"
  const spoofedPacket = {
    protocol: "dm-command-v1",
    kind: "DM_CMD_REQUEST",
    correlationId: "corr_spoof_1",
    senderUserId: "gm-primary", // Attacker trying to spoof GM authority over socket
    command: {
      contractVersion: 1,
      commandId: "cmd_0123456789abcdef0123456789abcdef",
      type: "domain:destroy",
      payload: {},
      issuedAtReal: Date.now()
    }
  };

  socket.simulateInbound(spoofedPacket);

  // Allow async handler to run
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(
    handlerInvoked,
    false,
    "Inbound handler must NOT be invoked when remote socket packet claims to be the local Primary Authority"
  );

  // Native socket has no listener for command transport, so no response is emitted on broadcast channel
  assert.equal(socket.emitted.length, 0);

  adapter.destroy();
});

