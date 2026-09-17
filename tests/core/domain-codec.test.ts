import assert from "node:assert/strict";
import test from "node:test";
import {
  DOMAIN_FLAG_NAMESPACE,
  decodeDomainRecord,
  encodeDomainRecord
} from "../../src/storage/codecs/domain-codec.js";

const record = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: ["Base"], summary: "Summary", description: "Description" },
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
} as const;

test("domain codec round-trips the canonical payload", () => {
  const encoded = encodeDomainRecord(record);
  const decoded = decodeDomainRecord(encoded);

  assert.equal(DOMAIN_FLAG_NAMESPACE, "domain-manager");
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.value, record);
});

test("domain codec does not duplicate the primary name", () => {
  const encoded = encodeDomainRecord(record) as Record<string, unknown>;
  assert.equal("name" in encoded, false);
  assert.equal("name" in encoded.definition.identity, false);
});

test("domain codec canonicalizes aliases, tags and technical IDs deterministically", () => {
  const encoded = encodeDomainRecord({
    ...record,
    definition: {
      ...record.definition,
      identity: { ...record.definition.identity, aliases: [" Atlas ", "atlas", ""], summary: " Summary " },
      classification: { kind: " BASE ", scale: " Small ", tags: [" Front Line ", "front-line"] },
      capabilities: {
        enabled: ["DOMAIN-MANAGER:DOMAIN", "domain-manager:domain"],
        config: { "DOMAIN-MANAGER:DOMAIN": { mode: "safe" } }
      }
    }
  });

  assert.deepEqual(encoded.definition.identity.aliases, ["Atlas"]);
  assert.equal(encoded.definition.identity.summary, "Summary");
  assert.equal(encoded.definition.classification.kind, "base");
  assert.equal(encoded.definition.classification.scale, "small");
  assert.deepEqual(encoded.definition.classification.tags, ["front-line"]);
  assert.deepEqual(encoded.definition.capabilities.enabled, ["domain-manager:domain"]);
  assert.deepEqual(encoded.definition.capabilities.config, { "domain-manager:domain": { mode: "safe" } });
});
