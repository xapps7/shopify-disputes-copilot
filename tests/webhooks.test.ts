import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { computeWebhookHmac, isValidWebhookHmac } from "../lib/compliance/hmac.ts";
import {
  WEBHOOK_MAX_AGE_MS,
  decideWebhookDelivery,
  evaluateWebhookFreshness
} from "../lib/compliance/replay.ts";
import { orderIdCandidates, scrubCustomerPii, scrubJsonString } from "../lib/compliance/scrub.ts";

const SECRET = "shpss_test_webhook_secret";
const BODY = JSON.stringify({ shop_domain: "acme.myshopify.com", customer: { id: 191167 } });

function sign(body: string, secret = SECRET) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

/* ------------------------------------------------------------------ *
 * HMAC verification
 * ------------------------------------------------------------------ */

test("accepts a correctly signed body", () => {
  assert.equal(isValidWebhookHmac(BODY, sign(BODY), SECRET), true);
});

test("computeWebhookHmac matches a hand-rolled base64 sha256 hmac", () => {
  assert.equal(computeWebhookHmac(BODY, SECRET), sign(BODY));
});

test("rejects a signature produced with a different secret (wrong signature)", () => {
  const forged = sign(BODY, "attacker_secret");
  assert.notEqual(forged, sign(BODY));
  assert.equal(isValidWebhookHmac(BODY, forged, SECRET), false);
});

test("rejects a valid signature over a different body", () => {
  const otherBody = JSON.stringify({ shop_domain: "evil.myshopify.com" });
  assert.equal(isValidWebhookHmac(BODY, sign(otherBody), SECRET), false);
});

test("rejects - does not throw - when the header length differs from the digest", () => {
  // crypto.timingSafeEqual THROWS on unequal buffer lengths. Without the explicit
  // length guard a truncated header turns a 401 into an unhandled 500.
  const truncated = sign(BODY).slice(0, 10);
  const oversized = `${sign(BODY)}AAAA`;

  assert.doesNotThrow(() => isValidWebhookHmac(BODY, truncated, SECRET));
  assert.equal(isValidWebhookHmac(BODY, truncated, SECRET), false);
  assert.doesNotThrow(() => isValidWebhookHmac(BODY, oversized, SECRET));
  assert.equal(isValidWebhookHmac(BODY, oversized, SECRET), false);
});

test("rejects a missing or empty hmac header", () => {
  assert.equal(isValidWebhookHmac(BODY, null, SECRET), false);
  assert.equal(isValidWebhookHmac(BODY, undefined, SECRET), false);
  assert.equal(isValidWebhookHmac(BODY, "", SECRET), false);
});

test("signature is body-exact (an empty body is not interchangeable)", () => {
  assert.equal(isValidWebhookHmac("", sign(BODY), SECRET), false);
  assert.equal(isValidWebhookHmac("", sign(""), SECRET), true);
});

/* ------------------------------------------------------------------ *
 * Replay / staleness
 * ------------------------------------------------------------------ */

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

test("a webhook triggered just now is fresh", () => {
  const freshness = evaluateWebhookFreshness("2026-08-11T11:59:30.000Z", NOW);
  assert.equal(freshness.fresh, true);
  assert.equal(freshness.reason, "ok");
  assert.equal(freshness.ageMs, 30_000);
});

test("rejects a delivery older than the 5 minute window", () => {
  const freshness = evaluateWebhookFreshness("2026-08-11T11:54:00.000Z", NOW);
  assert.equal(freshness.fresh, false);
  assert.equal(freshness.reason, "stale");
  assert.equal(freshness.ageMs, 6 * 60 * 1000);
});

test("the boundary itself is accepted, one millisecond past it is not", () => {
  const atBoundary = new Date(NOW - WEBHOOK_MAX_AGE_MS).toISOString();
  const pastBoundary = new Date(NOW - WEBHOOK_MAX_AGE_MS - 1).toISOString();

  assert.equal(evaluateWebhookFreshness(atBoundary, NOW).fresh, true);
  assert.equal(evaluateWebhookFreshness(pastBoundary, NOW).fresh, false);
});

test("a missing or unparseable triggered-at is accepted, not silently dropped", () => {
  // Shopify's automated submission checks do not always set the header; hard
  // failing there would auto-reject the app.
  assert.deepEqual(evaluateWebhookFreshness(null, NOW), {
    fresh: true,
    reason: "missing",
    ageMs: null
  });
  assert.deepEqual(evaluateWebhookFreshness("not-a-date", NOW), {
    fresh: true,
    reason: "unparseable",
    ageMs: null
  });
});

test("a future timestamp is treated as clock skew, not as an attack", () => {
  const freshness = evaluateWebhookFreshness("2026-08-11T12:00:30.000Z", NOW);
  assert.equal(freshness.fresh, true);
  assert.equal(freshness.ageMs, -30_000);
});

test("decideWebhookDelivery processes a fresh, first-seen delivery", () => {
  const decision = decideWebhookDelivery({
    alreadySeen: false,
    triggeredAt: "2026-08-11T11:59:59.000Z",
    now: NOW
  });
  assert.deepEqual(decision, { process: true, reason: "ok", ageMs: 1000 });
});

test("decideWebhookDelivery drops a duplicate webhook id", () => {
  const decision = decideWebhookDelivery({
    alreadySeen: true,
    triggeredAt: "2026-08-11T11:59:59.000Z",
    now: NOW
  });
  assert.equal(decision.process, false);
  assert.equal(decision.reason, "duplicate");
});

test("staleness wins over dedupe so replays cannot grow the delivery table", () => {
  const decision = decideWebhookDelivery({
    alreadySeen: false,
    triggeredAt: "2026-08-11T10:00:00.000Z",
    now: NOW
  });
  assert.equal(decision.process, false);
  assert.equal(decision.reason, "stale");
});

/* ------------------------------------------------------------------ *
 * Customer PII scrubbing
 * ------------------------------------------------------------------ */

const ORDER_JSON = {
  id: "gid://shopify/Order/5432",
  name: "#1001",
  createdAt: "2026-07-01T10:00:00Z",
  displayFulfillmentStatus: "FULFILLED",
  currentTotalPriceSet: { shopMoney: { amount: "129.00", currencyCode: "USD" } },
  email: "ada@example.com",
  phone: "+15555550123",
  customer: {
    id: "gid://shopify/Customer/191167",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com"
  },
  shippingAddress: { address1: "1 Analytical Way", city: "London", zip: "EC1" },
  lineItems: { nodes: [{ name: "Difference Engine", quantity: 1, sku: "DE-1" }] },
  fulfillments: [{ trackingInfo: [{ company: "UPS", number: "1Z999", url: "https://ups.com/1Z999" }] }]
};

test("removes the customer subtree and top-level contact scalars", () => {
  const scrubbed = scrubCustomerPii(ORDER_JSON) as Record<string, unknown>;

  assert.equal(scrubbed.customer, null);
  assert.equal(scrubbed.shippingAddress, null);
  assert.equal(scrubbed.email, null);
  assert.equal(scrubbed.phone, null);
});

test("preserves the merchant-facing, non-personal fields", () => {
  const scrubbed = scrubCustomerPii(ORDER_JSON) as Record<string, unknown>;

  // `name` here is the ORDER NUMBER, not a person - blanket key-name scrubbing
  // would have destroyed it and broken every dispute view.
  assert.equal(scrubbed.name, "#1001");
  assert.equal(scrubbed.id, "gid://shopify/Order/5432");
  assert.equal(scrubbed.displayFulfillmentStatus, "FULFILLED");
  assert.deepEqual(scrubbed.currentTotalPriceSet, {
    shopMoney: { amount: "129.00", currencyCode: "USD" }
  });
});

test("preserves line item and tracking evidence", () => {
  const scrubbed = scrubCustomerPii(ORDER_JSON) as {
    lineItems: { nodes: Array<{ name: string; sku: string }> };
    fulfillments: Array<{ trackingInfo: Array<{ number: string }> }>;
  };

  assert.equal(scrubbed.lineItems.nodes[0].name, "Difference Engine");
  assert.equal(scrubbed.lineItems.nodes[0].sku, "DE-1");
  assert.equal(scrubbed.fulfillments[0].trackingInfo[0].number, "1Z999");
});

test("scrubs nested dispute snapshots (sourceSnapshotJson shape)", () => {
  const snapshot = {
    id: "gid://shopify/ShopifyPaymentsDispute/9",
    status: "NEEDS_RESPONSE",
    order: ORDER_JSON
  };

  const scrubbed = scrubCustomerPii(snapshot) as { order: Record<string, unknown>; status: string };

  assert.equal(scrubbed.status, "NEEDS_RESPONSE");
  assert.equal(scrubbed.order.customer, null);
  assert.equal(scrubbed.order.email, null);
  assert.equal(scrubbed.order.name, "#1001");
});

test("no trace of the customer's identifiers survives serialization", () => {
  const output = JSON.stringify(scrubCustomerPii(ORDER_JSON));

  assert.ok(!output.includes("ada@example.com"));
  assert.ok(!output.includes("Lovelace"));
  assert.ok(!output.includes("Ada"));
  assert.ok(!output.includes("+15555550123"));
  assert.ok(!output.includes("Analytical Way"));
});

test("handles arrays, nulls and primitives without mangling them", () => {
  assert.equal(scrubCustomerPii(null), null);
  assert.equal(scrubCustomerPii(42), 42);
  assert.equal(scrubCustomerPii("plain"), "plain");
  assert.deepEqual(scrubCustomerPii([{ email: "a@b.c", sku: "X" }]), [{ email: null, sku: "X" }]);
});

test("scrubJsonString round-trips a JSON string", () => {
  const scrubbed = JSON.parse(scrubJsonString(JSON.stringify(ORDER_JSON))!) as Record<string, unknown>;

  assert.equal(scrubbed.customer, null);
  assert.equal(scrubbed.name, "#1001");
});

test("scrubJsonString passes null through and replaces unparseable blobs", () => {
  assert.equal(scrubJsonString(null), null);
  assert.equal(scrubJsonString(undefined), null);

  // Cannot inspect it -> cannot certify it is clean -> replace it outright.
  const replaced = JSON.parse(scrubJsonString("{not json")!) as Record<string, unknown>;
  assert.equal(replaced.redacted, true);
  assert.equal(replaced.reason, "unparseable_on_redaction");
});

/* ------------------------------------------------------------------ *
 * Order id matching
 * ------------------------------------------------------------------ */

test("expands numeric compliance order ids into stored GID form", () => {
  const candidates = orderIdCandidates([5432, "5433"]);

  assert.ok(candidates.includes("gid://shopify/Order/5432"));
  assert.ok(candidates.includes("gid://shopify/Order/5433"));
  assert.ok(candidates.includes("5432"));
});

test("is idempotent for ids already in GID form and de-duplicates", () => {
  const candidates = orderIdCandidates(["gid://shopify/Order/5432", 5432]);

  assert.equal(new Set(candidates).size, candidates.length);
  assert.ok(candidates.includes("gid://shopify/Order/5432"));
});

test("returns an empty candidate list for empty input", () => {
  assert.deepEqual(orderIdCandidates([]), []);
  assert.deepEqual(orderIdCandidates(null), []);
  assert.deepEqual(orderIdCandidates(undefined), []);
});

// Regression: the deployed app had SHOPIFY_WEBHOOK_SECRET set to a DIFFERENT
// app's client secret, so every webhook 401'd — including the three mandatory
// privacy webhooks Shopify tests during review. Verified live: a body signed
// with the client secret was rejected. Webhooks must verify against the client
// secret, which is what `shopifyConfig.webhookSecret` now resolves to.
test("a body signed with the client secret verifies; another app's secret does not", () => {
  const body = JSON.stringify({ shop_domain: "example.myshopify.com", customer: { id: 1 } });
  const clientSecret = "shpss_client_secret_for_this_app";
  const otherAppSecret = "shpss_secret_belonging_to_a_different_app";

  const signed = computeWebhookHmac(body, clientSecret);

  assert.equal(isValidWebhookHmac(body, signed, clientSecret), true);
  assert.equal(isValidWebhookHmac(body, signed, otherAppSecret), false);
  assert.equal(isValidWebhookHmac(body, computeWebhookHmac(body, otherAppSecret), clientSecret), false);
});
