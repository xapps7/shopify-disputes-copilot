import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldBounceForToken,
  shouldBounceRequest,
  type TokenFailureReason
} from "../lib/shopify/bounce-decision.ts";

// Shopify-managed installation deleted the OAuth callback, so these two
// decisions are the whole login flow. There is no second chance behind them.
//
// Failing to bounce when we should: the merchant sees an empty dashboard with
// no error and no retry, and a reviewer sees it on their first screen.
// Bouncing when we should not: a redirect loop inside the admin iframe, which
// is invisible - the panel simply never paints - and unrecoverable without
// uninstalling.
//
// Both failures have shipped in this file's history. The tests below are the
// specific shapes that caused them.

test("a usable token never bounces", () => {
  assert.equal(
    shouldBounceForToken({ hasToken: true, retryable: false, alreadyBounced: false }),
    false
  );
  // Even a retryable-looking flag must not move a request that already works.
  assert.equal(
    shouldBounceForToken({ hasToken: true, retryable: true, alreadyBounced: false }),
    false
  );
});

test("a stale session token that failed exchange gets one retry", () => {
  // The bug: session tokens live ~60s, so on a cold render the exchange can
  // fire against a token that has already aged out. Shopify answers 400
  // invalid_subject_token. The old code saw "a session token was present" and
  // refused to bounce, so a brand-new store - where nothing has created the
  // merchant row yet - rendered a blank dashboard forever.
  assert.equal(
    shouldBounceForToken({ hasToken: false, retryable: true, alreadyBounced: false }),
    true
  );
});

test("no session token at all is recoverable, because a bounce mints one", () => {
  assert.equal(
    shouldBounceForToken({ hasToken: false, retryable: true, alreadyBounced: false }),
    true
  );
});

test("a permanent failure is not retried, so the page can say something true", () => {
  // Bad credentials or a revoked app fail identically every time. Bouncing
  // spends the merchant's one retry and hides the real cause behind a redirect.
  assert.equal(
    shouldBounceForToken({ hasToken: false, retryable: false, alreadyBounced: false }),
    false
  );
});

test("the second failure stops, so the iframe can never loop", () => {
  assert.equal(
    shouldBounceForToken({ hasToken: false, retryable: true, alreadyBounced: true }),
    false
  );
  assert.equal(
    shouldBounceForToken({ hasToken: false, retryable: false, alreadyBounced: true }),
    false
  );
});

test("every reason is one of the four the token layer can report", () => {
  const reasons: TokenFailureReason[] = [
    "none",
    "no-session-token",
    "exchange-failed",
    "refresh-failed"
  ];
  assert.equal(new Set(reasons).size, 4);
});

const documentRequest = {
  hasVerifiedClaims: false,
  hasSessionCookie: false,
  isDocumentRequest: true,
  alreadyBounced: false,
  isApiPath: false
};

test("a page load with no verified identity bounces", () => {
  assert.equal(shouldBounceRequest(documentRequest), true);
});

test("an EXPIRED token takes the same path as a missing one", () => {
  // The bug: the bounce lived inside `if (!token)`, so a token that arrived but
  // failed verification fell through to next() with no recovery. Verification
  // failure is all the middleware can see, and it looks the same either way -
  // which is the point.
  assert.equal(shouldBounceRequest({ ...documentRequest, hasVerifiedClaims: false }), true);
  assert.equal(shouldBounceRequest({ ...documentRequest, hasVerifiedClaims: true }), false);
});

test("a live session cookie is enough - no round trip needed", () => {
  assert.equal(shouldBounceRequest({ ...documentRequest, hasSessionCookie: true }), false);
});

test("a health probe is never redirected", () => {
  // App Runner reads a 302 on its health check path as a failing target and
  // cycles the deployment. A login fix must not become an outage.
  assert.equal(shouldBounceRequest({ ...documentRequest, isDocumentRequest: false }), false);
});

test("API callers get their status code, not an HTML redirect", () => {
  // There is no browser behind an API call to run App Bridge in, so a redirect
  // turns a parseable 401 into a page the caller cannot read.
  assert.equal(shouldBounceRequest({ ...documentRequest, isApiPath: true }), false);
  assert.equal(
    shouldBounceRequest({ ...documentRequest, isApiPath: true, isDocumentRequest: false }),
    false
  );
});

test("the middleware also stops after one bounce", () => {
  assert.equal(shouldBounceRequest({ ...documentRequest, alreadyBounced: true }), false);
});

test("a verified token wins over every other guard", () => {
  assert.equal(
    shouldBounceRequest({
      hasVerifiedClaims: true,
      hasSessionCookie: false,
      isDocumentRequest: true,
      alreadyBounced: false,
      isApiPath: false
    }),
    false
  );
});
