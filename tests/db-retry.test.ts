import test from "node:test";
import assert from "node:assert/strict";

/**
 * Mirrors isTransientConnectionError in lib/db.ts.
 *
 * Copied rather than imported because lib/db.ts instantiates a Prisma client at
 * module load, which needs a generated client and a database URL. The rule it
 * encodes is worth guarding on its own: retry the socket, never the query.
 */
function isTransientConnectionError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? "";

  if (["P1001", "P1008", "P1017", "P2024"].includes(code)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /kind:\s*Closed|Connection closed|connection reset|Timed out fetching a new connection|server has closed the connection/i.test(
    message
  );
}

test("catches the exact error this deployment produces", () => {
  // Straight from App Runner's logs. Neon suspends the compute, App Runner is
  // still holding the connection, and the next query goes down a dead socket.
  // Note it carries no Prisma error code at all, which is why matching on codes
  // alone would have missed the one case that actually happens.
  const observed = new Error("Error in PostgreSQL connection: Error { kind: Closed, cause: None }");
  assert.equal(isTransientConnectionError(observed), true);
});

test("catches the coded connection failures too", () => {
  for (const code of ["P1001", "P1008", "P1017", "P2024"]) {
    assert.equal(isTransientConnectionError(Object.assign(new Error("x"), { code })), true, code);
  }
});

test("never retries a query that is simply wrong", () => {
  // A unique constraint violation is deterministic. Retrying it does the wrong
  // thing three times and turns one clear error into three confusing ones.
  const constraint = Object.assign(new Error("Unique constraint failed on the fields: (`shopifyDisputeId`)"), {
    code: "P2002"
  });
  assert.equal(isTransientConnectionError(constraint), false);

  const notFound = Object.assign(new Error("An operation failed because it depends on one or more records that were required but not found"), {
    code: "P2025"
  });
  assert.equal(isTransientConnectionError(notFound), false);

  assert.equal(isTransientConnectionError(new Error("Invalid `db.dispute.create()` invocation")), false);
});

test("survives being handed something that is not an error", () => {
  assert.equal(isTransientConnectionError(null), false);
  assert.equal(isTransientConnectionError(undefined), false);
  assert.equal(isTransientConnectionError("Connection closed"), true);
});
