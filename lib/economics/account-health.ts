import { db } from "@/lib/db";
import { decryptString } from "@/lib/crypto";
import { assessEcm, assessVamp, protectedButStillCounted, type RatioAssessment } from "@/lib/economics/ratios";
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

  return {
    periodLabel: now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    monthElapsed: elapsed,
    ordersThisMonth,
    ordersPriorMonth,
    disputesThisMonth: startedThisMonth.length,
    vamp,
    ecm,
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
