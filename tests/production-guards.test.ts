import test from "node:test";
import assert from "node:assert/strict";

import { isValidWebhookHmac, computeWebhookHmac } from "../lib/compliance/hmac.ts";

/**
 * Guards that only matter when something else is already misconfigured.
 *
 * Each of these was a fail-OPEN: the safe behaviour depended on an environment
 * variable being right, with nothing checking that it was. A control whose only
 * enforcement is a line in a document is not a control.
 */

test("an empty webhook secret verifies nothing", () => {
  // resolveWebhookSecret returns "" when neither secret is configured. Without
  // this check every webhook is verified against HMAC-SHA256(body, "") - a
  // signature any caller can compute - including shop/redact, which destroys
  // a merchant's data.
  const body = JSON.stringify({ shop_domain: "victim.myshopify.com" });
  const forged = computeWebhookHmac(body, "");

  assert.equal(isValidWebhookHmac(body, forged, ""), false);
});

test("a real secret still verifies its own signature", () => {
  const body = JSON.stringify({ shop_domain: "shop.myshopify.com" });
  const secret = "a-real-webhook-secret";

  assert.equal(isValidWebhookHmac(body, computeWebhookHmac(body, secret), secret), true);
  assert.equal(isValidWebhookHmac(body, computeWebhookHmac(body, "another-secret"), secret), false);
});

test("a missing signature header is rejected before anything else", () => {
  assert.equal(isValidWebhookHmac("{}", null, "secret"), false);
  assert.equal(isValidWebhookHmac("{}", undefined, "secret"), false);
  assert.equal(isValidWebhookHmac("{}", "", "secret"), false);
});
