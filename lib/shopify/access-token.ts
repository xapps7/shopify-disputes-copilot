import { db } from "@/lib/db";
import { encryptString } from "@/lib/crypto";
import {
  exchangeSessionTokenForAccessToken,
  isTokenExchangeFailure
} from "@/lib/shopify/token-exchange";

/**
 * Provisions and refreshes a merchant's Shopify access token.
 *
 * Order of preference:
 *   1. A stored token that has not expired.
 *   2. Token exchange, using the verified session token from this request.
 *      This is what makes Shopify-managed installation work and is what
 *      satisfies the expiring-offline-token requirement.
 *   3. Whatever the legacy OAuth flow stored (kept as a fallback so installs
 *      that predate token exchange keep working).
 */

const EXPIRY_SKEW_MS = 60_000;

function isUsable(token: string | null, expiresAt: Date | null) {
  if (!token) {
    return false;
  }
  return !expiresAt || expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();
}

export async function ensureMerchantAccessToken(options: {
  shopDomain: string;
  sessionToken?: string | null;
}): Promise<{ merchantId: string; hasToken: boolean }> {
  const { shopDomain, sessionToken } = options;

  const existing = await db.merchant.findUnique({
    where: { shopDomain },
    select: { id: true, accessTokenEncrypted: true, accessTokenExpiresAt: true }
  });

  if (existing && isUsable(existing.accessTokenEncrypted, existing.accessTokenExpiresAt)) {
    return { merchantId: existing.id, hasToken: true };
  }

  if (!sessionToken) {
    // Nothing to exchange with. Fall back to whatever is stored, if anything.
    return { merchantId: existing?.id ?? "", hasToken: Boolean(existing?.accessTokenEncrypted) };
  }

  const result = await exchangeSessionTokenForAccessToken({ shopDomain, sessionToken });

  if (isTokenExchangeFailure(result)) {
    console.error(`[token-exchange] ${shopDomain}: ${result.error}`);
    // A failed exchange must not destroy a working legacy token.
    return { merchantId: existing?.id ?? "", hasToken: Boolean(existing?.accessTokenEncrypted) };
  }

  const merchant = await db.merchant.upsert({
    where: { shopDomain },
    update: {
      accessTokenEncrypted: encryptString(result.accessToken),
      accessTokenExpiresAt: result.expiresAt,
      uninstalledAt: null
    },
    create: {
      shopDomain,
      accessTokenEncrypted: encryptString(result.accessToken),
      accessTokenExpiresAt: result.expiresAt
    },
    select: { id: true }
  });

  return { merchantId: merchant.id, hasToken: true };
}
