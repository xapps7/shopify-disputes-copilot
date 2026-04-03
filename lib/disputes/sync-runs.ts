import { SyncRunStatus, SyncRunType } from "@prisma/client";

import { db } from "@/lib/db";
import { syncRecentDisputesForMerchant } from "@/lib/disputes/shopify-sync";

const MAX_SYNC_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDisputeSyncWithRetry(shopDomain: string) {
  const merchant = await db.merchant.findUnique({
    where: { shopDomain }
  });

  if (!merchant) {
    throw new Error("Merchant is not installed or access token is missing.");
  }

  const syncRun = await db.syncRun.create({
    data: {
      merchantId: merchant.id,
      type: SyncRunType.DISPUTE_PULL,
      status: SyncRunStatus.RUNNING
    }
  });

  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
    try {
      if (attempt > 1) {
        await db.syncRun.update({
          where: { id: syncRun.id },
          data: {
            attemptCount: attempt,
            lastError
          }
        });
      }

      const result = await syncRecentDisputesForMerchant(shopDomain);

      await db.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: SyncRunStatus.SUCCEEDED,
          syncedCount: result.synced,
          completedAt: new Date(),
          attemptCount: attempt,
          lastError: null
        }
      });

      return {
        synced: result.synced,
        attemptCount: attempt,
        syncRunId: syncRun.id
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Dispute sync failed.";

      if (attempt < MAX_SYNC_ATTEMPTS) {
        await sleep(250 * attempt);
        continue;
      }

      await db.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: SyncRunStatus.FAILED,
          completedAt: new Date(),
          attemptCount: attempt,
          lastError
        }
      });

      throw new Error(lastError);
    }
  }

  throw new Error("Dispute sync failed.");
}

export async function getLatestDisputeSyncRun(shopDomain: string | null) {
  if (!shopDomain) {
    return null;
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    include: {
      syncRuns: {
        where: {
          type: SyncRunType.DISPUTE_PULL
        },
        orderBy: { startedAt: "desc" },
        take: 1
      }
    }
  });

  return merchant?.syncRuns[0] ?? null;
}
