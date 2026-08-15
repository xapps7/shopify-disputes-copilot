/**
 * Session-token bounce.
 *
 * Under Shopify-managed installation there is no OAuth callback to fall back
 * on. When a request reaches the app without a session token, the only way to
 * get one is to load App Bridge in the browser and let it re-issue the request.
 * That round trip is the "bounce page".
 *
 * Kept pure and dependency-free so the edge runtime (middleware) and server
 * components can share it.
 */

export const BOUNCE_PATH = "/session-token-bounce";

/**
 * Marks a request that has already been through the bounce once.
 *
 * Without this, an app that can never obtain a token bounces forever. Inside
 * the admin iframe that is invisible to the merchant and unrecoverable - the
 * screen simply never paints. One retry, then fail honestly.
 */
export const BOUNCE_MARKER = "dc_bounced";

export function hasBounced(params: URLSearchParams): boolean {
  return params.get(BOUNCE_MARKER) === "1";
}

/**
 * Only ever reload a path inside this app.
 *
 * `//evil.example` is a protocol-relative URL: it starts with "/" but navigates
 * off-origin, so the leading-slash test alone is not enough.
 */
export function isSafeReloadTarget(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

/**
 * Builds the redirect that hands control to App Bridge.
 *
 * The original query string is preserved (App Bridge wants `shop`/`host`),
 * minus `id_token` - the token that brought us here is stale or absent, so
 * reloading a URL that still carries it would just repeat the failure.
 */
export function buildBounceUrl(pathname: string, params: URLSearchParams): string {
  const carried = new URLSearchParams(params);
  carried.delete("id_token");
  carried.delete("shopify-reload");
  carried.set(BOUNCE_MARKER, "1");

  const reloadTarget = `${pathname}?${carried.toString()}`;
  carried.set("shopify-reload", reloadTarget);

  return `${BOUNCE_PATH}?${carried.toString()}`;
}

/** Server components receive `searchParams` as a plain object, not a URLSearchParams. */
export function toUrlSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === "string") {
      params.set(key, value);
    } else if (Array.isArray(value) && value.length > 0) {
      params.set(key, value[0]);
    }
  }

  return params;
}
