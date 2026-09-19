import test from "node:test";
import assert from "node:assert/strict";
import {
  type FacilityDefinition,
  type FacilityInstance,
  type FacilityCondition,
  CONDITION_MAINTENANCE_DUE,
  CONDITION_DAMAGED,
  calculateFacilityEffectiveCapabilities
} from "../../src/facilities/types/facility-types.js";
import {
  advanceFacilityMaintenanceTicks,
  evaluateFacilityMaintenancePlan,
  commitFacilityMaintenance,
  evaluateBatchFacilityMaintenancePlan,
  commitBatchFacilityMaintenance
} from "../../src/facilities/plans/facility-maintenance-plan-service.js";
import {
  applyFacilityDamage,
  evaluateFacilityRepairPlan,
  commitFacilityRepair,
  CANONICAL_MAINTENANCE_PROJECT_ID
} from "../../src/facilities/plans/facility-repair-plan-service.js";

function createTestDefinition(overrides: Partial<FacilityDefinition> = {}): FacilityDefinition {
  return {
    id: "domain-manager:test-workshop",
    version: 1,
    label: "Settlement Workshop",
    category: "production",
    tags: ["crafting", "tools"],
    capabilitiesGranted: ["domain-manager:forge", "domain-manager:workshop"],
    defaultReadiness: "ready",
    maintenance: {
      intervalTicks: 10,
      costs: [{ resourceId: "domain-manager:supplies", amount: 5 }],
      overduePolicy: "apply_condition"
    },
    ...overrides
  };
}

function createTestInstance(overrides: Partial<FacilityInstance> = {}): FacilityInstance {
  return {
    id: "fac-inst-test-1",
    domainUuid: "dom-test-1",
    definitionId: "domain-manager:test-workshop",
    name: "North Workshop",
    schemaVersion: 1,
    revision: 1,
    lifecycle: "operational",
    readiness: "ready",
    level: 1,
    installedModules: [
      {
        id: "mod-1",
        slotId: "slot-1",
        definitionId: "domain-manager:tool-rack",
        name: "Tool Rack",
        active: true,
        installedAt: 1000
      }
    ],
    activeUpgrades: [],
    integrity: { current: 100, max: 100 },
    conditions: [],
    history: [],
    maintenanceState: {
      status: "current",
      accumulatedTicks: 0,
      overdueTicks: 0
    },
    tags: ["workshop"],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides
  };
}

test("G5.7: advanceFacilityMaintenanceTicks tracks abstract ticks and accumulates overdue ticks without system clock", () => {
  const def = createTestDefinition();
  let instance = createTestInstance();

  // 1. Advance 5 ticks (below interval 10)
  const adv1 = advanceFacilityMaintenanceTicks({
    facility: instance,
    definition: def,
    deltaTicks: 5,
    currentTick: 5
  });
  assert.equal(adv1.ok, true);
  if (adv1.ok) {
    instance = adv1.value;
    assert.equal(instance.maintenanceState?.status, "current");
    assert.equal(instance.maintenanceState?.accumulatedTicks, 5);
    assert.equal(instance.maintenanceState?.overdueTicks, 0);
  }

  // 2. Advance 5 more ticks (total 10 = exactly interval)
  const adv2 = advanceFacilityMaintenanceTicks({
    facility: instance,
    definition: def,
    deltaTicks: 5,
    currentTick: 10
  });
  assert.equal(adv2.ok, true);
  if (adv2.ok) {
    instance = adv2.value;
    assert.equal(instance.maintenanceState?.status, "due");
    assert.equal(instance.maintenanceState?.accumulatedTicks, 10);
    assert.equal(instance.maintenanceState?.overdueTicks, 0);
    // Since overdueTicks == 0 and policy is apply_condition, condition is applied
    assert.equal(instance.conditions?.some((c) => c.type === CONDITION_MAINTENANCE_DUE), true);
  }

  // 3. Advance 4 more ticks (total 14, overdue by 4)
  const adv3 = advanceFacilityMaintenanceTicks({
    facility: instance,
    definition: def,
    deltaTicks: 4,
    currentTick: 14
  });
  assert.equal(adv3.ok, true);
  if (adv3.ok) {
    instance = adv3.value;
    assert.equal(instance.maintenanceState?.status, "overdue");
    assert.equal(instance.maintenanceState?.accumulatedTicks, 14);
    assert.equal(instance.maintenanceState?.overdueTicks, 4);
  }
});

test("G5.7: advanceFacilityMaintenanceTicks applies overdue policies (degrade_readiness and degrade_integrity)", () => {
  // Test degrade_readiness policy
  const defReadiness = createTestDefinition({
    maintenance: {
      intervalTicks: 5,
      overduePolicy: "degrade_readiness"
    }
  });
  const inst1 = createTestInstance();
  const advRes = advanceFacilityMaintenanceTicks({
    facility: inst1,
    definition: defReadiness,
    deltaTicks: 6
  });
  assert.equal(advRes.ok, true);
  if (advRes.ok) {
    assert.equal(advRes.value.readiness, "limited");
    assert.equal(advRes.value.readinessReason, "Maintenance overdue");
  }

  // Test degrade_integrity policy
  const defIntegrity = createTestDefinition({
    maintenance: {
      intervalTicks: 5,
      overduePolicy: "degrade_integrity"
    }
  });
  const inst2 = createTestInstance();
  const advIntegRes = advanceFacilityMaintenanceTicks({
    facility: inst2,
    definition: defIntegrity,
    deltaTicks: 10 // 5 overdue
  });
  assert.equal(advIntegRes.ok, true);
  if (advIntegRes.ok) {
    assert.equal(advIntegRes.value.integrity?.current, 99);
    assert.equal(advIntegRes.value.history?.some((h) => h.entryType === "damaged"), true);
  }
});

test("G5.7: advanceFacilityMaintenanceTicks handles condition duration countdown and automatic expiration", () => {
  const def = createTestDefinition();
  const tempCondition: FacilityCondition = {
    id: "cond-smoke",
    type: "domain-manager:smoke-filled",
    label: "Smoke Filled",
    severity: "minor",
    durationTicks: 5
  };
  let instance = createTestInstance({
    conditions: [tempCondition]
  });

  // Advance 3 ticks: duration remains 2
  const adv1 = advanceFacilityMaintenanceTicks({
    facility: instance,
    definition: def,
    deltaTicks: 3
  });
  assert.equal(adv1.ok, true);
  if (adv1.ok) {
    instance = adv1.value;
    assert.equal(instance.conditions?.length, 1);
    assert.equal(instance.conditions?.[0].durationTicks, 2);
  }

  // Advance 2 more ticks: condition expires and clears
  const adv2 = advanceFacilityMaintenanceTicks({
    facility: instance,
    definition: def,
    deltaTicks: 2
  });
  assert.equal(adv2.ok, true);
  if (adv2.ok) {
    instance = adv2.value;
    assert.equal(instance.conditions?.length, 0);
    const clearedEntry = instance.history?.find((h) => h.entryType === "condition_cleared");
    assert.ok(clearedEntry);
    assert.equal(clearedEntry.conditionId, "cond-smoke");
  }
});

test("G5.7: calculateFacilityEffectiveCapabilities respects condition capability suppression and readiness penalties", () => {
  const def = createTestDefinition();
  const baseInst = createTestInstance();

  // Baseline: both capabilities available
  const baseCaps = calculateFacilityEffectiveCapabilities(baseInst, def);
  assert.deepEqual([...baseCaps].sort(), ["domain-manager:forge", "domain-manager:workshop"].sort());

  // Suppress "domain-manager:forge" via condition
  const suppressedInst = createTestInstance({
    conditions: [
      {
        id: "cond-forge-broken",
        type: "domain-manager:forge-failure",
        label: "Forge Inoperable",
        severity: "moderate",
        suppressedCapabilities: ["domain-manager:forge"]
      }
    ]
  });
  const filteredCaps = calculateFacilityEffectiveCapabilities(suppressedInst, def);
  assert.deepEqual(filteredCaps, ["domain-manager:workshop"]);

  // Condition with blocked readiness penalty
  const blockedInst = createTestInstance({
    conditions: [
      {
        id: "cond-critical-hazard",
        type: "domain-manager:collapse-hazard",
        label: "Collapse Hazard",
        severity: "critical",
        readinessPenalty: "blocked"
      }
    ]
  });
  const zeroCaps = calculateFacilityEffectiveCapabilities(blockedInst, def);
  assert.equal(zeroCaps.length, 0);
});

test("G5.7: evaluateFacilityMaintenancePlan and commitFacilityMaintenance execute plan -> commit cycle", () => {
  const def = createTestDefinition();
  const overdueInst = createTestInstance({
    readiness: "limited",
    readinessReason: "Maintenance overdue",
    conditions: [
      {
        id: "cond-maint-due",
        type: CONDITION_MAINTENANCE_DUE,
        label: "Maintenance Due",
        severity: "moderate"
      }
    ],
    maintenanceState: {
      status: "overdue",
      accumulatedTicks: 25,
      overdueTicks: 15
    }
  });

  // Evaluate plan with sufficient balances
  const plan = evaluateFacilityMaintenancePlan({
    facility: overdueInst,
    definition: def,
    availableBalances: { "domain-manager:supplies": 50 }
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.canAfford, true);
  assert.deepEqual(plan.resourceCosts, [{ resourceId: "domain-manager:supplies", amount: 5 }]);
  assert.deepEqual(plan.conditionsToClear, ["cond-maint-due"]);
  assert.equal(plan.readinessRestoration, "ready");

  // Commit maintenance
  const commitRes = commitFacilityMaintenance({
    plan,
    facility: overdueInst,
    currentTick: 30,
    note: "Completed routine service"
  });

  assert.equal(commitRes.ok, true);
  if (commitRes.ok) {
    const { updatedFacility, receipt } = commitRes.value;
    assert.equal(updatedFacility.maintenanceState?.status, "current");
    assert.equal(updatedFacility.maintenanceState?.accumulatedTicks, 0);
    assert.equal(updatedFacility.maintenanceState?.overdueTicks, 0);
    assert.equal(updatedFacility.readiness, "ready");
    assert.equal(updatedFacility.conditions?.length, 0);
    assert.equal(receipt.newStatus, "current");
    assert.deepEqual(receipt.resourcesConsumed, [{ resourceId: "domain-manager:supplies", amount: 5 }]);

    // History contains condition_cleared and maintained
    assert.ok(updatedFacility.history?.some((h) => h.entryType === "condition_cleared"));
    assert.ok(updatedFacility.history?.some((h) => h.entryType === "maintained"));
  }
});

test("G5.7: evaluateFacilityMaintenancePlan enforces resource availability and rejects destroyed facilities", () => {
  const def = createTestDefinition();
  const normalInst = createTestInstance();

  // Insufficient resources
  const planShort = evaluateFacilityMaintenancePlan({
    facility: normalInst,
    definition: def,
    availableBalances: { "domain-manager:supplies": 2 } // requires 5
  });
  assert.equal(planShort.valid, false);
  assert.equal(planShort.canAfford, false);
  assert.ok(planShort.errors?.some((e) => e.code === "DM_FACILITY_INSUFFICIENT_RESOURCES"));

  // Destroyed facility
  const destroyedInst = createTestInstance({ lifecycle: "destroyed" });
  const planDestroyed = evaluateFacilityMaintenancePlan({
    facility: destroyedInst,
    definition: def
  });
  assert.equal(planDestroyed.valid, false);
  assert.ok(planDestroyed.errors?.some((e) => e.code === "DM_FACILITY_NOT_MAINTAINABLE"));
});

test("G5.7: evaluateBatchFacilityMaintenancePlan aggregates costs and previews multi-facility maintenance", () => {
  const def = createTestDefinition();
  const inst1 = createTestInstance({ id: "fac-1" });
  const inst2 = createTestInstance({ id: "fac-2" });
  const inst3 = createTestInstance({ id: "fac-3" });

  const batchPlan = evaluateBatchFacilityMaintenancePlan({
    items: [
      { facility: inst1, definition: def },
      { facility: inst2, definition: def },
      { facility: inst3, definition: def }
    ],
    totalAvailableBalances: { "domain-manager:supplies": 20 } // requires 3 * 5 = 15
  });

  assert.equal(batchPlan.eligibleFacilityCount, 3);
  assert.equal(batchPlan.ineligibleFacilityCount, 0);
  assert.equal(batchPlan.allValid, true);
  assert.deepEqual(batchPlan.aggregatedCosts, [{ resourceId: "domain-manager:supplies", amount: 15 }]);

  // Commit batch
  const batchCommit = commitBatchFacilityMaintenance({
    batchPlan,
    facilities: [inst1, inst2, inst3],
    currentTick: 100
  });

  assert.equal(batchCommit.ok, true);
  if (batchCommit.ok) {
    assert.equal(batchCommit.value.updatedFacilities.length, 3);
    assert.equal(batchCommit.value.receipts.length, 3);
  }
});

test("G5.7: applyFacilityDamage preserves ownership and modules while updating integrity and lifecycle", () => {
  const baseInst = createTestInstance({
    domainUuid: "dom-sacred-vault",
    integrity: { current: 100, max: 100 }
  });

  // Apply moderate damage (60)
  const damRes1 = applyFacilityDamage({
    facility: baseInst,
    deltaIntegrity: 60,
    condition: {
      id: "cond-dam-1",
      type: CONDITION_DAMAGED,
      label: "Damaged Roof",
      severity: "moderate"
    }
  });

  assert.equal(damRes1.ok, true);
  if (damRes1.ok) {
    const inst1 = damRes1.value;
    assert.equal(inst1.integrity?.current, 40);
    assert.equal(inst1.readiness, "limited");
    // Ownership and modules preserved strictly (Master Spec §16)
    assert.equal(inst1.domainUuid, "dom-sacred-vault");
    assert.equal(inst1.installedModules.length, 1);
    assert.equal(inst1.installedModules[0].name, "Tool Rack");

    // Apply remaining 40 damage: total integrity depleted
    const damRes2 = applyFacilityDamage({
      facility: inst1,
      deltaIntegrity: 40,
      note: "Total structural collapse"
    });

    assert.equal(damRes2.ok, true);
    if (damRes2.ok) {
      const inst2 = damRes2.value;
      assert.equal(inst2.integrity?.current, 0);
      assert.equal(inst2.lifecycle, "degraded");
      assert.equal(inst2.readiness, "limited");
      assert.equal(inst2.domainUuid, "dom-sacred-vault");
      assert.equal(inst2.installedModules.length, 1);

      // Verify damage history entries
      const damageHistory = inst2.history?.filter((h) => h.entryType === "damaged");
      assert.equal(damageHistory?.length, 2);
    }
  }
});

test("G5.7: evaluateFacilityRepairPlan permits small direct repair and restores facility to operational", () => {
  const def = createTestDefinition();
  const damagedInst = createTestInstance({
    lifecycle: "degraded",
    readiness: "limited",
    integrity: { current: 75, max: 100 }, // 25 missing <= 50% threshold
    conditions: [
      {
        id: "cond-dam-small",
        type: CONDITION_DAMAGED,
        label: "Cracked Wall",
        severity: "minor"
      }
    ]
  });

  const plan = evaluateFacilityRepairPlan({
    facility: damagedInst,
    definition: def,
    availableBalances: { "domain-manager:materials": 100 }
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.isDirectRepairAllowed, true);
  assert.equal(plan.requiresProject, false);
  assert.equal(plan.repairedIntegrityDelta, 25);
  assert.equal(plan.targetIntegrity, 100);
  assert.deepEqual(plan.resourceCosts, [{ resourceId: "domain-manager:materials", amount: 25 }]);

  const commitRes = commitFacilityRepair({
    plan,
    facility: damagedInst,
    note: "Repaired cracked wall"
  });

  assert.equal(commitRes.ok, true);
  if (commitRes.ok) {
    const { updatedFacility, receipt } = commitRes.value;
    assert.equal(updatedFacility.integrity?.current, 100);
    assert.equal(updatedFacility.lifecycle, "operational");
    assert.equal(updatedFacility.readiness, "ready");
    assert.equal(updatedFacility.conditions?.length, 0);
    assert.equal(receipt.integrityRestored, 25);
    assert.ok(updatedFacility.history?.some((h) => h.entryType === "repaired"));
  }
});

test("G5.7: evaluateFacilityRepairPlan enforces Project requirement for significant damage or critical conditions", () => {
  const def = createTestDefinition();

  // 1. Significant damage (80% missing > 50% direct repair threshold)
  const heavyDamagedInst = createTestInstance({
    lifecycle: "degraded",
    readiness: "limited",
    integrity: { current: 20, max: 100 }
  });

  const planHeavy = evaluateFacilityRepairPlan({
    facility: heavyDamagedInst,
    definition: def
  });

  assert.equal(planHeavy.isDirectRepairAllowed, false);
  assert.equal(planHeavy.requiresProject, true);
  assert.equal(planHeavy.suggestedProjectId, CANONICAL_MAINTENANCE_PROJECT_ID);

  // Attempting to commit direct repair must fail
  const commitHeavy = commitFacilityRepair({
    plan: planHeavy,
    facility: heavyDamagedInst
  });
  assert.equal(commitHeavy.ok, false);
  if (!commitHeavy.ok) {
    assert.equal(commitHeavy.error.code, "DM_FACILITY_REPAIR_REQUIRES_PROJECT");
  }

  // 2. Critical condition requires project even if integrity damage is small
  const criticalConditionInst = createTestInstance({
    integrity: { current: 90, max: 100 },
    conditions: [
      {
        id: "cond-crit",
        type: "domain-manager:foundation-fracture",
        label: "Foundation Fracture",
        severity: "critical"
      }
    ]
  });

  const planCritical = evaluateFacilityRepairPlan({
    facility: criticalConditionInst,
    definition: def
  });
  assert.equal(planCritical.isDirectRepairAllowed, false);
  assert.equal(planCritical.requiresProject, true);
});

test("G5.7: Destroyed facility strictly requires Project reconstruction and rejects direct repair", () => {
  const def = createTestDefinition();
  const destroyedInst = createTestInstance({
    lifecycle: "destroyed",
    readiness: "unavailable",
    integrity: { current: 0, max: 100 }
  });

  const planDestroyed = evaluateFacilityRepairPlan({
    facility: destroyedInst,
    definition: def
  });

  assert.equal(planDestroyed.valid, false);
  assert.equal(planDestroyed.isDirectRepairAllowed, false);
  assert.equal(planDestroyed.requiresProject, true);
  assert.equal(planDestroyed.suggestedProjectId, CANONICAL_MAINTENANCE_PROJECT_ID);
  assert.ok(planDestroyed.errors?.some((e) => e.code === "DM_FACILITY_DESTROYED_REQUIRES_PROJECT"));
});
