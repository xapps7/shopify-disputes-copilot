import crypto from "node:crypto";

/**
 * Pure HMAC helpers for Shopify webhook verification.
 *
 * These live in `lib/compliance` (rather than inline in `lib/shopify/webhooks.ts`)
 * so they can be unit tested without pulling in `@/lib/shopify/config` -> `@/lib/env`
 * -> Next.js path aliases. `tests/webhooks.test.ts` imports this file relatively and
 * runs it under `node --experimental-strip-types`.
 */

export function computeWebhookHmac(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

/**
 * Constant-time comparison of the computed digest against the header value.
 *
 * The explicit length check is required: `crypto.timingSafeEqual` THROWS on
 * mismatched buffer lengths, so a truncated/oversized `X-Shopify-Hmac-Sha256`
 * header would otherwise crash the route (a 500) instead of returning 401.
 */
export function isValidWebhookHmac(
  body: string,
  hmacHeader: string | null | undefined,
  secret: string
): boolean {
  if (!hmacHeader) {
    return false;
  }

  // An empty secret makes this HMAC-SHA256(body, "") - a signature any caller
  // can compute. `resolveWebhookSecret` returns "" when neither secret is
  // configured, so without this check a misconfigured deploy would accept
  // forged compliance webhooks, including shop/redact.
  if (!secret) {
    return false;
  }

  const digestBuffer = Buffer.from(computeWebhookHmac(body, secret));
  const headerBuffer = Buffer.from(hmacHeader);

  return (
    digestBuffer.length === headerBuffer.length &&
    crypto.timingSafeEqual(digestBuffer, headerBuffer)
  );
}
