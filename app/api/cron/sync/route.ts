import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { runRetentionSweep } from "@/lib/compliance/retention-sweep";
import { sweepAllMerchants } from "@/lib/disputes/background-sync";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  const results = await sweepAllMerchants();

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
  const retention = await runRetentionSweeps();

  return NextResponse.json({
    ok: true,
    merchants: results.length,
    synced: results.reduce((total, result) => total + (result.synced ?? 0), 0),
    alerts: results.reduce((total, result) => total + result.alerts, 0),
    failed: results.filter((result) => result.error).map((result) => ({ shop: result.shopDomain, error: result.error })),
    retention,
    durationMs: Date.now() - startedAt
  });
}

/**
 * Erases personal data on finished disputes, per each merchant's own retention
 * setting. Reports counts rather than the plan itself - the plan names dispute
 * ids, and a cron response is not the place for them.
 */
async function runRetentionSweeps() {
  const merchants = await db.merchant.findMany({
    where: { uninstalledAt: null },
    select: { shopDomain: true }
  });

  let scrubbed = 0;
  let filesDeleted = 0;
  let filesPending = 0;
  const failed: Array<{ shop: string; error: string }> = [];

  for (const merchant of merchants) {
    try {
      const result = await runRetentionSweep(merchant.shopDomain);
      scrubbed += result.scrubbed;
      filesDeleted += result.filesDeleted;
      filesPending += result.filesPending;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[cron] retention sweep failed for ${merchant.shopDomain}`, error);
      failed.push({ shop: merchant.shopDomain, error: message });
    }
  }

  return { shops: merchants.length, scrubbed, filesDeleted, filesPending, failed };
}
