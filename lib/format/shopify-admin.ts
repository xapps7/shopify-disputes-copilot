/**
 * Formats links into Shopify Admin.
 *
 * The app cannot submit dispute evidence to Shopify (there is no
 * `disputeEvidenceUpdate` / `disputeEvidenceSubmit` call anywhere in this
 * codebase), so every submission surface has to send the merchant to the real
 * place they can respond.
 *
 * IMPORTANT: Shopify Admin has NO per-dispute page. There is no
 * `/payments/disputes/<id>` route - linking there returns "page not found".
 * Chargebacks are surfaced on the ORDER: the order page shows a chargeback
 * banner with an "Add evidence" button that opens the Chargeback response form.
 * That is where merchants are sent by Shopify's own documentation, so that is
 * where we link.
 *
 * https://help.shopify.com/en/manual/payments/chargebacks/chargebacks-in-admin
 *
 * These helpers are pure string formatting: they do not read or resolve the
 * session, and must not start doing so.
 */

/** `some-store.myshopify.com` -> `some-store`. */
export function storeHandleFromShopDomain(shopDomain: string | null | undefined): string | null {
  if (!shopDomain) {
    return null;
  }

  const handle = shopDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(".")[0];

  return handle || null;
}

/**
 * `gid://shopify/Order/7563412209845` -> `7563412209845`.
 *
 * The numeric suffix of a GID equals the object's `legacyResourceId`, which is
 * what admin URLs consume. Prefer selecting `legacyResourceId` explicitly where
 * a query is being written; this exists for ids already stored as GIDs.
 */
export function numericIdFromGid(gid: string | null | undefined): string | null {
  if (!gid) {
    return null;
  }

  const suffix = gid.trim().split("/").pop() ?? "";

  return /^\d+$/.test(suffix) ? suffix : null;
}

/** Kept for callers that still hold a dispute GID; same extraction. */
export function numericDisputeId(shopifyDisputeId: string | null | undefined): string | null {
  return numericIdFromGid(shopifyDisputeId);
}

/**
 * `https://admin.shopify.com/store/<handle>/orders/<orderId>`
 *
 * The order page carries the chargeback banner and the "Add evidence" action.
 * Returns `null` when either half is unknown so callers render honest guidance
 * instead of a broken link.
 */
export function shopifyAdminOrderUrl(
  shopDomain: string | null | undefined,
  shopifyOrderId: string | null | undefined
): string | null {
  const handle = storeHandleFromShopDomain(shopDomain);
  const orderId = numericIdFromGid(shopifyOrderId);

  if (!handle || !orderId) {
    return null;
  }

  return `https://admin.shopify.com/store/${handle}/orders/${orderId}`;
}

/**
 * Fallback when the order is unknown: the orders list, which the merchant can
 * filter by "Chargeback and inquiry status". There is no disputes-only screen.
 */
export function shopifyAdminOrdersUrl(shopDomain: string | null | undefined): string | null {
  const handle = storeHandleFromShopDomain(shopDomain);

  return handle ? `https://admin.shopify.com/store/${handle}/orders` : null;
}
