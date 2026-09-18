import assert from "node:assert/strict";
import test from "node:test";
import { buildPeopleViewModel } from "../../src/ui/domain-patterns/people/people-presenter.js";
import { renderPeopleSubsystemHtml } from "../../src/ui/domain-patterns/people/people-view.js";
import {
  createDefaultDomainPeopleData,
  withDomainPeopleData,
  type DomainPeopleData
} from "../../src/people/people-data.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";

const baseRecord: DomainRecord = {
  schemaVersion: 1,
  revision: 0,
  definition: {
    identity: { aliases: [], summary: "Summary", description: "Description" },
    classification: { kind: "base", scale: "small", tags: ["starter"] },
    hierarchy: { parentDomainUuid: null },
    capabilities: { enabled: ["domain-manager:domain"], config: {} }
  },
  state: { lifecycle: "active" },
  metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
};

test("G3.9 - People UI: Presenter builds sanitized view model according to viewer role", () => {
  const notPublicId = createOpaqueId("not");
  const notSecretId = createOpaqueId("not");
  const rolePublicId = createOpaqueId("role");
  const roleSecretId = createOpaqueId("role");
  const opgPublicId = createOpaqueId("opg");
  const opgSecretId = createOpaqueId("opg");

  const people: DomainPeopleData = {
    ...createDefaultDomainPeopleData(),
    population: {
      mode: "manual",
      total: 1250,
      precision: "estimated"
    },
    notables: [
      {
        id: notPublicId,
        type: "inline",
        name: "Mayor Goodfellow",
        visibility: "public",
        tags: []
      },
      {
        id: notSecretId,
        type: "inline",
        name: "Shadow Agent",
        visibility: "secret",
        tags: []
      }
    ],
    roles: [
      {
        id: rolePublicId,
        definitionId: "domain-manager:leader",
        occupants: [notPublicId],
        visibility: "public",
        tags: []
      },
      {
        id: roleSecretId,
        definitionId: "domain-manager:councilor",
        occupants: [],
        visibility: "secret",
        tags: []
      }
    ],
    operationalGroups: [
      {
        id: opgPublicId,
        name: "City Guard",
        definitionId: "domain-manager:militia",
        membershipMode: "abstract",
        size: 20,
        members: [],
        lifecycle: "active",
        visibility: "public",
        tags: []
      },
      {
        id: opgSecretId,
        name: "Black Operations",
        definitionId: "domain-manager:scout-patrol",
        membershipMode: "abstract",
        size: 5,
        members: [],
        lifecycle: "active",
        visibility: "secret",
        tags: []
      }
    ]
  };

  const domain = withDomainPeopleData(baseRecord, people);

  // 1. GM View: contains all items
  const gmVM = buildPeopleViewModel(domain, { viewerIsGm: true });
  assert.equal(gmVM.notables.length, 2);
  assert.equal(gmVM.roles.length, 2);
  assert.equal(gmVM.operationalGroups.length, 2);
  assert.equal(gmVM.population.formattedTotal, "1,250 (est.)");

  // 2. Player View: secret items stripped
  const playerVM = buildPeopleViewModel(domain, { viewerIsGm: false });
  assert.equal(playerVM.notables.length, 1);
  assert.equal(playerVM.notables[0].notable.id, notPublicId);
  assert.equal(playerVM.roles.length, 1);
  assert.equal(playerVM.roles[0].evaluation.role.id, rolePublicId);
  assert.equal(playerVM.operationalGroups.length, 1);
  assert.equal(playerVM.operationalGroups[0].group.id, opgPublicId);
});

test("G3.9 - People UI: View renders semantic HTML", () => {
  const notId = createOpaqueId("not");
  const roleId = createOpaqueId("role");

  const people: DomainPeopleData = {
    ...createDefaultDomainPeopleData(),
    population: {
      mode: "manual",
      total: 500,
      precision: "exact"
    },
    notables: [
      {
        id: notId,
        type: "inline",
        name: "Elder Theresa",
        visibility: "public",
        tags: []
      }
    ],
    roles: [
      {
        id: roleId,
        definitionId: "domain-manager:leader",
        occupants: [notId],
        visibility: "public",
        tags: []
      }
    ]
  };

  const domain = withDomainPeopleData(baseRecord, people);
  const vm = buildPeopleViewModel(domain, { viewerIsGm: true });
  const html = renderPeopleSubsystemHtml(vm);

  assert.ok(html.includes("dm-people-subsystem"));
  assert.ok(html.includes("Elder Theresa"));
  assert.ok(html.includes("Leader"));
  assert.ok(html.includes("500"));
});
