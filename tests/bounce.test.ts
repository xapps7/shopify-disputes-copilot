import test from "node:test";
import assert from "node:assert/strict";

import {
  BOUNCE_MARKER,
  BOUNCE_PATH,
  buildBounceUrl,
  hasBounced,
  isSafeReloadTarget,
  toUrlSearchParams
} from "../lib/shopify/bounce.ts";

// Shopify-managed installation removes the OAuth callback, so the bounce page is
// the app's ONLY route from "no session token" back to authenticated. A defect
// here does not degrade the app - it makes it unopenable, and invisibly so,
// because a redirect loop inside the admin iframe just never paints.

test("sends the browser to the bounce page", () => {
  const url = buildBounceUrl("/disputes", new URLSearchParams({ shop: "x.myshopify.com" }));
  assert.ok(url.startsWith(`${BOUNCE_PATH}?`));
});

test("carries shop and host through, so App Bridge can boot", () => {
  const params = new URLSearchParams({ shop: "x.myshopify.com", host: "YWRtaW4=", embedded: "1" });
  const url = new URL(buildBounceUrl("/disputes", params), "https://app.example");

  assert.equal(url.searchParams.get("shop"), "x.myshopify.com");
  assert.equal(url.searchParams.get("host"), "YWRtaW4=");
  assert.equal(url.searchParams.get("embedded"), "1");
});

test("drops the stale id_token rather than asking App Bridge to reuse it", () => {
  const params = new URLSearchParams({ shop: "x.myshopify.com", id_token: "stale.jwt.value" });
  const url = new URL(buildBounceUrl("/disputes", params), "https://app.example");

  assert.equal(url.searchParams.get("id_token"), null);

  const reload = new URL(url.searchParams.get("shopify-reload")!, "https://app.example");
  assert.equal(reload.searchParams.get("id_token"), null);
});

test("reload target is the page we came from", () => {
  const url = new URL(buildBounceUrl("/disputes/abc123", new URLSearchParams()), "https://app.example");
  const reload = new URL(url.searchParams.get("shopify-reload")!, "https://app.example");

  assert.equal(reload.pathname, "/disputes/abc123");
});

test("marks the reload so a second failure cannot loop forever", () => {
  const url = new URL(buildBounceUrl("/", new URLSearchParams()), "https://app.example");
  const reload = new URL(url.searchParams.get("shopify-reload")!, "https://app.example");

  assert.equal(reload.searchParams.get(BOUNCE_MARKER), "1");
  assert.equal(hasBounced(reload.searchParams), true);
  assert.equal(hasBounced(new URLSearchParams()), false);
});

test("does not nest shopify-reload inside itself on a repeat bounce", () => {
  const first = new URL(buildBounceUrl("/", new URLSearchParams()), "https://app.example");
  const second = new URL(buildBounceUrl("/", first.searchParams), "https://app.example");
  const reload = new URL(second.searchParams.get("shopify-reload")!, "https://app.example");

  assert.equal(reload.searchParams.get("shopify-reload"), null);
});

test("rejects reload targets that leave this app", () => {
  // App Bridge follows shopify-reload inside the merchant's admin, so an
  // attacker-supplied value here would be an open redirect with their session.
  assert.equal(isSafeReloadTarget("/disputes"), true);
  assert.equal(isSafeReloadTarget("/"), true);

  assert.equal(isSafeReloadTarget("//evil.example/steal"), false, "protocol-relative");
  assert.equal(isSafeReloadTarget("https://evil.example"), false);
  assert.equal(isSafeReloadTarget("javascript:alert(1)"), false);
  assert.equal(isSafeReloadTarget(""), false);
  assert.equal(isSafeReloadTarget(null), false);
  assert.equal(isSafeReloadTarget(undefined), false);
});

test("converts a server component searchParams object", () => {
  const params = toUrlSearchParams({
    shop: "x.myshopify.com",
    tab: ["open", "closed"],
    missing: undefined
  });

  assert.equal(params.get("shop"), "x.myshopify.com");
  assert.equal(params.get("tab"), "open");
  assert.equal(params.has("missing"), false);
});

test("handles no searchParams at all", () => {
  assert.equal(toUrlSearchParams(undefined).toString(), "");
});
