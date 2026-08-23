import { db } from "@/lib/db";
import { buildChecklist } from "@/lib/disputes/repository";
import {
  countByStage,
  needsMerchant,
  rankForAttention,
  resolveStage,
  type DisputeStage,
  type StageCount
} from "@/lib/disputes/lifecycle";
import { getReasonProfile } from "@/lib/disputes/reason-codes";
import { isLostCoverage, readProtectFromOrderJson } from "@/lib/disputes/shopify-protect";
import { peekAccountHealth } from "@/lib/economics/health-cache";
import type { RatioAssessment } from "@/lib/economics/ratios";
import { recommendStrategy, summarisePortfolio, type StrategyRecommendation } from "@/lib/economics/strategy";
import type { WinFactors } from "@/lib/economics/win-probability";

/**
 * Everything the Today screen shows - and deliberately nothing the dispute
 * queue already shows.
 *
 * Today used to render the first eight rows of the queue above a strip of
 * counts, which is why it was indistinguishable from Disputes: every figure on
 * it could be counted off the table underneath. Stephen Few's test for whether a
 * summary earns its place is whether it CONSOLIDATES - brings together what is
 * otherwise scattered. A count of rows sitting above those rows consolidates
 * nothing.
 *
 * So this builds the three things the queue structurally cannot show:
 *
 *   1. What is realistically recoverable, as opposed to what is at stake. The
 *      queue shows an amount per dispute; it cannot show that half of it is not
 *      worth chasing.
 *   2. Net recovery rate - money actually returned over money ever disputed,
 *      including the disputes nobody contested. The industry quotes win rate,
 *      which counts only the cases you chose to fight and so flatters everyone.
 *   3. Where the work is piling up, by stage.
 *
 * Plus the one thing a list is bad at: singling out the case to do next.
 */

const RECENT_WINDOW_DAYS = 7;
const WON_STATUSES = new Set(["WON"]);
const LOST_STATUSES = new Set(["LOST", "ACCEPTED", "CHARGE_REFUNDED"]);

export type TodayNextAction = {
  id: string;
  orderName: string | null;
  shopifyOrderId: string | null;
  amount: string;
  currencyCode: string | null;
  reasonLabel: string;
  /** The question this reason code actually asks, from the reason profile. */
  theQuestion: string;
  stage: DisputeStage;
  evidenceDueBy: string | null;
  completenessScore: number;
  strategy: StrategyRecommendation;
  /**
   * The specific fields that would move this case, worst gap first - not a
   * percentage. Stripe's `recommended_evidence` does this and it is the single
   * best pattern in the category: "add a tracking number" is actionable in a way
   * that "40% complete" never is.
   */
  missingEvidence: string[];
};

export type TodayChange = {
  kind: "opened" | "decided";
  id: string;
  label: string;
  detail: string;
};

export type PortfolioTotals = {
  currencyCode: string;
  atRisk: number;
  recoverable: number;
  count: number;
  worthFighting: number;
};

export type NetRecovery = {
  /** Disputes with a final outcome. Below ~10 this is noise, not a rate. */
  decidedCount: number;
  wonCount: number;
  /** Money returned over money ever disputed, as a fraction. Null when too few. */
  rate: number | null;
  recoveredTotals: Array<{ currencyCode: string; amount: number }>;
  disputedTotals: Array<{ currencyCode: string; amount: number }>;
};

export type TodayView = {
  shopDomain: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  totalTracked: number;
  /** Open disputes still waiting on the merchant. The real to-do count. */
  awaitingYou: number;
  /**
   * Disputes opened this calendar month. The numerator of the VAMP/ECM ratio.
   * The denominator is an order count that only Shopify can answer, so the
   * ratio itself stays on Account health rather than making Today wait on a
   * network call that can fail.
   */
  disputesThisMonth: number;
  /**
   * Orders that HAD Shopify Protect coverage and lost it. Not the same as
   * "ineligible" - most orders are ineligible and always were. Zero is the
   * normal reading, and the surface stays silent on zero.
   */
  lostCoverageCount: number;
  /**
   * The nearest real consequence to the merchant's card processing, or null.
   *
   * Read from cache and never computed here: it needs order counts only Shopify
   * can give, and Today's job is to be the fast answer. A cold cache shows the
   * dispute count instead, which is honest and still useful.
   */
  health: RatioAssessment | null;
  nextAction: TodayNextAction | null;
  stages: StageCount[];
  portfolio: PortfolioTotals[];
  netRecovery: NetRecovery;
  changes: TodayChange[];
  nextDeadline: { id: string; orderLabel: string; evidenceDueBy: string } | null;
};

function emptyView(shopDomain: string | null): TodayView {
  return {
    shopDomain,
    lastSyncedAt: null,
    lastSyncError: null,
    totalTracked: 0,
    awaitingYou: 0,
    disputesThisMonth: 0,
    lostCoverageCount: 0,
    health: null,
    nextAction: null,
    stages: countByStage([]),
    portfolio: [],
    netRecovery: { decidedCount: 0, wonCount: 0, rate: null, recoveredTotals: [], disputedTotals: [] },
    changes: [],
    nextDeadline: null
  };
}

/** Reason-aware coverage, the same calculation the queue badge uses. */
function completeness(reason: string | null, categories: Set<string>) {
  const checklist = buildChecklist(reason, categories);
  if (checklist.length === 0) {
    return { score: 0, missing: [] as string[] };
  }

  const ready = checklist.filter((item) => item.state === "ready");
  return {
    score: Math.round((ready.length / checklist.length) * 100),
    missing: checklist.filter((item) => item.state !== "ready").map((item) => item.label)
  };
}

function sumInto(map: Map<string, number>, currencyCode: string | null, amount: number) {
  const key = currencyCode ?? "USD";
  map.set(key, (map.get(key) ?? 0) + amount);
}

function toTotals(map: Map<string, number>) {
  return [...map.entries()]
    .map(([currencyCode, amount]) => ({ currencyCode, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export async function getTodayView(shopDomain?: string | null): Promise<TodayView> {
  if (!shopDomain) {
    return emptyView(null);
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    include: {
      orderSnapshots: true,
      disputes: {
        orderBy: [{ evidenceDueBy: "asc" }, { createdAt: "desc" }],
        include: { evidenceItems: true },
        take: 200
      },
      syncRuns: {
        where: { type: "DISPUTE_PULL" },
        orderBy: { startedAt: "desc" },
        take: 1
      }
    }
  });

  if (!merchant) {
    return emptyView(shopDomain);
  }

  const orderNames = new Map(
    merchant.orderSnapshots.map((snapshot) => [snapshot.shopifyOrderId, snapshot.orderName])
  );
  const protectByOrder = new Map(
    merchant.orderSnapshots.map((snapshot) => [
      snapshot.shopifyOrderId,
      readProtectFromOrderJson(snapshot.orderJson)
    ])
  );

  const latestSync = merchant.syncRuns[0] ?? null;
  const now = Date.now();
  const recentCutoff = now - RECENT_WINDOW_DAYS * 24 * 3_600_000;
  const monthStart = new Date(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1).getTime();

  const stages: DisputeStage[] = [];
  const openForPortfolio: Array<{
    amount: number;
    currencyCode: string | null;
    recommendation: StrategyRecommendation;
  }> = [];
  const changes: TodayChange[] = [];
  const recoveredByCurrency = new Map<string, number>();
  const disputedByCurrency = new Map<string, number>();

  let decidedCount = 0;
  let wonCount = 0;
  let awaitingYou = 0;
  let disputesThisMonth = 0;
  let lostCoverageCount = 0;
  let best: { rank: number; action: TodayNextAction } | null = null;
  let nextDeadline: TodayView["nextDeadline"] = null;

  for (const dispute of merchant.disputes) {
    const categories = new Set(dispute.evidenceItems.map((item) => item.category));
    const { score, missing } = completeness(dispute.reason, categories);
    const hasEvidence = dispute.evidenceItems.length > 0 || Boolean(dispute.evidenceFieldsJson);

    const stage = resolveStage({
      status: dispute.status,
      evidenceSentOn: dispute.evidenceSentOn?.toISOString() ?? null,
      completenessScore: score,
      hasEvidence
    });
    stages.push(stage);

    const amount = Number(dispute.amount?.toString() ?? "0");
    const orderLabel = (dispute.shopifyOrderId ? orderNames.get(dispute.shopifyOrderId) : null) ?? null;

    // Every dispute ever opened is the denominator for net recovery. Restricting
    // it to contested ones is exactly the flattery this metric exists to avoid.
    sumInto(disputedByCurrency, dispute.currencyCode, amount);

    if (dispute.shopifyOrderId) {
      const protect = protectByOrder.get(dispute.shopifyOrderId);
      if (protect && isLostCoverage(protect.status)) {
        lostCoverageCount += 1;
      }
    }

    const openedAt = (dispute.initiatedAt ?? dispute.createdAt).getTime();
    if (openedAt >= monthStart) {
      disputesThisMonth += 1;
    }

    if (WON_STATUSES.has(dispute.status)) {
      decidedCount += 1;
      wonCount += 1;
      sumInto(recoveredByCurrency, dispute.currencyCode, amount);
    } else if (LOST_STATUSES.has(dispute.status)) {
      decidedCount += 1;
    }

    if (dispute.createdAt.getTime() >= recentCutoff) {
      changes.push({
        kind: "opened",
        id: dispute.id,
        label: orderLabel ?? "An order",
        detail: "opened a dispute"
      });
    }

    if (
      dispute.finalizedOn &&
      dispute.finalizedOn.getTime() >= recentCutoff &&
      (WON_STATUSES.has(dispute.status) || LOST_STATUSES.has(dispute.status))
    ) {
      changes.push({
        kind: "decided",
        id: dispute.id,
        label: orderLabel ?? "An order",
        detail: WON_STATUSES.has(dispute.status) ? "was decided in your favour" : "was decided against you"
      });
    }

    if (stage === "DECIDED") {
      continue;
    }

    if (needsMerchant(stage)) {
      awaitingYou += 1;
    }

    const hoursUntilAutoSubmit = dispute.evidenceDueBy
      ? (dispute.evidenceDueBy.getTime() - now) / 3_600_000
      : null;

    if (dispute.evidenceDueBy && (!nextDeadline || dispute.evidenceDueBy.toISOString() < nextDeadline.evidenceDueBy)) {
      nextDeadline = {
        id: dispute.id,
        orderLabel: orderLabel ?? "an order",
        evidenceDueBy: dispute.evidenceDueBy.toISOString()
      };
    }

    const reasonProfile = getReasonProfile(dispute.reason);

    /**
     * List-level win factors. The dispute detail page builds a richer set from
     * the parsed order, so this is the coarser of the two - but it is built from
     * the SAME reason-aware checklist, so the two never disagree about direction,
     * only about resolution.
     */
    const factors: WinFactors = {
      band: reasonProfile.winnability,
      hasDeliveryConfirmation: categories.has("DELIVERY_CONFIRMATION"),
      hasTracking: categories.has("SHIPPING_DOCUMENTATION") || categories.has("DELIVERY_CONFIRMATION"),
      addressesMatch: null,
      threeDSecure: null,
      evidenceCompleteness: score / 100,
      autoSubmittedOnly: !hasEvidence,
      digitalGoods: false
    };

    const recommendation = recommendStrategy({
      disputeType: dispute.disputeType?.toUpperCase() === "INQUIRY" ? "INQUIRY" : "CHARGEBACK",
      status: dispute.status,
      amount,
      currencyCode: dispute.currencyCode,
      hoursUntilAutoSubmit,
      factors
    });

    openForPortfolio.push({ amount, currencyCode: dispute.currencyCode, recommendation });

    const rank = rankForAttention({ stage, hoursUntilAutoSubmit, amount });
    if (rank !== null && (best === null || rank < best.rank)) {
      best = {
        rank,
        action: {
          id: dispute.id,
          orderName: orderLabel,
          shopifyOrderId: dispute.shopifyOrderId ?? null,
          amount: dispute.amount?.toString() ?? "0.00",
          currencyCode: dispute.currencyCode,
          reasonLabel: reasonProfile.label,
          theQuestion: reasonProfile.theQuestion,
          stage,
          evidenceDueBy: dispute.evidenceDueBy?.toISOString() ?? null,
          completenessScore: score,
          strategy: recommendation,
          missingEvidence: missing.slice(0, 3)
        }
      };
    }
  }

  const disputedTotals = toTotals(disputedByCurrency);
  const recoveredTotals = toTotals(recoveredByCurrency);

  // One rate across currencies would be a lie, so it is computed on the largest
  // currency only and labelled as such by the caller. Below the sample floor it
  // is withheld entirely rather than shown as a confident 0%.
  const primaryCurrency = disputedTotals[0]?.currencyCode ?? null;
  const disputedPrimary = disputedTotals[0]?.amount ?? 0;
  const recoveredPrimary = primaryCurrency
    ? (recoveredTotals.find((total) => total.currencyCode === primaryCurrency)?.amount ?? 0)
    : 0;

  return {
    shopDomain,
    lastSyncedAt: (latestSync?.completedAt ?? latestSync?.startedAt)?.toISOString() ?? null,
    lastSyncError: latestSync?.lastError ?? null,
    totalTracked: merchant.disputes.length,
    awaitingYou,
    disputesThisMonth,
    lostCoverageCount,
    health: peekAccountHealth(shopDomain)?.urgent ?? null,
    nextAction: best?.action ?? null,
    stages: countByStage(stages),
    portfolio: summarisePortfolio(openForPortfolio),
    netRecovery: {
      decidedCount,
      wonCount,
      rate: decidedCount >= 10 && disputedPrimary > 0 ? recoveredPrimary / disputedPrimary : null,
      recoveredTotals,
      disputedTotals
    },
    changes: changes.slice(0, 4),
    nextDeadline
  };
}
