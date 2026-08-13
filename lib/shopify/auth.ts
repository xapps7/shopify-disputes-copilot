import crypto from "node:crypto";
import { SESSION_COOKIE, readSessionCookieValue } from "@/lib/shopify/session-token";

import { cookies } from "next/headers";

import { buildEmbeddedAdminUrl } from "@/lib/shopify/embedded";

const SHOP_COOKIE = "shopify_disputes_shop";
const HOST_COOKIE = "shopify_disputes_host";
const STATE_COOKIE = "shopify_disputes_state";

export function normalizeShopDomain(shop: string) {
  const normalized = shop.trim().toLowerCase();
  const isValid = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized);

  if (!isValid) {
    throw new Error("Invalid Shopify shop domain.");
  }

  return normalized;
}

export async function getCurrentShopDomain() {
  // Prefer the signed session cookie minted from a verified App Bridge token;
  // the legacy SHOP_COOKIE is SameSite=Lax and is never sent inside the admin
  // iframe, which is what pushed every caller onto the unsafe ?shop= param.
  const store = await cookies();
  const verified = await readSessionCookieValue(
    store.get(SESSION_COOKIE)?.value,
    process.env.SHOPIFY_API_SECRET ?? ""
  );
  if (verified) {
    return verified;
  }

  return store.get(SHOP_COOKIE)?.value ?? null;
}

export function getSingleSearchParam(
  value: string | string[] | undefined
) {
  return Array.isArray(value) ? value[0] : value;
}

export async function resolveShopDomain(
  searchParams?: Record<string, string | string[] | undefined>
) {
  const fromParams = getSingleSearchParam(searchParams?.shop);
  return fromParams ?? (await getCurrentShopDomain());
}

export async function getCurrentHost() {
  const store = await cookies();
  return store.get(HOST_COOKIE)?.value ?? null;
}

export async function setCurrentShopDomain(shopDomain: string) {
  const store = await cookies();
  store.set(SHOP_COOKIE, shopDomain, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/"
  });
}

export async function setCurrentHost(host: string) {
  const store = await cookies();
  store.set(HOST_COOKIE, host, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/"
  });
}

// NOTE: /dashboard was removed - it was a bare redirect to "/". Defaulting to it
// here would land a freshly installed merchant on a 404.
export function buildEmbeddedAppUrl(shopDomain: string, pathname = "/", host?: string | null) {
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return buildEmbeddedAdminUrl(apiKey, shopDomain, pathname, host);
}

export async function setOauthState(state: string) {
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/"
  });
}

export async function consumeOauthState() {
  const store = await cookies();
  const value = store.get(STATE_COOKIE)?.value ?? null;
  store.delete(STATE_COOKIE);
  return value;
}

/**
 * IMPORTANT: the requested scopes come from the SHOPIFY_SCOPES environment
 * variable, NOT from shopify.app.toml. Adding a scope to the TOML changes what
 * Shopify records for the app, but the consent screen a merchant actually sees
 * is built here - so both must be updated or the reinstall silently grants the
 * old scope set.
 */
export function buildInstallUrl(shop: string, state: string) {
  const scopes = process.env.SHOPIFY_SCOPES ?? "";

  if (!scopes) {
    throw new Error("SHOPIFY_SCOPES is not set; refusing to build an install URL with no scopes.");
  }

  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY ?? "",
    scope: scopes,
    redirect_uri: `${process.env.SHOPIFY_APP_URL}/api/auth/callback`,
    state
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

export function createOauthState() {
  return crypto.randomBytes(16).toString("hex");
}

export function verifyOAuthCallback(searchParams: URLSearchParams) {
  const providedHmac = searchParams.get("hmac");
  if (!providedHmac) {
    return false;
  }

  const message = [...searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET ?? "")
    .update(message)
    .digest("hex");

  const digestBuffer = Buffer.from(digest);
  const hmacBuffer = Buffer.from(providedHmac);

  return digestBuffer.length === hmacBuffer.length && crypto.timingSafeEqual(digestBuffer, hmacBuffer);
}
