import type { DomainRecord } from "../../../domains/domain-schema.js";
import type { DomainDocument } from "../../../storage/repositories/domain-repository.js";
import { getDomainFacilitiesData, type DomainFacilitiesData } from "../../../facilities/facility-data.js";
import {
  calculateFacilityEffectiveCapabilities,
  type FacilityInstance,
  type FacilityLifecycle,
  type FacilityReadiness,
  type FacilityDefinition
} from "../../../facilities/types/facility-types.js";
import type { FacilityDefinitionRegistry } from "../../../facilities/definitions/facility-registry.js";
import type {
  FacilityCondition,
  FacilityConditionSeverity,
  FacilityMaintenanceStatus
} from "../../../facilities/types/facility-maintenance-types.js";
import type { ViewerIdentity } from "../../../projection/viewer-identity.js";

export interface FacilitiesPresenterOptions {
  readonly viewerIsGm?: boolean;
  readonly viewer?: Partial<ViewerIdentity>;
  readonly facilityRegistry?: FacilityDefinitionRegistry;
  readonly filterReadiness?: FacilityReadiness | "all";
  readonly filterLifecycle?: FacilityLifecycle | "all";
  readonly searchTerm?: string;
}

export interface FacilityConditionViewModel {
  readonly id: string;
  readonly severity: FacilityConditionSeverity;
  readonly severityBadgeClass: string;
  readonly description: string;
  readonly causesDegradation: boolean;
  readonly suppressesCapabilities: readonly string[];
}

export interface FacilityMaintenanceViewModel {
  readonly status: FacilityMaintenanceStatus;
  readonly statusBadgeClass: string;
  readonly intervalTicks: number;
  readonly ticksSinceLastMaintenance: number;
  readonly maintenanceRatio: number;
  readonly formattedRatio: string;
  readonly consecutiveMissedCycles: number;
}

export interface FacilityViewModel {
  readonly id: string;
  readonly definitionId: string;
  readonly name: string;
  readonly level: number;
  readonly revision: number;
  readonly lifecycle: FacilityLifecycle;
  readonly lifecycleBadgeClass: string;
  readonly readiness: FacilityReadiness;
  readonly readinessBadgeClass: string;
  readonly structuralIntegrity: number;
  readonly maxStructuralIntegrity: number;
  readonly integrityPercent: number; // Derived integer 0..100
  readonly integrityClass: "healthy" | "warning" | "danger";
  readonly conditions: readonly FacilityConditionViewModel[];
  readonly maintenance: FacilityMaintenanceViewModel;
  readonly effectiveCapabilities: readonly string[];
  readonly slotsCount: number;
  readonly activeModulesCount: number;
  readonly activeUpgradesCount: number;
  readonly isSecret: boolean;
  readonly canRepair: boolean;
  readonly canMaintain: boolean;
}

export interface FacilitiesSubsystemViewModel {
  readonly domainUuid: string;
  readonly viewerIsGm: boolean;
  readonly totalCount: number;
  readonly operationalCount: number;
  readonly readyCount: number;
  readonly degradedOrDamagedCount: number;
  readonly facilities: readonly FacilityViewModel[];
  readonly filterReadiness: string;
  readonly filterLifecycle: string;
  readonly searchTerm: string;
}

function resolveLifecycleBadgeClass(lifecycle: FacilityLifecycle): string {
  switch (lifecycle) {
    case "operational":
      return "dm-badge-operational";
    case "underConstruction":
      return "dm-badge-under-construction";
    case "planned":
      return "dm-badge-planned";
    case "inactive":
      return "dm-badge-inactive";
    case "degraded":
      return "dm-badge-degraded";
    case "disabled":
      return "dm-badge-disabled";
    case "decommissioned":
      return "dm-badge-decommissioned";
    case "destroyed":
      return "dm-badge-destroyed";
    default:
      return "dm-badge-default";
  }
}

function resolveReadinessBadgeClass(readiness: FacilityReadiness): string {
  switch (readiness) {
    case "ready":
      return "dm-badge-ready";
    case "limited":
      return "dm-badge-limited";
    case "blocked":
      return "dm-badge-blocked";
    case "unavailable":
      return "dm-badge-unavailable";
    default:
      return "dm-badge-default";
  }
}

function resolveSeverityBadgeClass(severity: FacilityConditionSeverity): string {
  switch (severity) {
    case "critical":
      return "dm-badge-danger";
    case "major":
      return "dm-badge-warning";
    case "moderate":
      return "dm-badge-info";
    case "minor":
    default:
      return "dm-badge-default";
  }
}

function resolveMaintenanceBadgeClass(status: FacilityMaintenanceStatus): string {
  switch (status) {
    case "current":
      return "dm-badge-healthy";
    case "due":
      return "dm-badge-info";
    case "overdue":
      return "dm-badge-warning";
    case "exempt":
      return "dm-badge-default";
    default:
      return "dm-badge-default";
  }
}

export function buildFacilitiesViewModel(
  domainInput: DomainDocument | DomainRecord,
  options: FacilitiesPresenterOptions = {}
): FacilitiesSubsystemViewModel {
  const record: DomainRecord = "record" in domainInput ? domainInput.record : domainInput;
  const domainUuid = "uuid" in domainInput ? domainInput.uuid : "unknown";
  const viewerIsGm = options.viewerIsGm ?? options.viewer?.isGm ?? false;
  const filterReadiness = options.filterReadiness ?? "all";
  const filterLifecycle = options.filterLifecycle ?? "all";
  const searchTerm = (options.searchTerm ?? "").toLowerCase().trim();

  const data: DomainFacilitiesData = getDomainFacilitiesData(record);
  const defRegistry = options.facilityRegistry;

  const facilityVMs: FacilityViewModel[] = [];

  for (const facility of data.facilities) {
    const isSecret = Boolean((facility as any).visibility === "secret" || facility.tags?.includes("secret"));
    if (isSecret && !viewerIsGm) {
      continue; // Filter out secret facilities for non-GMs
    }

    if (filterReadiness !== "all" && facility.readiness !== filterReadiness) {
      continue;
    }

    if (filterLifecycle !== "all" && facility.lifecycle !== filterLifecycle) {
      continue;
    }

    const def = defRegistry?.get(facility.definitionId);
    const name = facility.name || def?.label || facility.id;

    if (searchTerm) {
      const matchName = name.toLowerCase().includes(searchTerm);
      const matchDef = facility.definitionId.toLowerCase().includes(searchTerm);
      if (!matchName && !matchDef) {
        continue;
      }
    }

    // Structural integrity
    const integrity = facility.integrity?.current ?? 100;
    const maxIntegrity = facility.integrity?.max ?? 100;
    const integrityPercent = maxIntegrity > 0
      ? Math.min(100, Math.max(0, Math.floor((integrity / maxIntegrity) * 100)))
      : 100;

    let integrityClass: "healthy" | "warning" | "danger" = "healthy";
    if (integrityPercent < 40) {
      integrityClass = "danger";
    } else if (integrityPercent < 80) {
      integrityClass = "warning";
    }

    // Maintenance
    const maintState = facility.maintenanceState;
    const intervalTicks = def?.maintenance?.intervalTicks ?? 30;
    const ticksSince = maintState?.accumulatedTicks ?? 0;
    const maintenanceRatio = intervalTicks > 0 ? ticksSince / intervalTicks : 0;
    const formattedRatio = `${Math.floor(maintenanceRatio * 100)}%`;
    const maintStatus: FacilityMaintenanceStatus = maintState?.status ?? "current";
    const consecutiveMissed = Math.floor(ticksSince / Math.max(1, intervalTicks));

    const maintenanceVM: FacilityMaintenanceViewModel = {
      status: maintStatus,
      statusBadgeClass: resolveMaintenanceBadgeClass(maintStatus),
      intervalTicks,
      ticksSinceLastMaintenance: ticksSince,
      maintenanceRatio,
      formattedRatio,
      consecutiveMissedCycles: consecutiveMissed
    };

    // Conditions
    const rawConditions = facility.conditions ?? [];
    const conditionVMs: FacilityConditionViewModel[] = rawConditions.map((c: FacilityCondition) => ({
      id: c.id,
      severity: c.severity,
      severityBadgeClass: resolveSeverityBadgeClass(c.severity),
      description: c.description ?? c.label,
      causesDegradation: c.severity === "critical" || c.severity === "major",
      suppressesCapabilities: c.suppressedCapabilities ?? []
    }));

    // Effective capabilities (taking condition suppression and lifecycle into account)
    const effectiveCapabilities = def
      ? calculateFacilityEffectiveCapabilities(facility, def)
      : Object.freeze([]);

    const slotsCount = facility.installedModules?.length ?? 0;
    const activeModulesCount = facility.installedModules?.length ?? 0;
    const activeUpgradesCount = facility.activeUpgrades?.length ?? 0;

    const canMaintain = facility.lifecycle !== "destroyed" && facility.lifecycle !== "decommissioned";
    const canRepair = (integrity < maxIntegrity || conditionVMs.length > 0) && facility.lifecycle !== "destroyed";

    facilityVMs.push({
      id: facility.id,
      definitionId: facility.definitionId,
      name,
      level: facility.level,
      revision: facility.revision,
      lifecycle: facility.lifecycle,
      lifecycleBadgeClass: resolveLifecycleBadgeClass(facility.lifecycle),
      readiness: facility.readiness,
      readinessBadgeClass: resolveReadinessBadgeClass(facility.readiness),
      structuralIntegrity: integrity,
      maxStructuralIntegrity: maxIntegrity,
      integrityPercent,
      integrityClass,
      conditions: Object.freeze(conditionVMs),
      maintenance: maintenanceVM,
      effectiveCapabilities: Object.freeze(effectiveCapabilities),
      slotsCount,
      activeModulesCount,
      activeUpgradesCount,
      isSecret,
      canRepair,
      canMaintain
    });
  }

  // Summary counts across all visible facilities
  const allVisible = data.facilities.filter((f) => {
    const isSecret = Boolean((f as any).visibility === "secret" || f.tags?.includes("secret"));
    return !isSecret || viewerIsGm;
  });

  const totalCount = allVisible.length;
  const operationalCount = allVisible.filter((f) => f.lifecycle === "operational").length;
  const readyCount = allVisible.filter((f) => f.readiness === "ready").length;
  const degradedOrDamagedCount = allVisible.filter((f) => {
    const isDegraded = f.lifecycle === "degraded";
    const isDamaged = f.integrity ? f.integrity.current < f.integrity.max : false;
    const hasConditions = (f.conditions?.length ?? 0) > 0;
    return isDegraded || isDamaged || hasConditions;
  }).length;

  return {
    domainUuid,
    viewerIsGm,
    totalCount,
    operationalCount,
    readyCount,
    degradedOrDamagedCount,
    facilities: Object.freeze(facilityVMs),
    filterReadiness,
    filterLifecycle,
    searchTerm
  };
}
