import test from "node:test";
import assert from "node:assert/strict";

import { buildDisputeProfitAndLoss, isSettledStatus } from "../lib/economics/dispute-pl.ts";

const WINDOW = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z") };

function dispute(overrides: Partial<Parameters<typeof buildDisputeProfitAndLoss>[0][number]> = {}) {
  return {
    status: "LOST",
    disputeType: "CHARGEBACK",
    amount: 100,
    currencyCode: "USD",
    finalizedOn: new Date("2026-08-15T00:00:00Z"),
    ...overrides
  };
}

function usdLine(disputes: Parameters<typeof buildDisputeProfitAndLoss>[0]) {
  const pl = buildDisputeProfitAndLoss(disputes, WINDOW, "August");
  return pl.lines.find((line) => line.currencyCode === "USD");
}

test("a lost dispute costs the amount and the fee", () => {
  const line = usdLine([dispute({ amount: 100 })]);
  assert.equal(line?.lost, 100);
  assert.equal(line?.feesPaid, 15);
  assert.equal(line?.netCost, 115);
  assert.equal(line?.recovered, 0);
});

test("winning keeps the money and STILL costs the fee", () => {
  // The number merchants do not expect. Shopify's pages disagree about whether
  // the fee comes back on a win, so the model never assumes it does.
  const line = usdLine([dispute({ status: "WON", amount: 250 })]);

  assert.equal(line?.recovered, 250);
  assert.equal(line?.lost, 0);
  assert.equal(line?.feesPaid, 15);
  assert.equal(line?.feesOnWins, 15);
  // A won dispute is not free: the fee is the whole cost of the period.
  assert.equal(line?.netCost, 15);
});

test("money kept by winning is never netted against cost", () => {
  // Otherwise a good month of wins hides a bad month of fees.
  const line = usdLine([
    dispute({ status: "WON", amount: 1000 }),
    dispute({ status: "LOST", amount: 100 })
  ]);

  assert.equal(line?.recovered, 1000);
  assert.equal(line?.netCost, 100 + 15 + 15);
});

test("accepting a dispute is not cheaper than losing it", () => {
  const accepted = usdLine([dispute({ status: "ACCEPTED", amount: 80 })]);
  const lost = usdLine([dispute({ status: "LOST", amount: 80 })]);
  assert.equal(accepted?.netCost, lost?.netCost);
});

test("an inquiry carries no chargeback fee", () => {
  // Retrieval requests are not chargebacks. Billing one would invent money that
  // never moved.
  const line = usdLine([dispute({ disputeType: "INQUIRY", amount: 100 })]);
  assert.equal(line?.feesPaid, 0);
  assert.equal(line?.netCost, 100);
});

test("currencies are never added together", () => {
  const pl = buildDisputeProfitAndLoss(
    [dispute({ currencyCode: "USD", amount: 100 }), dispute({ currencyCode: "GBP", amount: 100 })],
    WINDOW,
    "August"
  );

  assert.equal(pl.lines.length, 2);
  // GBP carries Shopify's £10 fee, not the $15 one.
  assert.equal(pl.lines.find((line) => line.currencyCode === "GBP")?.feesPaid, 10);
  assert.equal(pl.lines.find((line) => line.currencyCode === "USD")?.feesPaid, 15);
});

test("only disputes that settled inside the window are counted", () => {
  const pl = buildDisputeProfitAndLoss(
    [
      dispute({ finalizedOn: new Date("2026-07-31T23:59:59Z") }),
      dispute({ finalizedOn: new Date("2026-09-01T00:00:00Z") })
    ],
    WINDOW,
    "August"
  );

  assert.equal(pl.lines.length, 0);
});

test("an unsettled dispute is not in the P&L at all", () => {
  // It has not cost anything yet. It belongs under money at risk.
  const pl = buildDisputeProfitAndLoss([dispute({ status: "NEEDS_RESPONSE" })], WINDOW, "August");
  assert.equal(pl.lines.length, 0);
  assert.equal(pl.undatedSettled, 0);
});

test("a settled dispute with no finalisation date is surfaced, never silently dropped", () => {
  // Excluding it quietly understates every figure; guessing a date would put an
  // old loss in this month.
  const pl = buildDisputeProfitAndLoss([dispute({ finalizedOn: null })], WINDOW, "August");
  assert.equal(pl.undatedSettled, 1);
  assert.equal(pl.lines.length, 0);
});

test("settled statuses are exactly the four where money has moved", () => {
  for (const status of ["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED"]) {
    assert.ok(isSettledStatus(status), `${status} should be settled`);
  }
  for (const status of ["NEEDS_RESPONSE", "UNDER_REVIEW", "WARNING_NEEDS_RESPONSE", "UNKNOWN"]) {
    assert.ok(!isSettledStatus(status), `${status} should not be settled`);
  }
});

test("lines are ordered by what actually cost the most", () => {
  const pl = buildDisputeProfitAndLoss(
    [dispute({ currencyCode: "GBP", amount: 500 }), dispute({ currencyCode: "USD", amount: 50 })],
    WINDOW,
    "August"
  );

  assert.equal(pl.lines[0].currencyCode, "GBP");
});
