import assert from "node:assert/strict";
import test from "node:test";
import {
  DomainJournalEntryAdapter,
  type JournalEntryDocumentLike
} from "../../src/storage/adapters/domain-journal-entry-adapter.js";

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

test("adapter reads name separately from domain flags", () => {
  const document = {
    name: "Base",
    flags: { "domain-manager": record },
    update: async () => undefined
  } satisfies JournalEntryDocumentLike;

  const result = new DomainJournalEntryAdapter(document).read();
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.name, "Base");
});

test("adapter writes name and namespaced payload through injected boundary", async () => {
  let updateData: Record<string, unknown> | undefined;
  const document = {
    name: "Old",
    update: async (data: Record<string, unknown>) => { updateData = data; }
  } satisfies JournalEntryDocumentLike;

  const result = await new DomainJournalEntryAdapter(document).write("New", record);
  assert.equal(result.ok, true);
  assert.equal(updateData?.name, "New");
  assert.deepEqual(updateData?.["flags.domain-manager"], record);
});
