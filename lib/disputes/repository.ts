import { db } from "@/lib/db";
import { ce30ElementsFromOrder } from "@/lib/compliance/order-projection";
import { decryptString } from "@/lib/crypto";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import {
  CE30_MAX_AGE_DAYS,
  CE30_MIN_AGE_DAYS,
  assessCe30,
  isCondition104,
  type Ce30Candidate,
  type Ce30Elements,
  type Ce30Result
} from "@/lib/disputes/ce30";
import {
  buildEvidenceFieldStates,
  draftEvidenceFields,
  type EvidenceFieldKey
} from "@/lib/disputes/evidence-fields";
import { describeProtect, readProtectFromOrderJson } from "@/lib/disputes/shopify-protect";
import { getReasonProfile, normalizeReasonCode } from "@/lib/disputes/reason-codes";
import { evaluateLock } from "@/lib/disputes/locking";
import { recommendStrategy } from "@/lib/economics/strategy";
import type { WinFactors } from "@/lib/economics/win-probability";
import { getMerchantSettings } from "@/lib/settings";
import { graphqlErrorMessages } from "@/lib/shopify/errors";
import { RECENT_ORDERS_NO_CUSTOMER_QUERY } from "@/lib/shopify/queries";
import type {
  AnalyticsSnapshotView,
  DashboardDispute,
  DisputeOptionView,
  DisputeDetailView,
  EvidenceLibraryItemView,
  OverviewMetricsView,
  PreventionRecommendationView
} from "@/lib/types";

type StoredOrderNode = {
  id?: string | null;
  name?: string | null;
  displayFulfillmentStatus?: string | null;
  currentTotalPriceSet?: {
    shopMoney?: {
      amount?: string | null;
      currencyCode?: string | null;
    } | null;
  } | null;
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null;
  disputes?: Array<{
    id?: string | null;
    status?: string | null;
    initiatedAs?: string | null;
  }> | null;
} | null;

type StoredOrderSnapshot = {
  order?: StoredOrderNode;
} | null;

type StoredOrderSnapshotRecord = {
  orderName?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  orderTotal?: { toString(): string } | string | null;
  currencyCode?: string | null;
  fulfillmentStatus?: string | null;
  orderJson?: string | null;
} | null;

function buildName(firstName?: string | null, lastName?: string | null) {
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return fullName || null;
}

function extractFallbackOrderSummary(sourceSnapshotJson: string | null) {
  if (!sourceSnapshotJson) {
    return null;
  }

  try {
    const snapshot = JSON.parse(sourceSnapshotJson) as StoredOrderSnapshot;
    const order = snapshot?.order;

    if (!order) {
      return null;
    }

    return {
      orderName: order.name ?? null,
      customerName: buildName(order.customer?.firstName, order.customer?.lastName),
      customerEmail: order.customer?.email ?? null,
      orderTotal: order.currentTotalPriceSet?.shopMoney?.amount ?? null,
      currencyCode: order.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
      fulfillmentStatus: order.displayFulfillmentStatus ?? null
    };
  } catch {
    return null;
  }
}

function extractOrderSummaryFromOrderJson(orderJson: string | null) {
  if (!orderJson) {
    return null;
  }

  try {
    const order = JSON.parse(orderJson) as StoredOrderNode;
    if (!order) {
      return null;
    }

    return {
      orderName: order.name ?? null,
      customerName: buildName(order.customer?.firstName, order.customer?.lastName),
      customerEmail: order.customer?.email ?? null,
      orderTotal: order.currentTotalPriceSet?.shopMoney?.amount ?? null,
      currencyCode: order.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
      fulfillmentStatus: order.displayFulfillmentStatus ?? null
    };
  } catch {
    return null;
  }
}

function mergeOrderSummary(
  orderSnapshot: StoredOrderSnapshotRecord | undefined,
  sourceSummary: ReturnType<typeof extractFallbackOrderSummary>
) {
  const orderJsonSummary = extractOrderSummaryFromOrderJson(orderSnapshot?.orderJson ?? null);

  return {
    orderName: orderSnapshot?.orderName ?? orderJsonSummary?.orderName ?? sourceSummary?.orderName ?? null,
    customerName: orderSnapshot?.customerName ?? orderJsonSummary?.customerName ?? sourceSummary?.customerName ?? null,
    customerEmail: orderSnapshot?.customerEmail ?? orderJsonSummary?.customerEmail ?? sourceSummary?.customerEmail ?? null,
    orderTotal:
      (typeof orderSnapshot?.orderTotal === "string"
        ? orderSnapshot.orderTotal
        : orderSnapshot?.orderTotal?.toString?.()) ??
      orderJsonSummary?.orderTotal ??
      sourceSummary?.orderTotal ??
      null,
    currencyCode: orderSnapshot?.currencyCode ?? orderJsonSummary?.currencyCode ?? sourceSummary?.currencyCode ?? null,
    fulfillmentStatus:
      orderSnapshot?.fulfillmentStatus ?? orderJsonSummary?.fulfillmentStatus ?? sourceSummary?.fulfillmentStatus ?? null
  };
}

function hasUsableOrderSummary(summary: ReturnType<typeof mergeOrderSummary>) {
  return Boolean(
    summary.orderTotal ||
    summary.customerEmail ||
    summary.customerName ||
    summary.orderName
  );
}

async function fetchRecentOrderSummaries(
  shopDomain: string,
  accessTokenEncrypted: string
) {
  const client = createShopifyAdminClient({
    storeDomain: shopDomain,
    accessToken: decryptString(accessTokenEncrypted)
  });
  // Deliberately the customer-free query: customer traversal is denied without
  // read_customers, and errors must never be swallowed here (this read path was
  // the last remaining place using the old, silent pattern).
  const response = await client.request(RECENT_ORDERS_NO_CUSTOMER_QUERY);
  const errorMessages = graphqlErrorMessages(response);
  if (errorMessages.length > 0) {
    console.error("[repository] recent order summaries failed:", errorMessages.join(" | "));
  }
  const data = response.data as
    | {
        orders?: {
          nodes?: Array<StoredOrderNode>;
        };
      }
    | undefined;

  return new Map(
    (data?.orders?.nodes ?? [])
      .filter((order): order is NonNullable<typeof order> => Boolean(order?.id))
      .map((order) => [
        order.id as string,
        {
          orderName: order.name ?? null,
          customerName: buildName(order.customer?.firstName, order.customer?.lastName),
          customerEmail: order.customer?.email ?? null,
          orderTotal: order.currentTotalPriceSet?.shopMoney?.amount ?? null,
          currencyCode: order.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
          fulfillmentStatus: order.displayFulfillmentStatus ?? null
        }
      ])
  );
}

export function buildChecklist(rawReason: string | null, categories: Set<string>) {
  // Shopify's enum value is FRAUDULENT, not FRAUD. Comparing against "FRAUD"
  // meant this branch never ran and every fraud dispute got the generic list.
  const reason = normalizeReasonCode(rawReason);

  const required =
    reason === "FRAUDULENT"
      ? [
          {
            label: "Delivery confirmation",
            category: "DELIVERY_CONFIRMATION",
            whyItMatters:
              "Delivery proof helps show that the shipment reached the destination tied to the transaction.",
            howToGet:
              "Pull the carrier delivery scan, proof-of-delivery page, or Shopify fulfillment tracking details for the exact shipment.",
            bestSource: "Carrier tracking page or Shopify fulfillment timeline",
            appSupport: "The app can convert shipment data and uploads into packet-ready delivery evidence."
          },
          {
            label: "Shipping documentation",
            category: "SHIPPING_DOCUMENTATION",
            whyItMatters:
              "Shipment records verify when the order was fulfilled and which address was used for the shipment.",
            howToGet:
              "Export the carrier label, manifest, or fulfillment confirmation showing the recipient address and ship date.",
            bestSource: "Shipping label PDF, carrier receipt, or fulfillment export",
            appSupport: "The app can organize carrier records and explain how they support the reply."
          },
          {
            label: "Customer communication",
            category: "CUSTOMER_COMMUNICATION",
            whyItMatters:
              "Customer messages can show purchase recognition, delivery follow-up, or prior engagement after the order.",
            howToGet:
              "Collect support tickets, order emails, chat transcripts, or delivery follow-up messages connected to the same customer.",
            bestSource: "Helpdesk thread, order confirmation email, or chat transcript",
            appSupport: "The app can summarize the thread and place the strongest excerpts into the packet narrative."
          }
        ]
      : reason === "PRODUCT_NOT_RECEIVED"
        ? [
            {
              label: "Delivery confirmation",
              category: "DELIVERY_CONFIRMATION",
              whyItMatters:
                "Delivery confirmation is the strongest proof that the shipment was completed successfully.",
              howToGet:
                "Download the proof-of-delivery scan or tracking event showing delivered status and timestamp.",
              bestSource: "Carrier proof-of-delivery page",
              appSupport: "The app can surface the delivery proof as the lead evidence in the packet."
            },
            {
              label: "Shipping documentation",
              category: "SHIPPING_DOCUMENTATION",
              whyItMatters:
                "Shipment records establish when the parcel moved through the carrier network and where it was addressed.",
              howToGet:
                "Gather the label, tracking history, and any carrier exception or final-mile notes for the shipment.",
              bestSource: "Carrier tracking history and shipping label",
              appSupport: "The app can combine the tracking sequence with the merchant narrative."
            }
          ]
        : [
            {
              label: "Product proof",
              category: "PRODUCT_PROOF",
              whyItMatters:
                "Product proof shows what was sold and how the item matched the seller's listing or policy disclosure.",
              howToGet:
                "Export the product page, order line item, and any policy or listing screenshot tied to the order.",
              bestSource: "Product admin, storefront capture, or order snapshot",
              appSupport: "The app can turn order and catalog data into packet-ready factual summaries."
            },
            {
              label: "Customer communication",
              category: "CUSTOMER_COMMUNICATION",
              whyItMatters:
                "Customer messages help show expectations, acknowledgement, and merchant support handling.",
              howToGet:
                "Collect support emails, chat threads, and any message where the customer discussed the order or requested help.",
              bestSource: "Helpdesk thread or email conversation",
              appSupport: "The app can summarize the communication and highlight the strongest supporting points."
            }
          ];

  return required.map((item) => ({
    ...item,
    state: (categories.has(item.category) ? "ready" : "missing") as "ready" | "missing"
  }));
}

/**
 * Evidence coverage weighted by what this reason code actually needs, rather
 * than counting uploads. Four screenshots of the wrong thing is not readiness.
 */
function reasonAwareCompleteness(reason: string | null, categories: Set<string>) {
  const checklist = buildChecklist(reason, categories);
  if (checklist.length === 0) {
    return 0;
  }

  const ready = checklist.filter((item) => item.state === "ready").length;
  return Math.round((ready / checklist.length) * 100);
}

/**
 * How many disputes the queue loads at once.
 *
 * The queue filters and sorts on the client, over whatever this returns. At the
 * old value of 100 that was silent: dispute 101 simply did not exist as far as
 * search, filters and sorting were concerned, and nothing on screen said so.
 * A merchant looking for an old case would have concluded the app had lost it.
 *
 * Raised, and the count is now reported so the UI can say when it is showing a
 * slice. A real fix is server-side pagination; this makes the limit honest in
 * the meantime, which is the part that was actually harmful.
 */
export const DISPUTE_QUEUE_LIMIT = 500;

/**
 * The true number of disputes on record, so the queue can say when it is only
 * showing part of them. Counting is cheap; being silently wrong is not.
 */
export async function countDashboardDisputes(shopDomain?: string | null): Promise<number> {
  if (!shopDomain) {
    return 0;
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    select: { id: true }
  });

  if (!merchant) {
    return 0;
  }

  return await db.dispute.count({ where: { merchantId: merchant.id } });
}

export async function listDashboardDisputes(shopDomain?: string | null): Promise<DashboardDispute[]> {
  if (!shopDomain) {
    return [];
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    include: {
      orderSnapshots: true,
      disputes: {
        orderBy: [{ evidenceDueBy: "asc" }, { createdAt: "desc" }],
        include: {
          evidenceItems: true
        },
        take: DISPUTE_QUEUE_LIMIT
      }
    }
  });

  if (!merchant) {
    return [];
  }

  const orderSnapshots = new Map(
    merchant.orderSnapshots.map((snapshot) => [snapshot.shopifyOrderId, snapshot])
  );

  return merchant.disputes.map((dispute) => {
    const orderSnapshot = dispute.shopifyOrderId ? orderSnapshots.get(dispute.shopifyOrderId) : null;
    const fallbackOrderSummary = extractFallbackOrderSummary(dispute.sourceSnapshotJson ?? null);
    let mergedOrderSummary = mergeOrderSummary(orderSnapshot, fallbackOrderSummary);
    const amount =
      dispute.amount?.toString() ??
      mergedOrderSummary.orderTotal ??
      "0.00";
    const currencyCode =
      dispute.currencyCode ??
      mergedOrderSummary.currencyCode ??
      null;

    return {
      id: dispute.id,
      shopifyDisputeId: dispute.shopifyDisputeId,
      shopifyOrderId: dispute.shopifyOrderId ?? null,
      orderName: mergedOrderSummary.orderName ?? null,
      status: dispute.status,
      reason: dispute.reason ?? null,
      amount,
      currencyCode,
      evidenceDueBy: dispute.evidenceDueBy?.toISOString() ?? null,
      evidenceSentOn: dispute.evidenceSentOn?.toISOString() ?? null,
      hasEvidence: dispute.evidenceItems.length > 0 || Boolean(dispute.evidenceFieldsJson),
      // Coverage of the categories this reason code actually needs - the old
      // score was evidenceItems.length * 25, so four irrelevant uploads read
      // as fully ready.
      completenessScore: reasonAwareCompleteness(
        dispute.reason,
        new Set(dispute.evidenceItems.map((item) => item.category))
      )
    };
  });
}

/** Metrics derived from an already-fetched list, so callers can avoid a second query. */
export function deriveOverviewMetrics(disputes: DashboardDispute[]): OverviewMetricsView {
  return buildOverviewMetrics(disputes);
}

function buildOverviewMetrics(disputes: DashboardDispute[]): OverviewMetricsView {
  return {
    openDisputes: disputes.filter((dispute) =>
      ["NEEDS_RESPONSE", "UNDER_REVIEW", "WARNING_NEEDS_RESPONSE"].includes(dispute.status)
    ).length,
    dueSoon: disputes.filter((dispute) => {
      if (!dispute.evidenceDueBy) return false;
      const delta = Math.ceil((new Date(dispute.evidenceDueBy).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return delta <= 2;
    }).length,
    totalAmount: disputes.reduce((sum, dispute) => sum + Number(dispute.amount), 0),
    evidenceReady: disputes.filter((dispute) => dispute.completenessScore >= 75).length
  };
}

export async function getOverviewMetrics(shopDomain?: string | null): Promise<OverviewMetricsView> {
  return buildOverviewMetrics(await listDashboardDisputes(shopDomain));
}

export async function listEvidenceLibrary(shopDomain?: string | null): Promise<EvidenceLibraryItemView[]> {
  if (!shopDomain) {
    return [];
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    include: {
      disputes: {
        include: {
          evidenceItems: {
            orderBy: { createdAt: "desc" }
          }
        }
      }
    }
  });

  if (!merchant) {
    return [];
  }

  return merchant.disputes.flatMap((dispute) =>
    dispute.evidenceItems.map((item) => ({
      id: item.id,
      disputeId: dispute.id,
      disputeReference: dispute.shopifyDisputeId.split("/").pop() ?? dispute.id,
      title: item.title,
      category: item.category,
      sourceType: item.sourceType,
      description: item.description ?? null,
      fileUrl: item.fileUrl ?? null,
      createdAt: item.createdAt.toISOString()
    }))
  );
}

export async function getAnalyticsSnapshot(shopDomain?: string | null): Promise<AnalyticsSnapshotView> {
  const disputes = await listDashboardDisputes(shopDomain);

  return {
    openCount: disputes.filter((item) => ["NEEDS_RESPONSE", "UNDER_REVIEW", "WARNING_NEEDS_RESPONSE"].includes(item.status)).length,
    wonCount: disputes.filter((item) => item.status === "WON").length,
    lostCount: disputes.filter((item) => item.status === "LOST").length,
    acceptedCount: disputes.filter((item) => item.status === "ACCEPTED").length,
    dueSoonCount: disputes.filter((item) => {
      if (!item.evidenceDueBy) return false;
      const delta = Math.ceil((new Date(item.evidenceDueBy).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return delta <= 2;
    }).length,
    fraudCount: disputes.filter((item) => normalizeReasonCode(item.reason) === "FRAUDULENT").length,
    productNotReceivedCount: disputes.filter((item) => normalizeReasonCode(item.reason) === "PRODUCT_NOT_RECEIVED")
      .length,
    avgReadiness:
      disputes.length > 0
        ? Math.round(disputes.reduce((sum, dispute) => sum + dispute.completenessScore, 0) / disputes.length)
        : 0
  };
}

export async function listRecommendations(shopDomain?: string | null): Promise<PreventionRecommendationView[]> {
  if (!shopDomain) {
    return [];
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    include: {
      recommendations: {
        orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
        take: 24
      }
    }
  });

  if (!merchant) {
    return [];
  }

  return merchant.recommendations.map((item) => ({
    id: item.id,
    category: item.category,
    recommendationText: item.recommendationText,
    priority: item.priority,
    state: item.state
  }));
}

export async function listDisputeOptions(shopDomain?: string | null): Promise<DisputeOptionView[]> {
  const disputes = await listDashboardDisputes(shopDomain);

  return disputes.map((dispute) => ({
    id: dispute.id,
    label: `${dispute.shopifyDisputeId.split("/").pop()} · ${dispute.currencyCode ?? "USD"} ${dispute.amount}`
  }));
}

/**
 * How many of one buyer's orders to load when assessing CE 3.0.
 *
 * Visa needs two priors, so this is not about finding more of them - it is a
 * ceiling on a query keyed by a single email address. A wholesale buyer with
 * hundreds of orders should not turn one dispute page into an unbounded read.
 */
const CE30_HISTORY_LIMIT = 200;

function parseOrderJson(raw: string | null | undefined): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** First non-null wins, element by element. */
function mergeCe30Elements(preferred: Ce30Elements, fallback: Ce30Elements): Ce30Elements {
  return {
    customerEmail: preferred.customerEmail ?? fallback.customerEmail,
    ip: preferred.ip ?? fallback.ip,
    deviceId: preferred.deviceId ?? fallback.deviceId,
    shippingAddressHash: preferred.shippingAddressHash ?? fallback.shippingAddressHash,
    userId: preferred.userId ?? fallback.userId
  };
}

/**
 * Visa Compelling Evidence 3.0 for one dispute, or null when the rule does not
 * apply to it.
 *
 * WHY THE GATE IS `isCondition104` AND NOTHING ELSE: CE 3.0 is a Visa-only
 * remedy for one condition code. `Dispute.reasonDetails` holds
 * `reasonDetails.networkReasonCode` when Shopify sends one and falls back to the
 * dispute type otherwise, so it can legitimately read "CHARGEBACK" - and the
 * reason enum cannot rescue that, because Shopify's `FRAUDULENT` covers Visa
 * 10.4 and Mastercard 4837 alike. Deriving 10.4 from the enum would put a Visa
 * checklist on Mastercard disputes it can never apply to. So the card appears
 * only where the network itself told us the condition code, and nowhere else.
 *
 * The consequence is worth stating: on a shop where Shopify sends no network
 * code, this returns null and the merchant is never offered CE 3.0. That is the
 * right way round. `assessCe30` writes a careful blocker for a missing code, but
 * showing it would mean putting a Visa-specific verdict on disputes we cannot
 * confirm are Visa's.
 */
async function assessCe30ForDispute(input: {
  merchantId: string;
  conditionCode: string | null;
  initiatedAt: Date | null;
  shopifyOrderId: string | null;
  /** The full dispute payload's order, which still carries the shipping address. */
  disputedOrderNode: unknown;
  /** The projected snapshot for the disputed order, which carries the hashes. */
  storedOrderJson: string | null;
  /** The best email the detail view resolved, used when the payloads have none. */
  customerEmail: string | null;
}): Promise<Ce30Result | null> {
  if (!isCondition104(input.conditionCode)) {
    return null;
  }

  const fromPayload = ce30ElementsFromOrder(input.disputedOrderNode);
  const fromSnapshot = ce30ElementsFromOrder(parseOrderJson(input.storedOrderJson));
  const disputedElements = mergeCe30Elements(fromPayload, fromSnapshot);
  const customerEmail = disputedElements.customerEmail ?? input.customerEmail;

  const disputedTransaction = {
    ...disputedElements,
    customerEmail,
    orderId: input.shopifyOrderId,
    merchantId: input.merchantId
  };

  const history: Ce30Candidate[] = [];
  let undatedPriors = 0;

  if (customerEmail) {
    // Matched in SQL on the buyer, bounded by a row limit, and NOT bounded by
    // date. There is no order-date column to filter on: `OrderSnapshot.createdAt`
    // is when this app first synced the order, which for a backfilled shop is
    // "last Tuesday" for every order it has. Filtering on it would drop every
    // genuine prior. The real order date lives inside the projected orderJson,
    // so the 120-365 day window is applied by `assessCe30` below.
    //
    // Case-insensitive because the same buyer reaches Shopify as Buyer@x.com and
    // buyer@x.com, and `assessCe30` lowercases both sides anyway - matching
    // case-sensitively here would lose the prior before the rules ever saw it.
    const rows = await db.orderSnapshot.findMany({
      where: {
        merchantId: input.merchantId,
        customerEmail: { equals: customerEmail, mode: "insensitive" }
      },
      select: {
        shopifyOrderId: true,
        orderName: true,
        customerEmail: true,
        orderJson: true
      },
      orderBy: { createdAt: "desc" },
      take: CE30_HISTORY_LIMIT
    });

    // Visa disqualifies a prior that was itself disputed. The app's own dispute
    // rows are the only fraud history it has - an issuer fraud report that never
    // became a chargeback is invisible to us, which `assessCe30` says out loud
    // as a caveat rather than us pretending the check is complete.
    const disputedOrderIds =
      rows.length > 0
        ? new Set(
            (
              await db.dispute.findMany({
                where: {
                  merchantId: input.merchantId,
                  shopifyOrderId: { in: rows.map((row) => row.shopifyOrderId) }
                },
                select: { shopifyOrderId: true }
              })
            )
              .map((row) => row.shopifyOrderId)
              .filter((orderId): orderId is string => Boolean(orderId))
          )
        : new Set<string>();

    for (const row of rows) {
      const stored = parseOrderJson(row.orderJson);
      const orderDate = ((): string | null => {
        const record = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : null;
        const value = record?.createdAt;
        return typeof value === "string" && value.trim().length > 0 ? value : null;
      })();

      // No order date, no candidate. The row's own createdAt is NOT a substitute:
      // it would date a two-year-old order to the day we synced it and file a
      // real prior under "too recent", which reads to the merchant as a fact
      // about their order instead of a gap in ours. Counted so the card can say
      // how many were skipped.
      if (!orderDate) {
        undatedPriors += 1;
        continue;
      }

      history.push({
        ...ce30ElementsFromOrder(stored),
        // The column, not the payload: it is what the query matched on, and the
        // projection drops customer email for orders synced without protected
        // customer data approval while the column still holds it.
        customerEmail: row.customerEmail ?? null,
        orderId: row.shopifyOrderId,
        orderName: row.orderName ?? row.shopifyOrderId.split("/").pop() ?? row.shopifyOrderId,
        processedAt: orderDate,
        hadDispute: disputedOrderIds.has(row.shopifyOrderId),
        merchantId: input.merchantId
      });
    }
  }

  const result = assessCe30(
    {
      conditionCode: input.conditionCode,
      // Empty string rather than a substituted date. `assessCe30` reports an
      // unreadable dispute date as a blocker; guessing one from createdAt would
      // silently shift the whole 120-365 day window.
      disputeDate: input.initiatedAt?.toISOString() ?? "",
      disputedTransaction
    },
    history
  );

  if (undatedPriors > 0) {
    // Appended here rather than inside the rules module: this is a limit of what
    // this app stored, not of Visa's criteria, and it is exactly what a caveat
    // is for. Without it the orders simply vanish from the count.
    result.caveats.push(
      `${undatedPriors} earlier ${undatedPriors === 1 ? "order was" : "orders were"} skipped because no order date was stored for ${undatedPriors === 1 ? "it" : "them"}, so ${undatedPriors === 1 ? "it" : "they"} could not be placed in Visa's ${CE30_MIN_AGE_DAYS}-${CE30_MAX_AGE_DAYS} day window. Re-syncing the shop stores the order date.`
    );
  }

  return result;
}

export async function getDisputeDetail(id: string, merchantId?: string): Promise<DisputeDetailView> {
  // merchantId is required for anything reached from a request. It is optional
  // only for internal callers that already resolved ownership.
  const dispute = await db.dispute.findFirst({
    where: merchantId ? { id, merchantId } : { id },
    include: {
      evidenceItems: {
        orderBy: { createdAt: "asc" }
      },
      timelineEvents: {
        orderBy: { eventTimestamp: "asc" }
      },
      packets: {
        orderBy: { version: "desc" },
        take: 1
      },
      merchant: {
        include: {
          recommendations: {
            where: {
              disputeId: id
            },
            orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
            take: 6
          }
        }
      }
    }
  });

  if (!dispute) {
    // The `local-` sample fallback used to live here. It rendered fabricated
    // disputes, evidence and packets to a signed-in merchant, which is worse
    // than an error because it looks real. Development can seed the database.
    throw new Error("Dispute not found.");
  }

  const orderSnapshot = dispute.shopifyOrderId
    ? await db.orderSnapshot.findUnique({
        where: { shopifyOrderId: dispute.shopifyOrderId }
      })
    : null;
  const fallbackOrderSummary = extractFallbackOrderSummary(dispute.sourceSnapshotJson ?? null);
  let mergedOrderSummary = mergeOrderSummary(orderSnapshot, fallbackOrderSummary);

  if (!hasUsableOrderSummary(mergedOrderSummary) && dispute.shopifyOrderId) {
    const merchant = await db.merchant.findUnique({
      where: { id: dispute.merchantId },
      select: {
        shopDomain: true,
        accessTokenEncrypted: true
      }
    });

    if (merchant?.accessTokenEncrypted) {
    const recentOrderSummaries = await fetchRecentOrderSummaries(
      merchant.shopDomain,
      merchant.accessTokenEncrypted
    );
    const liveOrderSummary = recentOrderSummaries.get(dispute.shopifyOrderId);
    if (liveOrderSummary) {
      mergedOrderSummary = {
        ...mergedOrderSummary,
        ...liveOrderSummary
      };
    }
    }
  }
  const evidenceCategories = new Set(dispute.evidenceItems.map((item) => item.category));

  // Shopify's evidence form, assembled: generated drafts for everything the app
  // can infer, with any merchant edits layered on top. This is what turns the
  // response from a blank form into something to review and copy.
  const settings = await getMerchantSettings(dispute.merchant.shopDomain);
  const savedFields = ((): Partial<Record<EvidenceFieldKey, string>> => {
    if (!dispute.evidenceFieldsJson) {
      return {};
    }
    try {
      const parsed = JSON.parse(dispute.evidenceFieldsJson);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  })();

  const orderNode = (() => {
    if (!dispute.sourceSnapshotJson) {
      return null;
    }
    try {
      const parsed = JSON.parse(dispute.sourceSnapshotJson) as { order?: Record<string, any> | null };
      return parsed?.order ?? null;
    } catch {
      return null;
    }
  })();

  const addressParts = [
    orderNode?.shippingAddress?.address1,
    orderNode?.shippingAddress?.address2,
    orderNode?.shippingAddress?.city,
    orderNode?.shippingAddress?.provinceCode ?? orderNode?.shippingAddress?.province,
    orderNode?.shippingAddress?.zip,
    orderNode?.shippingAddress?.countryCodeV2 ?? orderNode?.shippingAddress?.country
  ].filter(Boolean);

  const trackingSummaries: string[] = (orderNode?.fulfillments ?? [])
    .flatMap((fulfillment: any) => fulfillment?.trackingInfo ?? [])
    .map((info: any) => [info?.company, info?.number].filter(Boolean).join(" "))
    .filter(Boolean);

  const lineItemSummaries: string[] = (orderNode?.lineItems?.nodes ?? [])
    .map((item: any) => [item?.name, item?.quantity ? `x${item.quantity}` : null].filter(Boolean).join(" "))
    .filter(Boolean);

  const reasonProfile = getReasonProfile(dispute.reason);
  const evidenceFields = buildEvidenceFieldStates(
    reasonProfile.priorityFields,
    savedFields,
    draftEvidenceFields({
      reasonLabel: reasonProfile.label,
      reasonQuestion: reasonProfile.theQuestion,
      orderName: mergedOrderSummary?.orderName ?? null,
      orderTotal: mergedOrderSummary?.orderTotal ?? null,
      currencyCode: mergedOrderSummary?.currencyCode ?? dispute.currencyCode ?? null,
      customerName: mergedOrderSummary?.customerName ?? null,
      customerEmail: mergedOrderSummary?.customerEmail ?? null,
      shippingAddress: addressParts.length > 0 ? addressParts.join(", ") : null,
      fulfillmentStatus: mergedOrderSummary?.fulfillmentStatus ?? null,
      trackingSummaries,
      lineItemSummaries,
      refundPolicyUrl: settings.refundPolicyUrl,
      returnPolicyUrl: settings.returnPolicyUrl,
      cancellationPolicyUrl: settings.cancellationPolicyUrl,
      supportEmail: settings.supportEmail,
      statementDescriptor: settings.statementDescriptor,
      orderPlacedAt: orderNode?.createdAt ? new Date(orderNode.createdAt).toISOString().slice(0, 10) : null,
      // Written once at shop level. These beat the generated sentence, because
      // a merchant's own words about their own policy are better evidence than
      // a template built from a URL.
      refundPolicyStatement: settings.refundPolicyStatement,
      cancellationPolicyStatement: settings.cancellationPolicyStatement
    })
  );

  // What to actually do about this dispute: the money, the odds, and - crucially
  // - whether fighting even helps, given that a win never improves the ratio.
  const evidenceCategorySet = new Set(dispute.evidenceItems.map((item) => item.category));
  const priorityStates = evidenceFields.filter((field) => field.priority);
  const readyStates = priorityStates.filter((field) => field.status === "ready");

  const winFactors: WinFactors = {
    band: reasonProfile.winnability,
    hasDeliveryConfirmation: evidenceCategorySet.has("DELIVERY_CONFIRMATION"),
    hasTracking: trackingSummaries.length > 0 || evidenceCategorySet.has("SHIPPING_DOCUMENTATION"),
    addressesMatch: null,
    threeDSecure: null,
    evidenceCompleteness: priorityStates.length === 0 ? 0 : readyStates.length / priorityStates.length,
    autoSubmittedOnly: dispute.evidenceItems.length === 0 && Object.keys(savedFields).length === 0,
    digitalGoods: false
  };

  // The merchant's own record for this reason code - the only win-rate data
  // that is actually theirs. Public figures for this do not exist.
  const [observedWins, observedLosses] = await Promise.all([
    db.dispute.count({ where: { merchantId: dispute.merchantId, reason: dispute.reason, status: "WON" } }),
    db.dispute.count({ where: { merchantId: dispute.merchantId, reason: dispute.reason, status: "LOST" } })
  ]);

  const hoursUntilAutoSubmit = dispute.evidenceDueBy
    ? (dispute.evidenceDueBy.getTime() - Date.now()) / 3_600_000
    : null;

  // Shopify Protect status comes from the order, not the dispute. PROTECTED is
  // the only value that means money already came back; every other value -
  // including a null column on a store that has never synced it - leaves the
  // decision untouched.
  // Read from the stored order payload rather than a dedicated column. The sync
  // now selects `order.shopifyProtect`, so it rides along inside orderJson - no
  // migration for the merchant to run, and nothing to keep in step. At 200
  // disputes per merchant the cost of parsing is not measurable.
  const protect = readProtectFromOrderJson(orderSnapshot?.orderJson ?? null);

  const protectSignal = describeProtect(protect);

  // The only remedy that removes the dispute from the fraud ratio as well as
  // returning the money, so it is worth a database read on every Visa 10.4 case.
  // Null - and no query at all - for every other dispute.
  const ce30 = await assessCe30ForDispute({
    merchantId: dispute.merchantId,
    conditionCode: dispute.reasonDetails ?? null,
    initiatedAt: dispute.initiatedAt ?? null,
    shopifyOrderId: dispute.shopifyOrderId ?? null,
    disputedOrderNode: orderNode,
    storedOrderJson: orderSnapshot?.orderJson ?? null,
    customerEmail: mergedOrderSummary.customerEmail
  });

  const strategy = recommendStrategy({
    disputeType: dispute.disputeType?.toUpperCase() === "INQUIRY" ? "INQUIRY" : "CHARGEBACK",
    status: dispute.status,
    amount: Number(dispute.amount?.toString() ?? "0"),
    currencyCode: dispute.currencyCode,
    hoursUntilAutoSubmit,
    factors: winFactors,
    observed: { wins: observedWins, losses: observedLosses },
    reimbursedByShopifyProtect: protect.status === "PROTECTED"
  });

  return {
    id: dispute.id,
    shopifyDisputeId: dispute.shopifyDisputeId,
    shopifyOrderId: dispute.shopifyOrderId ?? null,
    status: dispute.status,
    reason: dispute.reason ?? null,
    reasonDetails: dispute.reasonDetails ?? null,
    amount:
      dispute.amount?.toString() ??
      mergedOrderSummary.orderTotal ??
      "0.00",
    currencyCode:
      dispute.currencyCode ??
      mergedOrderSummary.currencyCode ??
      null,
    evidenceDueBy: dispute.evidenceDueBy?.toISOString() ?? null,
    evidenceSentOn: dispute.evidenceSentOn?.toISOString() ?? null,
    orderSummary: hasUsableOrderSummary(mergedOrderSummary)
      ? mergedOrderSummary
      : null,
    evidenceChecklist: buildChecklist(dispute.reason ?? null, evidenceCategories),
    latestPacket: dispute.packets[0]
      ? {
          version: dispute.packets[0].version,
          status: dispute.packets[0].status,
          generatedAt: dispute.packets[0].generatedAt?.toISOString() ?? null,
          pdfUrl: dispute.packets[0].pdfUrl ?? null,
          summaryText: dispute.packets[0].summaryText ?? null,
          submittedAt: dispute.packets[0].submittedAt?.toISOString() ?? null
        }
      : null,
    strategy,
    // Null rather than a "nothing to report" object: the caller renders nothing,
    // and Protect is silent for every merchant outside the US.
    protect: protectSignal.show ? protectSignal : null,
    ce30,
    lock: evaluateLock({
      status: dispute.status,
      evidenceSentOn: dispute.evidenceSentOn,
      evidenceDueBy: dispute.evidenceDueBy
    }),
    evidenceItems: dispute.evidenceItems.map((item) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      description: item.description ?? null,
      sourceType: item.sourceType,
      fileUrl: item.fileUrl ?? null,
      fileMimeType: item.fileMimeType ?? null,
      fileSizeBytes: item.fileSizeBytes ?? null
    })),
    evidenceFields,
    standingDocuments: settings.standingDocuments,
    timeline: dispute.timelineEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      eventTimestamp: event.eventTimestamp.toISOString(),
      source: event.source
    })),
    recommendations: dispute.merchant.recommendations.map((item) => ({
      id: item.id,
      category: item.category,
      recommendationText: item.recommendationText,
      priority: item.priority,
      state: item.state
    }))
  };
}
