import { createAdminApiClient } from "@shopify/admin-api-client";

import { isUnauthorizedResponse } from "@/lib/shopify/errors";
import { invalidateStoredAccessToken } from "@/lib/shopify/token-invalidation";

type ShopifyGraphQLClientOptions = {
  storeDomain: string;
  accessToken: string;
  /**
   * Set false for a call that must not touch stored credentials - the token
   * exchange's own verification, for instance, where a 401 means the exchange
   * failed rather than that the saved token is stale.
   */
  invalidateOnUnauthorized?: boolean;
};

/**
 * The Admin API client, with one behaviour added: a 401 throws the stored token
 * away.
 *
 * Every Admin call in this app went through this factory and none of them cared
 * about HTTP 401. The stored token was only ever checked for expiry, and a
 * legacy non-expiring token has no expiry, so a token Shopify had revoked was
 * reused on every request forever. The symptom was every query on every page
 * failing with `(HTTP_401) GraphQL Client: Unauthorized` and no way out but a
 * manual reinstall.
 *
 * Handling it here rather than at each call site is deliberate: there are more
 * than a dozen call sites, they all inspect errors differently, and the next one
 * somebody adds would have missed it too.
 *
 * The invalidation is fire-and-forget. The caller's job is to report the failure
 * it already got; recovery happens on the next page load, when
 * `ensureMerchantAccessToken` finds nothing usable and exchanges a fresh token
 * against that request's session token.
 */
export function createShopifyAdminClient(options: ShopifyGraphQLClientOptions) {
  const client = createAdminApiClient({
    storeDomain: options.storeDomain,
    // 2025-10 sunsets on 16 Oct 2026; this matches the webhook api_version
    // declared in shopify.app.toml.
    apiVersion: "2026-01",
    accessToken: options.accessToken
  });

  if (options.invalidateOnUnauthorized === false) {
    return client;
  }

  return {
    ...client,
    request: (async (...args: Parameters<typeof client.request>) => {
      const response = await client.request(...args);

      if (isUnauthorizedResponse(response)) {
        void invalidateStoredAccessToken(options.storeDomain);
      }

      return response;
    }) as typeof client.request
  };
}
