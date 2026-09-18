import test from "node:test";
import assert from "node:assert/strict";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import { PeopleProjectionService } from "../../src/projection/people/people-projection-service.js";
import type { DomainPeopleData } from "../../src/people/people-data.js";
import type { RoleDefinition } from "../../src/people/roles/role-types.js";
import type { OperationalGroupDefinition } from "../../src/people/operational-groups/operational-group-types.js";

test("G3 Projection Security: Non-GM projection prevents data leaks across all derived values", () => {
  const domainUuid = "JournalEntry.domainSec123";
  const publicNotableId = createOpaqueId("not");
  const secretNotableId = createOpaqueId("not");

  const publicPopGroupId = createOpaqueId("pop");
  const secretPopGroupId = createOpaqueId("pop");

  const publicOpGroupId = createOpaqueId("opg");
  const secretOpGroupId = createOpaqueId("opg");

  const publicRoleId = createOpaqueId("role");
  const secretRoleId = createOpaqueId("role");

  const secretDef: RoleDefinition = {
    id: "custom:shadow-council",
    version: 1,
    label: "Shadow Council",
    occupancy: { min: 1, max: 1 },
    grants: ["cap:espionage"],
    grantPolicy: "occupied"
  };

  const publicDef: RoleDefinition = {
    id: "custom:public-steward",
    version: 1,
    label: "Public Steward",
    occupancy: { min: 1, max: 2 },
    grants: ["cap:administration"],
    grantPolicy: "occupied"
  };

  const secretGroupDef: OperationalGroupDefinition = {
    id: "custom:covert-agents",
    version: 1,
    label: "Covert Agents",
    grants: ["cap:infiltration"]
  };

  const rawPeople: DomainPeopleData = {
    population: { mode: "sumGroups", total: null, precision: "exact" },
    populationGroups: [
      {
        id: publicPopGroupId,
        name: "Townsfolk",
        count: 500,
        precision: "exact",
        includedInTotal: true,
        visibility: "public",
        workforceContributions: [{ workforceTypeId: "laborers", amount: 100 }],
        tags: []
      },
      {
        id: secretPopGroupId,
        name: "Hidden Cult",
        count: 250,
        precision: "exact",
        includedInTotal: true,
        visibility: "secret",
        workforceContributions: [{ workforceTypeId: "cultists", amount: 50 }],
        tags: []
      }
    ],
    notables: [
      {
        id: publicNotableId,
        name: "Mayor Goodfellow",
        type: "inline",
        visibility: "public",
        tags: []
      },
      {
        id: secretNotableId,
        name: "Spy Master",
        type: "inline",
        visibility: "secret",
        tags: []
      }
    ],
    roles: [
      {
        id: publicRoleId,
        definitionId: "custom:public-steward",
        occupants: [publicNotableId, secretNotableId], // secret notable is an occupant!
        visibility: "public",
        tags: []
      },
      {
        id: secretRoleId,
        definitionId: "custom:shadow-council",
        occupants: [secretNotableId],
        visibility: "secret",
        tags: []
      }
    ],
    operationalGroups: [
      {
        id: publicOpGroupId,
        name: "City Watch",
        definitionId: "domain-manager:militia",
        membershipMode: "explicit",
        size: 10,
        members: [publicNotableId, secretNotableId], // secret notable is a member!
        lifecycle: "active",
        visibility: "public",
        tags: []
      },
      {
        id: secretOpGroupId,
        name: "Black Daggers",
        definitionId: "custom:covert-agents",
        membershipMode: "abstract",
        size: 5,
        members: [],
        lifecycle: "active",
        visibility: "secret",
        tags: []
      }
    ],
    assignments: [
      {
        id: createOpaqueId("asg"),
        sourceRef: publicPopGroupId,
        targetRef: "prj_bridge",
        workforceTypeId: "laborers",
        amount: 20,
        status: "active",
        visibility: "public"
      },
      {
        id: createOpaqueId("asg"),
        sourceRef: secretPopGroupId,
        targetRef: "prj_ritual",
        workforceTypeId: "cultists",
        amount: 30,
        status: "active",
        visibility: "secret"
      }
    ],
    reservations: [
      {
        id: createOpaqueId("resv"),
        sourceRef: secretOpGroupId,
        targetRef: "prj_sabotage",
        workforceTypeId: "agents",
        amount: 5,
        status: "active",
        visibility: "secret"
      }
    ]
  };

  const projectionService = new PeopleProjectionService({
    roleDefinitions: [publicDef, secretDef],
    groupDefinitions: [secretGroupDef]
  });

  // 1. Non-GM Viewer Projection
  const viewerContext = projectionService.project(
    domainUuid,
    rawPeople,
    { userId: "player1", isGm: false }
  );

  // Assert secret population group is stripped
  assert.equal(viewerContext.populationGroups.length, 1);
  assert.equal(viewerContext.populationGroups[0].id, publicPopGroupId);

  // Assert derived population total does NOT leak secret count (500, not 750)
  assert.equal(viewerContext.population.resolution.total, 500);

  // Assert secret notable is stripped from notables
  assert.equal(viewerContext.notables.length, 1);
  assert.equal(viewerContext.notables[0].id, publicNotableId);

  // Assert secret notable is stripped from public role occupants
  assert.equal(viewerContext.roles.length, 1);
  assert.equal(viewerContext.roles[0].id, publicRoleId);
  assert.deepEqual(viewerContext.roles[0].occupants, [publicNotableId]);

  // Assert secret notable is stripped from public operational group members
  assert.equal(viewerContext.operationalGroups.length, 1);
  assert.equal(viewerContext.operationalGroups[0].id, publicOpGroupId);
  assert.deepEqual(viewerContext.operationalGroups[0].members, [publicNotableId]);

  // Assert secret assignments & reservations are stripped
  assert.equal(viewerContext.assignments.length, 1);
  assert.equal(viewerContext.reservations.length, 0);

  // Assert derived workforce does NOT leak cultists or secret capacity
  assert.equal(viewerContext.workforce.types["cultists"], undefined, "Secret workforce type must not exist");
  assert.equal(viewerContext.workforce.types["laborers"].capacity, 100);
  assert.equal(viewerContext.workforce.types["laborers"].committed, 20);
  assert.equal(viewerContext.workforce.types["laborers"].available, 80);
  assert.equal(viewerContext.workforce.totalCapacity, 110, "Total capacity is 100 laborers + 10 soldiers, excluding 50 secret cultists");

  // Assert derived capabilities do NOT leak secret role or secret op group grants
  assert.ok(viewerContext.capabilities.enabledCapabilityIds.includes("cap:administration"));
  assert.equal(
    viewerContext.capabilities.enabledCapabilityIds.includes("cap:espionage"),
    false,
    "Secret role grant cap:espionage must not leak"
  );
  assert.equal(
    viewerContext.capabilities.enabledCapabilityIds.includes("cap:infiltration"),
    false,
    "Secret op group grant cap:infiltration must not leak"
  );

  // 2. GM Administrative Projection
  const gmContext = projectionService.project(
    domainUuid,
    rawPeople,
    { userId: "gm1", isGm: true }
  );

  // GM sees everything
  assert.equal(gmContext.populationGroups.length, 2);
  assert.equal(gmContext.population.resolution.total, 750);
  assert.equal(gmContext.notables.length, 2);
  assert.equal(gmContext.roles.length, 2);
  assert.equal(gmContext.operationalGroups.length, 2);
  assert.equal(gmContext.assignments.length, 2);
  assert.equal(gmContext.reservations.length, 1);

  assert.ok(gmContext.workforce.types["cultists"], "GM sees cultists workforce");
  assert.equal(gmContext.workforce.totalCapacity, 165, "GM sees 100 + 10 + 50 + 5 = 165");

  assert.ok(gmContext.capabilities.enabledCapabilityIds.includes("cap:espionage"));
  assert.ok(gmContext.capabilities.enabledCapabilityIds.includes("cap:infiltration"));
});
