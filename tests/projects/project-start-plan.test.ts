import test from "node:test";
import assert from "node:assert/strict";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { PROJECTS_CAPABILITY_ID } from "../../src/projects/project-data.js";
import {
  type ProjectDefinition,
  type ProjectInstance
} from "../../src/projects/types/project-types.js";
import {
  commitProjectStartPlan,
  evaluateProjectStartPlan
} from "../../src/projects/plans/project-start-plan-service.js";

function createTestDomain(overrides?: Partial<DomainRecord>): DomainRecord {
  return {
    schemaVersion: 1,
    revision: 1,
    definition: {
      identity: { aliases: [], summary: "Capital", description: "Main capital domain" },
      classification: { kind: "settlement", scale: "standard", tags: [] },
      hierarchy: { parentDomainUuid: null },
      capabilities: {
        enabled: ["domain-manager:core", "domain-manager:domain", PROJECTS_CAPABILITY_ID],
        config: {}
      }
    },
    state: { lifecycle: "active" },
    metadata: { createdByUserId: "user_gm", archivedAt: null, source: { type: "manual", ref: null } },
    ...overrides
  };
}

function createTestDefinition(overrides?: Partial<ProjectDefinition>): ProjectDefinition {
  return {
    id: "domain-manager:colony-hub",
    version: 1,
    label: "Colony Hub",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 200,
    tags: ["construction", "colony"],
    requirements: [
      {
        id: "req_core_cap",
        category: "start",
        type: "capability",
        targetRef: "domain-manager:core",
        label: "Core technical shell"
      }
    ],
    costs: [
      {
        resourceId: "domain-manager:treasury",
        amountMinor: 10000,
        timing: "upfront"
      }
    ],
    rewards: [],
    ...overrides
  };
}

function createTestProject(overrides?: Partial<ProjectInstance>): ProjectInstance {
  return {
    id: createOpaqueId("prj"),
    domainUuid: "JournalEntry.domain_capital",
    definitionId: "domain-manager:colony-hub",
    name: "Capital Colony Hub",
    schemaVersion: 1,
    revision: 0,
    lifecycle: "draft",
    workRequired: 200,
    workCompleted: 0,
    clampProgress: true,
    tags: [],
    createdAt: 1000,
    updatedAt: 1000,
    entries: [],
    ...overrides
  };
}

test("G5.3: evaluateProjectStartPlan produces clean satisfied plan on happy path", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestProject();

  const plan = evaluateProjectStartPlan({
    project,
    definition,
    domain,
    availableResources: {
      "domain-manager:treasury": 25000
    }
  });

  assert.equal(plan.isSatisfied, true);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.targetLifecycle, "active");
  assert.equal(plan.requirements.length, 1);
  assert.equal(plan.requirements[0].status, "satisfied");
  assert.equal(plan.economicReservations.length, 1);
  assert.equal(plan.economicReservations[0].isAvailable, true);
  assert.equal(plan.economicReservations[0].amountMinor, 10000);
});

test("G5.3: commitProjectStartPlan commits satisfied plan and transitions to active", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestProject();

  const plan = evaluateProjectStartPlan({
    project,
    definition,
    domain,
    availableResources: {
      "domain-manager:treasury": 15000
    }
  });

  assert.equal(plan.isSatisfied, true);

  const commitRes = commitProjectStartPlan(plan, project, { userId: "user_gm", timestamp: 2500 });
  assert.equal(commitRes.ok, true);
  if (commitRes.ok) {
    const started = commitRes.value.project;
    assert.equal(started.lifecycle, "active");
    assert.equal(started.revision, 1);
    assert.equal(started.entries?.length, 1);
    assert.equal(started.entries?.[0].reasonCode, "PROJECT_STARTED");
    assert.equal(started.entries?.[0].sourceKind, "command");
    assert.equal(started.entries?.[0].requestedByUserId, "user_gm");
    assert.equal(started.updatedAt, 2500);

    // Verify input project was not mutated
    assert.equal(project.lifecycle, "draft");
    assert.equal(project.revision, 0);
  }
});

test("G5.3: evaluateProjectStartPlan detects missing domain capability blocker", () => {
  // Domain without PROJECTS_CAPABILITY_ID
  const domainWithoutProjects = createTestDomain({
    definition: {
      identity: { aliases: [], summary: "Capital", description: "Main capital domain" },
      classification: { kind: "settlement", scale: "standard", tags: [] },
      hierarchy: { parentDomainUuid: null },
      capabilities: {
        enabled: ["domain-manager:core", "domain-manager:domain"],
        config: {}
      }
    }
  });

  const definition = createTestDefinition();
  const project = createTestProject();

  const plan = evaluateProjectStartPlan({
    project,
    definition,
    domain: domainWithoutProjects,
    availableResources: { "domain-manager:treasury": 20000 }
  });

  assert.equal(plan.isSatisfied, false);
  const capBlocker = plan.blockers.find((b) => b.code === "DM_PROJECT_CAPABILITY_MISSING");
  assert.notEqual(capBlocker, undefined);
  assert.equal(capBlocker?.category, "capability");

  // Attempt to commit blocked plan fails
  const commitRes = commitProjectStartPlan(plan, project);
  assert.equal(commitRes.ok, false);
  if (!commitRes.ok) {
    assert.equal(commitRes.error.code, "DM_PROJECT_START_BLOCKED");
  }
});

test("G5.3: evaluateProjectStartPlan detects insufficient economic funds blocker", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition({
    costs: [
      {
        resourceId: "domain-manager:treasury",
        amountMinor: 50000,
        timing: "upfront"
      }
    ]
  });
  const project = createTestProject();

  // Only 10000 available vs 50000 required
  const plan = evaluateProjectStartPlan({
    project,
    definition,
    domain,
    availableResources: {
      "domain-manager:treasury": 10000
    }
  });

  assert.equal(plan.isSatisfied, false);
  assert.equal(plan.economicReservations[0].isAvailable, false);
  const econBlocker = plan.blockers.find((b) => b.code === "DM_PROJECT_INSUFFICIENT_FUNDS");
  assert.notEqual(econBlocker, undefined);
  assert.equal(econBlocker?.category, "economy");
});

test("G5.3: evaluateProjectStartPlan detects unsatisfied start requirements", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition({
    requirements: [
      {
        id: "req_adv_tech",
        category: "start",
        type: "capability",
        targetRef: "domain-manager:super-tech",
        label: "Super Tech Capability"
      }
    ]
  });
  const project = createTestProject();

  const plan = evaluateProjectStartPlan({
    project,
    definition,
    domain,
    availableResources: { "domain-manager:treasury": 50000 }
  });

  assert.equal(plan.isSatisfied, false);
  assert.equal(plan.requirements[0].status, "unsatisfied");
  const reqBlocker = plan.blockers.find((b) => b.code === "DM_PROJECT_REQUIREMENT_UNSATISFIED");
  assert.notEqual(reqBlocker, undefined);
  assert.equal(reqBlocker?.category, "requirement");
});

test("G5.3: evaluateProjectStartPlan detects invalid lifecycle transitions", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  // Project is already completed; cannot transition directly to active
  const completedProject = createTestProject({ lifecycle: "completed" });

  const plan = evaluateProjectStartPlan({
    project: completedProject,
    definition,
    domain,
    availableResources: { "domain-manager:treasury": 20000 }
  });

  assert.equal(plan.isSatisfied, false);
  const lifeBlocker = plan.blockers.find((b) => b.code === "DM_PROJECT_INVALID_TRANSITION");
  assert.notEqual(lifeBlocker, undefined);
  assert.equal(lifeBlocker?.category, "lifecycle");
});

test("G5.3: Optimistic concurrency revision check blocks stale commits", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestProject({ revision: 3 });

  // Plan evaluated at revision 3
  const plan = evaluateProjectStartPlan({
    project,
    definition,
    domain,
    expectedRevision: 3,
    availableResources: { "domain-manager:treasury": 20000 }
  });
  assert.equal(plan.isSatisfied, true);

  // Project mutated in the meantime to revision 4
  const mutatedProject = { ...project, revision: 4 };

  const commitRes = commitProjectStartPlan(plan, mutatedProject);
  assert.equal(commitRes.ok, false);
  if (!commitRes.ok) {
    assert.equal(commitRes.error.code, "DM_PROJECT_REVISION_MISMATCH");
  }
});

test("G5.3: Workforce intent evaluates required contributors and reports insufficiency", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestProject();

  // Requires 3 workforce units, only 1 assigned
  const plan = evaluateProjectStartPlan({
    project,
    definition,
    domain,
    contributors: [{ type: "notable", ref: "not_lead" }],
    parameters: { workforceRequired: 3 },
    availableResources: { "domain-manager:treasury": 20000 }
  });

  assert.equal(plan.isSatisfied, false);
  assert.notEqual(plan.workforceIntent, null);
  assert.equal(plan.workforceIntent?.isSufficient, false);
  const wfBlocker = plan.blockers.find((b) => b.code === "DM_PROJECT_WORKFORCE_INSUFFICIENT");
  assert.notEqual(wfBlocker, undefined);
  assert.equal(wfBlocker?.category, "workforce");
});

test("G5.3: Supports technical intermediate lifecycle 'initializing' (Master §15.5)", () => {
  const domain = createTestDomain();
  const definition = createTestDefinition();
  const project = createTestProject({ lifecycle: "approved" });

  const plan = evaluateProjectStartPlan({
    project,
    definition,
    domain,
    targetLifecycle: "initializing",
    availableResources: { "domain-manager:treasury": 20000 }
  });

  assert.equal(plan.isSatisfied, true);
  assert.equal(plan.targetLifecycle, "initializing");

  const commitRes = commitProjectStartPlan(plan, project);
  assert.equal(commitRes.ok, true);
  if (commitRes.ok) {
    assert.equal(commitRes.value.project.lifecycle, "initializing");
  }
});
