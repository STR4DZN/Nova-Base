import assert from "node:assert/strict";
import test from "node:test";
import { CommandBus } from "../../src/commands/command-bus.js";
import { CommandRegistry } from "../../src/commands/command-registry.js";
import { MutationCoordinator } from "../../src/mutations/mutation-coordinator.js";
import { LockManager } from "../../src/mutations/lock-manager.js";
import { registerNotableCommandHandlers } from "../../src/people/commands/notable-commands.js";
import { registerRoleCommandHandlers } from "../../src/people/commands/role-commands.js";
import { registerOperationalGroupCommandHandlers } from "../../src/people/commands/operational-group-commands.js";
import { registerAssignmentCommandHandlers } from "../../src/people/commands/assignment-commands.js";
import { registerDomainCommandHandlers } from "../../src/domains/domain-command-handlers.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  createCommandId,
  type DomainCommand
} from "../../src/commands/command-envelope.js";
import { PeopleRepository } from "../../src/people/repositories/people-repository.js";
import {
  PeopleService,
  type PublicPeopleApi
} from "../../src/people/services/people-service.js";
import { PeopleProjectionService } from "../../src/projection/people/people-projection-service.js";
import {
  setCurrentUserProvider,
  type ViewerIdentity
} from "../../src/projection/viewer-identity.js";
import { evaluateRole, type RoleRecord, type RoleDefinition, type DomainRole } from "../../src/people/roles/role-types.js";
import { type Notable } from "../../src/people/notables/notable-types.js";
import { type OperationalGroup } from "../../src/people/operational-groups/operational-group-types.js";
import { defaultAssignmentTargetRegistry } from "../../src/people/assignments/assignment-types.js";
import { calculateWorkforce } from "../../src/people/workforce/workforce-calculator.js";
import { DomainIntegrityChecker } from "../../src/storage/integrity/domain-integrity-checker.js";
import { CapabilityRegistry } from "../../src/domains/domain-capabilities.js";
import { PeopleRepairTool } from "../../src/people/services/people-repair-tool.js";
import { registerRepairCommandHandlers } from "../../src/people/commands/repair-commands.js";
import { PeopleAggregationService } from "../../src/aggregation/people-aggregation.js";
import { PeopleRoleCapabilityProvider } from "../../src/aggregation/capability-resolver.js";
import { PeopleApplicationController } from "../../src/ui/domain-patterns/people/people-app.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import type { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import {
  DomainRepository as StorageDomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import { withDomainPeopleData, type DomainPeopleData, PEOPLE_CAPABILITY_ID } from "../../src/people/people-data.js";

const defaultRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Test Domain", description: "Test Description" },
    classification: { kind: "base", scale: "small", tags: ["starter"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function createTestCommand<T>(type: string, payload: T): DomainCommand<T> {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}

function document(
  id: string,
  name: string,
  value = defaultRecord
): IdentifiedJournalEntryDocumentLike {
  let currentName = name;
  let currentFlags: Readonly<Record<string, unknown>> = { "domain-manager": value };
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return currentName; },
    get flags() { return currentFlags; },
    update: async (data: Record<string, unknown>) => {
      if (typeof data.name === "string") currentName = data.name;
      const payload = data["flags.domain-manager"];
      if (payload !== undefined) {
        currentFlags = { ...currentFlags, "domain-manager": payload };
      }
    }
  };
}

function createStore(initialDocs: IdentifiedJournalEntryDocumentLike[] = []): DomainDocumentStore {
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  let nextId = 1;

  function registerDoc(doc: IdentifiedJournalEntryDocumentLike) {
    byKey.set(doc.id, doc);
    byKey.set(doc.uuid, doc);
  }

  for (const doc of initialDocs) {
    registerDoc(doc);
  }

  return {
    get: (idOrUuid) => {
      const clean = idOrUuid.startsWith("JournalEntry.") ? idOrUuid.slice("JournalEntry.".length) : idOrUuid;
      return byKey.get(idOrUuid) ?? byKey.get(clean);
    },
    list: () => [...new Set(byKey.values())],
    create: async (data) => {
      const id = `je-${nextId++}`;
      const doc = document(id, data.name, data.flags["domain-manager"] as any);
      registerDoc(doc);
      return doc;
    }
  };
}

import { createOpaqueId } from "../../src/core/identity/ids.js";

function setupTestEnvironment() {
  setCurrentUserProvider(() => ({
    userId: "gm-user-1",
    isGm: true
  }));

  const registry = new CommandRegistry();
  const lockManager = new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });
  const store = createStore();
  const domains = new StorageDomainRepository(store);

  registerDomainCommandHandlers(registry, coordinator, domains);
  registerNotableCommandHandlers(registry, coordinator, domains);
  registerRoleCommandHandlers(registry, coordinator, domains);
  registerOperationalGroupCommandHandlers(registry, coordinator, domains);
  registerAssignmentCommandHandlers(registry, coordinator, domains);
  registerRepairCommandHandlers(registry, coordinator, domains);

  const mockAuthority = {
    isCurrentUser: () => true,
    getCurrent: () => "gm-user-1",
    getStatus: () => ({ authorityUserId: "gm-user-1", authorityEpoch: 1, available: true }),
  } as unknown as PrimaryAuthorityService;

  const bus = new CommandBus({
    registry,
    coordinator,
    authorityService: mockAuthority,
  });

  const peopleAggregationService = new PeopleAggregationService(domains);
  const peopleService = new PeopleService(domains);
  const publicApi: PublicPeopleApi = peopleService;
  const peopleRepo = new PeopleRepository(domains);

  return {
    registry,
    lockManager,
    coordinator,
    domains,
    bus,
    peopleRepo,
    peopleService,
    peopleAggregationService,
    publicApi
  };
}

test("G3 Remediation Item 1 & 5: Public People API enforces viewer identity, clamps caller spoofing, and strips secrets", async () => {
  const { domains, bus, publicApi, peopleRepo } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Royal City", record: defaultRecord });
  assert.equal(domainRes.ok, true);
  const domainUuid = domainRes.value.uuid;

  // Add a secret notable
  const secretNotableRes = await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: {
        type: "inline" as const,
        name: "Shadow Agent",
        visibility: "secret" as const
      }
    })
  );
  assert.equal(secretNotableRes.ok, true);
  assert.equal(secretNotableRes.value.status, "executed");
  const secretNotable = secretNotableRes.value.result as Notable;

  // Add a public notable
  const publicNotableRes = await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: {
        type: "inline" as const,
        name: "Lord Mayor",
        visibility: "public" as const
      }
    })
  );
  assert.equal(publicNotableRes.ok, true);

  // Set the current environment user to a non-GM player
  setCurrentUserProvider(() => ({
    userId: "player-123",
    isGm: false
  }));

  // Non-GM caller tries to pass { isGm: true } to escalate privileges
  const spoofedViewer: ViewerIdentity = {
    userId: "player-123",
    isGm: true, // Caller spoofing!
    isOwner: false,
    actorIds: []
  };

  const notablesRes = await publicApi.getNotables(domainUuid, spoofedViewer);
  assert.equal(notablesRes.ok, true);
  // Spoofed isGm: true must be clamped to isGm: false based on current user provider
  assert.equal(notablesRes.value.length, 1);
  assert.equal(notablesRes.value[0].name, "Lord Mayor");
  assert.equal(notablesRes.value.some((n) => n.id === secretNotable.id), false);

  // asAdmin() and asAuthority() must not exist on Public API (Blocker 1)
  assert.equal((publicApi as any).asAdmin, undefined);
  assert.equal((publicApi as any).asAuthority, undefined);

  // getPeopleData via Public API strips secrets for non-GM (Blocker 1)
  const peopleDataRes = await (publicApi as any).getPeopleData(domainUuid);
  assert.equal(peopleDataRes.ok, true);
  assert.equal(peopleDataRes.value.notables.some((n: any) => n.id === secretNotable.id), false);

  // Raw internal repository returns raw unprojected data including the secret notable
  const rawPeopleDataRes = await peopleRepo.getPeopleData(domainUuid);
  assert.equal(rawPeopleDataRes.ok, true);
  assert.equal(rawPeopleDataRes.value.notables.some((n) => n.id === secretNotable.id), true);

  // Reset current user provider to GM for subsequent tests
  setCurrentUserProvider(() => ({
    userId: "gm-user-1",
    isGm: true
  }));
});

test("G3 Remediation Item 1 & 5: Fail-closed restricted visibility & deep occupant/member stripping", async () => {
  const { domains, bus, publicApi } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Fortress", record: defaultRecord });
  const domainUuid = domainRes.value.uuid;

  // Create secret notable
  const secretRes = await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Secret Assassin", visibility: "secret" as const }
    })
  );
  const secretNotId = (secretRes.value.result as Notable).id;

  // Create restricted notable
  const restrictedRes = await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Restricted Officer", visibility: "restricted" as const }
    })
  );
  const restrictedNotId = (restrictedRes.value.result as Notable).id;

  // Create public notable
  const publicRes = await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Public Guard", visibility: "public" as const }
    })
  );
  const publicNotId = (publicRes.value.result as Notable).id;

  // Create a public role occupied by public, restricted, and secret notables
  const roleRes = await bus.executeLocal(
    createTestCommand("people:create-role", {
      domainUuid,
      role: {
        definitionId: "domain-manager:councilor",
        customLabel: "High Council",
        occupants: [publicNotId, restrictedNotId, secretNotId],
        visibility: "public" as const
      }
    })
  );
  const roleId = (roleRes.value.result as DomainRole).id;

  // Create an operational group containing public, restricted, and secret members
  const groupRes = await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "Strike Force",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "explicit" as const,
        members: [publicNotId, restrictedNotId, secretNotId],
        visibility: "public" as const
      }
    })
  );
  const groupId = (groupRes.value.result as OperationalGroup).id;

  // Simulate non-GM viewer without access to restrictedNotId
  setCurrentUserProvider(() => ({ userId: "player-norm", isGm: false }));

  const nonGmRolesRes = await publicApi.getRoles(domainUuid);
  assert.equal(nonGmRolesRes.ok, true);
  const nonGmRole = nonGmRolesRes.value.find((r) => r.id === roleId);
  assert.notEqual(nonGmRole, undefined);
  // Both restrictedNotId and secretNotId must be deeply stripped from occupants!
  assert.deepEqual(nonGmRole?.occupants, [publicNotId]);

  const nonGmGroupsRes = await publicApi.getOperationalGroups(domainUuid);
  assert.equal(nonGmGroupsRes.ok, true);
  const nonGmGroup = nonGmGroupsRes.value.find((g) => g.id === groupId);
  assert.notEqual(nonGmGroup, undefined);
  // Both restrictedNotId and secretNotId must be deeply stripped from members!
  assert.deepEqual(nonGmGroup?.members, [publicNotId]);

  // Now simulate non-GM viewer who HAS permission for restrictedNotId
  setCurrentUserProvider(() => ({
    userId: "player-officer",
    isGm: false,
    allowedRestrictedRefs: [restrictedNotId]
  }));

  const officerRolesRes = await publicApi.getRoles(domainUuid);
  const officerRole = officerRolesRes.value?.find((r) => r.id === roleId);
  // Officer sees public and restricted, but secret is still stripped
  assert.deepEqual(officerRole?.occupants, [publicNotId, restrictedNotId]);

  setCurrentUserProvider(() => ({ userId: "gm-user-1", isGm: true }));
});

test("G3 Remediation Item 4: evaluateRole validates definition prerequisites against enabled capabilities", () => {
  const roleDefWithPrereqs: RoleDefinition = {
    id: "domain-manager:grand-marshal",
    version: 1,
    label: "Grand Marshal",
    description: "Supreme army commander",
    occupancy: { min: 0, max: 1 },
    prerequisites: ["domain-manager:advanced-tactics", "domain-manager:citadel"]
  };

  const roleRecord: RoleRecord = {
    id: createOpaqueId("role"),
    definitionId: "domain-manager:grand-marshal",
    scope: "domain",
    occupants: [createOpaqueId("not")],
    visibility: "public"
  };

  // Missing prerequisites
  const evalWithoutPrereqs = evaluateRole(
    roleRecord,
    [roleDefWithPrereqs],
    undefined,
    ["domain-manager:basic-defense"]
  );
  assert.equal(evalWithoutPrereqs.isRequirementSatisfied, false);

  // Partial prerequisites
  const evalWithPartialPrereqs = evaluateRole(
    roleRecord,
    [roleDefWithPrereqs],
    undefined,
    ["domain-manager:advanced-tactics"]
  );
  assert.equal(evalWithPartialPrereqs.isRequirementSatisfied, false);

  // All prerequisites satisfied
  const evalWithAllPrereqs = evaluateRole(
    roleRecord,
    [roleDefWithPrereqs],
    undefined,
    ["domain-manager:advanced-tactics", "domain-manager:citadel", "domain-manager:extra"]
  );
  assert.equal(evalWithAllPrereqs.isRequirementSatisfied, true);
});

test("G3 Remediation Item 4: grantPolicy = requirementsSatisfied dynamic capability resolution", () => {
  const roleDef: RoleDefinition = {
    id: "domain-manager:arcanist",
    version: 1,
    label: "Arcanist",
    description: "Ritual specialist",
    occupancy: { min: 1, max: 1 },
    prerequisites: ["cap:arcane"],
    grantPolicy: "requirementsSatisfied",
    grants: ["cap:ritual"]
  };

  const role: DomainRole = {
    id: createOpaqueId("role"),
    definitionId: "domain-manager:arcanist",
    scope: "domain",
    occupants: [createOpaqueId("not")],
    visibility: "public"
  };

  const provider = new PeopleRoleCapabilityProvider();

  // Context without cap:arcane
  const ctxWithoutPrereq = {
    domainUuid: "JournalEntry.domain-1",
    domainRecord: {
      ...defaultRecord,
      definition: {
        ...defaultRecord.definition,
        capabilities: { enabled: ["domain-manager:domain"], config: {} }
      }
    },
    peopleData: {
      schemaVersion: 1,
      population: { mode: "manual", total: 10, precision: "exact" },
      populationGroups: [],
      notables: [],
      roles: [role],
      operationalGroups: [],
      assignments: [],
      reservations: []
    } as DomainPeopleData,
    roleDefinitions: [roleDef]
  };

  const grantsWithout = provider.resolveGrants(ctxWithoutPrereq);
  assert.equal(grantsWithout.some((g) => g.capabilityId === "cap:ritual"), false);

  // Context with cap:arcane
  const ctxWithPrereq = {
    domainUuid: "JournalEntry.domain-1",
    domainRecord: {
      ...defaultRecord,
      definition: {
        ...defaultRecord.definition,
        capabilities: { enabled: ["domain-manager:domain", "cap:arcane"], config: {} }
      }
    },
    peopleData: {
      schemaVersion: 1,
      population: { mode: "manual", total: 10, precision: "exact" },
      populationGroups: [],
      notables: [],
      roles: [role],
      operationalGroups: [],
      assignments: [],
      reservations: []
    } as DomainPeopleData,
    roleDefinitions: [roleDef]
  };

  const grantsWith = provider.resolveGrants(ctxWithPrereq);
  assert.equal(grantsWith.some((g) => g.capabilityId === "cap:ritual"), true);
});

test("G3 Remediation Item 2: Assignment & reservation contracts, target registry, notable capacity, world time", async () => {
  const { domains, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Industrial Core", record: defaultRecord });
  const domainUuid = domainRes.value.uuid;

  // Create notable source
  const notableRes = await bus.executeLocal(
    createTestCommand("people:create-notable", {
      domainUuid,
      notable: { type: "inline" as const, name: "Master Architect", visibility: "public" as const }
    })
  );
  assert.equal(notableRes.ok, true);
  assert.equal(notableRes.value.status, "executed");
  const notable = notableRes.value.result as Notable;
  const notableId = notable.id;

  // Target ref validation
  assert.equal(defaultAssignmentTargetRegistry.isValidTarget("prj_mine123"), true);
  assert.equal(defaultAssignmentTargetRegistry.isValidTarget("fac_forge1"), true);
  assert.equal(defaultAssignmentTargetRegistry.isValidTarget("invalid@scheme:123"), false);

  // 1. Invalid target ref fails with DM_ASSIGNMENT_INVALID_TARGET
  const badTargetRes = await bus.executeLocal(
    createTestCommand("people:create-assignment", {
      domainUuid,
      assignment: {
        sourceRef: notableId,
        targetRef: "invalid-target-format",
        workforceTypeId: "engineering",
        amount: 1
      }
    })
  );
  assert.equal(badTargetRes.ok, true);
  assert.equal(badTargetRes.value.status, "rejected");
  assert.equal(badTargetRes.value.error?.code, "DM_ASSIGNMENT_INVALID_TARGET");

  // 2. Unknown source ref fails with DM_PEOPLE_SOURCE_NOT_FOUND
  const badSourceRes = await bus.executeLocal(
    createTestCommand("people:create-assignment", {
      domainUuid,
      assignment: {
        sourceRef: "not_nonexistent_source",
        targetRef: "prj_mine123",
        workforceTypeId: "engineering",
        amount: 1
      }
    })
  );
  assert.equal(badSourceRes.ok, true);
  assert.equal(badSourceRes.value.status, "rejected");
  assert.equal(badSourceRes.value.error?.code, "DM_PEOPLE_SOURCE_NOT_FOUND");

  // 3. Notable individual capacity is 1: assigning 2 without allowOvercommit fails
  const overcommitNotableRes = await bus.executeLocal(
    createTestCommand("people:create-assignment", {
      domainUuid,
      assignment: {
        sourceRef: notableId,
        targetRef: "prj_mine123",
        workforceTypeId: "engineering",
        amount: 2
      }
    })
  );
  assert.equal(overcommitNotableRes.ok, true);
  assert.equal(overcommitNotableRes.value.status, "rejected");
  assert.equal(overcommitNotableRes.value.error?.code, "DM_WORKFORCE_OVERCOMMIT");

  // 4. World time expiration: ended assignment and expired reservation
  const activeAsgRes = await bus.executeLocal(
    createTestCommand("people:create-assignment", {
      domainUuid,
      assignment: {
        sourceRef: notableId,
        targetRef: "prj_mine123",
        workforceTypeId: "engineering",
        amount: 1,
        startedAtWorld: 10,
        endsAtWorld: 100
      }
    })
  );
  if (activeAsgRes.value.status === "rejected") {
    console.error("activeAsgRes rejected:", activeAsgRes.value.error);
  }
  assert.equal(activeAsgRes.ok, true);
  assert.equal(
    activeAsgRes.value.status,
    "executed",
    `activeAsgRes failed with: ${JSON.stringify(activeAsgRes.value.error)}`
  );

  // Read domain people data
  const updatedDoc = await domains.read(domainUuid.slice("JournalEntry.".length));
  assert.equal(updatedDoc.ok, true);
  const peopleData = (updatedDoc.value.record.definition.capabilities.config as any)[PEOPLE_CAPABILITY_ID] as DomainPeopleData;

  // At world time 50, assignment is active (endsAtWorld: 100 > 50)
  const wfAt50 = calculateWorkforce(peopleData, { nowWorld: 50 });
  assert.equal(wfAt50.types["engineering"]?.committed, 1);

  // At world time 105, assignment has ended (endsAtWorld: 100 <= 105)
  const wfAt105 = calculateWorkforce(peopleData, { nowWorld: 105 });
  assert.equal(wfAt105.types["engineering"]?.committed ?? 0, 0);
  assert.equal(wfAt105.totalCommitted, 0);
});

test("G3 Remediation Item 2.7: Reservation overlap checks evaluate current active reservations correctly", async () => {
  const { domains, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Overlap Testing Site", record: defaultRecord });
  const domainUuid = domainRes.value.uuid;

  // Create an operational group with size 10
  const groupRes = await bus.executeLocal(
    createTestCommand("people:create-operational-group", {
      domainUuid,
      group: {
        name: "Survey Crew",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "abstract" as const,
        size: 10
      }
    })
  );
  assert.equal(groupRes.ok, true);
  const groupId = (groupRes.value as any).result.id;

  const nowReal = Date.now();

  // Create reservation 1: takes 6 units, expires at nowReal + 100_000
  const resv1 = await bus.executeLocal(
    createTestCommand("people:create-reservation", {
      domainUuid,
      reservation: {
        sourceRef: groupId,
        targetRef: "prj_site_a",
        workforceTypeId: "general",
        amount: 6,
        expiresAtReal: nowReal + 100_000
      }
    })
  );
  assert.equal(resv1.ok, true);
  assert.equal(resv1.value.status, "executed");

  // Create reservation 2: takes 5 units (total 6 + 5 = 11 > 10) expiring at nowReal + 50_000 -> must be REJECTED with DM_WORKFORCE_OVERCOMMIT
  const resv2 = await bus.executeLocal(
    createTestCommand("people:create-reservation", {
      domainUuid,
      reservation: {
        sourceRef: groupId,
        targetRef: "prj_site_b",
        workforceTypeId: "general",
        amount: 5,
        expiresAtReal: nowReal + 50_000
      }
    })
  );
  assert.equal(resv2.ok, true);
  assert.equal(resv2.value.status, "rejected");
  assert.equal(resv2.value.error?.code, "DM_WORKFORCE_OVERCOMMIT");

  // Create reservation 3: takes 4 units (total 6 + 4 = 10 <= 10) expiring at nowReal + 50_000 -> must be EXECUTED
  const resv3 = await bus.executeLocal(
    createTestCommand("people:create-reservation", {
      domainUuid,
      reservation: {
        sourceRef: groupId,
        targetRef: "prj_site_c",
        workforceTypeId: "general",
        amount: 4,
        expiresAtReal: nowReal + 50_000
      }
    })
  );
  assert.equal(resv3.ok, true);
  assert.equal(resv3.value.status, "executed");
});

test("G3 Remediation Item 6: Domain integrity diagnostics and PeopleRepairTool", async () => {
  const { domains, coordinator, bus } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "Corrupted Domain", record: defaultRecord });
  const domainUuid = domainRes.value.uuid;

  const roleId = createOpaqueId("role");
  const ghostNotableId = createOpaqueId("not");
  const grpId = createOpaqueId("opg");
  const asgId = createOpaqueId("asg");
  const resvId = createOpaqueId("resv");

  // Seed corrupt people data:
  // 1. Role with unknown definition and dangling occupant
  // 2. Explicit group with mismatched size
  // 3. Dangling target in assignment
  const corruptPeopleData: DomainPeopleData = {
    schemaVersion: 1,
    population: { mode: "manual", total: 100, precision: "exact" },
    populationGroups: [],
    notables: [],
    roles: [
      {
        id: roleId,
        definitionId: "domain-manager:nonexistent-role-def",
        scope: "domain",
        occupants: [ghostNotableId],
        visibility: "public"
      }
    ],
    operationalGroups: [
      {
        id: grpId,
        name: "Corrupt Squad",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "explicit",
        size: 99, // Mismatch: 99 size but 0 members!
        members: [],
        lifecycle: "active",
        visibility: "public"
      }
    ],
    assignments: [
      {
        id: asgId,
        sourceRef: grpId,
        targetRef: "unsupported@target",
        workforceTypeId: "labor",
        amount: 10,
        lifecycle: "active",
        visibility: "public"
      }
    ],
    reservations: [
      {
        id: resvId,
        sourceRef: grpId,
        targetRef: "prj_mine1",
        workforceTypeId: "labor",
        amount: 5,
        expiresAtWorld: 50,
        visibility: "public"
      }
    ]
  };

  const domainWithCorruptPeople = withDomainPeopleData(domainRes.value.record, corruptPeopleData);
  await domains.update({
    id: domainRes.value.id,
    uuid: domainRes.value.uuid,
    name: domainRes.value.name,
    record: domainWithCorruptPeople
  }, { expectedRevision: domainRes.value.record.revision });

  // Verify DomainIntegrityChecker reports all diagnostics
  const capabilityRegistry = new CapabilityRegistry();
  const checker = new DomainIntegrityChecker({ capabilityRegistry });
  const report = checker.check([
    {
      id: domainUuid.slice("JournalEntry.".length),
      uuid: domainUuid,
      name: "Corrupted Domain",
      record: domainWithCorruptPeople
    }
  ]);

  const codes = report.issues.map((i) => i.code);
  assert.equal(codes.includes("DM_PEOPLE_UNKNOWN_ROLE_DEFINITION"), true);
  assert.equal(codes.includes("DM_PEOPLE_DANGLING_TARGET_REF"), true);
  assert.equal(codes.includes("DM_PEOPLE_EXPLICIT_MEMBERSHIP_MISMATCH"), true);

  // Run PeopleRepairTool
  const repairTool = new PeopleRepairTool(bus);

  // 1. Purge dangling occupants
  const purgeRes = await repairTool.purgeDanglingOccupants(domainUuid);
  assert.equal(purgeRes.ok, true);

  // 2. Repair explicit group sizes
  const repairGroupRes = await repairTool.repairExplicitGroupSizes(domainUuid);
  assert.equal(repairGroupRes.ok, true);

  // 3. Prune expired reservations (nowWorld = 100 > 50)
  const pruneRes = await repairTool.pruneExpiredReservations(domainUuid, Date.now(), 100);
  assert.equal(pruneRes.ok, true);

  // Verify repaired domain
  const repairedDoc = await domains.read(domainUuid.slice("JournalEntry.".length));
  assert.equal(repairedDoc.ok, true);
  const repairedPeople = (repairedDoc.value.record.definition.capabilities.config as any)[PEOPLE_CAPABILITY_ID] as DomainPeopleData;
  assert.deepEqual(repairedPeople.roles[0]?.occupants, []);
  assert.equal(repairedPeople.operationalGroups[0]?.size, 0);
  assert.equal(repairedPeople.reservations.length, 0);
});

test("G3 Remediation Item 7: calculatePeopleAggregate reports unknownContributors", async () => {
  const { domains, peopleAggregationService } = setupTestEnvironment();

  // Root domain
  const rootDoc = await domains.create({ name: "Kingdom", record: defaultRecord });
  const rootUuid = rootDoc.value.uuid;

  // Child domain without people data
  const childDoc = await domains.create({
    name: "Wildlands",
    record: {
      ...defaultRecord,
      definition: {
        ...defaultRecord.definition,
        hierarchy: { parentDomainUuid: rootUuid }
      }
    }
  });

  const aggRes = peopleAggregationService.queryPeopleAggregate(rootUuid);
  assert.equal(aggRes.ok, true);
  // Child has no people data, must be listed in unknownContributors per DEC-1184
  assert.equal(aggRes.value.unknownContributors.includes(childDoc.value.uuid), true);
});

test("G3 Remediation Item 3: PeopleApplicationController navigates tabs, entities, and executes commands", async () => {
  const { domains, bus, publicApi } = setupTestEnvironment();

  const domainRes = await domains.create({ name: "City of Dawn", record: defaultRecord });
  const domainUuid = domainRes.value.uuid;

  const controller = new PeopleApplicationController({
    domainUuid,
    commandBus: bus,
    peopleApi: publicApi,
    domains
  });

  // Tab selection
  assert.equal(controller.activeTab, "notables");
  controller.selectTab("roles");
  assert.equal(controller.activeTab, "roles");

  // Entity selection
  assert.equal(controller.selectedEntity, null);
  controller.selectEntity("role", "role_abc");
  assert.deepEqual(controller.selectedEntity, { type: "role", id: "role_abc" });
  controller.clearSelection();
  assert.equal(controller.selectedEntity, null);

  // Dispatch Create Notable through controller
  const notableRes = await controller.dispatchCreateNotable({
    name: "Grand Chancellor",
    type: "inline",
    description: "Head of the supreme council",
    visibility: "public"
  });
  if (!notableRes.ok) console.error("notableRes error:", notableRes.error);
  assert.equal(notableRes.ok, true);

  // Dispatch Create Role through controller
  const roleRes = await controller.dispatchCreateRole({
    definitionId: "domain-manager:councilor",
    customLabel: "Chancellor Office",
    visibility: "public"
  });
  if (!roleRes.ok) console.error("roleRes error:", roleRes.error);
  assert.equal(roleRes.ok, true);

  // Load view model
  const vmRes = await controller.loadViewModel();
  assert.equal(vmRes.ok, true);
  assert.equal(vmRes.value.notables.length, 1);
  assert.equal(vmRes.value.roles.length, 1);

  // Render HTML
  const html = controller.render(vmRes.value);
  assert.equal(typeof html, "string");
  assert.equal(html.includes("People & Governance Subsystem"), true);
  assert.equal(html.includes("Chancellor Office"), true);
});
