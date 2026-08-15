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

/* ---------------------------------------------------- expiring tokens --- */

test("requests an EXPIRING offline token — mandatory for public apps", async () => {
  const { buildTokenExchangeBody, OFFLINE_TOKEN_TYPE } = await import(
    "../lib/shopify/token-exchange-core.ts"
  );

  const body = buildTokenExchangeBody({ sessionToken: "t", clientId: "c", clientSecret: "s" }) as Record<
    string,
    unknown
  >;

  assert.equal(body.expiring, 1, "without expiring=1 Shopify issues a non-expiring token");
  assert.equal(body.requested_token_type, OFFLINE_TOKEN_TYPE);
});

test("does not send expiring=1 when asking for an ONLINE token", async () => {
  const { buildTokenExchangeBody, ONLINE_TOKEN_TYPE } = await import(
    "../lib/shopify/token-exchange-core.ts"
  );

  const body = buildTokenExchangeBody({
    sessionToken: "t",
    clientId: "c",
    clientSecret: "s",
    requestedTokenType: ONLINE_TOKEN_TYPE
  }) as Record<string, unknown>;

  assert.equal(body.expiring, undefined, "expiring only applies to offline tokens");
});

test("keeps the refresh token and its own expiry", async () => {
  const { parseTokenExchangeResponse } = await import("../lib/shopify/token-exchange-core.ts");
  const now = Date.UTC(2026, 7, 15, 12, 0, 0);

  const parsed = parseTokenExchangeResponse(
    {
      access_token: "shpat_abc",
      scope: "read_orders",
      expires_in: 3600,
      refresh_token: "shprt_xyz",
      refresh_token_expires_in: 7_776_000
    },
    now
  );

  assert.equal(parsed?.refreshToken, "shprt_xyz");
  assert.equal(parsed?.expiresAt?.getTime(), now + (3600 - 60) * 1000);
  assert.equal(parsed?.refreshTokenExpiresAt?.getTime(), now + 7_776_000 * 1000);
});

test("a legacy non-expiring response yields null expiries, not bogus dates", async () => {
  const { parseTokenExchangeResponse } = await import("../lib/shopify/token-exchange-core.ts");
  const parsed = parseTokenExchangeResponse({ access_token: "shpat_abc", scope: "read_orders" });

  assert.equal(parsed?.expiresAt, null);
  assert.equal(parsed?.refreshToken, null);
  assert.equal(parsed?.refreshTokenExpiresAt, null);
});

test("builds a refresh request that rotates the token", async () => {
  const { buildRefreshTokenBody } = await import("../lib/shopify/token-exchange-core.ts");
  const body = buildRefreshTokenBody({ refreshToken: "shprt_xyz", clientId: "c", clientSecret: "s" });

  assert.equal(body.grant_type, "refresh_token");
  assert.equal(body.refresh_token, "shprt_xyz");
});

test("migration sends the OLD ACCESS TOKEN as the subject, not a session token", async () => {
  const { buildTokenMigrationBody, OFFLINE_TOKEN_TYPE } = await import(
    "../lib/shopify/token-exchange-core.ts"
  );

  const body = buildTokenMigrationBody({
    nonExpiringAccessToken: "shpat_legacy",
    clientId: "c",
    clientSecret: "s"
  }) as Record<string, unknown>;

  // This is the detail that trips people up: subject_token_type differs from
  // the session-token flow, and Shopify revokes the old token on success.
  assert.equal(body.subject_token, "shpat_legacy");
  assert.equal(body.subject_token_type, OFFLINE_TOKEN_TYPE);
  assert.equal(body.requested_token_type, OFFLINE_TOKEN_TYPE);
  assert.equal(body.expiring, 1);
});
