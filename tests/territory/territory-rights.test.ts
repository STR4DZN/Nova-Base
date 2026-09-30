import test from "node:test";
import assert from "node:assert/strict";
import type { Result } from "../../src/core/contracts/result.js";
import { emptyTerritoryState, type TerritoryState, type TerritoryRight } from "../../src/territory/territory-state.js";
import { resolveTerritoryRights, resolveTerritoryClaims, resolveTerritoryLinks } from "../../src/territory/territory-rights.js";
import { createDefaultCapabilityResolver } from "../../src/aggregation/capability-resolver.js";
import { AgreementTermRegistry, changeAgreement, type AgreementDefinition, type AgreementInstance, type AgreementAction } from "../../src/agreements/agreement-model.js";
import { registerAgreementTermOwners } from "../../src/agreements/agreement-obligations.js";
import type { DiplomacyCapabilityContext } from "../../src/aggregation/diplomacy-capability-providers.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const party = (id = "a") => ({ type: "domain" as const, uuid: `JournalEntry.${id}` });
const state = (id: string, parent: string | null = null): TerritoryState => emptyTerritoryState({ schemaVersion: 1, uuid: `JournalEntry.${id}`, revision: 0,
  label: id, kind: "test:region", scale: "region", visibility: "public", createdAt: 0, updatedAt: 0, geography: {},
  hierarchyHistory: [], locatedInUuid: parent === null ? null : `JournalEntry.${parent}`, administrativeParentUuid: null });
const source = (id: string) => ({ id, sourceRef: { type: "manual", id: "gm" }, visibility: "public" as const, startsAtWorldTick: 0, expiresAtWorldTick: null });
const right = (id = "right"): TerritoryRight => ({ ...source(id), beneficiaryRef: party(), rightType: "test:build", active: true,
  inherited: true, revocable: true, conditionRefs: [], grants: ["test:construction"] });
const c = { worldTick: 10, canSee: (v: string) => v === "public", conditionSatisfied: () => false, inheritanceAxis: "locatedInUuid" as const };
const graph = () => [{ ...state("root"), rights: [right()] }, state("child", "root")];
test("G6.8: inherited rights carry origin and beneficiary, without copies in descendants", () => {
  const states = graph(), before = structuredClone(states), rights = unwrap(resolveTerritoryRights(states, "JournalEntry.child", party(), c));
  assert.equal(rights.length, 1); assert.equal(rights[0].sourceTerritoryUuid, "JournalEntry.root"); assert.equal(rights[0].inherited, true);
  assert.equal(rights[0].territoryUuid, "JournalEntry.child"); assert.deepEqual(states, before); assert.equal(states[1].rights.length, 0);
  assert.equal(unwrap(resolveTerritoryRights(states, "JournalEntry.child", party("other"), c)).length, 0);
});
test("G6.8: non-inheritable rights stay local and administrative policy may differ", () => {
  const states = graph(); states[0] = { ...states[0], rights: [{ ...right(), inherited: false }] };
  assert.equal(unwrap(resolveTerritoryRights(states, "JournalEntry.child", party(), c)).length, 0);
  assert.equal(unwrap(resolveTerritoryRights(states, "JournalEntry.root", party(), c)).length, 1);
  assert.equal(unwrap(resolveTerritoryRights(graph(), "JournalEntry.child", party(), { ...c, inheritanceAxis: "administrativeParentUuid" })).length, 0);
});
test("G6.8: expires/conditions/revocation remove grants but preserve source/history", () => {
  const states = graph(); states[0] = { ...states[0], rights: [{ ...right(), expiresAtWorldTick: 10 }] };
  assert.equal(unwrap(resolveTerritoryRights(states, "JournalEntry.child", party(), c)).length, 0);
  assert.equal(states[0].rights.length, 1);
  states[0] = { ...states[0], rights: [{ ...right(), conditionRefs: [{ type: "requirement", id: "facility" }] }] };
  assert.equal(unwrap(resolveTerritoryRights(states, "JournalEntry.child", party(), c)).length, 0);
  assert.equal(unwrap(resolveTerritoryRights(states, "JournalEntry.child", party(), { ...c, conditionSatisfied: () => true })).length, 1);
  states[0] = { ...states[0], rights: [{ ...right(), active: false }] }; assert.equal(unwrap(resolveTerritoryRights(states, "JournalEntry.child", party(), c)).length, 0);
});
test("G6.8: hidden parents/rights cannot contribute public capabilities; explicit access policy can block", () => {
  const states = graph(); states[0] = { ...states[0], territory: { ...states[0].territory, visibility: "secret" } };
  assert.equal(unwrap(resolveTerritoryRights(states, "JournalEntry.child", party(), c)).length, 0);
  assert.equal(unwrap(resolveTerritoryRights(graph(), "JournalEntry.child", party(), { ...c, accessAllowed: () => false })).length, 0);
});
test("G6.8: claims inherit by policy and keep all competing sources with no winner", () => {
  const states = graph(); states[0] = { ...states[0], claims: ["a", "b"].map(id => ({ ...source(id), claimantRef: party(id), claimType: "test:ownership",
    lifecycle: "active", contested: true, inherited: true, strength: 10 })) };
  const claims = unwrap(resolveTerritoryClaims(states, "JournalEntry.child", c)); assert.equal(claims.length, 2); assert.equal(claims[0].inherited, true);
  assert.equal(states[1].claims.length, 0); assert.equal(resolveTerritoryClaims(states, "JournalEntry.child", { ...c, worldTick: -1 }).ok, false);
});
test("G6.8: link resolution respects outbound/both/operational/dependency and hidden target", () => {
  const states = graph(); states[0] = { ...states[0], links: [{ ...source("route"), targetTerritoryUuid: "JournalEntry.child", linkType: "test:route",
    direction: "outbound", status: "operational", cost: null, capacity: null, dependencyRefs: [] }] };
  assert.equal(resolveTerritoryLinks(states, "JournalEntry.root", c).length, 1); assert.equal(resolveTerritoryLinks(states, "JournalEntry.child", c).length, 0);
  states[0] = { ...states[0], links: [{ ...states[0].links[0], direction: "both" }] };
  assert.equal(resolveTerritoryLinks(states, "JournalEntry.child", c)[0].targetTerritoryUuid, "JournalEntry.root");
  states[0] = { ...states[0], links: [{ ...states[0].links[0], dependencyRefs: [{ type: "agreement", id: "treaty" }] }] };
  assert.equal(resolveTerritoryLinks(states, "JournalEntry.root", c).length, 0);
});
const definition: AgreementDefinition = { id: "test:treaty", version: 1, label: "Treaty", minParties: 2, maxParties: 2,
  allowedPartyRoles: ["signatory"], allowedTermTypes: ["domain-manager:capability"], amendmentRequiresApproval: true,
  automaticRenewalAllowed: false, effectiveLifecycles: ["active", "breached"] };
function agreement(): AgreementInstance {
  const registry = new AgreementTermRegistry(); unwrap(registerAgreementTermOwners(registry));
  let a: AgreementInstance = { schemaVersion: 1, id: "treaty", definitionId: definition.id, definitionVersion: 1, label: "Access treaty", revision: 0,
    parties: ["a", "b"].map(id => ({ id, role: "signatory", ref: party(id) })), visibility: "public", terms: [],
    duration: { startsAtWorldTick: null, expiresAtWorldTick: 20 }, lifecycle: "draft", createdAt: 0, updatedAt: 0,
    proposals: [], amendments: [], events: [], supersedesId: null };
  const change = (action: AgreementAction) => { a = unwrap(changeAgreement(a, definition, registry, { expectedRevision: a.revision,
    eventId: crypto.randomUUID(), at: a.updatedAt + 1, worldTick: 1, reason: "GM approval", sourceRefs: [{ type: "manual", id: "gm" }] }, action)); };
  change({ kind: "propose", proposalId: "proposal", partyId: "a", proposalExpiresAtWorldTick: 10, duration: a.duration,
    terms: [{ id: "grant", type: "domain-manager:capability", title: "Build", text: "", partyIds: ["a"], visibility: "public",
      payload: { beneficiaryPartyId: "a", capabilityIds: ["test:construction"], scopeRef: null, conditionRefs: [] } }] });
  for (const partyId of ["a", "b"]) change({ kind: "accept", proposalId: "proposal", expectedProposalRevision: a.proposals[0].revision, partyId });
  change({ kind: "activate", proposalId: "proposal", expectedProposalRevision: a.proposals[0].revision }); return a;
}
const diplomacy = (): DiplomacyCapabilityContext => ({ worldTick: 10, agreements: [{ agreement: agreement(), definition }], territories: graph(), territoryUuid: "JournalEntry.child",
  canSee: c.canSee, conditionSatisfied: c.conditionSatisfied });
test("G6.8: default CapabilityResolver merges agreement/territory provenance without persistence", () => {
  const d = diplomacy(), before = structuredClone({ agreements: d.agreements, territories: d.territories });
  const report = createDefaultCapabilityResolver().resolveEffectiveCapabilities({ domainUuid: "JournalEntry.a", diplomacy: d });
  assert.deepEqual(report.enabledCapabilityIds, ["test:construction"]); const sources = report.grantsByCapability["test:construction"];
  assert.equal(sources.length, 2); assert.equal(sources[0].sourceType, "agreement"); assert.equal(sources[1].sourceType, "territory-right");
  assert.equal(sources[1].inherited, true); assert.deepEqual({ agreements: d.agreements, territories: d.territories }, before);
});
test("G6.8: agreement expiry removes only its grant; other valid owners keep same capability", () => {
  const d = diplomacy(), r = createDefaultCapabilityResolver().resolveEffectiveCapabilities({ domainUuid: "JournalEntry.a", diplomacy: { ...d, worldTick: 20 } });
  assert.equal(r.grantsByCapability["test:construction"].length, 1); assert.equal(r.grantsByCapability["test:construction"][0].sourceType, "territory-right");
  assert.equal(d.agreements[0].agreement.lifecycle, "active"); assert.equal(d.agreements[0].agreement.terms.length, 1);
});
test("G6.8: scoped treaty grants never become domain-global and hidden treaty gives no public grant", () => {
  const d = diplomacy(), a = d.agreements[0].agreement, scoped = { ...a, terms: a.terms.map(t => ({ ...t,
    payload: { ...t.payload, scopeRef: { type: "territory", uuid: "JournalEntry.root" } } })) };
  const report = createDefaultCapabilityResolver().resolveEffectiveCapabilities({ domainUuid: "JournalEntry.a", diplomacy: { ...d, territories: [], territoryUuid: undefined,
    agreements: [{ agreement: scoped, definition }] } }); assert.equal(report.enabledCapabilityIds.length, 0);
  const hidden = createDefaultCapabilityResolver().resolveEffectiveCapabilities({ domainUuid: "JournalEntry.a", diplomacy: { ...d, territories: [],
    agreements: [{ agreement: { ...a, visibility: "secret" }, definition }] } }); assert.equal(hidden.enabledCapabilityIds.length, 0);
});
test("G6.8: missing diplomacy context keeps existing default behavior and wrong time fails closed", () => {
  const resolver = createDefaultCapabilityResolver(); assert.equal(resolver.resolveEffectiveCapabilities({ domainUuid: "JournalEntry.a" }).enabledCapabilityIds.length, 0);
  assert.equal(resolver.resolveEffectiveCapabilities({ domainUuid: "JournalEntry.a", diplomacy: { ...diplomacy(), worldTick: -1 } }).enabledCapabilityIds.length, 0);
});
