import assert from "node:assert/strict";
import test from "node:test";
import { calculateWorkforce } from "../../src/people/workforce/workforce-calculator.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import { PeopleReadRepository } from "../../src/people/repositories/people-read-repository.js";
import { createDefaultDomainPeopleData } from "../../src/people/people-data.js";
import { ok } from "../../src/core/contracts/result.js";
const group = (type: string, amount: number) => ({ id: createOpaqueId("pop"), name: "Group", count: amount, includedInTotal: true, tags: [],
  workforceContributions: [{ workforceTypeId: type, amount }] });
test("review G3: unsafe workforce capacity fails closed instead of authorizing rounded capacity", () => {
  assert.throws(() => calculateWorkforce({ populationGroups: [group("general", Number.MAX_SAFE_INTEGER), group("general", 2)] } as any), /DM_PEOPLE_WORKFORCE_OVERFLOW/);
});
test("review G3: unsafe workforce totals fail closed even when each type is individually valid", () => {
  assert.throws(() => calculateWorkforce({ populationGroups: [group("general", Number.MAX_SAFE_INTEGER), group("military", 2)] } as any), /DM_PEOPLE_WORKFORCE_OVERFLOW/);
});
test("review G3: workforce repository returns a typed overflow error after filtering the viewer's sources", async () => {
  const people = { ...createDefaultDomainPeopleData(), populationGroups: [group("general", Number.MAX_SAFE_INTEGER), { ...group("general", 2), visibility: "secret" }] };
  const repository = new PeopleReadRepository({ read: async () => ok({ record: { definition: { capabilities: {
    enabled: ["domain-manager:people"], config: { "domain-manager:people": people } } } } }) } as any);
  const gm = await repository.getWorkforce("JournalEntry.test", { viewerIsGm: true });
  assert.equal(gm.ok, false); if (!gm.ok) assert.equal(gm.error.code, "DM_PEOPLE_WORKFORCE_OVERFLOW");
  const player = await repository.getWorkforce("JournalEntry.test", { viewerIsGm: false });
  assert.equal(player.ok, true); if (player.ok) assert.equal(player.value.totalCapacity, Number.MAX_SAFE_INTEGER);
});
