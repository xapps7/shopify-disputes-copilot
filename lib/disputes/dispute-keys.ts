/**
 * What a dispute's primary key looks like. One module, no dependencies.
 *
 * This is deliberately import-free. Everything that decides the shape of a
 * dispute key lives here so it can be imported by the writers AND by the tests,
 * which run under `node --experimental-strip-types` with no path-alias
 * resolution. `toDisputeGid` used to live in `shopify-sync.ts` beside a database
 * import, so the test could not reach it and kept a hand-written copy instead -
 * a second definition of the rule, free to drift from the first, inside the one
 * piece of code whose entire purpose is that the rule has a single home.
 */

/**
 * Shopify returns the SAME dispute under two GID types: the top-level `disputes`
 * connection gives `gid://shopify/ShopifyPaymentsDispute/<n>`, while
 * `Order.disputes` gives `gid://shopify/OrderDisputeSummary/<n>`. Keying on the
 * raw value stored every dispute twice - observed live as 5 real disputes
 * reported as syncedCount 8 - and `dispute(id: <OrderDisputeSummary gid>)` fails
 * with RESOURCE_NOT_FOUND. Normalise both to the ShopifyPaymentsDispute form.
 *
 * Idempotent, so it is safe to apply unconditionally at every write.
 */
export function toDisputeGid(id: string): string {
  const numericId = id.split("/").pop();
  return numericId ? `gid://shopify/ShopifyPaymentsDispute/${numericId}` : id;
}

/**
 * The two key shapes no current code path can produce, left behind by earlier
 * versions.
 *
 * Deliberately narrow: it matches the two known-bad GID types rather than
 * anything that "looks wrong", so a shape Shopify introduces later is left alone
 * instead of being deleted by a rule written before it existed.
 */
export function isLegacyDisputeKey(shopifyDisputeId: string): boolean {
  return shopifyDisputeId.includes("/OrderDisputeSummary/") || shopifyDisputeId.endsWith("/unknown");
}
