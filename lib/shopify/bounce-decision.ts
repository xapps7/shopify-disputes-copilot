/**
 * Should this request go and fetch a fresh session token?
 *
 * Under Shopify-managed installation there is no OAuth callback. The bounce
 * page is the app's only route from "no usable credential" back to signed in,
 * so the decision to take it is the single most load-bearing branch in the
 * whole login flow. Get it wrong in one direction and the merchant loops
 * forever inside an iframe that never paints; get it wrong in the other and
 * they sit on an empty dashboard with no explanation and no way out. Both look
 * identical to a Shopify reviewer: a broken app.
 *
 * Kept pure and dependency-free - no Next, no database, no aliases - so both
 * the edge middleware and server components can share exactly one copy of the
 * rule, and so it can be tested directly. Same split the codebase already uses
 * for alert-rules.ts (pure) against alerts.ts (database).
 */

/** Why we do not hold a usable Admin API token for a shop. */
export type TokenFailureReason =
  /** We hold a usable token. Nothing to recover. */
  | "none"
  /** Nothing to exchange. A bounce hands us a session token and we try again. */
  | "no-session-token"
  /** Shopify refused the exchange - often a session token that aged out in flight. */
  | "exchange-failed"
  /** Rotation with the stored refresh token failed and no session token was available. */
  | "refresh-failed";

export type TokenRecoveryInput = {
  /** Do we hold a token that is present AND not expired? */
  hasToken: boolean;
  /** Would a fresh session token plausibly fix this? */
  retryable: boolean;
  /** Has this request already spent its one bounce (`dc_bounced`)? */
  alreadyBounced: boolean;
};

/**
 * The page-side rule: we know who the merchant is, but have no working token.
 *
 * Bouncing is only worth it when a NEWER session token would change the
 * outcome. A misconfigured API secret or a revoked app fails identically on
 * every attempt, so retrying it just burns the merchant's one retry and hides
 * the real problem behind a redirect.
 */
export function shouldBounceForToken(input: TokenRecoveryInput): boolean {
  if (input.hasToken) {
    return false;
  }

  // Already been round once. A second bounce is a loop, and a loop in an
  // iframe is invisible - the merchant just watches a blank panel.
  if (input.alreadyBounced) {
    return false;
  }

  return input.retryable;
}

export type RequestBounceInput = {
  /** Did a session token arrive AND verify? An expired one verifies as false. */
  hasVerifiedClaims: boolean;
  /** Do we hold a signed first-party session cookie for this browser? */
  hasSessionCookie: boolean;
  /** Is this a full page load, i.e. something with a browser to run App Bridge in? */
  isDocumentRequest: boolean;
  /** Has this request already spent its one bounce (`dc_bounced`)? */
  alreadyBounced: boolean;
  /** API routes answer machines, not browsers. */
  isApiPath: boolean;
};

/**
 * The middleware rule, applied before any page runs.
 *
 * A MISSING token and an EXPIRED one are the same situation: we have no
 * verified identity from this request. Session tokens live about 60 seconds, so
 * expiry is the common case, not the edge case. Treating only the missing one
 * as recoverable strands every merchant whose browser withholds the fallback
 * cookie - which is Safari's default for third-party cookies, so it is a large
 * share of real merchants, not a corner.
 *
 * The guards are all about who must NOT be redirected:
 *   - non-document requests: App Runner reads a 302 on its health check as a
 *     failing target and cycles the deployment. That is an outage, caused by a
 *     login fix.
 *   - API paths: there is no browser there to run App Bridge, so a redirect
 *     turns a clean 401 into an HTML body the caller cannot parse.
 *   - a live session cookie: identity already exists, so a bounce would cost a
 *     round trip and buy nothing.
 */
export function shouldBounceRequest(input: RequestBounceInput): boolean {
  if (input.hasVerifiedClaims) {
    return false;
  }

  if (input.hasSessionCookie) {
    return false;
  }

  if (!input.isDocumentRequest || input.isApiPath) {
    return false;
  }

  return !input.alreadyBounced;
}
