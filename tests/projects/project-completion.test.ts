import test from "node:test";
import assert from "node:assert/strict";
import {
  type ProjectDefinition,
  type ProjectInstance,
  validateProjectInstance
} from "../../src/projects/types/project-types.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { PROJECTS_CAPABILITY_ID } from "../../src/projects/project-data.js";
import {
  evaluateProjectCompletionPlan,
  commitProjectCompletion
} from "../../src/projects/plans/project-completion-plan-service.js";
import { ok, err } from "../../src/core/contracts/result.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";
import type { ChildReceipt } from "../../src/projects/plans/project-plan-types.js";

function createTestDomain(enabledCapabilities: string[] = [PROJECTS_CAPABILITY_ID]): DomainRecord {
  return {
    schemaVersion: 1,
    definition: {
      identity: {
        id: "dom-test-1",
        name: "Test Settlement"
      },
      archetype: "settlement",
      capabilities: {
        enabled: enabledCapabilities,
        configurations: {}
      }
    },
    state: {
      lifecycle: "active",
      status: "normal"
    },
    history: {
      createdAt: 1000,
      updatedAt: 1000
    }
  } as unknown as DomainRecord;
}

function createTestDefinition(overrides: Partial<ProjectDefinition> = {}): ProjectDefinition {
  return {
    id: "domain-manager:construction",
    version: 1,
    label: "Basic Construction",
    category: "construction",
    tags: ["construction", "facility"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    requirements: [],
    costs: [],
    rewards: [
      {
        type: "facility",
        targetRef: "facility-granary",
        label: "Construct Granary Facility"
      },
      {
        type: "resource",
        targetRef: "domain-manager:treasury",
        value: 500,
        label: "Construction salvage"
      }
    ],
    autoComplete: false,
    ...overrides
  };
}

function createTestReadyProject(overrides: Partial<ProjectInstance> = {}): ProjectInstance {
  const base: ProjectInstance = {
    id: "proj-inst-100",
    domainUuid: "dom-test-1",
    definitionId: "domain-manager:construction",
    name: "Granary Construction Project",
    schemaVersion: 1,
    revision: 5,
    lifecycle: "active",
    workRequired: 100,
    workCompleted: 100,
    clampProgress: true,
    tags: ["construction"],
    createdAt: 1000,
    updatedAt: 2000,
    completedAt: null,
    blockedReason: null,
    entries: []
  };

  const merged = { ...base, ...overrides };
  const validated = validateProjectInstance(merged);
  if (!validated.ok) {
    throw new Error(`Invalid test fixture: ${validated.error.message}`);
  }
  return validated.value;
}

test("G5.5: evaluateProjectCompletionPlan produces satisfied plan for active project with completed goal", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestReadyProject();

  const plan = evaluateProjectCompletionPlan({
    project,
    definition,
    domain
  });

  assert.equal(plan.isSatisfied, true);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.expectedRevision, 5);
  assert.equal(plan.workCompleted, 100);
  assert.equal(plan.workRequired, 100);
  assert.equal(plan.sideEffects.length, 2);
  assert.equal(plan.sideEffects[0].type, "facility");
  assert.equal(plan.sideEffects[1].type, "resource");
});

test("G5.5: evaluateProjectCompletionPlan blocks completion if work is incomplete (DEC-086, DEC-089)", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestReadyProject({ workCompleted: 85, workRequired: 100 });

  const plan = evaluateProjectCompletionPlan({
    project,
    definition,
    domain
  });

  assert.equal(plan.isSatisfied, false);
  assert.ok(plan.blockers.some((b) => b.code === "DM_PROJECT_INCOMPLETE"));
});

test("G5.5: evaluateProjectCompletionPlan blocks completion on invalid lifecycle states", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();

  // 1. Already completed
  const completedProj = createTestReadyProject({ lifecycle: "completed" });
  const p1 = evaluateProjectCompletionPlan({ project: completedProj, definition, domain });
  assert.equal(p1.isSatisfied, false);
  assert.ok(p1.blockers.some((b) => b.code === "DM_PROJECT_ALREADY_COMPLETED"));

  // 2. Paused
  const pausedProj = createTestReadyProject({ lifecycle: "paused" });
  const p2 = evaluateProjectCompletionPlan({ project: pausedProj, definition, domain });
  assert.equal(p2.isSatisfied, false);
  assert.ok(p2.blockers.some((b) => b.code === "DM_PROJECT_PAUSED"));

  // 3. Blocked
  const blockedProj = createTestReadyProject({ lifecycle: "blocked", blockedReason: "Inspection failed" });
  const p3 = evaluateProjectCompletionPlan({ project: blockedProj, definition, domain });
  assert.equal(p3.isSatisfied, false);
  assert.ok(p3.blockers.some((b) => b.code === "DM_PROJECT_BLOCKED"));

  // 4. Terminal (cancelled)
  const cancelledProj = createTestReadyProject({ lifecycle: "cancelled" });
  const p4 = evaluateProjectCompletionPlan({ project: cancelledProj, definition, domain });
  assert.equal(p4.isSatisfied, false);
  assert.ok(p4.blockers.some((b) => b.code === "DM_PROJECT_TERMINAL"));

  // 5. Inactive (draft)
  const draftProj = createTestReadyProject({ lifecycle: "draft" });
  const p5 = evaluateProjectCompletionPlan({ project: draftProj, definition, domain });
  assert.equal(p5.isSatisfied, false);
  assert.ok(p5.blockers.some((b) => b.code === "DM_PROJECT_NOT_ACTIVE"));
});

test("G5.5: evaluateProjectCompletionPlan evaluates category 'completion' requirements", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition({
    requirements: [
      {
        id: "req-inspector-visit",
        category: "completion",
        type: "custom",
        label: "Final Building Inspection"
      }
    ]
  });
  const project = createTestReadyProject();

  // 1. Requirement missing in parameters
  const planUnsatisfied = evaluateProjectCompletionPlan({
    project,
    definition,
    domain,
    parameters: {}
  });
  assert.equal(planUnsatisfied.isSatisfied, false);
  assert.ok(planUnsatisfied.blockers.some((b) => b.code === "DM_PROJECT_REQUIREMENT_UNSATISFIED"));

  // 2. Requirement provided and satisfied
  const planSatisfied = evaluateProjectCompletionPlan({
    project,
    definition,
    domain,
    parameters: {
      customRequirements: { "req-inspector-visit": true }
    }
  });
  assert.equal(planSatisfied.isSatisfied, true);
  assert.equal(planSatisfied.blockers.length, 0);
});

test("G5.5: commitProjectCompletion transitions project to completed, sets completedAt, and generates ProjectReceipt", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestReadyProject({ revision: 3 });

  const plan = evaluateProjectCompletionPlan({
    project,
    definition,
    domain
  });

  const commitRes = commitProjectCompletion(plan, project, {
    note: "All construction milestones achieved"
  });

  assert.equal(commitRes.ok, true);
  if (!commitRes.ok) return;

  const { updatedProject, receipt, childReceipts, partialFailure } = commitRes.value;

  // 1. Updated Project Instance
  assert.equal(updatedProject.lifecycle, "completed");
  assert.equal(updatedProject.revision, 4);
  assert.ok(typeof updatedProject.completedAt === "number");
  assert.equal(updatedProject.entries?.length, 1);
  assert.equal(updatedProject.entries![0].reasonCode, "PROJECT_COMPLETED");
  assert.equal(updatedProject.entries![0].unitsDelta, 0);

  // 2. Parent Project Receipt
  assert.equal(receipt.action, "complete");
  assert.equal(receipt.lifecycleBefore, "active");
  assert.equal(receipt.lifecycleAfter, "completed");
  assert.equal(receipt.revisionBefore, 3);
  assert.equal(receipt.revisionAfter, 4);
  assert.equal(receipt.childReceiptIds?.length, 2);

  // 3. Coordinated Child Receipts
  assert.equal(childReceipts.length, 2);
  assert.equal(partialFailure, false);
  assert.equal(childReceipts[0].subsystem, "facility");
  assert.equal(childReceipts[0].success, true);
  assert.equal(childReceipts[1].subsystem, "economy");
  assert.equal(childReceipts[1].success, true);
});

test("G5.5: commitProjectCompletion executes coordinated side effect handlers (DEC-096: Facility creation)", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestReadyProject();

  const plan = evaluateProjectCompletionPlan({
    project,
    definition,
    domain
  });

  let facilityCreated = false;
  let resourceGranted = false;

  const commitRes = commitProjectCompletion(plan, project, {
    sideEffectHandlers: {
      facility: (effect) => {
        facilityCreated = true;
        const child: ChildReceipt = {
          childReceiptId: "rep-facility-granary-1",
          subsystem: "facility",
          action: "create_facility",
          targetRef: effect.targetRef,
          payload: { level: 1, operational: true },
          success: true,
          appliedAt: Date.now()
        };
        return ok(child);
      },
      resource: (effect) => {
        resourceGranted = true;
        const child: ChildReceipt = {
          childReceiptId: "rep-econ-salvage-1",
          subsystem: "economy",
          action: "credit_resource",
          targetRef: effect.targetRef,
          payload: { amountMinor: effect.value },
          success: true,
          appliedAt: Date.now()
        };
        return child;
      }
    }
  });

  assert.equal(commitRes.ok, true);
  if (!commitRes.ok) return;

  assert.equal(facilityCreated, true);
  assert.equal(resourceGranted, true);
  assert.equal(commitRes.value.partialFailure, false);
  assert.equal(commitRes.value.childReceipts.length, 2);
  assert.equal(commitRes.value.childReceipts[0].action, "create_facility");
  assert.equal(commitRes.value.childReceipts[1].action, "credit_resource");
});

test("G5.5: commitProjectCompletion records explicit partial failure when a side effect fails (Master Spec §15.4)", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestReadyProject();

  const plan = evaluateProjectCompletionPlan({
    project,
    definition,
    domain
  });

  const commitRes = commitProjectCompletion(plan, project, {
    sideEffectHandlers: {
      facility: () => {
        return err(
          createPublicError({
            code: "DM_FACILITY_REGISTRY_ERROR",
            category: "storage",
            message: "Failed to persist facility entity due to storage conflict"
          })
        );
      },
      resource: (effect) => {
        return {
          childReceiptId: "rep-econ-ok",
          subsystem: "economy",
          action: "credit_resource",
          payload: effect.value,
          success: true,
          appliedAt: Date.now()
        };
      }
    }
  });

  assert.equal(commitRes.ok, true);
  if (!commitRes.ok) return;

  const { updatedProject, childReceipts, partialFailure } = commitRes.value;

  // Project still successfully transitions to completed
  assert.equal(updatedProject.lifecycle, "completed");

  // Partial failure is explicitly recorded, not hidden
  assert.equal(partialFailure, true);
  assert.equal(childReceipts.length, 2);

  const failedChild = childReceipts.find((c) => c.subsystem === "facility");
  assert.ok(failedChild);
  assert.equal(failedChild.success, false);
  assert.ok(failedChild.error?.includes("storage conflict"));

  const successChild = childReceipts.find((c) => c.subsystem === "economy");
  assert.ok(successChild);
  assert.equal(successChild.success, true);
});

test("G5.5: commitProjectCompletion rejects execution if plan is blocked or revision has changed", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestReadyProject({ revision: 8 });

  // 1. Blocked plan cannot commit
  const blockedPlan = evaluateProjectCompletionPlan({
    project: { ...project, workCompleted: 50 },
    definition,
    domain
  });
  assert.equal(blockedPlan.isSatisfied, false);

  const blockedCommitRes = commitProjectCompletion(blockedPlan, project);
  assert.equal(blockedCommitRes.ok, false);
  if (!blockedCommitRes.ok) {
    assert.equal(blockedCommitRes.error.code, "DM_PROJECT_COMPLETION_BLOCKED");
  }

  // 2. Mismatched revision at commit
  const validPlan = evaluateProjectCompletionPlan({
    project,
    definition,
    domain
  });
  assert.equal(validPlan.isSatisfied, true);

  const mutatedProject = { ...project, revision: 9 };
  const staleCommitRes = commitProjectCompletion(validPlan, mutatedProject);
  assert.equal(staleCommitRes.ok, false);
  if (!staleCommitRes.ok) {
    assert.equal(staleCommitRes.error.code, "DM_PROJECT_REVISION_MISMATCH");
  }
});
