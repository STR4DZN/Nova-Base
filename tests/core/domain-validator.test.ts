import assert from "node:assert/strict";
import test from "node:test";
import { validateDomainRecord } from "../../src/domains/domain-validator.js";

const validDomain = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Summary", description: "Description" },
    classification: { kind: "base", scale: "small", tags: [] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: {
    createdByUserId: null,
    archivedAt: null,
    source: { type: "manual", ref: null }
  }
};

test("domain validator accepts the canonical shape", () => {
  assert.equal(validateDomainRecord(validDomain).ok, true);
});

test("domain validator rejects invalid revision and lifecycle", () => {
  assert.equal(validateDomainRecord({ ...validDomain, revision: -1 }).ok, false);
  assert.equal(validateDomainRecord({ ...validDomain, state: { lifecycle: "unknown" } }).ok, false);
});


test("domain validator never throws on malformed nested payloads", () => {
  const malformed = [
    { ...validDomain, metadata: { ...validDomain.metadata, source: null } },
    { ...validDomain, definition: { ...validDomain.definition, identity: 42 } },
    { ...validDomain, definition: { ...validDomain.definition, classification: [] } },
    { ...validDomain, definition: { ...validDomain.definition, hierarchy: { parentDomainUuid: "local-id" } } }
  ];
  for (const value of malformed) assert.doesNotThrow(() => validateDomainRecord(value));
  for (const value of malformed) assert.equal(validateDomainRecord(value).ok, false);
});

test("domain validator enforces defensive canonical limits", () => {
  assert.equal(validateDomainRecord({ ...validDomain, revision: Number.MAX_SAFE_INTEGER + 1 }).ok, false);
  assert.equal(validateDomainRecord({ ...validDomain, definition: { ...validDomain.definition, identity: { ...validDomain.definition.identity, summary: "x".repeat(501) } } }).ok, false);
  assert.equal(validateDomainRecord({ ...validDomain, definition: { ...validDomain.definition, identity: { ...validDomain.definition.identity, aliases: ["Atlas", "atlas"] } } }).ok, false);
  assert.equal(validateDomainRecord({ ...validDomain, definition: { ...validDomain.definition, classification: { ...validDomain.definition.classification, kind: "" } } }).ok, false);
});
