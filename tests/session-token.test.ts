import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionCookieValue,
  readSessionCookieValue,
  shopDomainFromUrlClaim,
  verifySessionToken
} from "../lib/shopify/session-token.ts";

const API_KEY = "a1a4e4368181a1f98c5add6e1805e0aa";
const API_SECRET = "shpss_test_secret_value_0123456789";
const SHOP = "disputes-mresg5f8.myshopify.com";

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mint(payload: Record<string, unknown>, secret = API_SECRET, header = { alg: "HS256", typ: "JWT" }) {
  const h = b64url(encoder.encode(JSON.stringify(header)));
  const p = b64url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud: API_KEY,
    sub: "42",
    exp: now + 60,
    nbf: now - 10,
    iat: now - 10,
    jti: "abc",
    sid: "session-1",
    ...overrides
  };
}

const opts = { apiKey: API_KEY, apiSecret: API_SECRET };

test("accepts a valid session token and returns the shop from dest", async () => {
  const result = await verifySessionToken(await mint(claims()), opts);
  assert.equal(result?.shopDomain, SHOP);
  assert.equal(result?.sessionId, "session-1");
});

test("rejects a token signed with the wrong secret", async () => {
  assert.equal(await verifySessionToken(await mint(claims(), "wrong-secret-wrong-secret"), opts), null);
});

test("rejects a token minted for a different app (aud mismatch)", async () => {
  assert.equal(await verifySessionToken(await mint(claims({ aud: "someone-elses-key" })), opts), null);
});

test("rejects an expired token", async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verifySessionToken(await mint(claims({ exp: now - 3600 })), opts), null);
});

test("rejects a not-yet-valid token", async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verifySessionToken(await mint(claims({ nbf: now + 3600 })), opts), null);
});

test("rejects alg:none and algorithm confusion", async () => {
  const payload = b64url(encoder.encode(JSON.stringify(claims())));
  const header = b64url(encoder.encode(JSON.stringify({ alg: "none", typ: "JWT" })));
  assert.equal(await verifySessionToken(`${header}.${payload}.`, opts), null);
  assert.equal(await verifySessionToken(await mint(claims(), API_SECRET, { alg: "RS256", typ: "JWT" }), opts), null);
});

test("rejects a token whose iss and dest disagree", async () => {
  const token = await mint(claims({ iss: "https://attacker.myshopify.com/admin" }));
  assert.equal(await verifySessionToken(token, opts), null);
});

test("rejects a non-myshopify dest", async () => {
  assert.equal(await verifySessionToken(await mint(claims({ dest: "https://evil.example.com" })), opts), null);
});

test("rejects garbage without throwing", async () => {
  for (const bad of ["", "a.b", "not-a-token", "a.b.c"]) {
    assert.equal(await verifySessionToken(bad, opts), null);
  }
});

test("shopDomainFromUrlClaim only accepts myshopify hosts", () => {
  assert.equal(shopDomainFromUrlClaim(`https://${SHOP}`), SHOP);
  assert.equal(shopDomainFromUrlClaim(SHOP), SHOP);
  assert.equal(shopDomainFromUrlClaim("https://evil.com"), null);
  assert.equal(shopDomainFromUrlClaim("https://myshopify.com.evil.com"), null);
  assert.equal(shopDomainFromUrlClaim(undefined), null);
});

test("session cookie round-trips and cannot be forged", async () => {
  const cookie = await createSessionCookieValue(SHOP, API_SECRET);
  assert.equal(await readSessionCookieValue(cookie, API_SECRET), SHOP);

  // Swapping the shop invalidates the signature — this is the attack the old
  // `?shop=` parameter allowed for free.
  const tampered = cookie.replace(SHOP, "victim.myshopify.com");
  assert.equal(await readSessionCookieValue(tampered, API_SECRET), null);

  assert.equal(await readSessionCookieValue(cookie, "different-secret"), null);
  assert.equal(await readSessionCookieValue(undefined, API_SECRET), null);
  assert.equal(await readSessionCookieValue("v1.shop.123.sig", API_SECRET), null);
});

test("an expired session cookie is rejected", async () => {
  const past = Date.now() - 48 * 60 * 60 * 1000;
  const cookie = await createSessionCookieValue(SHOP, API_SECRET, past);
  assert.equal(await readSessionCookieValue(cookie, API_SECRET), null);
});
