import crypto from "node:crypto";

/**
 * Gate for diagnostic endpoints.
 *
 * `/api/debug/disputes` and the detailed half of `/api/health` were reachable by
 * anyone on the internet with only a `?shop=` value, and returned merchant ids,
 * granted scopes, order totals, dispute ids and (where scoped) customer PII.
 * Worse, each debug call spent the merchant's Shopify access token on ~15 Admin
 * API requests, so it doubled as a rate-limit amplifier against their store.
 *
 * Set DIAGNOSTICS_SECRET and pass it as `?token=` or `x-diagnostics-token`.
 * With no secret configured, diagnostics are available in development only.
 */
export function isDiagnosticsAuthorized(request: Request): boolean {
  const configured = process.env.DIAGNOSTICS_SECRET?.trim();

  if (!configured) {
    return process.env.NODE_ENV !== "production";
  }

  const url = new URL(request.url);
  const supplied = request.headers.get("x-diagnostics-token") ?? url.searchParams.get("token") ?? "";

  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
