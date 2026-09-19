import test from "node:test";
import assert from "node:assert/strict";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { createDefaultProjectRegistry } from "../../src/projects/definitions/project-registry.js";
import { createDefaultFacilityRegistry } from "../../src/facilities/definitions/facility-registry.js";
import {
  DowntimeDefinitionRegistry,
  createDefaultDowntimeRegistry
} from "../../src/downtime/definitions/downtime-registry.js";
import { CANONICAL_DOWNTIME_DEFINITIONS } from "../../src/downtime/definitions/canonical-downtime-definitions.js";
import {
  createDefaultDomainProjectsData,
  withDomainProjectsData,
  type DomainProjectsData
} from "../../src/projects/project-data.js";
import {
  createDefaultDomainFacilitiesData,
  withDomainFacilitiesData,
  type DomainFacilitiesData
} from "../../src/facilities/facility-data.js";
import {
  createDefaultDomainDowntimeData,
  withDomainDowntimeData,
  type DomainDowntimeData
} from "../../src/downtime/downtime-data.js";
import type { ProjectInstance } from "../../src/projects/types/project-types.js";
import type { FacilityInstance } from "../../src/facilities/types/facility-types.js";
import type { DowntimeInstance } from "../../src/downtime/types/downtime-types.js";
import {
  buildProjectsViewModel
} from "../../src/ui/domain-patterns/projects/project-presenter.js";
import {
  renderProjectsSubsystemHtml,
  renderProjectsTableHtml,
  renderProjectDetailModalHtml,
  renderProjectStartModalHtml
} from "../../src/ui/domain-patterns/projects/project-view.js";
import {
  ProjectsApplication,
  ProjectsApplicationController
} from "../../src/ui/domain-patterns/projects/project-app.js";
import {
  buildFacilitiesViewModel
} from "../../src/ui/domain-patterns/facilities/facility-presenter.js";
import {
  renderFacilitiesSubsystemHtml,
  renderFacilityDetailModalHtml,
  renderFacilityCommissionModalHtml,
  renderFacilityMaintenanceModalHtml,
  renderFacilityRepairModalHtml
} from "../../src/ui/domain-patterns/facilities/facility-view.js";
import {
  FacilitiesApplication,
  FacilitiesApplicationController
} from "../../src/ui/domain-patterns/facilities/facility-app.js";
import {
  buildDowntimeViewModel
} from "../../src/ui/domain-patterns/downtime/downtime-presenter.js";
import {
  renderDowntimeSubsystemHtml,
  renderDowntimeDetailModalHtml,
  renderDowntimeStartModalHtml
} from "../../src/ui/domain-patterns/downtime/downtime-view.js";
import {
  DowntimeApplication,
  DowntimeApplicationController
} from "../../src/ui/domain-patterns/downtime/downtime-app.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { CommandBus } from "../../src/commands/command-bus.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import { ProjectsService } from "../../src/projects/services/projects-service.js";
import { registerProjectCommands } from "../../src/projects/commands/project-commands.js";
import { FacilitiesService } from "../../src/facilities/services/facilities-service.js";
import { registerFacilityCommands } from "../../src/facilities/commands/facility-commands.js";
import { DowntimeService } from "../../src/downtime/services/downtime-service.js";
import { registerDowntimeCommands } from "../../src/downtime/commands/downtime-commands.js";

const testRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "G5 UI Test Domain", description: "Testing G5 UI Subsystems" },
    classification: { kind: "base", scale: "small", tags: ["g5-test"] },
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

function createMockDocument(
  id: string,
  name: string,
  record: DomainRecord = testRecord,
  ownership: Record<string, number | string> = {}
): IdentifiedJournalEntryDocumentLike {
  let currentName = name;
  let currentFlags: Readonly<Record<string, unknown>> = { "domain-manager": record };
  let currentOwnership: Record<string, number | string> = { ...ownership };

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
      const id = `je-g5-${nextId++}`;
      const doc = createMockDocument(id, data.name, data.flags["domain-manager"] as any, (data.ownership ?? {}) as any);
      register(doc);
      return doc;
    }
  };
}

function createMockCommandBus(repo?: StorageDomainRepository): CommandBus {
  const registry = new CommandRegistry();
  const authorityService = new PrimaryAuthorityService(
    {
      getUsers: () => [{ id: "gm-1", isGM: true, active: true }],
      getPreferredUserId: () => null,
      getCurrentUserId: () => "gm-1"
    },
    { authorityUserId: "gm-1", authorityEpoch: 1, initialized: true }
  );
  const bus = new CommandBus({ registry, authorityService });

  if (repo) {
    const projectRegistry = createDefaultProjectRegistry();
    const facilityRegistry = createDefaultFacilityRegistry();
    const downtimeRegistry = new DowntimeDefinitionRegistry();
    for (const def of CANONICAL_DOWNTIME_DEFINITIONS) {
      downtimeRegistry.register(def);
    }

    if (!projectRegistry.has("domain-manager:basic-construction")) {
      projectRegistry.register({
        id: "domain-manager:basic-construction",
        version: 1,
        label: "Basic Construction",
        category: "infrastructure",
        scale: "small",
        schemaVersion: 1,
        targetRefKind: "domain",
        workRequiredFormula: "100",
        workforceRequirements: [],
        prerequisites: [],
        costFormulas: [],
        resolverId: "linear",
        completionEffects: []
      } as any);
    }

    if (!facilityRegistry.has("domain-manager:granary")) {
      facilityRegistry.register({
        id: "domain-manager:granary",
        version: 1,
        label: "Granary",
        category: "agriculture",
        tags: ["food"],
        scale: "building",
        maxLevel: 3,
        capabilitiesGranted: [],
        defaultReadiness: "ready",
        maintenance: {
          intervalTicks: 30,
          gracePeriodTicks: 5,
          costFormula: "10",
          costs: []
        },
        repair: {
          directRepairAllowed: true,
          projectThresholdIntegrity: 20
        }
      });
    }

    if (!downtimeRegistry.has("domain-manager:guard-patrol")) {
      downtimeRegistry.register({
        id: "domain-manager:guard-patrol",
        version: 1,
        label: "Guard Patrol",
        tags: ["security"],
        scope: "domain",
        defaultDurationTicks: 20,
        minParticipants: 0
      });
    }

    const projectsService = new ProjectsService({
      domains: repo,
      projectRegistry
    });

    const facilitiesService = new FacilitiesService({
      domains: repo,
      facilityRegistry
    });

    const downtimeService = new DowntimeService({
      domains: repo,
      downtimeRegistry
    });

    registerProjectCommands({
      registry,
      projectsService,
      domains: repo
    });

    registerFacilityCommands({
      registry,
      facilitiesService,
      domains: repo
    });

    registerDowntimeCommands({
      registry,
      downtimeService,
      domains: repo
    });

    (bus as any).__downtimeRegistry = downtimeRegistry;
  } else {
    registry.register({ type: "projects:start-project", visibility: "public", handler: async () => ok({}) });
    registry.register({ type: "facilities:create-facility", visibility: "public", handler: async () => ok({}) });
    registry.register({ type: "downtime:start-activity", visibility: "public", handler: async () => ok({}) });
  }

  return bus;
}

// ---------------------------------------------------------------------------
// 1. PROJECTS UI PRESENTER & VIEW TESTS
// ---------------------------------------------------------------------------

test("G5.9 - Projects Presenter: derives integer progress, status badges, and summary counts", () => {
  const project1: ProjectInstance = {
    id: "proj-1",
    definitionId: "domain-manager:build-palisade",
    domainUuid: "JournalEntry.test-domain",
    name: "North Palisade Wall",
    schemaVersion: 1,
    revision: 2,
    lifecycle: "active",
    workRequired: 100,
    workCompleted: 45,
    entries: Object.freeze([]),
    tags: Object.freeze(["defense"]),
    createdAt: 1000,
    updatedAt: 1200
  };

  const project2: ProjectInstance = {
    id: "proj-2",
    definitionId: "domain-manager:dig-trench",
    domainUuid: "JournalEntry.test-domain",
    name: "Moat Excavation",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "blocked",
    blockedReason: "Severe flooding in eastern trench",
    workRequired: 80,
    workCompleted: 40,
    entries: Object.freeze([]),
    tags: Object.freeze(["secret"]),
    createdAt: 1000,
    updatedAt: 1100
  };

  const domain = withDomainProjectsData(testRecord, {
    schemaVersion: 1,
    projects: Object.freeze([project1, project2])
  });

  const registry = createDefaultProjectRegistry();

  // GM view sees both projects including secret
  const gmVM = buildProjectsViewModel(domain, {
    viewerIsGm: true,
    projectRegistry: registry
  });

  assert.equal(gmVM.totalCount, 2);
  assert.equal(gmVM.activeCount, 1);
  assert.equal(gmVM.blockedCount, 1);
  assert.equal(gmVM.projects.length, 2);

  const vmProj1 = gmVM.projects.find((p) => p.id === "proj-1")!;
  assert.equal(vmProj1.progressPercent, 45); // Strictly integer
  assert.equal(vmProj1.statusBadgeClass, "dm-badge-active");
  assert.equal(vmProj1.canAdvance, true);
  assert.equal(vmProj1.canPause, true);

  const vmProj2 = gmVM.projects.find((p) => p.id === "proj-2")!;
  assert.equal(vmProj2.progressPercent, 50); // 40/80 = 50%
  assert.equal(vmProj2.statusBadgeClass, "dm-badge-blocked");
  assert.equal(vmProj2.blockers.length, 1);
  assert.equal(vmProj2.blockers[0].message, "Severe flooding in eastern trench");
  assert.equal(vmProj2.isSecret, true);

  // Non-GM view filters out secret project
  const playerVM = buildProjectsViewModel(domain, {
    viewerIsGm: false,
    projectRegistry: registry
  });

  assert.equal(playerVM.projects.length, 1);
  assert.equal(playerVM.projects[0].id, "proj-1");
  assert.equal(playerVM.projects.some((p) => p.id === "proj-2"), false);
});

test("G5.9 - Projects View: renders semantic HTML and escapes malicious input (XSS check)", () => {
  const maliciousProject: ProjectInstance = {
    id: "proj-xss",
    definitionId: "domain-manager:build-palisade",
    domainUuid: "JournalEntry.test-domain",
    name: "<script>alert('pwned')</script> Palisade",
    description: "Malicious <img src=x onerror=alert(1)> description",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "active",
    workRequired: 50,
    workCompleted: 25,
    entries: Object.freeze([]),
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  const domain = withDomainProjectsData(testRecord, {
    schemaVersion: 1,
    projects: Object.freeze([maliciousProject])
  });

  const vm = buildProjectsViewModel(domain, { viewerIsGm: true });
  const html = renderProjectsSubsystemHtml(vm);

  assert.match(html, /&lt;script&gt;alert\(&#39;pwned&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\('pwned'\)<\/script>/);

  const detailHtml = renderProjectDetailModalHtml(vm.projects[0]);
  assert.match(detailHtml, /&lt;script&gt;alert\(&#39;pwned&#39;\)&lt;\/script&gt;/);
  assert.match(detailHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(detailHtml, /50%/); // 25/50

  const startModalHtml = renderProjectStartModalHtml("JournalEntry.test-domain", [
    {
      id: "domain-manager:build-palisade",
      label: "<evil> Palisade",
      description: "Defense",
      category: "infrastructure",
      scale: "small",
      schemaVersion: 1,
      targetRefKind: "domain",
      workRequiredFormula: "50",
      workforceRequirements: [],
      prerequisites: [],
      costFormulas: [],
      resolverId: "linear",
      completionEffects: []
    } as any
  ]);
  assert.match(startModalHtml, /&lt;evil&gt; Palisade/);
  assert.doesNotMatch(startModalHtml, /<evil> Palisade/);
});

test("G5.9 - Projects Controller: start, advance, pause, resume, cancel flow", async () => {
  const doc = createMockDocument("domain-1", "Test Domain", testRecord);
  const store = createMockStore([doc]);
  const repo = new StorageDomainRepository(store);
  const commandBus = createMockCommandBus(repo);

  const controller = new ProjectsApplicationController({
    domainUuid: "JournalEntry.domain-1",
    domains: repo,
    commandBus
  });

  // 1. Start project
  const startRes = await controller.dispatchStartProject({
    definitionId: "domain-manager:basic-construction",
    name: "West Palisade",
    workRequired: 100
  });
  assert.equal(startRes.ok, true);
  const projectId = (startRes as any).value.projectId;
  assert.ok(projectId);

  // 2. Load ViewModel
  const loadRes = await controller.loadViewModel();
  assert.equal(loadRes.ok, true);
  assert.equal(loadRes.value.projects.length, 1);
  assert.equal(loadRes.value.projects[0].label, "West Palisade");
  assert.equal(loadRes.value.projects[0].lifecycle, "active");

  // 3. Advance project
  const advRes = await controller.dispatchAdvanceProject({
    projectId,
    units: 30,
    notes: "Day 1 construction"
  });
  assert.equal(advRes.ok, true);

  // 4. Pause project
  const pauseRes = await controller.dispatchPauseProject(projectId, "Inclement weather");
  assert.equal(pauseRes.ok, true);

  const vmAfterPause = (await controller.loadViewModel()).value;
  const pAfterPause = vmAfterPause.projects.find((p) => p.id === projectId)!;
  assert.equal(pAfterPause.lifecycle, "paused");

  // 5. Resume project
  const resumeRes = await controller.dispatchResumeProject(projectId);
  assert.equal(resumeRes.ok, true);

  const vmAfterResume = (await controller.loadViewModel()).value;
  const pAfterResume = vmAfterResume.projects.find((p) => p.id === projectId)!;
  assert.equal(pAfterResume.lifecycle, "active");

  // 6. Cancel project
  const cancelRes = await controller.dispatchCancelProject(projectId, "Strategic abandonment");
  assert.equal(cancelRes.ok, true);

  const vmAfterCancel = (await controller.loadViewModel()).value;
  const pAfterCancel = vmAfterCancel.projects.find((p) => p.id === projectId)!;
  assert.equal(pAfterCancel.lifecycle, "cancelled");
});

// ---------------------------------------------------------------------------
// 2. FACILITIES UI PRESENTER & VIEW TESTS (INVARIANT: lifecycle != readiness)
// ---------------------------------------------------------------------------

test("G5.9 - Facilities Presenter: enforces lifecycle != readiness invariant and structural integrity classes", () => {
  // Facility 1: Operational BUT unready (e.g. unstaffed or uncommissioned)
  const facility1: FacilityInstance = {
    id: "fac-1",
    definitionId: "domain-manager:granary",
    domainUuid: "JournalEntry.test-domain",
    name: "Royal Granary",
    schemaVersion: 1,
    revision: 1,
    level: 2,
    lifecycle: "operational",
    readiness: "limited",
    installedModules: Object.freeze([]),
    activeUpgrades: Object.freeze([]),
    integrity: Object.freeze({ current: 90, max: 100 }), // 90% -> healthy
    conditions: Object.freeze([]),
    maintenanceState: {
      status: "current",
      overdueTicks: 0,
      accumulatedTicks: 5
    },
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  // Facility 2: Degraded lifecycle AND blocked readiness, low integrity
  const facility2: FacilityInstance = {
    id: "fac-2",
    definitionId: "domain-manager:barracks",
    domainUuid: "JournalEntry.test-domain",
    name: "Old Guard Barracks",
    schemaVersion: 1,
    revision: 3,
    level: 1,
    lifecycle: "degraded",
    readiness: "blocked",
    installedModules: Object.freeze([]),
    activeUpgrades: Object.freeze([]),
    integrity: Object.freeze({ current: 30, max: 100 }), // 30% -> danger (< 40)
    conditions: Object.freeze([
      {
        id: "cond-1",
        type: "domain-manager:damaged",
        label: "Roof Collapse",
        severity: "major",
        description: "Roof collapse in west wing",
        causesDegradation: true,
        suppressesCapabilities: Object.freeze(["training"])
      }
    ]),
    maintenanceState: {
      status: "overdue",
      overdueTicks: 15,
      accumulatedTicks: 45
    },
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  const domain = withDomainFacilitiesData(testRecord, {
    schemaVersion: 1,
    facilities: Object.freeze([facility1, facility2])
  });

  const vm = buildFacilitiesViewModel(domain, { viewerIsGm: true });

  assert.equal(vm.totalCount, 2);
  assert.equal(vm.operationalCount, 1);
  assert.equal(vm.readyCount, 0);
  assert.equal(vm.degradedOrDamagedCount, 2);

  // Invariant verification: facility 1 has operational lifecycle BUT limited readiness
  const f1VM = vm.facilities.find((f) => f.id === "fac-1")!;
  assert.equal(f1VM.lifecycle, "operational");
  assert.equal(f1VM.lifecycleBadgeClass, "dm-badge-operational");
  assert.equal(f1VM.readiness, "limited");
  assert.equal(f1VM.readinessBadgeClass, "dm-badge-limited");
  assert.notEqual(f1VM.lifecycle, f1VM.readiness); // Distinct concepts!
  assert.equal(f1VM.integrityClass, "healthy");
  assert.equal(f1VM.integrityPercent, 90);

  // Facility 2: condition and danger integrity
  const f2VM = vm.facilities.find((f) => f.id === "fac-2")!;
  assert.equal(f2VM.lifecycle, "degraded");
  assert.equal(f2VM.readiness, "blocked");
  assert.equal(f2VM.integrityClass, "danger");
  assert.equal(f2VM.integrityPercent, 30);
  assert.equal(f2VM.conditions.length, 1);
  assert.equal(f2VM.conditions[0].severityBadgeClass, "dm-badge-warning");
  assert.equal(f2VM.maintenance.status, "overdue");
  assert.equal(f2VM.maintenance.statusBadgeClass, "dm-badge-warning");
});

test("G5.9 - Facilities View: renders dual badges and escapes malicious input", () => {
  const maliciousFacility: FacilityInstance = {
    id: "fac-xss",
    definitionId: "domain-manager:granary",
    domainUuid: "JournalEntry.test-domain",
    name: "<script>hack()</script> Granary",
    schemaVersion: 1,
    revision: 1,
    level: 1,
    lifecycle: "operational",
    readiness: "ready",
    installedModules: Object.freeze([]),
    activeUpgrades: Object.freeze([]),
    integrity: Object.freeze({ current: 60, max: 100 }), // 60% -> warning
    conditions: Object.freeze([
      {
        id: "cond-xss",
        type: "domain-manager:damaged",
        label: "Hazard",
        severity: "critical",
        description: "<img src=x onerror=alert(2)> Hazard",
        causesDegradation: true,
        suppressesCapabilities: Object.freeze([])
      }
    ]),
    maintenanceState: {
      status: "due",
      overdueTicks: 0,
      accumulatedTicks: 30
    },
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  const domain = withDomainFacilitiesData(testRecord, {
    schemaVersion: 1,
    facilities: Object.freeze([maliciousFacility])
  });

  const vm = buildFacilitiesViewModel(domain, { viewerIsGm: true });
  const html = renderFacilitiesSubsystemHtml(vm);

  assert.match(html, /&lt;script&gt;hack\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>hack\(\)<\/script>/);
  assert.match(html, /dm-badge-operational/);
  assert.match(html, /dm-badge-ready/);

  const detailHtml = renderFacilityDetailModalHtml(vm.facilities[0]);
  assert.match(detailHtml, /&lt;img src=x onerror=alert\(2\)&gt;/);
  assert.doesNotMatch(detailHtml, /<img src=x onerror=alert\(2\)>/);
  assert.match(detailHtml, /60%/);

  const maintModalHtml = renderFacilityMaintenanceModalHtml(vm.facilities[0]);
  assert.match(maintModalHtml, /&lt;script&gt;hack\(\)&lt;\/script&gt;/);

  const repairModalHtml = renderFacilityRepairModalHtml(vm.facilities[0]);
  assert.match(repairModalHtml, /&lt;script&gt;hack\(\)&lt;\/script&gt;/);
});

test("G5.9 - Facilities Controller: create, maintain, damage, repair flow", async () => {
  const doc = createMockDocument("domain-2", "Test Domain 2", testRecord);
  const store = createMockStore([doc]);
  const repo = new StorageDomainRepository(store);
  const commandBus = createMockCommandBus(repo);

  const controller = new FacilitiesApplicationController({
    domainUuid: "JournalEntry.domain-2",
    domains: repo,
    commandBus
  });

  // 1. Create facility
  const createRes = await controller.dispatchCreateFacility({
    definitionId: "domain-manager:granary",
    name: "South Silo",
    level: 1,
    initialLifecycle: "operational"
  });
  assert.equal(createRes.ok, true);
  const facilityId = (createRes as any).value.facilityId;
  assert.ok(facilityId);

  // 2. Load ViewModel
  const loadRes = await controller.loadViewModel();
  assert.equal(loadRes.ok, true);
  assert.equal(loadRes.value.facilities.length, 1);
  assert.equal(loadRes.value.facilities[0].name, "South Silo");
  assert.equal(loadRes.value.facilities[0].lifecycle, "operational");
  assert.equal(loadRes.value.facilities[0].readiness, "ready");

  // 3. Maintain facility
  const maintRes = await controller.dispatchMaintainFacility({
    facilityId,
    notes: "Quarterly inspection"
  });
  assert.equal(maintRes.ok, true);

  // 4. Damage facility
  const dmgRes = await controller.dispatchDamageFacility({
    facilityId,
    damageAmount: 40,
    condition: {
      id: "cond-rot",
      type: "domain-manager:damaged",
      label: "Timber Rot",
      severity: "minor",
      description: "Timber rot in lower foundation",
      causesDegradation: false,
      suppressesCapabilities: Object.freeze([])
    }
  });
  assert.equal(dmgRes.ok, true);

  const vmAfterDamage = (await controller.loadViewModel()).value;
  const fAfterDamage = vmAfterDamage.facilities.find((f) => f.id === facilityId)!;
  assert.equal(fAfterDamage.structuralIntegrity, 60); // 100 - 40
  assert.equal(fAfterDamage.integrityPercent, 60);
  assert.equal(fAfterDamage.integrityClass, "warning"); // 60% is warning

  // 5. Repair facility
  const repairRes = await controller.dispatchRepairFacility({
    facilityId,
    restoreIntegrity: 40,
    removeConditionIds: ["cond-rot"],
    notes: "Replaced affected timbers"
  });
  assert.equal(repairRes.ok, true);

  const vmAfterRepair = (await controller.loadViewModel()).value;
  const fAfterRepair = vmAfterRepair.facilities.find((f) => f.id === facilityId)!;
  assert.equal(fAfterRepair.structuralIntegrity, 100);
  assert.equal(fAfterRepair.integrityPercent, 100);
  assert.equal(fAfterRepair.integrityClass, "healthy");
  assert.equal(fAfterRepair.conditions.length, 0);
});

// ---------------------------------------------------------------------------
// 3. DOWNTIME UI PRESENTER & VIEW TESTS (INVARIANTS: Downtime != Project, participant != User)
// ---------------------------------------------------------------------------

test("G5.9 - Downtime Presenter: enforces Downtime != Project, participant != Foundry User, and indefinite handling", () => {
  // Activity 1: Indefinite downtime (durationTicks: null) -> NO fake 100%
  const activity1: DowntimeInstance = {
    id: "dt-1",
    definitionId: "domain-manager:guard-patrol",
    domainUuid: "JournalEntry.test-domain",
    name: "Eastern Perimeter Patrol",
    schemaVersion: 1,
    revision: 2,
    scope: "domain",
    lifecycle: "inProgress",
    elapsedTicks: 14,
    durationTicks: null, // INDEFINITE!
    participants: Object.freeze([
      {
        participantRef: "notable:captain-reynolds", // NOT a Foundry User!
        participantType: "notable",
        role: "patrol-leader",
        capacityConsumed: 1
      },
      {
        participantRef: "group:city-watch", // Operational group
        participantType: "group",
        role: "sentries",
        capacityConsumed: 5
      }
    ]),
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  // Activity 2: Finite downtime with derived integer progress
  const activity2: DowntimeInstance = {
    id: "dt-2",
    definitionId: "domain-manager:craft-arms",
    domainUuid: "JournalEntry.test-domain",
    name: "Forging Halberds",
    schemaVersion: 1,
    revision: 1,
    scope: "individual",
    lifecycle: "inProgress",
    elapsedTicks: 25,
    durationTicks: 50, // Finite: 25/50 = 50%
    participants: Object.freeze([
      {
        participantRef: "notable:blacksmith-bram",
        participantType: "notable",
        role: "smith",
        capacityConsumed: 1
      }
    ]),
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  const domain = withDomainDowntimeData(testRecord, {
    schemaVersion: 1,
    activities: Object.freeze([activity1, activity2])
  });

  const participantNameMap: Record<string, string> = {
    "notable:captain-reynolds": "Captain Reynolds",
    "group:city-watch": "1st City Watch Squad",
    "notable:blacksmith-bram": "Master Bram"
  };

  const vm = buildDowntimeViewModel(domain, {
    viewerIsGm: true,
    participantResolver: (ref) => participantNameMap[ref] ?? ref
  });

  assert.equal(vm.totalCount, 2);
  assert.equal(vm.activeCount, 2);

  // Invariant 1: Indefinite downtime has NO fake 100%
  const dt1VM = vm.activities.find((a) => a.id === "dt-1")!;
  assert.equal(dt1VM.isIndefinite, true);
  assert.equal(dt1VM.progressPercent, null); // Strictly null!
  assert.match(dt1VM.durationFormatted, /Indefinite/);

  // Invariant 2: participant != Foundry User (Domain entity names resolved)
  assert.equal(dt1VM.participants.length, 2);
  assert.equal(dt1VM.participants[0].displayName, "Captain Reynolds");
  assert.equal(dt1VM.participants[0].participantType, "notable");
  assert.equal(dt1VM.participants[1].displayName, "1st City Watch Squad");
  assert.equal(dt1VM.participants[1].participantType, "group");

  // Finite downtime progress
  const dt2VM = vm.activities.find((a) => a.id === "dt-2")!;
  assert.equal(dt2VM.isIndefinite, false);
  assert.equal(dt2VM.progressPercent, 50); // Derived integer
  assert.equal(dt2VM.participants[0].displayName, "Master Bram");
});

test("G5.9 - Downtime View: renders semantic HTML and escapes malicious input", () => {
  const maliciousActivity: DowntimeInstance = {
    id: "dt-xss",
    definitionId: "domain-manager:guard-patrol",
    domainUuid: "JournalEntry.test-domain",
    name: "<script>hack_downtime()</script> Activity",
    description: "Malicious <b onmouseover=evil()>Downtime</b>",
    schemaVersion: 1,
    revision: 1,
    scope: "individual",
    lifecycle: "inProgress",
    elapsedTicks: 10,
    durationTicks: null,
    participants: Object.freeze([
      {
        participantRef: "<svg onload=alert(3)>",
        participantType: "notable",
        role: "leader",
        capacityConsumed: 1
      }
    ]),
    tags: Object.freeze([]),
    createdAt: 1000,
    updatedAt: 1000
  };

  const domain = withDomainDowntimeData(testRecord, {
    schemaVersion: 1,
    activities: Object.freeze([maliciousActivity])
  });

  const vm = buildDowntimeViewModel(domain, { viewerIsGm: true });
  const html = renderDowntimeSubsystemHtml(vm);

  assert.match(html, /&lt;script&gt;hack_downtime\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>hack_downtime\(\)<\/script>/);

  const detailHtml = renderDowntimeDetailModalHtml(vm.activities[0]);
  assert.match(detailHtml, /&lt;script&gt;hack_downtime\(\)&lt;\/script&gt;/);
  assert.match(detailHtml, /&lt;b onmouseover=evil\(\)&gt;Downtime&lt;\/b&gt;/);
  assert.match(detailHtml, /&lt;svg onload=alert\(3\)&gt;/);

  const startModalHtml = renderDowntimeStartModalHtml("JournalEntry.test-domain", [
    {
      id: "domain-manager:guard-patrol",
      label: "<evil> Patrol",
      description: "Patrol description",
      scope: "domain",
      schemaVersion: 1,
      targetRefKind: "domain",
      durationFormula: null,
      participantRequirements: [],
      costFormulas: [],
      outcomes: []
    } as any
  ]);
  assert.match(startModalHtml, /&lt;evil&gt; Patrol/);
});

test("G5.9 - Downtime Controller: start, advance, complete, cancel flow", async () => {
  const doc = createMockDocument("domain-3", "Test Domain 3", testRecord);
  const store = createMockStore([doc]);
  const repo = new StorageDomainRepository(store);
  const commandBus = createMockCommandBus(repo);

  const controller = new DowntimeApplicationController({
    domainUuid: "JournalEntry.domain-3",
    domains: repo,
    commandBus,
    downtimeRegistry: (commandBus as any).__downtimeRegistry
  });

  // 1. Start activity
  const startRes = await controller.dispatchStartDowntime({
    definitionId: "domain-manager:guard-patrol",
    label: "Night Watch",
    scope: "domain",
    durationTicks: 20,
    participantRef: "notable:night-sergeant"
  });
  assert.equal(startRes.ok, true);
  const activityId = (startRes as any).value.activityId;
  assert.ok(activityId);

  // 2. Load ViewModel
  const loadRes = await controller.loadViewModel();
  assert.equal(loadRes.ok, true);
  assert.equal(loadRes.value.activities.length, 1);
  assert.equal(loadRes.value.activities[0].label, "Night Watch");
  assert.equal(loadRes.value.activities[0].lifecycle, "inProgress");

  // 3. Advance activity
  const advRes = await controller.dispatchAdvanceDowntime({
    activityId,
    ticks: 10
  });
  assert.equal(advRes.ok, true);

  const vmAfterAdv = (await controller.loadViewModel()).value;
  const aAfterAdv = vmAfterAdv.activities.find((a) => a.id === activityId)!;
  assert.equal(aAfterAdv.progressTicks, 10);
  assert.equal(aAfterAdv.progressPercent, 50); // 10/20 = 50%
  assert.equal(aAfterAdv.lifecycle, "inProgress");

  // 4. Manually complete activity
  const compRes = await controller.dispatchCompleteDowntime(activityId);
  assert.equal(compRes.ok, true);

  const vmAfterComp = (await controller.loadViewModel()).value;
  const aAfterComp = vmAfterComp.activities.find((a) => a.id === activityId)!;
  assert.equal(aAfterComp.lifecycle, "completed");

  // 5. Start a second activity and cancel it
  const startRes2 = await controller.dispatchStartDowntime({
    definitionId: "domain-manager:guard-patrol",
    label: "Canceled Watch"
  });
  const activityId2 = (startRes2 as any).value.activityId;

  const cancelRes = await controller.dispatchCancelDowntime(activityId2, "Emergency callaway");
  assert.equal(cancelRes.ok, true);

  const vmAfterCancel = (await controller.loadViewModel()).value;
  const aAfterCancel = vmAfterCancel.activities.find((a) => a.id === activityId2)!;
  assert.equal(aAfterCancel.lifecycle, "cancelled");
});

// ---------------------------------------------------------------------------
// 4. APPLICATION CLASSES INITIALIZATION AND INTEGRATION
// ---------------------------------------------------------------------------

test("G5.9 - Applications instantiate and wire controllers properly", () => {
  const doc = createMockDocument("domain-4", "Test Domain 4", testRecord);
  const store = createMockStore([doc]);
  const repo = new StorageDomainRepository(store);

  const projApp = new ProjectsApplication({
    domainUuid: "JournalEntry.domain-4",
    domains: repo
  });
  assert.ok(projApp.controller);
  assert.equal(projApp.controller.domainUuid, "JournalEntry.domain-4");

  const facApp = new FacilitiesApplication({
    domainUuid: "JournalEntry.domain-4",
    domains: repo
  });
  assert.ok(facApp.controller);
  assert.equal(facApp.controller.domainUuid, "JournalEntry.domain-4");

  const dtApp = new DowntimeApplication({
    domainUuid: "JournalEntry.domain-4",
    domains: repo
  });
  assert.ok(dtApp.controller);
  assert.equal(dtApp.controller.domainUuid, "JournalEntry.domain-4");
});
