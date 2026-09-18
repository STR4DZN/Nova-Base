import assert from "node:assert/strict";
import test from "node:test";
import {
  DomainIntegrityChecker,
  type DomainIntegrityDocument
} from "../../src/storage/integrity/domain-integrity-checker.js";
import { domainCapabilityRegistry } from "../../src/domains/domain-capabilities.js";
import {
  validateDomainPeopleData,
  tryGetDomainPeopleData,
  getDomainPeopleData,
  withDomainPeopleData,
  createDefaultDomainPeopleData,
  type DomainPeopleData
} from "../../src/people/people-data.js";
import { PeopleRepository } from "../../src/people/repositories/people-repository.js";
import {
  DomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";

const baseRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Summary", description: "Description" },
    classification: { kind: "base", scale: "small", tags: [] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain", "domain-manager:people"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

function document(
  id: string,
  record: DomainRecord
): IdentifiedJournalEntryDocumentLike {
  let currentRecord = record;
  return {
    id,
    uuid: `JournalEntry.${id}`,
    get name() { return "Domain " + id; },
    get flags() { return { "domain-manager": currentRecord }; },
    update: async (data: any) => {
      const p = data["flags.domain-manager"];
      if (p) currentRecord = p;
    }
  };
}

test("G3 Integrity: Corrupted People data fails closed without silent fallback", () => {
  // 1. Completely corrupted payload
  const corruptedPayload = {
    schemaVersion: 1,
    population: { mode: "unknown-invalid-mode" },
    notables: "not-an-array"
  };

  const validation = validateDomainPeopleData(corruptedPayload);
  assert.equal(validation.ok, false, "Corrupted payload must fail validation");

  const corruptedRecord: DomainRecord = {
    ...baseRecord,
    definition: {
      ...baseRecord.definition,
      capabilities: {
        ...baseRecord.definition.capabilities,
        config: {
          "domain-manager:people": corruptedPayload
        }
      }
    }
  };

  // 2. tryGetDomainPeopleData returns error
  const tryRes = tryGetDomainPeopleData(corruptedRecord);
  assert.equal(tryRes.ok, false, "tryGetDomainPeopleData must return error result on corrupted data");

  // 3. getDomainPeopleData throws rather than silently replacing with default
  assert.throws(
    () => getDomainPeopleData(corruptedRecord),
    /Domain people data corruption/,
    "getDomainPeopleData must throw on corrupted data"
  );

  // 4. PeopleRepository returns error result
  const store: DomainDocumentStore = {
    get: () => document("je-corrupt", corruptedRecord),
    list: () => [document("je-corrupt", corruptedRecord)],
    create: async () => { throw new Error("not implemented"); }
  };
  const domains = new DomainRepository(store);
  const peopleRepo = new PeopleRepository(domains);

  peopleRepo.getPeopleData("JournalEntry.je-corrupt").then((res) => {
    assert.equal(res.ok, false, "PeopleRepository.getPeopleData must fail closed");
  });
});

test("G3 Integrity: DomainIntegrityChecker detects corrupted People capability config", () => {
  const checker = new DomainIntegrityChecker({ capabilityRegistry: domainCapabilityRegistry });

  const corruptedDoc: DomainIntegrityDocument = {
    id: "je-corrupt",
    uuid: "JournalEntry.je-corrupt",
    name: "Corrupt Domain",
    record: {
      ...baseRecord,
      definition: {
        ...baseRecord.definition,
        capabilities: {
          ...baseRecord.definition.capabilities,
          config: {
            "domain-manager:people": {
              schemaVersion: 999, // Invalid schemaVersion
              population: null
            }
          }
        }
      }
    }
  };

  const report = checker.check([corruptedDoc]);
  assert.equal(report.healthy, false);
  assert.ok(report.errorCount > 0);
  assert.ok(report.issues.some((i) => i.code === "DM_INVALID_CAPABILITY_CONFIG" || i.code === "DM_PEOPLE_INVALID_SCHEMA_VERSION"));
});

test("G3 Integrity: DomainIntegrityChecker detects dangling Notable references in roles and operational groups", () => {
  const checker = new DomainIntegrityChecker({ capabilityRegistry: domainCapabilityRegistry });

  const nonExistentNotableId = createOpaqueId("not");
  const validNotableId = createOpaqueId("not");

  const peopleWithDangling: DomainPeopleData = {
    ...createDefaultDomainPeopleData(),
    notables: [
      {
        id: validNotableId,
        type: "inline",
        name: "Legitimate Hero",
        visibility: "public",
        tags: []
      }
    ],
    roles: [
      {
        id: createOpaqueId("role"),
        definitionId: "domain-manager:leader",
        occupants: [nonExistentNotableId], // Dangling notable!
        visibility: "public",
        tags: []
      }
    ],
    operationalGroups: [
      {
        id: createOpaqueId("opg"),
        name: "Phantom Squad",
        definitionId: "domain-manager:labor-squad",
        membershipMode: "partial",
        size: 5,
        members: [nonExistentNotableId], // Dangling notable!
        lifecycle: "active",
        visibility: "public",
        tags: []
      }
    ]
  };

  const domainRecord = withDomainPeopleData(baseRecord, peopleWithDangling);
  const doc: DomainIntegrityDocument = {
    id: "je-dangling-not",
    uuid: "JournalEntry.je-dangling-not",
    name: "Dangling Domain",
    record: domainRecord
  };

  const report = checker.check([doc]);
  assert.equal(report.healthy, false);
  const danglingNotableIssues = report.issues.filter((i) => i.code === "DM_PEOPLE_DANGLING_NOTABLE_REF");
  assert.equal(danglingNotableIssues.length, 2, "Must detect dangling notable in both role and group");
});

test("G3 Integrity: DomainIntegrityChecker detects dangling Group and PopulationGroup references", () => {
  const checker = new DomainIntegrityChecker({ capabilityRegistry: domainCapabilityRegistry });

  const nonExistentGroupId = createOpaqueId("opg");
  const nonExistentPopGroupId = createOpaqueId("pop");

  const peopleWithDanglingGroups: DomainPeopleData = {
    ...createDefaultDomainPeopleData(),
    roles: [
      {
        id: createOpaqueId("role"),
        definitionId: "custom:squad-leader",
        scope: "operational-group",
        operationalGroupId: nonExistentGroupId, // Dangling group!
        occupants: [],
        visibility: "public",
        tags: []
      }
    ],
    operationalGroups: [
      {
        id: createOpaqueId("opg"),
        name: "Orphaned Patrol",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract",
        size: 10,
        populationGroupId: nonExistentPopGroupId, // Dangling pop group!
        members: [],
        lifecycle: "active",
        visibility: "public",
        tags: []
      }
    ]
  };

  const domainRecord = withDomainPeopleData(baseRecord, peopleWithDanglingGroups);
  const doc: DomainIntegrityDocument = {
    id: "je-dangling-grp",
    uuid: "JournalEntry.je-dangling-grp",
    name: "Dangling Group Domain",
    record: domainRecord
  };

  const report = checker.check([doc]);
  assert.equal(report.healthy, false);
  assert.ok(report.issues.some((i) => i.code === "DM_PEOPLE_DANGLING_GROUP_REF"));
  assert.ok(report.issues.some((i) => i.code === "DM_PEOPLE_DANGLING_POPULATION_GROUP_REF"));
});

test("G3 Integrity: DomainIntegrityChecker detects invalid Actor references in actor-type Notables", () => {
  const checker = new DomainIntegrityChecker({ capabilityRegistry: domainCapabilityRegistry });

  const peopleWithInvalidActor: DomainPeopleData = {
    ...createDefaultDomainPeopleData(),
    notables: [
      {
        id: createOpaqueId("not"),
        type: "actor",
        actorUuid: "InvalidRef.123", // Broken actor reference!
        visibility: "public",
        tags: []
      }
    ]
  };

  const domainRecord = withDomainPeopleData(baseRecord, peopleWithInvalidActor);
  const doc: DomainIntegrityDocument = {
    id: "je-invalid-actor",
    uuid: "JournalEntry.je-invalid-actor",
    name: "Invalid Actor Domain",
    record: domainRecord
  };

  const report = checker.check([doc]);
  assert.equal(report.healthy, false);
  assert.ok(report.issues.some((i) => i.code === "DM_NOTABLE_INVALID_ACTOR_REF" || i.code === "DM_PEOPLE_INVALID_ACTOR_REF"));
});

test("G3 Integrity: Fully consistent domain with People data passes integrity check", () => {
  const checker = new DomainIntegrityChecker({ capabilityRegistry: domainCapabilityRegistry });

  const notId = createOpaqueId("not");
  const popId = createOpaqueId("pop");
  const opgId = createOpaqueId("opg");
  const roleId = createOpaqueId("role");

  const healthyPeople: DomainPeopleData = {
    ...createDefaultDomainPeopleData(),
    population: {
      mode: "manual",
      total: 500,
      precision: "exact"
    },
    populationGroups: [
      {
        id: popId,
        name: "Citizens",
        count: 500,
        includedInTotal: true,
        precision: "exact",
        tags: []
      }
    ],
    notables: [
      {
        id: notId,
        type: "inline",
        name: "General Vance",
        visibility: "public",
        tags: []
      }
    ],
    roles: [
      {
        id: roleId,
        definitionId: "domain-manager:leader",
        occupants: [notId],
        visibility: "public",
        tags: []
      }
    ],
    operationalGroups: [
      {
        id: opgId,
        name: "Palace Guard",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract",
        size: 20,
        populationGroupId: popId,
        members: [],
        lifecycle: "active",
        visibility: "public",
        tags: []
      }
    ]
  };

  const domainRecord = withDomainPeopleData(baseRecord, healthyPeople);
  const doc: DomainIntegrityDocument = {
    id: "je-healthy",
    uuid: "JournalEntry.je-healthy",
    name: "Healthy Domain",
    record: domainRecord
  };

  const report = checker.check([doc]);
  assert.equal(report.healthy, true, `Report should be healthy, issues: ${JSON.stringify(report.issues)}`);
  assert.equal(report.errorCount, 0);
});
