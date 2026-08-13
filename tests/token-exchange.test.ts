import test from "node:test";
import assert from "node:assert/strict";

import {
  OFFLINE_TOKEN_TYPE,
  buildTokenExchangeBody,
  parseTokenExchangeResponse
} from "../lib/shopify/token-exchange-core.ts";

test("builds the RFC 8693 body Shopify expects", () => {
  const body = buildTokenExchangeBody({
    sessionToken: "session.token.value",
    clientId: "client-id",
    clientSecret: "client-secret"
  });

  assert.equal(body.grant_type, "urn:ietf:params:oauth:grant-type:token-exchange");
  assert.equal(body.subject_token, "session.token.value");
  assert.equal(body.subject_token_type, "urn:ietf:params:oauth:token-type:id_token");
  assert.equal(body.requested_token_type, OFFLINE_TOKEN_TYPE);
  assert.equal(body.client_id, "client-id");
  assert.equal(body.client_secret, "client-secret");
});

test("honours an explicit requested token type", () => {
  const body = buildTokenExchangeBody({
    sessionToken: "t",
    clientId: "c",
    clientSecret: "s",
    requestedTokenType: "urn:shopify:params:oauth:token-type:online-access-token"
  });
  assert.match(body.requested_token_type, /online-access-token$/);
});

test("converts expires_in into an absolute expiry, renewing a minute early", () => {
  const now = Date.UTC(2026, 7, 13, 12, 0, 0);
  const parsed = parseTokenExchangeResponse(
    { access_token: "shpat_abc", scope: "read_orders,read_customers", expires_in: 86400 },
    now
  );

  assert.equal(parsed?.accessToken, "shpat_abc");
  assert.equal(parsed?.scope, "read_orders,read_customers");
  // 86400 - 60 seconds of skew
  assert.equal(parsed?.expiresAt?.getTime(), now + (86400 - 60) * 1000);
});

test("a non-expiring token yields a null expiry rather than a bogus date", () => {
  const parsed = parseTokenExchangeResponse({ access_token: "shpat_abc", scope: "read_orders" });
  assert.equal(parsed?.expiresAt, null);
  assert.equal(parsed?.accessToken, "shpat_abc");
});

test("rejects responses with no usable access token", () => {
  assert.equal(parseTokenExchangeResponse(null), null);
  assert.equal(parseTokenExchangeResponse({}), null);
  assert.equal(parseTokenExchangeResponse({ access_token: "" }), null);
  assert.equal(parseTokenExchangeResponse({ access_token: 42 }), null);
  assert.equal(parseTokenExchangeResponse("shpat_abc"), null);
});

test("a malformed expires_in does not produce an Invalid Date", () => {
  const parsed = parseTokenExchangeResponse({ access_token: "shpat_abc", expires_in: "soon" });
  assert.equal(parsed?.expiresAt, null);
});
