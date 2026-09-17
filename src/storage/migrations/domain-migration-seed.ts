import { err, ok, type Result } from "../../core/contracts/result.js";
import { createPublicError } from "../../core/contracts/public-error.js";
import {
  createDefaultCapabilityRegistry,
  validateDomainCapabilities
} from "../../domains/domain-capabilities.js";
import { DOMAIN_SCHEMA_VERSION, type DomainRecord } from "../../domains/domain-schema.js";
import { validateDomainRecord } from "../../domains/domain-validator.js";

export const DOMAIN_SCHEMA_V1_MIGRATION_ID = "domain-schema-v1-seed" as const;

export interface DomainMigrationSeed {
  readonly id: typeof DOMAIN_SCHEMA_V1_MIGRATION_ID;
  readonly fromVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly toVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly kind: "canonical-baseline";
  readonly idempotent: true;
  readonly preconditions: readonly string[];
  readonly postconditions: readonly string[];
  readonly record: DomainRecord;
}

function createCanonicalRecord(): DomainRecord {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    revision: 0,
    definition: {
      identity: {
        aliases: [],
        summary: "",
        description: ""
      },
      classification: {
        kind: "domain",
        scale: "domain",
        tags: []
      },
      hierarchy: {
        parentDomainUuid: null
      },
      capabilities: {
        enabled: ["domain-manager:domain"],
        config: {}
      }
    },
    state: {
      lifecycle: "active"
    },
    metadata: {
      createdByUserId: null,
      archivedAt: null,
      source: {
        type: "migration",
        ref: DOMAIN_SCHEMA_V1_MIGRATION_ID
      }
    }
  };
}

export function createDomainSchemaV1MigrationSeed(): DomainMigrationSeed {
  return Object.freeze({
    id: DOMAIN_SCHEMA_V1_MIGRATION_ID,
    fromVersion: DOMAIN_SCHEMA_VERSION,
    toVersion: DOMAIN_SCHEMA_VERSION,
    kind: "canonical-baseline",
    idempotent: true,
    preconditions: Object.freeze([
      "No earlier Domain schema is declared by the canonical contract"
    ]),
    postconditions: Object.freeze([
      `Domain record uses schemaVersion ${DOMAIN_SCHEMA_VERSION}`,
      "Domain record passes structural and capability validation"
    ]),
    record: createCanonicalRecord()
  });
}

export const DOMAIN_SCHEMA_V1_MIGRATION_SEED = createDomainSchemaV1MigrationSeed();

export function validateDomainSchemaV1MigrationSeed(
  seed: DomainMigrationSeed = DOMAIN_SCHEMA_V1_MIGRATION_SEED
): Result<DomainRecord> {
  if (
    seed.id !== DOMAIN_SCHEMA_V1_MIGRATION_ID ||
    seed.fromVersion !== DOMAIN_SCHEMA_VERSION ||
    seed.toVersion !== DOMAIN_SCHEMA_VERSION ||
    seed.kind !== "canonical-baseline" ||
    seed.idempotent !== true
  ) {
    return err(createPublicError({
      code: "DM_DOMAIN_MIGRATION_SEED_INVALID",
      category: "integrity",
      message: "Domain migration seed metadata is invalid"
    }));
  }

  const recordValidation = validateDomainRecord(seed.record);
  if (!recordValidation.ok || seed.record.schemaVersion !== DOMAIN_SCHEMA_VERSION) {
    return err(createPublicError({
      code: "DM_DOMAIN_MIGRATION_SEED_INVALID",
      category: "integrity",
      message: "Domain migration seed record failed canonical validation",
      details: recordValidation.ok ? { schemaVersion: seed.record.schemaVersion } : recordValidation.error
    }));
  }

  const capabilityValidation = validateDomainCapabilities(
    seed.record.definition.capabilities,
    createDefaultCapabilityRegistry()
  );
  if (!capabilityValidation.ok) {
    return err(createPublicError({
      code: "DM_DOMAIN_MIGRATION_SEED_INVALID",
      category: "integrity",
      message: "Domain migration seed capabilities failed canonical validation",
      details: capabilityValidation.error
    }));
  }

  return ok(seed.record);
}
