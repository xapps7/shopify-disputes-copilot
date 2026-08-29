import { db } from "@/lib/db";
import { deliverAlerts, evaluateDisputeAlerts, recordAlerts } from "@/lib/disputes/alerts";
import { resolveStage } from "@/lib/disputes/lifecycle";
import { refreshAccountHealth } from "@/lib/economics/health-cache";
import { buildChecklist } from "@/lib/disputes/repository";
import { runDisputeSyncWithRetry } from "@/lib/disputes/sync-runs";
import {
  ALERT_PHASE_BUDGET_MS,
  ALERT_START_RESERVE_MS,
  MERCHANT_ALERT_DEADLINE_MS,
  MERCHANT_SYNC_DEADLINE_MS,
  SWEEP_CONCURRENCY,
  SYNC_PHASE_BUDGET_MS,
  SYNC_START_RESERVE_MS,
  canStartWithin,
  orderByStaleness,
  runWithConcurrency,
  withDeadline,
  type SweepCandidate,
  type SweepResult
} from "@/lib/disputes/sweep-plan";

/**
 * Unattended sync.
 *
 * Ingestion used to happen only when a human pressed a button, which is the
 * whole problem: the merchant who most needs this app is the one who is not
 * looking. This sweeps every installed merchant, then evaluates deadline alerts.
 *
 * The database and Shopify live here. Which merchants get swept, in what order,
 * and when the sweep has to stop lives in `lib/disputes/sweep-plan.ts`, which is
 * pure so those decisions can be tested without either.
 */

/** How stale a merchant's data may get before an opportunistic sync fires. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

// Re-exported so callers keep importing the sweep's result shape from the sweep.
// It is declared in sweep-plan.ts because that module has to count outcomes and
// must not reach into anything that touches the database.
export type { SweepResult } from "@/lib/disputes/sweep-plan";

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
      initiatedAt: true,
      createdAt: true,
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
        // Shopify's own initiation time when we have it, else when we first saw
        // it. Used only to avoid announcing old disputes as new.
        openedAt: dispute.initiatedAt ?? dispute.createdAt,
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

/**
 * Evaluates one merchant's alerts and never throws.
 *
 * A single merchant's alert failure must not take the sweep down with it, and
 * the deadline is here because this phase is the last line of defence: if the
 * database is wedged, twenty seconds of waiting on one shop is twenty seconds
 * the shops behind it do not get.
 */
async function evaluateAlertsSafely(
  merchantId: string,
  shopDomain: string
): Promise<{ alerts: number; error: string | null }> {
  try {
    const alerts = await withDeadline(
      evaluateAlertsForMerchant(merchantId, shopDomain),
      MERCHANT_ALERT_DEADLINE_MS,
      "Alert evaluation exceeded its deadline and was abandoned."
    );
    return { alerts, error: null };
  } catch (alertError) {
    return { alerts: 0, error: alertError instanceof Error ? alertError.message : "Alert evaluation failed." };
  }
}

/** Pulls fresh data from Shopify, then evaluates deadline alerts. */
export async function sweepMerchant(shopDomain: string, merchantId: string): Promise<SweepResult> {
  let synced: number | null = null;
  let error: string | null = null;

  try {
    // The deadline covers the health refresh too, because that is another
    // Shopify round trip and it is the total time on the network that has to be
    // bounded, not the sync call on its own.
    synced = await withDeadline(
      (async () => {
        const result = await runDisputeSyncWithRetry(shopDomain);

        // Recompute account health while we are already talking to Shopify. This
        // is what lets Today lead with a ratio without waiting on a network call.
        await refreshAccountHealth(shopDomain);
        return result.synced;
      })(),
      MERCHANT_SYNC_DEADLINE_MS,
      `Sync exceeded ${Math.round(MERCHANT_SYNC_DEADLINE_MS / 1000)}s and was abandoned.`
    );
  } catch (syncError) {
    error = syncError instanceof Error ? syncError.message : "Sync failed.";
  }

  // Alerts are evaluated even when the sync failed - stale data still has real
  // deadlines, and going quiet is the exact failure this feature exists to stop.
  const alerts = await evaluateAlertsSafely(merchantId, shopDomain);

  return {
    shopDomain,
    outcome: "SYNCED",
    synced,
    alerts: alerts.alerts,
    error: error ?? alerts.error
  };
}

/**
 * The half of a sweep that does not need Shopify.
 *
 * Used when the clock has run out. A merchant handled this way keeps a stale
 * dispute list for another hour, which they will barely notice, but still gets
 * told that evidence is due in 24 hours, which is the thing they would have
 * lost money over. Splitting the sweep this way is the whole point of the
 * two-phase design in `sweepAllMerchants`.
 *
 * It also leaves the rotation alone on purpose: this writes no SyncRun row, so
 * a merchant who only got alerts is still the least-recently-synced shop in the
 * fleet and is first in line for a real sync next hour.
 */
export async function sweepMerchantAlertsOnly(shopDomain: string, merchantId: string): Promise<SweepResult> {
  const alerts = await evaluateAlertsSafely(merchantId, shopDomain);

  return {
    shopDomain,
    outcome: "ALERTS_ONLY",
    synced: null,
    alerts: alerts.alerts,
    error: alerts.error
  };
}

async function loadSweepCandidates(): Promise<SweepCandidate[]> {
  // Deliberately NOT filtered on `accessTokenEncrypted`.
  //
  // It used to be, and that was safe until the 401 handler started clearing the
  // stored token to force a re-exchange. From that moment a shop whose token
  // Shopify had rejected dropped out of the sweep entirely - so it stopped
  // getting deadline emails, silently, at exactly the moment its data had also
  // stopped updating. Two failures, one of them invisible.
  //
  // The sync inside `sweepMerchant` will fail for these shops and say so, which
  // is correct. Alerts are evaluated anyway, because deadlines are already in
  // our database and do not need Shopify to be reachable. Going quiet is the
  // precise failure this whole feature exists to prevent.
  const merchants = await db.merchant.findMany({
    where: { uninstalledAt: null },
    select: { id: true, shopDomain: true }
  });

  // Two flat queries rather than a relation with `take: 1` per merchant. That
  // form makes Prisma run a window function over every SyncRun row belonging to
  // the whole fleet - the entire sync history, to read one timestamp each. This
  // aggregate reads one row per merchant and is the shape the
  // [merchantId, type, startedAt] index already serves.
  const lastRuns = await db.syncRun.groupBy({
    by: ["merchantId"],
    _max: { startedAt: true }
  });

  const lastSyncByMerchant = new Map(lastRuns.map((run) => [run.merchantId, run._max.startedAt]));

  return merchants.map((merchant) => ({
    merchantId: merchant.id,
    shopDomain: merchant.shopDomain,
    lastSyncStartedAt: lastSyncByMerchant.get(merchant.id) ?? null
  }));
}

export type SweepOptions = {
  /**
   * When the invocation started, not when the sweep did. The caller shares this
   * clock with everything else it runs, so a slow start is spent out of the
   * sweep's budget instead of pushing the whole request past `maxDuration`.
   */
  startedAt?: number;
  syncBudgetMs?: number;
  alertBudgetMs?: number;
  concurrency?: number;
};

/**
 * Sweeps the whole fleet in two phases, both bounded by the clock.
 *
 * Phase one syncs merchants from Shopify, least-recently-synced first, a few at
 * a time, and stops starting new ones once the budget is nearly spent. Phase
 * two takes everyone phase one did not reach and evaluates their alerts only,
 * which costs queries instead of network calls. Anyone left after that is
 * returned as SKIPPED rather than quietly missing.
 *
 * Every merchant appears in the result exactly once, whatever happened to them.
 * That is the contract the cron route's reporting depends on: a merchant who
 * fell off the end of the run has to be countable, because the previous version
 * of this function returned a short list and a 200 and nothing downstream could
 * tell a truncated hour from a healthy one.
 *
 * The scheduling itself lives in `lib/disputes/sweep-plan.ts`, pure and tested;
 * this function is only the wiring between it and the database.
 */
export async function sweepAllMerchants(options: SweepOptions = {}): Promise<SweepResult[]> {
  const startedAt = options.startedAt ?? Date.now();
  const syncBudgetMs = options.syncBudgetMs ?? SYNC_PHASE_BUDGET_MS;
  const alertBudgetMs = options.alertBudgetMs ?? ALERT_PHASE_BUDGET_MS;
  const concurrency = options.concurrency ?? SWEEP_CONCURRENCY;

  const queue = orderByStaleness(await loadSweepCandidates());

  const syncPhase = await runWithConcurrency(
    queue,
    concurrency,
    (candidate) => sweepMerchant(candidate.shopDomain, candidate.merchantId),
    () => canStartWithin(Date.now() - startedAt, syncBudgetMs, SYNC_START_RESERVE_MS)
  );

  const alertPhase = await runWithConcurrency(
    syncPhase.remaining,
    concurrency,
    (candidate) => sweepMerchantAlertsOnly(candidate.shopDomain, candidate.merchantId),
    () => canStartWithin(Date.now() - startedAt, alertBudgetMs, ALERT_START_RESERVE_MS)
  );

  const skipped: SweepResult[] = alertPhase.remaining.map((candidate) => ({
    shopDomain: candidate.shopDomain,
    outcome: "SKIPPED",
    synced: null,
    alerts: 0,
    error: null
  }));

  if (skipped.length > 0) {
    // Worth a log line even though the route reports it: this is the state where
    // a merchant went a whole hour without their deadlines being checked, and it
    // should be findable in the logs without correlating a cron response.
    console.warn(`[sweep] ${skipped.length} merchants got neither a sync nor an alert check this run`);
  }

  return [...syncPhase.results, ...alertPhase.results, ...skipped];
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
