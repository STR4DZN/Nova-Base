import test from "node:test";
import assert from "node:assert/strict";
import { ok, type Result } from "../../src/core/contracts/result.js";
import { linkFields, parseLinkFields, parseLinkStatus, renderLinkFields, renderLinkStatusFields, renderTerritoryLinks, renderLinkRequest } from "../../src/ui/domain-patterns/diplomacy/territory-link-form.js";
import { DiplomacyApplicationController, DiplomacyApplication } from "../../src/ui/domain-patterns/diplomacy/diplomacy-app.js";
const unwrap = <T>(r: Result<T>): T => { if (!r.ok) assert.fail(JSON.stringify(r.error)); return r.value; };
const destinations = [{ id: "JournalEntry.destination", label: "Destination" }], source = "JournalEntry.source";
const fields = (patch = {}) => ({ ...linkFields(), linkTarget: destinations[0].id, linkRevision: "0", reason: "Road", ...patch });
const parse = (patch = {}, tick = 10) => parseLinkFields(fields(patch), source, destinations, tick, "road", { type: "manual", id: "ui" });
function controller(isGm = true) {
  let target: any = { id: source, label: "Region", revision: 0, worldTick: 10, territory: { kind: "region", scale: "small" }, claims: [], recognitions: [], presence: [], rights: [], links: [unwrap(parse()).value], occupations: [], effectiveInfluence: [], events: [] };
  let fail = ""; const calls: any[] = [], api: any = {};
  for (const tab of ["territory", "proposals", "relations", "agreements", "reputation", "disputes"]) api[tab] = {
    query: async (q: any) => { calls.push({ tab, mode: "query", q });
      if (fail === "all" || fail === "destinations" && tab === "territory" && !q.id) return { ok: false, error: { code: "FAIL", message: "Unavailable", severity: "error" } };
      if (tab === "territory" && q.id === destinations[0].id) return ok({ ...destinations[0], claims: [], worldTick: 10 });
      return ok(q.id ? target : { items: destinations, isGm, worldTick: 10, total: 65, offset: q.offset ?? 0, limit: q.limit ?? 30 }); },
    modify: async (p: any) => { calls.push({ mode: "modify", p }); return fail ? { ok: false, error: { code: "FAIL", message: "Unavailable", severity: "error" } } : ok({}); }
  };
  api.proposals.submit = async (p: any) => { calls.push({ mode: "submit", p }); return fail ? { ok: false, error: { code: "FAIL", message: "Unavailable", severity: "error" } } : ok({}); };
  api.proposals.decide = async (p: any) => { calls.push({ mode: "decide", p }); return ok({}); };
  const c = new DiplomacyApplicationController(api); c.selectTab("territory"); c.select(source); c.detail = target; c.list = { isGm, worldTick: 10 }; c.linkDestinations = destinations; c.linkDestinationPage = { items: destinations, total: 65, offset: 0, limit: 30 };
  return { c, calls, fail: (s = "all") => fail = s, target: (t: any) => target = t };
}
test("G6 links UI: direction, status and optional fields create complete declarative source", () => {
  for (const direction of ["both", "inbound", "outbound"]) for (const status of ["operational", "limited", "closed", "destroyed"]) {
    const a = unwrap(parse({ linkDirection: direction, linkStatus: status })); assert.equal(a.value.direction, direction); assert.equal(a.value.status, status); assert.equal(a.value.cost, null); assert.equal(a.value.capacity, null); assert.deepEqual(a.value.dependencyRefs, []); assert.equal(a.value.startsAtWorldTick, 10);
  }
});
test("G6 links UI: only admitted destination, excluding self, can be selected", () => {
  for (const linkTarget of [source, "JournalEntry.secret-marker", "", "Actor.actor"]) assert.equal(parse({ linkTarget }).ok, false);
  assert.equal(parseLinkFields(fields(), source, [], 10, "road", { type: "manual", id: "ui" }).ok, false);
});
test("G6 links UI: namespace, direction, operational status and visibility reject malformed values", () => {
  for (const patch of [{ linkType: "road" }, { linkType: "Upper:bad" }, { linkDirection: "either" }, { linkStatus: "active" }, { linkVisibility: "private" }]) assert.equal(parse(patch).ok, false);
});
test("G6 links UI: zero, nullable cost/capacity and safe integer boundaries remain distinct", () => {
  const l = unwrap(parse({ linkCost: "0", linkCapacity: String(Number.MAX_SAFE_INTEGER) })).value; assert.equal(l.cost, 0); assert.equal(l.capacity, Number.MAX_SAFE_INTEGER);
  for (const value of ["-1", "1.5", "bad", String(Number.MAX_SAFE_INTEGER + 1)]) for (const name of ["linkCost", "linkCapacity"]) assert.equal(parse({ [name]: value }).ok, false);
});
test("G6 links UI: temporal windows use explicit clock, inclusive start and exclusive end", () => {
  assert.equal(unwrap(parse({}, 0)).value.startsAtWorldTick, 0); assert.equal(unwrap(parse({ linkStarts: "0", linkExpires: "1" })).value.expiresAtWorldTick, 1);
  for (const patch of [{ linkStarts: "-1" }, { linkStarts: "1.5" }, { linkExpires: "10" }, { linkExpires: "bad" }]) assert.equal(parse(patch).ok, false);
  assert.equal(parseLinkFields(fields(), source, destinations, undefined as any, "road", { type: "manual", id: "ui" }).ok, false);
});
test("G6 links UI: typed dependency JSON validates and roundtrips without running operations", () => {
  const l = unwrap(parse({ linkDependencies: JSON.stringify([{ type: "facility", id: "bridge" }, { type: "agreement", uuid: "JournalEntry.treaty" }]), linkCost: "0", linkCapacity: "2", linkStarts: "0", linkExpires: "20" })).value;
  assert.deepEqual(unwrap(parseLinkFields(linkFields(l), source, destinations, 10, l.id, l.sourceRef)).value, l);
  for (const linkDependencies of ["{bad", "{}", '[{"type":"facility"}]', '[{"type":"facility","id":"a","uuid":"JournalEntry.a"}]']) assert.equal(parse({ linkDependencies }).ok, false);
});
test("G6 links UI: status update only touches admitted link ID and status", () => {
  const l = unwrap(parse()).value; assert.deepEqual(unwrap(parseLinkStatus({ linkId: l.id, linkStatus: "closed" }, [l])), { kind: "update-link", id: l.id, status: "closed" });
  assert.equal(parseLinkStatus({ linkId: "secret-marker", linkStatus: "closed" }, [l]).ok, false); assert.equal(parseLinkStatus({ linkId: l.id, linkStatus: "broken" }, [l]).ok, false);
});
test("G6 links UI: summary counts visible declarations in current windows and renders history", () => {
  const l = unwrap(parse()).value, links = [{ ...l, id: "expired", status: "operational", expiresAtWorldTick: 10 }, { ...l, id: "future", startsAtWorldTick: 11 }, { ...l, id: "current", status: "limited" }];
  const h = renderTerritoryLinks({ revision: 0, links }, 10, false, destinations, { items: destinations, total: 1, offset: 0, limit: 30 }, "", {}, {}, "");
  assert.ok(h.includes("0 operacional · 1 limitada")); assert.ok(h.includes("Agendada")); assert.ok(h.includes("Expirada")); assert.ok(h.includes("Propor novo estado ao GM")); assert.ok(h.includes("não concede" ) === false); assert.ok(h.includes("nem concede direito"));
});
test("G6 links UI: HTML escaping and unavailable selection do not reflect private target markers", () => {
  const h = renderLinkFields([{ id: '\" onclick=\"bad', label: "<script>bad</script>" }], fields({ linkTarget: "secret-selection-marker", linkType: '\" onclick=\"bad', linkDependencies: "</textarea><script>" }));
  assert.equal(h.includes("<script>"), false); assert.equal(h.includes("secret-selection-marker"), false); assert.ok(h.includes("&quot;")); assert.ok(h.includes("Destino anterior indisponível"));
  assert.equal(renderLinkRequest({ kind: "update-link", id: "<script>", status: "closed" }).includes("<script>"), false);
});
test("G6 links UI: advanced defaults collapsed, destination failure clears form and status remains independent", () => {
  assert.ok(renderLinkFields(destinations, {}).includes("<details><summary>Custo"));
  const h = renderTerritoryLinks({ revision: 0, links: [unwrap(parse()).value] }, 10, true, [], null, "", {}, {}, "Destinos indisponíveis");
  assert.equal(h.includes('data-dm-form="territory-link"'), false); assert.ok(h.includes('data-dm-form="territory-link-status"')); assert.ok(h.includes("Destinos indisponíveis"));
});
test("G6 links UI: GM owner mutation versus Player proposal preserves local sources", async () => {
  for (const isGm of [true, false]) { const { c, calls } = controller(isGm), before = structuredClone(c.detail);
    unwrap(await c.submitLink(fields())); const p = calls.at(-1); assert.equal(p.mode, isGm ? "modify" : "submit"); const intent = isGm ? p.p : p.p.intent;
    assert.equal(intent.action.kind, "link"); assert.equal(intent.action.value.targetTerritoryUuid, destinations[0].id); assert.deepEqual(c.detail, before); assert.deepEqual(c.territoryLinkFields, {});
    unwrap(await c.submitLink({ linkId: "road", linkStatus: "closed", linkRevision: "0", reason: "Closure" }, true)); assert.equal((isGm ? calls.at(-1).p : calls.at(-1).p.intent).action.kind, "update-link"); }
});
test("G6 links UI: failed create retains fields and stable source ID, revision and reason guard both forms", async () => {
  const { c, calls, fail } = controller(); fail(); assert.equal((await c.submitLink(fields())).ok, false); const id = calls.at(-1).p.action.value.id;
  assert.equal((await c.submitLink(fields())).ok, false); assert.equal(calls.at(-1).p.action.value.id, id); assert.equal(c.territoryLinkFields.reason, "Road");
  const count = calls.length; c.detail.revision = 1; assert.equal((await c.submitLink(fields())).ok, false); assert.equal((await c.submitLink({ linkId: "road", linkStatus: "closed", linkRevision: "0", reason: "Closure" }, true)).ok, false);
  assert.equal((await c.submitLink(fields({ linkRevision: "1", reason: " " }))).ok, false); assert.equal(calls.length, count);
});
test("G6 links UI: search and pagination are independent and preserve selected target and draft", async () => {
  const { c, calls } = controller(); c.territoryLinkFields = fields(); c.offset = 90; c.applyDestinationSearch("  Destination  "); c.linkDestinationOffset = 30; await c.loadLinkDestinations(source);
  assert.equal(c.offset, 90); assert.equal(c.territoryLinkFields.reason, "Road"); assert.equal(calls[0].q.limit, 30); assert.equal(calls[0].q.offset, 30); assert.equal(calls[0].q.search, "Destination"); c.applyDestinationSearch("Elsewhere"); assert.equal(c.linkDestinationOffset, 0);
});
test("G6 links UI: context switch/reset and failed read remove stale destination data", async () => {
  const { c, fail } = controller(); c.territoryLinkFields = fields(); c.linkReviewFields = fields(); c.select("Other"); assert.deepEqual(c.territoryLinkFields, {}); assert.deepEqual(c.linkReviewFields, {}); assert.deepEqual(c.linkDestinations, []);
  c.selectTab("territory"); c.select(source); fail(); assert.equal((await c.load()).ok, false); assert.equal(c.detail, null); assert.equal(c.linkDestinationPage, null); assert.deepEqual(c.linkDestinations, []);
});
test("G6 links UI: GM structured review preserves original ID/source and original request", async () => {
  const { c, calls } = controller(), target = c.detail, original = { kind: "territory", mode: "modify", id: source, expectedRevision: 0, action: unwrap(parse()), reason: "Original" }, before = structuredClone(original);
  c.selectTab("proposals"); c.list = { isGm: true }; c.detail = { id: "proposal", revision: 0, original }; c.linkReviewTarget = target; c.linkDestinations = destinations;
  unwrap(await c.review("approve", " Revised ", { ...fields({ linkStatus: "limited", linkCapacity: "0" }), linkReview: "on", targetRevision: "1" })); const p = calls.at(-1).p;
  assert.equal(p.editedIntent.action.value.status, "limited"); assert.equal(p.editedIntent.action.value.capacity, 0); assert.equal(p.editedIntent.action.value.id, original.action.value.id); assert.deepEqual(p.editedIntent.action.value.sourceRef, original.action.value.sourceRef); assert.equal(p.editedIntent.expectedRevision, 1); assert.equal(p.reason, "Revised"); assert.deepEqual(original, before);
});
test("G6 links UI: review status cannot switch link ID, invalid approval retained, rejection independent", async () => {
  const { c, calls } = controller(), target = c.detail; c.selectTab("proposals"); c.list = { isGm: true }; c.detail = { id: "proposal", revision: 0, original: { kind: "territory", mode: "modify", id: source, expectedRevision: 0, action: { kind: "update-link", id: "road", status: "closed" }, reason: "Close" } }; c.linkReviewTarget = target;
  assert.equal((await c.review("approve", "Review", { linkReview: "on", linkStatus: "invalid" })).ok, false); assert.equal(c.linkReviewFields.linkStatus, "invalid");
  unwrap(await c.review("approve", "Review", { linkReview: "on", linkId: "other", linkStatus: "limited" })); assert.equal(calls.at(-1).p.editedIntent.action.id, "road");
  c.linkReviewTarget = null; assert.equal((await c.review("reject", " ", { linkReview: "on" })).ok, false); unwrap(await c.review("reject", "Reject", { linkReview: "on", linkStatus: "bad" })); assert.equal(Object.hasOwn(calls.at(-1).p, "editedIntent"), false);
});
test("G6 links UI: application binds both forms, search, pagination and resets", async () => {
  const { c } = controller(), app = new DiplomacyApplication({ api: c.api }), listeners: Record<string, Function> = {}, saved = globalThis.FormData;
  app.controller.selectTab("territory"); app.controller.select(source); app.controller.detail = c.detail; app.controller.list = c.list; app.controller.linkDestinations = destinations;
  (app as any).element = { addEventListener: (e: string, fn: Function) => listeners[e] = fn }; (app as any).render = async () => {};
  (globalThis as any).FormData = class { constructor(readonly form: any) {} forEach(fn: Function) { Object.entries(this.form.values).forEach(([k, v]) => fn(v, k)); } };
  try { (app as any)._onRender();
    await listeners.submit({ target: { dataset: { dmForm: "territory-link" }, values: fields() }, preventDefault() {} });
    await listeners.submit({ target: { dataset: { dmForm: "territory-link-status" }, values: { linkId: "road", linkStatus: "closed", linkRevision: "0", reason: "Close" } }, preventDefault() {} });
    await listeners.submit({ target: { dataset: { dmForm: "link-destinations" }, values: { destinationSearch: "Road" } }, preventDefault() {} }); assert.equal(app.controller.linkDestinationSearch, "Road");
    await listeners.click({ target: { closest: () => ({ dataset: { dmLinkPage: "1" } }) } }); assert.equal(app.controller.linkDestinationOffset, 30);
    app.controller.territoryLinkFields = fields(); await listeners.click({ target: { closest: () => ({ dataset: { dmLinkReset: "true" } }) } }); assert.deepEqual(app.controller.territoryLinkFields, {});
  } finally { (globalThis as any).FormData = saved; }
});
