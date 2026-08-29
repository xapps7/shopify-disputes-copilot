import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_CAPABILITIES,
  BILLING_PLANS,
  FREE_CAPABILITIES,
  FREE_PLAN,
  FREE_PLAN_KEY,
  PAID_CAPABILITIES,
  PAID_PLAN,
  PAID_PLAN_KEY,
  isFreeCapability,
  planAllows,
  resolvePlan,
  upgradeMessage,
  type BillingPlanKey,
  type Capability
} from "../lib/billing/plans.ts";

/**
 * What these tests are actually protecting.
 *
 * Two mistakes here cost real money in opposite directions, and neither one
 * announces itself:
 *
 *   - a paid capability leaking onto the free plan: everybody gets the paid
 *     product for nothing and nobody reports it;
 *   - a FREE capability drifting behind the paywall: the deadline emails and
 *     the dispute queue are free on purpose, because a merchant who misses a
 *     deadline loses automatically and charging for the warning would earn the
 *     reviews that end a launch.
 *
 * So the whole table is asserted, capability by capability, rather than a
 * sample of it. A future edit that moves one line has to move a line here too.
 */

const PLAN_KEYS: BillingPlanKey[] = ["STARTER", "GROWTH", "PLUS"];

/* --------------------------------------------------------------- the table --- */

test("every plan key in the table matches its own entry", () => {
  for (const key of PLAN_KEYS) {
    assert.equal(BILLING_PLANS[key].key, key, `${key} is filed under the wrong key`);
  }
});

test("the free plan is the default plan, and the paid plan is the one that is sold", () => {
  // STARTER is the Prisma default on Merchant.plan. If these ever disagree,
  // every new install silently starts on the paid plan.
  assert.equal(FREE_PLAN_KEY, "STARTER");
  assert.equal(FREE_PLAN.key, FREE_PLAN_KEY);
  assert.equal(FREE_PLAN.billed, false);
  assert.equal(FREE_PLAN.priceUsd, 0);

  assert.equal(PAID_PLAN_KEY, "GROWTH");
  assert.equal(PAID_PLAN.billed, true);
  assert.ok(PAID_PLAN.priceUsd > 0, "the paid plan must have a price set");
  assert.ok(PAID_PLAN.shopifyPlanName, "the paid plan needs the name Shopify prints on the invoice");
});

test("free and paid capabilities do not overlap, and together they are the whole set", () => {
  const overlap = (FREE_CAPABILITIES as readonly Capability[]).filter((capability) =>
    (PAID_CAPABILITIES as readonly Capability[]).includes(capability)
  );

  assert.deepEqual(overlap, [], "a capability cannot be both free and paid");
  assert.equal(ALL_CAPABILITIES.length, FREE_CAPABILITIES.length + PAID_CAPABILITIES.length);
});

test("the paid capabilities are exactly the labour, and nothing that is only visibility", () => {
  // Named one by one so adding a sixth paid feature is a deliberate act.
  assert.deepEqual(
    [...PAID_CAPABILITIES].sort(),
    ["AUTO_DRAFT", "DOCUMENT_LIBRARY", "PACKET_EXPORT", "PL_EXPORT", "PUSH_TO_SHOPIFY"].sort()
  );
});

test("deadline alerts and the dispute queue are free, at any dispute volume", () => {
  // The two the pricing model says must never be gated. There is no volume cap
  // anywhere in the plan table to check, which is the point: nothing in
  // BILLING_PLANS can express one.
  assert.equal(planAllows("STARTER", "DEADLINE_ALERTS"), true);
  assert.equal(planAllows("STARTER", "DISPUTE_QUEUE"), true);
  assert.equal(isFreeCapability("DEADLINE_ALERTS"), true);
  assert.equal(isFreeCapability("DISPUTE_QUEUE"), true);
});

/* --------------------------------------------------------- planAllows, all --- */

test("planAllows: the free plan grants every free capability", () => {
  for (const capability of FREE_CAPABILITIES) {
    assert.equal(
      planAllows("STARTER", capability),
      true,
      `free plan should grant ${capability}`
    );
  }
});

test("planAllows: the free plan grants NO paid capability", () => {
  for (const capability of PAID_CAPABILITIES) {
    assert.equal(
      planAllows("STARTER", capability),
      false,
      `free plan must not grant ${capability}`
    );
  }
});

test("planAllows: the paid plan grants everything, free capabilities included", () => {
  for (const capability of ALL_CAPABILITIES) {
    assert.equal(planAllows("GROWTH", capability), true, `paid plan should grant ${capability}`);
  }
});

test("planAllows: PLUS grants everything the paid plan does", () => {
  // PLUS is never sold and only reaches a row by hand. A human choosing the top
  // tier means "give them everything", so it must not quietly take features
  // away from a beta merchant or a partner.
  for (const capability of ALL_CAPABILITIES) {
    assert.equal(planAllows("PLUS", capability), true, `PLUS should grant ${capability}`);
  }
});

test("planAllows: every plan and capability pair matches the plan's own list", () => {
  // The exhaustive cross-product, so a table edit cannot pass by only touching
  // one of the assertions above.
  for (const key of PLAN_KEYS) {
    const plan = BILLING_PLANS[key];

    for (const capability of ALL_CAPABILITIES) {
      assert.equal(
        planAllows(key, capability),
        plan.capabilities.includes(capability),
        `${key} disagrees with its own table for ${capability}`
      );
    }
  }
});

/* ------------------------------------------------------------- fail closed --- */

test("planAllows: an unknown plan grants nothing at all", () => {
  const unknownPlans = ["ENTERPRISE", "starter", "GROWTH ", "", "null", "undefined", "0"];

  for (const plan of unknownPlans) {
    for (const capability of ALL_CAPABILITIES) {
      assert.equal(
        planAllows(plan, capability),
        false,
        `unknown plan ${JSON.stringify(plan)} must not grant ${capability}`
      );
    }
  }
});

test("planAllows: null and undefined grant nothing, including free capabilities", () => {
  // Not even the free ones. A null here means the merchant could not be
  // identified, and the honest answer to "may I do this for a merchant I cannot
  // identify?" is no. lib/billing/gate.ts is where an unknown merchant is
  // resolved to the free plan on purpose and says so.
  for (const capability of ALL_CAPABILITIES) {
    assert.equal(planAllows(null, capability), false, `null must not grant ${capability}`);
    assert.equal(planAllows(undefined, capability), false, `undefined must not grant ${capability}`);
  }
});

test("planAllows is case sensitive, matching the Prisma enum exactly", () => {
  // The value comes from a Postgres enum column, which is upper case. A lenient
  // match here would let a hand-typed "growth" grant the paid product.
  assert.equal(planAllows("growth", "AUTO_DRAFT"), false);
  assert.equal(planAllows("Growth", "AUTO_DRAFT"), false);
  assert.equal(planAllows("GROWTH", "AUTO_DRAFT"), true);
});

test("resolvePlan returns null for anything that is not a plan", () => {
  assert.equal(resolvePlan("STARTER"), BILLING_PLANS.STARTER);
  assert.equal(resolvePlan("GROWTH"), BILLING_PLANS.GROWTH);
  assert.equal(resolvePlan("PLUS"), BILLING_PLANS.PLUS);
  assert.equal(resolvePlan("ENTERPRISE"), null);
  assert.equal(resolvePlan(null), null);
  assert.equal(resolvePlan(undefined), null);
  assert.equal(resolvePlan(""), null);
});

/* ----------------------------------------------------------------- the copy --- */

test("the upgrade message names the price, the trial, and what stays free", () => {
  const message = upgradeMessage("AUTO_DRAFT");

  assert.match(message, new RegExp(`\\$${PAID_PLAN.priceUsd}`), "the price must be in the message");
  assert.match(message, new RegExp(String(PAID_PLAN.trialDays)), "the trial length must be in the message");
  assert.match(message, /free/i, "the merchant must be told what stays free");
  // A paywall that does not say what it is refusing reads as a bug.
  assert.match(message, /drafting the evidence for you/);
});

test("every capability has merchant-readable copy", () => {
  for (const capability of ALL_CAPABILITIES) {
    const message = upgradeMessage(capability);
    assert.ok(message.length > 0);
    assert.doesNotMatch(message, /undefined/, `${capability} has no label`);
  }
});
