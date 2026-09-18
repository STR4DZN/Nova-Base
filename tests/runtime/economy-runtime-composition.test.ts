import test from "node:test";
import assert from "node:assert/strict";
import { composeDomainManagerRuntime } from "../../src/bootstrap/domain-manager-runtime.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import type { IdentifiedJournalEntryDocumentLike } from "../../src/storage/repositories/domain-repository.js";
import { EconomyApplication } from "../../src/ui/domain-patterns/economy/economy-app.js";

const defaultRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Economy Runtime Test", description: "Testing" },
    classification: { kind: "base", scale: "small", tags: ["economy"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: {
      enabled: ["domain-manager:domain", "domain-manager:economy"],
      config: {}
    }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: "user-1", archivedAt: null, source: { type: "manual", ref: null } }
};

function createMockDoc(id: string, name: string, record = defaultRecord): IdentifiedJournalEntryDocumentLike {
  let currentFlags = { "domain-manager": JSON.parse(JSON.stringify(record)) };
  let currentOwnership: Record<string, number> = { default: 3, "user-1": 3 };
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return name; },
    get flags() { return currentFlags; },
    get ownership() { return currentOwnership; },
    update: async (data: Record<string, unknown>) => {
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": payload };
      }
    }
  };
}

function createMockAuthority() {
  const users = [{ id: "user-1", isGM: true, active: true }];
  return {
    service: {
      isCurrentUser: () => true,
      getStatus: () => ({
        authorityUserId: "user-1",
        isPrimaryAuthority: true,
        authorityEpoch: 1,
        mode: "elected",
        available: true
      }),
      resolve: async () => ({
        authorityUserId: "user-1",
        isPrimaryAuthority: true,
        authorityEpoch: 1,
        mode: "elected",
        available: true
      }),
      getUsers: () => users,
      getCurrentUserId: () => "user-1"
    }
  };
}

function createMockTransport() {
  return {
    send: async () => ({ ok: true }),
    registerInboundHandler: () => () => {},
    onReceive: () => () => {},
    isAvailable: () => true,
    destroy: () => {}
  };
}

test("G4.10: composeDomainManagerRuntime wires economy service, stores, and commands into runtime", async () => {
  const docA = createMockDoc("dom-econ-rt-1", "Domain Economy Alpha");
  const docB = createMockDoc("dom-econ-rt-2", "Domain Economy Beta");
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  byKey.set(docA.id, docA);
  byKey.set(docA.uuid, docA);
  byKey.set(docB.id, docB);
  byKey.set(docB.uuid, docB);

  const domainStore = {
    get: (id: string) => byKey.get(id),
    list: () => [docA, docB],
    create: async () => { throw new Error("not used"); }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: domainStore as any,
    authority: createMockAuthority() as any,
    transport: createMockTransport() as any
  });

  try {
    // 1. Verify economy properties are exposed on runtime
    assert.ok(runtime.economy, "runtime.economy must be exposed");
    assert.equal(typeof runtime.economy.createAccount, "function");
    assert.equal(typeof runtime.economy.closeAccount, "function");
    assert.equal(typeof runtime.economy.commitAdjust, "function");
    assert.equal(typeof runtime.economy.commitTransfer, "function");
    assert.equal(typeof runtime.economy.commitConvert, "function");
    assert.equal(typeof runtime.economy.reserve, "function");
    assert.equal(typeof runtime.economy.consumeReservation, "function");
    assert.equal(typeof runtime.economy.releaseReservation, "function");
    assert.equal(typeof runtime.economy.reverseLedgerEntry, "function");
    assert.equal(typeof runtime.economy.getAccount, "function");
    assert.equal(typeof runtime.economy.getAccountAvailability, "function");

    assert.ok(runtime.resourceRegistry, "runtime.resourceRegistry must be exposed");
    assert.ok(runtime.resourceRegistry.has("domain-manager:treasury"));
    assert.ok(runtime.resourceRegistry.has("domain-manager:supplies"));
    assert.ok(runtime.resourceRegistry.has("domain-manager:materials"));

    assert.ok(runtime.ledgerStore, "runtime.ledgerStore must be exposed");
    assert.ok(runtime.reservationStore, "runtime.reservationStore must be exposed");

    // 2. Verify all Economy commands are registered in CommandRegistry
    const expectedCommands = [
      "economy:adjust",
      "economy:transfer",
      "economy:convert",
      "economy:reserve",
      "economy:consume-reservation",
      "economy:release-reservation",
      "economy:create-account",
      "economy:close-account",
      "economy:reversal"
    ];

    for (const cmdType of expectedCommands) {
      assert.ok(
        runtime.registry.has(cmdType),
        `Command '${cmdType}' must be registered in CommandRegistry`
      );
    }

    // 3. Verify end-to-end command execution via CommandBus
    // Create an account on Domain Alpha
    const createCmd: DomainCommand = {
      contractVersion: COMMAND_CONTRACT_VERSION_V1,
      commandId: createCommandId(),
      type: "economy:create-account",
      payload: {
        domainUuid: docA.uuid,
        resourceId: "domain-manager:treasury",
        initialBalanceMinor: 5000,
        reason: "Initial Treasury"
      },
      issuedAtReal: Date.now()
    };

    const createReceipt = await runtime.commandBus.execute(createCmd);
    assert.equal(createReceipt.ok, true, `Account creation failed: ${createReceipt.ok ? "" : createReceipt.error.message}`);
    if (createReceipt.ok) {
      assert.equal(createReceipt.value.status, "executed");
    }

    // Create an account on Domain Beta
    await runtime.economy.createAccount({
      domainUuid: docB.uuid,
      resourceId: "domain-manager:treasury",
      initialBalanceMinor: 1000
    });

    // Transfer from A to B via CommandBus
    const transferCmd: DomainCommand = {
      contractVersion: COMMAND_CONTRACT_VERSION_V1,
      commandId: createCommandId(),
      type: "economy:transfer",
      payload: {
        sourceDomainUuid: docA.uuid,
        targetDomainUuid: docB.uuid,
        resourceId: "domain-manager:treasury",
        amountMinor: 2000,
        reason: "Runtime transfer test"
      },
      issuedAtReal: Date.now()
    };

    const transferReceipt = await runtime.commandBus.execute(transferCmd);
    assert.equal(transferReceipt.ok, true, `Transfer failed: ${transferReceipt.ok ? "" : transferReceipt.error.message}`);
    if (transferReceipt.ok) {
      assert.equal(transferReceipt.value.status, "executed");
    }

    // Verify balances through runtime.economy
    const accA = (await runtime.economy.getAccount(docA.uuid, "domain-manager:treasury")).value!;
    const accB = (await runtime.economy.getAccount(docB.uuid, "domain-manager:treasury")).value!;

    assert.equal(accA.mode === "native" ? accA.balanceMinor : null, 3000);
    assert.equal(accB.mode === "native" ? accB.balanceMinor : null, 3000);

    // 4. Verify EconomyApplication instantiates with runtime
    const app = new EconomyApplication({
      domainUuid: docA.uuid,
      commandBus: runtime.commandBus,
      economyService: runtime.economy,
      domains: runtime.domains,
      viewer: { isGM: true, userId: "user-1" }
    });
    assert.ok(app);
    assert.ok(app.controller);
  } finally {
    runtime.destroy();
  }
});
