import assert from "node:assert/strict";
import test from "node:test";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import {
  createDefaultDomainPeopleData,
  withDomainPeopleData,
  type DomainPeopleData
} from "../../src/people/people-data.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { calculatePopulation } from "../../src/people/population/population-calculator.js";
import { calculateWorkforce } from "../../src/people/workforce/workforce-calculator.js";
import { resolvePeopleEffectiveCapabilities } from "../../src/aggregation/people-grants.js";
import { evaluateRole, DEFAULT_ROLE_DEFINITIONS } from "../../src/people/roles/role-types.js";
import { resolveNotableStatus } from "../../src/people/notables/notable-types.js";
import { validateOperationalGroup } from "../../src/people/operational-groups/operational-group-types.js";
import {
  DomainIntegrityChecker,
  type DomainIntegrityDocument
} from "../../src/storage/integrity/domain-integrity-checker.js";
import { domainCapabilityRegistry } from "../../src/domains/domain-capabilities.js";

const baseRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 1,
  definition: {
    identity: { aliases: ["Metro"], summary: "Grand Metropolis", description: "Large urban center" },
    classification: { kind: "base", scale: "large", tags: ["capital", "metropolis"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:people"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

test("G3.10 - Scale & Acceptance: 12+ Notables, large populations, and full subsystem integrity", () => {
  // 1. Create 14 Notables (mix of inline and actor-linked)
  const notables = [];
  const notableIds: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const id = createOpaqueId("not");
    notableIds.push(id);
    if (i % 2 === 0) {
      notables.push({
        id,
        type: "actor" as const,
        actorUuid: `Actor.actor${i.toString().padStart(12, "0")}`,
        name: `Notable Official ${i}`,
        visibility: i === 14 ? ("secret" as const) : ("public" as const),
        tags: ["official", `rank-${i}`]
      });
    } else {
      notables.push({
        id,
        type: "inline" as const,
        name: `Notable Citizen ${i}`,
        visibility: "public" as const,
        tags: ["citizen"]
      });
    }
  }
  assert.equal(notables.length, 14);

  // 2. Large Population Groups (> 75,000 total)
  const pop1Id = createOpaqueId("pop");
  const pop2Id = createOpaqueId("pop");
  const pop3Id = createOpaqueId("pop");

  const populationGroups = [
    {
      id: pop1Id,
      name: "Inner City Residents",
      count: 45000,
      precision: "exact" as const,
      includedInTotal: true,
      tags: ["urban"]
    },
    {
      id: pop2Id,
      name: "Outer Suburbs & Workers",
      count: 28500,
      precision: "exact" as const,
      includedInTotal: true,
      tags: ["suburbs"],
      // Declares general workforce contribution of 5000
      ...({ workforceContributions: [{ workforceTypeId: "general", amount: 5000 }] } as any)
    },
    {
      id: pop3Id,
      name: "Visiting Merchants & Travelers",
      count: 2000,
      precision: "estimated" as const,
      includedInTotal: true,
      tags: ["transient"]
    }
  ];

  // 3. Operational Groups (mix of modes)
  const opgLaborId = createOpaqueId("opg");
  const opgMilitiaId = createOpaqueId("opg");
  const opgScoutsId = createOpaqueId("opg");

  const operationalGroups = [
    {
      id: opgLaborId,
      name: "Metropolitan Civil Works",
      definitionId: "domain-manager:labor-squad",
      membershipMode: "abstract" as const,
      size: 1500,
      members: [],
      lifecycle: "active" as const,
      visibility: "public" as const,
      populationGroupId: pop2Id, // Linked to Outer Suburbs
      tags: ["civil", "labor"]
    },
    {
      id: opgMilitiaId,
      name: "Capital City Guard",
      definitionId: "domain-manager:militia",
      membershipMode: "partial" as const,
      size: 600,
      members: [notableIds[0], notableIds[1]],
      lifecycle: "active" as const,
      visibility: "public" as const,
      tags: ["military", "guard"]
    },
    {
      id: opgScoutsId,
      name: "Elite Royal Pathfinders",
      definitionId: "domain-manager:scout-patrol",
      membershipMode: "explicit" as const,
      size: 3,
      members: [notableIds[2], notableIds[3], notableIds[4]],
      lifecycle: "active" as const,
      visibility: "public" as const,
      tags: ["recon"]
    }
  ];

  // 4. Roles
  const roleLeaderId = createOpaqueId("role");
  const roleTreasurerId = createOpaqueId("role");
  const roleCommanderId = createOpaqueId("role");
  const roleCouncilorId = createOpaqueId("role");

  const roles = [
    {
      id: roleLeaderId,
      definitionId: "domain-manager:leader",
      customLabel: "Grand Archon",
      occupants: [notableIds[0]], // Filled
      visibility: "public" as const,
      tags: ["executive"]
    },
    {
      id: roleTreasurerId,
      definitionId: "domain-manager:treasurer",
      occupants: [notableIds[1]], // Filled
      visibility: "public" as const,
      tags: ["finance"]
    },
    {
      id: roleCommanderId,
      definitionId: "domain-manager:commander",
      occupants: [], // Vacant (min: 0, max: 1)
      visibility: "public" as const,
      tags: ["military"]
    },
    {
      id: roleCouncilorId,
      definitionId: "domain-manager:councilor",
      occupants: [notableIds[5], notableIds[6], notableIds[7]],
      visibility: "public" as const,
      tags: ["advisory"]
    }
  ];

  // 5. Assignments and Reservations
  const assignments = [
    {
      id: createOpaqueId("asg"),
      sourceRef: opgLaborId,
      targetRef: "prj_grand_cathedral",
      workforceTypeId: "general",
      amount: 800,
      status: "active" as const
    }
  ];

  const reservations = [
    {
      id: createOpaqueId("resv"),
      sourceRef: opgLaborId,
      targetRef: "prj_canal_expansion",
      workforceTypeId: "general",
      amount: 400,
      status: "active" as const
    }
  ];

  const peopleData: DomainPeopleData = {
    schemaVersion: 1,
    population: {
      mode: "sumGroups",
      total: null,
      precision: "exact"
    },
    populationGroups,
    notables,
    roles,
    operationalGroups,
    assignments,
    reservations
  };

  const domain = withDomainPeopleData(baseRecord, peopleData);

  // --- ACCEPTANCE CRITERIA VALIDATIONS ---

  // 1. Population resolution on scale (45000 + 28500 + 2000 = 75500, estimated precision due to pop3)
  const popRes = calculatePopulation(peopleData.population, peopleData.populationGroups);
  assert.equal(popRes.total, 75500);
  assert.equal(popRes.precision, "estimated");

  // 2. Anti-double-count: opgLaborId (1500) linked to pop2Id (5000) deducts 1500, leaving 3500 from pop2Id.
  // Total general capacity = 1500 (from opg) + 3500 (net from pop2) = 5000.
  const wfReport = calculateWorkforce(peopleData);
  const generalWf = wfReport.types["general"];
  assert.equal(generalWf.capacity, 5000);
  assert.equal(generalWf.committed, 800);
  assert.equal(generalWf.reserved, 400);
  assert.equal(generalWf.available, 3800); // 5000 - 800 - 400 = 3800
  assert.equal(generalWf.isOvercommitted, false);

  // Military capacity: 600 (from militia) + 3 (from pathfinders) = 603
  const militaryWf = wfReport.types["military"];
  assert.equal(militaryWf.capacity, 603);

  // 3. Explicit membership mode size derivation
  const explicitOpg = operationalGroups.find((g) => g.id === opgScoutsId)!;
  const validatedExplicit = validateOperationalGroup(explicitOpg);
  assert.equal(validatedExplicit.ok, true);
  if (validatedExplicit.ok) {
    assert.equal(validatedExplicit.value.size, 3);
  }

  // 4. Role min requirement vs domain validity:
  // Leader is filled -> satisfies requirement
  const leaderEval = evaluateRole(roles[0], DEFAULT_ROLE_DEFINITIONS);
  assert.equal(leaderEval.isRequirementSatisfied, true);

  // Understaffed leader if vacant:
  const vacantLeader = { ...roles[0], occupants: [] };
  const vacantLeaderEval = evaluateRole(vacantLeader, DEFAULT_ROLE_DEFINITIONS);
  assert.equal(vacantLeaderEval.isUnderstaffed, true);
  assert.equal(vacantLeaderEval.isRequirementSatisfied, false);
  // But domain itself is NOT invalidated (evaluated as runtime requirement, not fatal schema failure)

  // 5. Notable survives missing actor (broken-ref resilience)
  const missingActorNotable = notables[1]; // notable 2
  const missingActorStatus = resolveNotableStatus(missingActorNotable, () => null);
  assert.equal(missingActorStatus.isBrokenRef, true);
  assert.equal(missingActorStatus.resolvedName, missingActorNotable.name); // Still has its own name!

  // 6. Capability grants aggregation
  const capReport = resolvePeopleEffectiveCapabilities(domain);
  assert.ok(capReport.enabledCapabilityIds.includes("domain-manager:domain"));
  assert.ok(capReport.enabledCapabilityIds.includes("domain-manager:people"));

  // 7. DomainIntegrityChecker verification
  const doc: DomainIntegrityDocument = {
    id: "domain_metropolis_1",
    uuid: "JournalEntry.domain_metropolis_1",
    name: "Grand Metropolis",
    record: domain
  };

  const checker = new DomainIntegrityChecker({
    expectedSchemaVersion: 1,
    capabilityRegistry: domainCapabilityRegistry
  });

  const integrityReport = checker.check([doc]);
  assert.equal(integrityReport.checked, 1);
  assert.equal(integrityReport.healthy, true);
  assert.equal(integrityReport.errorCount, 0);
});
