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

import type { ProviderRegistry } from "../../../economy/providers/provider-registry.js";

export interface EconomyPresenterOptions {
  readonly viewerIsGm: boolean;
  readonly resourceRegistry: ResourceDefinitionRegistry;
  readonly ledgerStore?: LedgerStore;
  readonly reservationStore?: ReservationStore;
  readonly providerRegistry?: ProviderRegistry;
  readonly ledgerPage?: number;
  readonly ledgerPageSize?: number;
}

export interface ResourceAccountViewModel {
  readonly resourceId: string;
  readonly label: string;
  readonly icon?: string;
  readonly displayUnit?: string;
  readonly precision: number;
  readonly mode: "native" | "derived" | "provider";
  readonly status: "active" | "closed";
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
  readonly statusBadgeClass: "normal" | "near-capacity" | "over-capacity" | "low-reserve" | "closed";
  readonly providerId?: string;
  readonly providerAvailable?: boolean;
  readonly description?: string;
  readonly categoryId?: string;
  readonly tags?: readonly string[];
}

export interface ReservationItemViewModel {
  readonly id: string;
  readonly resourceId: string;
  readonly resourceLabel: string;
  readonly amountMinor: number;
  readonly amountFormatted: string;
  readonly status: string;
  readonly reason?: string;
  readonly expiresAtFormatted?: string;
  readonly canRelease: boolean;
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
  readonly reservations: readonly ReservationItemViewModel[];
  readonly recentLedger: readonly LedgerEntryViewModel[];
  readonly ledgerPage: number;
  readonly ledgerTotalCount: number;
  readonly ledgerHasMore: boolean;
  readonly ledgerHasPrev: boolean;
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

    const isClosed = acc.status === "closed";
    let balanceMinor = acc.mode === "native" ? acc.balanceMinor : 0;
    let providerAvailable = true;

    if (acc.mode === "provider") {
      if (options.providerRegistry?.has(acc.providerId)) {
        // Provider registered
        providerAvailable = true;
      } else {
        providerAvailable = false;
      }
    }

    const reservedMinor = options.reservationStore
      ? options.reservationStore.getReservedTotal(domainUuid, acc.resourceId)
      : 0;
    const availableMinor = balanceMinor - reservedMinor;

    const baseCap = acc.mode === "native" ? acc.baseCapacityMinor : null;
    const effectiveCap = resolveEffectiveCapacity(baseCap, [], def);
    const effectiveCapacityMinor = effectiveCap.effectiveCapacityMinor;

    let capacityPercentage: number | null = null;
    let statusBadgeClass: ResourceAccountViewModel["statusBadgeClass"] = "normal";

    if (isClosed) {
      statusBadgeClass = "closed";
    } else {
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

    let balanceFormatted: string;
    if (acc.mode === "provider" && !providerAvailable) {
      balanceFormatted = "Provider Unavailable";
    } else if (acc.mode === "provider") {
      balanceFormatted = "External Sync";
    } else {
      balanceFormatted = formatResourceAmount(balanceMinor, resDef, { showUnit: true });
    }

    const reservedFormatted = formatResourceAmount(reservedMinor, resDef, { showUnit: true });
    const availableFormatted =
      acc.mode === "native"
        ? formatResourceAmount(availableMinor, resDef, { showUnit: true })
        : balanceFormatted;
    const capacityFormatted =
      effectiveCapacityMinor !== null
        ? formatResourceAmount(effectiveCapacityMinor, resDef, { showUnit: true })
        : "Unlimited";

    accountVMs.push({
      resourceId: acc.resourceId,
      label,
      ...(def?.icon ? { icon: def.icon } : {}),
      displayUnit: unit,
      precision,
      mode: acc.mode,
      status: acc.status === "closed" ? "closed" : "active",
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
      statusBadgeClass,
      providerId: acc.mode === "provider" ? acc.providerId : undefined,
      providerAvailable: acc.mode === "provider" ? providerAvailable : undefined,
      description: def?.description,
      categoryId: def?.categoryId ?? undefined,
      tags: def?.tags
    });
  }

  const visibleResourceIds = new Set(accountVMs.map((a) => a.resourceId));

  // Active reservations (sanitized)
  const reservationVMs: ReservationItemViewModel[] = [];
  if (options.reservationStore) {
    const rawReservations = options.reservationStore.list({ domainUuid });
    for (const r of rawReservations) {
      if (r.status !== "active" && r.status !== "partially-consumed") {
        continue;
      }
      if (!options.viewerIsGm && !visibleResourceIds.has(r.resourceId)) {
        continue;
      }

      const def = options.resourceRegistry.get(r.resourceId);
      const resDef: ResourceDefinition = def ?? {
        id: r.resourceId,
        version: 1,
        label: r.resourceId,
        description: "",
        icon: "",
        categoryId: "custom",
        tags: [],
        precision: 0,
        displayUnit: { singular: "", plural: "" },
        minimumMinor: 0,
        maximumMinor: null,
        allowNegative: false,
        defaultCapacityPolicy: "block",
        lifecycle: "active"
      };

      reservationVMs.push({
        id: r.id,
        resourceId: r.resourceId,
        resourceLabel: def?.label ?? r.resourceId,
        amountMinor: r.remainingAmountMinor,
        amountFormatted: formatResourceAmount(r.remainingAmountMinor, resDef, { showUnit: true }),
        status: r.status,
        reason: r.source.reason,
        expiresAtFormatted: r.expiresAtReal ? new Date(r.expiresAtReal).toLocaleTimeString() : undefined,
        canRelease: true
      });
    }
  }

  // Ledger history (sanitized, paginated descending - G4-AUD-009)
  const ledgerVMs: LedgerEntryViewModel[] = [];
  const ledgerPage = Math.max(0, options.ledgerPage ?? 0);
  const ledgerPageSize = Math.max(1, options.ledgerPageSize ?? 20);
  let ledgerTotalCount = 0;
  let ledgerHasMore = false;
  let ledgerHasPrev = ledgerPage > 0;

  if (options.ledgerStore) {
    const allEntries = options.ledgerStore.query({ domainUuid, direction: "desc" });
    const filteredEntries = allEntries.filter((entry) =>
      options.viewerIsGm || visibleResourceIds.has(entry.resourceId)
    );

    ledgerTotalCount = filteredEntries.length;
    ledgerHasMore = (ledgerPage + 1) * ledgerPageSize < ledgerTotalCount;
    ledgerHasPrev = ledgerPage > 0;

    const pagedEntries = filteredEntries.slice(
      ledgerPage * ledgerPageSize,
      (ledgerPage + 1) * ledgerPageSize
    );

    for (const entry of pagedEntries) {
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
    reservations: Object.freeze(reservationVMs),
    recentLedger: Object.freeze(ledgerVMs),
    ledgerPage,
    ledgerTotalCount,
    ledgerHasMore,
    ledgerHasPrev
  };
}
