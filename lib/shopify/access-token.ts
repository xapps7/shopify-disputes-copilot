import { db } from "@/lib/db";
import { decryptString, encryptString } from "@/lib/crypto";
import {
  exchangeSessionTokenForAccessToken,
  isTokenExchangeFailure,
  migrateToExpiringToken,
  refreshAccessToken,
  type TokenExchangeResult
} from "@/lib/shopify/token-exchange";
import type { TokenFailureReason } from "@/lib/shopify/bounce-decision";

/**
 * The access token lifecycle.
 *
 * Shopify requires EXPIRING offline tokens for new public apps since
 * 1 Apr 2026, and for every public app from 1 Jan 2027 - after which calls
 * made with a non-expiring token start returning authentication errors.
 *
 * Expiring tokens last one hour; the refresh token lasts 90 days and is
 * SINGLE USE - Shopify rotates it on every refresh. Failing to persist the new
 * one orphans the install, and once the refresh token lapses it cannot be
 * recovered from storage: a fresh session token is only issued when the
 * merchant next opens the embedded app. So refresh proactively, not lazily.
 *
 * Order of preference:
 *   1. A stored token that has not expired.
 *   2. Refresh, when we hold a live refresh token.
 *   3. Token exchange, using the verified session token from this request.
 *   4. One-shot migration of a legacy non-expiring token.
 */

const EXPIRY_SKEW_MS = 60_000;

function isUsable(token: string | null, expiresAt: Date | null) {
  if (!token) {
    return false;
  }
  return !expiresAt || expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();
}

async function persist(shopDomain: string, result: TokenExchangeResult) {
  const payload = {
    accessTokenEncrypted: encryptString(result.accessToken),
    accessTokenExpiresAt: result.expiresAt,
    // Written in the same statement as the access token: a rotation that
    // stores one without the other loses the install.
    refreshTokenEncrypted: result.refreshToken ? encryptString(result.refreshToken) : undefined,
    refreshTokenExpiresAt: result.refreshTokenExpiresAt ?? undefined,
    uninstalledAt: null
  };

  const merchant = await db.merchant.upsert({
    where: { shopDomain },
    update: payload,
    create: { shopDomain, ...payload },
    select: { id: true }
  });

  return merchant.id;
}

/**
 * What this shop's credentials look like right now.
 *
 * `hasToken` alone is not enough for the caller to act on. "We never got a
 * session token to exchange" is fixable by bouncing the browser; "Shopify
 * rejected our credentials" is not, and retrying it only hides the cause. So
 * the failure travels with the result instead of dying in a log line.
 */
export type MerchantTokenState = {
  /** Empty string when no merchant row exists yet - a brand-new install. */
  merchantId: string;
  /** True only for a token that is present AND not within the expiry skew. */
  hasToken: boolean;
  /** Would a fresh session token plausibly change the outcome? */
  retryable: boolean;
  reason: TokenFailureReason;
};

export async function ensureMerchantAccessToken(options: {
  shopDomain: string;
  sessionToken?: string | null;
}): Promise<MerchantTokenState> {
  const { shopDomain, sessionToken } = options;

  const existing = await db.merchant.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      accessTokenEncrypted: true,
      accessTokenExpiresAt: true,
      refreshTokenEncrypted: true,
      refreshTokenExpiresAt: true
    }
  });

  if (existing && isUsable(existing.accessTokenEncrypted, existing.accessTokenExpiresAt)) {
    // A legacy non-expiring token still works today, but will stop in 2027.
    // Upgrade it opportunistically while it is still valid.
    if (!existing.accessTokenExpiresAt && existing.accessTokenEncrypted) {
      const migrated = await migrateToExpiringToken({
        shopDomain,
        nonExpiringAccessToken: decryptString(existing.accessTokenEncrypted)
      });

      if (!isTokenExchangeFailure(migrated)) {
        await persist(shopDomain, migrated);
        return { merchantId: existing.id, hasToken: true, retryable: false, reason: "none" };
      }

      // Migration is irreversible only on SUCCESS - a failure leaves the old
      // token intact, so carrying on with it is safe.
      console.warn(`[token] migration to an expiring token failed for ${shopDomain}: ${migrated.error}`);
    }

    return { merchantId: existing.id, hasToken: true, retryable: false, reason: "none" };
  }

  let refreshFailed = false;

  // Expired, but we hold a refresh token: rotate rather than asking for a
  // session token we may not have (background sweeps have no request context).
  if (existing?.refreshTokenEncrypted && isUsable(existing.refreshTokenEncrypted, existing.refreshTokenExpiresAt)) {
    const refreshed = await refreshAccessToken({
      shopDomain,
      refreshToken: decryptString(existing.refreshTokenEncrypted)
    });

    if (!isTokenExchangeFailure(refreshed)) {
      const merchantId = await persist(shopDomain, refreshed);
      return { merchantId, hasToken: true, retryable: false, reason: "none" };
    }

    console.error(`[token] refresh failed for ${shopDomain}: ${refreshed.error}`);
    refreshFailed = true;
  }

  // Everything below here is reached only because `isUsable` said no. Reporting
  // `hasToken` from the mere PRESENCE of a stored token therefore claims an
  // expired token is fine, which suppresses the bounce that would replace it -
  // and then every Admin API call 401s with nothing explaining why. Ask
  // `isUsable` again so an expired token honestly reports as no token.
  const storedTokenUsable = isUsable(
    existing?.accessTokenEncrypted ?? null,
    existing?.accessTokenExpiresAt ?? null
  );

  if (!sessionToken) {
    return {
      merchantId: existing?.id ?? "",
      hasToken: storedTokenUsable,
      // No session token in hand is the one failure a bounce definitely fixes:
      // App Bridge mints a fresh one and the reload can exchange it.
      retryable: !storedTokenUsable,
      reason: storedTokenUsable ? "none" : refreshFailed ? "refresh-failed" : "no-session-token"
    };
  }

  const exchanged = await exchangeSessionTokenForAccessToken({ shopDomain, sessionToken });

  if (isTokenExchangeFailure(exchanged)) {
    console.error(`[token-exchange] ${shopDomain}: ${exchanged.error}`);
    // A failed exchange must never destroy a working token.
    //
    // The retryable flag has to survive this return. A session token is valid
    // for about 60 seconds, and on a cold render it can easily be most of the
    // way through that by the time the exchange fires - Shopify answers 400
    // `invalid_subject_token`. That is a timing accident a single fresh token
    // fixes. Dropping the flag here is what left brand-new stores staring at an
    // empty dashboard: `persist` is the only thing that creates the merchant
    // row, so a failed exchange means no row, no data, and no explanation.
    return {
      merchantId: existing?.id ?? "",
      hasToken: storedTokenUsable,
      retryable: !storedTokenUsable && exchanged.retryable,
      reason: storedTokenUsable ? "none" : "exchange-failed"
    };
  }

  const merchantId = await persist(shopDomain, exchanged);
  return { merchantId, hasToken: true, retryable: false, reason: "none" };
}
