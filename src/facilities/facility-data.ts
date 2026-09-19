import type { DomainRecord } from "../domains/domain-schema.js";
import type { FacilityInstance } from "./types/facility-types.js";
import { validateFacilityInstance } from "./types/facility-types.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { createPublicError, type PublicError } from "../core/contracts/public-error.js";

export const FACILITIES_CAPABILITY_ID = "domain-manager:facilities" as const;
export const FACILITIES_CAPABILITY_ALIAS = "domain:facilities" as const;
export const FACILITIES_SCHEMA_VERSION = 1 as const;

/**
 * Domain-level capability data payload for Facilities (Master Spec §16, DEC-2601-2750).
 * Stored in domain.definition.capabilities.config["domain-manager:facilities"].
 */
export interface DomainFacilitiesData {
  readonly schemaVersion: typeof FACILITIES_SCHEMA_VERSION;
  readonly facilities: readonly FacilityInstance[];
}

/**
 * Creates default initial facility capability data for a domain.
 */
export function createDefaultDomainFacilitiesData(): DomainFacilitiesData {
  return {
    schemaVersion: FACILITIES_SCHEMA_VERSION,
    facilities: Object.freeze([])
  };
}

/**
 * Validates a DomainFacilitiesData object.
 * Enforces schemaVersion, facilities array, individual facility instance validity, and unique IDs.
 */
export function validateDomainFacilitiesData(raw: unknown): Result<DomainFacilitiesData, PublicError> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_DATA_INVALID",
        category: "validation",
        message: "DomainFacilitiesData must be an object"
      })
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (candidate.schemaVersion !== FACILITIES_SCHEMA_VERSION) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INVALID_SCHEMA_VERSION",
        category: "validation",
        message: `Invalid Facilities schemaVersion: ${String(candidate.schemaVersion)}. Expected ${FACILITIES_SCHEMA_VERSION}`
      })
    );
  }

  if (!Array.isArray(candidate.facilities)) {
    return err(
      createPublicError({
        code: "DM_FACILITY_INVALID_FACILITIES_LIST",
        category: "validation",
        message: "DomainFacilitiesData facilities must be an array"
      })
    );
  }

  const validatedFacilities: FacilityInstance[] = [];
  const facilityIds = new Set<string>();

  for (let i = 0; i < candidate.facilities.length; i++) {
    const f = candidate.facilities[i];
    const fRes = validateFacilityInstance(f);
    if (!fRes.ok) {
      return fRes;
    }
    const val = fRes.value;
    if (facilityIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_FACILITY_DUPLICATE_ID",
          category: "validation",
          message: `Duplicate facility instance ID found: ${val.id}`
        })
      );
    }
    facilityIds.add(val.id);
    validatedFacilities.push(val);
  }

  return ok({
    schemaVersion: FACILITIES_SCHEMA_VERSION,
    facilities: Object.freeze(validatedFacilities)
  });
}

function extractRecord(domain: DomainRecord | { record: DomainRecord }): DomainRecord {
  return "record" in domain ? domain.record : domain;
}

/**
 * Retrieves and validates the DomainFacilitiesData from a DomainRecord, or returns default if not configured.
 */
export function tryGetDomainFacilitiesData(
  domain: DomainRecord | { record: DomainRecord }
): Result<DomainFacilitiesData, PublicError> {
  const rec = extractRecord(domain);
  const cfg =
    rec?.definition?.capabilities?.config?.[FACILITIES_CAPABILITY_ID] ??
    rec?.definition?.capabilities?.config?.[FACILITIES_CAPABILITY_ALIAS];

  if (cfg === undefined || cfg === null) {
    return ok(createDefaultDomainFacilitiesData());
  }

  return validateDomainFacilitiesData(cfg);
}

/**
 * Retrieves DomainFacilitiesData, returning default empty data if none configured,
 * but throwing if data is corrupted.
 */
export function getDomainFacilitiesData(
  domain: DomainRecord | { record: DomainRecord }
): DomainFacilitiesData {
  const res = tryGetDomainFacilitiesData(domain);
  if (!res.ok) {
    throw new Error(`Domain facilities data corruption: [${res.error.code}] ${res.error.message}`);
  }
  return res.value;
}

/**
 * Returns a new DomainRecord with updated DomainFacilitiesData in definition.capabilities.config.
 */
export function withDomainFacilitiesData(
  domain: DomainRecord,
  facilitiesData: DomainFacilitiesData
): DomainRecord {
  const validRes = validateDomainFacilitiesData(facilitiesData);
  if (!validRes.ok) {
    throw new Error(`Invalid DomainFacilitiesData: ${validRes.error.message}`);
  }

  const enabled = domain.definition.capabilities.enabled.includes(FACILITIES_CAPABILITY_ID)
    ? domain.definition.capabilities.enabled
    : Object.freeze([...domain.definition.capabilities.enabled, FACILITIES_CAPABILITY_ID]);

  const newConfig = Object.freeze({
    ...domain.definition.capabilities.config,
    [FACILITIES_CAPABILITY_ID]: validRes.value
  });

  return {
    ...domain,
    definition: {
      ...domain.definition,
      capabilities: {
        enabled,
        config: newConfig
      }
    }
  };
}
