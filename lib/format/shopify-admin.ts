/**
 * Formats links into Shopify Admin.
 *
 * The app cannot submit dispute evidence to Shopify (there is no
 * `disputeEvidenceUpdate` / `disputeEvidenceSubmit` call anywhere in this
 * codebase), so every submission surface has to send the merchant to the real
 * dispute page in Shopify Admin. These helpers are pure string formatting: they
 * do not read or resolve the session, and must not start doing so.
 */

/** `some-store.myshopify.com` -> `some-store`. */
export function storeHandleFromShopDomain(shopDomain: string | null | undefined): string | null {
  if (!shopDomain) {
    return null;
  }

  const handle = shopDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(".")[0];

  return handle || null;
}

/** `gid://shopify/ShopifyPaymentsDispute/11450876085` -> `11450876085`. */
export function numericDisputeId(shopifyDisputeId: string | null | undefined): string | null {
  if (!shopifyDisputeId) {
    return null;
  }

  const suffix = shopifyDisputeId.trim().split("/").pop() ?? "";

  return /^\d+$/.test(suffix) ? suffix : null;
}

/**
 * `https://admin.shopify.com/store/<handle>/payments/disputes/<id>`
 *
 * Returns `null` when either half is unknown so callers render honest guidance
 * instead of a broken link.
 */
export function shopifyAdminDisputeUrl(
  shopDomain: string | null | undefined,
  shopifyDisputeId: string | null | undefined
): string | null {
  const handle = storeHandleFromShopDomain(shopDomain);
  const disputeId = numericDisputeId(shopifyDisputeId);

  if (!handle || !disputeId) {
    return null;
  }

  return `https://admin.shopify.com/store/${handle}/payments/disputes/${disputeId}`;
}

/** The disputes list, used when a specific dispute id is not resolvable. */
export function shopifyAdminDisputesUrl(shopDomain: string | null | undefined): string | null {
  const handle = storeHandleFromShopDomain(shopDomain);

  return handle ? `https://admin.shopify.com/store/${handle}/payments/disputes` : null;
}
