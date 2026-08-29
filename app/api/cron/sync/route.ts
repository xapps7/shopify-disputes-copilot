import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { runRetentionSweep } from "@/lib/compliance/retention-sweep";
import { sweepAllMerchants } from "@/lib/disputes/background-sync";
import { canStartWithin, rotate, summariseSweep, withDeadline } from "@/lib/disputes/sweep-plan";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Retention gets whatever is left of the invocation after the sweep, and stops
 * starting shops with one shop's worth of clock in hand. See
 * SWEEP_TOTAL_BUDGET_MS in sweep-plan.ts for how the phases divide the 300
 * seconds and what the leftover 45 are for.
 */
const RETENTION_PHASE_BUDGET_MS = 255_000;
const RETENTION_SHOP_DEADLINE_MS = 20_000;

/** How many failing shops the response names before it just counts them. */
const FAILURE_SAMPLE_SIZE = 20;

/**
 * Unattended sweep, for a scheduler to call (EventBridge Scheduler pairs
 * naturally with App Runner). Hourly is enough - alert thresholds are 72h and
 * 24h before Shopify auto-submits.
 *
 *   curl -X POST https://<app>/api/cron/sync -H "Authorization: Bearer $CRON_SECRET"
 *
 * Without CRON_SECRET set this refuses to run rather than exposing every
 * merchant's sync to the internet.
 */
function isAuthorized(request: Request) {
  const configured = process.env.CRON_SECRET?.trim();
  if (!configured) {
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const supplied = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Not found." }, { status: 404 });
  }

  const startedAt = Date.now();

  // Nothing in here was wrapped before, so a single unexpected throw - a dead
  // database connection, a bad JSON column - escaped to Next's default 500 with
  // an HTML body. The scheduler saw a failed job and nothing about which shop or
  // which phase, which is the least useful moment to have no detail.
  try {
    // The sweep shares this clock, not its own, so a slow cold start is spent
    // out of its budget rather than pushing the invocation past maxDuration.
    const results = await sweepAllMerchants({ startedAt });
    const summary = summariseSweep(results);

    // Retention runs after the sync, in the same invocation, and never blocks it.
    //
    // After, because the sync is what the merchant notices - a dispute that
    // appears late costs them money, whereas personal data erased an hour late
    // costs nothing. Same invocation, because there is exactly one scheduled
    // trigger and adding a second one is another thing to configure and forget.
    //
    // A failure here is logged and reported, never thrown: a retention error must
    // not turn a successful sync into a 500 that the scheduler then retries,
    // syncing everything again.
    const retention = await runRetentionSweeps(startedAt);

    if (!summary.complete) {
      console.warn(
        `[cron] sweep truncated: ${summary.processed} synced, ${summary.alertsOnly} alerts only, ` +
          `${summary.skipped} skipped, ${summary.merchants} installed`
      );
    }

    return NextResponse.json({
      // Still 200, and still `ok`, when the run was truncated.
      //
      // Truncation is the expected steady state once the fleet outgrows one
      // invocation - it is not an error, and returning 5xx for it would make the
      // scheduler retry the entire fleet and sync everything a second time. The
      // signal to alert on is `complete`, with the counts underneath it saying
      // how badly the hour was cut short. A 5xx here means the sweep itself
      // fell over and nothing was done.
      ok: true,
      complete: summary.complete,
      merchants: summary.merchants,
      /** Merchants whose Shopify sync ran this hour. */
      processed: summary.processed,
      /** Reached too late for Shopify; deadlines were still checked and mailed. */
      alertsOnly: summary.alertsOnly,
      /** Never reached at all this hour. First in line next hour. */
      skipped: summary.skipped,
      failedCount: summary.failed,
      synced: summary.disputesSynced,
      alerts: summary.alerts,
      // Capped, because at fleet scale a total outage would otherwise put every
      // shop domain we have into a log line. The count above is the real signal.
      failed: results
        .filter((result) => result.error)
        .slice(0, FAILURE_SAMPLE_SIZE)
        .map((result) => ({ shop: result.shopDomain, error: result.error })),
      retention,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron] sweep failed", error);

    // A real 500 here, unlike a truncated run: the scheduler's next attempt is
    // worth making, and --fail-with-body in the workflow turns this into a red
    // run in the Actions tab with the reason attached.
    return NextResponse.json({ ok: false, message, durationMs: Date.now() - startedAt }, { status: 500 });
  }
}

/**
 * Erases personal data on finished disputes, per each merchant's own retention
 * setting. Reports counts rather than the plan itself - the plan names dispute
 * ids, and a cron response is not the place for them.
 *
 * Bounded on the same clock as the sweep, and for the same reason: this used to
 * be a sequential loop over every installed merchant with nothing to stop it, so
 * on a large fleet it was a second way for the invocation to be killed - this
 * time after the sync had already succeeded, which would have thrown away the
 * response that says what the sync did.
 *
 * Deliberately still sequential rather than concurrent. Retention deletes files
 * from S3 and is the lowest-priority job in the invocation; running six at once
 * would take pool connections and S3 throughput away from work the merchant can
 * actually see, to finish sooner something nobody is waiting on.
 *
 * Rotated by the hour because there is no per-merchant "last scrubbed" timestamp
 * to sort on the way the sync sorts on SyncRun. A different starting point each
 * run is cruder than real rotation and it is enough to stop the same tail of the
 * list from never being scrubbed at all.
 */
async function runRetentionSweeps(startedAt: number) {
  const merchants = await db.merchant.findMany({
    where: { uninstalledAt: null },
    select: { shopDomain: true },
    orderBy: { shopDomain: "asc" }
  });

  const queue = rotate(merchants, Math.floor(startedAt / (60 * 60 * 1000)));

  let scrubbed = 0;
  let filesDeleted = 0;
  let filesPending = 0;
  let visited = 0;
  const failed: Array<{ shop: string; error: string }> = [];

  for (const merchant of queue) {
    if (!canStartWithin(Date.now() - startedAt, RETENTION_PHASE_BUDGET_MS, RETENTION_SHOP_DEADLINE_MS)) {
      break;
    }

    visited += 1;

    try {
      const result = await withDeadline(
        runRetentionSweep(merchant.shopDomain),
        RETENTION_SHOP_DEADLINE_MS,
        "Retention sweep exceeded its deadline and was abandoned."
      );
      scrubbed += result.scrubbed;
      filesDeleted += result.filesDeleted;
      filesPending += result.filesPending;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[cron] retention sweep failed for ${merchant.shopDomain}`, error);
      failed.push({ shop: merchant.shopDomain, error: message });
    }
  }

  return {
    shops: merchants.length,
    visited,
    /** Left for the next run. Retention is measured in days; an hour costs nothing. */
    skipped: merchants.length - visited,
    scrubbed,
    filesDeleted,
    filesPending,
    failed: failed.slice(0, FAILURE_SAMPLE_SIZE),
    failedCount: failed.length
  };
}
