import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeInteger,
  minorToMajor,
  majorToMinor,
  addMinorUnits,
  subtractMinorUnits,
  formatResourceAmount,
  parseResourceAmount
} from "../../src/economy/math/minor-units.js";
import { CANONICAL_RESOURCE_TREASURY, CANONICAL_RESOURCE_SUPPLIES } from "../../src/economy/definitions/canonical-definitions.js";

test("G4.3: assertSafeInteger checks Number.isSafeInteger boundary and rejects overflow", () => {
  assert.equal(assertSafeInteger(0).ok, true);
  assert.equal(assertSafeInteger(1000).ok, true);
  assert.equal(assertSafeInteger(Number.MAX_SAFE_INTEGER).ok, true);
  assert.equal(assertSafeInteger(Number.MIN_SAFE_INTEGER).ok, true);

  // Overflow and non-integer rejection
  assert.equal(assertSafeInteger(Number.MAX_SAFE_INTEGER + 2).ok, false);
  assert.equal(assertSafeInteger(Infinity).ok, false);
  assert.equal(assertSafeInteger(NaN).ok, false);
  assert.equal(assertSafeInteger(12.34).ok, false);
});

test("G4.3: minorToMajor and majorToMinor roundtrip without binary floating-point drift", () => {
  // Precision 0
  assert.equal(minorToMajor(150, 0), 150);
  const m0 = majorToMinor(150, 0);
  assert.equal(m0.ok, true);
  if (m0.ok) assert.equal(m0.value, 150);

  // Precision 2 (e.g. 19.99 -> 1999)
  assert.equal(minorToMajor(1999, 2), 19.99);
  const m2 = majorToMinor(19.99, 2);
  assert.equal(m2.ok, true);
  if (m2.ok) assert.equal(m2.value, 1999);

  // Precision 4 (e.g. 0.0005 -> 5)
  assert.equal(minorToMajor(5, 4), 0.0005);
  const m4 = majorToMinor(0.0005, 4);
  assert.equal(m4.ok, true);
  if (m4.ok) assert.equal(m4.value, 5);
});

test("G4.3: addMinorUnits and subtractMinorUnits maintain safe integer arithmetic", () => {
  const addRes = addMinorUnits(500, 250);
  assert.equal(addRes.ok, true);
  if (addRes.ok) assert.equal(addRes.value, 750);

  const subRes = subtractMinorUnits(500, 250);
  assert.equal(subRes.ok, true);
  if (subRes.ok) assert.equal(subRes.value, 250);

  // Overflow on addition
  const overflowRes = addMinorUnits(Number.MAX_SAFE_INTEGER, 100);
  assert.equal(overflowRes.ok, false);
  assert.equal(overflowRes.error.code, "DM_ECON_AMOUNT_OVERFLOW");
});

test("G4.3: formatResourceAmount formats localized numbers with units", () => {
  // Treasury (precision 2, abbreviation 'cr')
  const formattedTreasury = formatResourceAmount(125050, CANONICAL_RESOURCE_TREASURY, {
    locale: "en-US",
    showUnit: true
  });
  assert.equal(formattedTreasury, "1,250.50 cr");

  // Supplies (precision 0, plural 'crates')
  const formattedSupplies = formatResourceAmount(50, CANONICAL_RESOURCE_SUPPLIES, {
    locale: "en-US",
    showUnit: true
  });
  assert.equal(formattedSupplies, "50 bx");

  // Format without unit
  const formattedNoUnit = formatResourceAmount(125050, CANONICAL_RESOURCE_TREASURY, {
    locale: "en-US",
    showUnit: false
  });
  assert.equal(formattedNoUnit, "1,250.50");
});

test("G4.3: parseResourceAmount parses standard and localized inputs into integer minor units", () => {
  // Standard decimal
  const p1 = parseResourceAmount("1,250.50", 2);
  assert.equal(p1.ok, true);
  if (p1.ok) assert.equal(p1.value, 125050);

  // European decimal comma
  const p2 = parseResourceAmount("1.250,50", 2);
  assert.equal(p2.ok, true);
  if (p2.ok) assert.equal(p2.value, 125050);

  // Single comma
  const p3 = parseResourceAmount("10,5", 1);
  assert.equal(p3.ok, true);
  if (p3.ok) assert.equal(p3.value, 105);

  // Whole number for precision 0
  const p4 = parseResourceAmount("450", 0);
  assert.equal(p4.ok, true);
  if (p4.ok) assert.equal(p4.value, 450);

  // Invalid strings
  assert.equal(parseResourceAmount("", 2).ok, false);
  assert.equal(parseResourceAmount("abc", 2).ok, false);
});
