import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePrimaryAuthorityUserId,
  type AuthorityElectionUser
} from "../../src/authority/primary-authority-election.js";

const gm = (id: string, active = true): AuthorityElectionUser => ({ id, isGM: true, active });
const player = (id: string, active = true): AuthorityElectionUser => ({ id, isGM: false, active });

test("preferred active GM wins even when another GM sorts first", () => {
  assert.equal(
    resolvePrimaryAuthorityUserId([gm("gm-a"), gm("gm-z")], "gm-z"),
    "gm-z"
  );
});

test("offline preferred GM falls back to the lexically-smallest active GM id", () => {
  assert.equal(
    resolvePrimaryAuthorityUserId([gm("gm-z"), gm("gm-preferred", false), gm("gm-a")], "gm-preferred"),
    "gm-a"
  );
});

test("preferred player is never elected and falls back to an active GM", () => {
  assert.equal(
    resolvePrimaryAuthorityUserId([player("user-preferred"), gm("gm-b"), gm("gm-a")], "user-preferred"),
    "gm-a"
  );
});

test("fallback result is independent from incidental collection order", () => {
  const first = [gm("gm-c"), gm("gm-a"), gm("gm-b")];
  const second = [gm("gm-b"), gm("gm-c"), gm("gm-a")];

  assert.equal(resolvePrimaryAuthorityUserId(first, null), "gm-a");
  assert.equal(resolvePrimaryAuthorityUserId(second, null), "gm-a");
});

test("players and inactive GMs do not participate in fallback election", () => {
  assert.equal(
    resolvePrimaryAuthorityUserId([
      player("player-a"),
      gm("gm-a", false),
      gm("gm-b", true)
    ], null),
    "gm-b"
  );
});

test("no active GM produces no authority", () => {
  assert.equal(
    resolvePrimaryAuthorityUserId([player("player-a"), gm("gm-a", false)], null),
    null
  );
});

test("blank user ids are ignored defensively", () => {
  assert.equal(
    resolvePrimaryAuthorityUserId([gm(""), gm("   "), gm("gm-valid")], null),
    "gm-valid"
  );
});

test("duplicate eligible projections do not change the deterministic result", () => {
  assert.equal(
    resolvePrimaryAuthorityUserId([gm("gm-b"), gm("gm-a"), gm("gm-a")], null),
    "gm-a"
  );
});

test("preferred id must match exactly and is not trimmed or rewritten", () => {
  assert.equal(
    resolvePrimaryAuthorityUserId([gm("gm-a"), gm("gm-b")], " gm-b "),
    "gm-a"
  );
});
