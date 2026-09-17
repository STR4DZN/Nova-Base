import assert from "node:assert/strict";
import test from "node:test";
import { validateDomainHierarchy, validateDomainReparent, type DomainHierarchyNode } from "../../src/domains/domain-hierarchy-validator.js";

const uuid = (id: string) => `JournalEntry.${id}`;

test("hierarchy accepts multiple roots and warns about a broken parent UUID", () => {
  const result = validateDomainHierarchy([
    { uuid: uuid("root-a"), parentDomainUuid: null },
    { uuid: uuid("root-b"), parentDomainUuid: null },
    { uuid: uuid("orphan"), parentDomainUuid: uuid("missing") }
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.warnings?.[0].code, "DM_DOMAIN_ORPHAN_PARENT");
});

test("hierarchy rejects cycles and self-parenting using canonical UUIDs", () => {
  const cyclic: readonly DomainHierarchyNode[] = [
    { uuid: uuid("a"), parentDomainUuid: uuid("b") },
    { uuid: uuid("b"), parentDomainUuid: uuid("a") }
  ];
  const cycle = validateDomainHierarchy(cyclic);
  assert.equal(cycle.ok, false);
  if (!cycle.ok) assert.equal(cycle.error.code, "DM_DOMAIN_HIERARCHY_CYCLE");

  const self = validateDomainReparent([{ uuid: uuid("a"), parentDomainUuid: null }], uuid("a"), uuid("a"));
  assert.equal(self.ok, false);
  if (!self.ok) assert.equal(self.error.code, "DM_DOMAIN_HIERARCHY_CYCLE");
});

test("reparent validator accepts a valid parent and rejects a missing parent", () => {
  const nodes = [
    { uuid: uuid("root"), parentDomainUuid: null },
    { uuid: uuid("child"), parentDomainUuid: null },
    { uuid: uuid("grandchild"), parentDomainUuid: uuid("child") }
  ];
  assert.equal(validateDomainReparent(nodes, uuid("child"), uuid("root")).ok, true);
  const missing = validateDomainReparent(nodes, uuid("child"), uuid("missing"));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, "DM_DOMAIN_PARENT_NOT_FOUND");
});

test("reparent validator blocks moving a node below its descendant", () => {
  const nodes = [
    { uuid: uuid("root"), parentDomainUuid: null },
    { uuid: uuid("child"), parentDomainUuid: uuid("root") },
    { uuid: uuid("grandchild"), parentDomainUuid: uuid("child") }
  ];
  const result = validateDomainReparent(nodes, uuid("root"), uuid("grandchild"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "DM_DOMAIN_HIERARCHY_CYCLE");
});

test("hierarchy rejects local IDs masquerading as Foundry UUIDs", () => {
  const result = validateDomainHierarchy([{ uuid: "root", parentDomainUuid: null }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "DM_INVALID_DOMAIN_HIERARCHY");
});
