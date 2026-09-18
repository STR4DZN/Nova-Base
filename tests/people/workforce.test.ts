import assert from "node:assert/strict";
import test from "node:test";
import { calculateWorkforce } from "../../src/people/workforce/workforce-calculator.js";
import { createDefaultDomainPeopleData, type DomainPeopleData } from "../../src/people/people-data.js";

test("G3.6 - Workforce: Formula calculates capacity, committed, reserved, available correctly", () => {
  const basePeople = createDefaultDomainPeopleData();

  const people: DomainPeopleData = {
    ...basePeople,
    operationalGroups: [
      {
        id: "opg_11111111-1111-4111-8111-111111111111",
        name: "Town Builders",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "abstract",
        size: 50,
        members: [],
        lifecycle: "active",
        visibility: "public",
        tags: []
      }
    ],
    assignments: [
      {
        id: "asg_22222222-2222-4222-8222-222222222222",
        sourceRef: "opg_11111111-1111-4111-8111-111111111111",
        targetRef: "prj_bridge_build",
        workforceTypeId: "general",
        amount: 20,
        status: "active"
      }
    ],
    reservations: [
      {
        id: "resv_33333333-3333-4333-8333-333333333333",
        sourceRef: "opg_11111111-1111-4111-8111-111111111111",
        targetRef: "prj_wall_repair",
        workforceTypeId: "general",
        amount: 10,
        status: "active"
      }
    ]
  };

  const report = calculateWorkforce(people);
  const general = report.types["general"];
  assert.ok(general);
  assert.equal(general.capacity, 50);
  assert.equal(general.committed, 20);
  assert.equal(general.reserved, 10);
  assert.equal(general.available, 20); // 50 - 20 - 10 = 20
  assert.equal(general.isOvercommitted, false);
  assert.equal(report.isAnyOvercommitted, false);
});

test("G3.6 - Workforce: Inactive or disbanded operational groups contribute 0 capacity", () => {
  const basePeople = createDefaultDomainPeopleData();

  const people: DomainPeopleData = {
    ...basePeople,
    operationalGroups: [
      {
        id: "opg_11111111-1111-4111-8111-111111111111",
        name: "Reserve Militia",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract",
        size: 40,
        members: [],
        lifecycle: "inactive",
        visibility: "public",
        tags: []
      },
      {
        id: "opg_22222222-2222-4222-8222-222222222222",
        name: "Old Guard",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract",
        size: 30,
        members: [],
        lifecycle: "disbanded",
        visibility: "public",
        tags: []
      },
      {
        id: "opg_33333333-3333-4333-8333-333333333333",
        name: "Active Patrol",
        definitionId: "domain-manager:scout-patrol",
        membershipMode: "abstract",
        size: 15,
        members: [],
        lifecycle: "active",
        visibility: "public",
        tags: []
      }
    ]
  };

  const report = calculateWorkforce(people);
  const military = report.types["military"];
  assert.ok(military);
  // Only the active patrol of size 15 contributes
  assert.equal(military.capacity, 15);
  assert.equal(military.contributions.length, 1);
  assert.equal(military.contributions[0].sourceName, "Active Patrol");
});

test("G3.6 - Workforce: Anti-double-count between linked operational groups and population groups", () => {
  const basePeople = createDefaultDomainPeopleData();
  const popGroupId = "pop_11111111-1111-4111-8111-111111111111";

  const people: DomainPeopleData = {
    ...basePeople,
    populationGroups: [
      {
        id: popGroupId,
        name: "Town Citizens",
        count: 200,
        precision: "exact",
        includedInTotal: true,
        tags: [],
        // Population group declares a general workforce contribution of 50
        ...({ workforceContributions: [{ workforceTypeId: "general", amount: 50 }] } as any)
      }
    ],
    operationalGroups: [
      {
        id: "opg_22222222-2222-4222-8222-222222222222",
        name: "Town Watch Levy",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "abstract",
        size: 30,
        members: [],
        lifecycle: "active",
        visibility: "public",
        populationGroupId: popGroupId, // Linked to the same population group
        tags: []
      }
    ]
  };

  const report = calculateWorkforce(people);
  const general = report.types["general"];
  assert.ok(general);
  // Town Watch Levy contributes 30. The linked Town Citizens' 50 is deducted by 30 = 20 remaining, total capacity = 50 (no double count to 80!)
  assert.equal(general.capacity, 50);
  assert.equal(report.warnings.length, 1);
  assert.ok(report.warnings[0].includes("to prevent double-counting linked operational groups"));
});

test("G3.6 - Workforce: Expired reservation automatically releases reserved capacity", () => {
  const basePeople = createDefaultDomainPeopleData();
  const now = 1000000;

  const people: DomainPeopleData = {
    ...basePeople,
    operationalGroups: [
      {
        id: "opg_11111111-1111-4111-8111-111111111111",
        name: "Militia",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract",
        size: 50,
        members: [],
        lifecycle: "active",
        visibility: "public",
        tags: []
      }
    ],
    reservations: [
      {
        id: "resv_expired",
        sourceRef: "opg_11111111-1111-4111-8111-111111111111",
        targetRef: "prj_old_expedition",
        workforceTypeId: "military",
        amount: 25,
        status: "active",
        expiresAtReal: now - 5000 // Expired 5 seconds ago
      },
      {
        id: "resv_active",
        sourceRef: "opg_11111111-1111-4111-8111-111111111111",
        targetRef: "prj_current_patrol",
        workforceTypeId: "military",
        amount: 15,
        status: "active",
        expiresAtReal: now + 5000 // Valid
      }
    ]
  };

  const report = calculateWorkforce(people, now);
  const military = report.types["military"];
  assert.ok(military);
  assert.equal(military.capacity, 50);
  assert.equal(military.reserved, 15); // Only active non-expired reservation counted
  assert.equal(military.available, 35);
});
