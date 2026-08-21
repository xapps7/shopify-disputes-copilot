import { db } from "@/lib/db";
import { deliverAlerts, evaluateDisputeAlerts, recordAlerts } from "@/lib/disputes/alerts";
import { resolveStage } from "@/lib/disputes/lifecycle";
import { buildChecklist } from "@/lib/disputes/repository";
import { runDisputeSyncWithRetry } from "@/lib/disputes/sync-runs";

/**
 * Unattended sync.
 *
 * Ingestion used to happen only when a human pressed a button, which is the
 * whole problem: the merchant who most needs this app is the one who is not
 * looking. This sweeps every installed merchant, then evaluates deadline alerts.
 */

/** How stale a merchant's data may get before an opportunistic sync fires. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

export type SweepResult = {
  shopDomain: string;
  synced: number | null;
  alerts: number;
  error: string | null;
};

/** The same reason-aware coverage the queue badge and Today use. */
function reasonAwareScore(reason: string | null, categories: Set<string>) {
  const checklist = buildChecklist(reason, categories);
  if (checklist.length === 0) {
    return 0;
  }

  const ready = checklist.filter((item) => item.state === "ready").length;
  return Math.round((ready / checklist.length) * 100);
}

async function evaluateAlertsForMerchant(merchantId: string, shopDomain: string) {
  const disputes = await db.dispute.findMany({
    where: { merchantId },
    select: {
      id: true,
      status: true,
      amount: true,
      currencyCode: true,
      evidenceDueBy: true,
      evidenceSentOn: true,
      shopifyOrderId: true,
      reason: true,
      evidenceFieldsJson: true,
      // Categories, not just a count: "ready" is coverage of what THIS reason
      // code needs, and four uploads of the wrong thing is not readiness.
      evidenceItems: { select: { category: true } }
    }
  });

  if (disputes.length === 0) {
    return 0;
  }

  const existing = await db.disputeAlert.findMany({
    where: { merchantId },
    select: { disputeId: true, kind: true, thresholdHours: true }
  });

  const alreadySent = new Set(
    existing.flatMap((alert) => [
      `${alert.disputeId}:${alert.kind}`,
      `${alert.disputeId}:${alert.kind}:${alert.thresholdHours ?? ""}`,
      // Either urgency kind at a threshold suppresses the other.
      `${alert.disputeId}:AUTO_SUBMIT_SOON:${alert.thresholdHours ?? ""}`
    ])
  );

  const snapshots = await db.orderSnapshot.findMany({
    where: { merchantId },
    select: { shopifyOrderId: true, orderName: true }
  });
  const orderNames = new Map(snapshots.map((snapshot) => [snapshot.shopifyOrderId, snapshot.orderName]));

  const now = new Date();
  const pending = disputes.flatMap((dispute) =>
    evaluateDisputeAlerts(
      {
        id: dispute.id,
        orderName: dispute.shopifyOrderId ? orderNames.get(dispute.shopifyOrderId) ?? null : null,
        amount: dispute.amount?.toString() ?? null,
        currencyCode: dispute.currencyCode,
        evidenceDueBy: dispute.evidenceDueBy,
        evidenceSentOn: dispute.evidenceSentOn,
        status: dispute.status,
        hasEvidence: dispute.evidenceItems.length > 0 || Boolean(dispute.evidenceFieldsJson),
        // Suppresses reminders. A merchant whose response already meets the bar
        // does not need chasing, and chasing them is how the next email gets
        // ignored.
        responseReady:
          resolveStage({
            status: dispute.status,
            evidenceSentOn: dispute.evidenceSentOn?.toISOString() ?? null,
            completenessScore: reasonAwareScore(
              dispute.reason,
              new Set(dispute.evidenceItems.map((item) => item.category))
            ),
            hasEvidence: dispute.evidenceItems.length > 0 || Boolean(dispute.evidenceFieldsJson)
          }) === "READY"
      },
      now,
      alreadySent
    )
  );

  const recorded = await recordAlerts(merchantId, pending);

  if (recorded > 0) {
    const delivery = await deliverAlerts(shopDomain, pending);
    if (delivery.delivered) {
      await db.disputeAlert.updateMany({
        where: { merchantId, disputeId: { in: pending.map((alert) => alert.disputeId) }, deliveredAt: null },
        data: { deliveredAt: new Date() }
      });
    }
  }

  return recorded;
}

export async function sweepMerchant(shopDomain: string, merchantId: string): Promise<SweepResult> {
  let synced: number | null = null;
  let error: string | null = null;

  try {
    const result = await runDisputeSyncWithRetry(shopDomain);
    synced = result.synced;
  } catch (syncError) {
    error = syncError instanceof Error ? syncError.message : "Sync failed.";
  }

  // Alerts are evaluated even when the sync failed - stale data still has real
  // deadlines, and going quiet is the exact failure this feature exists to stop.
  let alerts = 0;
  try {
    alerts = await evaluateAlertsForMerchant(merchantId, shopDomain);
  } catch (alertError) {
    error = error ?? (alertError instanceof Error ? alertError.message : "Alert evaluation failed.");
  }

  return { shopDomain, synced, alerts, error };
}

export async function sweepAllMerchants(): Promise<SweepResult[]> {
  const merchants = await db.merchant.findMany({
    where: { uninstalledAt: null, accessTokenEncrypted: { not: null } },
    select: { id: true, shopDomain: true }
  });

  const results: SweepResult[] = [];
  for (const merchant of merchants) {
    results.push(await sweepMerchant(merchant.shopDomain, merchant.id));
  }

  return results;
}

/** Fires a sync when a merchant opens the app and their data has gone stale. */
export async function syncIfStale(shopDomain: string) {
  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    select: { id: true, syncRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { startedAt: true } } }
  });

  if (!merchant) {
    return { ran: false as const, reason: "not installed" };
  }

  const lastRun = merchant.syncRuns[0]?.startedAt;
  if (lastRun && Date.now() - lastRun.getTime() < STALE_AFTER_MS) {
    return { ran: false as const, reason: "fresh" };
  }

  const result = await sweepMerchant(shopDomain, merchant.id);
  return { ran: true as const, result };
}

/**
 * Runs a sync inline the first time a merchant ever opens the app.
 *
 * Every other refresh happens in `after()`, off the response path. This one
 * case is different: a freshly installed merchant with real disputes would see
 * an empty queue and conclude the app does not work. It runs at most once per
 * install, because after it there is always a SyncRun row.
 */
export async function syncIfNeverSynced(shopDomain: string) {
  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    select: { id: true, _count: { select: { syncRuns: true } } }
  });

  if (!merchant || merchant._count.syncRuns > 0) {
    return { ran: false as const, reason: "already synced" };
  }

  const result = await sweepMerchant(shopDomain, merchant.id);
  return { ran: true as const, result };
}
