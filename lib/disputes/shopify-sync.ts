import { db } from "@/lib/db";
import { syncDerivedDisputeState } from "@/lib/disputes/auto-sync";
import { decryptString } from "@/lib/crypto";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import {
  DISPUTE_SYNC_QUERY,
  DISPUTES_LIST_QUERY,
  ORDERS_WITH_DISPUTES_QUERY,
  SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY
} from "@/lib/shopify/queries";

type ShopifyDisputeNode = {
  id: string;
  amount?: {
    amount?: string | null;
    currencyCode?: string | null;
  } | null;
  reasonDetails?: {
    reason?: string | null;
    networkReasonCode?: string | null;
  } | null;
  status?: string | null;
  evidenceDueBy?: string | null;
  evidenceSentOn?: string | null;
  type?: string | null;
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

type SingleDisputeQueryResponse = {
  dispute?: ShopifyDisputeNode | null;
};

type ShopifyPaymentsAccountDisputesQueryResponse = {
  shopifyPaymentsAccount?: {
    disputes?: {
      nodes: ShopifyDisputeNode[];
    } | null;
  } | null;
};

type OrderDisputeSummary = {
  id: string;
  status?: string | null;
  initiatedAs?: string | null;
};

type OrderWithDisputesNode = NonNullable<ShopifyDisputeNode["order"]> & {
  disputes?: OrderDisputeSummary[] | null;
};

type OrdersWithDisputesQueryResponse = {
  orders?: {
    nodes?: OrderWithDisputesNode[];
  };
};

type ShopifyGraphqlError = {
  message?: string;
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

function buildDisputeFromOrderSummary(order: OrderWithDisputesNode, summary: OrderDisputeSummary): ShopifyDisputeNode {
  return {
    id: summary.id,
    status: summary.status,
    type: summary.initiatedAs,
    amount: order.currentTotalPriceSet?.shopMoney ?? null,
    reasonDetails: null,
    order
  };
}

async function importDisputeNode(
  dispute: ShopifyDisputeNode,
  merchantId: string
) {
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
      merchantId,
      shopifyOrderId: dispute.order?.id ?? null,
      status: normalizeStatus(dispute.status) as never,
      disputeType: dispute.type ?? null,
      reason: dispute.reasonDetails?.reason ?? dispute.type ?? null,
      reasonDetails: dispute.reasonDetails?.networkReasonCode ?? dispute.type ?? null,
      amount: dispute.amount?.amount ?? undefined,
      currencyCode: dispute.amount?.currencyCode ?? null,
      evidenceDueBy: dispute.evidenceDueBy ? new Date(dispute.evidenceDueBy) : null,
      evidenceSentOn: dispute.evidenceSentOn ? new Date(dispute.evidenceSentOn) : null
    },
    create: {
      merchantId,
      shopifyDisputeId: dispute.id,
      shopifyOrderId: dispute.order?.id ?? null,
      status: normalizeStatus(dispute.status) as never,
      disputeType: dispute.type ?? null,
      reason: dispute.reasonDetails?.reason ?? dispute.type ?? null,
      reasonDetails: dispute.reasonDetails?.networkReasonCode ?? dispute.type ?? null,
      amount: dispute.amount?.amount ?? undefined,
      currencyCode: dispute.amount?.currencyCode ?? null,
      evidenceDueBy: dispute.evidenceDueBy ? new Date(dispute.evidenceDueBy) : null,
      evidenceSentOn: dispute.evidenceSentOn ? new Date(dispute.evidenceSentOn) : null
    }
  });

  await upsertOrderSnapshot(dispute, merchantId);
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
    merchantId,
    currentStatus: dbDispute.status,
    previousStatus: previousDispute?.status ?? null,
    evidenceSentOn: dbDispute.evidenceSentOn,
    previousEvidenceSentOn: previousDispute?.evidenceSentOn ?? null,
    source: "shopify_graphql"
  });
}

async function listOrderDisputeFallbacks(
  client: ReturnType<typeof createShopifyAdminClient>
) {
  const ordersResponse = await client.request(ORDERS_WITH_DISPUTES_QUERY);
  const orderErrors = (
    "errors" in ordersResponse && Array.isArray(ordersResponse.errors) ? ordersResponse.errors : []
  ) as ShopifyGraphqlError[];

  if (orderErrors.length > 0) {
    throw new Error(
      `Shopify order dispute summary query failed: ${orderErrors
        .map((error) => error.message)
        .filter(Boolean)
        .join("; ")}`
    );
  }

  const orderData = ordersResponse.data as OrdersWithDisputesQueryResponse | undefined;
  const disputeSummaries = (orderData?.orders?.nodes ?? []).flatMap((order) =>
    (order.disputes ?? []).map((summary) => ({ order, summary }))
  );

  const disputes: ShopifyDisputeNode[] = [];

  for (const { order, summary } of disputeSummaries) {
    const disputeResponse = await client.request(DISPUTE_SYNC_QUERY, {
      variables: { id: summary.id }
    });
    const disputeErrors = (
      "errors" in disputeResponse && Array.isArray(disputeResponse.errors) ? disputeResponse.errors : []
    ) as ShopifyGraphqlError[];
    const disputeData = disputeResponse.data as SingleDisputeQueryResponse | undefined;

    if (disputeErrors.length === 0 && disputeData?.dispute) {
      disputes.push({
        ...disputeData.dispute,
        order: disputeData.dispute.order ?? order
      });
      continue;
    }

    disputes.push(buildDisputeFromOrderSummary(order, summary));
  }

  return disputes;
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
  const responseErrors = (
    "errors" in response && Array.isArray(response.errors) ? response.errors : []
  ) as ShopifyGraphqlError[];
  let data = response.data as DisputesQueryResponse | undefined;

  if (responseErrors.length > 0) {
    throw new Error(
      `Shopify dispute query failed: ${responseErrors
        .map((error) => error.message)
        .filter(Boolean)
        .join("; ")}`
    );
  }

  let disputes = data?.disputes?.nodes ?? [];

  if (disputes.length === 0) {
    const accountResponse = await client.request(SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY);
    const accountErrors = (
      "errors" in accountResponse && Array.isArray(accountResponse.errors) ? accountResponse.errors : []
    ) as ShopifyGraphqlError[];
    const accountData = accountResponse.data as ShopifyPaymentsAccountDisputesQueryResponse | undefined;

    if (
      accountErrors.length > 0 &&
      accountErrors.some((error) => error.message && !error.message.includes("Access denied"))
    ) {
      throw new Error(
        `Shopify payments account dispute query failed: ${accountErrors
          .map((error) => error.message)
          .filter(Boolean)
          .join("; ")}`
      );
    }

    disputes = accountData?.shopifyPaymentsAccount?.disputes?.nodes ?? [];
  }

  if (disputes.length === 0) {
    disputes = await listOrderDisputeFallbacks(client);
  }

  if (disputes.length === 0) {
    return { synced: 0 };
  }

  for (const dispute of disputes) {
    await importDisputeNode(dispute, merchant.id);
  }

  return { synced: disputes.length };
}
