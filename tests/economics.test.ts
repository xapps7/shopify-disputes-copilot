import test from "node:test";
import assert from "node:assert/strict";

import { chargebackFee, FEE_RECOVERY_ON_WIN } from "../lib/economics/fees.ts";
import { assessEcm, assessVamp, protectedButStillCounted, VAMP_THRESHOLDS } from "../lib/economics/ratios.ts";
import { recommendStrategy, summarisePortfolio } from "../lib/economics/strategy.ts";
import {
  estimateWinProbability,
  MIN_SAMPLE_FOR_OBSERVED,
  structuralWinPrior,
  type WinFactors
} from "../lib/economics/win-probability.ts";

/* ---------------------------------------------------------------- fees --- */

test("uses Shopify's published fee for the dispute currency", () => {
  assert.equal(chargebackFee("USD").amount, 15);
  assert.equal(chargebackFee("GBP").amount, 10);
  assert.equal(chargebackFee("JPY").amount, 1300);
  assert.equal(chargebackFee("AUD").amount, 25);
});

test("handles the two documented traps: Gibraltar and Irish VAT", () => {
  const gibraltar = chargebackFee("GBP", "GI");
  assert.equal(gibraltar.amount, 15, "Gibraltar pays 15, not the standard 10");

  const ireland = chargebackFee("EUR", "IE");
  assert.ok(Math.abs(ireland.amount - 18.45) < 0.01, "Ireland adds 23% VAT to EUR 15");
  assert.match(ireland.note ?? "", /VAT/);
});

test("says so when it is falling back rather than quoting a published fee", () => {
  const unknown = chargebackFee("XYZ");
  assert.equal(unknown.exact, false);
  assert.match(unknown.note ?? "", /estimate/);
});

test("never assumes the fee comes back on a win", () => {
  // Shopify's own pages contradict each other; Stripe's default is no refund.
  assert.equal(FEE_RECOVERY_ON_WIN.assumeRecovered, false);
});

/* ------------------------------------------------------- win probability --- */

const BASE: WinFactors = {
  band: "strong",
  hasDeliveryConfirmation: false,
  hasTracking: false,
  addressesMatch: null,
  threeDSecure: null,
  evidenceCompleteness: 0,
  autoSubmittedOnly: false,
  digitalGoods: false
};

test("delivery confirmation is the strongest single lever", () => {
  const without = structuralWinPrior(BASE).probability;
  const with_ = structuralWinPrior({ ...BASE, hasDeliveryConfirmation: true }).probability;
  assert.ok(with_ > without + 0.2, "confirmed delivery should move the estimate materially");
});

test("an auto-submitted generic response is scored as the weak case it is", () => {
  const enriched = structuralWinPrior({ ...BASE, hasDeliveryConfirmation: true, evidenceCompleteness: 1 }).probability;
  const auto = structuralWinPrior({ ...BASE, hasDeliveryConfirmation: true, autoSubmittedOnly: true }).probability;
  assert.ok(auto < enriched);
});

test("a mismatched shipping address counts against a fraud claim", () => {
  const match = structuralWinPrior({ ...BASE, addressesMatch: true }).probability;
  const mismatch = structuralWinPrior({ ...BASE, addressesMatch: false }).probability;
  assert.ok(mismatch < match);
});

test("estimates stay inside 0-1 for every combination of factors", () => {
  for (const band of ["strong", "moderate", "weak"] as const) {
    for (const delivery of [true, false]) {
      for (const auto of [true, false]) {
        const p = structuralWinPrior({
          ...BASE,
          band,
          hasDeliveryConfirmation: delivery,
          autoSubmittedOnly: auto,
          addressesMatch: false,
          digitalGoods: true
        }).probability;
        assert.ok(p > 0 && p < 1, `probability out of range: ${p}`);
      }
    }
  }
});

test("labels an estimate as a prior until real outcomes exist", () => {
  const cold = estimateWinProbability(BASE);
  assert.equal(cold.confidence, "prior");
  assert.equal(cold.sampleSize, 0);

  const some = estimateWinProbability(BASE, { wins: 2, losses: 1 });
  assert.equal(some.confidence, "blended");

  const many = estimateWinProbability(BASE, { wins: 20, losses: 10 });
  assert.equal(many.confidence, "observed");
  assert.ok(many.sampleSize >= MIN_SAMPLE_FOR_OBSERVED);
});

test("the merchant's own outcomes progressively override the prior", () => {
  const weak: WinFactors = { ...BASE, band: "weak" };
  const prior = estimateWinProbability(weak).probability;
  const withWins = estimateWinProbability(weak, { wins: 40, losses: 2 }).probability;
  assert.ok(withWins > prior + 0.3, "40 wins should dominate a pessimistic prior");
});

test("the interval narrows as evidence accumulates", () => {
  const few = estimateWinProbability(BASE, { wins: 2, losses: 2 });
  const many = estimateWinProbability(BASE, { wins: 100, losses: 100 });
  assert.ok(many.high - many.low < few.high - few.low);
});

/* -------------------------------------------------------------- ratios --- */

test("VAMP combines fraud reports and disputes in one numerator", () => {
  const assessment = assessVamp({ fraudReports: 10, disputes: 5, settledTransactionsThisMonth: 1000 });
  assert.equal(assessment.count, 15);
  assert.ok(Math.abs(assessment.ratio - 0.015) < 1e-9);
});

test("VAMP threshold is the 1.5% that took effect in April 2026", () => {
  assert.equal(VAMP_THRESHOLDS.STANDARD.ratio, 0.015);
  assert.equal(VAMP_THRESHOLDS.CEMEA.ratio, 0.022);
});

test("a tiny store with a bad ratio is not called a breach", () => {
  // Three chargebacks in fifty orders is 6%, but nowhere near the count floor.
  const assessment = assessVamp({ fraudReports: 0, disputes: 3, settledTransactionsThisMonth: 50 });
  assert.notEqual(assessment.status, "breach");
});

test("ECM divides by the PRIOR month — the trap that catches shrinking stores", () => {
  const steady = assessEcm({ chargebacksThisMonth: 120, capturedPaymentsPriorMonth: 10000 });
  assert.ok(Math.abs(steady.ratio - 0.012) < 1e-9);

  // Same chargeback count, sales halved last month: the ratio doubles with no
  // change in merchant behaviour at all.
  const shrinking = assessEcm({ chargebacksThisMonth: 120, capturedPaymentsPriorMonth: 5000 });
  assert.ok(Math.abs(shrinking.ratio - 0.024) < 1e-9);
  assert.equal(shrinking.status, "breach");
  assert.match(shrinking.explanation, /LAST month/);
});

test("headroom says how many more disputes fit before breaching", () => {
  const assessment = assessVamp({ fraudReports: 0, disputes: 10, settledTransactionsThisMonth: 10000 });
  // 1.5% of 10,000 = 150 allowed, 10 used.
  assert.equal(assessment.headroom, 140);
});

test("warns that Shopify Protect refunds money but not the ratio", () => {
  const warning = protectedButStillCounted(7);
  assert.match(warning ?? "", /still count/);
  assert.equal(protectedButStillCounted(0), null);
});

/* ------------------------------------------------------------ strategy --- */

function input(overrides: Partial<Parameters<typeof recommendStrategy>[0]> = {}) {
  return {
    disputeType: "CHARGEBACK" as const,
    status: "NEEDS_RESPONSE",
    amount: 1025,
    currencyCode: "USD",
    hoursUntilAutoSubmit: 72,
    factors: { ...BASE, hasDeliveryConfirmation: true, evidenceCompleteness: 0.8 },
    ...overrides
  };
}

test("an inquiry always outranks a chargeback — it is free and never hits the ratio", () => {
  const result = recommendStrategy(input({ disputeType: "INQUIRY", amount: 40 }));
  assert.equal(result.action, "RESPOND_TO_INQUIRY");
  assert.match(result.reasons.join(" "), /no fee has been charged/i);
  assert.match(result.warnings.join(" "), /partial refund does not resolve/i);
});

test("refuses to recommend fighting when the amount is below the fee", () => {
  const result = recommendStrategy(input({ amount: 9 }));
  assert.equal(result.action, "ACCEPT");
  assert.match(result.reasons.join(" "), /smaller than the USD 15 chargeback fee/);
});

test("recommends fighting a well-evidenced high-value dispute", () => {
  const result = recommendStrategy(input());
  assert.equal(result.action, "FIGHT");
  assert.ok(result.expectedValue > 0);
  assert.match(result.warnings.join(" "), /Do not submit early/);
});

test("near a monitoring threshold, it says fighting will not save the account", () => {
  const ratio = assessEcm({ chargebacksThisMonth: 140, capturedPaymentsPriorMonth: 10000 });
  const result = recommendStrategy(input({ ratio }));
  assert.equal(result.action, "FIGHT_BUT_PRIORITISE_PREVENTION");
  assert.match(result.warnings.join(" "), /will not reduce it|does not protect your account/i);
});

test("never claims the fee back in the expected value", () => {
  const result = recommendStrategy(input({ factors: { ...BASE, band: "strong", hasDeliveryConfirmation: true } }));
  // EV can never exceed the disputed amount, because the fee is treated as sunk.
  assert.ok(result.expectedValue <= 1025);
  assert.equal(result.amountAtRisk, 1025 + 15);
});

test("a closed dispute is reported as final, not as something to work on", () => {
  for (const status of ["WON", "LOST", "ACCEPTED"]) {
    const result = recommendStrategy(input({ status }));
    assert.equal(result.action, "ALREADY_DECIDED");
    assert.equal(result.expectedValue, 0);
  }
});

test("says plainly when Shopify has already auto-submitted", () => {
  const result = recommendStrategy(input({ hoursUntilAutoSubmit: -2 }));
  assert.equal(result.action, "TOO_LATE");
});

test("a Protect-covered dispute is a ratio problem, not a money problem", () => {
  const result = recommendStrategy(input({ reimbursedByShopifyProtect: true }));

  // This used to be a warning stapled onto a FIGHT recommendation, which was
  // incoherent - you cannot win back money you have already been given, so the
  // expected value of fighting is zero, not probability * amount.
  assert.equal(result.action, "COVERED_BY_PROTECT");
  assert.equal(result.expectedValue, 0, "nothing to recover");
  assert.equal(result.amountAtRisk, 0, "the money is not at risk");

  // But the chargeback still counts against the ratios, which is the entire
  // reason this distinction exists.
  assert.match(result.warnings.join(" "), /still count this chargeback toward the ratios/);
});

test("Protect coverage outranks the money, but not a closed case", () => {
  // A decided dispute stays decided: reimbursement does not reopen anything.
  const decided = recommendStrategy(
    input({ status: "WON", reimbursedByShopifyProtect: true })
  );
  assert.equal(decided.action, "ALREADY_DECIDED");

  // Otherwise coverage is checked before the deadline, because it removes the
  // money from the decision that every other branch is weighing.
  const expired = recommendStrategy(
    input({ hoursUntilAutoSubmit: -2, reimbursedByShopifyProtect: true })
  );
  assert.equal(expired.action, "COVERED_BY_PROTECT");
});

test("portfolio totals never mix currencies", () => {
  const usd = recommendStrategy(input());
  const gbp = recommendStrategy(input({ currencyCode: "GBP", amount: 500 }));
  const summary = summarisePortfolio([
    { amount: 1025, currencyCode: "USD", recommendation: usd },
    { amount: 500, currencyCode: "GBP", recommendation: gbp }
  ]);

  assert.equal(summary.length, 2);
  const usdRow = summary.find((row) => row.currencyCode === "USD");
  assert.equal(usdRow?.atRisk, 1040);
});

test("portfolio recoverable counts only what we would advise acting on", () => {
  const worthless = recommendStrategy(input({ amount: 5 }));
  const summary = summarisePortfolio([{ amount: 5, currencyCode: "USD", recommendation: worthless }]);
  assert.equal(summary[0].recoverable, 0, "an accept recommendation contributes nothing recoverable");
  assert.equal(summary[0].worthFighting, 0);
});

/* -------------------------------------------------------------- locking --- */

test("locks once the response has been submitted", async () => {
  const { evaluateLock } = await import("../lib/disputes/locking.ts");
  const lock = evaluateLock({
    status: "NEEDS_RESPONSE",
    evidenceSentOn: "2026-08-10T00:00:00.000Z",
    evidenceDueBy: "2026-08-20T00:00:00.000Z"
  });
  assert.equal(lock.locked, true);
  assert.equal(lock.cause, "submitted");
  assert.match(lock.reason ?? "", /cannot be changed/);
});

test("locks once the deadline has passed, because Shopify already answered", async () => {
  const { evaluateLock } = await import("../lib/disputes/locking.ts");
  const lock = evaluateLock({
    status: "NEEDS_RESPONSE",
    evidenceSentOn: null,
    evidenceDueBy: "2026-08-01T00:00:00.000Z",
    now: new Date("2026-08-14T00:00:00.000Z")
  });
  assert.equal(lock.locked, true);
  assert.equal(lock.cause, "auto-submitted");
});

test("locks a decided dispute, and says appeals do not exist", async () => {
  const { evaluateLock } = await import("../lib/disputes/locking.ts");
  for (const status of ["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED"]) {
    const lock = evaluateLock({ status, evidenceSentOn: null, evidenceDueBy: null });
    assert.equal(lock.locked, true, `${status} should lock`);
    assert.equal(lock.cause, "decided");
  }
});

test("stays open while there is still time to act", async () => {
  const { evaluateLock } = await import("../lib/disputes/locking.ts");
  const lock = evaluateLock({
    status: "NEEDS_RESPONSE",
    evidenceSentOn: null,
    evidenceDueBy: "2026-08-20T00:00:00.000Z",
    now: new Date("2026-08-14T00:00:00.000Z")
  });
  assert.equal(lock.locked, false);
  assert.equal(lock.reason, null);
});
