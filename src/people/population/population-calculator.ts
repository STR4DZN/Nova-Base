import type { PopulationGroup, PopulationResolution, PopulationState } from "./population-types.js";

export function calculatePopulation(
  state: PopulationState,
  groups: readonly PopulationGroup[]
): PopulationResolution {
  const warnings: string[] = [];

  switch (state.mode) {
    case "manual": {
      return {
        total: state.total,
        precision: state.total === null ? "unknown" : state.precision,
        warnings: Object.freeze(warnings)
      };
    }

    case "sumGroups": {
      const includedGroups = groups.filter((g) => g.includedInTotal);

      if (includedGroups.length === 0) {
        return {
          total: 0,
          precision: "exact",
          warnings: Object.freeze(warnings)
        };
      }

      let hasNull = false;
      let hasNumber = false;
      let exactSum = 0n;

      for (const g of includedGroups) {
        if (g.count === null) {
          hasNull = true;
        } else {
          hasNumber = true;
          exactSum += BigInt(g.count);
        }
      }

      if (exactSum > BigInt(Number.MAX_SAFE_INTEGER)) {
        warnings.push("DM_POPULATION_SUM_OVERFLOW: Population group sum exceeds maximum safe integer");
        return { total: null, precision: "unknown", warnings: Object.freeze(warnings) };
      }
      const sum = Number(exactSum);

      if (hasNull && !hasNumber) {
        return {
          total: null,
          precision: "unknown",
          warnings: Object.freeze(warnings)
        };
      }

      if (hasNull) {
        warnings.push("DM_POPULATION_PARTIAL_UNKNOWN: Some included population groups have unknown counts");
        return {
          total: sum,
          precision: "estimated",
          warnings: Object.freeze(warnings)
        };
      }

      const anyEstimated = includedGroups.some((g) => g.precision === "estimated");
      if (anyEstimated) {
        return {
          total: sum,
          precision: "estimated",
          warnings: Object.freeze(warnings)
        };
      }

      return {
        total: sum,
        precision: "exact",
        warnings: Object.freeze(warnings)
      };
    }

    case "hybrid": {
      const includedGroups = groups.filter((g) => g.includedInTotal);
      let groupsSum = 0n;
      let hasNullGroup = false;

      for (const g of includedGroups) {
        if (g.count === null) {
          hasNullGroup = true;
        } else {
          groupsSum += BigInt(g.count);
        }
      }

      if (hasNullGroup) {
        warnings.push("DM_POPULATION_HYBRID_PARTIAL_UNKNOWN: Some subset groups have unknown counts");
      }

      if (state.total !== null && groupsSum > BigInt(state.total)) {
        warnings.push(
          `DM_POPULATION_GROUPS_EXCEED_TOTAL: Total of included population groups (${groupsSum}) exceeds declared domain population (${state.total})`
        );
      }

      return {
        total: state.total,
        precision: state.total === null ? "unknown" : state.precision,
        warnings: Object.freeze(warnings)
      };
    }
  }
}
