/**
 * How an order is named in the UI when Shopify has not given us its name.
 *
 * `DashboardDispute.orderName` ("#1024") is nullable: a freshly-synced dispute
 * often carries only `shopifyOrderId`, a GID like
 * `gid://shopify/Order/7575513399477`. Falling back to that id printed a raw
 * 13-digit number in the queue — "Order 7575513399477" — which is not a thing
 * any merchant recognises, cannot be searched for in Admin, and reads as a bug.
 *
 * The last four digits are the only part of the id a human can hold in their
 * head long enough to match it against an Admin tab, so that is what is shown,
 * labelled as a partial: "Order ending 9477". `orderReferenceNote` gives the
 * one line that explains why the real name is missing, for surfaces that have
 * room for it.
 */

/** `gid://shopify/Order/7575513399477` -> `7575513399477`; null when not numeric. */
function orderDigits(shopifyOrderId: string | null | undefined): string | null {
  const suffix = shopifyOrderId?.trim().split("/").pop() ?? "";

  return /^\d+$/.test(suffix) ? suffix : null;
}

/**
 * The label to render. Never returns a bare id: either the merchant's own order
 * name, a masked reference, or an honest "unavailable".
 */
export function orderReference(
  orderName: string | null | undefined,
  shopifyOrderId: string | null | undefined
): string {
  const name = orderName?.trim();
  if (name) {
    return name;
  }

  const digits = orderDigits(shopifyOrderId);
  if (!digits) {
    return "Order unavailable";
  }

  return `Order ending ${digits.length > 4 ? digits.slice(-4) : digits}`;
}

/** True when the label above is a fallback rather than the real order name. */
export function isOrderReferenceMasked(orderName: string | null | undefined): boolean {
  return !orderName?.trim();
}

/** One line naming why the order name is missing, or null when it is not. */
export function orderReferenceNote(
  orderName: string | null | undefined,
  shopifyOrderId: string | null | undefined
): string | null {
  if (!isOrderReferenceMasked(orderName)) {
    return null;
  }

  return orderDigits(shopifyOrderId)
    ? "Order name has not synced yet, so the last four digits of the order id are shown."
    : "No order is linked to this dispute yet.";
}
