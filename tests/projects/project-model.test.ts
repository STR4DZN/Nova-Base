import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateProjectProgress,
  PROJECT_LIFECYCLE_STATES,
  validateProjectDefinition,
  validateProjectInstance,
  validateProjectLifecycleTransition,
  type ProjectDefinition,
  type ProjectInstance,
  type ProjectLifecycle
} from "../../src/projects/types/project-types.js";
import {
  CANONICAL_PROJECT_DEFINITIONS
} from "../../src/projects/definitions/canonical-project-definitions.js";
import {
  createDefaultProjectRegistry,
  ProjectDefinitionRegistry
} from "../../src/projects/definitions/project-registry.js";
import {
  createDefaultDomainProjectsData,
  getDomainProjectsData,
  PROJECTS_CAPABILITY_ID,
  tryGetDomainProjectsData,
  validateDomainProjectsData,
  withDomainProjectsData
} from "../../src/projects/project-data.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import {
  createDefaultCapabilityRegistry,
  validateDomainCapabilities
} from "../../src/domains/domain-capabilities.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";

test("G5.1: ProjectDefinition validates canonical definitions", () => {
  for (const def of CANONICAL_PROJECT_DEFINITIONS) {
    const res = validateProjectDefinition(def);
    assert.equal(res.ok, true, `Canonical definition '${def.id}' should be valid`);
    if (res.ok) {
      assert.equal(res.value.id, def.id);
      assert.equal(Number.isSafeInteger(res.value.defaultWorkRequired), true);
      assert.ok(res.value.defaultWorkRequired >= 1);
    }
  }
});

test("G5.1: ProjectDefinition validation accepts full valid definition", () => {
  const customDef: ProjectDefinition = {
    id: "domain-manager:colony-founding",
    version: 2,
    label: "Colony Founding",
    description: "Establish a permanent planetary settlement.",
    category: "expansion",
    tags: ["colony", "settlement", "planet"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 500,
    requirements: [
      {
        id: "req_tech",
        category: "start",
        type: "technology",
        targetRef: "tech:orbital-survey",
        label: "Orbital Survey Tech"
      }
    ],
    costs: [
      {
        resourceId: "domain-manager:treasury",
        amountMinor: 50000,
        timing: "upfront"
      },
      {
        resourceId: "domain-manager:materials",
        amountMinor: 25000,
        timing: "progressive"
      }
    ],
    rewards: [
      {
        type: "facility",
        targetRef: "fac_hub",
        label: "Planetary Hub"
      }
    ],
    autoComplete: true,
    metadata: { tier: 3 }
  };

  const res = validateProjectDefinition(customDef);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.id, "domain-manager:colony-founding");
    assert.equal(res.value.version, 2);
    assert.equal(res.value.costs.length, 2);
    assert.equal(res.value.autoComplete, true);
    assert.equal(res.value.costs[0].timing, "upfront");
  }
});

test("G5.1: ProjectDefinition rejects invalid IDs and malformed input", () => {
  // Non-object
  assert.equal(validateProjectDefinition(null).ok, false);
  assert.equal(validateProjectDefinition("string").ok, false);
  assert.equal(validateProjectDefinition([]).ok, false);

  // Non-namespaced ID
  const noNamespace = validateProjectDefinition({
    id: "survey",
    label: "Survey",
    defaultWorkRequired: 100
  });
  assert.equal(noNamespace.ok, false);
  if (!noNamespace.ok) {
    assert.equal(noNamespace.error.code, "DM_PROJECT_INVALID_ID");
  }

  // Invalid version
  const badVersion = validateProjectDefinition({
    id: "domain-manager:test",
    version: 0,
    label: "Test",
    defaultWorkRequired: 100
  });
  assert.equal(badVersion.ok, false);

  // Empty label
  const emptyLabel = validateProjectDefinition({
    id: "domain-manager:test",
    label: "   ",
    defaultWorkRequired: 100
  });
  assert.equal(emptyLabel.ok, false);

  // Invalid defaultWorkRequired (float or <= 0)
  const floatWork = validateProjectDefinition({
    id: "domain-manager:test",
    label: "Test",
    defaultWorkRequired: 10.5
  });
  assert.equal(floatWork.ok, false);
  if (!floatWork.ok) {
    assert.equal(floatWork.error.code, "DM_PROJECT_WORK_REQUIRED_INVALID");
  }

  const zeroWork = validateProjectDefinition({
    id: "domain-manager:test",
    label: "Test",
    defaultWorkRequired: 0
  });
  assert.equal(zeroWork.ok, false);

  // Invalid cost definition
  const badCost = validateProjectDefinition({
    id: "domain-manager:test",
    label: "Test",
    defaultWorkRequired: 100,
    costs: [{ resourceId: "treasury", amountMinor: -10, timing: "upfront" }]
  });
  assert.equal(badCost.ok, false);

  const badCostTiming = validateProjectDefinition({
    id: "domain-manager:test",
    label: "Test",
    defaultWorkRequired: 100,
    costs: [{ resourceId: "treasury", amountMinor: 100, timing: "instant" }]
  });
  assert.equal(badCostTiming.ok, false);
});

test("G5.1: ProjectInstance validation accepts valid instance", () => {
  const prjId = createOpaqueId("prj");
  const instance: ProjectInstance = {
    id: prjId,
    domainUuid: "JournalEntry.domain123",
    definitionId: "domain-manager:survey",
    name: "North Sector Survey",
    description: "Detailed orbital mapping",
    schemaVersion: 1,
    revision: 0,
    lifecycle: "draft",
    workRequired: 100,
    workCompleted: 0,
    clampProgress: true,
    priority: 1,
    tags: ["survey"],
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    blockedReason: null
  };

  const res = validateProjectInstance(instance);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.id, prjId);
    assert.equal(res.value.revision, 0);
    assert.equal(res.value.lifecycle, "draft");
    assert.equal(res.value.workRequired, 100);
    assert.equal(res.value.workCompleted, 0);
    assert.equal(res.value.clampProgress, true);
  }
});

test("G5.1: ProjectInstance validates custom definition (DEC-085)", () => {
  const prjId = createOpaqueId("prj");
  const customDef: ProjectDefinition = {
    id: "domain-manager:special-ritual",
    version: 1,
    label: "Special GM Ritual",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 50,
    requirements: [],
    costs: [],
    rewards: [],
    tags: []
  };

  const instanceWithCustom: ProjectInstance = {
    id: prjId,
    domainUuid: "JournalEntry.domain123",
    definitionId: "domain-manager:special-ritual",
    customDefinition: customDef,
    name: "The Sun Ritual",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "active",
    workRequired: 50,
    workCompleted: 20,
    tags: [],
    createdAt: 1000,
    updatedAt: 1000
  };

  const res = validateProjectInstance(instanceWithCustom);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.notEqual(res.value.customDefinition, null);
    assert.equal(res.value.customDefinition?.label, "Special GM Ritual");
  }

  // Corrupted custom definition fails validation
  const badCustom = {
    ...instanceWithCustom,
    customDefinition: { id: "no-namespace", label: "Invalid" }
  };
  const badRes = validateProjectInstance(badCustom);
  assert.equal(badRes.ok, false);
});

test("G5.1: ProjectInstance rejects invalid fields and malformed states", () => {
  const validBase = {
    id: "prj_valid",
    domainUuid: "domain_1",
    definitionId: "domain-manager:survey",
    name: "Survey",
    schemaVersion: 1,
    revision: 0,
    lifecycle: "draft",
    workRequired: 100,
    workCompleted: 0
  };

  // Missing id
  assert.equal(validateProjectInstance({ ...validBase, id: "" }).ok, false);

  // Missing domainUuid
  assert.equal(validateProjectInstance({ ...validBase, domainUuid: "" }).ok, false);

  // Missing definitionId
  assert.equal(validateProjectInstance({ ...validBase, definitionId: "" }).ok, false);

  // Missing name
  assert.equal(validateProjectInstance({ ...validBase, name: "   " }).ok, false);

  // Invalid lifecycle
  const badLifecycle = validateProjectInstance({ ...validBase, lifecycle: "unknown_state" });
  assert.equal(badLifecycle.ok, false);
  if (!badLifecycle.ok) {
    assert.equal(badLifecycle.error.code, "DM_PROJECT_INVALID_LIFECYCLE");
  }

  // Invalid workRequired (<= 0 or non-integer)
  const badWorkReq = validateProjectInstance({ ...validBase, workRequired: 0 });
  assert.equal(badWorkReq.ok, false);
  if (!badWorkReq.ok) {
    assert.equal(badWorkReq.error.code, "DM_PROJECT_WORK_REQUIRED_INVALID");
  }

  // Invalid workCompleted (< 0 or non-integer)
  const badWorkComp = validateProjectInstance({ ...validBase, workCompleted: -5 });
  assert.equal(badWorkComp.ok, false);
  if (!badWorkComp.ok) {
    assert.equal(badWorkComp.error.code, "DM_PROJECT_WORK_COMPLETED_INVALID");
  }

  // Invalid revision (< 0 or float)
  assert.equal(validateProjectInstance({ ...validBase, revision: -1 }).ok, false);
  assert.equal(validateProjectInstance({ ...validBase, revision: 1.5 }).ok, false);
});

test("G5.1: calculateProjectProgress computes integer percentages and clamps (DEC-086, DEC-087, DEC-090)", () => {
  // 0 progress
  const p0 = calculateProjectProgress(0, 100);
  assert.equal(p0.percent, 0);
  assert.equal(p0.isComplete, false);
  assert.equal(p0.remainingUnits, 100);

  // Partial progress (e.g. 33/100 -> 33%)
  const p33 = calculateProjectProgress(33, 100);
  assert.equal(p33.percent, 33);
  assert.equal(p33.isComplete, false);
  assert.equal(p33.remainingUnits, 67);

  // Integer floor derivation (e.g. 1/3 = 33.333% -> 33%)
  const pThird = calculateProjectProgress(1, 3);
  assert.equal(pThird.percent, 33);
  assert.equal(pThird.isComplete, false);
  assert.equal(pThird.remainingUnits, 2);

  // Exactly complete
  const pComplete = calculateProjectProgress(100, 100);
  assert.equal(pComplete.percent, 100);
  assert.equal(pComplete.isComplete, true);
  assert.equal(pComplete.remainingUnits, 0);

  // Overprogress clamped (default clamp = true, DEC-090)
  const pOverClamped = calculateProjectProgress(150, 100, true);
  assert.equal(pOverClamped.percent, 100);
  assert.equal(pOverClamped.isComplete, true);
  assert.equal(pOverClamped.remainingUnits, 0);

  // Overprogress unclamped (clamp = false)
  const pOverUnclamped = calculateProjectProgress(150, 100, false);
  assert.equal(pOverUnclamped.percent, 150);
  assert.equal(pOverUnclamped.isComplete, true);
  assert.equal(pOverUnclamped.remainingUnits, 0);

  // Invalid inputs handle gracefully
  const pInvalid = calculateProjectProgress(NaN, 100);
  assert.equal(pInvalid.percent, 0);
  assert.equal(pInvalid.isComplete, false);
});

test("G5.1: validateProjectLifecycleTransition enforces valid state machine transitions (Master §15.4)", () => {
  // Identity transition is always ok
  for (const state of PROJECT_LIFECYCLE_STATES) {
    assert.equal(validateProjectLifecycleTransition(state, state).ok, true);
  }

  // Legal transitions
  assert.equal(validateProjectLifecycleTransition("draft", "planned").ok, true);
  assert.equal(validateProjectLifecycleTransition("draft", "cancelled").ok, true);
  assert.equal(validateProjectLifecycleTransition("planned", "approved").ok, true);
  assert.equal(validateProjectLifecycleTransition("approved", "initializing").ok, true);
  assert.equal(validateProjectLifecycleTransition("approved", "active").ok, true);
  assert.equal(validateProjectLifecycleTransition("initializing", "active").ok, true);
  assert.equal(validateProjectLifecycleTransition("initializing", "blocked").ok, true);
  assert.equal(validateProjectLifecycleTransition("active", "blocked").ok, true);
  assert.equal(validateProjectLifecycleTransition("active", "paused").ok, true);
  assert.equal(validateProjectLifecycleTransition("active", "completed").ok, true);
  assert.equal(validateProjectLifecycleTransition("active", "failed").ok, true);
  assert.equal(validateProjectLifecycleTransition("completed", "archived").ok, true);
  assert.equal(validateProjectLifecycleTransition("failed", "draft").ok, true);
  assert.equal(validateProjectLifecycleTransition("cancelled", "draft").ok, true);

  // Illegal transitions
  const draftToCompleted = validateProjectLifecycleTransition("draft", "completed");
  assert.equal(draftToCompleted.ok, false);
  if (!draftToCompleted.ok) {
    assert.equal(draftToCompleted.error.code, "DM_PROJECT_INVALID_TRANSITION");
  }

  const activeToDraft = validateProjectLifecycleTransition("active", "draft");
  assert.equal(activeToDraft.ok, false);

  const completedToActive = validateProjectLifecycleTransition("completed", "active");
  assert.equal(completedToActive.ok, false);

  const archivedToDraft = validateProjectLifecycleTransition("archived", "draft");
  assert.equal(archivedToDraft.ok, false);

  // Explicit reopen override (allowReopen: true)
  assert.equal(
    validateProjectLifecycleTransition("completed", "active", { allowReopen: true }).ok,
    true
  );
  assert.equal(
    validateProjectLifecycleTransition("archived", "draft", { allowReopen: true }).ok,
    true
  );
});

test("G5.1: ProjectDefinitionRegistry registers, catalogs, and freezes definitions", () => {
  const registry = new ProjectDefinitionRegistry();
  assert.equal(registry.isFrozen, false);

  const def1: ProjectDefinition = {
    id: "domain-manager:survey",
    version: 1,
    label: "Survey",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    tags: ["exploration"],
    category: "exploration",
    requirements: [],
    costs: [],
    rewards: []
  };

  const def2: ProjectDefinition = {
    id: "domain-manager:construction",
    version: 1,
    label: "Construction",
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 200,
    tags: ["infrastructure"],
    category: "building",
    requirements: [],
    costs: [],
    rewards: []
  };

  // Register def1 and def2
  const r1 = registry.register(def1);
  assert.equal(r1.ok, true);
  const r2 = registry.register(def2);
  assert.equal(r2.ok, true);

  // Duplicate ID rejected
  const dup = registry.register(def1);
  assert.equal(dup.ok, false);
  if (!dup.ok) {
    assert.equal(dup.error.code, "DM_PROJECT_DEFINITION_ALREADY_EXISTS");
  }

  // Get and has
  assert.equal(registry.has("domain-manager:survey"), true);
  assert.equal(registry.has("domain-manager:nonexistent"), false);
  assert.equal(registry.get("domain-manager:survey")?.label, "Survey");

  // List with filters
  const all = registry.list();
  assert.equal(all.length, 2);

  const exploration = registry.list({ category: "exploration" });
  assert.equal(exploration.length, 1);
  assert.equal(exploration[0].id, "domain-manager:survey");

  const taggedBuilding = registry.list({ tag: "infrastructure" });
  assert.equal(taggedBuilding.length, 1);
  assert.equal(taggedBuilding[0].id, "domain-manager:construction");

  // Unregister
  assert.equal(registry.unregister("domain-manager:survey"), true);
  assert.equal(registry.has("domain-manager:survey"), false);
  assert.equal(registry.list().length, 1);

  // Freeze
  registry.freeze();
  assert.equal(registry.isFrozen, true);

  // Subsequent register rejected
  const postFreeze = registry.register(def1);
  assert.equal(postFreeze.ok, false);
  if (!postFreeze.ok) {
    assert.equal(postFreeze.error.code, "DM_PROJECT_REGISTRY_FROZEN");
  }

  // Subsequent unregister throws
  assert.throws(() => registry.unregister("domain-manager:construction"), /frozen/);
});

test("G5.1: createDefaultProjectRegistry provides all canonical templates", () => {
  const defaultRegistry = createDefaultProjectRegistry();
  assert.equal(defaultRegistry.has("domain-manager:survey"), true);
  assert.equal(defaultRegistry.has("domain-manager:basic-construction"), true);
  assert.equal(defaultRegistry.has("domain-manager:facility-maintenance"), true);
  assert.equal(defaultRegistry.list().length, 3);
});

test("G5.1: DomainProjectsData validation, duplicate detection, and DomainRecord roundtrip", () => {
  // Default data
  const defaultData = createDefaultDomainProjectsData();
  assert.equal(defaultData.schemaVersion, 1);
  assert.equal(defaultData.projects.length, 0);

  // Valid project data
  const p1: ProjectInstance = {
    id: createOpaqueId("prj"),
    domainUuid: "dom_1",
    definitionId: "domain-manager:survey",
    name: "Survey North",
    schemaVersion: 1,
    revision: 0,
    lifecycle: "draft",
    workRequired: 100,
    workCompleted: 0,
    tags: []
  };

  const p2: ProjectInstance = {
    id: createOpaqueId("prj"),
    domainUuid: "dom_1",
    definitionId: "domain-manager:basic-construction",
    name: "Build Watchtower",
    schemaVersion: 1,
    revision: 0,
    lifecycle: "planned",
    workRequired: 200,
    workCompleted: 50,
    tags: []
  };

  const valRes = validateDomainProjectsData({
    schemaVersion: 1,
    projects: [p1, p2]
  });
  assert.equal(valRes.ok, true);
  if (valRes.ok) {
    assert.equal(valRes.value.projects.length, 2);
  }

  // Detect duplicate project instance IDs
  const duplicateIdRes = validateDomainProjectsData({
    schemaVersion: 1,
    projects: [p1, { ...p2, id: p1.id }]
  });
  assert.equal(duplicateIdRes.ok, false);
  if (!duplicateIdRes.ok) {
    assert.equal(duplicateIdRes.error.code, "DM_PROJECT_DUPLICATE_ID");
  }

  // Detect invalid schemaVersion
  const badSchemaRes = validateDomainProjectsData({
    schemaVersion: 99,
    projects: []
  });
  assert.equal(badSchemaRes.ok, false);
  if (!badSchemaRes.ok) {
    assert.equal(badSchemaRes.error.code, "DM_PROJECT_INVALID_SCHEMA_VERSION");
  }

  // DomainRecord attachment and retrieval
  const dummyDomain: DomainRecord = {
    uuid: "JournalEntry.test_domain",
    name: "Test Settlement",
    schemaVersion: 1,
    revision: 1,
    definition: {
      identity: { id: "dom_1", domainUuid: "JournalEntry.test_domain", name: "Test Settlement", aliases: [] },
      classification: { type: "settlement", category: "standard", level: 1 },
      capabilities: { enabled: ["domain-manager:core", "domain-manager:domain"], config: {} }
    },
    state: { status: "active", activeConditions: [], modifiers: [] },
    metadata: { created: 1000, updated: 1000, version: "1.0.0" }
  };

  // Initially returns default empty projects data
  const initialData = getDomainProjectsData(dummyDomain);
  assert.equal(initialData.projects.length, 0);

  // Attach projects data
  const domainWithProjects = withDomainProjectsData(dummyDomain, {
    schemaVersion: 1,
    projects: [p1, p2]
  });

  assert.ok(domainWithProjects.definition.capabilities.enabled.includes(PROJECTS_CAPABILITY_ID));
  const retrieved = getDomainProjectsData(domainWithProjects);
  assert.equal(retrieved.projects.length, 2);
  assert.equal(retrieved.projects[0].name, "Survey North");
  assert.equal(retrieved.projects[1].name, "Build Watchtower");
});

test("G5.1: CapabilityRegistry validates domain-manager:projects configuration", () => {
  const registry = createDefaultCapabilityRegistry();

  // Valid projects capability config
  const validDomainCaps = {
    enabled: ["domain-manager:core", "domain-manager:domain", "domain-manager:projects"],
    config: {
      "domain-manager:projects": {
        schemaVersion: 1,
        projects: []
      }
    }
  };

  const validRes = validateDomainCapabilities(validDomainCaps, registry);
  assert.equal(validRes.ok, true);

  // Corrupted projects capability config is caught with DM_INVALID_CAPABILITY_CONFIG
  const corruptedDomainCaps = {
    enabled: ["domain-manager:core", "domain-manager:domain", "domain-manager:projects"],
    config: {
      "domain-manager:projects": {
        schemaVersion: 99,
        projects: "not an array"
      }
    }
  };

  const corruptedRes = validateDomainCapabilities(corruptedDomainCaps, registry);
  assert.equal(corruptedRes.ok, false);
  if (!corruptedRes.ok) {
    assert.equal(corruptedRes.error.code, "DM_INVALID_CAPABILITY_CONFIG");
  }
});
