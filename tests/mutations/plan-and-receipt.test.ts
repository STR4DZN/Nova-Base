import assert from "node:assert/strict";
import test from "node:test";
import { createCommandId } from "../../src/commands/command-envelope.js";
import {
  createMutationPlan,
  sanitizePlanForPublic,
  isPlanMateriallyChanged
} from "../../src/mutations/plans/plan-contract.js";
import {
  createMutationReceipt,
  sanitizeReceiptForPublic
} from "../../src/mutations/receipt-contract.js";

test("createMutationPlan enforces immutability and executable status based on blockers", () => {
  const commandId = createCommandId();

  // Executable plan without blockers
  const plan = createMutationPlan({
    commandId,
    lockKeys: ["domain:alpha"],
    writeSet: [
      { targetRef: "domain:alpha", operationType: "update", payload: { name: "Alpha 2" } }
    ],
    expectedRevisions: { "domain:alpha": 1 },
    warnings: ["Minor warning: population low"]
  });

  assert.equal(plan.isExecutable, true);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.warnings.length, 1);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.writeSet), true);
  assert.ok(plan.fingerprint.startsWith("fp_"));

  // Blocked plan with blockers
  const blockedPlan = createMutationPlan({
    commandId,
    lockKeys: ["domain:beta"],
    writeSet: [],
    blockers: ["Insufficient funds to proceed with project"]
  });

  assert.equal(blockedPlan.isExecutable, false);
  assert.equal(blockedPlan.blockers.length, 1);

  // Sanitizing plan hides internal writeSet
  const publicPreview = sanitizePlanForPublic(plan);
  assert.equal(publicPreview.isExecutable, true);
  assert.equal((publicPreview as Record<string, unknown>).writeSet, undefined);
});

test("isPlanMateriallyChanged detects drift between preview and confirm plans", () => {
  const commandId = createCommandId();

  const preview = createMutationPlan({
    commandId,
    lockKeys: ["domain:1"],
    writeSet: [{ targetRef: "domain:1", operationType: "update" }],
    expectedRevisions: { "domain:1": 2 }
  });

  const exactConfirm = createMutationPlan({
    commandId,
    lockKeys: ["domain:1"],
    writeSet: [{ targetRef: "domain:1", operationType: "update" }],
    expectedRevisions: { "domain:1": 2 }
  });

  // Identical plans: no material drift
  assert.equal(isPlanMateriallyChanged(preview, exactConfirm), false);

  // Confirm plan has newly acquired blocker
  const blockedConfirm = createMutationPlan({
    commandId,
    lockKeys: ["domain:1"],
    writeSet: [{ targetRef: "domain:1", operationType: "update" }],
    expectedRevisions: { "domain:1": 2 },
    blockers: ["Resource depleted by another player in the interim"]
  });
  assert.equal(isPlanMateriallyChanged(preview, blockedConfirm), true);

  // Confirm plan target revision drifted (concurrent modification)
  const staleConfirm = createMutationPlan({
    commandId,
    lockKeys: ["domain:1"],
    writeSet: [{ targetRef: "domain:1", operationType: "update" }],
    expectedRevisions: { "domain:1": 3 }
  });
  assert.equal(isPlanMateriallyChanged(preview, staleConfirm), true);
});

test("createMutationReceipt creates immutable receipts and sanitizes for public view", () => {
  const commandId = createCommandId();

  const receipt = createMutationReceipt({
    commandId,
    transactionId: "tx_internal_123",
    status: "executed",
    changed: true,
    resultingRevisions: { "domain:1": 3 },
    result: { success: true },
    summary: "Domain updated successfully"
  });

  assert.equal(receipt.status, "executed");
  assert.equal(receipt.changed, true);
  assert.equal(receipt.transactionId, "tx_internal_123");
  assert.equal(Object.isFrozen(receipt), true);

  // No-op receipt
  const noOpReceipt = createMutationReceipt({
    commandId,
    status: "no_op",
    changed: false,
    resultingRevisions: { "domain:1": 3 },
    summary: "No fields modified"
  });
  assert.equal(noOpReceipt.changed, false);
  assert.equal(noOpReceipt.status, "no_op");

  // Public sanitization strips transactionId
  const publicReceipt = sanitizeReceiptForPublic(receipt);
  assert.equal(publicReceipt.commandId, commandId);
  assert.equal((publicReceipt as Record<string, unknown>).transactionId, undefined);
});
