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
  evaluateProjectAdvancePlan,
  commitProjectAdvance,
  blockProject,
  unblockProject,
  pauseProject,
  resumeProject,
  cancelProject,
  evaluateProjectAdvanceBatchPlan,
  commitProjectAdvanceBatch
} from "../../src/projects/plans/project-advance-plan-service.js";
import { StandardProgressResolver } from "../../src/projects/resolvers/standard-progress-resolver.js";

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
    id: "domain-manager:test-proj",
    version: 1,
    label: "Test Project",
    category: "construction",
    tags: ["test"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    requirements: [],
    costs: [],
    rewards: [],
    autoComplete: false,
    ...overrides
  };
}

function createTestActiveProject(overrides: Partial<ProjectInstance> = {}): ProjectInstance {
  const base: ProjectInstance = {
    id: "proj-inst-1",
    domainUuid: "dom-test-1",
    definitionId: "domain-manager:test-proj",
    name: "Active Test Project",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "active",
    workRequired: 100,
    workCompleted: 10,
    clampProgress: true,
    tags: ["test"],
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    blockedReason: null,
    entries: []
  };

  const merged = { ...base, ...overrides };
  const validated = validateProjectInstance(merged);
  if (!validated.ok) {
    throw new Error(`Invalid test project fixture: ${validated.error.message}`);
  }
  return validated.value;
}

test("G5.4: evaluateProjectAdvancePlan produces a satisfied plan for active project with valid delta", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestActiveProject({ workCompleted: 20 });

  const plan = evaluateProjectAdvancePlan({
    project,
    definition,
    domain,
    proposedDelta: 15
  });

  assert.equal(plan.isSatisfied, true);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.proposedDelta, 15);
  assert.equal(plan.wouldComplete, false);
  assert.equal(plan.expectedRevision, 1);
});

test("G5.4: commitProjectAdvance increments progress, updates revision, appends ProjectEntry, and returns ProjectReceipt", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestActiveProject({ workCompleted: 20, revision: 1 });

  const plan = evaluateProjectAdvancePlan({
    project,
    definition,
    domain,
    proposedDelta: 25
  });

  const commitRes = commitProjectAdvance(plan, project, {
    sourceKind: "command",
    reasonCode: "MANUAL_WORK",
    note: "Labor shift completed"
  });

  assert.equal(commitRes.ok, true);
  if (!commitRes.ok) return;

  const { updatedProject, receipt } = commitRes.value;

  // Project state updates
  assert.equal(updatedProject.workCompleted, 45);
  assert.equal(updatedProject.revision, 2);
  assert.equal(updatedProject.lifecycle, "active");
  assert.equal(updatedProject.entries?.length, 1);

  const entry = updatedProject.entries![0];
  assert.equal(entry.unitsDelta, 25);
  assert.equal(entry.unitsBefore, 20);
  assert.equal(entry.unitsAfter, 45);
  assert.equal(entry.reasonCode, "MANUAL_WORK");

  // Receipt verification
  assert.equal(receipt.action, "advance");
  assert.equal(receipt.revisionBefore, 1);
  assert.equal(receipt.revisionAfter, 2);
  assert.equal(receipt.workCompletedBefore, 20);
  assert.equal(receipt.workCompletedAfter, 45);
  assert.equal(receipt.unitsDelta, 25);
});

test("G5.4: commitProjectAdvance with autoComplete: true transitions to completed when goal is reached", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition({ autoComplete: true });
  const project = createTestActiveProject({ workCompleted: 80, workRequired: 100, revision: 3 });

  const plan = evaluateProjectAdvancePlan({
    project,
    definition,
    domain,
    proposedDelta: 20
  });

  assert.equal(plan.wouldComplete, true);

  const commitRes = commitProjectAdvance(plan, project, {
    autoComplete: true
  });

  assert.equal(commitRes.ok, true);
  if (!commitRes.ok) return;

  const { updatedProject, receipt } = commitRes.value;
  assert.equal(updatedProject.workCompleted, 100);
  assert.equal(updatedProject.lifecycle, "completed");
  assert.ok(typeof updatedProject.completedAt === "number");
  assert.equal(receipt.action, "complete");
  assert.equal(receipt.lifecycleBefore, "active");
  assert.equal(receipt.lifecycleAfter, "completed");
});

test("G5.4: commitProjectAdvance without autoComplete leaves lifecycle active even when workCompleted reaches goal (DEC-089)", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition({ autoComplete: false });
  const project = createTestActiveProject({ workCompleted: 95, workRequired: 100, revision: 1 });

  const plan = evaluateProjectAdvancePlan({
    project,
    definition,
    domain,
    proposedDelta: 10
  });

  assert.equal(plan.wouldComplete, true);

  const commitRes = commitProjectAdvance(plan, project, {
    autoComplete: false
  });

  assert.equal(commitRes.ok, true);
  if (!commitRes.ok) return;

  const { updatedProject, receipt } = commitRes.value;
  assert.equal(updatedProject.workCompleted, 100);
  assert.equal(updatedProject.lifecycle, "active");
  assert.equal(updatedProject.completedAt, null);
  assert.equal(receipt.action, "advance");
});

test("G5.4: Progress setback (negative delta) decreases progress and clamps at 0 per DEC-088", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestActiveProject({ workCompleted: 15, revision: 2 });

  // Setback larger than current progress
  const plan = evaluateProjectAdvancePlan({
    project,
    definition,
    domain,
    proposedDelta: -30
  });

  assert.equal(plan.isSatisfied, true);

  const commitRes = commitProjectAdvance(plan, project, {
    reasonCode: "SPOILAGE"
  });

  assert.equal(commitRes.ok, true);
  if (!commitRes.ok) return;

  const { updatedProject } = commitRes.value;
  assert.equal(updatedProject.workCompleted, 0);
  assert.equal(updatedProject.entries?.length, 1);
  assert.equal(updatedProject.entries![0].unitsDelta, -30);
  assert.equal(updatedProject.entries![0].unitsBefore, 15);
  assert.equal(updatedProject.entries![0].unitsAfter, 0);
});

test("G5.4: evaluateProjectAdvancePlan detects lifecycle blockers (paused, blocked, terminal, inactive)", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();

  // 1. Paused
  const pausedProj = createTestActiveProject({ lifecycle: "paused" });
  const pausedPlan = evaluateProjectAdvancePlan({ project: pausedProj, definition, domain, proposedDelta: 5 });
  assert.equal(pausedPlan.isSatisfied, false);
  assert.ok(pausedPlan.blockers.some((b) => b.code === "DM_PROJECT_PAUSED"));

  // 2. Blocked
  const blockedProj = createTestActiveProject({ lifecycle: "blocked", blockedReason: "Severe storm" });
  const blockedPlan = evaluateProjectAdvancePlan({ project: blockedProj, definition, domain, proposedDelta: 5 });
  assert.equal(blockedPlan.isSatisfied, false);
  assert.ok(blockedPlan.blockers.some((b) => b.code === "DM_PROJECT_BLOCKED"));

  // 3. Terminal (completed)
  const completedProj = createTestActiveProject({ lifecycle: "completed" });
  const completedPlan = evaluateProjectAdvancePlan({ project: completedProj, definition, domain, proposedDelta: 5 });
  assert.equal(completedPlan.isSatisfied, false);
  assert.ok(completedPlan.blockers.some((b) => b.code === "DM_PROJECT_TERMINAL"));

  // 4. Inactive (draft)
  const draftProj = createTestActiveProject({ lifecycle: "draft" });
  const draftPlan = evaluateProjectAdvancePlan({ project: draftProj, definition, domain, proposedDelta: 5 });
  assert.equal(draftPlan.isSatisfied, false);
  assert.ok(draftPlan.blockers.some((b) => b.code === "DM_PROJECT_NOT_ACTIVE"));
});

test("G5.4: Optimistic concurrency mismatch rejects evaluation and commit", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestActiveProject({ revision: 4 });

  // Evaluation with mismatched revision
  const planStale = evaluateProjectAdvancePlan({
    project,
    definition,
    domain,
    expectedRevision: 3,
    proposedDelta: 5
  });
  assert.equal(planStale.isSatisfied, false);
  assert.ok(planStale.blockers.some((b) => b.code === "DM_PROJECT_REVISION_MISMATCH"));

  // Satisfied plan but project mutated before commit
  const validPlan = evaluateProjectAdvancePlan({
    project,
    definition,
    domain,
    expectedRevision: 4,
    proposedDelta: 5
  });
  assert.equal(validPlan.isSatisfied, true);

  const mutatedProject = { ...project, revision: 5 };
  const commitRes = commitProjectAdvance(validPlan, mutatedProject);
  assert.equal(commitRes.ok, false);
  if (!commitRes.ok) {
    assert.equal(commitRes.error.code, "DM_PROJECT_REVISION_MISMATCH");
  }
});

test("G5.4: evaluateProjectAdvancePlan with ProgressResolver computes delta without mutating state", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestActiveProject({ workCompleted: 10 });
  const resolver = new StandardProgressResolver();

  const plan = evaluateProjectAdvancePlan({
    project,
    definition,
    domain,
    resolver,
    parameters: { units: 8 }
  });

  assert.equal(plan.isSatisfied, true);
  assert.equal(plan.proposedDelta, 8);
  // Source project instance remains untouched
  assert.equal(project.workCompleted, 10);
  assert.equal(project.revision, 1);
});

test("G5.4: blockProject and unblockProject handle lifecycle transitions and audit entries", () => {
  const project = createTestActiveProject({ revision: 2, lifecycle: "active" });

  // 1. Block project
  const blockRes = blockProject(project, {
    reason: "Supply shortage of timber",
    note: "Waiting for shipment from north"
  });

  assert.equal(blockRes.ok, true);
  if (!blockRes.ok) return;

  const { updatedProject: blockedProj, receipt: blockReceipt } = blockRes.value;
  assert.equal(blockedProj.lifecycle, "blocked");
  assert.equal(blockedProj.blockedReason, "Supply shortage of timber");
  assert.equal(blockedProj.revision, 3);
  assert.equal(blockedProj.entries?.length, 1);
  assert.equal(blockedProj.entries![0].reasonCode, "PROJECT_BLOCKED");
  assert.equal(blockReceipt.action, "block");

  // 2. Reject block with empty reason
  const emptyReasonRes = blockProject(project, { reason: "   " });
  assert.equal(emptyReasonRes.ok, false);
  if (!emptyReasonRes.ok) {
    assert.equal(emptyReasonRes.error.code, "DM_PROJECT_BLOCK_REASON_REQUIRED");
  }

  // 3. Unblock project back to active
  const unblockRes = unblockProject(blockedProj, {
    targetLifecycle: "active",
    note: "Shipment arrived"
  });

  assert.equal(unblockRes.ok, true);
  if (!unblockRes.ok) return;

  const { updatedProject: activeProj, receipt: unblockReceipt } = unblockRes.value;
  assert.equal(activeProj.lifecycle, "active");
  assert.equal(activeProj.blockedReason, null);
  assert.equal(activeProj.revision, 4);
  assert.equal(activeProj.entries?.length, 2);
  assert.equal(activeProj.entries![1].reasonCode, "PROJECT_UNBLOCKED");
  assert.equal(unblockReceipt.action, "unblock");
});

test("G5.4: pauseProject and resumeProject handle lifecycle transitions and audit entries", () => {
  const project = createTestActiveProject({ revision: 5, lifecycle: "active" });

  // 1. Pause project
  const pauseRes = pauseProject(project, {
    note: "Temporary suspension for seasonal festival"
  });

  assert.equal(pauseRes.ok, true);
  if (!pauseRes.ok) return;

  const { updatedProject: pausedProj, receipt: pauseReceipt } = pauseRes.value;
  assert.equal(pausedProj.lifecycle, "paused");
  assert.equal(pausedProj.revision, 6);
  assert.equal(pauseReceipt.action, "pause");

  // 2. Resume project
  const resumeRes = resumeProject(pausedProj, {
    note: "Festival ended, resuming works"
  });

  assert.equal(resumeRes.ok, true);
  if (!resumeRes.ok) return;

  const { updatedProject: resumedProj, receipt: resumeReceipt } = resumeRes.value;
  assert.equal(resumedProj.lifecycle, "active");
  assert.equal(resumedProj.revision, 7);
  assert.equal(resumeReceipt.action, "resume");

  // 3. Cannot resume an already active project
  const invalidResume = resumeProject(resumedProj);
  assert.equal(invalidResume.ok, false);
  if (!invalidResume.ok) {
    assert.equal(invalidResume.error.code, "DM_PROJECT_INVALID_TRANSITION");
  }
});

test("G5.4: cancelProject cancels non-terminal projects and rejects cancellation of completed projects", () => {
  const activeProj = createTestActiveProject({ revision: 1, lifecycle: "active" });

  // 1. Cancel active project
  const cancelRes = cancelProject(activeProj, {
    policy: { reasonCode: "PROJECT_ABANDONED", releaseReservations: true },
    note: "Cancelled due to strategic reassessment"
  });

  assert.equal(cancelRes.ok, true);
  if (!cancelRes.ok) return;

  const { updatedProject: cancelledProj, receipt: cancelReceipt } = cancelRes.value;
  assert.equal(cancelledProj.lifecycle, "cancelled");
  assert.equal(cancelledProj.revision, 2);
  assert.equal(cancelReceipt.action, "cancel");
  assert.equal(cancelReceipt.reasonCode, "PROJECT_ABANDONED");

  // 2. Reject cancellation of completed project
  const completedProj = createTestActiveProject({ revision: 1, lifecycle: "completed" });
  const rejectCancel = cancelProject(completedProj);
  assert.equal(rejectCancel.ok, false);
  if (!rejectCancel.ok) {
    assert.equal(rejectCancel.error.code, "DM_PROJECT_INVALID_TRANSITION");
  }
});

test("G5.4: Batch advance handles atomic and best-effort modes correctly", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();

  const p1 = createTestActiveProject({ id: "proj-1", revision: 1, workCompleted: 10 });
  const p2 = createTestActiveProject({ id: "proj-2", revision: 1, workCompleted: 20 });
  const p3Blocked = createTestActiveProject({ id: "proj-3", revision: 1, lifecycle: "blocked" });

  const projectsMap = new Map<string, ProjectInstance>([
    ["proj-1", p1],
    ["proj-2", p2],
    ["proj-3", p3Blocked]
  ]);

  // 1. Atomic batch containing a blocked project fails
  const atomicBatchPlan = evaluateProjectAdvanceBatchPlan({
    domainUuid: "dom-test-1",
    items: [
      { project: p1, definition, domain, proposedDelta: 5 },
      { project: p3Blocked, definition, domain, proposedDelta: 5 }
    ],
    mode: "atomic"
  });

  assert.equal(atomicBatchPlan.isSatisfied, false);
  const atomicCommitRes = commitProjectAdvanceBatch(atomicBatchPlan, projectsMap);
  assert.equal(atomicCommitRes.ok, false);
  if (!atomicCommitRes.ok) {
    assert.equal(atomicCommitRes.error.code, "DM_PROJECT_BATCH_BLOCKED");
  }

  // 2. Best-effort batch commits satisfied project and skips blocked project
  const bestEffortBatchPlan = evaluateProjectAdvanceBatchPlan({
    domainUuid: "dom-test-1",
    items: [
      { project: p1, definition, domain, proposedDelta: 5 },
      { project: p3Blocked, definition, domain, proposedDelta: 5 }
    ],
    mode: "best-effort"
  });

  assert.equal(bestEffortBatchPlan.isSatisfied, true);
  const bestEffortCommitRes = commitProjectAdvanceBatch(bestEffortBatchPlan, projectsMap);
  assert.equal(bestEffortCommitRes.ok, true);
  if (!bestEffortCommitRes.ok) return;

  assert.equal(bestEffortCommitRes.value.updatedProjects.length, 1);
  assert.equal(bestEffortCommitRes.value.updatedProjects[0].id, "proj-1");
  assert.equal(bestEffortCommitRes.value.updatedProjects[0].workCompleted, 15);
  assert.equal(bestEffortCommitRes.value.receipts.length, 1);
});
