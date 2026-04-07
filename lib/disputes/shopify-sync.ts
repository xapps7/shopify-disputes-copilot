import { db } from "@/lib/db";
import { syncDerivedDisputeState } from "@/lib/disputes/auto-sync";
import { decryptString } from "@/lib/crypto";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { DISPUTES_LIST_QUERY } from "@/lib/shopify/queries";

type ShopifyDisputeNode = {
  id: string;
  amount?: string | null;
  currencyCode?: string | null;
  reason?: string | null;
  reasonDetails?: string | null;
  status?: string | null;
  evidenceDueBy?: string | null;
  evidenceSentOn?: string | null;
  order?: {
    id: string;
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
    lineItems?: {
      nodes: Array<{
        name?: string | null;
        quantity?: number | null;
        sku?: string | null;
      }>;
    } | null;
    fulfillments?: {
      nodes: Array<{
        trackingInfo?: Array<{
          company?: string | null;
          number?: string | null;
          url?: string | null;
        }> | null;
      }>;
    } | null;
  } | null;
};

type DisputesQueryResponse = {
  disputes: {
    nodes: ShopifyDisputeNode[];
  };
};

function normalizeStatus(status?: string | null) {
  switch (status?.toUpperCase()) {
    case "NEEDS_RESPONSE":
    case "UNDER_REVIEW":
    case "WON":
    case "LOST":
    case "ACCEPTED":
    case "CHARGE_REFUNDED":
    case "WARNING_NEEDS_RESPONSE":
      return status.toUpperCase();
    default:
      return "UNKNOWN";
  }
}

function buildCustomerName(customer?: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
} | null) {
  const fullName = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ").trim();
  return fullName || null;
}

async function upsertOrderSnapshot(dispute: ShopifyDisputeNode, merchantId: string) {
  if (!dispute.order) {
    return null;
  }

  return db.orderSnapshot.upsert({
    where: { shopifyOrderId: dispute.order.id },
    update: {
      merchantId,
      orderName: dispute.order.name ?? null,
      customerEmail: dispute.order.customer?.email ?? null,
      customerName: buildCustomerName(dispute.order.customer),
      orderTotal: dispute.order.currentTotalPriceSet?.shopMoney?.amount ?? undefined,
      currencyCode: dispute.order.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
      fulfillmentStatus: dispute.order.displayFulfillmentStatus ?? null,
      orderJson: JSON.stringify(dispute.order)
    },
    create: {
      merchantId,
      shopifyOrderId: dispute.order.id,
      orderName: dispute.order.name ?? null,
      customerEmail: dispute.order.customer?.email ?? null,
      customerName: buildCustomerName(dispute.order.customer),
      orderTotal: dispute.order.currentTotalPriceSet?.shopMoney?.amount ?? undefined,
      currencyCode: dispute.order.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
      fulfillmentStatus: dispute.order.displayFulfillmentStatus ?? null,
      orderJson: JSON.stringify(dispute.order)
    }
  });
}

async function replaceSystemEvidence(disputeId: string, dispute: ShopifyDisputeNode) {
  await db.evidenceItem.deleteMany({
    where: {
      disputeId,
      sourceType: {
        in: ["shopify_order", "shopify_fulfillment"]
      }
    }
  });

  const items: Array<{
    disputeId: string;
    category:
      | "PRODUCT_PROOF"
      | "SHIPPING_DOCUMENTATION"
      | "DELIVERY_CONFIRMATION";
    sourceType: string;
    title: string;
    description: string;
  }> = [];

  const lineItems = dispute.order?.lineItems?.nodes ?? [];
  if (lineItems.length > 0) {
    items.push({
      disputeId,
      category: "PRODUCT_PROOF",
      sourceType: "shopify_order",
      title: "Ordered products summary",
      description: lineItems
        .map((item) => `${item.name ?? "Item"} x${item.quantity ?? 1}${item.sku ? ` (${item.sku})` : ""}`)
        .join(", ")
    });
  }

  const trackingInfo =
    dispute.order?.fulfillments?.nodes.flatMap((fulfillment) => fulfillment.trackingInfo ?? []) ?? [];

  if (trackingInfo.length > 0) {
    items.push({
      disputeId,
      category: "SHIPPING_DOCUMENTATION",
      sourceType: "shopify_fulfillment",
      title: "Shipment tracking records",
      description: trackingInfo
        .map((tracking) => [tracking.company, tracking.number, tracking.url].filter(Boolean).join(" · "))
        .join("; ")
    });

    items.push({
      disputeId,
      category: "DELIVERY_CONFIRMATION",
      sourceType: "shopify_fulfillment",
      title: "Fulfillment status snapshot",
      description: `Fulfillment status: ${dispute.order?.displayFulfillmentStatus ?? "Unknown"}`
    });
  }

  if (items.length > 0) {
    await db.evidenceItem.createMany({
      data: items
    });
  }
}

export async function syncRecentDisputesForMerchant(shopDomain: string) {
  const merchant = await db.merchant.findUnique({
    where: { shopDomain }
  });

  if (!merchant?.accessTokenEncrypted) {
    throw new Error("Merchant is not installed or access token is missing.");
  }

  const accessToken = decryptString(merchant.accessTokenEncrypted);
  const client = createShopifyAdminClient({
    storeDomain: shopDomain,
    accessToken
  });

  const response = await client.request(DISPUTES_LIST_QUERY);
  const data = response.data as DisputesQueryResponse | undefined;

  if (!data?.disputes?.nodes) {
    return { synced: 0 };
  }

  for (const dispute of data.disputes.nodes) {
    const previousDispute = await db.dispute.findUnique({
      where: { shopifyDisputeId: dispute.id },
      select: {
        id: true,
        status: true,
        evidenceSentOn: true
      }
    });

    const dbDispute = await db.dispute.upsert({
      where: { shopifyDisputeId: dispute.id },
      update: {
        merchantId: merchant.id,
        shopifyOrderId: dispute.order?.id ?? null,
        status: normalizeStatus(dispute.status) as never,
        reason: dispute.reason ?? null,
        reasonDetails: dispute.reasonDetails ?? null,
        amount: dispute.amount ?? undefined,
        currencyCode: dispute.currencyCode ?? null,
        evidenceDueBy: dispute.evidenceDueBy ? new Date(dispute.evidenceDueBy) : null,
        evidenceSentOn: dispute.evidenceSentOn ? new Date(dispute.evidenceSentOn) : null
      },
      create: {
        merchantId: merchant.id,
        shopifyDisputeId: dispute.id,
        shopifyOrderId: dispute.order?.id ?? null,
        status: normalizeStatus(dispute.status) as never,
        reason: dispute.reason ?? null,
        reasonDetails: dispute.reasonDetails ?? null,
        amount: dispute.amount ?? undefined,
        currencyCode: dispute.currencyCode ?? null,
        evidenceDueBy: dispute.evidenceDueBy ? new Date(dispute.evidenceDueBy) : null,
        evidenceSentOn: dispute.evidenceSentOn ? new Date(dispute.evidenceSentOn) : null
      }
    });

    await upsertOrderSnapshot(dispute, merchant.id);
    await replaceSystemEvidence(dbDispute.id, dispute);

    await db.disputeTimelineEvent.create({
      data: {
        disputeId: dbDispute.id,
        eventType: "GRAPHQL_SYNCED",
        eventTimestamp: new Date(),
        source: "shopify_graphql"
      }
    });

    await syncDerivedDisputeState({
      disputeId: dbDispute.id,
      merchantId: merchant.id,
      currentStatus: dbDispute.status,
      previousStatus: previousDispute?.status ?? null,
      evidenceSentOn: dbDispute.evidenceSentOn,
      previousEvidenceSentOn: previousDispute?.evidenceSentOn ?? null,
      source: "shopify_graphql"
    });
  }

  return { synced: data.disputes.nodes.length };
}
