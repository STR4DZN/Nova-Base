import { resolveCurrentViewer, type ViewerIdentity } from "../../projection/viewer-identity.js";
import type { ResourceAccount } from "../accounts/account-types.js";
import type { ResourceDefinition } from "../definitions/resource-definition-types.js";
import type { LedgerEntry } from "../ledger/ledger-types.js";
import type { Reservation } from "../reservations/reservation-types.js";

export interface ResourceAccountDto {
  readonly resourceId: string;
  readonly mode: string;
  readonly balanceMinor: number;
  readonly availableMinor: number;
  readonly reservedMinor: number;
  readonly capacityMinor: number | null;
  readonly visibility: string;
  readonly status: string;
  readonly isStale?: boolean;
  readonly isUnavailable?: boolean;
  readonly definition?: {
    readonly id: string;
    readonly label: string;
    readonly symbol?: string;
    readonly precision: number;
  };
}

export interface LedgerEntryDto {
  readonly id: string;
  readonly sequence: number;
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly deltaMinor: number;
  readonly kind: string;
  readonly timestampReal: number;
  readonly timestampWorld?: number | null;
  readonly source: {
    readonly type: string;
    readonly ref?: string;
    readonly reason?: string;
  };
  readonly reversesEntryId?: string;
  readonly reservationId?: string;
  readonly transactionId?: string;
}

export interface ReservationDto {
  readonly id: string;
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly originalAmountMinor: number;
  readonly remainingAmountMinor: number;
  readonly status: string;
  readonly createdAtReal: number;
  readonly expiresAtWorld?: number | null;
  readonly reason?: string;
}

export interface EconomyContextDto {
  readonly domainUuid: string;
  readonly accounts: readonly ResourceAccountDto[];
  readonly recentLedger: readonly LedgerEntryDto[];
  readonly activeReservations: readonly ReservationDto[];
  readonly isGmView: boolean;
  readonly projectedAt: number;
}

export class EconomyProjectionService {
  resolveViewer(callerSuppliedViewer?: Partial<ViewerIdentity>): ViewerIdentity {
    return resolveCurrentViewer(callerSuppliedViewer);
  }

  isAccountVisible(
    account: ResourceAccount,
    viewer: ViewerIdentity
  ): boolean {
    if (viewer.isGm) {
      return true;
    }

    const visibility = account.visibility ?? "public";
    if (visibility === "secret") {
      return false;
    }

    if (visibility === "restricted") {
      const allowed = viewer.allowedRestrictedRefs ?? [];
      return (
        allowed.includes(account.resourceId) ||
        allowed.includes(account.domainUuid) ||
        allowed.includes(`${account.domainUuid}:${account.resourceId}`)
      );
    }

    return true; // public
  }

  projectAccount(
    account: ResourceAccount,
    definition: ResourceDefinition | undefined,
    reservedMinor: number,
    viewer: ViewerIdentity,
    options?: {
      readonly balanceMinor?: number;
      readonly capacityMinor?: number | null;
      readonly isStale?: boolean;
      readonly isUnavailable?: boolean;
    }
  ): ResourceAccountDto | null {
    if (!this.isAccountVisible(account, viewer)) {
      return null;
    }

    const mode = account.mode;
    const balanceMinor =
      options?.balanceMinor ??
      (mode === "native" ? account.balanceMinor : 0);
    const availableMinor = balanceMinor - reservedMinor;
    const capacityMinor =
      options?.capacityMinor !== undefined
        ? options.capacityMinor
        : mode === "native"
          ? account.baseCapacityMinor
          : null;

    return {
      resourceId: account.resourceId,
      mode,
      balanceMinor,
      availableMinor,
      reservedMinor,
      capacityMinor,
      visibility: account.visibility ?? "public",
      status: account.status ?? "active",
      ...(options?.isStale ? { isStale: true } : {}),
      ...(options?.isUnavailable ? { isUnavailable: true } : {}),
      ...(definition
        ? {
            definition: {
              id: definition.id,
              label: definition.label,
              symbol: definition.displayUnit?.abbreviation ?? definition.displayUnit?.singular,
              precision: definition.precision
            }
          }
        : {})
    };
  }

  projectLedgerEntry(
    entry: LedgerEntry,
    visibleResourceIdsOrKeys: ReadonlySet<string>,
    viewer: ViewerIdentity
  ): LedgerEntryDto | null {
    if (!viewer.isGm) {
      const cleanDom = entry.domainUuid.startsWith("JournalEntry.")
        ? entry.domainUuid.slice("JournalEntry.".length)
        : entry.domainUuid;
      const isAllowed =
        visibleResourceIdsOrKeys.has(`${entry.domainUuid}:${entry.resourceId}`) ||
        visibleResourceIdsOrKeys.has(`${cleanDom}:${entry.resourceId}`) ||
        visibleResourceIdsOrKeys.has(`JournalEntry.${cleanDom}:${entry.resourceId}`) ||
        visibleResourceIdsOrKeys.has(entry.resourceId);
      if (!isAllowed) {
        return null;
      }
    }

    return {
      id: entry.id,
      sequence: entry.sequence,
      domainUuid: entry.domainUuid,
      resourceId: entry.resourceId,
      deltaMinor: entry.deltaMinor,
      kind: entry.kind,
      timestampReal: entry.timestampReal,
      timestampWorld: entry.timestampWorld,
      source: {
        type: entry.source.type,
        ref: entry.source.ref,
        reason: viewer.isGm ? entry.source.reason : undefined
      },
      reversesEntryId: entry.reversesEntryId,
      reservationId: entry.reservationId,
      transactionId: entry.transactionId
    };
  }

  projectReservation(
    reservation: Reservation,
    visibleResourceIds: ReadonlySet<string>,
    viewer: ViewerIdentity
  ): ReservationDto | null {
    if (!visibleResourceIds.has(reservation.resourceId) && !viewer.isGm) {
      return null;
    }

    return {
      id: reservation.id,
      domainUuid: reservation.domainUuid,
      resourceId: reservation.resourceId,
      originalAmountMinor: reservation.originalAmountMinor,
      remainingAmountMinor: reservation.remainingAmountMinor,
      status: reservation.status,
      createdAtReal: reservation.createdAtReal,
      expiresAtWorld: reservation.expiresAtWorld,
      reason: viewer.isGm ? reservation.source.reason : undefined
    };
  }
}
