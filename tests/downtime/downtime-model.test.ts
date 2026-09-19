import test from "node:test";
import assert from "node:assert/strict";
import {
  type DowntimeDefinition,
  type DowntimeInstance,
  type DowntimeParticipant,
  validateDowntimeDefinition,
  validateDowntimeInstance,
  validateDowntimeParticipant,
  validateDowntimeLifecycleTransition,
  isDowntimeComplete,
  DOWNTIME_LIFECYCLE_STATES,
  DOWNTIME_SCOPES
} from "../../src/downtime/types/downtime-types.js";
import {
  DowntimeDefinitionRegistry,
  createDefaultDowntimeRegistry
} from "../../src/downtime/definitions/downtime-registry.js";
import { CANONICAL_DOWNTIME_DEFINITIONS } from "../../src/downtime/definitions/canonical-downtime-definitions.js";
import {
  DOWNTIME_CAPABILITY_ID,
  createDefaultDomainDowntimeData,
  validateDomainDowntimeData,
  tryGetDomainDowntimeData,
  getDomainDowntimeData,
  withDomainDowntimeData
} from "../../src/downtime/downtime-data.js";
import { domainCapabilityRegistry } from "../../src/domains/domain-capabilities.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";

function createTestDowntimeDefinition(overrides: Partial<DowntimeDefinition> = {}): DowntimeDefinition {
  return {
    id: "domain-manager:test-scouting",
    version: 1,
    label: "Perimeter Scouting",
    category: "security",
    tags: ["scouting", "recon"],
    scope: "individual",
    defaultDurationTicks: 6,
    minParticipants: 1,
    maxParticipants: 3,
    allowedParticipantRoles: ["supervisor", "scout"],
    outcomeDefinitions: [
      {
        id: "scout-report",
        type: "narrative:event",
        label: "Scout Report",
        parameters: { area: "northern-hills" }
      }
    ],
    ...overrides
  };
}

function createTestDowntimeInstance(overrides: Partial<DowntimeInstance> = {}): DowntimeInstance {
  const base: DowntimeInstance = {
    id: "dt-inst-1",
    domainUuid: "dom-test-1",
    definitionId: "domain-manager:test-scouting",
    name: "Northern Perimeter Scout",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "planned",
    scope: "individual",
    participants: [
      {
        participantRef: "notable-scout-1",
        participantType: "notable",
        role: "scout",
        name: "Chief Scout"
      }
    ],
    durationTicks: 6,
    elapsedTicks: 0,
    tags: ["recon"],
    createdAt: 1000,
    updatedAt: 1000
  };

  const candidate = { ...base, ...overrides };
  const valid = validateDowntimeInstance(candidate);
  if (!valid.ok) {
    throw new Error(`Invalid test fixture: ${valid.error.message}`);
  }
  return valid.value;
}

test("G5.8: validateDowntimeDefinition validates namespaced ID, schema, scope, tags, and participant bounds", () => {
  const def = createTestDowntimeDefinition();
  const valid = validateDowntimeDefinition(def);
  assert.equal(valid.ok, true);

  // Non-namespaced ID
  const invalidId = validateDowntimeDefinition({ ...def, id: "scouting_activity" });
  assert.equal(invalidId.ok, false);
  if (!invalidId.ok) {
    assert.equal(invalidId.error.code, "DM_DOWNTIME_INVALID_ID");
  }

  // Missing label
  const missingLabel = validateDowntimeDefinition({ ...def, label: "   " });
  assert.equal(missingLabel.ok, false);
  if (!missingLabel.ok) {
    assert.equal(missingLabel.error.code, "DM_DOWNTIME_DEFINITION_INVALID");
  }

  // Invalid scope
  const invalidScope = validateDowntimeDefinition({ ...def, scope: "galactic" });
  assert.equal(invalidScope.ok, false);
  if (!invalidScope.ok) {
    assert.equal(invalidScope.error.code, "DM_DOWNTIME_DEFINITION_INVALID");
  }

  // maxParticipants < minParticipants
  const invalidParticipants = validateDowntimeDefinition({
    ...def,
    minParticipants: 5,
    maxParticipants: 2
  });
  assert.equal(invalidParticipants.ok, false);
  if (!invalidParticipants.ok) {
    assert.equal(invalidParticipants.error.code, "DM_DOWNTIME_DEFINITION_INVALID");
  }
});

test("G5.8: validateDowntimeParticipant enforces participant structure and validates non-empty ref and role", () => {
  const validNotable: DowntimeParticipant = {
    participantRef: "notable-123",
    participantType: "notable",
    role: "owner",
    name: "Captain"
  };
  const v1 = validateDowntimeParticipant(validNotable);
  assert.equal(v1.ok, true);

  const validGroup: DowntimeParticipant = {
    participantRef: "group-infantry",
    participantType: "group",
    role: "participant",
    capacityConsumed: 10
  };
  const v2 = validateDowntimeParticipant(validGroup);
  assert.equal(v2.ok, true);

  // Rejects empty ref
  const invalidRef = validateDowntimeParticipant({ ...validNotable, participantRef: "   " });
  assert.equal(invalidRef.ok, false);

  // Rejects invalid type
  const invalidType = validateDowntimeParticipant({ ...validNotable, participantType: "foundry-user" });
  assert.equal(invalidType.ok, false);
});

test("G5.8: validateDowntimeInstance enforces valid lifecycle, revision, participants, and elapsed ticks", () => {
  const inst = createTestDowntimeInstance();
  assert.equal(inst.lifecycle, "planned");
  assert.equal(inst.scope, "individual");
  assert.equal(inst.participants.length, 1);

  // Rejects invalid lifecycle
  const invalidLifecycle = validateDowntimeInstance({ ...inst, lifecycle: "unknown_state" });
  assert.equal(invalidLifecycle.ok, false);
  if (!invalidLifecycle.ok) {
    assert.equal(invalidLifecycle.error.code, "DM_DOWNTIME_INVALID_LIFECYCLE");
  }

  // Rejects negative elapsedTicks
  const negativeTicks = validateDowntimeInstance({ ...inst, elapsedTicks: -5 });
  assert.equal(negativeTicks.ok, false);
  if (!negativeTicks.ok) {
    assert.equal(negativeTicks.error.code, "DM_DOWNTIME_INSTANCE_INVALID");
  }
});

test("G5.8: validateDowntimeLifecycleTransition enforces legal state transitions (DEC-2751 §4.2)", () => {
  // Legal paths
  assert.equal(validateDowntimeLifecycleTransition("draft", "planned").ok, true);
  assert.equal(validateDowntimeLifecycleTransition("planned", "ready").ok, true);
  assert.equal(validateDowntimeLifecycleTransition("ready", "inProgress").ok, true);
  assert.equal(validateDowntimeLifecycleTransition("inProgress", "paused").ok, true);
  assert.equal(validateDowntimeLifecycleTransition("paused", "inProgress").ok, true);
  assert.equal(validateDowntimeLifecycleTransition("inProgress", "completed").ok, true);
  assert.equal(validateDowntimeLifecycleTransition("inProgress", "cancelled").ok, true);

  // Illegal paths
  const compToActive = validateDowntimeLifecycleTransition("completed", "inProgress");
  assert.equal(compToActive.ok, false);
  if (!compToActive.ok) {
    assert.equal(compToActive.error.code, "DM_DOWNTIME_INVALID_LIFECYCLE_TRANSITION");
  }

  const draftToActive = validateDowntimeLifecycleTransition("draft", "inProgress");
  assert.equal(draftToActive.ok, false);
});

test("G5.8: isDowntimeComplete respects durationTicks and enforces indefinite downtime never auto-completes (Master Spec §17)", () => {
  // Finite duration
  const inst1 = createTestDowntimeInstance({ durationTicks: 10, elapsedTicks: 5 });
  assert.equal(isDowntimeComplete(inst1), false);

  const inst2 = createTestDowntimeInstance({ durationTicks: 10, elapsedTicks: 10 });
  assert.equal(isDowntimeComplete(inst2), true);

  // Indefinite duration: Rule: "indefinite downtime não auto-completa" (Master Spec §17)
  const indefiniteInst = createTestDowntimeInstance({ durationTicks: null, elapsedTicks: 9999 });
  assert.equal(isDowntimeComplete(indefiniteInst), false);

  // Completed lifecycle is always complete
  const completedInst = createTestDowntimeInstance({ lifecycle: "completed" });
  assert.equal(isDowntimeComplete(completedInst), true);
});

test("G5.8: DowntimeDefinitionRegistry registers, lists, filters, freezes, and loads canonical downtime activities", () => {
  const registry = new DowntimeDefinitionRegistry();
  const def = createTestDowntimeDefinition();

  const regRes = registry.register(def);
  assert.equal(regRes.ok, true);
  assert.equal(registry.has(def.id), true);
  assert.equal(registry.get(def.id)?.label, "Perimeter Scouting");

  // Rejects duplicate
  const dupRes = registry.register(def);
  assert.equal(dupRes.ok, false);
  if (!dupRes.ok) {
    assert.equal(dupRes.error.code, "DM_DOWNTIME_ALREADY_EXISTS");
  }

  // Filter
  const filtered = registry.list({ category: "security" });
  assert.equal(filtered.length, 1);
  assert.equal(registry.list({ category: "production" }).length, 0);

  // Freeze
  registry.freeze();
  assert.equal(registry.isFrozen, true);
  const postFreeze = registry.register(createTestDowntimeDefinition({ id: "domain-manager:another-scout" }));
  assert.equal(postFreeze.ok, false);
  if (!postFreeze.ok) {
    assert.equal(postFreeze.error.code, "DM_REGISTRY_FROZEN");
  }

  // Canonical registry
  const canonical = createDefaultDowntimeRegistry();
  assert.ok(canonical.has("domain-manager:crafting"));
  assert.ok(canonical.has("domain-manager:rest-and-recuperation"));
  assert.ok(canonical.has("domain-manager:patrol-and-recon"));
  assert.ok(canonical.has("domain-manager:training"));
  assert.equal(canonical.list().length, CANONICAL_DOWNTIME_DEFINITIONS.length);
});

test("G5.8: DomainDowntimeData persists, validates duplicate IDs, and integrates with DomainRecord", () => {
  const inst1 = createTestDowntimeInstance({ id: "dt-1" });
  const inst2 = createTestDowntimeInstance({ id: "dt-2" });

  const validData = validateDomainDowntimeData({
    schemaVersion: 1,
    activities: [inst1, inst2]
  });
  assert.equal(validData.ok, true);

  // Duplicate ID detection
  const duplicateData = validateDomainDowntimeData({
    schemaVersion: 1,
    activities: [inst1, { ...inst2, id: "dt-1" }]
  });
  assert.equal(duplicateData.ok, false);
  if (!duplicateData.ok) {
    assert.equal(duplicateData.error.code, "DM_DOWNTIME_DUPLICATE_ID");
  }

  // Integration with DomainRecord
  const mockDomain: DomainRecord = {
    id: "domain-test-1",
    documentUuid: "JournalEntry.mock123456",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "active",
    definition: {
      id: "dom-test",
      name: "Domain Test",
      schemaVersion: 1,
      capabilities: {
        enabled: [],
        config: {}
      }
    },
    lineage: {
      origin: "created",
      createdAt: 1000
    },
    createdAt: 1000,
    updatedAt: 1000
  };

  const withData = withDomainDowntimeData(mockDomain, validData.value!);
  assert.ok(withData.definition.capabilities.enabled.includes(DOWNTIME_CAPABILITY_ID));

  const retrievedRes = tryGetDomainDowntimeData(withData);
  assert.ok(retrievedRes.ok);
  const retrieved = retrievedRes.value;
  assert.ok(retrieved);
  assert.equal(retrieved.activities.length, 2);
  assert.equal(retrieved.activities[0].id, "dt-1");
  assert.equal(retrieved.activities[1].id, "dt-2");
});

test("G5-AUD-008: Corrupt downtime data produces PublicError and getDomainDowntimeData throws", () => {
  const corruptDomain = {
    schemaVersion: 1,
    revision: 1,
    id: "domain-corrupt-dt",
    definition: {
      identity: { name: "Corrupt Domain" },
      capabilities: {
        enabled: [DOWNTIME_CAPABILITY_ID],
        config: {
          [DOWNTIME_CAPABILITY_ID]: {
            schemaVersion: 99,
            activities: "invalid_list"
          }
        }
      }
    }
  } as unknown as DomainRecord;

  const tryRes = tryGetDomainDowntimeData(corruptDomain);
  assert.equal(tryRes.ok, false);
  if (!tryRes.ok) {
    assert.equal(tryRes.error.code, "DM_DOWNTIME_INVALID_SCHEMA_VERSION");
  }

  assert.throws(
    () => getDomainDowntimeData(corruptDomain),
    /Domain downtime data corruption/
  );
});

test("G5.8: CapabilityRegistry validates domain-manager:downtime configuration", () => {
  const def = domainCapabilityRegistry.get(DOWNTIME_CAPABILITY_ID);
  assert.ok(def);
  assert.equal(def.functional, true);

  const inst = createTestDowntimeInstance();
  const validConfig = {
    schemaVersion: 1,
    activities: [inst]
  };

  const validRes = def.validateConfig?.(validConfig);
  assert.ok(validRes?.ok);

  const invalidConfig = {
    schemaVersion: 1,
    activities: [{ ...inst, lifecycle: "invalid_state" }]
  };
  const invalidRes = def.validateConfig?.(invalidConfig);
  assert.equal(invalidRes?.ok, false);
});
