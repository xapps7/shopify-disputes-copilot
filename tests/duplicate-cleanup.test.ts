import test from "node:test";
import assert from "node:assert/strict";

import { isLegacyDisputeKey } from "../lib/disputes/dispute-keys.ts";

/**
 * The exact duplicate seen in the queue: dispute 11376754869 appearing twice,
 * once with a real reason and deadline and once as "General / No auto-submit
 * date". Two rows, because Shopify hands the same dispute back under two GID
 * types and the old code keyed on the raw value.
 */
test("the order-derived twin is recognised as a legacy row", () => {
  assert.ok(isLegacyDisputeKey("gid://shopify/OrderDisputeSummary/11376754869"));
  assert.ok(isLegacyDisputeKey("gid://shopify/OrderDisputeSummary/11449893045"));
});

test("the /unknown row from the old webhook bug is recognised", () => {
  assert.ok(isLegacyDisputeKey("gid://shopify/ShopifyPaymentsDispute/unknown"));
});

test("a real dispute key is never treated as legacy", () => {
  assert.ok(!isLegacyDisputeKey("gid://shopify/ShopifyPaymentsDispute/11376754869"));
  assert.ok(!isLegacyDisputeKey("gid://shopify/ShopifyPaymentsDispute/11450876085"));
});

test("a GID shape Shopify might add later is left alone, not guessed at", () => {
  // The rule matches on the two known-bad types, not on "looks unfamiliar".
  // A delete rule written before a shape existed must not delete that shape.
  assert.ok(!isLegacyDisputeKey("gid://shopify/SomeFutureDisputeType/11376754869"));
  assert.ok(!isLegacyDisputeKey("11376754869"));
});

test("a dispute whose numeric id merely ends in the word is not matched", () => {
  // endsWith("/unknown") requires the separator, so an id cannot trip it by
  // coincidence.
  assert.ok(!isLegacyDisputeKey("gid://shopify/ShopifyPaymentsDispute/unknown-1"));
});
