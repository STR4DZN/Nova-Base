import type { DomainRecord } from "../domains/domain-schema.js";
import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import {
  type ResourceAccount,
  validateResourceAccount
} from "./accounts/account-types.js";

export const ECONOMY_CAPABILITY_ID = "domain-manager:economy" as const;
export const ECONOMY_CAPABILITY_ALIAS = "domain:economy" as const;
export const ECONOMY_SCHEMA_VERSION = 1 as const;

export interface OperationReceiptRecord {
  readonly operationRef: string;
  readonly resourceId: string;
  readonly deltaMinor: number;
  readonly kind: string;
  readonly reason?: string;
  readonly state: "balance-applied" | "ledger-confirmed";
  readonly ledgerEntryId?: string;
}

export interface DomainEconomyData {
  readonly schemaVersion: typeof ECONOMY_SCHEMA_VERSION;
  readonly accounts: readonly ResourceAccount[];
  readonly appliedIdempotencyKeys?: readonly string[];
  readonly operationReceipts?: readonly OperationReceiptRecord[];
}

export function createDefaultDomainEconomyData(): DomainEconomyData {
  return {
    schemaVersion: ECONOMY_SCHEMA_VERSION,
    accounts: Object.freeze([]),
    appliedIdempotencyKeys: Object.freeze([]),
    operationReceipts: Object.freeze([])
  };
}

export function validateDomainEconomyData(raw: unknown): Result<DomainEconomyData, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_DATA_INVALID",
        category: "validation",
        message: "Economy data must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  // Schema version
  if (candidate.schemaVersion !== ECONOMY_SCHEMA_VERSION) {
    return err(
      createPublicError({
        code: "DM_ECON_INVALID_SCHEMA_VERSION",
        category: "validation",
        message: `Invalid Economy schemaVersion: ${String(candidate.schemaVersion)}. Expected ${ECONOMY_SCHEMA_VERSION}`
      })
    );
  }

  // Accounts
  if (!Array.isArray(candidate.accounts)) {
    return err(
      createPublicError({
        code: "DM_ECON_DATA_INVALID",
        category: "validation",
        message: "Economy accounts must be an array"
      })
    );
  }

  const validatedAccounts: ResourceAccount[] = [];
  const resourceIds = new Set<string>();

  for (const a of candidate.accounts) {
    const accRes = validateResourceAccount(a);
    if (!accRes.ok) {
      return accRes;
    }
    const acc = accRes.value;

    // Invariant: At most 1 account per resourceId per domain (DEC-16798)
    if (resourceIds.has(acc.resourceId)) {
      return err(
        createPublicError({
          code: "DM_ECON_DUPLICATE_RESOURCE_ACCOUNT",
          category: "validation",
          message: `Duplicate account for resource '${acc.resourceId}' in domain '${acc.domainUuid}'`
        })
      );
    }
    resourceIds.add(acc.resourceId);
    validatedAccounts.push(acc);
  }

  const appliedKeys = Array.isArray(candidate.appliedIdempotencyKeys)
    ? Object.freeze([...(candidate.appliedIdempotencyKeys as string[])])
    : Object.freeze([]);

  const operationReceipts = Array.isArray(candidate.operationReceipts)
    ? Object.freeze([...(candidate.operationReceipts as OperationReceiptRecord[])])
    : Object.freeze([]);

  return ok({
    schemaVersion: ECONOMY_SCHEMA_VERSION,
    accounts: Object.freeze(validatedAccounts),
    appliedIdempotencyKeys: appliedKeys,
    operationReceipts
  });
}

export function tryGetDomainEconomyData(
  domain: DomainRecord | { record: DomainRecord }
): Result<DomainEconomyData, PublicError> {
  const record = "record" in domain ? domain.record : domain;
  const config = record?.definition?.capabilities?.config ?? {};
  const rawEconomy = config[ECONOMY_CAPABILITY_ID] ?? config[ECONOMY_CAPABILITY_ALIAS];
  if (!rawEconomy) {
    return ok(createDefaultDomainEconomyData());
  }

  return validateDomainEconomyData(rawEconomy);
}

export function getDomainEconomyData(
  domain: DomainRecord | { record: DomainRecord }
): DomainEconomyData {
  const res = tryGetDomainEconomyData(domain);
  if (!res.ok) {
    throw new Error(`Domain economy data corruption: [${res.error.code}] ${res.error.message}`);
  }
  return res.value;
}

export function withDomainEconomyData(
  domain: DomainRecord,
  economyData: DomainEconomyData
): DomainRecord {
  const currentEnabled = domain.definition.capabilities.enabled;
  const newEnabled = currentEnabled.includes(ECONOMY_CAPABILITY_ID)
    ? currentEnabled
    : Object.freeze([...currentEnabled, ECONOMY_CAPABILITY_ID]);

  const newConfig = Object.freeze({
    ...domain.definition.capabilities.config,
    [ECONOMY_CAPABILITY_ID]: economyData
  });

  return {
    ...domain,
    definition: {
      ...domain.definition,
      capabilities: {
        enabled: newEnabled,
        config: newConfig
      }
    }
  };
}
