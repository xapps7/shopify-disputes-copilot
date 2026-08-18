import test from "node:test";
import assert from "node:assert/strict";

import {
  COVERAGE_CRITERIA,
  describeProtect,
  isLostCoverage,
  parseProtectEligibility,
  parseProtectStatus,
  protectAppliesToShop,
  readProtect,
  readProtectFromOrderJson
} from "../lib/disputes/shopify-protect.ts";

// The failure that matters here is not a crash - it is telling a merchant they
// lost fraud coverage they were never eligible for. Shopify Protect is US-only,
// so for most of the world every order is INACTIVE forever, and a module that
// treats "no data" as "not covered" would libel every store outside the US.

test("unknown, absent and malformed values are UNKNOWN, never a loss", () => {
  assert.equal(parseProtectStatus(undefined), "UNKNOWN");
  assert.equal(parseProtectStatus(null), "UNKNOWN");
  assert.equal(parseProtectStatus(""), "UNKNOWN");
  assert.equal(parseProtectStatus("PROTECTED_SOMEHOW"), "UNKNOWN");
  assert.equal(parseProtectStatus(7), "UNKNOWN");

  assert.equal(parseProtectEligibility(undefined), "UNKNOWN");
  assert.equal(parseProtectEligibility("MAYBE"), "UNKNOWN");
});

test("every documented enum value round-trips", () => {
  for (const value of ["ACTIVE", "INACTIVE", "NOT_PROTECTED", "PENDING", "PROTECTED"]) {
    assert.equal(parseProtectStatus(value), value);
  }
  for (const value of ["ELIGIBLE", "NOT_ELIGIBLE", "PENDING"]) {
    assert.equal(parseProtectEligibility(value), value);
  }
});

test("reads Shopify's nested shape", () => {
  assert.deepEqual(readProtect({ status: "PROTECTED", eligibility: { status: "ELIGIBLE" } }), {
    status: "PROTECTED",
    eligibility: "ELIGIBLE"
  });

  // Missing eligibility must not throw or invent a value.
  assert.deepEqual(readProtect({ status: "ACTIVE" }), { status: "ACTIVE", eligibility: "UNKNOWN" });
  assert.deepEqual(readProtect(null), { status: "UNKNOWN", eligibility: "UNKNOWN" });
});

test("PROTECTED says the money is back and stops the fight", () => {
  const signal = describeProtect({ status: "PROTECTED", eligibility: "ELIGIBLE" });

  assert.equal(signal.show, true);
  assert.equal(signal.moneyAlreadyReturned, true);
  assert.equal(signal.tone, "success");
  // The whole point: reimbursed money is still a ratio event.
  assert.match(signal.detail, /ratio/i);
  assert.equal(signal.showCriteria, false, "no checklist - nothing was lost");
});

test("NOT_PROTECTED is the only status that offers the criteria", () => {
  const signal = describeProtect({ status: "NOT_PROTECTED", eligibility: "NOT_ELIGIBLE" });

  assert.equal(signal.show, true);
  assert.equal(signal.tone, "warning");
  assert.equal(signal.moneyAlreadyReturned, false);
  assert.equal(signal.showCriteria, true);
  // Shopify returns no reason, so the copy must not claim to know one.
  assert.match(signal.detail, /does not publish which/i);
});

test("INACTIVE, PENDING and UNKNOWN are silent", () => {
  // This is the non-US merchant, and the majority of orders everywhere.
  for (const status of ["INACTIVE", "PENDING", "UNKNOWN"] as const) {
    const signal = describeProtect({ status, eligibility: "NOT_ELIGIBLE" });
    assert.equal(signal.show, false, `${status} must render nothing`);
    assert.equal(signal.headline, "");
    assert.equal(signal.showCriteria, false);
  }
});

test("ACTIVE is stated but never promised", () => {
  const signal = describeProtect({ status: "ACTIVE", eligibility: "ELIGIBLE" });

  assert.equal(signal.show, true);
  assert.equal(signal.moneyAlreadyReturned, false, "coverage is not the same as payment");
  assert.match(signal.detail, /not a guarantee/i);
});

test("only NOT_PROTECTED counts as lost coverage", () => {
  assert.equal(isLostCoverage("NOT_PROTECTED"), true);

  // INACTIVE is the resting state of an ineligible order. Counting it would
  // report a loss to every merchant outside the US, forever.
  for (const status of ["INACTIVE", "PENDING", "UNKNOWN", "ACTIVE", "PROTECTED"] as const) {
    assert.equal(isLostCoverage(status), false, `${status} is not a lost coverage event`);
  }
});

test("Protect is only claimed to apply where Shopify has said something", () => {
  assert.equal(protectAppliesToShop([]), false);

  // A non-US shop: every order ineligible, every eligibility negative.
  assert.equal(
    protectAppliesToShop([
      { status: "INACTIVE", eligibility: "NOT_ELIGIBLE" },
      { status: "INACTIVE", eligibility: "NOT_ELIGIBLE" }
    ]),
    false,
    "a shop that has never had an eligible order should never see a Protect panel"
  );

  assert.equal(
    protectAppliesToShop([
      { status: "INACTIVE", eligibility: "NOT_ELIGIBLE" },
      { status: "PROTECTED", eligibility: "ELIGIBLE" }
    ]),
    true
  );
  assert.equal(protectAppliesToShop([{ status: "INACTIVE", eligibility: "ELIGIBLE" }]), true);
});

test("orders synced before the field existed are UNKNOWN, not uncovered", () => {
  // The regression this guards: every order in the database today predates the
  // query change. Reading them as NOT_PROTECTED would invent a coverage loss on
  // every historical dispute the first time this shipped.
  const legacy = JSON.stringify({ id: "gid://shopify/Order/1", name: "#1001" });
  assert.deepEqual(readProtectFromOrderJson(legacy), { status: "UNKNOWN", eligibility: "UNKNOWN" });

  assert.deepEqual(readProtectFromOrderJson(null), { status: "UNKNOWN", eligibility: "UNKNOWN" });
  assert.deepEqual(readProtectFromOrderJson("not json"), { status: "UNKNOWN", eligibility: "UNKNOWN" });
  assert.deepEqual(readProtectFromOrderJson(""), { status: "UNKNOWN", eligibility: "UNKNOWN" });
});

test("reads a current snapshot", () => {
  const current = JSON.stringify({
    id: "gid://shopify/Order/2",
    shopifyProtect: { status: "NOT_PROTECTED", eligibility: { status: "NOT_ELIGIBLE" } }
  });

  assert.deepEqual(readProtectFromOrderJson(current), {
    status: "NOT_PROTECTED",
    eligibility: "NOT_ELIGIBLE"
  });
});

test("the criteria are Shopify's, and specific enough to check", () => {
  assert.ok(COVERAGE_CRITERIA.length >= 5);
  assert.ok(COVERAGE_CRITERIA.some((c) => /Shop Pay/.test(c)), "Shop Pay is the gating requirement");
  assert.ok(COVERAGE_CRITERIA.some((c) => /7 days/.test(c)), "the fulfilment window is checkable");
});
