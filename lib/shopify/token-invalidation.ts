/**
 * Throwing away a token Shopify has rejected.
 *
 * THE BUG THIS FIXES: nothing in the app ever reacted to an HTTP 401. The
 * stored token was checked only for expiry, and a legacy non-expiring token has
 * no expiry at all, so `isUsable` returned true forever. Once Shopify stopped
 * accepting the token - a reinstall revokes the previous one, and a changed
 * `ENCRYPTION_KEY` makes it decrypt to rubbish - every single Admin API call
 * returned 401, the app reported it as an ordinary sync warning, and the next
 * request cheerfully reused the same dead token. There was no path back except
 * uninstalling and reinstalling by hand.
 *
 * Clearing the row is what makes it self-healing. `ensureMerchantAccessToken`
 * runs on every embedded page load, finds no usable token, and does a fresh
 * token exchange against the session token that request already carries. So the
 * merchant's recovery action is "open the app again", which is what they were
 * going to do anyway.
 *
 * THE REFRESH TOKEN GOES TOO. It is tempting to keep it - refreshing needs no
 * session token, so it would fix background sweeps as well. But the most common
 * cause of a 401 is a reinstall, which invalidates the whole grant, refresh
 * token included. Keeping a dead refresh token means every recovery attempt
 * burns a round trip failing before it gets to the exchange that would have
 * worked. Better to be honest that the grant is gone.
 *
 * This module deliberately imports nothing but the database, so the Shopify
 * client can call it without creating an import cycle through the token
 * exchange code.
 */

import { db } from "@/lib/db";

/**
 * Called at most once per shop per process while a 401 storm is in flight.
 *
 * A single page load fans out into a dozen Admin API calls. When the token is
 * dead they all fail, and without this guard each one would fire its own
 * database write - a dozen redundant updates, and a dozen log lines saying the
 * same thing. The set is per-process and never cleared: once a shop has been
 * invalidated in this process there is nothing left to invalidate, and the next
 * successful exchange writes a fresh token anyway.
 */
const invalidated = new Set<string>();

export async function invalidateStoredAccessToken(shopDomain: string): Promise<void> {
  if (!shopDomain || invalidated.has(shopDomain)) {
    return;
  }

  invalidated.add(shopDomain);

  try {
    // `updateMany` rather than `update`: a shop we have never stored is not an
    // error worth throwing over, and this runs inside a fire-and-forget path
    // where an exception would surface as an unhandled rejection.
    const result = await db.merchant.updateMany({
      where: { shopDomain },
      data: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        refreshTokenEncrypted: null,
        refreshTokenExpiresAt: null
      }
    });

    if (result.count > 0) {
      console.warn(
        `[token] Shopify returned 401 for ${shopDomain}; stored credentials cleared. ` +
          "The next embedded page load will exchange a fresh token."
      );
    }
  } catch (error) {
    // Losing the ability to self-heal is bad; crashing the request that
    // discovered the problem is worse.
    console.error(`[token] could not clear rejected credentials for ${shopDomain}`, error);
  }
}

/** Test seam, and a way for a deliberate re-check to bypass the once-per-process guard. */
export function resetInvalidationGuard(shopDomain?: string): void {
  if (shopDomain) {
    invalidated.delete(shopDomain);
    return;
  }
  invalidated.clear();
}
