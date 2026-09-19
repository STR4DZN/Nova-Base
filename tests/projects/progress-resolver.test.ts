import test from "node:test";
import assert from "node:assert/strict";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import {
  applyProjectEntry,
  type ProjectEntry,
  type ProjectInstance,
  validateProjectEntry
} from "../../src/projects/types/project-types.js";
import {
  type ProjectProgressContext
} from "../../src/projects/resolvers/progress-resolver-types.js";
import {
  STANDARD_PROGRESS_RESOLVER_ID,
  StandardProgressResolver
} from "../../src/projects/resolvers/standard-progress-resolver.js";
import {
  createDefaultProgressResolverRegistry,
  ProgressResolverRegistry
} from "../../src/projects/resolvers/progress-resolver-registry.js";
import { CANONICAL_PROJECT_DEFINITIONS } from "../../src/projects/definitions/canonical-project-definitions.js";

function createDummyProject(overrides?: Partial<ProjectInstance>): ProjectInstance {
  return {
    id: createOpaqueId("prj"),
    domainUuid: "JournalEntry.domain_alpha",
    definitionId: "domain-manager:basic-construction",
    name: "Watchtower",
    schemaVersion: 1,
    revision: 0,
    lifecycle: "active",
    workRequired: 100,
    workCompleted: 0,
    clampProgress: true,
    tags: [],
    createdAt: 1000,
    updatedAt: 1000,
    entries: [],
    ...overrides
  };
}

test("G5.2: ProjectEntry validation accepts valid entries", () => {
  const prj = createDummyProject();
  const entryId = createOpaqueId("prj");

  // Positive progress entry
  const entry: ProjectEntry = {
    id: entryId,
    projectId: prj.id,
    domainUuid: prj.domainUuid,
    sequence: 1,
    unitsDelta: 25,
    unitsBefore: 0,
    unitsAfter: 25,
    sourceKind: "assignment",
    reasonCode: "WORKFORCE_PROGRESS",
    contributor: {
      type: "notable",
      ref: "not_123",
      label: "Master Mason"
    },
    timestamp: 1500
  };

  const res = validateProjectEntry(entry);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.id, entryId);
    assert.equal(res.value.unitsDelta, 25);
    assert.equal(res.value.sourceKind, "assignment");
    assert.equal(res.value.contributor?.label, "Master Mason");
  }

  // Setback / negative delta entry (DEC-088)
  const setbackEntry = {
    ...entry,
    id: createOpaqueId("prj"),
    sequence: 2,
    unitsDelta: -10,
    unitsBefore: 25,
    unitsAfter: 15,
    sourceKind: "manual" as const,
    reasonCode: "STORM_DAMAGE"
  };
  const setbackRes = validateProjectEntry(setbackEntry);
  assert.equal(setbackRes.ok, true);
  if (setbackRes.ok) {
    assert.equal(setbackRes.value.unitsDelta, -10);
    assert.equal(setbackRes.value.reasonCode, "STORM_DAMAGE");
  }
});

test("G5.2: ProjectEntry validation rejects invalid fields and malformed payloads", () => {
  const base = {
    id: "prj_test",
    projectId: "prj_main",
    domainUuid: "dom_1",
    sequence: 1,
    unitsDelta: 10,
    unitsBefore: 0,
    unitsAfter: 10,
    sourceKind: "manual",
    reasonCode: "TEST"
  };

  // Missing id
  assert.equal(validateProjectEntry({ ...base, id: "" }).ok, false);

  // Missing projectId
  assert.equal(validateProjectEntry({ ...base, projectId: "" }).ok, false);

  // Missing domainUuid
  assert.equal(validateProjectEntry({ ...base, domainUuid: "" }).ok, false);

  // Invalid sequence (< 1 or float)
  assert.equal(validateProjectEntry({ ...base, sequence: 0 }).ok, false);
  assert.equal(validateProjectEntry({ ...base, sequence: 1.5 }).ok, false);

  // Non-safe integer unitsDelta
  assert.equal(validateProjectEntry({ ...base, unitsDelta: NaN }).ok, false);
  assert.equal(validateProjectEntry({ ...base, unitsDelta: 5.5 }).ok, false);

  // Negative unitsBefore
  assert.equal(validateProjectEntry({ ...base, unitsBefore: -1 }).ok, false);

  // Negative unitsAfter
  assert.equal(validateProjectEntry({ ...base, unitsAfter: -1 }).ok, false);

  // Invalid sourceKind
  assert.equal(validateProjectEntry({ ...base, sourceKind: "invalid_source" }).ok, false);

  // Empty reasonCode
  assert.equal(validateProjectEntry({ ...base, reasonCode: "   " }).ok, false);

  // Invalid contributor
  assert.equal(
    validateProjectEntry({
      ...base,
      contributor: { type: "unknown_type", ref: "123" }
    }).ok,
    false
  );
});

test("G5.2: applyProjectEntry executes pure state transition and appends entry", () => {
  const prj = createDummyProject({ workRequired: 100, workCompleted: 0 });
  const entryId = createOpaqueId("prj");

  const entry: ProjectEntry = {
    id: entryId,
    projectId: prj.id,
    domainUuid: prj.domainUuid,
    sequence: 1,
    unitsDelta: 40,
    unitsBefore: 0,
    unitsAfter: 40,
    sourceKind: "assignment",
    reasonCode: "STANDARD_PROGRESS",
    timestamp: 2000
  };

  const applyRes = applyProjectEntry(prj, entry);
  assert.equal(applyRes.ok, true);
  if (applyRes.ok) {
    const updated = applyRes.value;
    assert.equal(updated.workCompleted, 40);
    assert.equal(updated.revision, 1);
    assert.equal(updated.entries?.length, 1);
    assert.equal(updated.entries?.[0].id, entryId);
    assert.equal(updated.updatedAt, 2000);

    // Verify input prj was not mutated
    assert.equal(prj.workCompleted, 0);
    assert.equal(prj.revision, 0);
    assert.equal(prj.entries?.length, 0);
  }
});

test("G5.2: applyProjectEntry enforces clamping at goal by default (DEC-090)", () => {
  // Clamp enabled (default)
  const prjClamped = createDummyProject({ workRequired: 100, workCompleted: 80, clampProgress: true });
  const entryClamped: ProjectEntry = {
    id: createOpaqueId("prj"),
    projectId: prjClamped.id,
    domainUuid: prjClamped.domainUuid,
    sequence: 1,
    unitsDelta: 50, // 80 + 50 = 130 -> clamped to 100
    unitsBefore: 80,
    unitsAfter: 100,
    sourceKind: "command",
    reasonCode: "RUSH_WORK",
    timestamp: 2000
  };

  const resClamped = applyProjectEntry(prjClamped, entryClamped);
  assert.equal(resClamped.ok, true);
  if (resClamped.ok) {
    assert.equal(resClamped.value.workCompleted, 100);
  }

  // Clamp disabled
  const prjUnclamped = createDummyProject({ workRequired: 100, workCompleted: 80, clampProgress: false });
  const entryUnclamped: ProjectEntry = {
    id: createOpaqueId("prj"),
    projectId: prjUnclamped.id,
    domainUuid: prjUnclamped.domainUuid,
    sequence: 1,
    unitsDelta: 50, // 80 + 50 = 130 -> allowed
    unitsBefore: 80,
    unitsAfter: 130,
    sourceKind: "command",
    reasonCode: "RUSH_WORK",
    timestamp: 2000
  };

  const resUnclamped = applyProjectEntry(prjUnclamped, entryUnclamped);
  assert.equal(resUnclamped.ok, true);
  if (resUnclamped.ok) {
    assert.equal(resUnclamped.value.workCompleted, 130);
  }
});

test("G5.2: applyProjectEntry detects stale state, out-of-order sequences, and mismatched IDs", () => {
  const prj = createDummyProject({ workCompleted: 30 });

  // Stale unitsBefore (entry declares unitsBefore = 0, but current is 30)
  const staleEntry: ProjectEntry = {
    id: createOpaqueId("prj"),
    projectId: prj.id,
    domainUuid: prj.domainUuid,
    sequence: 1,
    unitsDelta: 10,
    unitsBefore: 0,
    unitsAfter: 10,
    sourceKind: "manual",
    reasonCode: "ADVANCE",
    timestamp: 2000
  };
  const staleRes = applyProjectEntry(prj, staleEntry);
  assert.equal(staleRes.ok, false);
  if (!staleRes.ok) {
    assert.equal(staleRes.error.code, "DM_PROJECT_ENTRY_STALE");
  }

  // Out of order sequence (expected 1, got 5)
  const sequenceEntry: ProjectEntry = {
    ...staleEntry,
    unitsBefore: 30,
    unitsAfter: 40,
    sequence: 5
  };
  const seqRes = applyProjectEntry(prj, sequenceEntry);
  assert.equal(seqRes.ok, false);
  if (!seqRes.ok) {
    assert.equal(seqRes.error.code, "DM_PROJECT_SEQUENCE_INVALID");
  }

  // Mismatched project ID
  const mismatchEntry: ProjectEntry = {
    ...sequenceEntry,
    projectId: "prj_other",
    sequence: 1
  };
  const misRes = applyProjectEntry(prj, mismatchEntry);
  assert.equal(misRes.ok, false);
  if (!misRes.ok) {
    assert.equal(misRes.error.code, "DM_PROJECT_MISMATCH");
  }
});

test("G5.2: Reversal logic prevents double reversals and invalid deltas (DEC-088, Anexo 07 §2.3)", () => {
  let prj = createDummyProject({ workRequired: 100, workCompleted: 0 });

  // 1. Initial entry: +30
  const entry1Id = createOpaqueId("prj");
  const entry1: ProjectEntry = {
    id: entry1Id,
    projectId: prj.id,
    domainUuid: prj.domainUuid,
    sequence: 1,
    unitsDelta: 30,
    unitsBefore: 0,
    unitsAfter: 30,
    sourceKind: "assignment",
    reasonCode: "PROGRESS",
    timestamp: 1000
  };
  const res1 = applyProjectEntry(prj, entry1);
  assert.equal(res1.ok, true);
  prj = res1.value;
  assert.equal(prj.workCompleted, 30);

  // 2. Reversal entry: reverses entry1 with -30
  const revEntryId = createOpaqueId("prj");
  const revEntry: ProjectEntry = {
    id: revEntryId,
    projectId: prj.id,
    domainUuid: prj.domainUuid,
    sequence: 2,
    unitsDelta: -30,
    unitsBefore: 30,
    unitsAfter: 0,
    sourceKind: "manual",
    reasonCode: "CORRECTION_REVERSAL",
    reversesEntryId: entry1Id,
    timestamp: 1500
  };
  const res2 = applyProjectEntry(prj, revEntry);
  assert.equal(res2.ok, true);
  prj = res2.value;
  assert.equal(prj.workCompleted, 0);
  assert.equal(prj.entries?.length, 2);

  // 3. Attempting double reversal of entry1 fails
  const doubleRevEntry: ProjectEntry = {
    id: createOpaqueId("prj"),
    projectId: prj.id,
    domainUuid: prj.domainUuid,
    sequence: 3,
    unitsDelta: -30,
    unitsBefore: 0,
    unitsAfter: 0,
    sourceKind: "manual",
    reasonCode: "DOUBLE_REVERSAL",
    reversesEntryId: entry1Id,
    timestamp: 2000
  };
  const doubleRes = applyProjectEntry(prj, doubleRevEntry);
  assert.equal(doubleRes.ok, false);
  if (!doubleRes.ok) {
    assert.equal(doubleRes.error.code, "DM_PROJECT_REVERSAL_ALREADY_EXISTS");
  }

  // 4. Attempting to reverse a reversal fails
  const reverseReversalEntry: ProjectEntry = {
    id: createOpaqueId("prj"),
    projectId: prj.id,
    domainUuid: prj.domainUuid,
    sequence: 3,
    unitsDelta: 30,
    unitsBefore: 0,
    unitsAfter: 30,
    sourceKind: "manual",
    reasonCode: "REVERSE_REVERSAL",
    reversesEntryId: revEntryId,
    timestamp: 2000
  };
  const revRevRes = applyProjectEntry(prj, reverseReversalEntry);
  assert.equal(revRevRes.ok, false);
  if (!revRevRes.ok) {
    assert.equal(revRevRes.error.code, "DM_PROJECT_CANNOT_REVERSE_REVERSAL");
  }

  // 5. Reversing non-existent entry fails
  const nonExistentRevEntry: ProjectEntry = {
    id: createOpaqueId("prj"),
    projectId: prj.id,
    domainUuid: prj.domainUuid,
    sequence: 3,
    unitsDelta: -10,
    unitsBefore: 0,
    unitsAfter: 0,
    sourceKind: "manual",
    reasonCode: "BAD_REVERSAL",
    reversesEntryId: "prj_nonexistent",
    timestamp: 2000
  };
  const nonExistentRes = applyProjectEntry(prj, nonExistentRevEntry);
  assert.equal(nonExistentRes.ok, false);
  if (!nonExistentRes.ok) {
    assert.equal(nonExistentRes.error.code, "DM_PROJECT_ENTRY_NOT_FOUND");
  }
});

test("G5.2: StandardProgressResolver resolves pure progress without mutating project", () => {
  const resolver = new StandardProgressResolver();
  assert.equal(resolver.id, STANDARD_PROGRESS_RESOLVER_ID);

  const prj = createDummyProject({ workRequired: 200, workCompleted: 50 });
  const definition = CANONICAL_PROJECT_DEFINITIONS[0];

  // 1. Explicit requestedUnits
  const ctxExplicit: ProjectProgressContext = {
    project: prj,
    definition,
    domainUuid: prj.domainUuid,
    requestedUnits: 25,
    sourceKind: "manual"
  };

  const resExplicit = resolver.resolve(ctxExplicit);
  assert.equal(resExplicit.ok, true);
  if (resExplicit.ok) {
    assert.equal(resExplicit.value.deltaWork, 25);
    assert.equal(resExplicit.value.reasonCode, "STANDARD_PROGRESS");
    assert.ok(resExplicit.value.reasons.length > 0);
  }

  // Verify purity: prj must not be mutated
  assert.equal(prj.workCompleted, 50);

  // 2. Efficiency modifier in parameters
  const ctxEfficiency: ProjectProgressContext = {
    project: prj,
    definition,
    domainUuid: prj.domainUuid,
    requestedUnits: 20,
    sourceKind: "assignment",
    parameters: {
      efficiency: 1.5 // 20 * 1.5 = 30
    }
  };
  const resEff = resolver.resolve(ctxEfficiency);
  assert.equal(resEff.ok, true);
  if (resEff.ok) {
    assert.equal(resEff.value.deltaWork, 30);
    assert.equal(resEff.value.breakdown?.length, 2);
  }

  // 3. Setback (negative requestedUnits)
  const ctxSetback: ProjectProgressContext = {
    project: prj,
    definition,
    domainUuid: prj.domainUuid,
    requestedUnits: -15,
    sourceKind: "command"
  };
  const resSetback = resolver.resolve(ctxSetback);
  assert.equal(resSetback.ok, true);
  if (resSetback.ok) {
    assert.equal(resSetback.value.deltaWork, -15);
    assert.equal(resSetback.value.reasonCode, "PROGRESS_SETBACK");
  }

  // 4. Invalid requestedUnits (float)
  const ctxInvalid: ProjectProgressContext = {
    project: prj,
    definition,
    domainUuid: prj.domainUuid,
    requestedUnits: 12.34,
    sourceKind: "manual"
  };
  const resInvalid = resolver.resolve(ctxInvalid);
  assert.equal(resInvalid.ok, false);
  if (!resInvalid.ok) {
    assert.equal(resInvalid.error.code, "DM_PROJECT_PROGRESS_INVALID_UNITS");
  }
});

test("G5.2: ProgressResolverRegistry registers, catalogs, and freezes resolvers", () => {
  const registry = new ProgressResolverRegistry();
  assert.equal(registry.isFrozen, false);

  const customResolver = {
    id: "domain-manager:dice-roll",
    label: "Dice Roll Resolver",
    resolve: () => ({
      ok: true as const,
      value: { deltaWork: 10, reasonCode: "DICE_SUCCESS", reasons: [], warnings: [] }
    })
  };

  // Register
  const regRes = registry.register(customResolver);
  assert.equal(regRes.ok, true);
  assert.equal(registry.has("domain-manager:dice-roll"), true);
  assert.equal(registry.get("domain-manager:dice-roll")?.label, "Dice Roll Resolver");

  // Duplicate rejected
  const dupRes = registry.register(customResolver);
  assert.equal(dupRes.ok, false);
  if (!dupRes.ok) {
    assert.equal(dupRes.error.code, "DM_PROJECT_RESOLVER_ALREADY_EXISTS");
  }

  // Non-namespaced rejected
  const badIdRes = registry.register({
    ...customResolver,
    id: "simple_name"
  });
  assert.equal(badIdRes.ok, false);

  // List
  assert.equal(registry.list().length, 1);

  // Unregister
  assert.equal(registry.unregister("domain-manager:dice-roll"), true);
  assert.equal(registry.has("domain-manager:dice-roll"), false);

  // Freeze
  registry.freeze();
  assert.equal(registry.isFrozen, true);
  const postFreeze = registry.register(customResolver);
  assert.equal(postFreeze.ok, false);
  if (!postFreeze.ok) {
    assert.equal(postFreeze.error.code, "DM_PROJECT_REGISTRY_FROZEN");
  }

  // Default factory provides domain-manager:standard
  const defaultRegistry = createDefaultProgressResolverRegistry();
  assert.equal(defaultRegistry.has(STANDARD_PROGRESS_RESOLVER_ID), true);
  assert.equal(defaultRegistry.get(STANDARD_PROGRESS_RESOLVER_ID)?.label, "Standard Progress Resolver");
});
