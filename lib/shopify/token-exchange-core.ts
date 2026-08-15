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
  /** Single-use: Shopify rotates it on every refresh. Persist it every time. */
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
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
  /** Set to the offline-token type when migrating an existing non-expiring token. */
  subjectTokenType?: string;
}) {
  const requestedTokenType = options.requestedTokenType ?? OFFLINE_TOKEN_TYPE;

  return {
    client_id: options.clientId,
    client_secret: options.clientSecret,
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: options.sessionToken,
    subject_token_type: options.subjectTokenType ?? SESSION_TOKEN_TYPE,
    requested_token_type: requestedTokenType,
    // Expiring offline tokens are mandatory for new public apps since
    // 1 Apr 2026, and for ALL public apps from 1 Jan 2027 - after which
    // non-expiring tokens start returning authentication errors.
    // Only meaningful when an offline token is being requested.
    ...(requestedTokenType === OFFLINE_TOKEN_TYPE ? { expiring: 1 } : {})
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

  const body = payload as {
    access_token?: unknown;
    scope?: unknown;
    expires_in?: unknown;
    refresh_token?: unknown;
    refresh_token_expires_in?: unknown;
  };

  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    return null;
  }

  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;
  const refreshExpiresIn =
    typeof body.refresh_token_expires_in === "number" ? body.refresh_token_expires_in : null;

  return {
    accessToken: body.access_token,
    scope: typeof body.scope === "string" ? body.scope : null,
    // Renew a little early so a token cannot expire mid-request.
    expiresAt: expiresIn ? new Date(now + Math.max(0, expiresIn - 60) * 1000) : null,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    refreshTokenExpiresAt: refreshExpiresIn ? new Date(now + refreshExpiresIn * 1000) : null
  };
}


export const REFRESH_TOKEN_GRANT = "refresh_token";

/** Body for rotating an expiring offline token. */
export function buildRefreshTokenBody(options: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}) {
  return {
    client_id: options.clientId,
    client_secret: options.clientSecret,
    grant_type: REFRESH_TOKEN_GRANT,
    refresh_token: options.refreshToken
  };
}

/**
 * One-shot migration of a legacy non-expiring token to an expiring one.
 * The old token is REVOKED on success and this is irreversible, so the new
 * token and refresh token must be written in the same transaction.
 */
export function buildTokenMigrationBody(options: {
  nonExpiringAccessToken: string;
  clientId: string;
  clientSecret: string;
}) {
  return buildTokenExchangeBody({
    sessionToken: options.nonExpiringAccessToken,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    subjectTokenType: OFFLINE_TOKEN_TYPE,
    requestedTokenType: OFFLINE_TOKEN_TYPE
  });
}
