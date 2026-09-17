import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRepository } from "../../src/storage/repositories/in-memory-repository.js";

interface Item {
  readonly id: string;
  readonly label: string;
}

test("in-memory repository reads by ID and reports presence", async () => {
  const repository = new InMemoryRepository<Item>(
    [{ id: "one", label: "One" }],
    (item) => item.id
  );

  assert.equal(await repository.has("one"), true);
  assert.deepEqual(await repository.get("one"), { id: "one", label: "One" });
  assert.equal(await repository.has("missing"), false);
  assert.equal(await repository.get("missing"), undefined);
});

test("in-memory repository lists a stable snapshot", async () => {
  const repository = new InMemoryRepository<Item>(
    [
      { id: "one", label: "One" },
      { id: "two", label: "Two" }
    ],
    (item) => item.id
  );

  assert.deepEqual(await repository.list(), [
    { id: "one", label: "One" },
    { id: "two", label: "Two" }
  ]);
});
