import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeHtml,
  escapeAttribute,
  renderPeopleSubsystemHtml,
  createPeopleApplicationV2Context
} from "../../src/ui/domain-patterns/people/people-view.js";
import { buildPeopleViewModel } from "../../src/ui/domain-patterns/people/people-presenter.js";
import {
  createDefaultDomainPeopleData,
  withDomainPeopleData,
  type DomainPeopleData
} from "../../src/people/people-data.js";
import type { DomainRecord } from "../../src/domains/domain-schema.js";
import { createOpaqueId } from "../../src/core/identity/ids.js";

test("G3 UI Security: escapeHtml and escapeAttribute correctly escape dangerous HTML characters", () => {
  const dangerous = `<script>alert("xss" & 'injection')</script>`;
  const escaped = escapeHtml(dangerous);

  assert.equal(escaped.includes("<script>"), false);
  assert.equal(escaped.includes("</script>"), false);
  assert.equal(escaped.includes("&lt;script&gt;"), true);
  assert.equal(escaped.includes("&quot;xss&quot;"), true);
  assert.equal(escaped.includes("&amp;"), true);
  assert.equal(escaped.includes("&#39;injection&#39;"), true);

  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeAttribute(dangerous), escaped);
});

test("G3 UI Security: renderPeopleSubsystemHtml escapes malicious strings across all People components", () => {
  const notId = createOpaqueId("not");
  const roleId = createOpaqueId("role");
  const opgId = createOpaqueId("opg");

  const xssNotableName = `<script>alert("hacked-notable")</script>`;
  const xssRoleLabel = `"><img src=x onerror=alert('hacked-role')>`;
  const xssGroupName = `<svg onload=alert('hacked-group')>`;

  const people: DomainPeopleData = {
    ...createDefaultDomainPeopleData(),
    population: {
      mode: "manual",
      total: 100,
      precision: "exact"
    },
    notables: [
      {
        id: notId,
        type: "inline",
        name: xssNotableName,
        visibility: "public",
        tags: []
      }
    ],
    roles: [
      {
        id: roleId,
        definitionId: "custom:role",
        customLabel: xssRoleLabel,
        occupants: [notId],
        visibility: "public",
        tags: []
      }
    ],
    operationalGroups: [
      {
        id: opgId,
        name: xssGroupName,
        definitionId: "domain-manager:labor-squad",
        membershipMode: "abstract",
        size: 10,
        members: [],
        lifecycle: "active",
        visibility: "public",
        tags: []
      }
    ]
  };

  const domainRecord: DomainRecord = {
    schemaVersion: 1,
    revision: 0,
    definition: {
      identity: { aliases: [], summary: "Summary", description: "Description" },
      classification: { kind: "base", scale: "small", tags: [] },
      hierarchy: { parentDomainUuid: null },
      capabilities: { enabled: ["domain-manager:domain", "domain-manager:people"], config: {} }
    },
    state: { lifecycle: "active" },
    metadata: { createdByUserId: null, archivedAt: null, source: { type: "manual", ref: null } }
  };

  const domain = withDomainPeopleData(domainRecord, people);
  const vm = buildPeopleViewModel(domain, { viewerIsGm: true });

  const html = renderPeopleSubsystemHtml(vm);

  // Assert NO raw script, img onerror, or svg onload in rendered HTML
  assert.equal(html.includes("<script>"), false, "Must not contain unescaped <script>");
  assert.equal(html.includes("</script>"), false, "Must not contain unescaped </script>");
  assert.equal(html.includes("<img src=x onerror"), false, "Must not contain unescaped img onerror");
  assert.equal(html.includes("<svg onload"), false, "Must not contain unescaped svg onload");

  // Assert escaped representations are present
  assert.ok(html.includes("&lt;script&gt;alert(&quot;hacked-notable&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("&quot;&gt;&lt;img src=x onerror=alert(&#39;hacked-role&#39;)&gt;"));
  assert.ok(html.includes("&lt;svg onload=alert(&#39;hacked-group&#39;)&gt;"));

  // Verify ApplicationV2 context helper
  const appV2Ctx = createPeopleApplicationV2Context(vm);
  assert.equal(appV2Ctx.html, html);
  assert.equal(appV2Ctx.viewModel, vm);
});
