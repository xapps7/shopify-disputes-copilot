import { NextResponse } from "next/server";

import { isOpenAIDraftEnabled } from "@/lib/ai/openai-dispute-drafts";
import { db } from "@/lib/db";
import { isDiagnosticsAuthorized } from "@/lib/diagnostics-auth";
import { getLatestDisputeSyncRun } from "@/lib/disputes/sync-runs";
import { resolveShopDomain } from "@/lib/shopify/auth";
import { APP_COMMIT, APP_RELEASE } from "@/lib/version";

export async function GET(request: Request) {
  // Liveness probe stays public; anything merchant-identifying requires the
  // diagnostics secret. Previously this leaked merchant id, Shopify shop id,
  // token presence and install dates for ANY shop domain supplied in ?shop=.
  if (!isDiagnosticsAuthorized(request)) {
    return NextResponse.json({
      ok: true,
      service: "shopify-disputes-copilot",
      release: APP_RELEASE,
      commit: APP_COMMIT,
      timestamp: new Date().toISOString()
    });
  }

  const url = new URL(request.url);
  const shopDomain = await resolveShopDomain({ shop: url.searchParams.get("shop") ?? undefined });
  const merchant = shopDomain
    ? await db.merchant.findUnique({
        where: { shopDomain },
        select: {
          id: true,
          shopifyShopId: true,
          accessTokenEncrypted: true,
          installedAt: true,
          updatedAt: true,
          uninstalledAt: true
        }
      })
    : null;
  const latestSyncRun = await getLatestDisputeSyncRun(shopDomain);

  return NextResponse.json({
    ok: true,
    service: "shopify-disputes-copilot",
    shopDomain,
    merchant: merchant
      ? {
          id: merchant.id,
          shopifyShopId: merchant.shopifyShopId,
          accessTokenPresent: Boolean(merchant.accessTokenEncrypted),
          installedAt: merchant.installedAt.toISOString(),
          updatedAt: merchant.updatedAt.toISOString(),
          uninstalledAt: merchant.uninstalledAt?.toISOString() ?? null
        }
      : null,
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
