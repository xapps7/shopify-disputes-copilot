import test from "node:test";
import assert from "node:assert/strict";

import {
  extractGraphqlErrors,
  graphqlErrorMessages,
  hasOnlyAccessDeniedErrors,
  isAccessDeniedError
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
