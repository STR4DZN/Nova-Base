import assert from "node:assert/strict";
import test from "node:test";
import { DOMAIN_SCHEMA_VERSION } from "../../src/domains/domain-schema.js";
import {
  DOMAIN_SCHEMA_V1_MIGRATION_ID,
  DOMAIN_SCHEMA_V1_MIGRATION_SEED,
  createDomainSchemaV1MigrationSeed,
  validateDomainSchemaV1MigrationSeed
} from "../../src/storage/migrations/domain-migration-seed.js";

test("domain migration seed freezes the canonical v1 baseline", () => {
  assert.equal(DOMAIN_SCHEMA_VERSION, 1);
  assert.equal(DOMAIN_SCHEMA_V1_MIGRATION_SEED.id, DOMAIN_SCHEMA_V1_MIGRATION_ID);
  assert.equal(DOMAIN_SCHEMA_V1_MIGRATION_SEED.fromVersion, DOMAIN_SCHEMA_VERSION);
  assert.equal(DOMAIN_SCHEMA_V1_MIGRATION_SEED.toVersion, DOMAIN_SCHEMA_VERSION);
  assert.equal(DOMAIN_SCHEMA_V1_MIGRATION_SEED.kind, "canonical-baseline");
  assert.equal(DOMAIN_SCHEMA_V1_MIGRATION_SEED.idempotent, true);

  const validation = validateDomainSchemaV1MigrationSeed();
  assert.equal(validation.ok, true);
  if (validation.ok) assert.deepEqual(validation.value, DOMAIN_SCHEMA_V1_MIGRATION_SEED.record);
});

test("domain migration seed factory is deterministic and returns independent records", () => {
  const first = createDomainSchemaV1MigrationSeed();
  const second = createDomainSchemaV1MigrationSeed();

  assert.deepEqual(first, second);
  assert.notEqual(first.record, second.record);
  assert.equal(first.record.revision, 0);
  assert.equal(first.record.metadata.source.type, "migration");
  assert.equal(first.record.metadata.source.ref, DOMAIN_SCHEMA_V1_MIGRATION_ID);
});
