import test from "node:test";
import assert from "node:assert/strict";

import {
  PROTECTION_TOOLS,
  priceRatioSlot,
  recommendProtection,
  type MerchantPosition,
  type ProtectionToolKey
} from "../lib/economics/protection.ts";

function position(overrides: Partial<MerchantPosition> = {}): MerchantPosition {
  return {
    fraudShare: 0.5,
    monthlyDisputes: 20,
    averageDisputeAmount: 120,
    nearestThresholdDays: null,
    status: "healthy",
    ...overrides
  };
}

function recommendedKeys(advice: ReturnType<typeof recommendProtection>): ProtectionToolKey[] {
  return advice.recommended.map((entry) => entry.tool.key);
}

function avoidedKeys(advice: ReturnType<typeof recommendProtection>): ProtectionToolKey[] {
  return advice.avoid.map((entry) => entry.tool.key);
}

function reasonFor(advice: ReturnType<typeof recommendProtection>, key: ProtectionToolKey): string {
  return advice.avoid.find((entry) => entry.tool.key === key)?.reason ?? "";
}

function rationaleFor(advice: ReturnType<typeof recommendProtection>, key: ProtectionToolKey): string {
  return advice.recommended.find((entry) => entry.tool.key === key)?.rationale ?? "";
}

/* ----------------------------------------------------------------- the table --- */

test("only the free instruments both clear the ratio and leave you the money", () => {
  // The single sentence a merchant needs and no vendor page states: everything
  // with a price tag either refunds the customer or leaves the dispute in the
  // count. If a future edit adds a paid tool claiming both, this fails.
  const both = PROTECTION_TOOLS.filter(
    (tool) => tool.removesFromRatio === "REMOVES" && tool.keepsMoney === "KEEPS"
  );

  assert.deepEqual(
    both.map((tool) => tool.key).sort(),
    ["AUTH_REVERSAL", "ORDER_INSIGHT"]
  );
  for (const tool of both) {
    assert.equal(tool.costPerEvent, 0, `${tool.key} should cost nothing`);
  }
});

test("every alert product is recorded as refunding rather than keeping the money", () => {
  // The mis-reading that sells alerts: merchants hear "dispute avoided" and
  // assume the sale survives. Resolving an alert means refunding, every time.
  for (const key of ["ETHOCA_ALERTS", "CDRN", "RDR"] as const) {
    const tool = PROTECTION_TOOLS.find((entry) => entry.key === key);
    assert.equal(tool?.keepsMoney, "REFUNDS", `${key} resolves by refunding`);
  }
});

test("RDR is recorded as non-fraud only, however flatly the vendor sells it", () => {
  // Verifi's own pages say RDR protects your ratio, full stop. For a fraud
  // dispute the TC40 is already filed, so the flat claim is false and a
  // fraud-heavy merchant buying on it buys nothing.
  const rdr = PROTECTION_TOOLS.find((tool) => tool.key === "RDR");
  assert.equal(rdr?.removesFromRatio, "REMOVES_NON_FRAUD_ONLY");
  assert.match(rdr?.caveat ?? "", /TC40/);
});

test("3D Secure is recorded as doing nothing to the ratio", () => {
  // Sold as fraud protection, and it is - for the money. The fraud report still
  // fires, so a merchant buying 3DS to fix a monitoring problem has been
  // mis-sold. The two genuine ratio-adjacent effects are stated in the caveat.
  const threeDS = PROTECTION_TOOLS.find((tool) => tool.key === "THREE_DS");
  assert.equal(threeDS?.removesFromRatio, "NONE");
  assert.equal(threeDS?.keepsMoney, "KEEPS");
  assert.match(threeDS?.caveat ?? "", /CE 3\.0/);
  assert.match(threeDS?.caveat ?? "", /10%/);
});

test("post-dispute CE 3.0 is separated from the pre-dispute version that clears the count", () => {
  // Both are called CE 3.0 and only one reverses the fraud report. Collapsing
  // them is how a merchant concludes that fighting fixes their ratio.
  const post = PROTECTION_TOOLS.find((tool) => tool.key === "CE30_POST_DISPUTE");
  const pre = PROTECTION_TOOLS.find((tool) => tool.key === "ORDER_INSIGHT");
  assert.equal(post?.removesFromRatio, "NONE");
  assert.equal(post?.keepsMoney, "KEEPS_IF_WON");
  assert.equal(pre?.removesFromRatio, "REMOVES");
});

/* ------------------------------------------------------------- the arithmetic --- */

test("intercepting a dispute with an alert is never cheaper than letting it run", () => {
  // The whole case for alerts rests on this being false, so it is worth proving
  // across the range rather than asserting it once. The refund alone matches or
  // beats the expected loss, so the premium cannot come out negative and an
  // alert is only ever a purchase of ratio headroom.
  for (const feePerEvent of [15, 29]) {
    for (const averageDisputeAmount of [0, 25, 120, 900, 2500]) {
      for (const winRateIfFought of [0, 0.12, 0.4, 1]) {
        const economics = priceRatioSlot({
          feePerEvent,
          averageDisputeAmount,
          winRateIfFought,
          disputesReachedPerMonth: 10
        });
        assert.ok(
          economics.premiumPerSlot >= 0,
          `negative premium at fee ${feePerEvent}, amount ${averageDisputeAmount}, win ${winRateIfFought}`
        );
      }
    }
  }
});

test("the price of a ratio slot includes the alerts that were never going to be disputes", () => {
  // An alert gives you no way to tell which cardholder would actually have
  // filed, so you refund them all. Pricing a slot at one alert fee understates
  // the bill, which is exactly how vendor pricing pages present it.
  const economics = priceRatioSlot({
    feePerEvent: 29,
    averageDisputeAmount: 0,
    winRateIfFought: 0,
    disputesReachedPerMonth: 10
  });

  assert.ok(economics.monthlyFees > 10 * 29, "more alerts are billed than disputes avoided");
  assert.ok(economics.premiumPerSlot > 29 - 15, "the over-broad alerts are part of the price");
});

test("a lost sale you would probably have won makes the slot dearer, not cheaper", () => {
  // Refunding under an alert throws away the disputes you would have won. A
  // high-value, mostly non-fraud book is where alerts quietly destroy the most
  // value, and the model has to show that rather than flatter the product.
  const winnable = priceRatioSlot({
    feePerEvent: 15,
    averageDisputeAmount: 900,
    winRateIfFought: 0.4,
    disputesReachedPerMonth: 10
  });
  const unwinnable = priceRatioSlot({
    feePerEvent: 15,
    averageDisputeAmount: 900,
    winRateIfFought: 0.05,
    disputesReachedPerMonth: 10
  });

  assert.ok(winnable.premiumPerSlot > unwinnable.premiumPerSlot);
  assert.ok(winnable.load > 1, "a winnable 900 dispute costs more to deflect than to lose");
});

/* -------------------------------------------------------------- the position --- */

test("a healthy merchant with a handful of disputes is told to buy nothing", () => {
  // The outcome the category never offers. A ratio slot is worth zero to a
  // merchant no threshold is approaching, and every priced product costs more
  // than zero, so the arithmetic has exactly one answer.
  const advice = recommendProtection(
    position({ monthlyDisputes: 3, averageDisputeAmount: 80, status: "healthy", nearestThresholdDays: null })
  );

  assert.match(advice.reasoning[0], /^Buy nothing/);
  assert.ok(
    advice.recommended.every((entry) => entry.monthlyCost === 0),
    "nothing with a price tag should be recommended"
  );
  for (const key of ["CDRN", "ETHOCA_ALERTS", "RDR"] as const) {
    assert.ok(avoidedKeys(advice).includes(key), `${key} should be argued against`);
  }
});

test("the free instruments are recommended to everyone, including the merchant buying nothing", () => {
  // Buying nothing is not the same as doing nothing. Auth reversal costs zero,
  // so it needs no arithmetic to justify and belongs at the top of every list.
  const advice = recommendProtection(position({ monthlyDisputes: 0, averageDisputeAmount: 0, fraudShare: 0 }));

  assert.equal(recommendedKeys(advice)[0], "AUTH_REVERSAL");
  assert.ok(recommendedKeys(advice).includes("ORDER_INSIGHT"));
  assert.match(rationaleFor(advice, "AUTH_REVERSAL"), /TC40/);
});

test("a merchant approaching a threshold is sold the cheaper alert network first", () => {
  // CDRN and Ethoca buy the same refund-to-resolve outcome and Ethoca costs
  // roughly twice as much per alert. Recommending both by default is how a
  // merchant ends up paying twice for the disputes the two networks share.
  const advice = recommendProtection(
    position({ fraudShare: 0.85, monthlyDisputes: 40, averageDisputeAmount: 120, status: "watch", nearestThresholdDays: 45 })
  );

  assert.ok(recommendedKeys(advice).includes("CDRN"));
  assert.ok(!recommendedKeys(advice).includes("ETHOCA_ALERTS"));
  assert.match(reasonFor(advice, "ETHOCA_ALERTS"), /twice/);
});

test("a merchant already in breach is told what the second network costs, overlap included", () => {
  // Over a threshold the Mastercard issuers CDRN cannot reach start to matter,
  // but the 15-20% of Visa disputes that alert on both networks bill twice for
  // one order. Recommending Ethoca without that number is a quiet upsell.
  const advice = recommendProtection(
    position({ fraudShare: 0.9, monthlyDisputes: 60, averageDisputeAmount: 90, status: "breach", nearestThresholdDays: 12 })
  );

  assert.ok(recommendedKeys(advice).includes("ETHOCA_ALERTS"));
  assert.match(rationaleFor(advice, "ETHOCA_ALERTS"), /twice/);

  const cdrnCost = advice.recommended.find((entry) => entry.tool.key === "CDRN")?.monthlyCost ?? 0;
  const ethocaCost = advice.recommended.find((entry) => entry.tool.key === "ETHOCA_ALERTS")?.monthlyCost ?? 0;
  assert.ok(ethocaCost > cdrnCost, "the dearer network must be presented as the dearer network");
});

test("a high-value book is not sold alerts until a threshold is actually about to bite", () => {
  // Refunding a 900 order you would often have won costs more than the dispute
  // does. The same merchant in breach should still be offered it, because at
  // that point the ratio is the thing at risk rather than the margin.
  const base = position({ fraudShare: 0.2, monthlyDisputes: 25, averageDisputeAmount: 900, nearestThresholdDays: 60 });

  const watching = recommendProtection({ ...base, status: "watch" });
  assert.ok(!recommendedKeys(watching).includes("CDRN"));
  assert.match(reasonFor(watching, "CDRN"), /unmanaged/);

  const breaching = recommendProtection({ ...base, status: "breach", nearestThresholdDays: 10 });
  assert.ok(recommendedKeys(breaching).includes("CDRN"));
});

test("a fraud-heavy merchant is steered off RDR however close the threshold is", () => {
  // The most expensive mistake in the category: buying RDR to fix a fraud
  // ratio. It cannot, at any level of urgency, because the TC40 was filed
  // before the dispute existed.
  for (const status of ["watch", "breach"] as const) {
    const advice = recommendProtection(
      position({ fraudShare: 0.9, monthlyDisputes: 50, averageDisputeAmount: 70, status, nearestThresholdDays: 10 })
    );
    assert.ok(avoidedKeys(advice).includes("RDR"), `RDR should be argued against when ${status}`);
    assert.match(reasonFor(advice, "RDR"), /TC40/);
  }
});

test("a mostly non-fraud merchant may be recommended RDR, but never for the Shopify threshold", () => {
  // Non-fraud is the half RDR genuinely removes. Shopify has counted
  // RDR-resolved disputes toward its own 1% since January 2026, and Shopify's
  // 1% is the threshold that bites this app's merchants first - so a
  // recommendation that omits that is selling the wrong benefit.
  const advice = recommendProtection(
    position({ fraudShare: 0.15, monthlyDisputes: 30, averageDisputeAmount: 60, status: "watch", nearestThresholdDays: 40 })
  );

  assert.ok(recommendedKeys(advice).includes("RDR"));
  assert.match(rationaleFor(advice, "RDR"), /January 2026/);
  assert.match(rationaleFor(advice, "RDR"), /auto-refunds/);
});

test("3D Secure is never presented as a fix for the ratio, recommended or not", () => {
  // It has real uses and none of them is the numerator. Whichever list it lands
  // in, the correction has to travel with it.
  const fraudHeavy = recommendProtection(
    position({ fraudShare: 0.9, monthlyDisputes: 40, averageDisputeAmount: 100, status: "breach", nearestThresholdDays: 15 })
  );
  assert.ok(recommendedKeys(fraudHeavy).includes("THREE_DS"));
  assert.match(rationaleFor(fraudHeavy, "THREE_DS"), /not for your ratio/i);

  const quiet = recommendProtection(position({ fraudShare: 0.2 }));
  assert.ok(avoidedKeys(quiet).includes("THREE_DS"));
  assert.match(reasonFor(quiet, "THREE_DS"), /TC40|still counts/i);

  for (const advice of [fraudHeavy, quiet]) {
    assert.match(advice.reasoning.join(" "), /does not stop the fraud report/i);
  }
});

test("the three corrections are stated whatever the position", () => {
  // Auth reversal, RDR and 3DS are the facts merchants get wrong. They are the
  // reason the module exists, so they cannot be conditional on the numbers.
  for (const advice of [
    recommendProtection(position()),
    recommendProtection(position({ status: "breach", nearestThresholdDays: 5, fraudShare: 0.95 })),
    recommendProtection(position({ monthlyDisputes: 0, averageDisputeAmount: 0 }))
  ]) {
    const prose = advice.reasoning.join(" ");
    assert.match(prose, /authorisation/i);
    assert.match(prose, /non-fraud disputes/i);
    assert.match(prose, /3D Secure/);
    assert.match(prose, /Only Order Insight and pre-dispute CE 3\.0/);
  }
});

test("recommendations read cheapest first, so the free moves come before the invoices", () => {
  // A merchant reading top-down should do the zero-cost things before being
  // asked to sign a contract.
  const advice = recommendProtection(
    position({ fraudShare: 0.85, monthlyDisputes: 60, averageDisputeAmount: 90, status: "breach", nearestThresholdDays: 8 })
  );

  const costs = advice.recommended.map((entry) => entry.monthlyCost);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b));
  assert.equal(costs[0], 0);
});

test("a position with no usable figures produces advice rather than NaN", () => {
  // getAccountHealth returns a null order count whenever the Shopify query
  // fails, and the ratio derived from it arrives here as NaN. Advice reading
  // "about NaN a month" is worse than no advice at all.
  const advice = recommendProtection(
    position({ fraudShare: Number.NaN, monthlyDisputes: Number.NaN, averageDisputeAmount: Number.NaN })
  );

  for (const entry of advice.recommended) {
    assert.ok(Number.isFinite(entry.monthlyCost), `${entry.tool.key} has a non-finite cost`);
    assert.doesNotMatch(entry.rationale, /NaN/);
  }
  for (const entry of advice.avoid) {
    assert.doesNotMatch(entry.reason, /NaN/);
  }
  assert.doesNotMatch(advice.reasoning.join(" "), /NaN/);
});
