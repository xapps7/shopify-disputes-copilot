import test from "node:test";
import assert from "node:assert/strict";

import { isLegacyDisputeKey, planDuplicateCleanup, type DisputeRowLike } from "../lib/disputes/dispute-keys.ts";

function row(overrides: Partial<DisputeRowLike> = {}): DisputeRowLike {
  return {
    id: "row-1",
    shopifyDisputeId: "gid://shopify/ShopifyPaymentsDispute/11376754869",
    reason: "FRAUDULENT",
    evidenceDueBy: new Date("2026-07-15T00:00:00Z"),
    hasMerchantWork: false,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides
  };
}

/**
 * The queue showed dispute 11376754869 twice: once "Fraudulent" with a deadline
 * and once "General / No auto-submit date". Two rows, because Shopify hands the
 * same dispute back under two GID types and the queue renders only the numeric
 * tail of the key.
 */
const REAL = "gid://shopify/ShopifyPaymentsDispute/11376754869";
const TWIN = "gid://shopify/OrderDisputeSummary/11376754869";

test("the order-derived twin is removed and the real row survives", () => {
  const plan = planDuplicateCleanup([
    row({ id: "real", shopifyDisputeId: REAL }),
    row({ id: "twin", shopifyDisputeId: TWIN, reason: "GENERAL", evidenceDueBy: null })
  ]);

  assert.deepEqual(plan.deleteIds, ["twin"]);
  assert.deepEqual(plan.keptWithWork, []);
});

test("order of arrival does not decide the winner", () => {
  // The twin was created first here. Canonical key still wins.
  const plan = planDuplicateCleanup([
    row({ id: "twin", shopifyDisputeId: TWIN, reason: null, evidenceDueBy: null, createdAt: new Date("2026-01-01T00:00:00Z") }),
    row({ id: "real", shopifyDisputeId: REAL, createdAt: new Date("2026-07-01T00:00:00Z") })
  ]);

  assert.deepEqual(plan.deleteIds, ["twin"]);
});

test("duplicates are found by identity, not by a recognised-bad prefix", () => {
  // Neither key is one of the two shapes previously known to be wrong. They are
  // still the same dispute, so one of them is still redundant. The earlier
  // prefix-matching version silently did nothing here.
  const plan = planDuplicateCleanup([
    row({ id: "a", shopifyDisputeId: REAL }),
    row({ id: "b", shopifyDisputeId: "gid://shopify/SomethingShopifyAddsLater/11376754869", reason: null, evidenceDueBy: null })
  ]);

  assert.deepEqual(plan.deleteIds, ["b"]);
});

test("a bare numeric key collapses into the canonical row", () => {
  const plan = planDuplicateCleanup([
    row({ id: "bare", shopifyDisputeId: "11376754869", reason: null, evidenceDueBy: null }),
    row({ id: "real", shopifyDisputeId: REAL })
  ]);

  assert.deepEqual(plan.deleteIds, ["bare"]);
});

test("a row carrying merchant work is never deleted, only reported", () => {
  // Evidence items and packets cascade on delete. Losing a merchant's uploads to
  // tidy a queue is not a trade worth making.
  const plan = planDuplicateCleanup([
    row({ id: "real", shopifyDisputeId: REAL }),
    row({ id: "twin", shopifyDisputeId: TWIN, reason: null, evidenceDueBy: null, hasMerchantWork: true })
  ]);

  assert.deepEqual(plan.deleteIds, []);
  assert.deepEqual(plan.keptWithWork, [TWIN]);
});

test("when no row holds the canonical key, the one with merchant work survives", () => {
  const plan = planDuplicateCleanup([
    row({ id: "empty", shopifyDisputeId: TWIN, reason: "GENERAL", evidenceDueBy: null }),
    row({
      id: "worked",
      shopifyDisputeId: "gid://shopify/OrderDisputeSummary/11376754869",
      reason: null,
      evidenceDueBy: null,
      hasMerchantWork: true
    })
  ]);

  assert.deepEqual(plan.deleteIds, ["empty"]);
  assert.deepEqual(plan.keptWithWork, []);
});

test("the richer record wins when neither key is canonical", () => {
  const plan = planDuplicateCleanup([
    row({ id: "thin", shopifyDisputeId: TWIN, reason: null, evidenceDueBy: null }),
    row({ id: "rich", shopifyDisputeId: "gid://shopify/OrderDisputeSummary/11376754869" })
  ]);

  assert.deepEqual(plan.deleteIds, ["thin"]);
});

test("a single row is never deleted, however odd its key", () => {
  // If it is the only record of a dispute, it is the record of that dispute.
  const plan = planDuplicateCleanup([row({ id: "lonely", shopifyDisputeId: TWIN, reason: null, evidenceDueBy: null })]);
  assert.deepEqual(plan.deleteIds, []);
});

test("different disputes are never collapsed into each other", () => {
  const plan = planDuplicateCleanup([
    row({ id: "a", shopifyDisputeId: "gid://shopify/ShopifyPaymentsDispute/11449893045" }),
    row({ id: "b", shopifyDisputeId: "gid://shopify/ShopifyPaymentsDispute/11450876085" })
  ]);

  assert.deepEqual(plan.deleteIds, []);
});

test("three copies of one dispute collapse to one", () => {
  const plan = planDuplicateCleanup([
    row({ id: "real", shopifyDisputeId: REAL }),
    row({ id: "twin", shopifyDisputeId: TWIN, reason: null, evidenceDueBy: null }),
    row({ id: "bare", shopifyDisputeId: "11376754869", reason: null, evidenceDueBy: null })
  ]);

  assert.equal(plan.deleteIds.length, 2);
  assert.ok(!plan.deleteIds.includes("real"));
});

test("the two historically bad key shapes are still recognised", () => {
  assert.ok(isLegacyDisputeKey(TWIN));
  assert.ok(isLegacyDisputeKey("gid://shopify/ShopifyPaymentsDispute/unknown"));
  assert.ok(!isLegacyDisputeKey(REAL));
});
