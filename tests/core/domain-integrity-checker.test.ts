import assert from "node:assert/strict";
import test from "node:test";
import { createPublicError } from "../../src/core/contracts/public-error.js";
import { createDefaultCapabilityRegistry } from "../../src/domains/domain-capabilities.js";
import {
  DomainIntegrityChecker,
  type DomainIntegrityDocument
} from "../../src/storage/integrity/domain-integrity-checker.js";

const record = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Summary", description: "Description" },
    classification: { kind: "base", scale: "small", tags: [] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
} as const;

function document(id: string, value = record): DomainIntegrityDocument {
  return { id, uuid: `JournalEntry.${id}`, name: id, record: value };
}

function checker(): DomainIntegrityChecker {
  return new DomainIntegrityChecker({ capabilityRegistry: createDefaultCapabilityRegistry() });
}

test("integrity checker reports a healthy canonical set", () => {
  const report = checker().check([document("root")]);

  assert.equal(report.healthy, true);
  assert.equal(report.errorCount, 0);
  assert.equal(report.warningCount, 0);
  assert.equal(report.checked, 1);
});

test("integrity checker keeps recoverable orphan and unknown capability diagnostic", () => {
  const value = {
    ...record,
    definition: {
      ...record.definition,
      hierarchy: { parentDomainUuid: "JournalEntry.missing" },
      capabilities: { enabled: ["domain-manager:domain", "addon:missing"], config: {} }
    }
  } as const;
  const report = checker().check([document("orphan", value)]);

  assert.equal(report.healthy, true);
  assert.equal(report.errorCount, 0);
  assert.equal(report.warningCount, 2);
  assert.deepEqual(report.issues.map((item) => item.code).sort(), [
    "DM_CAPABILITY_UNAVAILABLE",
    "DM_DOMAIN_BROKEN_PARENT"
  ]);
});

test("integrity checker reports schema, revision, lifecycle and duplicate errors", () => {
  const invalid = {
    ...record,
    schemaVersion: 2,
    revision: Number.MAX_SAFE_INTEGER + 1,
    state: { lifecycle: "archived" },
    metadata: { ...record.metadata, archivedAt: null }
  } as const;
  const report = checker().check([document("duplicate", invalid), document("duplicate", record)]);

  assert.equal(report.healthy, false);
  assert.ok(report.issues.some((item) => item.code === "DM_DOMAIN_DUPLICATE_ID"));
  assert.ok(report.issues.some((item) => item.code === "DM_DOMAIN_SCHEMA_MISMATCH"));
  assert.ok(report.issues.some((item) => item.code === "DM_DOMAIN_REVISION_INVALID"));
  assert.ok(report.issues.some((item) => item.code === "DM_DOMAIN_LIFECYCLE_INCONSISTENT"));
});

test("integrity checker detects hierarchy cycles and invalid payloads", () => {
  const left = document("left", { ...record, definition: { ...record.definition, hierarchy: { parentDomainUuid: "JournalEntry.right" } } });
  const right = document("right", { ...record, definition: { ...record.definition, hierarchy: { parentDomainUuid: "JournalEntry.left" } } });
  const broken: DomainIntegrityDocument = {
    id: "broken",
    uuid: "JournalEntry.broken",
    name: "Broken",
    record: undefined,
    decodeError: createPublicError({
      code: "DM_INVALID_DOMAIN_PAYLOAD",
      category: "integrity",
      message: "Invalid payload"
    })
  };
  const report = checker().check([left, right, broken]);

  assert.equal(report.healthy, false);
  assert.ok(report.issues.some((item) => item.code === "DM_DOMAIN_HIERARCHY_CYCLE"));
  assert.ok(report.issues.some((item) => item.code === "DM_DOMAIN_PAYLOAD_INVALID"));
});
