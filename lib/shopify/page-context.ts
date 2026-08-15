import type { Route } from "next";
import { redirect } from "next/navigation";

import { ensureMerchantAccessToken } from "@/lib/shopify/access-token";
import { buildBounceUrl, hasBounced, toUrlSearchParams } from "@/lib/shopify/bounce";
import { shopifyConfig } from "@/lib/shopify/config";
import { getAuthenticatedShopDomainForPage } from "@/lib/shopify/request-context";
import { verifySessionToken } from "@/lib/shopify/session-token";

/**
 * Page-level bootstrap for embedded server components.
 *
 * Under the legacy install flow the OAuth callback created the merchant row and
 * stored an access token before the app ever rendered. Shopify-managed
 * installation removes that callback entirely: the first time a page runs, the
 * merchant may not exist yet, and the only credential in hand is the `id_token`
 * Shopify appended to the URL.
 *
 * So every page now resolves identity AND makes sure an Admin API token exists,
 * exchanging the session token for one if not. `guardShopRoute` already does the
 * equivalent for API routes; this is the same contract for pages.
 */

export type PageSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  return Array.isArray(value) && value.length > 0 ? value[0] : null;
}

/**
 * Returns the shop for this page, or null when the request carries no verified
 * identity at all - in which case the page renders its signed-out state and the
 * middleware has already tried a bounce.
 *
 * `pathname` is the route's own path, used to build the reload target if this
 * request needs to go and fetch a session token.
 */
export async function getEmbeddedPageShop(
  searchParams: PageSearchParams | undefined,
  pathname: string
): Promise<string | null> {
  const params = searchParams ?? {};
  const shopDomain = await getAuthenticatedShopDomainForPage(params);

  if (!shopDomain) {
    return null;
  }

  const idToken = firstValue(params.id_token);
  const claims = idToken
    ? await verifySessionToken(idToken, {
        apiKey: shopifyConfig.apiKey,
        apiSecret: shopifyConfig.apiSecret
      })
    : null;

  // Only pass the token on if it belongs to the shop we just resolved. A token
  // for a different store must never be exchanged against this merchant row.
  const sessionToken = claims && claims.shopDomain === shopDomain ? idToken : null;

  const { hasToken } = await ensureMerchantAccessToken({ shopDomain, sessionToken });

  if (hasToken) {
    return shopDomain;
  }

  const search = toUrlSearchParams(params);

  // We know who this is but hold no usable Admin API token. If this request
  // carried a session token, the exchange itself failed and bouncing would only
  // repeat it - fall through and let the page render its empty state. Otherwise
  // one bounce gets us a fresh token to exchange.
  if (!sessionToken && !hasBounced(search)) {
    // `typedRoutes` checks redirect() against the static route map. This URL is
    // assembled at runtime from the live query string, so it can only ever be a
    // plain string - the route itself is the BOUNCE_PATH literal in bounce.ts.
    redirect(buildBounceUrl(pathname, search) as Route);
  }

  return shopDomain;
}
