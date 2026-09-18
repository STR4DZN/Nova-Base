import type { DomainReadRepository } from "../../storage/repositories/domain-repository.js";
import { tryGetDomainEconomyData } from "../economy-data.js";
import type { ResourceDefinitionRegistry } from "../definitions/resource-registry.js";
import type { ReservationStore } from "../reservations/reservation-store.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";
import {
  EconomyProjectionService,
  type ResourceAccountDto
} from "../projection/economy-projection-service.js";
import type { ViewerIdentity } from "../../projection/viewer-identity.js";

export interface AggregateResourceTotalDto {
  readonly resourceId: string;
  readonly totalBalanceMinor: number;
  readonly totalReservedMinor: number;
  readonly totalAvailableMinor: number;
  readonly contributingDomainCount: number;
  readonly hiddenDomainCount: number;
  readonly isComplete: boolean;
  readonly unknownContributorCount: number;
}

export interface EconomyAggregateContextDto {
  readonly totals: readonly AggregateResourceTotalDto[];
  readonly totalDomainsEvaluated: number;
  readonly hiddenContributors: readonly string[];
  readonly unknownContributors: readonly string[];
  readonly isComplete: boolean;
  readonly evaluatedAt: number;
}

export interface EconomyAggregationOptions {
  readonly domains: DomainReadRepository;
  readonly resourceRegistry: ResourceDefinitionRegistry;
  readonly reservationStore: ReservationStore;
  readonly providerRegistry?: ProviderRegistry;
  readonly projectionService?: EconomyProjectionService;
}

export class EconomyAggregationProvider {
  readonly #domains: DomainReadRepository;
  readonly #resourceRegistry: ResourceDefinitionRegistry;
  readonly #reservationStore: ReservationStore;
  readonly #providerRegistry?: ProviderRegistry;
  readonly #projection: EconomyProjectionService;

  constructor(options: EconomyAggregationOptions) {
    this.#domains = options.domains;
    this.#resourceRegistry = options.resourceRegistry;
    this.#reservationStore = options.reservationStore;
    this.#providerRegistry = options.providerRegistry;
    this.#projection = options.projectionService ?? new EconomyProjectionService();
  }

  async getAggregateContext(
    domainUuids: readonly string[],
    callerViewer?: Partial<ViewerIdentity>
  ): Promise<EconomyAggregateContextDto> {
    const viewer = this.#projection.resolveViewer(callerViewer);
    const totalsByResource = new Map<
      string,
      {
        totalBalance: number;
        totalReserved: number;
        totalAvailable: number;
        contributingCount: number;
        hiddenCount: number;
        isComplete: boolean;
        unknownContributorCount: number;
      }
    >();

    const hiddenContributors: string[] = [];
    const unknownContributors: string[] = [];

    for (const uuid of domainUuids) {
      const docRes = await this.#domains.read(uuid);
      if (!docRes.ok) {
        if (!unknownContributors.includes(uuid)) {
          unknownContributors.push(uuid);
        }
        continue;
      }

      const econRes = tryGetDomainEconomyData(docRes.value.record);
      if (!econRes.ok) {
        if (!unknownContributors.includes(uuid)) {
          unknownContributors.push(uuid);
        }
        continue;
      }

      let domainContributed = false;
      let domainHadSecret = false;

      for (const account of econRes.value.accounts) {
        const isVisible = this.#projection.isAccountVisible(account, viewer);
        if (!isVisible) {
          domainHadSecret = true;
          let resourceStats = totalsByResource.get(account.resourceId);
          if (!resourceStats) {
            resourceStats = {
              totalBalance: 0,
              totalReserved: 0,
              totalAvailable: 0,
              contributingCount: 0,
              hiddenCount: 0,
              isComplete: true,
              unknownContributorCount: 0
            };
            totalsByResource.set(account.resourceId, resourceStats);
          }
          resourceStats.hiddenCount++;
          continue;
        }

        domainContributed = true;
        let resourceStats = totalsByResource.get(account.resourceId);
        if (!resourceStats) {
          resourceStats = {
            totalBalance: 0,
            totalReserved: 0,
            totalAvailable: 0,
            contributingCount: 0,
            hiddenCount: 0,
            isComplete: true,
            unknownContributorCount: 0
          };
          totalsByResource.set(account.resourceId, resourceStats);
        }

        let balance = account.mode === "native" ? account.balanceMinor : 0;
        if (account.mode === "provider") {
          let readSuccess = false;
          if (this.#providerRegistry) {
            const provider = this.#providerRegistry.get(account.providerId);
            if (provider && "readBalance" in provider) {
              try {
                const balRes = await (provider as any).readBalance(uuid, account.resourceId, account.providerRef);
                if (balRes?.ok) {
                  balance = balRes.value.balanceMinor;
                  readSuccess = true;
                }
              } catch {}
            }
          }
          if (!readSuccess) {
            resourceStats.isComplete = false;
            resourceStats.unknownContributorCount++;
            if (!unknownContributors.includes(uuid)) {
              unknownContributors.push(uuid);
            }
          }
        }

        const reserved = this.#reservationStore.getReservedTotal(uuid, account.resourceId);
        const available = balance - reserved;

        resourceStats.totalBalance += balance;
        resourceStats.totalReserved += reserved;
        resourceStats.totalAvailable += available;
        resourceStats.contributingCount++;
      }

      // G4-AUD-007: Only GM viewers may see secret domain UUIDs in hiddenContributors.
      // For non-GMs, hiddenContributors remains strictly empty to prevent information leakage.
      if (domainHadSecret && viewer.isGm) {
        hiddenContributors.push(uuid);
      }
    }

    const totals: AggregateResourceTotalDto[] = [];
    for (const [resourceId, stats] of totalsByResource.entries()) {
      totals.push({
        resourceId,
        totalBalanceMinor: stats.totalBalance,
        totalReservedMinor: stats.totalReserved,
        totalAvailableMinor: stats.totalAvailable,
        contributingDomainCount: stats.contributingCount,
        hiddenDomainCount: stats.hiddenCount,
        isComplete: stats.isComplete && stats.unknownContributorCount === 0,
        unknownContributorCount: stats.unknownContributorCount
      });
    }

    return {
      totals: Object.freeze(totals),
      totalDomainsEvaluated: domainUuids.length,
      hiddenContributors: Object.freeze(hiddenContributors),
      unknownContributors: Object.freeze(unknownContributors),
      isComplete: unknownContributors.length === 0,
      evaluatedAt: Date.now()
    };
  }
}
