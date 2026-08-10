import { db } from "@/lib/db";
import { syncDerivedDisputeState } from "@/lib/disputes/auto-sync";
import { decryptString } from "@/lib/crypto";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import {
  DISPUTE_SYNC_QUERY,
  DISPUTES_LIST_QUERY,
  ORDER_DETAILS_BY_ID_QUERY,
  RECENT_ORDERS_WITH_DETAILS_QUERY,
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
    pageInfo?: {
      hasNextPage?: boolean;
      endCursor?: string | null;
    };
    nodes: ShopifyDisputeNode[];
  };
};

type SingleDisputeQueryResponse = {
  dispute?: ShopifyDisputeNode | null;
};

type SingleOrderQueryResponse = {
  order?: OrderWithDisputesNode | null;
};

type ShopifyPaymentsAccountDisputesQueryResponse = {
  shopifyPaymentsAccount?: {
    disputes?: {
      pageInfo?: {
        hasNextPage?: boolean;
        endCursor?: string | null;
      };
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
  createdAt?: string | null;
  displayFinancialStatus?: string | null;
};

function mergeDisputeNode(existing: ShopifyDisputeNode | undefined, incoming: ShopifyDisputeNode) {
  if (!existing) {
    return incoming;
  }

  return {
    ...existing,
    ...incoming,
    amount: incoming.amount ?? existing.amount,
    reasonDetails: incoming.reasonDetails ?? existing.reasonDetails,
    status: incoming.status ?? existing.status,
    evidenceDueBy: incoming.evidenceDueBy ?? existing.evidenceDueBy,
    evidenceSentOn: incoming.evidenceSentOn ?? existing.evidenceSentOn,
    type: incoming.type ?? existing.type,
    order: incoming.order ?? existing.order
  };
}

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

function shouldReplaceStoredAmount(currentAmount: { toString(): string } | null, fallbackAmount: string | null) {
  if (!fallbackAmount) {
    return false;
  }

  if (!currentAmount) {
    return true;
  }

  const normalized = Number(currentAmount.toString());
  return Number.isFinite(normalized) && normalized === 0;
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

async function enrichOrderDetails(
  client: ReturnType<typeof createShopifyAdminClient>,
  dispute: ShopifyDisputeNode
) {
  if (!dispute.order?.id) {
    return dispute;
  }

  const detailsResponse = await client.request(ORDER_DETAILS_BY_ID_QUERY, {
    variables: { id: dispute.order.id }
  });
  const detailErrors = (
    "errors" in detailsResponse && Array.isArray(detailsResponse.errors) ? detailsResponse.errors : []
  ) as ShopifyGraphqlError[];
  const detailData = detailsResponse.data as
    | {
        order?: ShopifyDisputeNode["order"] | null;
      }
    | undefined;

  if (detailErrors.length > 0 || !detailData?.order) {
    return dispute;
  }

  return {
    ...dispute,
    order: detailData.order
  };
}

async function fetchOrderDetailsById(
  client: ReturnType<typeof createShopifyAdminClient>,
  orderId: string
) {
  const fallbackResponse = await client.request(RECENT_ORDERS_WITH_DETAILS_QUERY);
  const fallbackErrors = (
    "errors" in fallbackResponse && Array.isArray(fallbackResponse.errors) ? fallbackResponse.errors : []
  ) as ShopifyGraphqlError[];
  const fallbackData = fallbackResponse.data as
    | {
        orders?: {
          nodes?: Array<ShopifyDisputeNode["order"]>;
        };
      }
    | undefined;

  if (fallbackErrors.length > 0) {
    const detailsResponse = await client.request(ORDER_DETAILS_BY_ID_QUERY, {
      variables: { id: orderId }
    });
    const detailErrors = (
      "errors" in detailsResponse && Array.isArray(detailsResponse.errors) ? detailsResponse.errors : []
    ) as ShopifyGraphqlError[];
    const detailData = detailsResponse.data as
      | {
          order?: ShopifyDisputeNode["order"] | null;
        }
      | undefined;

    if (detailErrors.length === 0 && detailData?.order) {
      return detailData.order;
    }

    return null;
  }

  const fallbackOrder = (fallbackData?.orders?.nodes ?? []).find((order) => order?.id === orderId) ?? null;
  return fallbackOrder;
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
      evidenceSentOn: dispute.evidenceSentOn ? new Date(dispute.evidenceSentOn) : null,
      sourceSnapshotJson: JSON.stringify(dispute)
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
      evidenceSentOn: dispute.evidenceSentOn ? new Date(dispute.evidenceSentOn) : null,
      sourceSnapshotJson: JSON.stringify(dispute)
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

async function backfillExistingDisputeOrderData(
  client: ReturnType<typeof createShopifyAdminClient>,
  merchantId: string
) {
  const disputes = await db.dispute.findMany({
    where: { merchantId },
    select: {
      id: true,
      shopifyOrderId: true,
      amount: true,
      currencyCode: true,
      sourceSnapshotJson: true
    }
  });

  for (const dispute of disputes) {
    if (!dispute.shopifyOrderId) {
      continue;
    }

    const order = await fetchOrderDetailsById(client, dispute.shopifyOrderId);
    if (!order) {
      continue;
    }

    await upsertOrderSnapshot(
      {
        id: dispute.id,
        order
      },
      merchantId
    );

    const fallbackAmount = order.currentTotalPriceSet?.shopMoney?.amount ?? null;
    const fallbackCurrencyCode = order.currentTotalPriceSet?.shopMoney?.currencyCode ?? null;

    await db.dispute.update({
      where: { id: dispute.id },
      data: {
        amount: shouldReplaceStoredAmount(dispute.amount, fallbackAmount)
          ? fallbackAmount ?? undefined
          : dispute.amount ?? fallbackAmount ?? undefined,
        currencyCode: dispute.currencyCode ?? fallbackCurrencyCode ?? null,
        sourceSnapshotJson: JSON.stringify({
          id: dispute.id,
          order
        })
      }
    });
  }
}

async function listOrderDisputeFallbacks(
  client: ReturnType<typeof createShopifyAdminClient>
) {
  const recentOrdersResponse = await client.request(RECENT_ORDERS_WITH_DETAILS_QUERY);
  const recentOrderErrors = (
    "errors" in recentOrdersResponse && Array.isArray(recentOrdersResponse.errors)
      ? recentOrdersResponse.errors
      : []
  ) as ShopifyGraphqlError[];
  const recentOrdersData = recentOrdersResponse.data as
    | {
        orders?: {
          nodes?: Array<OrderWithDisputesNode>;
        };
      }
    | undefined;

  if (recentOrderErrors.length > 0) {
    throw new Error(
      `Shopify recent-orders query failed: ${recentOrderErrors
        .map((error) => error.message)
        .filter(Boolean)
        .join("; ")}`
    );
  }

  const disputes: ShopifyDisputeNode[] = [];
  const recentOrders = recentOrdersData?.orders?.nodes ?? [];

  for (const order of recentOrders) {
    if (!order?.disputes?.length) {
      continue;
    }

    for (const summary of order.disputes) {
      const disputeResponse = await client.request(DISPUTE_SYNC_QUERY, {
        variables: { id: summary.id }
      });
      const disputeErrors = (
        "errors" in disputeResponse && Array.isArray(disputeResponse.errors) ? disputeResponse.errors : []
      ) as ShopifyGraphqlError[];
      const disputeData = disputeResponse.data as SingleDisputeQueryResponse | undefined;

      if (disputeErrors.length === 0 && disputeData?.dispute) {
        disputes.push(await enrichOrderDetails(client, {
          ...disputeData.dispute,
          order: disputeData.dispute.order ?? order
        }));
        continue;
      }

      disputes.push(buildDisputeFromOrderSummary(order, summary));
    }
  }

  return disputes;
}

async function collectRootDisputes(client: ReturnType<typeof createShopifyAdminClient>) {
  const disputes: ShopifyDisputeNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const response = await client.request(DISPUTES_LIST_QUERY, {
      variables: { after }
    });
    const responseErrors = (
      "errors" in response && Array.isArray(response.errors) ? response.errors : []
    ) as ShopifyGraphqlError[];
    const data = response.data as DisputesQueryResponse | undefined;

    if (responseErrors.length > 0) {
      throw new Error(
        `Shopify dispute query failed: ${responseErrors
          .map((error) => error.message)
          .filter(Boolean)
          .join("; ")}`
      );
    }

    disputes.push(...(data?.disputes?.nodes ?? []));
    after = data?.disputes?.pageInfo?.endCursor ?? null;
    if (!data?.disputes?.pageInfo?.hasNextPage || !after) {
      break;
    }
  }

  return disputes;
}

async function collectAccountDisputes(client: ReturnType<typeof createShopifyAdminClient>) {
  const disputes: ShopifyDisputeNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const response = await client.request(SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY, {
      variables: { after }
    });
    const responseErrors = (
      "errors" in response && Array.isArray(response.errors) ? response.errors : []
    ) as ShopifyGraphqlError[];
    const data = response.data as ShopifyPaymentsAccountDisputesQueryResponse | undefined;

    if (
      responseErrors.length > 0 &&
      responseErrors.some((error) => error.message && !error.message.includes("Access denied"))
    ) {
      throw new Error(
        `Shopify payments account dispute query failed: ${responseErrors
          .map((error) => error.message)
          .filter(Boolean)
          .join("; ")}`
      );
    }

    disputes.push(...(data?.shopifyPaymentsAccount?.disputes?.nodes ?? []));
    after = data?.shopifyPaymentsAccount?.disputes?.pageInfo?.endCursor ?? null;
    if (!data?.shopifyPaymentsAccount?.disputes?.pageInfo?.hasNextPage || !after) {
      break;
    }
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

  const disputesById = new Map<string, ShopifyDisputeNode>();

  for (const dispute of await collectRootDisputes(client)) {
    disputesById.set(dispute.id, mergeDisputeNode(disputesById.get(dispute.id), dispute));
  }

  for (const dispute of await collectAccountDisputes(client)) {
    disputesById.set(dispute.id, mergeDisputeNode(disputesById.get(dispute.id), dispute));
  }

  for (const dispute of await listOrderDisputeFallbacks(client)) {
    disputesById.set(dispute.id, mergeDisputeNode(disputesById.get(dispute.id), dispute));
  }

  await backfillExistingDisputeOrderData(client, merchant.id);

  const disputes = [...disputesById.values()];

  if (disputes.length === 0) {
    return { synced: 0 };
  }

  for (const dispute of disputes) {
    await importDisputeNode(dispute, merchant.id);
  }

  return { synced: disputes.length };
}
