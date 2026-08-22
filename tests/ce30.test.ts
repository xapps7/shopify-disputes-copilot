import test from "node:test";
import assert from "node:assert/strict";

import {
  CE30_MAX_AGE_DAYS,
  CE30_MIN_AGE_DAYS,
  assessCe30,
  isCondition104,
  matchingElements,
  normaliseAddress,
  type Ce30Candidate,
  type Ce30Dispute
} from "../lib/disputes/ce30.ts";

// The failure this guards against is not a crash - it is telling a merchant a
// dispute qualifies for Compelling Evidence 3.0 when it does not. A merchant
// gets one pre-arbitration response per dispute. Spending it on a CE3.0 claim
// the issuer rejects on procedure costs them the money AND the ratio relief,
// which is the whole reason the remedy is worth chasing. So most of what is
// asserted below is the refusal, and the wording of the refusal.

const DISPUTE_DATE = "2026-08-01T00:00:00.000Z";
const MS_PER_DAY = 86_400_000;

function daysBefore(days: number): string {
  return new Date(Date.parse(DISPUTE_DATE) - days * MS_PER_DAY).toISOString();
}

function prior(overrides: Partial<Ce30Candidate> & { orderId: string }): Ce30Candidate {
  return {
    orderName: `#${overrides.orderId}`,
    processedAt: daysBefore(200),
    customerEmail: "buyer@example.com",
    ip: "203.0.113.9",
    deviceId: null,
    shippingAddressHash: "221B Baker St., London",
    userId: null,
    hadDispute: false,
    ...overrides
  };
}

function disputeOf(overrides: Partial<Ce30Dispute> = {}): Ce30Dispute {
  return {
    conditionCode: "10.4",
    disputeDate: DISPUTE_DATE,
    disputedTransaction: {
      orderId: "disputed-1",
      customerEmail: "buyer@example.com",
      ip: "203.0.113.9",
      deviceId: null,
      shippingAddressHash: "221b baker st london",
      userId: null
    },
    ...overrides
  };
}

test("addresses that differ only in case, spacing and punctuation are the same address", () => {
  // Shopify writes the same doorstep several ways depending on which surface
  // produced the order. Comparing them raw throws away a real Visa match over a
  // full stop, which is a lost dispute and a ratio hit for nothing.
  assert.equal(
    normaliseAddress("221B  Baker St., London\nNW1 6XE"),
    normaliseAddress("221b baker st london nw1 6xe")
  );
  assert.equal(normaliseAddress("  Flat 2 - 14 High Road  "), "flat 2 14 high road");
});

test("an address that is blank, whitespace or absent normalises to null rather than empty string", () => {
  // Two orders with no shipping address must not "match" on an empty string.
  assert.equal(normaliseAddress(null), null);
  assert.equal(normaliseAddress(undefined), null);
  assert.equal(normaliseAddress("   "), null);
  assert.equal(normaliseAddress(",.-"), null);
});

test("normalising stops at punctuation and never guesses at abbreviations", () => {
  // Expanding St to Street needs locale knowledge we do not have. Guessing here
  // would manufacture a match Visa will not honour.
  assert.notEqual(normaliseAddress("14 Baker St"), normaliseAddress("14 Baker Street"));
});

test("only a whole 10.4 token counts as the Visa fraud card-absent condition", () => {
  assert.equal(isCondition104("10.4"), true);
  assert.equal(isCondition104("10.4 - Fraud, Card-Absent Environment"), true);

  // Sync stores dispute.type when Shopify sends no network code, so these are
  // values that genuinely reach this function.
  assert.equal(isCondition104("CHARGEBACK"), false);
  assert.equal(isCondition104(null), false);
  assert.equal(isCondition104("4837"), false);
  assert.equal(isCondition104("110.4"), false);
  assert.equal(isCondition104("10.44"), false);
});

test("a dispute that is not Visa 10.4 is refused whatever the history shows", () => {
  const result = assessCe30(disputeOf({ conditionCode: "13.1" }), [
    prior({ orderId: "a", processedAt: daysBefore(150) }),
    prior({ orderId: "b", processedAt: daysBefore(300) })
  ]);

  assert.equal(result.eligible, false);
  assert.match(result.blockers.join(" "), /only to Visa condition 10\.4/);
  assert.match(result.blockers.join(" "), /13\.1/, "the merchant should see what it actually is");
});

test("an unrecorded condition code is refused without pretending it might be 10.4", () => {
  // Shopify's FRAUDULENT reason covers Visa 10.4 and Mastercard 4837 alike.
  // Inferring 10.4 from it would be the single easiest way to produce a claim
  // that gets thrown out on procedure.
  const result = assessCe30(disputeOf({ conditionCode: null }), [
    prior({ orderId: "a", processedAt: daysBefore(150) }),
    prior({ orderId: "b", processedAt: daysBefore(300) })
  ]);

  assert.equal(result.eligible, false);
  assert.match(result.blockers.join(" "), /No network condition code/);
});

test("two clean priors in the window matching on IP and shipping address qualify", () => {
  const result = assessCe30(disputeOf(), [
    prior({ orderId: "old", processedAt: daysBefore(300) }),
    prior({ orderId: "recent", processedAt: daysBefore(150) })
  ]);

  assert.deepEqual(result.blockers, []);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.matchedElements, ["ipAddress", "shippingAddress"]);
  assert.deepEqual(
    result.qualifyingOrders.map((order) => order.orderId),
    ["old", "recent"],
    "priors are listed oldest first, so the pair is stable and reads chronologically"
  );
});

test("the 120 and 365 day boundaries are inclusive on both ends", () => {
  const atBoundaries = assessCe30(disputeOf(), [
    prior({ orderId: "floor", processedAt: daysBefore(CE30_MIN_AGE_DAYS) }),
    prior({ orderId: "ceiling", processedAt: daysBefore(CE30_MAX_AGE_DAYS) })
  ]);

  assert.equal(atBoundaries.eligible, true, "an order exactly 120 or 365 days old still counts");

  const justOutside = assessCe30(disputeOf(), [
    prior({ orderId: "too-new", processedAt: daysBefore(CE30_MIN_AGE_DAYS - 1) }),
    prior({ orderId: "too-old", processedAt: daysBefore(CE30_MAX_AGE_DAYS + 1) })
  ]);

  assert.equal(justOutside.eligible, false);
  assert.match(justOutside.blockers[0], /Only 0 prior undisputed orders/);
  assert.match(
    justOutside.blockers.join(" "),
    /1 newer than 120 days, 1 older than 365 days/,
    "an order that is merely too recent becomes usable later - the merchant cannot tell that from a bare count"
  );
});

test("one qualifying prior is reported as one, in the words a merchant needs", () => {
  const result = assessCe30(disputeOf(), [prior({ orderId: "a", processedAt: daysBefore(200) })]);

  assert.equal(result.eligible, false);
  assert.equal(
    result.blockers[0],
    "Only 1 prior undisputed order in the 120-365 day window; Visa requires 2."
  );
  assert.deepEqual(result.qualifyingOrders, [], "a partial set is never returned as if it were a case");
});

test("a prior that was itself disputed cannot be one of the two", () => {
  const result = assessCe30(disputeOf(), [
    prior({ orderId: "clean", processedAt: daysBefore(150) }),
    prior({ orderId: "charged-back", processedAt: daysBefore(300), hadDispute: true })
  ]);

  assert.equal(result.eligible, false);
  assert.match(result.blockers[0], /Only 1 prior undisputed order/);
  assert.match(result.caveats.join(" "), /excluded for carrying a dispute or fraud report/);
});

test("no IP and no device fingerprint makes the dispute impossible, and says so", () => {
  // The hard stop. Shopify exposes no device fingerprint under any scope and
  // only sometimes records the browser IP, so this is the common case for a
  // shop with no fraud tool. Sending that merchant off to hunt for prior orders
  // would be cruel: no history could ever rescue this dispute.
  const blind = assessCe30(
    disputeOf({
      disputedTransaction: {
        orderId: "disputed-1",
        customerEmail: "buyer@example.com",
        ip: null,
        deviceId: null,
        shippingAddressHash: "221b baker st london",
        userId: "user-77"
      }
    }),
    [
      prior({ orderId: "a", processedAt: daysBefore(150), ip: null, userId: "user-77" }),
      prior({ orderId: "b", processedAt: daysBefore(300), ip: null, userId: "user-77" })
    ]
  );

  assert.equal(blind.eligible, false, "two perfect soft matches still cannot qualify");
  assert.match(blind.blockers.join(" "), /Neither an IP address nor a device fingerprint/);
  assert.match(blind.blockers.join(" "), /cannot qualify/);
  assert.match(
    blind.blockers.join(" "),
    /Shopify's Admin API exposes no device fingerprint/,
    "the merchant should learn this is a platform limit, not something they misconfigured"
  );
});

test("two matching soft elements are not enough without IP or device", () => {
  // Same shape as above but the disputed order does have an IP, so the hard stop
  // does not fire and the pair is genuinely assessed - and still refused.
  const result = assessCe30(
    disputeOf({
      disputedTransaction: {
        orderId: "disputed-1",
        customerEmail: "buyer@example.com",
        ip: "198.51.100.4",
        deviceId: null,
        shippingAddressHash: "221b baker st london",
        userId: "user-77"
      }
    }),
    [
      prior({ orderId: "a", processedAt: daysBefore(150), ip: "203.0.113.1", userId: "user-77" }),
      prior({ orderId: "b", processedAt: daysBefore(300), ip: "203.0.113.2", userId: "user-77" })
    ]
  );

  assert.equal(result.eligible, false);
  assert.match(result.blockers.join(" "), /neither is IP address nor device fingerprint/);
  assert.match(result.blockers.join(" "), /Account user ID and Shipping address/);
});

test("the same two elements must match on both priors, not one each", () => {
  // The subtle failure. One prior matching on IP and another on shipping address
  // is two separate one-element stories; Visa asks for one two-element pattern
  // repeated across both priors.
  const result = assessCe30(disputeOf(), [
    prior({
      orderId: "ip-only",
      processedAt: daysBefore(150),
      shippingAddressHash: "9 Other Road, Leeds"
    }),
    prior({
      orderId: "address-only",
      processedAt: daysBefore(300),
      ip: "198.51.100.77"
    })
  ]);

  assert.equal(result.eligible, false);
  assert.match(result.blockers.join(" "), /no two of them share a single data element/);
});

test("the best qualifying pair is chosen out of a longer history", () => {
  const result = assessCe30(disputeOf(), [
    prior({ orderId: "weak", processedAt: daysBefore(130), shippingAddressHash: "9 Other Road" }),
    prior({ orderId: "strong-a", processedAt: daysBefore(250) }),
    prior({ orderId: "strong-b", processedAt: daysBefore(200) })
  ]);

  assert.equal(result.eligible, true);
  assert.deepEqual(
    result.qualifyingOrders.map((order) => order.orderId),
    ["strong-a", "strong-b"],
    "the weak prior is dropped, and the chosen pair still reads oldest first"
  );
  assert.deepEqual(result.matchedElements, ["ipAddress", "shippingAddress"]);
});

test("a missing element is a non-match and never an error", () => {
  // Every element is nullable in the real data. Nulls must cost the match and
  // nothing else - no throw, and above all no null-equals-null match, which
  // would qualify every order in a shop that records neither IP nor device.
  const empty: Ce30Candidate = {
    orderId: "hollow",
    orderName: "#hollow",
    processedAt: daysBefore(200),
    customerEmail: "buyer@example.com",
    ip: null,
    deviceId: null,
    shippingAddressHash: null,
    userId: null,
    hadDispute: false
  };

  assert.deepEqual(
    matchingElements(
      { customerEmail: null, ip: null, deviceId: null, shippingAddressHash: null, userId: null },
      empty
    ),
    [],
    "two absent device IDs are not a matching device ID"
  );

  const result = assessCe30(disputeOf(), [empty, { ...empty, orderId: "hollow-2" }]);
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.length > 0);
});

test("history for a different cardholder or a different shop is not counted", () => {
  const result = assessCe30(disputeOf({ disputedTransaction: { ...disputeOf().disputedTransaction, merchantId: "shop-1" } }), [
    prior({ orderId: "other-buyer", processedAt: daysBefore(150), customerEmail: "someone@else.test" }),
    prior({ orderId: "other-shop", processedAt: daysBefore(300), merchantId: "shop-2" }),
    prior({ orderId: "ours", processedAt: daysBefore(250), merchantId: "shop-1" })
  ]);

  assert.equal(result.eligible, false);
  assert.match(result.blockers[0], /Only 1 prior undisputed order/);
});

test("the disputed order is never counted as its own prior", () => {
  const result = assessCe30(disputeOf(), [
    prior({ orderId: "disputed-1", processedAt: daysBefore(150) }),
    prior({ orderId: "genuine", processedAt: daysBefore(300) })
  ]);

  assert.equal(result.eligible, false);
  assert.match(result.blockers[0], /Only 1 prior undisputed order/);
});

test("a disputed order with no customer email cannot be tied to any prior", () => {
  // Shopify never exposes the PAN, so email is the only cardholder handle there
  // is. Without it the count of priors would be zero for a reason that has
  // nothing to do with the merchant's history, so it is not reported as one.
  const result = assessCe30(
    disputeOf({
      disputedTransaction: {
        orderId: "disputed-1",
        customerEmail: null,
        ip: "203.0.113.9",
        deviceId: null,
        shippingAddressHash: "221b baker st london",
        userId: null
      }
    }),
    [prior({ orderId: "a", processedAt: daysBefore(150) }), prior({ orderId: "b", processedAt: daysBefore(300) })]
  );

  assert.equal(result.eligible, false);
  assert.match(result.blockers.join(" "), /no customer email/);
  assert.ok(
    !result.blockers.some((blocker) => /Only 0 prior/.test(blocker)),
    "a shortage caused by a missing identifier is not reported as a shortage of orders"
  );
});

test("unreadable dates degrade to a refusal rather than a crash", () => {
  const badDisputeDate = assessCe30(disputeOf({ disputeDate: "not a date" }), [
    prior({ orderId: "a", processedAt: daysBefore(150) }),
    prior({ orderId: "b", processedAt: daysBefore(300) })
  ]);

  assert.equal(badDisputeDate.eligible, false);
  assert.match(badDisputeDate.blockers.join(" "), /dispute date is missing or unreadable/);

  const badOrderDate = assessCe30(disputeOf(), [
    prior({ orderId: "a", processedAt: "" }),
    prior({ orderId: "b", processedAt: daysBefore(300) })
  ]);

  assert.equal(badOrderDate.eligible, false);
  assert.match(badOrderDate.blockers[0], /Only 1 prior undisputed order/);
});

test("an eligible result still admits the fraud-report data Shopify does not have", () => {
  // Visa also requires the priors to carry no issuer fraud report. TC40/SAFE
  // data is not in Shopify, so a clean result here means "clean as far as this
  // app can see". Saying that on the positive path is the point: the issuer can
  // see something we cannot.
  const result = assessCe30(disputeOf(), [
    prior({ orderId: "a", processedAt: daysBefore(150) }),
    prior({ orderId: "b", processedAt: daysBefore(300) })
  ]);

  assert.equal(result.eligible, true);
  assert.match(result.caveats.join(" "), /TC40\/SAFE/);
});

test("a known fraud report disqualifies a prior even with no chargeback on it", () => {
  const result = assessCe30(disputeOf(), [
    prior({ orderId: "a", processedAt: daysBefore(150) }),
    prior({ orderId: "b", processedAt: daysBefore(300), hadFraudReport: true })
  ]);

  assert.equal(result.eligible, false);
  assert.match(result.blockers[0], /Only 1 prior undisputed order/);
});
