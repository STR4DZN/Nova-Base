import test from "node:test";
import assert from "node:assert/strict";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import { err, ok } from "../../src/core/contracts/result.js";
import { createPublicError } from "../../src/core/contracts/public-error.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import {
  domainCapabilityRegistry,
  createDefaultCapabilityRegistry
} from "../../src/domains/domain-capabilities.js";
import {
  DomainIntegrityChecker,
  type DomainIntegrityDocument
} from "../../src/storage/integrity/domain-integrity-checker.js";

// Projects imports
import {
  createDefaultProjectRegistry,
  ProjectDefinitionRegistry
} from "../../src/projects/definitions/project-registry.js";
import {
  CANONICAL_PROJECT_DEFINITIONS
} from "../../src/projects/definitions/canonical-project-definitions.js";
import {
  createDefaultDomainProjectsData,
  withDomainProjectsData,
  getDomainProjectsData,
  type DomainProjectsData
} from "../../src/projects/project-data.js";
import {
  calculateProjectProgress,
  applyProjectEntry,
  validateProjectLifecycleTransition,
  type ProjectDefinition,
  type ProjectInstance,
  type ProjectEntry,
  type ProjectLifecycle
} from "../../src/projects/types/project-types.js";
import {
  StandardProgressResolver
} from "../../src/projects/resolvers/standard-progress-resolver.js";
import {
  evaluateProjectStartPlan,
  commitProjectStartPlan
} from "../../src/projects/plans/project-start-plan-service.js";
import {
  evaluateProjectAdvancePlan,
  commitProjectAdvance,
  pauseProject,
  resumeProject,
  cancelProject,
  blockProject,
  unblockProject
} from "../../src/projects/plans/project-advance-plan-service.js";
import {
  evaluateProjectCompletionPlan,
  commitProjectCompletion
} from "../../src/projects/plans/project-completion-plan-service.js";

// Facilities imports
import {
  createDefaultFacilityRegistry,
  FacilityDefinitionRegistry
} from "../../src/facilities/definitions/facility-registry.js";
import {
  CANONICAL_FACILITY_DEFINITIONS
} from "../../src/facilities/definitions/canonical-facility-definitions.js";
import {
  createDefaultDomainFacilitiesData,
  withDomainFacilitiesData,
  getDomainFacilitiesData,
  type DomainFacilitiesData
} from "../../src/facilities/facility-data.js";
import {
  calculateFacilityEffectiveCapabilities,
  type FacilityDefinition,
  type FacilityInstance,
  type FacilityLifecycle,
  type FacilityReadiness
} from "../../src/facilities/types/facility-types.js";
import {
  evaluateFacilityMaintenancePlan,
  commitFacilityMaintenance,
  applyFacilityDamage
} from "../../src/facilities/services/facility-maintenance-service.js";
import {
  evaluateFacilityRepairPlan,
  commitFacilityRepair
} from "../../src/facilities/services/facility-repair-service.js";

// Downtime imports
import {
  createDefaultDowntimeRegistry,
  DowntimeDefinitionRegistry
} from "../../src/downtime/definitions/downtime-registry.js";
import {
  CANONICAL_DOWNTIME_DEFINITIONS
} from "../../src/downtime/definitions/canonical-downtime-definitions.js";
import {
  createDefaultDomainDowntimeData,
  withDomainDowntimeData,
  getDomainDowntimeData,
  type DomainDowntimeData
} from "../../src/downtime/downtime-data.js";
import {
  calculateDowntimeProgress,
  isDowntimeComplete,
  validateDowntimeLifecycleTransition,
  type DowntimeDefinition,
  type DowntimeInstance,
  type DowntimeLifecycle,
  type DowntimeParticipant
} from "../../src/downtime/types/downtime-types.js";

// UI Presenter imports to verify contract alignment
import { buildProjectsViewModel } from "../../src/ui/domain-patterns/projects/project-presenter.js";
import { buildFacilitiesViewModel } from "../../src/ui/domain-patterns/facilities/facility-presenter.js";
import { buildDowntimeViewModel } from "../../src/ui/domain-patterns/downtime/downtime-presenter.js";

function createBaseDomainRecord(domainId: string, name: string): DomainRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    definition: {
      identity: { aliases: [name], summary: `Summary for ${name}`, description: `Description for ${name}` },
      classification: { kind: "base", scale: "medium", tags: ["g5-acceptance"] },
      hierarchy: { parentDomainUuid: null },
      capabilities: {
        enabled: [
          "domain-manager:domain",
          "domain-manager:projects",
          "domain-manager:facilities",
          "domain-manager:downtime"
        ],
        config: {
          "domain-manager:projects": createDefaultDomainProjectsData(),
          "domain-manager:facilities": createDefaultDomainFacilitiesData(),
          "domain-manager:downtime": createDefaultDomainDowntimeData()
        }
      }
    },
    state: { lifecycle: "active" },
    metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
  };
}

function createMockDocument(
  id: string,
  name: string,
  record: DomainRecord
): IdentifiedJournalEntryDocumentLike {
  let currentName = name;
  let currentFlags: Readonly<Record<string, unknown>> = { "domain-manager": record };
  let currentOwnership: Record<string, number | string> = { default: 3 };

  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return currentName; },
    get flags() { return currentFlags; },
    get ownership() { return currentOwnership; },
    update: async (data: Record<string, unknown>) => {
      if (typeof data.name === "string") currentName = data.name;
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": payload };
      }
      if (data.ownership !== undefined) {
        currentOwnership = { ...(data.ownership as any) };
      }
    }
  };
}

function createMockStore(initialDocs: IdentifiedJournalEntryDocumentLike[] = []): DomainDocumentStore {
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  let nextId = 1;

  function register(doc: IdentifiedJournalEntryDocumentLike) {
    byKey.set(doc.id, doc);
    byKey.set(doc.uuid, doc);
  }

  for (const doc of initialDocs) {
    register(doc);
  }

  return {
    get: (idOrUuid) => {
      const clean = idOrUuid.startsWith("JournalEntry.")
        ? idOrUuid.slice("JournalEntry.".length)
        : idOrUuid;
      return byKey.get(idOrUuid) ?? byKey.get(clean);
    },
    list: () => [...new Set(byKey.values())],
    create: async (data) => {
      const id = `je-acc-${nextId++}`;
      const doc = createMockDocument(id, data.name, data.flags["domain-manager"] as any);
      register(doc);
      return doc;
    }
  };
}

// ---------------------------------------------------------------------------
// 1. MANDATORY ACCEPTANCE CRITERIA
// ---------------------------------------------------------------------------

test("G5.10 Acceptance: progress inteiro e % derivado (Master Spec §15.2, DEC-086, DEC-087, DEC-090)", () => {
  const project: ProjectInstance = {
    id: "proj-int-1",
    definitionId: "domain-manager:basic-construction",
    domainUuid: "JournalEntry.domain-1",
    name: "Watchtower",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "active",
    workRequired: 200,
    workCompleted: 73,
    clampProgress: true,
    entries: Object.freeze([]),
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  const progress = calculateProjectProgress(project);
  assert.equal(typeof progress.workCompleted, "number");
  assert.equal(Number.isInteger(progress.workCompleted), true);
  assert.equal(progress.workCompleted, 73);

  // Derived percent is an integer between 0 and 100
  assert.equal(typeof progress.percent, "number");
  assert.equal(Number.isInteger(progress.percent), true);
  assert.equal(progress.percent, 36); // Math.floor((73/200)*100) = 36%
  assert.equal(progress.isComplete, false);

  // DEC-090: Overprogress clamps to goal by default
  const overProject: ProjectInstance = {
    ...project,
    workCompleted: 250
  };
  const overProgress = calculateProjectProgress(overProject);
  assert.equal(overProgress.percent, 100);
  assert.equal(overProgress.isComplete, true);

  // DEC-088: Negative setbacks floor at zero
  const negativeEntry: ProjectEntry = {
    id: "entry-setback",
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence: 1,
    sourceKind: "event",
    unitsDelta: -100,
    unitsBefore: 73,
    unitsAfter: 0,
    timestamp: 2000,
    reasonCode: "STORM_DAMAGE",
    note: "Structural collapse caused by severe weather"
  };

  const setbackRes = applyProjectEntry(project, negativeEntry);
  assert.equal(setbackRes.ok, true);
  if (setbackRes.ok) {
    const updatedProject = setbackRes.value;
    assert.equal(updatedProject.workCompleted, 0); // Floored at 0
    assert.equal(updatedProject.entries.length, 1);
    assert.equal(updatedProject.entries[0].unitsDelta, -100);
  }
});

test("G5.10 Acceptance: resolver não muta (pure resolver contract)", () => {
  const resolver = new StandardProgressResolver();
  const originalProject: ProjectInstance = {
    id: "proj-resolver-test",
    definitionId: "domain-manager:basic-construction",
    domainUuid: "JournalEntry.domain-1",
    name: "Granary Construction",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "active",
    workRequired: 150,
    workCompleted: 50,
    clampProgress: true,
    entries: Object.freeze([]),
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  const snapshotBefore = JSON.stringify(originalProject);
  const resolved = resolver.resolve({
    project: originalProject,
    definition: CANONICAL_PROJECT_DEFINITIONS[0],
    domainUuid: originalProject.domainUuid,
    requestedUnits: 25,
    sourceKind: "manual"
  });

  assert.equal(resolved.ok, true);
  // Resolver returns pure resolution without mutating the original object
  const snapshotAfter = JSON.stringify(originalProject);
  assert.equal(snapshotBefore, snapshotAfter, "StandardProgressResolver must never mutate the input ProjectInstance");
});

test("G5.10 Acceptance: completion não checkbox e partial failure explícita (Master Spec §15.4)", () => {
  const domain = createBaseDomainRecord("dom-comp", "Capital Realm");
  const definition: ProjectDefinition = {
    id: "domain-manager:civic-hall",
    version: 1,
    label: "Town Hall",
    description: "Administrative center",
    category: "construction",
    tags: ["civic"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    requirements: [],
    costs: [],
    rewards: [
      {
        id: "rew-treasury",
        type: "resource",
        targetRef: "domain-manager:treasury",
        amountFormula: "500",
        description: "Civic tax bonus"
      }
    ],
    autoComplete: false
  };

  // 1. Attempting completion when workCompleted < workRequired is BLOCKED (cannot check a box)
  const incompleteProject: ProjectInstance = {
    id: "proj-incomplete",
    definitionId: definition.id,
    domainUuid: "JournalEntry.dom-comp",
    name: "Unfinished Hall",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "active",
    workRequired: 100,
    workCompleted: 80, // INCOMPLETE!
    clampProgress: true,
    entries: Object.freeze([]),
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  const prematurePlan = evaluateProjectCompletionPlan({
    project: incompleteProject,
    definition,
    domain
  });
  assert.equal(prematurePlan.isSatisfied, false);
  assert.ok(prematurePlan.blockers.some((b) => b.code === "DM_PROJECT_INCOMPLETE"));

  // 2. Project with workCompleted >= workRequired evaluates satisfied
  const completedProject: ProjectInstance = {
    ...incompleteProject,
    workCompleted: 100
  };

  const validPlan = evaluateProjectCompletionPlan({
    project: completedProject,
    definition,
    domain
  });
  assert.equal(validPlan.isSatisfied, true);

  // 3. Commit with partial failure simulation (e.g. reward dispatcher fails for economic bonus)
  const commitRes = commitProjectCompletion(validPlan, completedProject, {
    sideEffectHandlers: {
      resource: () => {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: "Treasury account does not exist"
          })
        );
      }
    }
  });

  assert.equal(commitRes.ok, true);
  if (commitRes.ok) {
    const { receipt, childReceipts, partialFailure } = commitRes.value;
    assert.equal(receipt.action, "complete");
    assert.equal(receipt.lifecycleAfter, "completed");
    // Partial failure is explicit per Master Spec §15.4 (never suppressed or concealed)
    assert.equal(partialFailure, true);
    assert.equal(childReceipts.length, 1);
    assert.equal(childReceipts[0].success, false);
    assert.equal(childReceipts[0].error, "Treasury account does not exist");
  }
});

test("G5.10 Acceptance: Project não escreve Economy/People (Boundary Preservation)", () => {
  const domain = createBaseDomainRecord("dom-boundary", "Boundary Test Realm");
  const definition: ProjectDefinition = {
    id: "domain-manager:expansion",
    version: 1,
    label: "Fortified Expansion",
    description: "Requires funding and workforce",
    category: "expansion",
    tags: ["fort"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 150,
    requirements: [],
    costs: [
      {
        resourceId: "domain-manager:supplies",
        amountMinor: 100,
        timing: "upfront"
      }
    ],
    rewards: [],
    autoComplete: false
  };

  const testProject: ProjectInstance = {
    id: "proj-boundary-1",
    definitionId: definition.id,
    domainUuid: "JournalEntry.dom-boundary",
    name: "Eastern Outpost",
    schemaVersion: 1,
    revision: 0,
    lifecycle: "draft",
    workRequired: 150,
    workCompleted: 0,
    clampProgress: true,
    entries: Object.freeze([]),
    tags: Object.freeze(["outpost"]),
    createdAt: 1000,
    updatedAt: 1000
  };

  // Evaluate Start Plan
  const startPlan = evaluateProjectStartPlan({
    project: testProject,
    definition,
    domain,
    proposedName: "Eastern Outpost",
    reservationMode: "require-full"
  });

  // Start plan produces structured economic reservations, but does NOT perform any store writes
  assert.ok(startPlan.economicReservations);
  assert.equal(startPlan.economicReservations.length, 1);
  assert.equal(startPlan.economicReservations[0].resourceId, "domain-manager:supplies");
  assert.equal(startPlan.economicReservations[0].timing, "upfront");

  // Domain record remains pristine without direct mutative leakage into Economy/People
  const currentProjects = getDomainProjectsData(domain);
  assert.equal(currentProjects.projects.length, 0);
});

test("G5.10 Acceptance: Facility lifecycle ≠ readiness (Master Spec §16, DEC-2601–2750)", () => {
  // Case A: Operational BUT blocked (e.g. unstaffed or safety lockdown)
  const facilityOperationalBlocked: FacilityInstance = {
    id: "fac-op-blocked",
    definitionId: "domain-manager:barracks",
    domainUuid: "JournalEntry.domain-1",
    name: "Infantry Barracks",
    schemaVersion: 1,
    revision: 1,
    level: 1,
    lifecycle: "operational", // Physical state is operational!
    readiness: "blocked",     // Operational readiness is blocked!
    installedModules: Object.freeze([]),
    activeUpgrades: Object.freeze([]),
    integrity: Object.freeze({ current: 100, max: 100 }),
    conditions: Object.freeze([]),
    maintenanceState: { status: "current", overdueTicks: 0, accumulatedTicks: 0 },
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  // When readiness is blocked, effective capabilities MUST be empty!
  const effectiveCapsBlocked = calculateFacilityEffectiveCapabilities(
    facilityOperationalBlocked,
    ["domain-manager:militia-training"]
  );
  assert.equal(effectiveCapsBlocked.length, 0);

  // Case B: Under Construction (lifecycle = underConstruction) and readiness = unavailable
  const facilityUnderConstruction: FacilityInstance = {
    ...facilityOperationalBlocked,
    id: "fac-under-construction",
    lifecycle: "underConstruction",
    readiness: "unavailable"
  };

  const effectiveCapsConstruction = calculateFacilityEffectiveCapabilities(
    facilityUnderConstruction,
    ["domain-manager:militia-training"]
  );
  assert.equal(effectiveCapsConstruction.length, 0);

  // Case C: Operational and ready
  const facilityReady: FacilityInstance = {
    ...facilityOperationalBlocked,
    id: "fac-ready",
    readiness: "ready"
  };

  const effectiveCapsReady = calculateFacilityEffectiveCapabilities(
    facilityReady,
    ["domain-manager:militia-training"]
  );
  assert.equal(effectiveCapsReady.length, 1);
  assert.equal(effectiveCapsReady[0], "domain-manager:militia-training");
});

test("G5.10 Acceptance: Downtime não é Project & participant != Foundry User (Master Spec §17)", () => {
  const downtimeActivity: DowntimeInstance = {
    id: "dt-acc-1",
    definitionId: "domain-manager:patrol",
    domainUuid: "JournalEntry.domain-1",
    name: "Border Reconnaissance",
    schemaVersion: 1,
    revision: 1,
    scope: "domain",
    lifecycle: "inProgress",
    elapsedTicks: 15,
    durationTicks: null, // INDEFINITE: continuous activity!
    participants: Object.freeze([
      {
        participantRef: "notable:ranger-elias", // Notable, NOT a Foundry User
        participantType: "notable",
        role: "lead-scout",
        capacityConsumed: 1
      },
      {
        participantRef: "group:light-cavalry", // Operational Group, NOT a Foundry User
        participantType: "group",
        role: "escort",
        capacityConsumed: 4
      }
    ]),
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  // Indefinite downtime does NOT auto-complete
  assert.equal(isDowntimeComplete(downtimeActivity), false);
  const progress = calculateDowntimeProgress(downtimeActivity);
  assert.equal(progress.isIndefinite, true);
  assert.equal(progress.percent, null); // Strictly null, no fake 100%

  // Participants are domain entities
  assert.equal(downtimeActivity.participants.length, 2);
  assert.equal(downtimeActivity.participants[0].participantType, "notable");
  assert.equal(downtimeActivity.participants[1].participantType, "group");
});

test("G5.10 Acceptance: history append-oriented & double reversal rejection (DEC-088)", () => {
  const project: ProjectInstance = {
    id: "proj-hist-1",
    definitionId: "domain-manager:basic-construction",
    domainUuid: "JournalEntry.domain-1",
    name: "Storehouse",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "active",
    workRequired: 100,
    workCompleted: 0,
    clampProgress: true,
    entries: Object.freeze([]),
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  // Entry 1: +40 work
  const entry1: ProjectEntry = {
    id: "entry-001",
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence: 1,
    sourceKind: "assignment",
    unitsDelta: 40,
    unitsBefore: 0,
    unitsAfter: 40,
    reasonCode: "WORKFORCE",
    timestamp: 1100
  };
  const r1 = applyProjectEntry(project, entry1);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const p1 = r1.value;
  assert.equal(p1.workCompleted, 40);
  assert.equal(p1.entries.length, 1);

  // Entry 2: +30 work
  const entry2: ProjectEntry = {
    id: "entry-002",
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence: 2,
    sourceKind: "assignment",
    unitsDelta: 30,
    unitsBefore: 40,
    unitsAfter: 70,
    reasonCode: "WORKFORCE",
    timestamp: 1200
  };
  const r2 = applyProjectEntry(p1, entry2);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  const p2 = r2.value;
  assert.equal(p2.workCompleted, 70);
  assert.equal(p2.entries.length, 2);

  // Entry 3: Reversal of entry 2 (-30 work)
  const reversalEntry: ProjectEntry = {
    id: "entry-003",
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence: 3,
    sourceKind: "reversal",
    unitsDelta: -30,
    unitsBefore: 70,
    unitsAfter: 40,
    reasonCode: "REVERSAL",
    reversesEntryId: "entry-002",
    timestamp: 1300,
    note: "Work order cancelled due to defective materials"
  };
  const r3 = applyProjectEntry(p2, reversalEntry);
  assert.equal(r3.ok, true);
  if (!r3.ok) return;
  const p3 = r3.value;
  assert.equal(p3.workCompleted, 40);
  assert.equal(p3.entries.length, 3);

  // Attempting to reverse entry 2 a second time is prohibited
  const duplicateReversal: ProjectEntry = {
    id: "entry-004",
    projectId: project.id,
    domainUuid: project.domainUuid,
    sequence: 4,
    sourceKind: "reversal",
    unitsDelta: -30,
    unitsBefore: 40,
    unitsAfter: 10,
    reasonCode: "REVERSAL",
    reversesEntryId: "entry-002", // Already reversed!
    timestamp: 1400
  };
  const dupRes = applyProjectEntry(p3, duplicateReversal);
  assert.equal(dupRes.ok, false);
  if (!dupRes.ok) {
    assert.equal(dupRes.error.code, "DM_PROJECT_REVERSAL_ALREADY_EXISTS");
  }
});

// ---------------------------------------------------------------------------
// 2. DOMAIN INTEGRITY CHECKER INTEGRATION
// ---------------------------------------------------------------------------

test("G5.10 Integration: DomainIntegrityChecker validates G5 capability configurations", () => {
  const validDomain = createBaseDomainRecord("dom-integrity-1", "Valid Domain");
  const checker = new DomainIntegrityChecker({
    capabilityRegistry: domainCapabilityRegistry
  });

  const validDoc: DomainIntegrityDocument = {
    id: "dom-integrity-1",
    uuid: "JournalEntry.dom-integrity-1",
    name: "Valid Domain",
    record: validDomain
  };

  const validReport = checker.check([validDoc]);
  assert.equal(validReport.healthy, true);
  assert.equal(validReport.errorCount, 0);

  // Corrupt Projects capability data (e.g. invalid projects array type)
  const corruptProjectsDomain: DomainRecord = {
    ...validDomain,
    definition: {
      ...validDomain.definition,
      capabilities: {
        ...validDomain.definition.capabilities,
        config: {
          ...validDomain.definition.capabilities.config,
          "domain-manager:projects": {
            schemaVersion: 1,
            projects: "NOT_AN_ARRAY" // Corrupt!
          }
        }
      }
    }
  };

  const corruptProjectsDoc: DomainIntegrityDocument = {
    id: "dom-corrupt-proj",
    uuid: "JournalEntry.dom-corrupt-proj",
    name: "Corrupt Projects Domain",
    record: corruptProjectsDomain
  };

  const corruptProjectsReport = checker.check([corruptProjectsDoc]);
  assert.equal(corruptProjectsReport.healthy, false);
  assert.ok(corruptProjectsReport.issues.some((i) => i.code === "DM_CAPABILITY_CONFIG_INVALID"));

  // Corrupt Facilities capability data (e.g. missing schemaVersion)
  const corruptFacilitiesDomain: DomainRecord = {
    ...validDomain,
    definition: {
      ...validDomain.definition,
      capabilities: {
        ...validDomain.definition.capabilities,
        config: {
          ...validDomain.definition.capabilities.config,
          "domain-manager:facilities": {
            schemaVersion: 999, // Invalid schema version!
            facilities: []
          }
        }
      }
    }
  };

  const corruptFacilitiesDoc: DomainIntegrityDocument = {
    id: "dom-corrupt-fac",
    uuid: "JournalEntry.dom-corrupt-fac",
    name: "Corrupt Facilities Domain",
    record: corruptFacilitiesDomain
  };

  const corruptFacilitiesReport = checker.check([corruptFacilitiesDoc]);
  assert.equal(corruptFacilitiesReport.healthy, false);
  assert.ok(corruptFacilitiesReport.issues.some((i) => i.code === "DM_CAPABILITY_CONFIG_INVALID"));

  // Corrupt Downtime capability data
  const corruptDowntimeDomain: DomainRecord = {
    ...validDomain,
    definition: {
      ...validDomain.definition,
      capabilities: {
        ...validDomain.definition.capabilities,
        config: {
          ...validDomain.definition.capabilities.config,
          "domain-manager:downtime": "INVALID_PRIMITIVE" // Corrupt!
        }
      }
    }
  };

  const corruptDowntimeDoc: DomainIntegrityDocument = {
    id: "dom-corrupt-dt",
    uuid: "JournalEntry.dom-corrupt-dt",
    name: "Corrupt Downtime Domain",
    record: corruptDowntimeDomain
  };

  const corruptDowntimeReport = checker.check([corruptDowntimeDoc]);
  assert.equal(corruptDowntimeReport.healthy, false);
  assert.ok(corruptDowntimeReport.issues.some((i) => i.code === "DM_CAPABILITY_CONFIG_INVALID"));
});

// ---------------------------------------------------------------------------
// 3. HIGH-VOLUME SCALE & MULTI-DOMAIN STRESS TESTING
// ---------------------------------------------------------------------------

test("G5.10 Scale & Stress: 10 Domains, 25+ Projects, 30+ Facilities, 20+ Downtime Activities", async () => {
  const NUM_DOMAINS = 10;
  const docs: IdentifiedJournalEntryDocumentLike[] = [];
  const projectRegistry = createDefaultProjectRegistry();
  const facilityRegistry = createDefaultFacilityRegistry();
  const downtimeRegistry = createDefaultDowntimeRegistry();

  for (let i = 1; i <= NUM_DOMAINS; i++) {
    const domainId = `dom-scale-${i}`;
    const domainRecord = createBaseDomainRecord(domainId, `Scale Realm ${i}`);
    const doc = createMockDocument(domainId, `Scale Realm ${i}`, domainRecord);
    docs.push(doc);
  }

  const store = createMockStore(docs);
  const repo = new StorageDomainRepository(store);

  // 1. Seed 25+ Projects across domains
  const projectIds: string[] = [];
  let totalProjectsCreated = 0;

  for (let i = 1; i <= NUM_DOMAINS; i++) {
    const domainId = `dom-scale-${i}`;
    const readRes = await repo.read(domainId);
    assert.equal(readRes.ok, true);
    let record = readRes.value.record;
    let projData = getDomainProjectsData(record);

    const projectsForThisDomain: ProjectInstance[] = [];
    const count = i <= 5 ? 3 : 2; // 5*3 + 5*2 = 25 projects
    for (let p = 1; p <= count; p++) {
      totalProjectsCreated++;
      const pId = `proj-${domainId}-${p}`;
      projectIds.push(pId);
      projectsForThisDomain.push({
        id: pId,
        definitionId: "domain-manager:basic-construction",
        domainUuid: `JournalEntry.${domainId}`,
        name: `Project ${totalProjectsCreated} on ${domainId}`,
        schemaVersion: 1,
        revision: 0,
        lifecycle: "active",
        workRequired: 100,
        workCompleted: 0,
        clampProgress: true,
        entries: Object.freeze([]),
        tags: Object.freeze([`domain-${i}`]),
        createdAt: 1000,
        updatedAt: 1000
      });
    }

    record = withDomainProjectsData(record, {
      ...projData,
      projects: Object.freeze(projectsForThisDomain)
    });
    await repo.save({ ...readRes.value, record });
  }

  assert.equal(totalProjectsCreated, 25);

  // 2. Advance all projects through 5 successive batches of work
  for (let batch = 1; batch <= 5; batch++) {
    for (let i = 1; i <= NUM_DOMAINS; i++) {
      const domainId = `dom-scale-${i}`;
      const readRes = await repo.read(domainId);
      assert.equal(readRes.ok, true);
      let record = readRes.value.record;
      let projData = getDomainProjectsData(record);

      const updatedProjects = projData.projects.map((proj) => {
        const delta = 15; // 5 * 15 = 75 work units completed
        const newTotal = proj.workCompleted + delta;
        const entry: ProjectEntry = {
          id: `entry-${proj.id}-batch-${batch}`,
          projectId: proj.id,
          domainUuid: proj.domainUuid,
          sequence: batch,
          unitsDelta: delta,
          unitsBefore: proj.workCompleted,
          unitsAfter: newTotal,
          sourceKind: "assignment",
          reasonCode: "WORKFORCE",
          timestamp: 1000 + batch * 100
        };
        return {
          ...proj,
          workCompleted: newTotal,
          revision: proj.revision + 1,
          updatedAt: 1000 + batch * 100,
          entries: Object.freeze([...proj.entries, entry])
        };
      });

      record = withDomainProjectsData(record, {
        ...projData,
        projects: Object.freeze(updatedProjects)
      });
      const saveRes = await repo.save({ ...readRes.value, record });
      assert.equal(saveRes.ok, true);
    }
  }

  // Verify all 25 projects have 5 history entries and 75 work units
  for (let i = 1; i <= NUM_DOMAINS; i++) {
    const domainId = `dom-scale-${i}`;
    const readRes = await repo.read(domainId);
    assert.equal(readRes.ok, true);
    const projData = getDomainProjectsData(readRes.value.record);
    for (const p of projData.projects) {
      assert.equal(p.workCompleted, 75);
      assert.equal(p.entries.length, 5);
      assert.equal(p.revision, 5);
    }
  }

  // 3. Seed 30 Facilities across domains with maintenance states
  let totalFacilitiesCreated = 0;
  for (let i = 1; i <= NUM_DOMAINS; i++) {
    const domainId = `dom-scale-${i}`;
    const readRes = await repo.read(domainId);
    assert.equal(readRes.ok, true);
    let record = readRes.value.record;
    let facData = getDomainFacilitiesData(record);

    const facilitiesForThisDomain: FacilityInstance[] = [];
    for (let f = 1; f <= 3; f++) { // 10 * 3 = 30 facilities
      totalFacilitiesCreated++;
      const fId = `fac-${domainId}-${f}`;
      const isDegraded = f === 3;
      facilitiesForThisDomain.push({
        id: fId,
        definitionId: "domain-manager:basic-workshop",
        domainUuid: `JournalEntry.${domainId}`,
        name: `Facility ${totalFacilitiesCreated} on ${domainId}`,
        schemaVersion: 1,
        revision: 0,
        level: 1,
        lifecycle: isDegraded ? "degraded" : "operational",
        readiness: isDegraded ? "blocked" : "ready",
        installedModules: Object.freeze([]),
        activeUpgrades: Object.freeze([]),
        integrity: Object.freeze({ current: isDegraded ? 35 : 100, max: 100 }),
        conditions: isDegraded
          ? Object.freeze([
              {
                id: `cond-${fId}`,
                type: "domain-manager:damaged",
                label: "Worn Foundation",
                severity: "moderate" as const,
                description: "Foundation wear",
                causesDegradation: true,
                suppressesCapabilities: Object.freeze([])
              }
            ])
          : Object.freeze([]),
        maintenanceState: {
          status: isDegraded ? "overdue" : "current",
          overdueTicks: isDegraded ? 10 : 0,
          accumulatedTicks: isDegraded ? 40 : 0
        },
        tags: Object.freeze([]),
        createdAt: 1000,
        updatedAt: 1000
      });
    }

    record = withDomainFacilitiesData(record, {
      ...facData,
      facilities: Object.freeze(facilitiesForThisDomain)
    });
    await repo.save({ ...readRes.value, record });
  }

  assert.equal(totalFacilitiesCreated, 30);

  // 4. Seed 20 Downtime Activities across domains
  let totalDowntimeCreated = 0;
  for (let i = 1; i <= NUM_DOMAINS; i++) {
    const domainId = `dom-scale-${i}`;
    const readRes = await repo.read(domainId);
    assert.equal(readRes.ok, true);
    let record = readRes.value.record;
    let dtData = getDomainDowntimeData(record);

    const downtimeForThisDomain: DowntimeInstance[] = [];
    for (let d = 1; d <= 2; d++) { // 10 * 2 = 20 downtime activities
      totalDowntimeCreated++;
      const dtId = `dt-${domainId}-${d}`;
      const isIndefinite = d === 1;
      downtimeForThisDomain.push({
        id: dtId,
        definitionId: "domain-manager:patrol",
        domainUuid: `JournalEntry.${domainId}`,
        name: `Endeavor ${totalDowntimeCreated}`,
        schemaVersion: 1,
        revision: 0,
        scope: "domain",
        lifecycle: "inProgress",
        elapsedTicks: 10,
        durationTicks: isIndefinite ? null : 30,
        participants: Object.freeze([
          {
            participantRef: `notable:agent-${i}-${d}`,
            participantType: "notable",
            role: "scout",
            capacityConsumed: 1
          }
        ]),
        tags: Object.freeze([]),
        createdAt: 1000,
        updatedAt: 1000
      });
    }

    record = withDomainDowntimeData(record, {
      ...dtData,
      activities: Object.freeze(downtimeForThisDomain)
    });
    await repo.save({ ...readRes.value, record });
  }

  assert.equal(totalDowntimeCreated, 20);

  // 5. Build ViewModels across all 10 domains and verify UI presenters at scale
  for (let i = 1; i <= NUM_DOMAINS; i++) {
    const domainId = `dom-scale-${i}`;
    const readRes = await repo.read(domainId);
    assert.equal(readRes.ok, true);
    const domainRecord = readRes.value.record;

    const projVM = buildProjectsViewModel(domainRecord, { viewerIsGm: true, projectRegistry });
    assert.equal(projVM.projects.length, i <= 5 ? 3 : 2);
    for (const p of projVM.projects) {
      assert.equal(p.progressPercent, 75);
      assert.equal(p.statusBadgeClass, "dm-badge-active");
    }

    const facVM = buildFacilitiesViewModel(domainRecord, { viewerIsGm: true, facilityRegistry });
    assert.equal(facVM.facilities.length, 3);
    assert.equal(facVM.operationalCount, 2);
    assert.equal(facVM.degradedOrDamagedCount, 1);

    const dtVM = buildDowntimeViewModel(domainRecord, { viewerIsGm: true, downtimeRegistry });
    assert.equal(dtVM.activities.length, 2);
    const indef = dtVM.activities.find((a) => a.isIndefinite)!;
    assert.ok(indef);
    assert.equal(indef.progressPercent, null);
    const finite = dtVM.activities.find((a) => !a.isIndefinite)!;
    assert.ok(finite);
    assert.equal(finite.progressPercent, 33); // 10/30 = 33%
  }

  // 6. Verify full DomainIntegrityChecker health across all 10 scaled domains
  const integrityChecker = new DomainIntegrityChecker({
    capabilityRegistry: domainCapabilityRegistry
  });
  const allDocs: DomainIntegrityDocument[] = [];
  for (let i = 1; i <= NUM_DOMAINS; i++) {
    const domainId = `dom-scale-${i}`;
    const readRes = await repo.read(domainId);
    assert.equal(readRes.ok, true);
    allDocs.push({
      id: domainId,
      uuid: `JournalEntry.${domainId}`,
      name: `Scale Realm ${i}`,
      record: readRes.value.record
    });
  }

  const scaleReport = integrityChecker.check(allDocs);
  assert.equal(scaleReport.checked, 10);
  assert.equal(scaleReport.healthy, true);
  assert.equal(scaleReport.errorCount, 0);
  assert.equal(scaleReport.warningCount, 0);
});

// ---------------------------------------------------------------------------
// 4. ADVERSARIAL & CONCURRENCY VALIDATIONS
// ---------------------------------------------------------------------------

test("G5.10 Adversarial: optimistic locking and stale revision rejection", async () => {
  const domain = createBaseDomainRecord("dom-adv", "Adversarial Realm");
  const definition: ProjectDefinition = {
    id: "domain-manager:palisade",
    version: 1,
    label: "Palisade",
    description: "Defenses",
    category: "construction",
    tags: ["wall"],
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    requirements: [],
    costs: [],
    rewards: [],
    autoComplete: false
  };

  const project: ProjectInstance = {
    id: "proj-rev-test",
    definitionId: definition.id,
    domainUuid: "JournalEntry.dom-adv",
    name: "North Wall",
    schemaVersion: 1,
    revision: 3, // Current revision is 3!
    lifecycle: "active",
    workRequired: 100,
    workCompleted: 20,
    clampProgress: true,
    entries: Object.freeze([]),
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  // Caller sends expectedRevision: 2 (STALE!)
  const stalePlan = evaluateProjectAdvancePlan({
    project,
    definition,
    domain,
    proposedDelta: 10,
    expectedRevision: 2 // Does not match revision 3!
  });

  assert.equal(stalePlan.isSatisfied, false);
  assert.ok(stalePlan.blockers.some((b) => b.category === "revision" || b.code.includes("REVISION")));
});

test("G5.10 Adversarial: illegal lifecycle transitions are strictly rejected", () => {
  // 1. completed -> active is illegal without explicit allowReopen
  const completedTransition = validateProjectLifecycleTransition("completed", "active");
  assert.equal(completedTransition.ok, false);
  assert.equal(completedTransition.error.code, "DM_PROJECT_INVALID_TRANSITION");

  // Reopening with allowReopen: true is permitted per DEC-097
  const reopenTransition = validateProjectLifecycleTransition("completed", "active", { allowReopen: true });
  assert.equal(reopenTransition.ok, true);

  // 2. cancelled -> active is illegal even with allowReopen
  const cancelledTransition = validateProjectLifecycleTransition("cancelled", "active", { allowReopen: true });
  assert.equal(cancelledTransition.ok, false);

  // 3. failed -> completed is completely illegal
  const failedToCompleted = validateProjectLifecycleTransition("failed", "completed");
  assert.equal(failedToCompleted.ok, false);
});
