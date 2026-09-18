import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { isNamespacedResourceId } from "../definitions/resource-definition-types.js";

export type ResourceAccountMode = "native" | "derived" | "provider";
export type ResourceVisibility = "public" | "restricted" | "secret";

export type AccountStatus = "active" | "closed";

export interface NativeResourceAccount {
  readonly mode: "native";
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly balanceMinor: number;
  readonly baseCapacityMinor: number | null;
  readonly visibility?: ResourceVisibility;
  readonly status?: AccountStatus;
  readonly closedAt?: number;
}

export interface DerivedResourceAccount {
  readonly mode: "derived";
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly resolverId: string;
  readonly visibility?: ResourceVisibility;
  readonly status?: AccountStatus;
  readonly closedAt?: number;
}

export interface ProviderResourceAccount {
  readonly mode: "provider";
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly providerId: string;
  readonly providerRef: string;
  readonly visibility?: ResourceVisibility;
  readonly status?: AccountStatus;
  readonly closedAt?: number;
}

export type ResourceAccount =
  | NativeResourceAccount
  | DerivedResourceAccount
  | ProviderResourceAccount;

const VALID_VISIBILITIES: readonly ResourceVisibility[] = Object.freeze([
  "public",
  "restricted",
  "secret"
]);

export function validateResourceAccount(raw: unknown): Result<ResourceAccount, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_ACCOUNT_INVALID",
        category: "validation",
        message: "ResourceAccount must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // 1. domainUuid
  if (typeof candidate.domainUuid !== "string" || candidate.domainUuid.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_ACCOUNT_INVALID",
        category: "validation",
        message: "ResourceAccount domainUuid must be a non-empty string"
      })
    );
  }

  // 2. resourceId
  if (!isNamespacedResourceId(candidate.resourceId)) {
    return err(
      createPublicError({
        code: "DM_ECON_ACCOUNT_INVALID",
        category: "validation",
        message: `ResourceAccount resourceId must be namespaced: received '${String(candidate.resourceId)}'`
      })
    );
  }

  // 3. visibility
  let visibility: ResourceVisibility | undefined = undefined;
  if (candidate.visibility !== undefined && candidate.visibility !== null) {
    if (!VALID_VISIBILITIES.includes(candidate.visibility as ResourceVisibility)) {
      return err(
        createPublicError({
          code: "DM_ECON_ACCOUNT_INVALID",
          category: "validation",
          message: `Invalid visibility: received '${String(candidate.visibility)}'`
        })
      );
    }
    visibility = candidate.visibility as ResourceVisibility;
  }

  // 4. mode
  const mode = candidate.mode;
  switch (mode) {
    case "native": {
      // balanceMinor
      const balance = candidate.balanceMinor;
      if (typeof balance !== "number" || !Number.isSafeInteger(balance)) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: `Native account balanceMinor must be a safe integer: received '${String(balance)}'`
          })
        );
      }

      // baseCapacityMinor
      let baseCapacity: number | null = null;
      if (candidate.baseCapacityMinor !== undefined && candidate.baseCapacityMinor !== null) {
        if (
          typeof candidate.baseCapacityMinor !== "number" ||
          !Number.isSafeInteger(candidate.baseCapacityMinor) ||
          candidate.baseCapacityMinor < 0
        ) {
          return err(
            createPublicError({
              code: "DM_ECON_ACCOUNT_INVALID",
              category: "validation",
              message: "baseCapacityMinor must be a non-negative safe integer or null"
            })
          );
        }
        baseCapacity = candidate.baseCapacityMinor;
      }

      const status = candidate.status === "closed" ? "closed" : "active";
      const closedAt = typeof candidate.closedAt === "number" ? candidate.closedAt : undefined;

      return ok({
        mode: "native",
        domainUuid: candidate.domainUuid.trim(),
        resourceId: candidate.resourceId,
        balanceMinor: balance,
        baseCapacityMinor: baseCapacity,
        ...(visibility ? { visibility } : {}),
        status,
        ...(closedAt !== undefined ? { closedAt } : {})
      });
    }

    case "derived": {
      if (typeof candidate.resolverId !== "string" || candidate.resolverId.trim().length === 0) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: "Derived account must specify a non-empty resolverId"
          })
        );
      }

      return ok({
        mode: "derived",
        domainUuid: candidate.domainUuid.trim(),
        resourceId: candidate.resourceId,
        resolverId: candidate.resolverId.trim(),
        ...(visibility ? { visibility } : {})
      });
    }

    case "provider": {
      if (typeof candidate.providerId !== "string" || candidate.providerId.trim().length === 0) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: "Provider account must specify a non-empty providerId"
          })
        );
      }
      if (typeof candidate.providerRef !== "string" || candidate.providerRef.trim().length === 0) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: "Provider account must specify a non-empty providerRef"
          })
        );
      }

      return ok({
        mode: "provider",
        domainUuid: candidate.domainUuid.trim(),
        resourceId: candidate.resourceId,
        providerId: candidate.providerId.trim(),
        providerRef: candidate.providerRef.trim(),
        ...(visibility ? { visibility } : {})
      });
    }

    default:
      return err(
        createPublicError({
          code: "DM_ECON_ACCOUNT_INVALID",
          category: "validation",
          message: `Invalid ResourceAccount mode: '${String(mode)}'. Expected 'native', 'derived', or 'provider'`
        })
      );
  }
}
