import { shopifyConfig } from "@/lib/shopify/config";
import {
  OFFLINE_TOKEN_TYPE,
  ONLINE_TOKEN_TYPE,
  buildRefreshTokenBody,
  buildTokenExchangeBody,
  buildTokenMigrationBody,
  parseTokenExchangeResponse,
  type TokenExchangeFailure,
  type TokenExchangeResult
} from "@/lib/shopify/token-exchange-core";

export {
  OFFLINE_TOKEN_TYPE,
  ONLINE_TOKEN_TYPE,
  buildRefreshTokenBody,
  buildTokenExchangeBody,
  buildTokenMigrationBody,
  parseTokenExchangeResponse
};
export type { TokenExchangeFailure, TokenExchangeResult };

/**
 * OAuth 2.0 token exchange (RFC 8693).
 *
 * Shopify requires all new public apps to use expiring offline access tokens.
 * The classic authorization-code flow this app shipped with mints a
 * non-expiring token and has no refresh path, which is a submission blocker.
 *
 * Token exchange swaps a short-lived App Bridge session token - which we have
 * already verified - for an access token, with no redirects and no consent
 * round trip. The legacy OAuth routes are kept as a fallback so an install that
 * predates this still works.
 */

export async function exchangeSessionTokenForAccessToken(options: {
  shopDomain: string;
  sessionToken: string;
  requestedTokenType?: string;
}): Promise<TokenExchangeResult | TokenExchangeFailure> {
  const { shopDomain, sessionToken, requestedTokenType } = options;

  if (!shopifyConfig.apiKey || !shopifyConfig.apiSecret) {
    return { ok: false, status: null, error: "Shopify API credentials are not configured.", retryable: false };
  }

  let response: Response;
  try {
    response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(
        buildTokenExchangeBody({
          sessionToken,
          clientId: shopifyConfig.apiKey,
          clientSecret: shopifyConfig.apiSecret,
          requestedTokenType
        })
      )
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "Token exchange request failed.",
      retryable: true
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status,
      error: text || `Token exchange failed with status ${response.status}.`,
      // 400 with invalid_subject_token means the session token is stale.
      retryable: response.status === 400 || response.status === 401
    };
  }

  const parsed = parseTokenExchangeResponse(await response.json().catch(() => null));

  return (
    parsed ?? {
      ok: false as const,
      status: response.status,
      error: "Token exchange returned no access token.",
      retryable: false
    }
  );
}

export function isTokenExchangeFailure(
  value: TokenExchangeResult | TokenExchangeFailure
): value is TokenExchangeFailure {
  return (value as TokenExchangeFailure).ok === false;
}

async function postTokenRequest(
  shopDomain: string,
  body: Record<string, unknown>
): Promise<TokenExchangeResult | TokenExchangeFailure> {
  let response: Response;

  try {
    response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "Token request failed.",
      retryable: true
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status,
      error: text || `Token request failed with status ${response.status}.`,
      // 401 is terminal - the grant is gone. 5xx and 429 are worth retrying,
      // and a refresh may safely be retried with the SAME refresh token for up
      // to an hour, which is what makes a mid-rotation timeout recoverable.
      retryable: response.status >= 500 || response.status === 429
    };
  }

  const parsed = parseTokenExchangeResponse(await response.json().catch(() => null));

  return (
    parsed ?? {
      ok: false as const,
      status: response.status,
      error: "Token request returned no access token.",
      retryable: false
    }
  );
}

/** Rotates an expiring offline token. The returned refresh token MUST be stored. */
export async function refreshAccessToken(options: {
  shopDomain: string;
  refreshToken: string;
}): Promise<TokenExchangeResult | TokenExchangeFailure> {
  if (!shopifyConfig.apiKey || !shopifyConfig.apiSecret) {
    return { ok: false, status: null, error: "Shopify API credentials are not configured.", retryable: false };
  }

  return postTokenRequest(
    options.shopDomain,
    buildRefreshTokenBody({
      refreshToken: options.refreshToken,
      clientId: shopifyConfig.apiKey,
      clientSecret: shopifyConfig.apiSecret
    })
  );
}

/**
 * Swaps a legacy non-expiring token for an expiring one, without asking the
 * merchant to reinstall. Shopify REVOKES the old token on success and the
 * exchange is irreversible, so persist the result immediately.
 */
export async function migrateToExpiringToken(options: {
  shopDomain: string;
  nonExpiringAccessToken: string;
}): Promise<TokenExchangeResult | TokenExchangeFailure> {
  if (!shopifyConfig.apiKey || !shopifyConfig.apiSecret) {
    return { ok: false, status: null, error: "Shopify API credentials are not configured.", retryable: false };
  }

  return postTokenRequest(
    options.shopDomain,
    buildTokenMigrationBody({
      nonExpiringAccessToken: options.nonExpiringAccessToken,
      clientId: shopifyConfig.apiKey,
      clientSecret: shopifyConfig.apiSecret
    })
  );
}
