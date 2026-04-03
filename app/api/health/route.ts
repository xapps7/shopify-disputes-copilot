import { NextResponse } from "next/server";

import { isOpenAIDraftEnabled } from "@/lib/ai/openai-dispute-drafts";
import { getLatestDisputeSyncRun } from "@/lib/disputes/sync-runs";
import { APP_COMMIT, APP_RELEASE } from "@/lib/version";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

export async function GET() {
  const shopDomain = await getCurrentShopDomain();
  const latestSyncRun = await getLatestDisputeSyncRun(shopDomain);

  return NextResponse.json({
    ok: true,
    service: "shopify-disputes-copilot",
    release: APP_RELEASE,
    commit: APP_COMMIT,
    aiDraftsEnabled: isOpenAIDraftEnabled(),
    latestSyncRun: latestSyncRun
      ? {
          status: latestSyncRun.status,
          attemptCount: latestSyncRun.attemptCount,
          syncedCount: latestSyncRun.syncedCount,
          startedAt: latestSyncRun.startedAt.toISOString(),
          completedAt: latestSyncRun.completedAt?.toISOString() ?? null,
          lastError: latestSyncRun.lastError
        }
      : null,
    timestamp: new Date().toISOString()
  });
}
