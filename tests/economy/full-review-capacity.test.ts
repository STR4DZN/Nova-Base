import assert from "node:assert/strict";
import test from "node:test";
import { resolveEffectiveCapacity } from "../../src/economy/accounts/capacity-resolver.js";
const modifier = (deltaMinor: number) => ({ id: String(deltaMinor), source: "test", label: "Modifier", deltaMinor, active: true });
test("review G4: capacity modifiers cancel exactly across intermediate overflow in any order", () => {
  const modifiers = [modifier(2), modifier(-Number.MAX_SAFE_INTEGER)];
  assert.equal(resolveEffectiveCapacity(Number.MAX_SAFE_INTEGER, modifiers).effectiveCapacityMinor, 2);
  assert.equal(resolveEffectiveCapacity(Number.MAX_SAFE_INTEGER, [...modifiers].reverse()).effectiveCapacityMinor, 2);
});
test("review G4: the definition hard maximum clamps an exact oversized capacity before conversion", () => {
  assert.equal(resolveEffectiveCapacity(Number.MAX_SAFE_INTEGER, [modifier(2)], { maximumMinor: 100 } as any).effectiveCapacityMinor, 100);
});
