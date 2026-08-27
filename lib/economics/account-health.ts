import { db } from "@/lib/db";
import { decryptString } from "@/lib/crypto";
import { assessEcm, assessVamp, protectedButStillCounted, type RatioAssessment,
  assessMatchRisk,
  assessShopify,
  mostUrgent
} from "@/lib/economics/ratios";
import { recommendProtection, type ProtectionAdvice } from "@/lib/economics/protection";
import { buildDisputeProfitAndLoss, type DisputeProfitAndLoss } from "@/lib/economics/dispute-pl";
import { recommendStrategy } from "@/lib/economics/strategy";
import { getReasonProfile } from "@/lib/disputes/reason-codes";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { extractGraphqlErrors } from "@/lib/shopify/errors";
import { ORDERS_COUNT_QUERY } from "@/lib/shopify/queries";

/**
 * The second scoreboard: whether the merchant keeps card processing at all.
 *
 * Winning disputes does not move these ratios - Visa counts a dispute when the
 * chargeback posts, and the only documented exclusions are pre-dispute
 * resolutions and CE3.0-qualified fraud. So this screen answers a different
 * question from the dispute queue, and a merchant can be winning on one
 * scoreboard while losing the business on the other.
 */

export type AccountHealth = {
  periodLabel: string;
  monthElapsed: number;
  ordersThisMonth: number | null;
  ordersPriorMonth: number | null;
  disputesThisMonth: number;
  vamp: RatioAssessment | null;
  ecm: RatioAssessment | null;
  /** Shopify's own 1% over 90 days - the threshold that bites before any network's. */
  shopify: RatioAssessment | null;
  /** The five-year one. Absent when we cannot see enough volume to judge. */
  matchRisk: RatioAssessment | null;
  /** Nearest real consequence, not worst ratio. What the page should lead with. */
  urgent: RatioAssessment | null;
  /** Which protection tool is worth buying at this position, and which is not. */
  protection: ProtectionAdvice | null;
  /**
   * What disputes actually cost in settled cash. Every other figure on this
   * screen is forward-looking; these two are the only backward-looking ones,
   * and they are the first thing a finance owner asks for.
   */
  profitAndLossThisMonth: DisputeProfitAndLoss;
  profitAndLossPriorMonth: DisputeProfitAndLoss;
  caveats: string[];
  protectWarning: string | null;
  recommendations: Array<{ id: string; title: string; detail: string; priority: string; state: string }>;
  portfolio: Array<{ currencyCode: string; atRisk: number; recoverable: number; count: number; worthFighting: number }>;
};

function monthBounds(now: Date) {
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfPriorMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const elapsed =
    (now.getTime() - startOfMonth.getTime()) / (endOfMonth.getTime() - startOfMonth.getTime());

  return { startOfMonth, startOfPriorMonth, elapsed: Math.min(1, Math.max(0, elapsed)) };
}

function shopifyDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function countOrders(
  client: ReturnType<typeof createShopifyAdminClient>,
  query: string
): Promise<{ count: number | null; estimated: boolean }> {
  const response = await client.request(ORDERS_COUNT_QUERY, { variables: { query } });

  if (extractGraphqlErrors(response).length > 0) {
    return { count: null, estimated: false };
  }

  const result = (response.data as { ordersCount?: { count?: number; precision?: string } } | undefined)?.ordersCount;

  if (typeof result?.count !== "number") {
    return { count: null, estimated: false };
  }

  return { count: result.count, estimated: result.precision !== "EXACT" };
}


/** Disputes opened inside a rolling window, by Shopify's own initiation time when we have it. */
function withinDays(when: Date | null | undefined, now: Date, days: number): boolean {
  if (!when) {
    return false;
  }
  return now.getTime() - when.getTime() <= days * 86_400_000;
}

function disputesInWindow(
  disputes: Array<{ initiatedAt: Date | null; createdAt: Date }>,
  now: Date,
  days: number
): number {
  return disputes.filter((dispute) => withinDays(dispute.initiatedAt ?? dispute.createdAt, now, days)).length;
}

export async function getAccountHealth(shopDomain: string | null): Promise<AccountHealth | null> {
  if (!shopDomain) {
    return null;
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    select: { id: true, accessTokenEncrypted: true }
  });

  if (!merchant) {
    return null;
  }

  const now = new Date();
  const { startOfMonth, startOfPriorMonth, elapsed } = monthBounds(now);
  const caveats: string[] = [];

  // --- Denominators, from Shopify ---
  let ordersThisMonth: number | null = null;
  let ordersPriorMonth: number | null = null;

  if (merchant.accessTokenEncrypted) {
    const client = createShopifyAdminClient({
      storeDomain: shopDomain,
      accessToken: decryptString(merchant.accessTokenEncrypted)
    });

    const [current, prior] = await Promise.all([
      countOrders(client, `created_at:>=${shopifyDate(startOfMonth)}`),
      countOrders(
        client,
        `created_at:>=${shopifyDate(startOfPriorMonth)} AND created_at:<${shopifyDate(startOfMonth)}`
      )
    ]);

    ordersThisMonth = current.count;
    ordersPriorMonth = prior.count;

    if (current.estimated || prior.estimated) {
      caveats.push("Shopify returned an approximate order count, so these ratios are approximate too.");
    }
  }

  if (ordersThisMonth === null || ordersPriorMonth === null) {
    caveats.push(
      "Order volume could not be read from Shopify, so the ratios below cannot be calculated. Reconnect the app or check its permissions."
    );
  }

  // --- Numerators, from our own records ---
  const disputes = await db.dispute.findMany({
    where: { merchantId: merchant.id },
    select: {
      id: true,
      status: true,
      reason: true,
      disputeType: true,
      amount: true,
      currencyCode: true,
      evidenceDueBy: true,
      initiatedAt: true,
      finalizedOn: true,
      createdAt: true,
      _count: { select: { evidenceItems: true } }
    }
  });

  const startedThisMonth = disputes.filter((dispute) => {
    const started = dispute.initiatedAt ?? dispute.createdAt;
    return started >= startOfMonth;
  });

  // Inquiries are not counted by the networks - only chargebacks reach the ratio.
  const chargebacksThisMonth = startedThisMonth.filter(
    (dispute) => (dispute.disputeType ?? "").toUpperCase() !== "INQUIRY"
  ).length;

  caveats.push(
    "Visa counts fraud reports (TC40) alongside disputes, and Shopify's API does not expose them. Your real Visa ratio is at least what is shown here, never less."
  );
  caveats.push(
    "This counts the disputes this app has synced. Anything raised before you installed it, or while syncing was interrupted, is not included."
  );

  const vamp =
    ordersThisMonth && ordersThisMonth > 0
      ? assessVamp({
          fraudReports: 0,
          disputes: chargebacksThisMonth,
          settledTransactionsThisMonth: ordersThisMonth,
          monthElapsed: elapsed
        })
      : null;

  const ecm =
    ordersPriorMonth && ordersPriorMonth > 0
      ? assessEcm({
          chargebacksThisMonth,
          capturedPaymentsPriorMonth: ordersPriorMonth,
          monthElapsed: elapsed
        })
      : null;

  /**
   * Shopify's own limit, and the one to lead with. It is a rolling 90 days at
   * 1%, far below anything the networks enforce, and it is what actually costs a
   * merchant money first - reserves held against payouts.
   *
   * Order counts here are monthly, so 90 days is approximated as three months of
   * the current run rate. Stated rather than hidden, because a merchant checking
   * this against Shopify's own figure deserves to know why they differ slightly.
   */
  const disputesLast90 = disputesInWindow(disputes, now, 90);
  const ordersLast90 = ordersThisMonth !== null ? Math.round(ordersThisMonth * 3) : null;

  const disputesPerDay = disputesLast90 / 90;
  const transactionsPerDay = ordersLast90 !== null ? ordersLast90 / 90 : 0;

  const shopify =
    ordersLast90 && ordersLast90 > 0
      ? assessShopify({
          disputesLast90Days: disputesLast90,
          eligibleTransactionsLast90Days: ordersLast90,
          disputesPerDay,
          transactionsPerDay
        })
      : null;

  const matchRisk =
    ordersLast90 && ordersLast90 > 0
      ? assessMatchRisk({
          chargebackCount: disputesLast90,
          chargebackAmount: disputes
            .filter((dispute) => withinDays(dispute.initiatedAt ?? dispute.createdAt, now, 90))
            .reduce((sum, dispute) => sum + Number(dispute.amount?.toString() ?? "0"), 0),
          transactionCount: ordersLast90
        })
      : null;

  const urgent = mostUrgent([shopify, matchRisk, vamp, ecm].filter((entry): entry is RatioAssessment => Boolean(entry)));

  const fraudDisputes = disputes.filter((dispute) =>
    ["FRAUDULENT", "UNRECOGNIZED"].includes((dispute.reason ?? "").toUpperCase())
  ).length;

  const protection =
    urgent && disputes.length > 0
      ? recommendProtection({
          fraudShare: disputes.length > 0 ? fraudDisputes / disputes.length : 0,
          monthlyDisputes: chargebacksThisMonth,
          averageDisputeAmount:
            disputes.length > 0
              ? disputes.reduce((sum, dispute) => sum + Number(dispute.amount?.toString() ?? "0"), 0) / disputes.length
              : 0,
          nearestThresholdDays: urgent.daysUntilBreach,
          status: urgent.status
        })
      : null;

  if (ordersPriorMonth !== null && ordersThisMonth !== null && ordersPriorMonth > ordersThisMonth / Math.max(elapsed, 0.01)) {
    caveats.push(
      "Your sales are lower than last month. Mastercard divides this month's chargebacks by last month's volume, so your ratio worsens even if nothing else changes."
    );
  }

  // --- What the open book is worth ---
  const open = disputes.filter(
    (dispute) => !["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED"].includes(dispute.status)
  );

  const byCurrency = new Map<string, { atRisk: number; recoverable: number; count: number; worthFighting: number }>();

  for (const dispute of open) {
    const profile = getReasonProfile(dispute.reason);
    const recommendation = recommendStrategy({
      disputeType: (dispute.disputeType ?? "").toUpperCase() === "INQUIRY" ? "INQUIRY" : "CHARGEBACK",
      status: dispute.status,
      amount: Number(dispute.amount?.toString() ?? "0"),
      currencyCode: dispute.currencyCode,
      hoursUntilAutoSubmit: dispute.evidenceDueBy
        ? (dispute.evidenceDueBy.getTime() - now.getTime()) / 3_600_000
        : null,
      factors: {
        band: profile.winnability,
        hasDeliveryConfirmation: false,
        hasTracking: dispute._count.evidenceItems > 0,
        addressesMatch: null,
        threeDSecure: null,
        evidenceCompleteness: dispute._count.evidenceItems > 0 ? 0.5 : 0,
        autoSubmittedOnly: dispute._count.evidenceItems === 0,
        digitalGoods: false
      }
    });

    const currency = dispute.currencyCode ?? recommendation.fee.currencyCode;
    const entry = byCurrency.get(currency) ?? { atRisk: 0, recoverable: 0, count: 0, worthFighting: 0 };
    entry.count += 1;
    entry.atRisk += recommendation.amountAtRisk;

    if (recommendation.action !== "ACCEPT" && recommendation.action !== "TOO_LATE") {
      entry.recoverable += Math.max(0, recommendation.expectedValue);
      entry.worthFighting += 1;
    }

    byCurrency.set(currency, entry);
  }

  const recommendations = await db.preventionRecommendation.findMany({
    where: { merchantId: merchant.id },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    take: 8,
    select: { id: true, category: true, recommendationText: true, priority: true, state: true }
  });

  // --- What the settled book actually cost ---
  //
  // Prisma hands back Decimal; the P&L module is deliberately Prisma-free so it
  // can be tested without a database, so the conversion happens here.
  const plRecords = disputes.map((dispute) => ({
    status: dispute.status,
    disputeType: dispute.disputeType,
    amount: Number(dispute.amount?.toString() ?? "0"),
    currencyCode: dispute.currencyCode,
    finalizedOn: dispute.finalizedOn
  }));

  const monthName = (date: Date) =>
    date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const profitAndLossThisMonth = buildDisputeProfitAndLoss(
    plRecords,
    { start: startOfMonth, end: now },
    `${monthName(startOfMonth)} so far`
  );

  const profitAndLossPriorMonth = buildDisputeProfitAndLoss(
    plRecords,
    { start: startOfPriorMonth, end: startOfMonth },
    monthName(startOfPriorMonth)
  );

  return {
    periodLabel: now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    monthElapsed: elapsed,
    ordersThisMonth,
    ordersPriorMonth,
    disputesThisMonth: startedThisMonth.length,
    vamp,
    ecm,
    shopify,
    matchRisk,
    urgent,
    protection,
    profitAndLossThisMonth,
    profitAndLossPriorMonth,
    caveats,
    // We cannot tell from the API which disputes Shopify Protect covered, so
    // this is framed as a standing warning rather than a count we do not have.
    recommendations: recommendations.map((item) => ({
      id: item.id,
      title: item.category,
      detail: item.recommendationText,
      priority: String(item.priority),
      state: item.state
    })),
    protectWarning:
      chargebacksThisMonth > 0
        ? protectedButStillCounted(chargebacksThisMonth)?.replace(
            `${chargebacksThisMonth} of your chargebacks were reimbursed by Shopify Protect. That money came back, but`,
            "If any of these chargebacks were reimbursed by Shopify Protect, that money came back - but"
          ) ?? null
        : null,
    portfolio: [...byCurrency.entries()]
      .map(([currencyCode, totals]) => ({ currencyCode, ...totals }))
      .sort((a, b) => b.atRisk - a.atRisk)
  };
}
