/**
 * Pure replay / staleness decision logic for Shopify webhook deliveries.
 *
 * The HMAC only covers the request BODY. `X-Shopify-Shop-Domain` (which selects
 * the tenant) and every other header are unauthenticated, so a captured request
 * can be replayed verbatim forever. Two mitigations live here:
 *
 *   1. `X-Shopify-Webhook-Id` is unique per delivery attempt group -> dedupe it.
 *   2. `X-Shopify-Triggered-At` bounds how long a captured body stays useful.
 *
 * No imports: this module must stay runnable under `node --experimental-strip-types`
 * without Prisma or Next.js.
 */

export const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

export type FreshnessReason = "ok" | "stale" | "missing" | "unparseable";

export type WebhookFreshness = {
  fresh: boolean;
  reason: FreshnessReason;
  ageMs: number | null;
};

/**
 * Evaluate `X-Shopify-Triggered-At`.
 *
 * A missing or unparseable header is treated as FRESH on purpose: Shopify's
 * automated app-submission checks and some manual "send test webhook" paths do
 * not always set it, and hard-failing there would auto-reject the app. Only a
 * timestamp we can actually read AND that is demonstrably older than the window
 * is rejected. Future timestamps are accepted (clock skew between our host and
 * Shopify is not the merchant's problem).
 */
export function evaluateWebhookFreshness(
  triggeredAt: string | null | undefined,
  now: number = Date.now(),
  maxAgeMs: number = WEBHOOK_MAX_AGE_MS
): WebhookFreshness {
  if (!triggeredAt) {
    return { fresh: true, reason: "missing", ageMs: null };
  }

  const triggeredAtMs = Date.parse(triggeredAt);

  if (Number.isNaN(triggeredAtMs)) {
    return { fresh: true, reason: "unparseable", ageMs: null };
  }

  const ageMs = now - triggeredAtMs;

  if (ageMs > maxAgeMs) {
    return { fresh: false, reason: "stale", ageMs };
  }

  return { fresh: true, reason: "ok", ageMs };
}

export type DeliveryDecisionInput = {
  alreadySeen: boolean;
  triggeredAt: string | null | undefined;
  now?: number;
  maxAgeMs?: number;
};

export type DeliveryDecision = {
  /** Whether the route should run its side effects. */
  process: boolean;
  reason: "ok" | "duplicate" | "stale";
  ageMs: number | null;
};

/**
 * Combine dedupe + staleness into the single decision a route needs.
 *
 * Both rejection paths are "acknowledge but do nothing". Shopify retries any
 * non-2xx for 48 hours, and a duplicate/stale delivery is not something a retry
 * can fix, so callers should still answer 200.
 */
export function decideWebhookDelivery(input: DeliveryDecisionInput): DeliveryDecision {
  const freshness = evaluateWebhookFreshness(input.triggeredAt, input.now, input.maxAgeMs);

  if (!freshness.fresh) {
    return { process: false, reason: "stale", ageMs: freshness.ageMs };
  }

  if (input.alreadySeen) {
    return { process: false, reason: "duplicate", ageMs: freshness.ageMs };
  }

  return { process: true, reason: "ok", ageMs: freshness.ageMs };
}
