import { cookies } from "next/headers";

import { shopifyConfig } from "@/lib/shopify/config";
import {
  SESSION_COOKIE,
  readSessionCookieValue,
  verifySessionToken
} from "@/lib/shopify/session-token";

/**
 * The single source of truth for "which shop is making this request".
 *
 * Replaces `resolveShopDomain`, which returned the raw `?shop=` query
 * parameter and so let anyone read or mutate any merchant's data.
 *
 * Trusted sources, in order:
 *   1. `Authorization: Bearer <App Bridge session token>` (client fetches)
 *   2. `?id_token=` (Shopify's initial embedded page load)
 *   3. Our own signed session cookie (minted in middleware from 1 or 2)
 */

function unsafeQueryParamAllowed() {
  /**
   * Cannot be switched on in production, whatever the environment says.
   *
   * This flag makes `?shop=` an accepted identity, which turns every
   * merchant-scoped route cross-tenant: one curl with someone else's shop
   * domain returns their evidence packet. Three project docs said "never set
   * this", which made human memory the only control. `lib/diagnostics-auth.ts`
   * already refuses to fail open in production; this now matches it.
   */
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return process.env.UNSAFE_ALLOW_SHOP_QUERY_PARAM === "true";
}

export type AuthenticatedContext = {
  shopDomain: string;
  /** The raw session token, when this request carried one. Needed for token exchange. */
  sessionToken: string | null;
};

async function fromToken(token: string | null): Promise<string | null> {
  if (!token) {
    return null;
  }

  const claims = await verifySessionToken(token, {
    apiKey: shopifyConfig.apiKey,
    apiSecret: shopifyConfig.apiSecret
  });

  return claims?.shopDomain ?? null;
}

async function fromCookie(): Promise<string | null> {
  const store = await cookies();
  return readSessionCookieValue(store.get(SESSION_COOKIE)?.value, shopifyConfig.apiSecret);
}

/**
 * Full context for a route handler: the shop AND the session token it presented,
 * so callers can exchange that token for an access token.
 */
export async function getAuthenticatedContext(request: Request): Promise<AuthenticatedContext | null> {
  const bearer = request.headers.get("authorization");
  const headerToken = bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null;

  const fromHeader = await fromToken(headerToken);
  if (fromHeader) {
    return { shopDomain: fromHeader, sessionToken: headerToken };
  }

  const url = new URL(request.url);
  const idToken = url.searchParams.get("id_token");
  const fromIdToken = await fromToken(idToken);
  if (fromIdToken) {
    return { shopDomain: fromIdToken, sessionToken: idToken };
  }

  const shopDomain = await getAuthenticatedShopDomain(request);
  return shopDomain ? { shopDomain, sessionToken: null } : null;
}

/** For route handlers, which have the Request object. */
export async function getAuthenticatedShopDomain(request: Request): Promise<string | null> {
  const bearer = request.headers.get("authorization");
  const headerToken = bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null;

  const fromHeader = await fromToken(headerToken);
  if (fromHeader) {
    return fromHeader;
  }

  const url = new URL(request.url);
  const fromIdToken = await fromToken(url.searchParams.get("id_token"));
  if (fromIdToken) {
    return fromIdToken;
  }

  const fromSession = await fromCookie();
  if (fromSession) {
    return fromSession;
  }

  const legacy = url.searchParams.get("shop");
  if (legacy && unsafeQueryParamAllowed()) {
    console.warn(
      `[auth] UNSAFE_ALLOW_SHOP_QUERY_PARAM is enabled - trusting unverified ?shop=${legacy}. ` +
        "This allows cross-tenant access and must never be set in production."
    );
    return legacy;
  }

  return null;
}

/** For server components, which only have searchParams and cookies. */
export async function getAuthenticatedShopDomainForPage(
  searchParams?: Record<string, string | string[] | undefined>
): Promise<string | null> {
  const raw = searchParams?.id_token;
  const idToken = Array.isArray(raw) ? raw[0] : raw;

  const fromIdToken = await fromToken(idToken ?? null);
  if (fromIdToken) {
    return fromIdToken;
  }

  const fromSession = await fromCookie();
  if (fromSession) {
    return fromSession;
  }

  const rawShop = searchParams?.shop;
  const legacy = Array.isArray(rawShop) ? rawShop[0] : rawShop;
  if (legacy && unsafeQueryParamAllowed()) {
    console.warn(`[auth] UNSAFE_ALLOW_SHOP_QUERY_PARAM is enabled - trusting unverified ?shop=${legacy}.`);
    return legacy;
  }

  return null;
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Throws UnauthorizedError instead of returning null. */
export async function requireShopDomain(request: Request): Promise<string> {
  const shopDomain = await getAuthenticatedShopDomain(request);
  if (!shopDomain) {
    throw new UnauthorizedError("No verified Shopify session for this request.");
  }
  return shopDomain;
}
