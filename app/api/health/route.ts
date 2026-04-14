import { NextResponse } from "next/server";

import { isOpenAIDraftEnabled } from "@/lib/ai/openai-dispute-drafts";
import { getLatestDisputeSyncRun } from "@/lib/disputes/sync-runs";
import { resolveShopDomain } from "@/lib/shopify/auth";
import { APP_COMMIT, APP_RELEASE } from "@/lib/version";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const shopDomain = await resolveShopDomain({ shop: url.searchParams.get("shop") ?? undefined });
  const latestSyncRun = await getLatestDisputeSyncRun(shopDomain);

  return NextResponse.json({
    ok: true,
    service: "shopify-disputes-copilot",
    shopDomain,
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
