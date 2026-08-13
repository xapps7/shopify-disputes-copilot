/**
 * Pure token-exchange logic, free of `@/` path aliases so it can be unit tested
 * directly under `node --experimental-strip-types` (see tests/token-exchange.test.ts).
 * The network call lives in token-exchange.ts.
 */

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const SESSION_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";

export const OFFLINE_TOKEN_TYPE = "urn:shopify:params:oauth:token-type:offline-access-token";
export const ONLINE_TOKEN_TYPE = "urn:shopify:params:oauth:token-type:online-access-token";

export type TokenExchangeResult = {
  accessToken: string;
  scope: string | null;
  /** Present for expiring tokens; null for classic non-expiring ones. */
  expiresAt: Date | null;
};

export type TokenExchangeFailure = {
  ok: false;
  status: number | null;
  error: string;
  /** True when the session token was rejected - the caller should get a fresh one. */
  retryable: boolean;
};

/** Pure: the exact body Shopify expects. Split out so it can be tested without network. */
export function buildTokenExchangeBody(options: {
  sessionToken: string;
  clientId: string;
  clientSecret: string;
  requestedTokenType?: string;
}) {
  return {
    client_id: options.clientId,
    client_secret: options.clientSecret,
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: options.sessionToken,
    subject_token_type: SESSION_TOKEN_TYPE,
    requested_token_type: options.requestedTokenType ?? OFFLINE_TOKEN_TYPE
  };
}

/** Pure: normalises Shopify's response, including the expires_in -> absolute date conversion. */
export function parseTokenExchangeResponse(
  payload: unknown,
  now = Date.now()
): TokenExchangeResult | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const body = payload as { access_token?: unknown; scope?: unknown; expires_in?: unknown };

  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    return null;
  }

  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;

  return {
    accessToken: body.access_token,
    scope: typeof body.scope === "string" ? body.scope : null,
    // Renew a little early so a token cannot expire mid-request.
    expiresAt: expiresIn ? new Date(now + Math.max(0, expiresIn - 60) * 1000) : null
  };
}

