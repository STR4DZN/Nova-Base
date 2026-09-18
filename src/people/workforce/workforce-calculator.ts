import type { DomainPeopleData } from "../people-data.js";
import { isOpaqueId } from "../../core/identity/ids.js";
import {
  DEFAULT_WORKFORCE_TYPES,
  type WorkforceContributionProvenance,
  type WorkforceReport,
  type WorkforceType,
  type WorkforceTypeResolution
} from "./workforce-types.js";

export function resolveOperationalGroupWorkforceType(definitionId: string): string {
  switch (definitionId) {
    case "domain-manager:labor-squad":
      return "general";
    case "domain-manager:militia":
    case "domain-manager:scout-patrol":
      return "military";
    default:
      return "general";
  }
}

export interface WorkforceCalculationOptions {
  readonly nowReal?: number;
  readonly nowWorld?: number;
}

export function calculateWorkforce(
  people: DomainPeopleData,
  timeOrOptions?: number | WorkforceCalculationOptions,
  availableTypes: readonly WorkforceType[] = DEFAULT_WORKFORCE_TYPES
): WorkforceReport {
  const nowReal = typeof timeOrOptions === "number" ? timeOrOptions : (timeOrOptions?.nowReal ?? Date.now());
  const nowWorld = typeof timeOrOptions === "object" ? timeOrOptions?.nowWorld : undefined;

  const typeMap = new Map<string, {
    capacity: number;
    committed: number;
    reserved: number;
    contributions: WorkforceContributionProvenance[];
  }>();

  for (const t of availableTypes) {
    typeMap.set(t.id, {
      capacity: 0,
      committed: 0,
      reserved: 0,
      contributions: []
    });
  }

  function ensureType(typeId: string) {
    let entry = typeMap.get(typeId);
    if (!entry) {
      entry = {
        capacity: 0,
        committed: 0,
        reserved: 0,
        contributions: []
      };
      typeMap.set(typeId, entry);
    }
    return entry;
  }

  const warnings: string[] = [];

  // Track linked population group deductions to enforce: sem double count automático (DEC-1063, DEC-1064)
  const populationGroupLinkedDeductions = new Map<string, number>();

  // 1. Contributions from Active OperationalGroups
  const opGroups = people.operationalGroups ?? [];
  for (const og of opGroups) {
    // Inactive or disbanded operational groups do NOT contribute capacity (DEC-1057, DEC-1090)
    if (og.lifecycle !== "active") {
      continue;
    }

    const typeId = resolveOperationalGroupWorkforceType(og.definitionId);
    const entry = ensureType(typeId);

    entry.capacity += og.size;
    entry.contributions.push({
      sourceId: og.id,
      sourceType: "operational-group",
      sourceName: og.name,
      amount: og.size
    });

    if (og.populationGroupId) {
      const prev = populationGroupLinkedDeductions.get(og.populationGroupId) ?? 0;
      populationGroupLinkedDeductions.set(og.populationGroupId, prev + og.size);
    }
  }

  // 2. Contributions from PopulationGroups (if configured with workforce contributions)
  const popGroups = people.populationGroups ?? [];
  for (const pg of popGroups) {
    const contributions = pg.workforceContributions;
    if (contributions && Array.isArray(contributions)) {
      for (const c of contributions) {
        if (typeof c.workforceTypeId === "string" && typeof c.amount === "number" && c.amount > 0) {
          const entry = ensureType(c.workforceTypeId);
          // Check if part of this group is already counted via linked operational groups
          const linkedDeduction = populationGroupLinkedDeductions.get(pg.id) ?? 0;
          const netContribution = Math.max(0, c.amount - linkedDeduction);

          if (netContribution < c.amount) {
            warnings.push(
              `PopulationGroup '${pg.name}' workforce contribution of ${c.amount} reduced to ${netContribution} to prevent double-counting linked operational groups.`
            );
          }

          if (netContribution > 0) {
            entry.capacity += netContribution;
            entry.contributions.push({
              sourceId: pg.id,
              sourceType: "population-group",
              sourceName: pg.name,
              amount: netContribution,
              deductedFromLinked: netContribution < c.amount
            });
          }
        }
      }
    }
  }

  // 3. Committed workforce from Active Assignments (with world-time consideration)
  const assignments = people.assignments ?? [];
  const notableMap = new Map((people.notables ?? []).map((n) => [n.id, n]));
  const notableContributedCapacity = new Set<string>();

  for (const asg of assignments) {
    if (asg.status === "active") {
      if (nowWorld !== undefined && asg.endsAtWorld !== undefined && asg.endsAtWorld <= nowWorld) {
        continue;
      }
      if (nowWorld !== undefined && asg.startedAtWorld !== undefined && asg.startedAtWorld > nowWorld) {
        continue;
      }

      // If source is a notable, account for their specialist capacity (DEC-1133)
      if (isOpaqueId(asg.sourceRef, "not")) {
        const notable = notableMap.get(asg.sourceRef);
        if (notable && !notableContributedCapacity.has(asg.sourceRef)) {
          notableContributedCapacity.add(asg.sourceRef);
          const capEntry = ensureType(asg.workforceTypeId);
          capEntry.capacity += 1;
          capEntry.contributions.push({
            sourceId: notable.id,
            sourceType: "notable",
            sourceName: notable.name ?? notable.id,
            amount: 1
          });
        }
      }

      const entry = ensureType(asg.workforceTypeId);
      entry.committed += asg.amount;
    }
  }

  // 4. Reserved workforce from Active Reservations (checking real & world expiration, DEC-1125)
  const reservations = people.reservations ?? [];
  for (const resv of reservations) {
    if (resv.status === "active") {
      // If reservation expired by real time, it does not hold workforce
      if (resv.expiresAtReal !== undefined && resv.expiresAtReal < nowReal) {
        continue;
      }
      // If reservation expired by world time, it does not hold workforce
      if (nowWorld !== undefined && resv.expiresAtWorld !== undefined && resv.expiresAtWorld <= nowWorld) {
        continue;
      }

      // If source is a notable, account for their specialist capacity (DEC-1133)
      if (isOpaqueId(resv.sourceRef, "not")) {
        const notable = notableMap.get(resv.sourceRef);
        if (notable && !notableContributedCapacity.has(resv.sourceRef)) {
          notableContributedCapacity.add(resv.sourceRef);
          const capEntry = ensureType(resv.workforceTypeId);
          capEntry.capacity += 1;
          capEntry.contributions.push({
            sourceId: notable.id,
            sourceType: "notable",
            sourceName: notable.name ?? notable.id,
            amount: 1
          });
        }
      }

      const entry = ensureType(resv.workforceTypeId);
      entry.reserved += resv.amount;
    }
  }

  // 5. Compile resolutions and totals
  const typesRecord: Record<string, WorkforceTypeResolution> = {};
  let totalCapacity = 0;
  let totalCommitted = 0;
  let totalReserved = 0;
  let totalAvailable = 0;
  let isAnyOvercommitted = false;

  for (const [typeId, data] of typeMap.entries()) {
    const available = data.capacity - data.committed - data.reserved;
    const isOvercommitted = available < 0;

    if (isOvercommitted) {
      isAnyOvercommitted = true;
      warnings.push(
        `Workforce type '${typeId}' is overcommitted: capacity=${data.capacity}, committed=${data.committed}, reserved=${data.reserved}, available=${available}`
      );
    }

    typesRecord[typeId] = {
      workforceTypeId: typeId,
      capacity: data.capacity,
      committed: data.committed,
      reserved: data.reserved,
      available,
      isOvercommitted,
      contributions: Object.freeze([...data.contributions])
    };

    totalCapacity += data.capacity;
    totalCommitted += data.committed;
    totalReserved += data.reserved;
    totalAvailable += available;
  }

  return {
    types: Object.freeze(typesRecord),
    totalCapacity,
    totalCommitted,
    totalReserved,
    totalAvailable,
    isAnyOvercommitted,
    warnings: Object.freeze(warnings)
  };
}
