import crypto from "node:crypto";

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
  const store = await cookies();
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
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });
}

export async function setCurrentHost(host: string) {
  const store = await cookies();
  store.set(HOST_COOKIE, host, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });
}

export function buildEmbeddedAppUrl(shopDomain: string, pathname = "/dashboard", host?: string | null) {
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return buildEmbeddedAdminUrl(apiKey, shopDomain, pathname, host);
}

export async function setOauthState(state: string) {
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });
}

export async function consumeOauthState() {
  const store = await cookies();
  const value = store.get(STATE_COOKIE)?.value ?? null;
  store.delete(STATE_COOKIE);
  return value;
}

export function buildInstallUrl(shop: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY ?? "",
    scope: process.env.SHOPIFY_SCOPES ?? "",
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
