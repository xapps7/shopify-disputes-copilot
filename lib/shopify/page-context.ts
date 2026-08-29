import type { Route } from "next";
import { redirect } from "next/navigation";

import { ensureMerchantAccessToken } from "@/lib/shopify/access-token";
import { buildBounceUrl, hasBounced, toUrlSearchParams } from "@/lib/shopify/bounce";
import { shouldBounceForToken, type TokenFailureReason } from "@/lib/shopify/bounce-decision";
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
 * What a page has to work with.
 *
 * Three outcomes, and a page needs to tell them apart. "We do not know who you
 * are" and "we know who you are but cannot reach your store" produce the same
 * empty screen if they collapse into one null, and that is precisely the screen
 * a merchant cannot act on: no error, no retry, nothing to tell support.
 */
export type EmbeddedPageContext =
  /** No verified identity at all. The signed-out state is the honest answer. */
  | { status: "no-shop"; shopDomain: null; reason: TokenFailureReason }
  /** Identity and a usable Admin API token. Render normally. */
  | { status: "ready"; shopDomain: string; reason: "none" }
  /**
   * We know the shop but hold no usable token, and we have run out of ways to
   * fix it automatically. The page should say so out loud.
   */
  | { status: "no-token"; shopDomain: string; reason: TokenFailureReason };

/**
 * Resolves identity, makes sure an Admin API token exists, and recovers when it
 * does not.
 *
 * `pathname` is the route's own path, used to build the reload target if this
 * request needs to go and fetch a session token.
 */
export async function getEmbeddedPageContext(
  searchParams: PageSearchParams | undefined,
  pathname: string
): Promise<EmbeddedPageContext> {
  const params = searchParams ?? {};
  const shopDomain = await getAuthenticatedShopDomainForPage(params);

  if (!shopDomain) {
    return { status: "no-shop", shopDomain: null, reason: "no-session-token" };
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

  const { hasToken, retryable, reason } = await ensureMerchantAccessToken({ shopDomain, sessionToken });

  if (hasToken) {
    return { status: "ready", shopDomain, reason: "none" };
  }

  const search = toUrlSearchParams(params);

  // We know who this is but hold no usable Admin API token.
  //
  // This used to refuse to bounce whenever a session token was present, on the
  // theory that the exchange had already failed and would fail again. That is
  // wrong for the most common failure by far: session tokens live about 60
  // seconds, so one that was fine when the request started can be stale by the
  // time the exchange fires, and Shopify answers 400 `invalid_subject_token`.
  // On a brand-new store nothing has created the merchant row yet, so the
  // result was an empty dashboard with no banner and no retry - the first
  // screen a Shopify reviewer sees. A retryable failure now earns the bounce,
  // and `dc_bounced` still caps it at exactly one, so there is no loop.
  if (shouldBounceForToken({ hasToken, retryable, alreadyBounced: hasBounced(search) })) {
    // `typedRoutes` checks redirect() against the static route map. This URL is
    // assembled at runtime from the live query string, so it can only ever be a
    // plain string - the route itself is the BOUNCE_PATH literal in bounce.ts.
    redirect(buildBounceUrl(pathname, search) as Route);
  }

  // Out of automatic options: either the failure is not the kind a fresh token
  // fixes, or we already spent our one retry. Hand the shop back WITH the
  // reason so the page can say something true instead of rendering blank.
  return { status: "no-token", shopDomain, reason };
}

/**
 * Returns the shop for this page, or null when the request carries no verified
 * identity at all - in which case the page renders its signed-out state and the
 * middleware has already tried a bounce.
 *
 * Kept as the narrow view for pages that only need to know "which shop". A page
 * that wants to distinguish "not signed in" from "signed in but disconnected"
 * should call `getEmbeddedPageContext` instead.
 */
export async function getEmbeddedPageShop(
  searchParams: PageSearchParams | undefined,
  pathname: string
): Promise<string | null> {
  const context = await getEmbeddedPageContext(searchParams, pathname);
  return context.shopDomain;
}
