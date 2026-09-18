import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { CommandBus } from "../../commands/command-bus.js";
import type { TransportReceipt, TransportSendOptions } from "../../commands/command-transport.js";
import {
  COMMAND_CONTRACT_VERSION_V1,
  type CommandId,
  type DomainCommand
} from "../../commands/command-envelope.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import type { DomainReadRepository } from "../../storage/repositories/domain-repository.js";
import type { ResourceDefinitionRegistry } from "../definitions/resource-registry.js";
import type { LedgerStore, LedgerFilter } from "../ledger/ledger-store.js";
import type { ReservationStore, ReservationFilter } from "../reservations/reservation-store.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";
import type { ProviderHealth } from "../providers/provider-types.js";
import {
  EconomyProjectionService,
  type EconomyContextDto,
  type LedgerEntryDto,
  type ReservationDto,
  type ResourceAccountDto
} from "../projection/economy-projection-service.js";
import {
  EconomyAggregationProvider,
  type EconomyAggregateContextDto
} from "../aggregation/economy-aggregation-provider.js";
import type { ViewerIdentity } from "../../projection/viewer-identity.js";
import { tryGetDomainEconomyData } from "../economy-data.js";
import { resolveEffectiveCapacity } from "../accounts/capacity-resolver.js";
import type {
  ResourceAdjustCommandPayload,
  ResourceCloseAccountCommandPayload,
  ResourceConsumeReservationCommandPayload,
  ResourceConvertCommandPayload,
  ResourceCreateAccountCommandPayload,
  ResourceReleaseReservationCommandPayload,
  ResourceReserveCommandPayload,
  ResourceReversalCommandPayload,
  ResourceSetThresholdCommandPayload,
  ResourceTransferCommandPayload
} from "../commands/economy-commands.js";
import type {
  ThresholdService,
  ThresholdDefinition,
  ThresholdStatus
} from "../thresholds/threshold-service.js";
import type { DerivedAccountResolver } from "./economy-service.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import type { TransactionRecord, TransactionState } from "../../mutations/transaction-record.js";

function toTransactionDto(
  tx: TransactionRecord,
  viewer: ViewerIdentity,
  accessibleDomains?: ReadonlySet<string>
): TransactionRecordDto {
  const lastTransition = tx.history[tx.history.length - 1];
  if (viewer.isGm) {
    return {
      transactionId: tx.transactionId,
      commandId: tx.commandId,
      authorityEpoch: tx.authorityEpoch,
      state: tx.state,
      lockKeys: tx.lockKeys,
      createdAtReal: tx.createdAt,
      updatedAtReal: tx.updatedAt,
      failureReason: lastTransition?.reason
    };
  }

  const sanitizedLocks = tx.lockKeys.filter((k) => {
    if (!accessibleDomains) return true;
    for (const d of accessibleDomains) {
      if (k.includes(d)) return true;
    }
    return false;
  });

  return {
    transactionId: tx.transactionId,
    commandId: tx.commandId,
    authorityEpoch: tx.authorityEpoch,
    state: tx.state,
    lockKeys: Object.freeze(sanitizedLocks),
    createdAtReal: tx.createdAt,
    updatedAtReal: tx.updatedAt,
    failureReason: tx.state === "failed" ? "Transaction failed" : undefined
  };
}

export interface PagedLedgerResultDto {
  readonly entries: readonly LedgerEntryDto[];
  readonly totalCount: number;
  readonly hasMore: boolean;
  readonly nextCursor?: string;
  readonly prevCursor?: string;
}

export interface TransactionRecordDto {
  readonly transactionId: string;
  readonly commandId: string;
  readonly authorityEpoch: number;
  readonly state: TransactionState;
  readonly lockKeys: readonly string[];
  readonly createdAtReal: number;
  readonly updatedAtReal: number;
  readonly failureReason?: string;
}

export interface PublicEconomyApi {
  getContext(domainUuid: string, viewer?: Partial<ViewerIdentity>): Promise<Result<EconomyContextDto, PublicError>>;
  getResource(domainUuid: string, resourceId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<ResourceAccountDto, PublicError>>;
  getAccount(domainUuid: string, resourceId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<ResourceAccountDto | undefined, PublicError>>;
  getAccountAvailability(domainUuid: string, resourceId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<{ balanceMinor: number; availableMinor: number; reservedMinor: number; capacityMinor: number | null } | undefined, PublicError>>;
  queryLedger(filter: LedgerFilter, viewer?: Partial<ViewerIdentity>): Promise<Result<PagedLedgerResultDto, PublicError>>;
  getReservation(reservationId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<ReservationDto, PublicError>>;
  queryReservations(filter: ReservationFilter, viewer?: Partial<ViewerIdentity>): Promise<Result<readonly ReservationDto[], PublicError>>;
  getProviderHealth(providerId?: string): Promise<Result<readonly ProviderHealth[], PublicError>>;
  getAggregateContext(domainUuids: readonly string[], viewer?: Partial<ViewerIdentity>): Promise<Result<EconomyAggregateContextDto, PublicError>>;

  // Threshold queries and command dispatch
  setThreshold(payload: ResourceSetThresholdCommandPayload, options?: TransportSendOptions): Promise<Result<TransportReceipt, PublicError>>;
  listThresholds(domainUuid?: string, resourceId?: string): readonly ThresholdDefinition[];
  evaluateThresholds(domainUuid: string, resourceId: string): Promise<Result<ThresholdStatus, PublicError>>;

  // Transaction history queries
  getTransaction(transactionId: string, viewer?: Partial<ViewerIdentity>): Promise<Result<TransactionRecordDto | undefined, PublicError>>;
  listTransactions(filter?: { domainUuid?: string; state?: TransactionState }, viewer?: Partial<ViewerIdentity>): Promise<Result<readonly TransactionRecordDto[], PublicError>>;

  // Safe semantic mutation helpers (strictly dispatched via CommandBus)
  adjust(payload: ResourceAdjustCommandPayload, options?: TransportSendOptions): Promise<Result<TransportReceipt, PublicError>>;
  transfer(payload: ResourceTransferCommandPayload, options?: TransportSendOptions): Promise<Result<TransportReceipt, PublicError>>;
  convert(payload: ResourceConvertCommandPayload, options?: TransportSendOptions): Promise<Result<TransportReceipt, PublicError>>;
  reserve(payload: ResourceReserveCommandPayload, options?: TransportSendOptions): Promise<Result<TransportReceipt, PublicError>>;
  consumeReservation(payload: ResourceConsumeReservationCommandPayload, options?: TransportSendOptions): Promise<Result<TransportReceipt, PublicError>>;
  releaseReservation(payload: ResourceReleaseReservationCommandPayload, options?: TransportSendOptions): Promise<Result<TransportReceipt, PublicError>>;
  createAccount(payload: ResourceCreateAccountCommandPayload, options?: TransportSendOptions): Promise<Result<TransportReceipt, PublicError>>;
  closeAccount(payload: ResourceCloseAccountCommandPayload, options?: TransportSendOptions): Promise<Result<TransportReceipt, PublicError>>;
  reversal(payload: ResourceReversalCommandPayload, options?: TransportSendOptions): Promise<Result<TransportReceipt, PublicError>>;
}

export interface DefaultPublicEconomyApiOptions {
  readonly domains: DomainReadRepository;
  readonly commandBus: CommandBus;
  readonly resourceRegistry: ResourceDefinitionRegistry;
  readonly ledgerStore: LedgerStore;
  readonly reservationStore: ReservationStore;
  readonly providerRegistry?: ProviderRegistry;
  readonly projectionService?: EconomyProjectionService;
  readonly aggregationProvider?: EconomyAggregationProvider;
  readonly thresholdService?: ThresholdService;
  readonly derivedResolvers?: Map<string, DerivedAccountResolver>;
  readonly transactionStore?: TransactionStore;
}

export class DefaultPublicEconomyApi implements PublicEconomyApi {
  readonly #domains: DomainReadRepository;
  readonly #commandBus: CommandBus;
  readonly #resourceRegistry: ResourceDefinitionRegistry;
  readonly #ledgerStore: LedgerStore;
  readonly #reservationStore: ReservationStore;
  readonly #providerRegistry?: ProviderRegistry;
  readonly #projection: EconomyProjectionService;
  readonly #aggregation: EconomyAggregationProvider;
  readonly #thresholdService?: ThresholdService;
  readonly #derivedResolvers?: Map<string, DerivedAccountResolver>;
  readonly #transactionStore?: TransactionStore;

  constructor(options: DefaultPublicEconomyApiOptions) {
    this.#domains = options.domains;
    this.#commandBus = options.commandBus;
    this.#resourceRegistry = options.resourceRegistry;
    this.#ledgerStore = options.ledgerStore;
    this.#reservationStore = options.reservationStore;
    this.#providerRegistry = options.providerRegistry;
    this.#thresholdService = options.thresholdService;
    this.#derivedResolvers = options.derivedResolvers;
    this.#transactionStore = options.transactionStore;
    this.#projection = options.projectionService ?? new EconomyProjectionService();
    this.#aggregation =
      options.aggregationProvider ??
      new EconomyAggregationProvider({
        domains: options.domains,
        resourceRegistry: options.resourceRegistry,
        reservationStore: options.reservationStore,
        providerRegistry: options.providerRegistry,
        derivedResolvers: options.derivedResolvers,
        projectionService: this.#projection
      });
  }

  async setThreshold(
    payload: ResourceSetThresholdCommandPayload,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    return this.#dispatchCommand("economy:set-threshold", payload, options);
  }

  async #projectTransaction(
    tx: TransactionRecord,
    viewer: ViewerIdentity
  ): Promise<TransactionRecordDto | null> {
    if (viewer.isGm) {
      return toTransactionDto(tx, viewer);
    }

    const rec = tx.recoveryData && typeof tx.recoveryData === "object" ? (tx.recoveryData as any) : null;
    const directDomainUuid: string | undefined = rec?.domainUuid;
    const sourceDomainUuid: string | undefined = rec?.sourceDomainUuid;
    const targetDomainUuid: string | undefined = rec?.targetDomainUuid;

    const candidateDomains: string[] = [];
    if (directDomainUuid) candidateDomains.push(directDomainUuid);
    if (sourceDomainUuid) candidateDomains.push(sourceDomainUuid);
    if (targetDomainUuid) candidateDomains.push(targetDomainUuid);
    if (candidateDomains.length === 0) {
      for (const k of tx.lockKeys) {
        if (k.startsWith("domain:")) candidateDomains.push(k.slice("domain:".length));
        else if (k.startsWith("JournalEntry.")) candidateDomains.push(k);
      }
    }

    const accessibleDomains = new Set<string>();
    for (const d of candidateDomains) {
      const cleanId = d.startsWith("JournalEntry.") ? d.slice("JournalEntry.".length) : d;
      const docRes = await this.#domains.read(cleanId);
      if (docRes.ok) {
        const doc = docRes.value as any;
        const ownership = doc.ownership as Record<string, number> | undefined;
        const userLevel = ownership ? (viewer.userId ? (ownership[viewer.userId] ?? ownership.default ?? 0) : (ownership.default ?? 0)) : 0;
        if (userLevel >= 1) {
          accessibleDomains.add(cleanId);
          accessibleDomains.add(d);
          accessibleDomains.add(docRes.value.uuid);
        }
      }
    }

    if (accessibleDomains.size === 0) {
      return null;
    }

    // Check resource visibility in accessible domain(s)
    const resourceIds: string[] = [];
    if (rec?.resourceId) resourceIds.push(rec.resourceId);
    if (rec?.fromResourceId) resourceIds.push(rec.fromResourceId);
    if (rec?.toResourceId) resourceIds.push(rec.toResourceId);

    if (resourceIds.length > 0) {
      let anyResourceVisible = false;
      for (const d of accessibleDomains) {
        const cleanId = d.startsWith("JournalEntry.") ? d.slice("JournalEntry.".length) : d;
        const docRes = await this.#domains.read(cleanId);
        if (docRes.ok) {
          const econRes = tryGetDomainEconomyData(docRes.value.record);
          if (econRes.ok) {
            for (const resId of resourceIds) {
              const acc = econRes.value.accounts.find((a) => a.resourceId === resId);
              if (acc && this.#projection.isAccountVisible(acc, viewer)) {
                anyResourceVisible = true;
                break;
              }
            }
          }
        }
        if (anyResourceVisible) break;
      }

      if (!anyResourceVisible) {
        return null;
      }
    }

    return toTransactionDto(tx, viewer, accessibleDomains);
  }

  async getTransaction(
    transactionId: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<TransactionRecordDto | undefined, PublicError>> {
    if (!this.#transactionStore) {
      return ok(undefined);
    }
    const viewer = this.#projection.resolveViewer(callerViewer);
    const tx = this.#transactionStore.get(transactionId);
    if (!tx) {
      return ok(undefined);
    }

    const projected = await this.#projectTransaction(tx, viewer);
    if (!projected) {
      if (!viewer.isGm) {
        return err(
          createPublicError({
            code: "DM_SECURITY_PERMISSION_DENIED",
            category: "permission",
            message: "Permission denied for transaction"
          })
        );
      }
      return ok(undefined);
    }

    return ok(projected);
  }

  async listTransactions(
    filter?: { domainUuid?: string; state?: TransactionState },
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<readonly TransactionRecordDto[], PublicError>> {
    if (!this.#transactionStore) {
      return ok(Object.freeze([]));
    }
    const viewer = this.#projection.resolveViewer(callerViewer);
    let list = this.#transactionStore.listAll();

    if (filter?.state) {
      list = list.filter((tx) => tx.state === filter.state);
    }

    if (filter?.domainUuid) {
      const cleanFilter = filter.domainUuid.startsWith("JournalEntry.")
        ? filter.domainUuid.slice("JournalEntry.".length)
        : filter.domainUuid;
      list = list.filter((tx) => {
        if (tx.lockKeys.some((k) => k.includes(cleanFilter))) {
          return true;
        }
        if (tx.recoveryData && typeof tx.recoveryData === "object") {
          const rec = tx.recoveryData as any;
          return (
            rec.domainUuid === filter.domainUuid ||
            rec.domainUuid === cleanFilter ||
            rec.sourceDomainUuid === filter.domainUuid ||
            rec.sourceDomainUuid === cleanFilter ||
            rec.targetDomainUuid === filter.domainUuid ||
            rec.targetDomainUuid === cleanFilter
          );
        }
        return false;
      });
    }

    const allowed: TransactionRecordDto[] = [];
    for (const tx of list) {
      const proj = await this.#projectTransaction(tx, viewer);
      if (proj) {
        allowed.push(proj);
      }
    }
    return ok(Object.freeze(allowed));
  }

  listThresholds(domainUuid?: string, resourceId?: string): readonly ThresholdDefinition[] {
    return this.#thresholdService ? this.#thresholdService.listThresholds(domainUuid, resourceId) : [];
  }

  async evaluateThresholds(
    domainUuid: string,
    resourceId: string
  ): Promise<Result<ThresholdStatus, PublicError>> {
    if (!this.#thresholdService) {
      return err(
        createPublicError({
          code: "DM_ECON_THRESHOLD_SERVICE_UNAVAILABLE",
          category: "internal",
          message: "Threshold service is not configured"
        })
      );
    }
    const availRes = await this.getAccountAvailability(domainUuid, resourceId);
    if (!availRes.ok) return availRes;
    if (!availRes.value) {
      return err(
        createPublicError({
          code: "DM_ECON_ACCOUNT_NOT_FOUND",
          category: "not-found",
          message: `Account '${resourceId}' in domain '${domainUuid}' not found`
        })
      );
    }
    const status = this.#thresholdService.evaluateStatus(domainUuid, resourceId, {
      balanceMinor: availRes.value.balanceMinor,
      availableMinor: availRes.value.availableMinor,
      capacityMinor: availRes.value.capacityMinor
    });
    return ok(status);
  }

  async getContext(
    domainUuid: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<EconomyContextDto, PublicError>> {
    const viewer = this.#projection.resolveViewer(callerViewer);
    const docRes = await this.#domains.read(domainUuid);
    if (!docRes.ok) return docRes;

    const econRes = tryGetDomainEconomyData(docRes.value.record);
    if (!econRes.ok) return econRes;

    const accounts: ResourceAccountDto[] = [];
    const visibleResourceIds = new Set<string>();

    for (const acc of econRes.value.accounts) {
      if (!this.#projection.isAccountVisible(acc, viewer)) {
        continue;
      }
      visibleResourceIds.add(acc.resourceId);

      const def = this.#resourceRegistry.get(acc.resourceId);
      const reserved = this.#reservationStore.getReservedTotal(domainUuid, acc.resourceId);
      let balance = acc.mode === "native" ? acc.balanceMinor : 0;
      let capacity: number | null = acc.mode === "native" ? acc.baseCapacityMinor : null;
      let isStale = false;
      let isUnavailable = false;

      if (acc.mode === "provider" && this.#providerRegistry) {
        const provider = this.#providerRegistry.get(acc.providerId);
        if (provider && "readBalance" in provider) {
          const balRes = await (provider as any).readBalance(domainUuid, acc.resourceId, acc.providerRef);
          if (balRes?.ok) {
            balance = balRes.value.balanceMinor;
            capacity = balRes.value.effectiveCapacityMinor ?? capacity;
            isStale = Boolean(balRes.value.isStale);
          } else {
            isUnavailable = true;
          }
        } else {
          isUnavailable = true;
        }
      }

      if (acc.mode === "derived") {
        let resolved = false;
        if (this.#derivedResolvers) {
          const resolver = this.#derivedResolvers.get(acc.resolverId);
          if (resolver) {
            const res = await resolver(domainUuid, acc);
            if (res.ok) {
              balance = res.value.balanceMinor;
              isStale = Boolean(res.value.isStale);
              resolved = true;
            }
          }
        }
        if (!resolved) {
          isUnavailable = true;
        }
      }

      const projected = this.#projection.projectAccount(acc, def, reserved, viewer, {
        balanceMinor: balance,
        capacityMinor: capacity,
        isStale,
        isUnavailable
      });

      if (projected) {
        accounts.push(projected);
      }
    }

    // Project recent ledger entries (newest first)
    const rawLedger = this.#ledgerStore.query({
      domainUuid,
      direction: "desc",
      limit: 20
    });
    const recentLedger: LedgerEntryDto[] = [];
    for (const entry of rawLedger) {
      const proj = this.#projection.projectLedgerEntry(entry, visibleResourceIds, viewer);
      if (proj) recentLedger.push(proj);
    }

    // Project active reservations
    const rawReservations = this.#reservationStore.list({ domainUuid, status: "active" });
    const activeReservations: ReservationDto[] = [];
    for (const r of rawReservations) {
      const proj = this.#projection.projectReservation(r, visibleResourceIds, viewer);
      if (proj) activeReservations.push(proj);
    }

    return ok({
      domainUuid,
      accounts: Object.freeze(accounts),
      recentLedger: Object.freeze(recentLedger),
      activeReservations: Object.freeze(activeReservations),
      isGmView: viewer.isGm,
      projectedAt: Date.now()
    });
  }

  async getResource(
    domainUuid: string,
    resourceId: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<ResourceAccountDto, PublicError>> {
    const ctxRes = await this.getContext(domainUuid, callerViewer);
    if (!ctxRes.ok) return ctxRes;

    const acc = ctxRes.value.accounts.find((a) => a.resourceId === resourceId);
    if (!acc) {
      return err(
        createPublicError({
          code: "DM_ECON_ACCOUNT_NOT_FOUND",
          category: "not-found",
          message: `Resource account '${resourceId}' not found in domain '${domainUuid}'`
        })
      );
    }

    return ok(acc);
  }

  async getAccount(
    domainUuid: string,
    resourceId: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<ResourceAccountDto | undefined, PublicError>> {
    const ctxRes = await this.getContext(domainUuid, callerViewer);
    if (!ctxRes.ok) return ctxRes;
    const acc = ctxRes.value.accounts.find((a) => a.resourceId === resourceId);
    return ok(acc);
  }

  async getAccountAvailability(
    domainUuid: string,
    resourceId: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<
    Result<
      | {
          balanceMinor: number;
          availableMinor: number;
          reservedMinor: number;
          capacityMinor: number | null;
        }
      | undefined,
      PublicError
    >
  > {
    const accRes = await this.getAccount(domainUuid, resourceId, callerViewer);
    if (!accRes.ok) return accRes;
    if (!accRes.value) return ok(undefined);
    return ok({
      balanceMinor: accRes.value.balanceMinor,
      availableMinor: accRes.value.availableMinor,
      reservedMinor: accRes.value.reservedMinor,
      capacityMinor: accRes.value.capacityMinor
    });
  }

  async queryLedger(
    filter: LedgerFilter,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<PagedLedgerResultDto, PublicError>> {
    const viewer = this.#projection.resolveViewer(callerViewer);
    const visibleDomainResourceKeys = new Set<string>();

    if (filter.domainUuid) {
      const cleanId = filter.domainUuid.startsWith("JournalEntry.")
        ? filter.domainUuid.slice("JournalEntry.".length)
        : filter.domainUuid;
      const docRes = await this.#domains.read(cleanId);
      if (docRes.ok) {
        const econRes = tryGetDomainEconomyData(docRes.value.record);
        if (econRes.ok) {
          for (const acc of econRes.value.accounts) {
            if (this.#projection.isAccountVisible(acc, viewer)) {
              visibleDomainResourceKeys.add(`${cleanId}:${acc.resourceId}`);
              visibleDomainResourceKeys.add(`JournalEntry.${cleanId}:${acc.resourceId}`);
              visibleDomainResourceKeys.add(`${docRes.value.uuid}:${acc.resourceId}`);
            }
          }
        }
      }
    } else {
      const allDocsRes = this.#domains.query();
      if (allDocsRes.ok) {
        for (const doc of allDocsRes.value) {
          const cleanId = doc.id;
          const econRes = tryGetDomainEconomyData(doc.record);
          if (econRes.ok) {
            for (const acc of econRes.value.accounts) {
              if (this.#projection.isAccountVisible(acc, viewer)) {
                visibleDomainResourceKeys.add(`${cleanId}:${acc.resourceId}`);
                visibleDomainResourceKeys.add(`JournalEntry.${cleanId}:${acc.resourceId}`);
                visibleDomainResourceKeys.add(`${doc.uuid}:${acc.resourceId}`);
              }
            }
          }
        }
      }
    }

    // G4-REVAL5-002: If not GM, strictly constrain queryPaged via allowedDomainResourceKeys so that
    // totalCount, hasMore, and cursors are computed ONLY over visible domain:resource pairs, preventing
    // secret accounts sharing a resource ID with another domain from leaking counts or existence.
    const storeFilter: LedgerFilter = viewer.isGm
      ? filter
      : {
          ...filter,
          allowedDomainResourceKeys: visibleDomainResourceKeys
        };

    const paged = this.#ledgerStore.queryPaged(storeFilter);

    const projected: LedgerEntryDto[] = [];
    for (const entry of paged.entries) {
      const proj = this.#projection.projectLedgerEntry(entry, visibleDomainResourceKeys, viewer);
      if (proj) projected.push(proj);
    }

    return ok({
      entries: Object.freeze(projected),
      totalCount: paged.totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
      prevCursor: paged.prevCursor
    });
  }

  async getReservation(
    reservationId: string,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<ReservationDto, PublicError>> {
    const viewer = this.#projection.resolveViewer(callerViewer);
    const r = this.#reservationStore.get(reservationId);
    if (!r) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "not-found",
          message: `Reservation '${reservationId}' not found`
        })
      );
    }

    // Resolve domain and check account visibility (G4-AUD-007)
    const docRes = await this.#domains.read(r.domainUuid);
    if (!docRes.ok) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "not-found",
          message: `Reservation '${reservationId}' not found or clearance insufficient`
        })
      );
    }

    const econRes = tryGetDomainEconomyData(docRes.value.record);
    if (!econRes.ok) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "not-found",
          message: `Reservation '${reservationId}' not found or clearance insufficient`
        })
      );
    }

    const account = econRes.value.accounts.find((a) => a.resourceId === r.resourceId);
    if (!account || !this.#projection.isAccountVisible(account, viewer)) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "not-found",
          message: `Reservation '${reservationId}' not found or clearance insufficient`
        })
      );
    }

    const visibleResourceIds = new Set<string>([r.resourceId]);
    const proj = this.#projection.projectReservation(r, visibleResourceIds, viewer);
    if (!proj) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "not-found",
          message: `Reservation '${reservationId}' not found or clearance insufficient`
        })
      );
    }

    return ok(proj);
  }

  async queryReservations(
    filter: ReservationFilter,
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<readonly ReservationDto[], PublicError>> {
    const viewer = this.#projection.resolveViewer(callerViewer);
    const raw = this.#reservationStore.list(filter);
    const visibleResourceIds = new Set<string>();

    if (filter.domainUuid) {
      const docRes = await this.#domains.read(filter.domainUuid);
      if (docRes.ok) {
        const econRes = tryGetDomainEconomyData(docRes.value.record);
        if (econRes.ok) {
          for (const acc of econRes.value.accounts) {
            if (this.#projection.isAccountVisible(acc, viewer)) {
              visibleResourceIds.add(acc.resourceId);
            }
          }
        }
      }
    }

    const projected: ReservationDto[] = [];
    for (const r of raw) {
      const proj = this.#projection.projectReservation(r, visibleResourceIds, viewer);
      if (proj) projected.push(proj);
    }

    return ok(Object.freeze(projected));
  }

  async getProviderHealth(
    providerId?: string
  ): Promise<Result<readonly ProviderHealth[], PublicError>> {
    if (!this.#providerRegistry) {
      return ok(Object.freeze([]));
    }

    if (providerId) {
      const p = this.#providerRegistry.get(providerId);
      if (!p) {
        return err(
          createPublicError({
            code: "DM_ECON_PROVIDER_NOT_FOUND",
            category: "not-found",
            message: `Provider '${providerId}' is not registered`
          })
        );
      }
      const h = await p.getHealth();
      return ok(Object.freeze([h]));
    }

    const healths: ProviderHealth[] = [];
    for (const p of this.#providerRegistry.list()) {
      healths.push(await p.getHealth());
    }
    return ok(Object.freeze(healths));
  }

  async getAggregateContext(
    domainUuids: readonly string[],
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<Result<EconomyAggregateContextDto, PublicError>> {
    const agg = await this.#aggregation.getAggregateContext(domainUuids, callerViewer);
    return ok(agg);
  }

  // --- Safe Command Dispatch Helpers ---

  async adjust(
    payload: ResourceAdjustCommandPayload,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    return this.#dispatchCommand("economy:adjust", payload, options);
  }

  async transfer(
    payload: ResourceTransferCommandPayload,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    return this.#dispatchCommand("economy:transfer", payload, options);
  }

  async convert(
    payload: ResourceConvertCommandPayload,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    return this.#dispatchCommand("economy:convert", payload, options);
  }

  async reserve(
    payload: ResourceReserveCommandPayload,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    return this.#dispatchCommand("economy:reserve", payload, options);
  }

  async consumeReservation(
    payload: ResourceConsumeReservationCommandPayload,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    return this.#dispatchCommand("economy:consume-reservation", payload, options);
  }

  async releaseReservation(
    payload: ResourceReleaseReservationCommandPayload,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    return this.#dispatchCommand("economy:release-reservation", payload, options);
  }

  async createAccount(
    payload: ResourceCreateAccountCommandPayload,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    return this.#dispatchCommand("economy:create-account", payload, options);
  }

  async closeAccount(
    payload: ResourceCloseAccountCommandPayload,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    return this.#dispatchCommand("economy:close-account", payload, options);
  }

  async reversal(
    payload: ResourceReversalCommandPayload,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    return this.#dispatchCommand("economy:reversal", payload, options);
  }

  async #dispatchCommand(
    commandType: string,
    payload: unknown,
    options?: TransportSendOptions
  ): Promise<Result<TransportReceipt, PublicError>> {
    const envelope: DomainCommand<unknown> = {
      contractVersion: COMMAND_CONTRACT_VERSION_V1,
      commandId: createOpaqueId("cmd") as CommandId,
      type: commandType,
      payload,
      issuedAtReal: Date.now()
    };

    return this.#commandBus.execute(envelope, options);
  }
}
