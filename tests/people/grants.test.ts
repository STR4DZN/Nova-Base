import assert from "node:assert/strict";
import test from "node:test";
import { resolvePeopleEffectiveCapabilities } from "../../src/aggregation/people-grants.js";
import {
  createDefaultDomainPeopleData,
  withDomainPeopleData,
  type DomainPeopleData
} from "../../src/people/people-data.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import type { RoleDefinition } from "../../src/people/roles/role-types.js";
import type { OperationalGroupDefinition } from "../../src/people/operational-groups/operational-group-types.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";

const customRoleDefinitions: readonly RoleDefinition[] = [
  {
    id: "domain-manager:leader",
    version: 1,
    label: "Leader",
    occupancy: { min: 1, max: 1 },
    grants: ["domain-manager:sovereignty", "domain-manager:diplomacy"]
  },
  {
    id: "domain-manager:commander",
    version: 1,
    label: "Military Commander",
    occupancy: { min: 0, max: 1 },
    grants: ["domain-manager:martial-law"]
  }
];

const customOpGroupDefinitions: readonly OperationalGroupDefinition[] = [
  {
    id: "domain-manager:militia",
    version: 1,
    label: "Militia",
    grants: ["domain-manager:martial-law", "domain-manager:garrison"]
  }
];

const baseRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Summary", description: "Description" },
    classification: { kind: "base", scale: "small", tags: ["starter"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

test("G3.8 - Grants: Vacant roles do not grant capabilities", () => {
  const roleId = createOpaqueId("role");
  const people: DomainPeopleData = {
    ...createDefaultDomainPeopleData(),
    roles: [
      {
        id: roleId,
        definitionId: "domain-manager:leader",
        occupants: [], // Vacant
        visibility: "public",
        tags: []
      }
    ]
  };

  const domain = withDomainPeopleData(baseRecord, people);
  const report = resolvePeopleEffectiveCapabilities(domain, customRoleDefinitions, customOpGroupDefinitions);

  assert.equal(report.enabledCapabilityIds.includes("domain-manager:sovereignty"), false);
  assert.equal(report.grantsByCapability["domain-manager:sovereignty"], undefined);
});

test("G3.8 - Grants: Assigning occupant grants capability with provenance (DEC-1027, DEC-1031)", () => {
  const notableId = createOpaqueId("not");
  const roleId = createOpaqueId("role");

  const people: DomainPeopleData = {
    ...createDefaultDomainPeopleData(),
    notables: [
      {
        id: notableId,
        name: "Arthur",
        type: "inline",
        visibility: "public",
        tags: []
      }
    ],
    roles: [
      {
        id: roleId,
        definitionId: "domain-manager:leader",
        customLabel: "King",
        occupants: [notableId], // Filled
        visibility: "public",
        tags: []
      }
    ]
  };

  const domain = withDomainPeopleData(baseRecord, people);
  const report = resolvePeopleEffectiveCapabilities(domain, customRoleDefinitions, customOpGroupDefinitions);

  assert.ok(report.enabledCapabilityIds.includes("domain-manager:sovereignty"));
  assert.ok(report.enabledCapabilityIds.includes("domain-manager:diplomacy"));

  const sovGrants = report.grantsByCapability["domain-manager:sovereignty"];
  assert.equal(sovGrants.length, 1);
  assert.equal(sovGrants[0].sourceType, "role");
  assert.equal(sovGrants[0].sourceId, roleId);
  assert.equal(sovGrants[0].sourceLabel, "King");

  // Verify persistence record was NOT mutated (DEC-1027: derived only)
  assert.deepEqual(domain.definition.capabilities.enabled, [
    "domain-manager:domain",
    "domain-manager:people"
  ]);
});

test("G3.8 - Grants: Multi-source provenance and removal rules (DEC-1028, DEC-1030)", () => {
  const notableId = createOpaqueId("not");
  const roleId = createOpaqueId("role");
  const opgId = createOpaqueId("opg");

  // Both commander role and militia operational group grant "domain-manager:martial-law"
  const peopleWithBoth: DomainPeopleData = {
    ...createDefaultDomainPeopleData(),
    notables: [
      {
        id: notableId,
        name: "General Vance",
        type: "inline",
        visibility: "public",
        tags: []
      }
    ],
    roles: [
      {
        id: roleId,
        definitionId: "domain-manager:commander",
        occupants: [notableId],
        visibility: "public",
        tags: []
      }
    ],
    operationalGroups: [
      {
        id: opgId,
        name: "City Guard",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract",
        size: 50,
        members: [],
        lifecycle: "active",
        visibility: "public",
        tags: []
      }
    ]
  };

  // 1. Both sources active: 2 provenances listed
  const domain1 = withDomainPeopleData(baseRecord, peopleWithBoth);
  const report1 = resolvePeopleEffectiveCapabilities(domain1, customRoleDefinitions, customOpGroupDefinitions);

  const martialLaw1 = report1.grantsByCapability["domain-manager:martial-law"];
  assert.ok(martialLaw1);
  assert.equal(martialLaw1.length, 2);
  assert.equal(martialLaw1.some((p) => p.sourceId === roleId), true);
  assert.equal(martialLaw1.some((p) => p.sourceId === opgId), true);

  // 2. Vance is removed from commander (role becomes vacant).
  // Commander provenance is removed, but martial-law remains active because opg still grants it! (DEC-1030)
  const peopleWithoutCommander: DomainPeopleData = {
    ...peopleWithBoth,
    roles: [
      {
        id: roleId,
        definitionId: "domain-manager:commander",
        occupants: [], // Vacant
        visibility: "public",
        tags: []
      }
    ]
  };

  const domain2 = withDomainPeopleData(baseRecord, peopleWithoutCommander);
  const report2 = resolvePeopleEffectiveCapabilities(domain2, customRoleDefinitions, customOpGroupDefinitions);

  assert.ok(report2.enabledCapabilityIds.includes("domain-manager:martial-law"));
  const martialLaw2 = report2.grantsByCapability["domain-manager:martial-law"];
  assert.ok(martialLaw2);
  assert.equal(martialLaw2.length, 1);
  assert.equal(martialLaw2[0].sourceId, opgId);

  // 3. Militia becomes inactive (DEC-1090)
  const peopleWithInactiveMilitia: DomainPeopleData = {
    ...peopleWithoutCommander,
    operationalGroups: [
      {
        id: opgId,
        name: "City Guard",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract",
        size: 50,
        members: [],
        lifecycle: "inactive", // Inactive
        visibility: "public",
        tags: []
      }
    ]
  };

  const domain3 = withDomainPeopleData(baseRecord, peopleWithInactiveMilitia);
  const report3 = resolvePeopleEffectiveCapabilities(domain3, customRoleDefinitions, customOpGroupDefinitions);

  // Now neither source provides martial-law: capability is cleanly removed!
  assert.equal(report3.enabledCapabilityIds.includes("domain-manager:martial-law"), false);
  assert.equal(report3.grantsByCapability["domain-manager:martial-law"], undefined);
});
