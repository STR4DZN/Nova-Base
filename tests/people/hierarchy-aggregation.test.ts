import test from "node:test";
import assert from "node:assert/strict";
import {
  DomainRepository,
  type DomainDocumentStore,
  type IdentifiedJournalEntryDocumentLike
} from "../../src/storage/repositories/domain-repository.js";
import { withDomainPeopleData, type DomainPeopleData } from "../../src/people/people-data.js";
import { PeopleAggregationService } from "../../src/aggregation/people-aggregation.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";

function document(
  id: string,
  name: string,
  value: Record<string, unknown>
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

function createStore(): DomainDocumentStore {
  const byKey = new Map<string, IdentifiedJournalEntryDocumentLike>();
  let nextId = 1;

  function registerDoc(doc: IdentifiedJournalEntryDocumentLike) {
    byKey.set(doc.id, doc);
    byKey.set(doc.uuid, doc);
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

function createDomainRecord(name: string, parentUuid: string | null, peopleData: DomainPeopleData) {
  const baseRecord = {
    schemaVersion: 1,
    revision: 0,
    definition: {
      identity: { aliases: [], summary: "", description: "" },
      classification: { kind: "settlement", scale: "medium", tags: [] },
      hierarchy: { parentDomainUuid: parentUuid },
      capabilities: { enabled: [], config: {} }
    },
    state: { lifecycle: "active" as const },
    metadata: {
      createdByUserId: "test-user",
      archivedAt: null,
      source: { type: "manual" as const, ref: null }
    }
  };
  return withDomainPeopleData(baseRecord, peopleData);
}

test("G3 People Hierarchy Aggregation: Rollup of population, precision propagation, workforce summary and cycle detection", async () => {
  const store = createStore();
  const repo = new DomainRepository(store);

  // 1. Root Domain (Duchy): 1000 exact population, 50 laborers
  const duchyPeople: DomainPeopleData = {
    schemaVersion: 1,
    population: { mode: "manual", total: 1000, precision: "exact" },
    populationGroups: [
      {
        id: createOpaqueId("pop"),
        name: "City Laborers",
        count: 50,
        precision: "exact",
        includedInTotal: true,
        visibility: "public",
        workforceContributions: [{ workforceTypeId: "laborers", amount: 50 }],
        tags: []
      }
    ],
    notables: [],
    roles: [],
    operationalGroups: [],
    assignments: [],
    reservations: []
  };

  const duchyDocRes = await repo.create({
    name: "Grand Duchy",
    record: createDomainRecord("Grand Duchy", null, duchyPeople)
  });
  assert.equal(duchyDocRes.ok, true, !duchyDocRes.ok ? JSON.stringify(duchyDocRes.error) : "");
  const duchy = duchyDocRes.value;

  // 2. Child Domain (County): 300 exact population, 20 laborers + 10 soldiers
  const countyPeople: DomainPeopleData = {
    schemaVersion: 1,
    population: { mode: "manual", total: 300, precision: "exact" },
    populationGroups: [
      {
        id: createOpaqueId("pop"),
        name: "County Laborers",
        count: 20,
        precision: "exact",
        includedInTotal: true,
        visibility: "public",
        workforceContributions: [{ workforceTypeId: "laborers", amount: 20 }],
        tags: []
      }
    ],
    notables: [],
    roles: [],
    operationalGroups: [
      {
        id: createOpaqueId("opg"),
        name: "County Guard",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract",
        size: 10,
        members: [],
        lifecycle: "active",
        visibility: "public",
        tags: []
      }
    ],
    assignments: [],
    reservations: []
  };

  const countyDocRes = await repo.create({
    name: "Border County",
    record: createDomainRecord("Border County", duchy.uuid, countyPeople)
  });
  assert.equal(countyDocRes.ok, true);
  const county = countyDocRes.value;

  // 3. Grandchild Domain (Village): 150 estimated population, 15 laborers
  const villagePeople: DomainPeopleData = {
    schemaVersion: 1,
    population: { mode: "manual", total: 150, precision: "estimated" },
    populationGroups: [
      {
        id: createOpaqueId("pop"),
        name: "Village Woodcutters",
        count: 15,
        precision: "estimated",
        includedInTotal: true,
        visibility: "public",
        workforceContributions: [{ workforceTypeId: "laborers", amount: 15 }],
        tags: []
      }
    ],
    notables: [],
    roles: [],
    operationalGroups: [],
    assignments: [],
    reservations: []
  };

  const villageDocRes = await repo.create({
    name: "Forest Village",
    record: createDomainRecord("Forest Village", county.uuid, villagePeople)
  });
  assert.equal(villageDocRes.ok, true);
  const village = villageDocRes.value;

  // 4. Perform hierarchical aggregation
  const aggService = new PeopleAggregationService(repo);
  const result = aggService.queryPeopleAggregate(duchy.uuid);
  assert.equal(result.ok, true);
  const agg = result.value;

  // Assert population rollup
  assert.equal(agg.totalPopulation, 1450, "Total population must sum 1000 + 300 + 150 = 1450");
  assert.equal(agg.ownPopulation, 1000, "Own population is 1000");
  assert.equal(agg.descendantPopulation, 450, "Descendant population is 450");

  // Assert precision propagation (Village has estimated -> aggregate precision becomes estimated)
  assert.equal(agg.precision, "estimated", "Estimated child precision must propagate to aggregate");
  assert.equal(agg.completeness, "complete");

  // Assert workforce rollup
  assert.equal(agg.workforceSummary.ownCapacity["laborers"], 50);
  assert.equal(agg.workforceSummary.descendantCapacity["laborers"], 35); // 20 (County) + 15 (Village)
  assert.equal(agg.workforceSummary.descendantCapacity["military"], 10); // 10 (County Guard)
  assert.equal(agg.workforceSummary.totalCapacity["laborers"], 85);
  assert.equal(agg.workforceSummary.totalCapacity["military"], 10);

  // Assert domain breakdown entries
  assert.equal(agg.domainBreakdown.length, 3);
  assert.equal(agg.cycleDetected, false);
});
