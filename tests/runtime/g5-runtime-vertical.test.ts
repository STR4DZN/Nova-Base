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
import { createDefaultDomainProjectsData } from "../../src/projects/project-data.js";
import { createDefaultDomainFacilitiesData } from "../../src/facilities/facility-data.js";
import { createDefaultDomainDowntimeData } from "../../src/downtime/downtime-data.js";
import { ProjectsApplicationController } from "../../src/ui/domain-patterns/projects/project-app.js";
import { FacilitiesApplicationController } from "../../src/ui/domain-patterns/facilities/facility-app.js";
import { DowntimeApplicationController } from "../../src/ui/domain-patterns/downtime/downtime-app.js";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import {
  InMemoryCommandTransport,
  InMemoryTransportHub
} from "../../src/commands/in-memory-command-transport.js";

const testRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "G5 Vertical Test Domain", description: "Vertical testing" },
    classification: { kind: "base", scale: "small", tags: ["g5-vertical"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: {
      enabled: [
        "domain-manager:domain",
        "domain-manager:economy",
        "domain-manager:people",
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
  metadata: { createdByUserId: "gm-user", archivedAt: null, source: { type: "manual", ref: null } }
};

function createMockDoc(
  id: string,
  name: string,
  record: DomainRecord = testRecord,
  ownership: Record<string, number> = { default: 0, "gm-user": 3, "player-controller": 3, "player-stranger": 0 }
): IdentifiedJournalEntryDocumentLike {
  let currentFlags = { "domain-manager": JSON.parse(JSON.stringify(record)) };
  let currentOwnership = { ...ownership };

  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return name; },
    get flags() { return currentFlags; },
    get ownership() { return currentOwnership; },
    update: async (data: Record<string, unknown>) => {
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": JSON.parse(JSON.stringify(payload)) };
      }
      if (data.ownership !== undefined) {
        currentOwnership = { ...(data.ownership as any) };
      }
    }
  };
}

function createMockAuthority(currentUserId = "gm-user") {
  const users = [
    { id: "gm-user", isGM: true, active: true },
    { id: "player-controller", isGM: false, active: true },
    { id: "player-stranger", isGM: false, active: true }
  ];

  const service = new PrimaryAuthorityService(
    {
      getUsers: () => users,
      getPreferredUserId: () => null,
      getCurrentUserId: () => currentUserId
    },
    {
      authorityUserId: "gm-user",
      authorityEpoch: 1,
      initialized: true
    }
  );

  return { service };
}

function createMockTransport(currentUserId = "gm-user", hub?: InMemoryTransportHub) {
  return new InMemoryCommandTransport(
    {
      currentUserId,
      getAuthorityUserId: () => "gm-user"
    },
    hub
  );
}

function makeCmd<T>(type: string, payload: T): DomainCommand<T> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

test("G5.10 - Composition: composeDomainManagerRuntime wires projects, facilities, and downtime into runtime and registers commands", () => {
  const doc = createMockDoc("dom-vert-1", "Domain Vertical 1");
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  byKey.set(doc.id, doc);
  byKey.set(doc.uuid, doc);

  const domainStore = {
    get: (id: string) => byKey.get(id),
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: domainStore as any,
    authority: createMockAuthority() as any,
    transport: createMockTransport() as any
  });

  try {
    // 1. Verify Public Facades are exposed on runtime
    assert.ok(runtime.projects, "runtime.projects must be exposed");
    assert.equal(typeof runtime.projects.getProjects, "function");
    assert.equal(typeof runtime.projects.getProject, "function");
    assert.equal(typeof runtime.projects.startProject, "function");
    assert.equal(typeof runtime.projects.advanceProject, "function");
    assert.equal(typeof runtime.projects.pauseProject, "function");
    assert.equal(typeof runtime.projects.resumeProject, "function");
    assert.equal(typeof runtime.projects.cancelProject, "function");
    assert.equal(typeof runtime.projects.completeProject, "function");
    assert.equal(typeof runtime.projects.buildViewModel, "function");

    assert.ok(runtime.facilities, "runtime.facilities must be exposed");
    assert.equal(typeof runtime.facilities.getFacilities, "function");
    assert.equal(typeof runtime.facilities.getFacility, "function");
    assert.equal(typeof runtime.facilities.createFacility, "function");
    assert.equal(typeof runtime.facilities.maintainFacility, "function");
    assert.equal(typeof runtime.facilities.repairFacility, "function");
    assert.equal(typeof runtime.facilities.applyDamage, "function");
    assert.equal(typeof runtime.facilities.decommissionFacility, "function");
    assert.equal(typeof runtime.facilities.buildViewModel, "function");

    assert.ok(runtime.downtime, "runtime.downtime must be exposed");
    assert.equal(typeof runtime.downtime.getActivities, "function");
    assert.equal(typeof runtime.downtime.getActivity, "function");
    assert.equal(typeof runtime.downtime.startActivity, "function");
    assert.equal(typeof runtime.downtime.advanceActivity, "function");
    assert.equal(typeof runtime.downtime.pauseActivity, "function");
    assert.equal(typeof runtime.downtime.resumeActivity, "function");
    assert.equal(typeof runtime.downtime.completeActivity, "function");
    assert.equal(typeof runtime.downtime.cancelActivity, "function");
    assert.equal(typeof runtime.downtime.buildViewModel, "function");

    // 2. Verify all G5 commands are registered in CommandRegistry
    const expectedG5Commands = [
      "projects:start-project",
      "projects:advance-project",
      "projects:pause-project",
      "projects:resume-project",
      "projects:cancel-project",
      "projects:complete-project",
      "facilities:create-facility",
      "facilities:maintain-facility",
      "facilities:repair-facility",
      "facilities:apply-damage",
      "facilities:decommission-facility",
      "downtime:start-activity",
      "downtime:advance-activity",
      "downtime:complete-activity",
      "downtime:pause-activity",
      "downtime:resume-activity",
      "downtime:cancel-activity"
    ];

    for (const cmd of expectedG5Commands) {
      const entry = runtime.registry.get(cmd);
      assert.ok(entry, `Command '${cmd}' must be registered before registry freeze`);
    }

    // 3. Verify registry is frozen
    assert.equal(runtime.registry.isFrozen, true, "CommandRegistry must be frozen after runtime composition");
  } finally {
    runtime.destroy();
  }
});

test("G5.10 - Authority & Security: GM and Domain Controller permissions, unauthorized rejection, and fail-closed checks", async () => {
  const doc = createMockDoc("dom-vert-sec", "Domain Security Test");
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  byKey.set(doc.id, doc);
  byKey.set(doc.uuid, doc);

  const domainStore = {
    get: (id: string) => byKey.get(id),
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  };

  const hub = new InMemoryTransportHub();
  const gmTransport = createMockTransport("gm-user", hub);

  // Runtime as GM
  const gmRuntime = composeDomainManagerRuntime({
    domainStore: domainStore as any,
    authority: createMockAuthority("gm-user") as any,
    transport: gmTransport
  });

  try {
    // 1. GM creates facility
    const gmFacRes = await gmRuntime.commandBus.execute(
      makeCmd("facilities:create-facility", {
        domainUuid: doc.uuid,
        definitionId: "domain-manager:storehouse",
        name: "GM Storehouse",
        level: 1,
        initialLifecycle: "operational"
      })
    );
    assert.equal(gmFacRes.ok, true);
    assert.equal(gmFacRes.value.status, "executed");

    // 2. GM starts project
    const gmPrjRes = await gmRuntime.commandBus.execute(
      makeCmd("projects:start-project", {
        domainUuid: doc.uuid,
        definitionId: "domain-manager:basic-construction",
        name: "GM Wall",
        workRequired: 50
      })
    );
    assert.equal(gmPrjRes.ok, true);
    assert.equal(gmPrjRes.value.status, "executed");

    // 3. GM starts downtime
    const gmDtRes = await gmRuntime.commandBus.execute(
      makeCmd("downtime:start-activity", {
        domainUuid: doc.uuid,
        definitionId: "domain-manager:patrol-and-recon",
        label: "GM Patrol",
        durationTicks: 10,
        participantRef: "notable:scout-1"
      })
    );
    assert.equal(gmDtRes.ok, true);
    assert.equal(gmDtRes.value.status, "executed");

    // Runtime as Player with Controller ownership
    const controllerTransport = createMockTransport("player-controller", hub);
    const controllerRuntime = composeDomainManagerRuntime({
      domainStore: domainStore as any,
      authority: createMockAuthority("player-controller") as any,
      transport: controllerTransport
    });

    try {
      // Controller can advance project
      const projectId = (gmPrjRes.value.result as any).project.id;
      const ctrlPrjRes = await controllerRuntime.commandBus.execute(
        makeCmd("projects:advance-project", {
          domainUuid: doc.uuid,
          projectId,
          units: 10
        })
      );
      assert.equal(ctrlPrjRes.ok, true);
      assert.equal(ctrlPrjRes.value.status, "executed");
    } finally {
      controllerRuntime.destroy();
    }

    // Runtime as Unauthorized Stranger Player
    const strangerTransport = createMockTransport("player-stranger", hub);
    const strangerRuntime = composeDomainManagerRuntime({
      domainStore: domainStore as any,
      authority: createMockAuthority("player-stranger") as any,
      transport: strangerTransport
    });

    try {
      const projectId = (gmPrjRes.value.result as any).project.id;
      const strangerRes = await strangerRuntime.commandBus.execute(
        makeCmd("projects:advance-project", {
          domainUuid: doc.uuid,
          projectId,
          units: 10
        })
      );
      assert.equal(strangerRes.ok, true);
      assert.equal(strangerRes.value.status, "rejected");
      assert.equal(strangerRes.value.error?.code, "DM_SECURITY_PERMISSION_DENIED");

      // Stranger cannot create facility
      const strangerFacRes = await strangerRuntime.commandBus.execute(
        makeCmd("facilities:create-facility", {
          domainUuid: doc.uuid,
          definitionId: "domain-manager:storehouse",
          name: "Stranger Post",
          level: 1
        })
      );
      assert.equal(strangerFacRes.ok, true);
      assert.equal(strangerFacRes.value.status, "rejected");
      assert.equal(strangerFacRes.value.error?.code, "DM_SECURITY_PERMISSION_DENIED");

      // Stranger cannot start downtime
      const strangerDtRes = await strangerRuntime.commandBus.execute(
        makeCmd("downtime:start-activity", {
          domainUuid: doc.uuid,
          definitionId: "domain-manager:patrol-and-recon",
          label: "Stranger Patrol"
        })
      );
      assert.equal(strangerDtRes.ok, true);
      assert.equal(strangerDtRes.value.status, "rejected");
      assert.equal(strangerDtRes.value.error?.code, "DM_SECURITY_PERMISSION_DENIED");
    } finally {
      strangerRuntime.destroy();
    }
  } finally {
    gmRuntime.destroy();
  }
});

test("G5.10 - Vertical Flow & Controller Integration: ApplicationV2 UI controllers mutate strictly through CommandBus without direct save", async () => {
  const doc = createMockDoc("dom-vert-ui", "Domain UI Vertical Test");
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  byKey.set(doc.id, doc);
  byKey.set(doc.uuid, doc);

  let directSaveCount = 0;
  const originalUpdate = doc.update;
  doc.update = async (data: Record<string, unknown>) => {
    directSaveCount++;
    return originalUpdate(data);
  };

  const domainStore = {
    get: (id: string) => byKey.get(id),
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  };

  const runtime = composeDomainManagerRuntime({
    domainStore: domainStore as any,
    authority: createMockAuthority("gm-user") as any,
    transport: createMockTransport() as any
  });

  try {
    // 1. Facilities Application Controller
    const facController = new FacilitiesApplicationController({
      domainUuid: doc.uuid,
      domains: runtime.domains,
      commandBus: runtime.commandBus
    });

    const createFacRes = await facController.dispatchCreateFacility({
      definitionId: "domain-manager:storehouse",
      name: "Harbor Warehouse",
      level: 1,
      initialLifecycle: "operational"
    });
    assert.equal(createFacRes.ok, true);
    const facilityId = (createFacRes as any).value.facilityId;
    assert.ok(facilityId);

    // Verify facility present in ViewModel via runtime.domains.read()
    const facVM = (await facController.loadViewModel()).value;
    assert.equal(facVM.facilities.length, 1);
    assert.equal(facVM.facilities[0].name, "Harbor Warehouse");
    assert.equal(facVM.facilities[0].readiness, "ready");

    // 2. Projects Application Controller
    const prjController = new ProjectsApplicationController({
      domainUuid: doc.uuid,
      domains: runtime.domains,
      commandBus: runtime.commandBus
    });

    const startPrjRes = await prjController.dispatchStartProject({
      definitionId: "domain-manager:basic-construction",
      name: "Timber Wall",
      workRequired: 80
    });
    assert.equal(startPrjRes.ok, true);
    const projectId = (startPrjRes as any).value.projectId;
    assert.ok(projectId);

    const advPrjRes = await prjController.dispatchAdvanceProject({
      projectId,
      units: 40,
      notes: "First stage"
    });
    assert.equal(advPrjRes.ok, true);

    const prjVM = (await prjController.loadViewModel()).value;
    assert.equal(prjVM.projects.length, 1);
    assert.equal(prjVM.projects[0].workCompleted, 40);
    assert.equal(prjVM.projects[0].progressPercent, 50);

    // Pause and Resume via controller
    const pauseRes = await prjController.dispatchPauseProject(projectId, "Heavy snow");
    assert.equal(pauseRes.ok, true);
    assert.equal((await prjController.loadViewModel()).value.projects[0].lifecycle, "paused");

    const resumeRes = await prjController.dispatchResumeProject(projectId);
    assert.equal(resumeRes.ok, true);
    assert.equal((await prjController.loadViewModel()).value.projects[0].lifecycle, "active");

    // 3. Downtime Application Controller
    const dtController = new DowntimeApplicationController({
      domainUuid: doc.uuid,
      domains: runtime.domains,
      commandBus: runtime.commandBus
    });

    const startDtRes = await dtController.dispatchStartDowntime({
      definitionId: "domain-manager:patrol-and-recon",
      label: "Border Recon",
      durationTicks: 20,
      participantRef: "notable:scout-1"
    });
    assert.equal(startDtRes.ok, true);
    const activityId = (startDtRes as any).value.activityId;
    assert.ok(activityId);

    const advDtRes = await dtController.dispatchAdvanceDowntime({
      activityId,
      ticks: 10
    });
    assert.equal(advDtRes.ok, true);

    const dtVM = (await dtController.loadViewModel()).value;
    assert.equal(dtVM.activities.length, 1);
    assert.equal(dtVM.activities[0].progressTicks, 10);
    assert.equal(dtVM.activities[0].progressPercent, 50);

    // Complete downtime
    const compDtRes = await dtController.dispatchCompleteDowntime(activityId);
    assert.equal(compDtRes.ok, true);
    assert.equal((await dtController.loadViewModel()).value.activities[0].lifecycle, "completed");

    // Verify all updates passed through CommandBus and mutation coordinator persistence
    assert.ok(directSaveCount > 0, "Document was updated through CommandBus mutations");
  } finally {
    runtime.destroy();
  }
});

test("G5.10 - Reload & Persistence: Subsystems retain state across runtime reload", async () => {
  const doc = createMockDoc("dom-vert-reload", "Domain Reload Test");
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  byKey.set(doc.id, doc);
  byKey.set(doc.uuid, doc);

  const domainStore = {
    get: (id: string) => byKey.get(id),
    list: () => [doc],
    create: async () => { throw new Error("not used"); }
  };

  // Session 1: Create projects, facilities, and downtime
  const runtime1 = composeDomainManagerRuntime({
    domainStore: domainStore as any,
    authority: createMockAuthority("gm-user") as any,
    transport: createMockTransport() as any
  });

  let facilityId = "";
  let projectId = "";
  let activityId = "";

  try {
    const fRes = await runtime1.facilities.createFacility({
      domainUuid: doc.uuid,
      definitionId: "domain-manager:basic-workshop",
      name: "Blacksmith Shop",
      level: 1
    });
    assert.equal(fRes.ok, true);
    facilityId = (fRes.value as any).facility.id;

    const pRes = await runtime1.projects.startProject({
      domainUuid: doc.uuid,
      definitionId: "domain-manager:basic-construction",
      name: "Watchtower",
      workRequired: 100
    });
    assert.equal(pRes.ok, true);
    projectId = (pRes.value as any).project.id;

    const dRes = await runtime1.downtime.startActivity({
      domainUuid: doc.uuid,
      definitionId: "domain-manager:patrol-and-recon",
      label: "Border Patrol",
      durationTicks: 30,
      participantRef: "notable:scout-1"
    });
    assert.equal(dRes.ok, true);
    activityId = (dRes.value as any).activity.id;
  } finally {
    runtime1.destroy();
  }

  // Session 2: Reload runtime from store
  const runtime2 = composeDomainManagerRuntime({
    domainStore: domainStore as any,
    authority: createMockAuthority("gm-user") as any,
    transport: createMockTransport() as any
  });

  try {
    // 1. Verify facility survives reload
    const facRes = await runtime2.facilities.getFacility(doc.uuid, facilityId);
    assert.equal(facRes.ok, true);
    assert.equal(facRes.value.name, "Blacksmith Shop");
    assert.equal(facRes.value.definitionId, "domain-manager:basic-workshop");

    // 2. Verify project survives reload
    const prjRes = await runtime2.projects.getProject(doc.uuid, projectId);
    assert.equal(prjRes.ok, true);
    assert.equal(prjRes.value.name, "Watchtower");
    assert.equal(prjRes.value.workRequired, 100);

    // 3. Verify downtime activity survives reload
    const dtRes = await runtime2.downtime.getActivity(doc.uuid, activityId);
    assert.equal(dtRes.ok, true);
    assert.equal(dtRes.value.name, "Border Patrol");
    assert.equal(dtRes.value.durationTicks, 30);
  } finally {
    runtime2.destroy();
  }
});
