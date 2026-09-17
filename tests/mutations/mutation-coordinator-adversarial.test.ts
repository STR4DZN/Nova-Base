import test from "node:test";
import assert from "node:assert/strict";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { createMutationPlan } from "../../src/mutations/plans/plan-contract.js";
import type { AuthenticatedCommandContext } from "../../src/commands/authenticated-command-context.js";
import type { DomainCommand } from "../../src/commands/command-envelope.js";
import { ok, err } from "../../src/core/contracts/result.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";

function createContext(command: Partial<DomainCommand>): AuthenticatedCommandContext {
  const fullCommand: DomainCommand = {
    contractVersion: 1,
    commandId: "cmd_0123456789abcdef0123456789abcdef" as any,
    type: "test:mutate",
    payload: {},
    issuedAtReal: Date.now(),
    ...command
  };

  return {
    command: fullCommand,
    senderUserId: "user-1",
    authorityUserId: "gm-1",
    authorityEpoch: 1,
    receivedAtReal: Date.now(),
    source: { type: "user" }
  };
}

test("Adversarial: MutationCoordinator fails closed when expectedRevisions targets a missing entity", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  const context = createContext({
    // Client expects entity "domain:missing" to be at revision 2
    expectedRevisions: {
      "domain:missing": 2
    }
  });

  const receiptResult = await coordinator.execute(context, {
    getLockKeys: () => ["domain:missing"],
    freshRead: async () => {
      // Entity does not exist in repository / fresh state (entityRevisions empty)
      return ok({
        revision: 5,
        entityRevisions: {}
      });
    },
    buildPlan: async () => {
      return ok(createMutationPlan({
        planId: "plan_1",
        commandId: context.command.commandId,
        lockKeys: ["domain:missing"],
        writeSet: [],
        summary: "should never reach commit"
      }));
    },
    commit: async () => {
      assert.fail("Commit must NOT be called when an expected entity revision is missing");
    }
  });

  assert.equal(receiptResult.ok, true);
  const receipt = receiptResult.value;
  assert.equal(receipt.status, "rejected");
  assert.equal(receipt.changed, false);
  assert.equal(receipt.error?.code, "DM_REVISION_CONFLICT");
});

test("Adversarial: MutationCoordinator fails closed when expectedRevision is set but freshState has no revision", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  const context = createContext({
    expectedRevision: 3
  });

  const receiptResult = await coordinator.execute(context, {
    getLockKeys: () => ["domain:root"],
    freshRead: async () => {
      // Missing repository revision entirely
      return ok({
        revision: undefined
      });
    },
    buildPlan: async () => {
      return ok(createMutationPlan({
        planId: "plan_2",
        commandId: context.command.commandId,
        lockKeys: ["domain:root"],
        writeSet: [],
        summary: "should never reach commit"
      }));
    },
    commit: async () => {
      assert.fail("Commit must NOT be called when revision is missing");
    }
  });

  assert.equal(receiptResult.ok, true);
  const receipt = receiptResult.value;
  assert.equal(receipt.status, "rejected");
  assert.equal(receipt.changed, false);
  assert.equal(receipt.error?.code, "DM_REVISION_CONFLICT");
});

test("Adversarial: MutationCoordinator handles unexpected exceptions in commit gracefully and triggers compensation", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  const context = createContext({});
  let compensationCalled = false;

  const receiptResult = await coordinator.execute(context, {
    getLockKeys: () => ["domain:key1"],
    freshRead: async () => ok({ revision: 1 }),
    buildPlan: async () => ok(createMutationPlan({
      planId: "plan_3",
      commandId: context.command.commandId,
      lockKeys: ["domain:key1"],
      writeSet: [],
      summary: "throw in commit"
    })),
    commit: async () => {
      throw new Error("Simulated sudden disk IO failure during write");
    },
    compensate: async (_plan, _state, _err) => {
      compensationCalled = true;
      return ok(undefined);
    }
  });

  assert.equal(receiptResult.ok, true);
  const receipt = receiptResult.value;
  assert.equal(receipt.status, "rejected");
  assert.equal(receipt.changed, false);
  assert.equal(compensationCalled, true, "Compensate should be called when commit throws an exception");
  // Locks must be released
  assert.equal(lockManager.isLocked("domain:key1"), false, "Locks must be released after commit exception");
});

test("G2-AUD-012: MutationCoordinator does NOT automatically compensate when commit outcome is unknown", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  const context = createContext({});
  let compensationCalled = false;

  // Simulate provider that writes but network times out resulting in uncertain/unknown outcome
  const receiptResult = await coordinator.execute(context, {
    getLockKeys: () => ["domain:key1"],
    freshRead: async () => ok({ revision: 1 }),
    buildPlan: async () =>
      ok(
        createMutationPlan({
          planId: "plan_unknown",
          commandId: context.command.commandId,
          lockKeys: ["domain:key1"],
          writeSet: [],
          summary: "unknown outcome"
        })
      ),
    commit: async () => {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_TIMEOUT",
          category: "timeout",
          message: "Database write timeout - write may or may not have succeeded",
          details: { outcome: "unknown" }
        })
      );
    },
    compensate: async (_plan, _state, _err) => {
      compensationCalled = true;
      return ok(undefined);
    }
  });

  assert.equal(receiptResult.ok, true);
  const receipt = receiptResult.value;
  assert.equal(receipt.status, "rejected");
  assert.equal(receipt.changed, false);
  assert.equal(
    compensationCalled,
    false,
    "Compensator must NOT be called automatically when commit outcome is unknown"
  );
  assert.equal(receipt.error?.code, "DM_RECOVERY_UNKNOWN_OUTCOME");
  assert.equal(receipt.error?.category, "recovery");
  assert.equal(lockManager.isLocked("domain:key1"), false, "Locks must be released");
});

