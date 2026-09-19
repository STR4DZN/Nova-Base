import type { DomainRecord } from "../domains/domain-schema.js";
import type { DowntimeInstance } from "./types/downtime-types.js";
import { validateDowntimeInstance } from "./types/downtime-types.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { createPublicError, type PublicError } from "../core/contracts/public-error.js";

export const DOWNTIME_CAPABILITY_ID = "domain-manager:downtime" as const;
export const DOWNTIME_CAPABILITY_ALIAS = "domain:downtime" as const;
export const DOWNTIME_SCHEMA_VERSION = 1 as const;

/**
 * Domain-level capability data payload for Downtime activities (Master Spec §17, DEC-2751-2900).
 * Stored in domain.definition.capabilities.config["domain-manager:downtime"].
 */
export interface DomainDowntimeData {
  readonly schemaVersion: typeof DOWNTIME_SCHEMA_VERSION;
  readonly activities: readonly DowntimeInstance[];
}

/**
 * Creates default initial downtime capability data for a domain.
 */
export function createDefaultDomainDowntimeData(): DomainDowntimeData {
  return {
    schemaVersion: DOWNTIME_SCHEMA_VERSION,
    activities: Object.freeze([])
  };
}

/**
 * Validates a DomainDowntimeData object.
 * Enforces schemaVersion, activities array, individual downtime instance validity, and unique IDs.
 */
export function validateDomainDowntimeData(raw: unknown): Result<DomainDowntimeData, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_DATA_INVALID",
        category: "validation",
        message: "DomainDowntimeData must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (candidate.schemaVersion !== DOWNTIME_SCHEMA_VERSION) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INVALID_SCHEMA_VERSION",
        category: "validation",
        message: `Invalid Downtime schemaVersion: ${String(candidate.schemaVersion)}. Expected ${DOWNTIME_SCHEMA_VERSION}`
      })
    );
  }

  if (!Array.isArray(candidate.activities)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INVALID_ACTIVITIES_LIST",
        category: "validation",
        message: "DomainDowntimeData activities must be an array"
      })
    );
  }

  const validatedActivities: DowntimeInstance[] = [];
  const activityIds = new Set<string>();

  for (let i = 0; i < candidate.activities.length; i++) {
    const act = candidate.activities[i];
    const actRes = validateDowntimeInstance(act);
    if (!actRes.ok) {
      return actRes;
    }
    const val = actRes.value;
    if (activityIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_DUPLICATE_ID",
          category: "validation",
          message: `Duplicate downtime instance ID found: ${val.id}`
        })
      );
    }
    activityIds.add(val.id);
    validatedActivities.push(val);
  }

  return ok({
    schemaVersion: DOWNTIME_SCHEMA_VERSION,
    activities: Object.freeze(validatedActivities)
  });
}

function extractRecord(domain: DomainRecord | { record: DomainRecord }): DomainRecord {
  return "record" in domain ? domain.record : domain;
}

/**
 * Retrieves and validates DomainDowntimeData from a domain record.
 * Returns default if not configured, or err if configured but corrupt.
 */
export function tryGetDomainDowntimeData(
  domain: DomainRecord | { record: DomainRecord }
): Result<DomainDowntimeData, PublicError> {
  const record = extractRecord(domain);
  const config =
    record?.definition?.capabilities?.config?.[DOWNTIME_CAPABILITY_ID] ??
    record?.definition?.capabilities?.config?.[DOWNTIME_CAPABILITY_ALIAS];

  if (config === undefined || config === null) {
    return ok(createDefaultDomainDowntimeData());
  }

  return validateDomainDowntimeData(config);
}

/**
 * Retrieves DomainDowntimeData from a domain record, returning default empty data if not configured,
 * but throwing if data is corrupted.
 */
export function getDomainDowntimeData(
  domain: DomainRecord | { record: DomainRecord }
): DomainDowntimeData {
  const res = tryGetDomainDowntimeData(domain);
  if (!res.ok) {
    throw new Error(`Domain downtime data corruption: [${res.error.code}] ${res.error.message}`);
  }
  return res.value;
}

/**
 * Produces a new DomainRecord with updated DomainDowntimeData payload.
 * Also ensures DOWNTIME_CAPABILITY_ID is added to enabled capabilities.
 */
export function withDomainDowntimeData(
  domain: DomainRecord,
  data: DomainDowntimeData
): DomainRecord {
  const currentCapabilities = domain.definition.capabilities;
  const currentEnabled = currentCapabilities.enabled;

  const enabledSet = new Set(currentEnabled);
  enabledSet.add(DOWNTIME_CAPABILITY_ID);

  return {
    ...domain,
    definition: {
      ...domain.definition,
      capabilities: {
        enabled: Object.freeze(Array.from(enabledSet)),
        config: Object.freeze({
          ...currentCapabilities.config,
          [DOWNTIME_CAPABILITY_ID]: data
        })
      }
    }
  };
}
