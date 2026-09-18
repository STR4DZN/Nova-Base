import { createPublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import type { DomainReadRepository } from "../storage/repositories/domain-repository.js";
import { getDomainPeopleData } from "../people/people-data.js";
import { PeopleProjectionService } from "../projection/people/people-projection-service.js";
import { resolveCurrentViewer, type ViewerIdentity } from "../projection/viewer-identity.js";
import type { RoleDefinition } from "../people/roles/role-types.js";
import type { OperationalGroupDefinition } from "../people/operational-groups/operational-group-types.js";

export interface PeopleAggregationQueryOptions {
  readonly recursive?: boolean; // default: true
  readonly viewer?: Partial<ViewerIdentity>;
  readonly nowReal?: number;
  readonly nowWorld?: number;
  readonly roleDefinitions?: readonly RoleDefinition[];
  readonly groupDefinitions?: readonly OperationalGroupDefinition[];
}

export interface PeopleDomainContribution {
  readonly domainUuid: string;
  readonly domainName: string;
  readonly depth: number;
  readonly isRoot: boolean;
  readonly population: {
    readonly total: number | null;
    readonly precision: "exact" | "estimated" | "unknown";
  };
  readonly workforceCapacity: Readonly<Record<string, number>>;
  readonly notableCount: number;
  readonly roleCount: number;
  readonly operationalGroupCount: number;
}

export interface PeopleAggregateResult {
  readonly rootDomainUuid: string;
  readonly completeness: "complete" | "partial" | "incomplete";
  readonly precision: "exact" | "estimated" | "unknown";
  readonly totalPopulation: number | null;
  readonly ownPopulation: number | null;
  readonly descendantPopulation: number | null;
  readonly unknownContributors: readonly string[];
  readonly domainBreakdown: readonly PeopleDomainContribution[];
  readonly workforceSummary: {
    readonly ownCapacity: Readonly<Record<string, number>>;
    readonly descendantCapacity: Readonly<Record<string, number>>;
    readonly totalCapacity: Readonly<Record<string, number>>;
  };
  readonly cycleDetected: boolean;
  readonly warnings: readonly string[];
}

export class PeopleAggregationService {
  readonly #domains: DomainReadRepository;

  constructor(domains: DomainReadRepository) {
    this.#domains = domains;
  }

  queryPeopleAggregate(
    rootDomainUuid: string,
    options: PeopleAggregationQueryOptions = {}
  ): Result<PeopleAggregateResult> {
    const rootId = rootDomainUuid.startsWith("JournalEntry.")
      ? rootDomainUuid.slice("JournalEntry.".length)
      : rootDomainUuid;

    const rootDocRes = this.#domains.read(rootId);
    if (!rootDocRes.ok) {
      return rootDocRes;
    }

    const recursive = options.recursive ?? true;
    const viewer = resolveCurrentViewer(options.viewer);
    const projectionService = new PeopleProjectionService({
      roleDefinitions: options.roleDefinitions,
      groupDefinitions: options.groupDefinitions
    });

    const warnings: string[] = [];
    const visitedUuids = new Set<string>();
    const domainBreakdown: PeopleDomainContribution[] = [];
    const unknownContributors: string[] = [];

    let hasEstimated = false;
    let hasUnknown = false;
    let hasNull = false;
    let cycleDetected = false;

    // Queue for BFS traversal: [domainDoc, depth]
    const queue: Array<{ doc: typeof rootDocRes.value; depth: number }> = [
      { doc: rootDocRes.value, depth: 0 }
    ];
    visitedUuids.add(rootDocRes.value.uuid);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const isRoot = current.depth === 0;

      const people = getDomainPeopleData(current.doc.record);
      const projected = projectionService.project(
        current.doc.uuid,
        people,
        viewer,
        { nowReal: options.nowReal, nowWorld: options.nowWorld }
      );

      const popRes = projected.population.resolution;
      if (popRes.precision === "estimated") hasEstimated = true;
      if (popRes.precision === "unknown" || popRes.total === null) {
        hasUnknown = true;
        unknownContributors.push(current.doc.uuid);
      }
      if (popRes.total === null) hasNull = true;

      const wfCap: Record<string, number> = {};
      for (const [typeId, res] of Object.entries(projected.workforce.types)) {
        wfCap[typeId] = res.capacity;
      }

      domainBreakdown.push({
        domainUuid: current.doc.uuid,
        domainName: current.doc.name,
        depth: current.depth,
        isRoot,
        population: {
          total: popRes.total,
          precision: popRes.precision
        },
        workforceCapacity: Object.freeze(wfCap),
        notableCount: projected.notables.length,
        roleCount: projected.roles.length,
        operationalGroupCount: projected.operationalGroups.length
      });

      if (isRoot || recursive) {
        // Query direct children using DomainReadRepository query
        const childrenRes = this.#domains.query({ parentDomainUuid: current.doc.uuid });
        if (childrenRes.ok) {
          for (const childDoc of childrenRes.value) {
            if (visitedUuids.has(childDoc.uuid)) {
              cycleDetected = true;
              warnings.push(`Cycle detected involving domain '${childDoc.name}' (${childDoc.uuid})`);
              continue;
            }
            visitedUuids.add(childDoc.uuid);
            queue.push({ doc: childDoc, depth: current.depth + 1 });
          }
        }
      }
    }

    // Population rollup
    let ownPopulation: number | null = null;
    let descendantSum = 0;
    let hasAnyDescendantCount = false;

    const ownWorkforce: Record<string, number> = {};
    const descendantWorkforce: Record<string, number> = {};
    const totalWorkforce: Record<string, number> = {};

    for (const item of domainBreakdown) {
      if (item.isRoot) {
        ownPopulation = item.population.total;
        for (const [typeId, cap] of Object.entries(item.workforceCapacity)) {
          ownWorkforce[typeId] = (ownWorkforce[typeId] ?? 0) + cap;
          totalWorkforce[typeId] = (totalWorkforce[typeId] ?? 0) + cap;
        }
      } else {
        if (item.population.total !== null) {
          descendantSum += item.population.total;
          hasAnyDescendantCount = true;
        }
        for (const [typeId, cap] of Object.entries(item.workforceCapacity)) {
          descendantWorkforce[typeId] = (descendantWorkforce[typeId] ?? 0) + cap;
          totalWorkforce[typeId] = (totalWorkforce[typeId] ?? 0) + cap;
        }
      }
    }

    const descendantPopulation = hasAnyDescendantCount ? descendantSum : (domainBreakdown.length > 1 ? 0 : null);
    let totalPopulation: number | null = null;
    if (ownPopulation !== null || descendantPopulation !== null) {
      totalPopulation = (ownPopulation ?? 0) + (descendantPopulation ?? 0);
    }

    // Determine precision & completeness
    let precision: "exact" | "estimated" | "unknown" = "exact";
    if (hasUnknown) {
      precision = "unknown";
    } else if (hasEstimated) {
      precision = "estimated";
    }

    let completeness: "complete" | "partial" | "incomplete" = "complete";
    if (hasUnknown || hasNull) {
      completeness = totalPopulation !== null && totalPopulation > 0 ? "partial" : "incomplete";
    }

    return ok({
      rootDomainUuid: rootDocRes.value.uuid,
      completeness,
      precision,
      totalPopulation,
      ownPopulation,
      descendantPopulation,
      unknownContributors: Object.freeze(unknownContributors),
      domainBreakdown: Object.freeze(domainBreakdown),
      workforceSummary: {
        ownCapacity: Object.freeze(ownWorkforce),
        descendantCapacity: Object.freeze(descendantWorkforce),
        totalCapacity: Object.freeze(totalWorkforce)
      },
      cycleDetected,
      warnings: Object.freeze(warnings)
    });
  }
}
