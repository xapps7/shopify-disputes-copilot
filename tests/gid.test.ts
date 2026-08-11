import test from "node:test";
import assert from "node:assert/strict";

// Mirrors toDisputeGid in lib/disputes/shopify-sync.ts. Order.disputes returns
// OrderDisputeSummary GIDs while the top-level disputes connection returns
// ShopifyPaymentsDispute GIDs for the SAME dispute — keying on the raw GID
// stored every dispute twice (observed live: 5 real disputes -> syncedCount 8).
function toDisputeGid(id: string): string {
  const numericId = id.split("/").pop();
  return numericId ? `gid://shopify/ShopifyPaymentsDispute/${numericId}` : id;
}

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
