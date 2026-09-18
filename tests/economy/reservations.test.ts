import assert from "node:assert/strict";
import test from "node:test";
import { ReservationStore } from "../../src/economy/reservations/reservation-store.js";
import { validateReservation } from "../../src/economy/reservations/reservation-types.js";

test("G4.5: Reservation validation enforces positive original amount and valid status", () => {
  const invalidAmount = {
    id: "resv_01",
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    originalAmountMinor: 0, // must be > 0
    remainingAmountMinor: 0,
    status: "active",
    source: { type: "project" }
  };
  assert.equal(validateReservation(invalidAmount).ok, false);

  const invalidRemaining = {
    id: "resv_01",
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    originalAmountMinor: 100,
    remainingAmountMinor: 150, // remaining > original
    status: "active",
    source: { type: "project" }
  };
  assert.equal(validateReservation(invalidRemaining).ok, false);
});

test("G4.5: ReservationStore lifecycle: create, partial consume, full consume, over-consume rejection", () => {
  const store = new ReservationStore();

  // 1. Create reservation of 500 minor units
  const createRes = store.create({
    domainUuid: "domain-1",
    resourceId: "domain-manager:treasury",
    originalAmountMinor: 500,
    source: { type: "project", ref: "proj_cathedral" }
  });
  assert.equal(createRes.ok, true);
  if (!createRes.ok) return;

  const resv = createRes.value;
  assert.equal(resv.status, "active");
  assert.equal(resv.originalAmountMinor, 500);
  assert.equal(resv.remainingAmountMinor, 500);
  assert.equal(store.getReservedTotal("domain-1", "domain-manager:treasury"), 500);

  // 2. Partial consume 200 minor units
  const consume1 = store.consume(resv.id, 200);
  assert.equal(consume1.ok, true);
  if (consume1.ok) {
    assert.equal(consume1.value.reservation.status, "partially-consumed");
    assert.equal(consume1.value.reservation.remainingAmountMinor, 300);
    assert.equal(consume1.value.consumedAmount, 200);
  }
  assert.equal(store.getReservedTotal("domain-1", "domain-manager:treasury"), 300);

  // 3. Over-consumption attempt (requesting 400 when remaining is 300) must fail
  const overConsume = store.consume(resv.id, 400);
  assert.equal(overConsume.ok, false);
  assert.equal(overConsume.error.code, "DM_ECON_RESERVATION_EXHAUSTED");

  // 4. Consume the remaining 300 units -> status becomes consumed
  const consume2 = store.consume(resv.id, 300);
  assert.equal(consume2.ok, true);
  if (consume2.ok) {
    assert.equal(consume2.value.reservation.status, "consumed");
    assert.equal(consume2.value.reservation.remainingAmountMinor, 0);
  }
  assert.equal(store.getReservedTotal("domain-1", "domain-manager:treasury"), 0);

  // 5. Attempting to consume from a finalized reservation must fail
  const afterFinal = store.consume(resv.id, 10);
  assert.equal(afterFinal.ok, false);
  assert.equal(afterFinal.error.code, "DM_ECON_RESERVATION_NOT_ACTIVE");
});

test("G4.5: ReservationStore release and expire lifecycle", () => {
  const store = new ReservationStore();

  // Create two reservations
  const r1 = store.create({
    domainUuid: "domain-1",
    resourceId: "domain-manager:supplies",
    originalAmountMinor: 100,
    source: { type: "expedition" }
  });
  const r2 = store.create({
    domainUuid: "domain-1",
    resourceId: "domain-manager:supplies",
    originalAmountMinor: 150,
    source: { type: "feast" }
  });
  assert.equal(r1.ok && r2.ok, true);
  if (!r1.ok || !r2.ok) return;

  assert.equal(store.getReservedTotal("domain-1", "domain-manager:supplies"), 250);

  // 1. Partial release on r1 (release 40 of 100)
  const relPartial = store.release(r1.value.id, 40);
  assert.equal(relPartial.ok, true);
  if (relPartial.ok) {
    assert.equal(relPartial.value.reservation.status, "partially-consumed");
    assert.equal(relPartial.value.reservation.remainingAmountMinor, 60);
  }
  assert.equal(store.getReservedTotal("domain-1", "domain-manager:supplies"), 210);

  // 2. Full release on r1 (release remaining 60)
  const relFull = store.release(r1.value.id);
  assert.equal(relFull.ok, true);
  if (relFull.ok) {
    assert.equal(relFull.value.reservation.status, "released");
    assert.equal(relFull.value.reservation.remainingAmountMinor, 0);
  }
  assert.equal(store.getReservedTotal("domain-1", "domain-manager:supplies"), 150);

  // 3. Expire r2
  const expRes = store.expire(r2.value.id);
  assert.equal(expRes.ok, true);
  if (expRes.ok) {
    assert.equal(expRes.value.status, "expired");
    assert.equal(expRes.value.remainingAmountMinor, 0);
  }
  assert.equal(store.getReservedTotal("domain-1", "domain-manager:supplies"), 0);
});
