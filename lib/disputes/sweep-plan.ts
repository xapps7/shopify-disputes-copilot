/**
 * Who gets swept this hour, in what order, and when the sweep must stop.
 *
 * The hourly cron route has a hard ceiling of 300 seconds, and one merchant's
 * sync is not cheap: up to twenty pages of the disputes connection, the
 * payments account, a hundred orders, then one GraphQL call per distinct
 * dispute order, all wrapped in three retries. Done one at a time that is a few
 * seconds each on a good day and much worse on a bad one, so somewhere past
 * sixty or so merchants the platform kills the invocation.
 *
 * The part that made this urgent is WHERE it got killed. A plain sequential
 * loop always dies at the same end of the same unordered list, so the same
 * merchants at the tail stopped syncing AND stopped getting deadline emails,
 * every hour, while the route still returned 200. Going quiet is the precise
 * failure the alerting feature exists to prevent, and the sweep had
 * reintroduced it one level up, for whole shops instead of single disputes.
 *
 * Three ideas fix that, and they all live here - pure, alias-free, no database -
 * so the scheduling decisions can be tested without Prisma. The parts that talk
 * to Postgres and Shopify stay in background-sync.ts and call into this.
 *
 *   ROTATION. Merchants are ordered least-recently-synced first, read from the
 *   SyncRun rows we already write. Truncation still happens at scale, but it
 *   moves: whoever was cut off this hour is at the front of the queue next
 *   hour. That needs no new column and no stored cursor, and because the order
 *   is derived rather than remembered it repairs itself after a deploy, a
 *   crash, or an install we have never seen before.
 *
 *   A TIME BUDGET. The sweep stops STARTING work well before the ceiling
 *   instead of being killed in the middle of a merchant. Being killed mid-sync
 *   leaves a SyncRun row stuck in RUNNING that nothing ever completes, which
 *   makes /api/health report a sync that is permanently in progress.
 *
 *   BOUNDED CONCURRENCY. A few merchants at a time rather than one, with a
 *   small fixed limit. Unbounded would be faster and is the wrong trade twice
 *   over: Shopify rate-limits per shop but we would still be opening hundreds
 *   of sockets at once, and every merchant in flight holds a Postgres
 *   connection out of a pool that the rest of the app shares.
 *
 * WHAT THIS DOES NOT FIX. At a few seconds per merchant, six lanes and a
 * 90-second window to start new work clears on the order of a hundred syncs an
 * hour, not thousands. Rotation makes that fair rather than fatal - everyone is
 * served in turn instead of one tail starving forever - but a fleet in the
 * thousands still means each merchant's Shopify data is hours old. The honest
 * fix at that size is a queue with more workers, or simply running the cron
 * more often; both are a bigger change than this and neither is needed yet.
 * Deadline alerts are the exception and they do scale here, because they are
 * evaluated from data already in Postgres - see ALERT_PHASE_BUDGET_MS.
 */

/**
 * The whole invocation, sync and alerts and retention together, aims to be done
 * at 255 seconds against a 300-second ceiling. The 45 seconds left over are not
 * spare capacity: they cover a cold start, a slow first database connection,
 * and serialising the response. Every phase budget below is measured from the
 * same start timestamp, so an overrun in one phase eats into the next rather
 * than pushing the total out.
 */
export const SWEEP_TOTAL_BUDGET_MS = 255_000;

/** Shopify sync stops starting new merchants at this point on the clock. */
export const SYNC_PHASE_BUDGET_MS = 150_000;

/**
 * Alert evaluation for merchants the sync phase never reached runs until here.
 *
 * This phase exists because of the ordering in requirement terms: if there is
 * not time for both, alerts beat sync. Alerts read deadlines that are already
 * in our database and need Shopify to be reachable exactly never, so they cost
 * a few queries rather than a few seconds. Skipping a merchant's sync means
 * their dispute list is an hour stale; skipping their alerts means they are not
 * told about a deadline at all. Only one of those is recoverable next hour.
 *
 * Cheap enough that this phase covers thousands of merchants in the minute it
 * gets, which is the reason the fleet can outgrow the sync phase without the
 * thing that actually protects merchants degrading with it.
 */
export const ALERT_PHASE_BUDGET_MS = 215_000;

/** How many merchants are swept at once. */
export const SWEEP_CONCURRENCY = 6;

/**
 * A single merchant's sync is abandoned after this long.
 *
 * Paired deliberately with the reserve below: because we refuse to START a sync
 * once less than one deadline's worth of budget is left, the last merchant we
 * begin cannot run past the phase budget. That is what turns "we try to finish
 * in time" into "we do".
 *
 * The cost is real and worth stating: a merchant whose sync genuinely needs
 * more than a minute - a very large backlog, or three slow retries - fails this
 * way every single hour and never completes. It is at least loud, appearing in
 * the route's failed list rather than vanishing, and the fix for that merchant
 * is resumable pagination, not a bigger number here.
 */
export const MERCHANT_SYNC_DEADLINE_MS = 60_000;

/** Alert evaluation is four queries; twenty seconds means the database is sick. */
export const MERCHANT_ALERT_DEADLINE_MS = 20_000;

/**
 * One merchant we are willing to begin, expressed in wall clock.
 *
 * Equal to the matching deadline on purpose - see MERCHANT_SYNC_DEADLINE_MS.
 */
export const SYNC_START_RESERVE_MS = MERCHANT_SYNC_DEADLINE_MS;
export const ALERT_START_RESERVE_MS = MERCHANT_ALERT_DEADLINE_MS;

/** What actually happened to one merchant on one sweep. */
export type SweepOutcome =
  /** Shopify sync attempted (it may still have failed) and alerts evaluated. */
  | "SYNCED"
  /** Out of time for Shopify, but deadlines were still checked and mailed. */
  | "ALERTS_ONLY"
  /** Out of time for both. Reported, never silently dropped. */
  | "SKIPPED";

export type SweepResult = {
  shopDomain: string;
  outcome: SweepOutcome;
  /** Disputes written by the Shopify sync, or null when it did not run. */
  synced: number | null;
  alerts: number;
  error: string | null;
};

/** A merchant waiting to be swept, plus the one fact that decides its place. */
export type SweepCandidate = {
  merchantId: string;
  shopDomain: string;
  /** Start of the most recent SyncRun, or null if this shop has never synced. */
  lastSyncStartedAt: Date | null;
};

/**
 * Least-recently-synced first, never-synced before everyone.
 *
 * Never-synced goes first because it is almost always a fresh install, and a
 * merchant who opens the app to an empty queue concludes it does not work. They
 * are also rare, so putting them at the front costs the rotation nothing.
 *
 * Ties break on shop domain purely so the order is deterministic. Two merchants
 * with identical timestamps is not a real scenario, but a stable sort makes the
 * behaviour reproducible in a test and in a bug report.
 */
export function orderByStaleness<T extends SweepCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) => {
    const left = a.lastSyncStartedAt?.getTime() ?? null;
    const right = b.lastSyncStartedAt?.getTime() ?? null;

    if (left === null || right === null) {
      if (left === right) {
        return a.shopDomain.localeCompare(b.shopDomain);
      }
      return left === null ? -1 : 1;
    }

    return left === right ? a.shopDomain.localeCompare(b.shopDomain) : left - right;
  });
}

/**
 * Whether there is room on the clock to begin one more unit of work.
 *
 * The reserve is what makes this a promise rather than a hope: it is the
 * longest the next unit is allowed to take, so anything we start still finishes
 * inside the budget.
 */
export function canStartWithin(elapsedMs: number, budgetMs: number, reserveMs: number): boolean {
  return elapsedMs + reserveMs <= budgetMs;
}

/**
 * Rotates a list by an offset, so a job that can only reach the front of it
 * does not reach the same front every time.
 *
 * Used for retention, which has no per-merchant timestamp to sort on and so
 * cannot rotate the way the sync does. A different starting point each run is
 * cruder than true least-recently-done ordering, and it is enough to stop one
 * tail of the list from never being scrubbed.
 */
export function rotate<T>(items: readonly T[], offset: number): T[] {
  if (items.length === 0) {
    return [];
  }

  const start = ((Math.trunc(offset) % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

/** Everything the caller needs after a bounded run: what ran, and what did not. */
export type ConcurrentRun<T, R> = {
  /** Results for the items that were claimed, in item order. */
  results: R[];
  /** Items the run never started, because the clock ran out. */
  remaining: T[];
};

/**
 * Runs `worker` over `items` with at most `limit` in flight, stopping early
 * when `shouldStart` says the budget is gone.
 *
 * Written here rather than pulled from a package. It is twenty lines, and a
 * dependency for twenty lines is a supply chain, a version to keep current and
 * a licence to review.
 *
 * Lanes claim indexes one at a time instead of the list being sliced into
 * fixed batches. Batching is simpler to read but suffers head-of-line blocking:
 * one merchant with a slow Shopify response holds five idle lanes until it
 * finishes. Claiming keeps every lane busy and, because the budget is checked
 * at each claim, stops the sweep within one merchant of the deadline rather
 * than one batch.
 *
 * If a worker rejects, the run keeps draining and rethrows the first error at
 * the end. Bailing out immediately would leave the other lanes running
 * detached, still writing to the database after the caller had given up, and a
 * write that lands after the response is the kind of bug nobody can reproduce.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldStart: () => boolean = () => true
): Promise<ConcurrentRun<T, R>> {
  const results: R[] = [];
  const failures: unknown[] = [];
  let claimed = 0;

  async function drain(): Promise<void> {
    while (claimed < items.length && shouldStart()) {
      const index = claimed;
      claimed += 1;

      try {
        results[index] = await worker(items[index] as T, index);
      } catch (error) {
        failures.push(error);
      }
    }
  }

  const lanes = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length || 1));
  await Promise.all(Array.from({ length: lanes }, () => drain()));

  if (failures.length > 0) {
    throw failures[0];
  }

  return { results, remaining: items.slice(claimed) };
}

/**
 * Stops waiting on `work` after `ms`.
 *
 * Stops WAITING, not stops working - there is no cancellation to hand down to
 * Shopify's client, so the abandoned request keeps running to completion in the
 * background. On App Runner that is a long-lived container, so it does finish
 * and its SyncRun row is closed out properly, just after we have replied. The
 * alternative was threading an AbortSignal through the whole sync path for a
 * case that only fires when a merchant is already broken.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    // Not unref'd: an unreferenced timer lets the process exit before the
    // deadline fires, which is exactly the case this exists for - the work it
    // is racing has stopped keeping the event loop busy.
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Counts for the cron response.
 *
 * `complete` is the number the scheduler should watch. A truncated run and a
 * healthy one look identical from the outside otherwise, which is how the
 * original bug survived: every hour returned 200 and nothing said that the last
 * forty merchants had not been touched.
 */
export function summariseSweep(results: readonly SweepResult[]) {
  const failed = results.filter((result) => result.error !== null);

  return {
    merchants: results.length,
    /** Merchants whose Shopify sync was attempted this run. */
    processed: results.filter((result) => result.outcome === "SYNCED").length,
    /** Merchants that got their deadlines checked but no fresh Shopify data. */
    alertsOnly: results.filter((result) => result.outcome === "ALERTS_ONLY").length,
    /** Merchants the clock never reached at all. */
    skipped: results.filter((result) => result.outcome === "SKIPPED").length,
    failed: failed.length,
    disputesSynced: results.reduce((total, result) => total + (result.synced ?? 0), 0),
    alerts: results.reduce((total, result) => total + result.alerts, 0),
    /** Every merchant got a Shopify sync attempt. Anything else is truncation. */
    complete: results.every((result) => result.outcome === "SYNCED")
  };
}
