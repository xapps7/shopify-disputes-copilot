import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { sweepAllMerchants } from "@/lib/disputes/background-sync";

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

  return NextResponse.json({
    ok: true,
    merchants: results.length,
    synced: results.reduce((total, result) => total + (result.synced ?? 0), 0),
    alerts: results.reduce((total, result) => total + result.alerts, 0),
    failed: results.filter((result) => result.error).map((result) => ({ shop: result.shopDomain, error: result.error })),
    durationMs: Date.now() - startedAt
  });
}
