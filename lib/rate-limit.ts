/**
 * Minimal in-process rate limiter.
 *
 * `POST /api/sync/disputes` was unauthenticated, retried three times, and drove
 * a long sequence of Shopify Admin API calls — so a simple loop could exhaust a
 * merchant's Shopify rate limit and break their other apps. Authentication is
 * the real fix; this bounds the damage per shop regardless.
 *
 * In-process state is enough for a single App Runner instance. If you scale
 * out, move this to Redis or rely on the SyncRun-in-progress check.
 */

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export function consumeRateLimit(
  key: string,
  { capacity, refillPerSecond, now = Date.now() }: { capacity: number; refillPerSecond: number; now?: number }
): RateLimitResult {
  const existing = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  const elapsedSeconds = Math.max(0, (now - existing.updatedAt) / 1000);
  const tokens = Math.min(capacity, existing.tokens + elapsedSeconds * refillPerSecond);

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { allowed: false, retryAfterSeconds: Math.ceil((1 - tokens) / refillPerSecond) };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
