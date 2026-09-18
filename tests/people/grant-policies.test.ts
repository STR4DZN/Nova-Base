import test from "node:test";
import assert from "node:assert/strict";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import {
  type RoleDefinition,
  type DomainRole
} from "../../src/people/roles/role-types.js";
import {
  type OperationalGroupDefinition,
  type OperationalGroup
} from "../../src/people/operational-groups/operational-group-types.js";
import type { DomainPeopleData } from "../../src/people/people-data.js";
import { createDefaultCapabilityResolver } from "../../src/aggregation/capability-resolver.js";

test("G3 Grant Policies: Role grantPolicy, keepGrantWhenInactive, and Group Role grant conditions", () => {
  const domainUuid = "JournalEntry.testDomain123";
  const notable1 = createOpaqueId("not");
  const notable2 = createOpaqueId("not");
  const opGroupId = createOpaqueId("opg");

  // Define roles with different grant policies
  const existsPolicyDef: RoleDefinition = {
    id: "custom:honorary-patron",
    version: 1,
    label: "Honorary Patron",
    occupancy: { min: 0, max: 1 },
    grants: ["cap:patronage"],
    grantPolicy: "exists"
  };

  const occupiedPolicyDef: RoleDefinition = {
    id: "custom:guard-captain",
    version: 1,
    label: "Guard Captain",
    occupancy: { min: 1, max: 1 },
    grants: ["cap:defense"],
    grantPolicy: "occupied"
  };

  const reqSatisfiedPolicyDef: RoleDefinition = {
    id: "custom:high-council",
    version: 1,
    label: "High Council",
    occupancy: { min: 2, max: 5 },
    grants: ["cap:governance"],
    grantPolicy: "requirementsSatisfied"
  };

  const squadLeaderDef: RoleDefinition = {
    id: "custom:squad-leader",
    version: 1,
    label: "Squad Leader",
    occupancy: { min: 1, max: 1 },
    grants: ["cap:recon"],
    allowedScopes: ["operational-group"],
    grantPolicy: "requirementsSatisfied"
  };

  // Define operational groups
  const fortDef: OperationalGroupDefinition = {
    id: "custom:fort-garrison",
    version: 1,
    label: "Fort Garrison",
    grants: ["cap:fortification"],
    keepGrantWhenInactive: true
  };

  const militiaDef: OperationalGroupDefinition = {
    id: "custom:peasant-militia",
    version: 1,
    label: "Peasant Militia",
    grants: ["cap:emergency-levy"],
    keepGrantWhenInactive: false
  };

  const roleDefs = [existsPolicyDef, occupiedPolicyDef, reqSatisfiedPolicyDef, squadLeaderDef];
  const groupDefs = [fortDef, militiaDef];

  const resolver = createDefaultCapabilityResolver();

  // Test Case 1: Vacant roles
  const vacantPeople: DomainPeopleData = {
    population: { mode: "manual", total: 100, precision: "exact" },
    populationGroups: [],
    notables: [],
    roles: [
      { id: createOpaqueId("role"), definitionId: "custom:honorary-patron", occupants: [], visibility: "public", tags: [] },
      { id: createOpaqueId("role"), definitionId: "custom:guard-captain", occupants: [], visibility: "public", tags: [] },
      { id: createOpaqueId("role"), definitionId: "custom:high-council", occupants: [], visibility: "public", tags: [] }
    ],
    operationalGroups: [],
    assignments: [],
    reservations: []
  };

  const report1 = resolver.resolveEffectiveCapabilities({
    domainUuid,
    peopleData: vacantPeople,
    roleDefinitions: roleDefs,
    operationalGroupDefinitions: groupDefs
  });

  // exists policy GRANTS even if vacant
  assert.ok(report1.enabledCapabilityIds.includes("cap:patronage"), "exists policy should grant even when vacant");
  // occupied and requirementsSatisfied DO NOT grant when vacant
  assert.equal(report1.enabledCapabilityIds.includes("cap:defense"), false, "occupied policy should not grant when vacant");
  assert.equal(report1.enabledCapabilityIds.includes("cap:governance"), false, "requirementsSatisfied should not grant when vacant");

  // Test Case 2: Understaffed role (1 occupant for high council, which requires min 2)
  const understaffedPeople: DomainPeopleData = {
    ...vacantPeople,
    roles: [
      { id: createOpaqueId("role"), definitionId: "custom:guard-captain", occupants: [notable1], visibility: "public", tags: [] },
      { id: createOpaqueId("role"), definitionId: "custom:high-council", occupants: [notable1], visibility: "public", tags: [] }
    ]
  };

  const report2 = resolver.resolveEffectiveCapabilities({
    domainUuid,
    peopleData: understaffedPeople,
    roleDefinitions: roleDefs,
    operationalGroupDefinitions: groupDefs
  });

  assert.ok(report2.enabledCapabilityIds.includes("cap:defense"), "occupied policy grants with 1 occupant");
  assert.equal(
    report2.enabledCapabilityIds.includes("cap:governance"),
    false,
    "requirementsSatisfied requires min=2 occupants, so 1 occupant does NOT grant"
  );

  // Test Case 3: Fully staffed role (2 occupants for high council)
  const satisfiedPeople: DomainPeopleData = {
    ...vacantPeople,
    roles: [
      { id: createOpaqueId("role"), definitionId: "custom:high-council", occupants: [notable1, notable2], visibility: "public", tags: [] }
    ]
  };

  const report3 = resolver.resolveEffectiveCapabilities({
    domainUuid,
    peopleData: satisfiedPeople,
    roleDefinitions: roleDefs,
    operationalGroupDefinitions: groupDefs
  });

  assert.ok(report3.enabledCapabilityIds.includes("cap:governance"), "requirementsSatisfied grants when min=2 is met");

  // Test Case 4: Operational group keepGrantWhenInactive
  const fortGroup: OperationalGroup = {
    id: opGroupId,
    name: "Iron Gate Fort",
    definitionId: "custom:fort-garrison",
    membershipMode: "abstract",
    size: 20,
    members: [],
    lifecycle: "inactive",
    visibility: "public",
    tags: []
  };

  const militiaGroup: OperationalGroup = {
    id: createOpaqueId("opg"),
    name: "Valley Levy",
    definitionId: "custom:peasant-militia",
    membershipMode: "abstract",
    size: 50,
    members: [],
    lifecycle: "inactive",
    visibility: "public",
    tags: []
  };

  const opGroupPeople: DomainPeopleData = {
    ...vacantPeople,
    roles: [],
    operationalGroups: [fortGroup, militiaGroup]
  };

  const report4 = resolver.resolveEffectiveCapabilities({
    domainUuid,
    peopleData: opGroupPeople,
    roleDefinitions: roleDefs,
    operationalGroupDefinitions: groupDefs
  });

  assert.ok(
    report4.enabledCapabilityIds.includes("cap:fortification"),
    "Fort garrison with keepGrantWhenInactive=true keeps grant when inactive"
  );
  assert.equal(
    report4.enabledCapabilityIds.includes("cap:emergency-levy"),
    false,
    "Militia with keepGrantWhenInactive=false loses grant when inactive"
  );

  // Test Case 5: Disbanded group never keeps grant even with keepGrantWhenInactive=true
  const disbandedFort: OperationalGroup = {
    ...fortGroup,
    lifecycle: "disbanded"
  };
  const report5 = resolver.resolveEffectiveCapabilities({
    domainUuid,
    peopleData: { ...opGroupPeople, operationalGroups: [disbandedFort] },
    roleDefinitions: roleDefs,
    operationalGroupDefinitions: groupDefs
  });
  assert.equal(report5.enabledCapabilityIds.includes("cap:fortification"), false, "Disbanded group never keeps grants");

  // Test Case 6: Group role when group is disbanded grants nothing
  const squadRole: DomainRole = {
    id: createOpaqueId("role"),
    definitionId: "custom:squad-leader",
    occupants: [notable1],
    visibility: "public",
    scope: "operational-group",
    operationalGroupId: opGroupId,
    tags: []
  };

  const report6 = resolver.resolveEffectiveCapabilities({
    domainUuid,
    peopleData: { ...opGroupPeople, operationalGroups: [disbandedFort], roles: [squadRole] },
    roleDefinitions: roleDefs,
    operationalGroupDefinitions: groupDefs
  });
  assert.equal(report6.enabledCapabilityIds.includes("cap:recon"), false, "Group role of disbanded group never grants");
});
