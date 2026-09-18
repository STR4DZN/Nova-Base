import type { DomainRecord } from "../../../domains/domain-schema.js";
import type { DomainDocument } from "../../../storage/repositories/domain-repository.js";
import { getDomainEconomyData, type DomainEconomyData } from "../../../economy/economy-data.js";
import type { ResourceAccount } from "../../../economy/accounts/account-types.js";
import type { ResourceDefinitionRegistry } from "../../../economy/definitions/resource-registry.js";
import type { LedgerStore } from "../../../economy/ledger/ledger-store.js";
import type { ReservationStore } from "../../../economy/reservations/reservation-store.js";
import { resolveEffectiveCapacity } from "../../../economy/accounts/capacity-resolver.js";
import { formatResourceAmount } from "../../../economy/math/minor-units.js";
import type { ResourceDefinition } from "../../../economy/definitions/resource-definition-types.js";

export interface EconomyPresenterOptions {
  readonly viewerIsGm: boolean;
  readonly resourceRegistry: ResourceDefinitionRegistry;
  readonly ledgerStore?: LedgerStore;
  readonly reservationStore?: ReservationStore;
}

export interface ResourceAccountViewModel {
  readonly resourceId: string;
  readonly label: string;
  readonly icon?: string;
  readonly displayUnit?: string;
  readonly balanceMinor: number;
  readonly balanceFormatted: string;
  readonly reservedMinor: number;
  readonly reservedFormatted: string;
  readonly availableMinor: number;
  readonly availableFormatted: string;
  readonly effectiveCapacityMinor: number | null;
  readonly capacityFormatted: string;
  readonly capacityPercentage: number | null;
  readonly isSecret: boolean;
  readonly statusBadgeClass: "normal" | "near-capacity" | "over-capacity" | "low-reserve";
}

export interface LedgerEntryViewModel {
  readonly id: string;
  readonly timestampFormatted: string;
  readonly kind: string;
  readonly deltaFormatted: string;
  readonly deltaClass: "positive" | "negative";
  readonly reason?: string;
  readonly resourceLabel: string;
}

export interface EconomySubsystemViewModel {
  readonly domainUuid: string;
  readonly viewerIsGm: boolean;
  readonly accounts: readonly ResourceAccountViewModel[];
  readonly recentLedger: readonly LedgerEntryViewModel[];
}

export function buildEconomyViewModel(
  domainInput: DomainDocument | DomainRecord,
  options: EconomyPresenterOptions
): EconomySubsystemViewModel {
  const record: DomainRecord =
    "record" in domainInput
      ? (domainInput as any).record
      : "flags" in domainInput && (domainInput as any).flags?.["domain-manager"]
        ? (domainInput as any).flags["domain-manager"]
        : (domainInput as DomainRecord);
  const domainUuid = "uuid" in domainInput ? domainInput.uuid : "unknown";
  const economyData: DomainEconomyData = getDomainEconomyData(record);

  const accountVMs: ResourceAccountViewModel[] = [];

  for (const acc of economyData.accounts) {
    // Viewer sanitization: Non-GM viewers cannot see secret accounts (DEC-16888–16894)
    if (!options.viewerIsGm && acc.visibility === "secret") {
      continue;
    }

    const def = options.resourceRegistry.get(acc.resourceId);
    const label = def?.label ?? acc.resourceId;
    const precision = def?.precision ?? 0;
    const unit = def?.displayUnit?.singular ?? def?.displayUnit?.abbreviation ?? "";

    const balanceMinor = acc.mode === "native" ? acc.balanceMinor : 0;
    const reservedMinor = options.reservationStore
      ? options.reservationStore.getReservedTotal(domainUuid, acc.resourceId)
      : 0;
    const availableMinor = balanceMinor - reservedMinor;

    const baseCap = acc.mode === "native" ? acc.baseCapacityMinor : null;
    const effectiveCap = resolveEffectiveCapacity(baseCap, [], def);
    const effectiveCapacityMinor = effectiveCap.effectiveCapacityMinor;

    let capacityPercentage: number | null = null;
    let statusBadgeClass: ResourceAccountViewModel["statusBadgeClass"] = "normal";

    if (effectiveCapacityMinor !== null && effectiveCapacityMinor > 0) {
      capacityPercentage = Math.min(100, Math.round((balanceMinor / effectiveCapacityMinor) * 100));
      if (balanceMinor > effectiveCapacityMinor) {
        statusBadgeClass = "over-capacity";
      } else if (capacityPercentage >= 85) {
        statusBadgeClass = "near-capacity";
      }
    }

    if (availableMinor < 0) {
      statusBadgeClass = "low-reserve";
    }

    const resDef: ResourceDefinition = def ?? {
      id: acc.resourceId,
      version: 1,
      label,
      description: "",
      icon: "",
      categoryId: "custom",
      tags: [],
      precision,
      displayUnit: { singular: unit, plural: unit },
      minimumMinor: 0,
      maximumMinor: null,
      allowNegative: false,
      defaultCapacityPolicy: "block",
      lifecycle: "active"
    };

    const balanceFormatted = formatResourceAmount(balanceMinor, resDef, { showUnit: true });
    const reservedFormatted = formatResourceAmount(reservedMinor, resDef, { showUnit: true });
    const availableFormatted = formatResourceAmount(availableMinor, resDef, { showUnit: true });
    const capacityFormatted =
      effectiveCapacityMinor !== null
        ? formatResourceAmount(effectiveCapacityMinor, resDef, { showUnit: true })
        : "Unlimited";

    accountVMs.push({
      resourceId: acc.resourceId,
      label,
      ...(def?.icon ? { icon: def.icon } : {}),
      displayUnit: unit,
      balanceMinor,
      balanceFormatted,
      reservedMinor,
      reservedFormatted,
      availableMinor,
      availableFormatted,
      effectiveCapacityMinor,
      capacityFormatted,
      capacityPercentage,
      isSecret: acc.visibility === "secret",
      statusBadgeClass
    });
  }

  // Ledger history (sanitized)
  const ledgerVMs: LedgerEntryViewModel[] = [];
  if (options.ledgerStore) {
    const rawEntries = options.ledgerStore.query({ domainUuid, limit: 20 });
    const visibleResourceIds = new Set(accountVMs.map((a) => a.resourceId));

    for (const entry of rawEntries) {
      // Non-GM viewers only see ledger entries for accounts they can see
      if (!options.viewerIsGm && !visibleResourceIds.has(entry.resourceId)) {
        continue;
      }

      const def = options.resourceRegistry.get(entry.resourceId);
      const label = def?.label ?? entry.resourceId;
      const precision = def?.precision ?? 0;
      const unit = def?.displayUnit?.singular ?? "";
      const resDef: ResourceDefinition = def ?? {
        id: entry.resourceId,
        version: 1,
        label,
        description: "",
        icon: "",
        categoryId: "custom",
        tags: [],
        precision,
        displayUnit: { singular: unit, plural: unit },
        minimumMinor: 0,
        maximumMinor: null,
        allowNegative: false,
        defaultCapacityPolicy: "block",
        lifecycle: "active"
      };

      const deltaFormatted =
        (entry.deltaMinor > 0 ? "+" : "") +
        formatResourceAmount(entry.deltaMinor, resDef, { showUnit: true });

      ledgerVMs.push({
        id: entry.id,
        timestampFormatted: new Date(entry.timestampReal).toLocaleTimeString(),
        kind: entry.kind,
        deltaFormatted,
        deltaClass: entry.deltaMinor >= 0 ? "positive" : "negative",
        reason: entry.source?.reason,
        resourceLabel: def?.label ?? entry.resourceId
      });
    }
  }

  return {
    domainUuid,
    viewerIsGm: options.viewerIsGm,
    accounts: Object.freeze(accountVMs),
    recentLedger: Object.freeze(ledgerVMs)
  };
}
