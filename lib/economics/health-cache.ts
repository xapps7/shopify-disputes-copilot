import { getAccountHealth, type AccountHealth } from "@/lib/economics/account-health";

/**
 * Account health, cached, so it can lead the home screen.
 *
 * The tension: account health is the most valuable thing this app computes, and
 * it is also the slowest. It needs order counts, which only Shopify can answer,
 * so putting it on Today unwrapped would make the home screen wait on a network
 * call that can fail - and Today's whole job is to be the fast answer to "what
 * needs me".
 *
 * So it is computed away from the request path and read from memory:
 *
 *   - the hourly sweep warms it, because that job already holds a Shopify client
 *     and already runs on the schedule this data changes on;
 *   - the dispute webhooks clear it, so a chargeback landing at 3am makes the
 *     next page load recompute rather than show a stale ratio;
 *   - anything else reads whatever is there, or nothing.
 *
 * In-process rather than in the database on purpose. It avoids a migration, and
 * the cost of being wrong is small: a cold container recomputes once, and two
 * App Runner instances each keep their own copy, which at worst means two
 * Shopify calls an hour instead of one. Ratios move slowly enough that neither
 * matters.
 *
 * What this must never do is BLOCK. A page that cannot get health shows the
 * parts it has; it does not spin.
 */

const TTL_MS = 60 * 60 * 1000;

type Entry = { value: AccountHealth | null; storedAt: number };

const cache = new Map<string, Entry>();

/** Cheap enough to run on every read; the map only ever holds one row per shop. */
function evictExpired(now: number) {
  for (const [shop, entry] of cache) {
    if (now - entry.storedAt > TTL_MS) {
      cache.delete(shop);
    }
  }
}

/**
 * Whatever is cached, without computing anything.
 *
 * Returns null on a miss rather than fetching, because the callers that use this
 * are rendering a page and would rather show less than wait. Use
 * `refreshAccountHealth` from a background job to fill it.
 */
export function peekAccountHealth(shopDomain: string | null | undefined): AccountHealth | null {
  if (!shopDomain) {
    return null;
  }

  const now = Date.now();
  evictExpired(now);

  return cache.get(shopDomain)?.value ?? null;
}

/** Computes and stores. Safe to call from a cron; never throws. */
export async function refreshAccountHealth(shopDomain: string): Promise<AccountHealth | null> {
  try {
    const value = await getAccountHealth(shopDomain);
    cache.set(shopDomain, { value, storedAt: Date.now() });
    return value;
  } catch (error) {
    console.error(`[account-health] refresh failed for ${shopDomain}`, error);
    // A failed refresh must not destroy a good cached value - a slightly stale
    // ratio beats a blank panel on the screen a merchant checks for reassurance.
    return cache.get(shopDomain)?.value ?? null;
  }
}

/**
 * Cached value if fresh, otherwise compute.
 *
 * For the Account health page itself, where the merchant has explicitly asked
 * for this number and waiting is the right trade.
 */
export async function getCachedAccountHealth(shopDomain: string | null | undefined): Promise<AccountHealth | null> {
  if (!shopDomain) {
    return null;
  }

  const cached = peekAccountHealth(shopDomain);
  if (cached) {
    return cached;
  }

  return refreshAccountHealth(shopDomain);
}

/**
 * Drops the cached value for a shop.
 *
 * Called from the dispute webhooks: a new chargeback changes the numerator, and
 * a merchant who opens the app after getting our own alert email should not be
 * shown a ratio computed before the dispute that triggered it.
 */
export function invalidateAccountHealth(shopDomain: string | null | undefined) {
  if (shopDomain) {
    cache.delete(shopDomain);
  }
}

/** Test seam. */
export function clearAccountHealthCache() {
  cache.clear();
}
