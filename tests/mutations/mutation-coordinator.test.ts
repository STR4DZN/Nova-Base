import assert from "node:assert/strict";
import test from "node:test";
import { LockManager } from "../../src/mutations/lock-manager.js";
import {
  MutationCoordinator,
  type MutationDefinition
} from "../../src/mutations/mutation-coordinator.js";
import { createMutationPlan } from "../../src/mutations/plans/plan-contract.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import type { AuthenticatedCommandContext } from "../../src/commands/authenticated-command-context.js";
import { ok, err } from "../../src/core/contracts/result.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";

function createContext<TPayload>(
  command: DomainCommand<TPayload>,
  senderUserId: string = "player-1"
): AuthenticatedCommandContext<TPayload> {
  return {
    command,
    senderUserId,
    authorityUserId: "gm-1",
    authorityEpoch: 1,
    receivedAtReal: Date.now(),
    source: { type: "user" }
  };
}

test("MutationCoordinator acquires locks BEFORE executing fresh read", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  const commandId = createCommandId();
  const command: DomainCommand<{ name: string }> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId,
    type: "domain:update-name",
    payload: { name: "New Name" },
    issuedAtReal: Date.now()
  };

  let wasLockedDuringFreshRead = false;

  const definition: MutationDefinition<{ name: string }, { success: boolean }, { revision: number; name: string }> = {
    getLockKeys: () => ["domain:test-1"],
    freshRead: async () => {
      wasLockedDuringFreshRead = lockManager.isLocked("domain:test-1");
      return ok({ revision: 1, name: "Old Name" });
    },
    buildPlan: async (ctx, _fresh) => {
      return ok(
        createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: ["domain:test-1"],
          writeSet: [{ targetRef: "domain:test-1", operationType: "update", payload: ctx.command.payload }]
        })
      );
    },
    commit: async (_plan, fresh) => {
      return ok({
        result: { success: true },
        resultingRevisions: { "domain:test-1": fresh.revision + 1 },
        changed: true
      });
    }
  };

  const receiptRes = await coordinator.execute(createContext(command), definition);

  assert.equal(receiptRes.ok, true);
  if (receiptRes.ok) {
    assert.equal(receiptRes.value.status, "executed");
    assert.equal(receiptRes.value.changed, true);
    assert.deepEqual(receiptRes.value.resultingRevisions, { "domain:test-1": 2 });
  }

  // PROOF: fresh read was executed while lock was held
  assert.equal(wasLockedDuringFreshRead, true);

  // Lock must be released afterwards
  assert.equal(lockManager.isLocked("domain:test-1"), false);
});

test("MutationCoordinator rejects stale expectedRevision with DM_REVISION_CONFLICT", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  const commandId = createCommandId();
  const command: DomainCommand<{ name: string }> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId,
    type: "domain:update",
    payload: { name: "Updated" },
    expectedRevision: 1, // Client expects revision 1
    issuedAtReal: Date.now()
  };

  let commitCalled = false;

  const definition: MutationDefinition = {
    getLockKeys: () => ["domain:stale"],
    freshRead: async () => {
      // Repository fresh read reveals revision has already moved to 2
      return ok({ revision: 2 });
    },
    buildPlan: async (ctx) => {
      return ok(createMutationPlan({ commandId: ctx.command.commandId, lockKeys: [], writeSet: [] }));
    },
    commit: async () => {
      commitCalled = true;
      return ok({ result: {}, resultingRevisions: {}, changed: true });
    }
  };

  const receiptRes = await coordinator.execute(createContext(command), definition);

  assert.equal(receiptRes.ok, true);
  if (receiptRes.ok) {
    assert.equal(receiptRes.value.status, "rejected");
    assert.equal(receiptRes.value.error?.code, "DM_REVISION_CONFLICT");
    assert.equal(receiptRes.value.error?.category, "conflict");
  }

  assert.equal(commitCalled, false);
  assert.equal(lockManager.isLocked("domain:stale"), false);
});

test("MutationCoordinator blocks commit when plan has blockers", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  const commandId = createCommandId();
  const command: DomainCommand<{ name: string }> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId,
    type: "domain:blocked-op",
    payload: { name: "Target" },
    issuedAtReal: Date.now()
  };

  let commitCalled = false;

  const definition: MutationDefinition = {
    getLockKeys: () => ["domain:target"],
    freshRead: async () => ok({ revision: 1 }),
    buildPlan: async (ctx) => {
      return ok(
        createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: ["domain:target"],
          writeSet: [],
          blockers: ["Hierarchy cycle detected: cannot make parent a descendant"]
        })
      );
    },
    commit: async () => {
      commitCalled = true;
      return ok({ result: {}, resultingRevisions: {}, changed: true });
    }
  };

  const receiptRes = await coordinator.execute(createContext(command), definition);

  assert.equal(receiptRes.ok, true);
  if (receiptRes.ok) {
    assert.equal(receiptRes.value.status, "rejected");
    assert.equal(receiptRes.value.error?.code, "DM_PLAN_BLOCKED");
    assert.equal(receiptRes.value.error?.category, "validation");
  }

  assert.equal(commitCalled, false);
  assert.equal(lockManager.isLocked("domain:target"), false);
});

test("MutationCoordinator invokes compensation and reports DM_COMPENSATION_FAILED if compensation fails", async () => {
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });

  const commandId = createCommandId();
  const command: DomainCommand<unknown> = {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId,
    type: "domain:failing-commit",
    payload: {},
    issuedAtReal: Date.now()
  };

  let compensationAttempted = false;

  const definition: MutationDefinition = {
    getLockKeys: () => ["domain:fail-keys"],
    freshRead: async () => ok({ revision: 1 }),
    buildPlan: async (ctx) => ok(createMutationPlan({ commandId: ctx.command.commandId, lockKeys: [], writeSet: [] })),
    commit: async () => {
      return err(
        createPublicError({
          code: "DM_STORAGE_WRITE_FAILED",
          category: "provider",
          message: "Database write error"
        })
      );
    },
    compensate: async () => {
      compensationAttempted = true;
      // Simulate compensation failure
      return err(
        createPublicError({
          code: "DM_COMPENSATION_ROLLBACK_ERROR",
          category: "recovery",
          message: "Unable to rollback partial changes"
        })
      );
    }
  };

  const receiptRes = await coordinator.execute(createContext(command), definition);

  assert.equal(receiptRes.ok, true);
  if (receiptRes.ok) {
    assert.equal(receiptRes.value.status, "rejected");
    assert.equal(receiptRes.value.error?.code, "DM_COMPENSATION_FAILED");
    assert.equal(receiptRes.value.error?.category, "recovery");
  }

  assert.equal(compensationAttempted, true);
  assert.equal(lockManager.isLocked("domain:fail-keys"), false);
});
