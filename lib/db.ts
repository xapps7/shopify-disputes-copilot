import { PrismaClient } from "@prisma/client";

/**
 * Prisma, with a retry for the one failure this deployment actually hits.
 *
 * Neon suspends a project's compute after a few minutes with no queries. App
 * Runner runs a long-lived container, so Prisma is still holding pooled
 * connections when that happens - and the next query goes out down a socket the
 * database closed while nobody was looking:
 *
 *   prisma:error Error in PostgreSQL connection: Error { kind: Closed }
 *
 * The connection is re-established on the following attempt, so the whole
 * failure is one dead request. Without a retry that request is whatever the
 * merchant happened to be doing - and the observed symptom was an evidence
 * upload returning "Upload failed." with nothing wrong except timing.
 *
 * Retrying at the client level rather than per call site means every query is
 * covered, including the ones nobody has written yet. Only connection faults
 * are retried: a constraint violation or a bad query is deterministic and
 * retrying it just does the wrong thing three times.
 */

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 150;

/**
 * Whether a failure is the socket rather than the query.
 *
 * Matched on message text as well as Prisma's codes because the Neon case
 * surfaces as a raw connector error - `kind: Closed` - without a P-code at all,
 * which is exactly the one we need to catch.
 */
function isTransientConnectionError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? "";

  // P1001 unreachable, P1008 timed out, P1017 server closed the connection,
  // P2024 pool timeout.
  if (["P1001", "P1008", "P1017", "P2024"].includes(code)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /kind:\s*Closed|Connection closed|connection reset|Timed out fetching a new connection|server has closed the connection/i.test(
    message
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        let lastError: unknown;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
          try {
            return await query(args);
          } catch (error) {
            lastError = error;

            if (!isTransientConnectionError(error) || attempt === MAX_ATTEMPTS) {
              throw error;
            }

            // Linear rather than exponential: a woken Neon compute is ready in
            // well under a second, and a long backoff turns a recoverable blip
            // into a request the merchant gives up on.
            console.warn(
              `[db] connection closed, retrying (${attempt}/${MAX_ATTEMPTS - 1})`
            );
            await sleep(BACKOFF_MS * attempt);
          }
        }

        throw lastError;
      }
    }
  });
}

type ExtendedClient = ReturnType<typeof createClient>;

declare global {
  var prisma: ExtendedClient | undefined;
}

export const db = global.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = db;
}
