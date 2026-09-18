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
import type { ProviderHealth } from "../../../economy/providers/provider-types.js";
import type { TransactionStore } from "../../../mutations/transaction-store.js";
import { EconomyProjectionService } from "../../../economy/projection/economy-projection-service.js";
import type { ViewerIdentity } from "../../../projection/viewer-identity.js";

export interface EconomyPresenterOptions {
  readonly viewerIsGm?: boolean;
  readonly viewer?: Partial<ViewerIdentity>;
  readonly resourceRegistry: ResourceDefinitionRegistry;
  readonly ledgerStore?: LedgerStore;
  readonly reservationStore?: ReservationStore;
  readonly providerRegistry?: ProviderRegistry;
  readonly providerHealthMap?: ReadonlyMap<string, ProviderHealth>;
  readonly transactionStore?: TransactionStore;
  readonly ledgerPage?: number;
  readonly ledgerPageSize?: number;
}

export interface ProviderStatusViewModel {
  readonly providerId: string;
  readonly status: "healthy" | "degraded" | "unavailable" | "incompatible";
  readonly statusBadgeClass: "badge--healthy" | "badge--degraded" | "badge--unavailable" | "badge--incompatible";
  readonly lastCheckedAt?: number;
  readonly lastCheckedFormatted?: string;
  readonly message?: string;
}

export interface TransactionItemViewModel {
  readonly transactionId: string;
  readonly commandId: string;
  readonly state: string;
  readonly authorityEpoch: number;
  readonly lockKeys: readonly string[];
  readonly createdAtFormatted: string;
  readonly stateBadgeClass: "committed" | "compensated" | "failed" | "in-flight";
  readonly reason?: string;
  readonly failureReason?: string;
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
  readonly providerStatus?: "healthy" | "degraded" | "unavailable" | "incompatible";
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
  readonly providerStatuses: readonly ProviderStatusViewModel[];
  readonly transactions: readonly TransactionItemViewModel[];
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

  const projectionService = new EconomyProjectionService();
  const viewer: ViewerIdentity = options.viewer
    ? projectionService.resolveViewer(options.viewer)
    : projectionService.resolveViewer({ isGm: options.viewerIsGm ?? false });

  const accountVMs: ResourceAccountViewModel[] = [];

  for (const acc of economyData.accounts) {
    // Canonical projection: Evaluates public, secret, and restricted clearance
    if (!projectionService.isAccountVisible(acc, viewer)) {
      continue;
    }

    const def = options.resourceRegistry.get(acc.resourceId);
    const label = def?.label ?? acc.resourceId;
    const precision = def?.precision ?? 0;
    const unit = def?.displayUnit?.singular ?? def?.displayUnit?.abbreviation ?? "";

    const isClosed = acc.status === "closed";
    let balanceMinor = acc.mode === "native" ? acc.balanceMinor : 0;
    let providerAvailable = true;
    let providerStatus: "healthy" | "degraded" | "unavailable" | "incompatible" | undefined = undefined;

    if (acc.mode === "provider") {
      const health = options.providerHealthMap?.get(acc.providerId);
      if (health) {
        providerStatus = health.status;
        providerAvailable = health.status === "healthy" || health.status === "degraded";
      } else {
        providerAvailable = Boolean(options.providerRegistry?.has(acc.providerId));
        providerStatus = providerAvailable ? "healthy" : "unavailable";
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
      providerStatus: acc.mode === "provider" ? providerStatus : undefined,
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
      if (!viewer.isGm && !visibleResourceIds.has(r.resourceId)) {
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
        reason: viewer.isGm ? r.source.reason : undefined,
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
      viewer.isGm || visibleResourceIds.has(entry.resourceId)
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
        reason: viewer.isGm ? entry.source?.reason : undefined,
        resourceLabel: def?.label ?? entry.resourceId
      });
    }
  }

  // Provider statuses with real health queries (G4-REVAL4-004)
  const providerStatuses: ProviderStatusViewModel[] = [];
  if (options.providerRegistry) {
    for (const provider of options.providerRegistry.list()) {
      const health = options.providerHealthMap?.get(provider.providerId);
      const status = health?.status ?? "healthy";
      providerStatuses.push({
        providerId: provider.providerId,
        status,
        statusBadgeClass: `badge--${status}` as const,
        lastCheckedAt: health?.lastCheckedAt,
        lastCheckedFormatted: health?.lastCheckedAt
          ? new Date(health.lastCheckedAt).toLocaleTimeString()
          : undefined,
        message: health?.message
      });
    }
  }

  // Transaction history for domain (G4-REVAL4-004)
  const transactionVMs: TransactionItemViewModel[] = [];
  if (options.transactionStore) {
    let rawTxs = options.transactionStore.listAll();
    rawTxs = rawTxs.filter((tx) => {
      if (tx.lockKeys.some((k) => k.includes(domainUuid))) return true;
      if (tx.recoveryData && typeof tx.recoveryData === "object") {
        const rec = tx.recoveryData as any;
        return (
          rec.domainUuid === domainUuid ||
          rec.sourceDomainUuid === domainUuid ||
          rec.targetDomainUuid === domainUuid
        );
      }
      return false;
    });

    for (const tx of rawTxs) {
      // G4-REVAL5-003: Check resource visibility for non-GM
      if (!viewer.isGm && tx.recoveryData && typeof tx.recoveryData === "object") {
        const rec = tx.recoveryData as any;
        const resIds: string[] = [];
        if (rec.resourceId) resIds.push(rec.resourceId);
        if (rec.fromResourceId) resIds.push(rec.fromResourceId);
        if (rec.toResourceId) resIds.push(rec.toResourceId);

        if (resIds.length > 0) {
          const hasVisibleResource = resIds.some((rId) => visibleResourceIds.has(rId));
          if (!hasVisibleResource) {
            continue; // Skip secret-resource transactions
          }
        }
      }

      const lastTransition = tx.history[tx.history.length - 1];
      let stateBadgeClass: TransactionItemViewModel["stateBadgeClass"] = "in-flight";
      if (tx.state === "committed") stateBadgeClass = "committed";
      else if (tx.state === "compensated") stateBadgeClass = "compensated";
      else if (tx.state === "failed") stateBadgeClass = "failed";

      let reason: string | undefined = undefined;
      if (tx.recoveryData && typeof tx.recoveryData === "object") {
        reason = viewer.isGm ? (tx.recoveryData as any).reason : undefined;
      }

      const lockKeys = viewer.isGm
        ? tx.lockKeys
        : tx.lockKeys.filter((k) => k.includes(domainUuid));

      const failureReason = viewer.isGm
        ? lastTransition?.reason
        : (tx.state === "failed" ? "Transaction failed" : undefined);

      transactionVMs.push({
        transactionId: tx.transactionId,
        commandId: tx.commandId,
        state: tx.state,
        authorityEpoch: tx.authorityEpoch,
        lockKeys: Object.freeze(lockKeys),
        createdAtFormatted: new Date(tx.createdAt).toLocaleTimeString(),
        stateBadgeClass,
        reason,
        failureReason
      });
    }
  }

  return {
    domainUuid,
    viewerIsGm: viewer.isGm,
    accounts: Object.freeze(accountVMs),
    reservations: Object.freeze(reservationVMs),
    recentLedger: Object.freeze(ledgerVMs),
    providerStatuses: Object.freeze(providerStatuses),
    transactions: Object.freeze(transactionVMs),
    ledgerPage,
    ledgerTotalCount,
    ledgerHasMore,
    ledgerHasPrev
  };
}
