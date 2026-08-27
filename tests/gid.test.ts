import test from "node:test";
import assert from "node:assert/strict";

// The real implementation, not a copy of it. It lives in an import-free
// module precisely so this test can reach it - a mirrored copy is a second
// definition of the rule and free to drift from the one that ships.
import { toDisputeGid } from "../lib/disputes/dispute-keys.ts";


test("collapses OrderDisputeSummary and ShopifyPaymentsDispute GIDs", () => {
  const fromOrder = "gid://shopify/OrderDisputeSummary/11450876085";
  const fromDisputes = "gid://shopify/ShopifyPaymentsDispute/11450876085";
  assert.equal(toDisputeGid(fromOrder), toDisputeGid(fromDisputes));
  assert.equal(toDisputeGid(fromOrder), fromDisputes);
});

test("is idempotent", () => {
  const gid = "gid://shopify/ShopifyPaymentsDispute/11449893045";
  assert.equal(toDisputeGid(toDisputeGid(gid)), gid);
});

test("dedupes the exact live payload that produced 8 rows for 5 disputes", () => {
  const topLevel = [
    "gid://shopify/ShopifyPaymentsDispute/11450876085",
    "gid://shopify/ShopifyPaymentsDispute/11449893045",
    "gid://shopify/ShopifyPaymentsDispute/11376754869",
    "gid://shopify/ShopifyPaymentsDispute/11215732917",
    "gid://shopify/ShopifyPaymentsDispute/11201609909"
  ];
  const orderDerived = [
    "gid://shopify/OrderDisputeSummary/11450876085",
    "gid://shopify/OrderDisputeSummary/11449893045",
    "gid://shopify/OrderDisputeSummary/11376754869"
  ];

  const naive = new Set([...topLevel, ...orderDerived]);
  assert.equal(naive.size, 8, "reproduces the duplication bug");

  const fixed = new Set([...topLevel, ...orderDerived].map(toDisputeGid));
  assert.equal(fixed.size, 5, "matches the 5 disputes Shopify actually reports");
});

/* --- the webhook path, which used to bypass normalisation entirely --------- */

test("a webhook admin_graphql_api_id is normalised, not trusted", () => {
  // lib/disputes/sync.ts took payload.admin_graphql_api_id verbatim as the
  // upsert key. Any other GID type in that field wrote a SECOND row for a
  // dispute that already existed - the duplicate the queue then shows twice.
  assert.equal(
    toDisputeGid("gid://shopify/OrderDisputeSummary/11450876085"),
    "gid://shopify/ShopifyPaymentsDispute/11450876085"
  );
  // Already correct values pass through untouched, so normalising is safe to
  // apply unconditionally at the write.
  assert.equal(
    toDisputeGid("gid://shopify/ShopifyPaymentsDispute/11450876085"),
    "gid://shopify/ShopifyPaymentsDispute/11450876085"
  );
});
