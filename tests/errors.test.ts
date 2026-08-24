import test from "node:test";
import assert from "node:assert/strict";

import {
  extractGraphqlErrors,
  graphqlErrorMessages,
  hasOnlyAccessDeniedErrors,
  hasOnlyUnauthorizedErrors,
  isAccessDeniedError,
  isUnauthorizedError,
  isUnauthorizedResponse
} from "../lib/shopify/errors.ts";

// The bug this guards against: @shopify/admin-api-client returns `errors` as a
// ResponseErrors OBJECT. `Array.isArray(response.errors)` is always false, so
// every GraphQL failure was read as "success with zero results".
test("unwraps graphQLErrors from the ResponseErrors object", () => {
  const response = {
    data: null,
    errors: {
      networkStatusCode: 200,
      message: "GraphQL Client: Access denied",
      graphQLErrors: [
        {
          message: "Access denied for customer field. Required access: `read_customers` access scope.",
          path: ["orders", "nodes", "0", "customer"],
          extensions: { code: "ACCESS_DENIED" }
        }
      ]
    }
  };

  const errors = extractGraphqlErrors(response);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "ACCESS_DENIED");
  assert.equal(errors[0].path, "orders.nodes.0.customer");
  assert.ok(isAccessDeniedError(errors[0]));
  assert.match(graphqlErrorMessages(response)[0], /read_customers/);
});

test("catches the undefinedField schema error that nulled every query", () => {
  const response = {
    data: null,
    errors: {
      graphQLErrors: [
        {
          message: "Field 'nodes' doesn't exist on type 'Fulfillment'",
          path: ["query RecentOrders", "orders", "nodes", "fulfillments", "nodes"],
          extensions: { code: "undefinedField" }
        }
      ]
    }
  };

  const errors = extractGraphqlErrors(response);
  assert.equal(errors[0].code, "undefinedField");
  assert.equal(isAccessDeniedError(errors[0]), false, "schema errors must not be treated as benign");
  assert.equal(hasOnlyAccessDeniedErrors(response), false);
});

test("falls back to transport-level failures with no GraphQL body", () => {
  const errors = extractGraphqlErrors({ errors: { networkStatusCode: 502, message: "Bad Gateway" } });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "HTTP_502");
});

test("a successful response yields no errors", () => {
  assert.deepEqual(extractGraphqlErrors({ data: { orders: { nodes: [] } } }), []);
  assert.deepEqual(extractGraphqlErrors(undefined), []);
  assert.deepEqual(extractGraphqlErrors({ errors: undefined }), []);
});

test("tolerates a plain array, in case the client ever changes shape", () => {
  const errors = extractGraphqlErrors({ errors: [{ message: "boom", extensions: { code: "X" } }] });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "boom");
});

test("access-denied-only responses are distinguishable from real failures", () => {
  const denied = {
    errors: { graphQLErrors: [{ message: "Access denied for shopifyPaymentsAccount field." }] }
  };
  assert.equal(hasOnlyAccessDeniedErrors(denied), true);
});

/* --- 401: the credentials are dead, and that is recoverable ------------- */

/**
 * Exactly the shape the client produces for a rejected token. This is the
 * response every query returned while the app was stuck: the token decrypted
 * fine, Shopify refused it, and nothing in the app noticed the difference
 * between that and an ordinary sync warning.
 */
const unauthorizedResponse = {
  errors: { networkStatusCode: 401, message: "GraphQL Client: Unauthorized" }
};

test("a rejected token is recognised as unauthorized", () => {
  assert.equal(isUnauthorizedResponse(unauthorizedResponse), true);
  assert.equal(hasOnlyUnauthorizedErrors(unauthorizedResponse), true);
});

test("the message this produces is the one the merchant actually saw", () => {
  assert.deepEqual(graphqlErrorMessages(unauthorizedResponse), [
    "(HTTP_401) GraphQL Client: Unauthorized"
  ]);
});

test("a 401 is not an access-denied error, and the two must not be confused", () => {
  // ACCESS_DENIED means the token is good and a scope is missing: nothing to
  // retry. 401 means the token is dead: throw it away and exchange a new one.
  // Treating the second as the first is what left the app stuck.
  assert.equal(hasOnlyAccessDeniedErrors(unauthorizedResponse), false);

  const accessDenied = {
    errors: {
      graphQLErrors: [
        { message: "Access denied for firstName field", extensions: { code: "ACCESS_DENIED" } }
      ]
    }
  };
  assert.equal(hasOnlyUnauthorizedErrors(accessDenied), false);
  assert.equal(hasOnlyAccessDeniedErrors(accessDenied), true);
});

test("the wording is matched as well as the status, because transports differ", () => {
  assert.equal(
    isUnauthorizedError({ message: "Invalid API key or access token", code: null, path: null }),
    true
  );
  assert.equal(isUnauthorizedError({ message: "unauthorized", code: null, path: null }), true);
  assert.equal(isUnauthorizedError({ message: "Throttled", code: "THROTTLED", path: null }), false);
});

test("a mixed response is not credentials-only, so it keeps its real errors", () => {
  const mixed = {
    errors: {
      graphQLErrors: [
        { message: "GraphQL Client: Unauthorized", extensions: { code: null } },
        { message: "Field 'shopifyProtect' doesn't exist", extensions: { code: "undefinedField" } }
      ]
    }
  };

  assert.equal(isUnauthorizedResponse(mixed), true);
  // Not ONLY 401, so the schema error must still reach the log rather than
  // being swallowed by the credentials message.
  assert.equal(hasOnlyUnauthorizedErrors(mixed), false);
});

test("a clean response is neither", () => {
  assert.equal(isUnauthorizedResponse({ data: { shop: { name: "Test" } } }), false);
  assert.equal(hasOnlyUnauthorizedErrors({}), false);
  assert.equal(hasOnlyUnauthorizedErrors(null), false);
});

test("other HTTP failures are not treated as dead credentials", () => {
  // Clearing a working token because Shopify had a bad minute would be a
  // self-inflicted outage.
  for (const status of [429, 500, 502, 503]) {
    const response = { errors: { networkStatusCode: status, message: "GraphQL Client: Server Error" } };
    assert.equal(isUnauthorizedResponse(response), false, `HTTP ${status} must not invalidate the token`);
  }
});
