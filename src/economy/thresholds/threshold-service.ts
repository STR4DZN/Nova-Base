import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";

export type ThresholdMetric = "balance" | "available";
export type ThresholdComparator = "<" | "<=" | ">" | ">=" | "lt" | "lte" | "gt" | "gte";
export type ThresholdSeverity = "info" | "warning" | "critical";

export interface ThresholdDefinition {
  readonly id: string; // thrs_*
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly metric: ThresholdMetric;
  readonly comparator: ThresholdComparator;
  readonly operator: ThresholdComparator;
  readonly valueMinor: number;
  readonly targetValueMinor: number;
  readonly severity: ThresholdSeverity;
  readonly label: string;
  readonly name: string;
  readonly autoHoldReservations: boolean;
}

export interface ThresholdBreachResult {
  readonly breached: boolean;
  readonly definition: ThresholdDefinition;
  readonly actualValueMinor: number;
}

export interface ThresholdStatus {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly crossedThresholds: readonly ThresholdDefinition[];
  readonly highestSeverity?: ThresholdSeverity;
  readonly isNearCapacity: boolean;
  readonly isOverCapacity: boolean;
  readonly isLowReserve: boolean;
}

export interface ThresholdInput {
  readonly id?: string;
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly metric: ThresholdMetric;
  readonly comparator?: ThresholdComparator;
  readonly operator?: ThresholdComparator;
  readonly valueMinor?: number;
  readonly targetValueMinor?: number;
  readonly severity: ThresholdSeverity;
  readonly label?: string;
  readonly name?: string;
  readonly autoHoldReservations?: boolean;
}

export type ThresholdTransitionType = "breach" | "recovery";

export interface ThresholdTransitionEvent {
  readonly type: ThresholdTransitionType;
  readonly definition: ThresholdDefinition;
  readonly actualValueMinor: number;
  readonly previousState: boolean;
  readonly currentState: boolean;
}

export class ThresholdService {
  readonly #thresholds = new Map<string, ThresholdDefinition>();
  readonly #crossedStates = new Map<string, boolean>();

  register(input: ThresholdInput): Result<ThresholdDefinition, PublicError> {
    return this.registerThreshold(input);
  }

  registerThreshold(input: ThresholdInput): Result<ThresholdDefinition, PublicError> {
    const id = input.id ?? createOpaqueId("thrs");
    const value = input.targetValueMinor ?? input.valueMinor ?? 0;
    if (!Number.isSafeInteger(value)) {
      return err(
        createPublicError({
          code: "DM_ECON_THRESHOLD_INVALID",
          category: "validation",
          message: `Threshold valueMinor must be a safe integer: received ${String(value)}`
        })
      );
    }

    const op = input.operator ?? input.comparator ?? "<=";
    const label = input.name ?? input.label ?? "Alert";

    const definition: ThresholdDefinition = {
      id,
      domainUuid: input.domainUuid,
      resourceId: input.resourceId,
      metric: input.metric,
      comparator: op,
      operator: op,
      valueMinor: value,
      targetValueMinor: value,
      severity: input.severity,
      label,
      name: label,
      autoHoldReservations: Boolean(input.autoHoldReservations)
    };

    this.#thresholds.set(id, definition);
    return ok(definition);
  }

  getThreshold(id: string): ThresholdDefinition | undefined {
    return this.#thresholds.get(id);
  }

  listThresholds(domainUuid?: string, resourceId?: string): readonly ThresholdDefinition[] {
    let list = Array.from(this.#thresholds.values());
    if (domainUuid) {
      list = list.filter((t) => t.domainUuid === domainUuid);
    }
    if (resourceId) {
      list = list.filter((t) => t.resourceId === resourceId);
    }
    return Object.freeze(list);
  }

  evaluate(
    domainUuid: string,
    resourceId: string,
    values: { balanceMinor: number; reservedMinor?: number; availableMinor: number; capacityMinor?: number | null }
  ): readonly ThresholdBreachResult[] {
    const domainThresholds = this.listThresholds(domainUuid, resourceId);
    const results: ThresholdBreachResult[] = [];

    for (const th of domainThresholds) {
      const current = th.metric === "balance" ? values.balanceMinor : values.availableMinor;
      let isCrossed = false;

      switch (th.operator) {
        case "<":
        case "lt":
          isCrossed = current < th.valueMinor;
          break;
        case "<=":
        case "lte":
          isCrossed = current <= th.valueMinor;
          break;
        case ">":
        case "gt":
          isCrossed = current > th.valueMinor;
          break;
        case ">=":
        case "gte":
          isCrossed = current >= th.valueMinor;
          break;
      }

      if (isCrossed) {
        results.push({
          breached: true,
          definition: th,
          actualValueMinor: current
        });
      }
    }

    return Object.freeze(results);
  }

  isCrossed(id: string): boolean {
    return this.#crossedStates.get(id) ?? false;
  }

  resetCrossedState(id?: string): void {
    if (id !== undefined) {
      this.#crossedStates.delete(id);
    } else {
      this.#crossedStates.clear();
    }
  }

  getCrossedStates(): ReadonlyMap<string, boolean> {
    return new Map(this.#crossedStates);
  }

  evaluateCrossings(
    domainUuid: string,
    resourceId: string,
    values: { balanceMinor: number; reservedMinor?: number; availableMinor: number; capacityMinor?: number | null }
  ): readonly ThresholdTransitionEvent[] {
    const domainThresholds = this.listThresholds(domainUuid, resourceId);
    const transitions: ThresholdTransitionEvent[] = [];

    for (const th of domainThresholds) {
      const current = th.metric === "balance" ? values.balanceMinor : values.availableMinor;
      let isBreached = false;

      switch (th.operator) {
        case "<":
        case "lt":
          isBreached = current < th.valueMinor;
          break;
        case "<=":
        case "lte":
          isBreached = current <= th.valueMinor;
          break;
        case ">":
        case "gt":
          isBreached = current > th.valueMinor;
          break;
        case ">=":
        case "gte":
          isBreached = current >= th.valueMinor;
          break;
      }

      const previousState = this.#crossedStates.get(th.id) ?? false;
      if (isBreached !== previousState) {
        this.#crossedStates.set(th.id, isBreached);
        transitions.push({
          type: isBreached ? "breach" : "recovery",
          definition: th,
          actualValueMinor: current,
          previousState,
          currentState: isBreached
        });
      }
    }

    return Object.freeze(transitions);
  }

  evaluateStatus(
    domainUuid: string,
    resourceId: string,
    values: { balanceMinor: number; availableMinor: number; capacityMinor?: number | null }
  ): ThresholdStatus {
    const breaches = this.evaluate(domainUuid, resourceId, values);
    const crossed = breaches.map((b) => b.definition);

    let highestSeverity: ThresholdSeverity | undefined;
    if (crossed.some((t) => t.severity === "critical")) {
      highestSeverity = "critical";
    } else if (crossed.some((t) => t.severity === "warning")) {
      highestSeverity = "warning";
    } else if (crossed.some((t) => t.severity === "info")) {
      highestSeverity = "info";
    }

    const cap = values.capacityMinor;
    const isOverCapacity = cap !== null && cap !== undefined && values.balanceMinor > cap;
    const isNearCapacity =
      cap !== null &&
      cap !== undefined &&
      cap > 0 &&
      values.balanceMinor >= cap * 0.85 &&
      !isOverCapacity;
    const isLowReserve = values.availableMinor < 0;

    return {
      domainUuid,
      resourceId,
      crossedThresholds: Object.freeze(crossed),
      highestSeverity,
      isNearCapacity,
      isOverCapacity,
      isLowReserve
    };
  }
}
