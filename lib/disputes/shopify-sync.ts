import { db } from "@/lib/db";
import { syncDerivedDisputeState } from "@/lib/disputes/auto-sync";
import { decryptString } from "@/lib/crypto";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { extractGraphqlErrors, graphqlErrorMessages, isAccessDeniedError } from "@/lib/shopify/errors";
import {
  DISPUTE_SYNC_NO_CUSTOMER_QUERY,
  DISPUTES_LIST_NO_CUSTOMER_QUERY,
  ORDER_PROTECTED_DETAILS_QUERY,
  ORDER_DETAILS_NO_CUSTOMER_BY_ID_QUERY,
  RECENT_ORDERS_NO_CUSTOMER_QUERY,
  SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY
} from "@/lib/shopify/queries";

type AdminClient = ReturnType<typeof createShopifyAdminClient>;

type OrderCustomer = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type OrderShippingAddress = {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  provinceCode?: string | null;
  zip?: string | null;
  country?: string | null;
  countryCodeV2?: string | null;
};

type ShopifyOrderNode = {
  id: string;
  name?: string | null;
  createdAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currentTotalPriceSet?: {
    shopMoney?: { amount?: string | null; currencyCode?: string | null } | null;
  } | null;
  customer?: OrderCustomer | null;
  shippingAddress?: OrderShippingAddress | null;
  lineItems?: { nodes: Array<{ name?: string | null; quantity?: number | null; sku?: string | null }> } | null;
  // Order.fulfillments is [Fulfillment!]! - a plain list, NOT a connection.
  // Selecting `nodes` on it is a schema error that nulls the entire query.
  fulfillments?: Array<{
    trackingInfo?: Array<{ company?: string | null; number?: string | null; url?: string | null }> | null;
  }> | null;
  disputes?: Array<OrderDisputeSummary> | null;
};

type OrderDisputeSummary = {
  id: string;
  status?: string | null;
  initiatedAs?: string | null;
};

type ShopifyDisputeNode = {
  id: string;
  amount?: { amount?: string | null; currencyCode?: string | null } | null;
  reasonDetails?: { reason?: string | null; networkReasonCode?: string | null } | null;
  status?: string | null;
  evidenceDueBy?: string | null;
  evidenceSentOn?: string | null;
  initiatedAt?: string | null;
  finalizedOn?: string | null;
  type?: string | null;
  order?: ShopifyOrderNode | null;
};

/**
 * Collects non-fatal problems so a partial sync still reports WHY it was partial,
 * instead of silently returning `synced: 0` (the failure mode this app shipped with).
 */
class SyncDiagnostics {
  private readonly messages: string[] = [];

  add(context: string, response: unknown) {
    const messages = graphqlErrorMessages(response);
    if (messages.length > 0) {
      this.messages.push(`${context}: ${messages.join(" | ")}`);
    }
  }

  note(message: string) {
    this.messages.push(message);
  }

  list() {
    return [...new Set(this.messages)];
  }
}

/**
 * `Order.disputes` returns OrderDisputeSummary nodes whose GIDs look like
 * `gid://shopify/OrderDisputeSummary/<n>`, while the top-level `disputes`
 * connection returns `gid://shopify/ShopifyPaymentsDispute/<n>` for the SAME
 * dispute. Keying on the raw GID stored each dispute twice, and
 * `dispute(id: <OrderDisputeSummary gid>)` fails with RESOURCE_NOT_FOUND.
 * Normalise both to the ShopifyPaymentsDispute form.
 */
export function toDisputeGid(id: string): string {
  const numericId = id.split("/").pop();
  return numericId ? `gid://shopify/ShopifyPaymentsDispute/${numericId}` : id;
}

function mergeDisputeNode(
  existing: ShopifyDisputeNode | undefined,
  incoming: ShopifyDisputeNode,
  // Order-derived data is low fidelity (order total instead of the disputed
  // amount, no reason details). It must never overwrite authoritative values.
  fillOnly = false
): ShopifyDisputeNode {
  if (!existing) {
    return incoming;
  }

  const pick = <T,>(a: T | null | undefined, b: T | null | undefined) => (fillOnly ? (b ?? a) : (a ?? b));

  return {
    ...(fillOnly ? incoming : existing),
    ...(fillOnly ? existing : incoming),
    id: existing.id,
    amount: pick(incoming.amount, existing.amount),
    reasonDetails: pick(incoming.reasonDetails, existing.reasonDetails),
    status: pick(incoming.status, existing.status),
    evidenceDueBy: pick(incoming.evidenceDueBy, existing.evidenceDueBy),
    evidenceSentOn: pick(incoming.evidenceSentOn, existing.evidenceSentOn),
    initiatedAt: pick(incoming.initiatedAt, existing.initiatedAt),
    finalizedOn: pick(incoming.finalizedOn, existing.finalizedOn),
    type: pick(incoming.type, existing.type),
    order: incoming.order ? { ...existing.order, ...incoming.order } : existing.order
  };
}

function safeParse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

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

function buildCustomerName(customer?: OrderCustomer | null) {
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

/* ------------------------------------------------------------------ *
 * Shopify reads
 * ------------------------------------------------------------------ */

/**
 * Primary source: top-level `disputes` connection.
 * Needs only `read_shopify_payments_disputes` because it never traverses
 * `shopifyPaymentsAccount` (which additionally requires
 * `read_shopify_payments_accounts`) and never traverses `customer`.
 */
async function collectTopLevelDisputes(client: AdminClient, diagnostics: SyncDiagnostics) {
  const disputes: ShopifyDisputeNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const response = await client.request(DISPUTES_LIST_NO_CUSTOMER_QUERY, { variables: { after } });
    const errors = extractGraphqlErrors(response);

    if (errors.length > 0) {
      diagnostics.add("disputes(first:100)", response);
      break;
    }

    const data = response.data as
      | { disputes?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: ShopifyDisputeNode[] } }
      | undefined;

    disputes.push(...(data?.disputes?.nodes ?? []));
    after = data?.disputes?.pageInfo?.endCursor ?? null;

    if (!data?.disputes?.pageInfo?.hasNextPage || !after) {
      break;
    }
  }

  return disputes;
}

/**
 * Best-effort secondary source. Requires `read_shopify_payments_accounts` on top
 * of the dispute scope, so denial here is expected and must never fail the sync.
 */
async function collectAccountDisputes(client: AdminClient, diagnostics: SyncDiagnostics) {
  const response = await client.request(SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY, { variables: { after: null } });
  const errors = extractGraphqlErrors(response);

  if (errors.length > 0) {
    if (!errors.every(isAccessDeniedError)) {
      diagnostics.add("shopifyPaymentsAccount.disputes", response);
    }
    return [];
  }

  const data = response.data as
    | { shopifyPaymentsAccount?: { disputes?: { nodes?: ShopifyDisputeNode[] } | null } | null }
    | undefined;

  return data?.shopifyPaymentsAccount?.disputes?.nodes ?? [];
}

/**
 * Fallback source: walk recent orders and read their dispute summaries.
 * This is what catches a brand-new chargeback the moment it lands on an order.
 */
async function collectOrderDerivedDisputes(client: AdminClient, diagnostics: SyncDiagnostics) {
  const response = await client.request(RECENT_ORDERS_NO_CUSTOMER_QUERY);
  const errors = extractGraphqlErrors(response);

  if (errors.length > 0) {
    diagnostics.add("orders(first:100).disputes", response);
    return [];
  }

  const data = response.data as { orders?: { nodes?: ShopifyOrderNode[] } } | undefined;
  const orders = data?.orders?.nodes ?? [];
  const disputes: ShopifyDisputeNode[] = [];

  for (const order of orders) {
    for (const summary of order.disputes ?? []) {
      if (!summary?.id) {
        continue;
      }

      const disputeGid = toDisputeGid(summary.id);

      const detailResponse = await client.request(DISPUTE_SYNC_NO_CUSTOMER_QUERY, {
        variables: { id: disputeGid }
      });
      const detailErrors = extractGraphqlErrors(detailResponse);
      const detail = (detailResponse.data as { dispute?: ShopifyDisputeNode | null } | undefined)?.dispute;

      if (detailErrors.length > 0) {
        diagnostics.add(`dispute(${disputeGid})`, detailResponse);
      }

      if (detail) {
        disputes.push({ ...detail, id: toDisputeGid(detail.id), order: { ...order, ...(detail.order ?? {}) } });
        continue;
      }

      // Even without full dispute detail, the order summary makes the dispute
      // visible. Note the amount here is the ORDER total, not the disputed
      // amount - so this node is merged fill-only and never overwrites a real
      // amount from the top-level disputes query.
      disputes.push({
        id: disputeGid,
        status: summary.status,
        type: summary.initiatedAs,
        amount: order.currentTotalPriceSet?.shopMoney ?? null,
        reasonDetails: null,
        order
      });
    }
  }

  return disputes;
}

/**
 * Customer PII is Level 2 protected customer data and needs BOTH the
 * `read_customers` scope and Partner Dashboard approval. Fetch it in its own
 * request so a denial costs us the customer name/email only, rather than
 * nulling every dispute payload.
 */
async function enrichCustomers(
  client: AdminClient,
  disputes: ShopifyDisputeNode[],
  diagnostics: SyncDiagnostics
) {
  const orderIds = [...new Set(disputes.map((dispute) => dispute.order?.id).filter((id): id is string => Boolean(id)))];
  const customersByOrderId = new Map<string, OrderCustomer>();
  const addressesByOrderId = new Map<string, OrderShippingAddress>();
  let denied = false;

  for (const orderId of orderIds) {
    if (denied) {
      break;
    }

    const response = await client.request(ORDER_PROTECTED_DETAILS_QUERY, { variables: { id: orderId } });
    const errors = extractGraphqlErrors(response);

    if (errors.length > 0) {
      if (errors.every(isAccessDeniedError)) {
        denied = true;
        // Two different gates produce ACCESS_DENIED here and the fix differs:
        //  - missing OAuth scope  -> "Required access: `read_customers` access scope"
        //  - Protected Customer Data field not approved -> "not approved to use the <field> field"
        // Telling someone to add a scope they already have sends them the wrong way.
        const notApproved = errors.some((error) => /not approved to use/i.test(error.message));
        const remedy = notApproved
          ? "The read_customers scope is granted, but the app is not approved for protected customer data. " +
            "In the Partner Dashboard open API access -> Protected customer data and select the Name and " +
            "Email fields. Development stores do not need review."
          : "Add the read_customers scope to SHOPIFY_SCOPES and reinstall the app.";

        diagnostics.note(`Customer details unavailable. ${remedy}`);
      } else {
        diagnostics.add(`order(${orderId}).customer`, response);
      }
      continue;
    }

    const order = (
      response.data as
        | { order?: { customer?: OrderCustomer | null; shippingAddress?: OrderShippingAddress | null } | null }
        | undefined
    )?.order;

    if (order?.customer) {
      customersByOrderId.set(orderId, order.customer);
    }

    if (order?.shippingAddress) {
      addressesByOrderId.set(orderId, order.shippingAddress);
    }
  }

  return disputes.map((dispute) => {
    const orderId = dispute.order?.id;
    if (!dispute.order || !orderId) {
      return dispute;
    }

    const customer = customersByOrderId.get(orderId);
    const shippingAddress = addressesByOrderId.get(orderId);

    if (!customer && !shippingAddress) {
      return dispute;
    }

    return {
      ...dispute,
      order: {
        ...dispute.order,
        ...(customer ? { customer } : {}),
        ...(shippingAddress ? { shippingAddress } : {})
      }
    };
  });
}

async function fetchOrderDetailsById(client: AdminClient, orderId: string, diagnostics: SyncDiagnostics) {
  const response = await client.request(ORDER_DETAILS_NO_CUSTOMER_BY_ID_QUERY, { variables: { id: orderId } });
  const errors = extractGraphqlErrors(response);

  if (errors.length === 0) {
    const order = (response.data as { order?: ShopifyOrderNode | null } | undefined)?.order;
    if (order) {
      return order;
    }
  } else {
    diagnostics.add(`order(${orderId})`, response);
  }

  // Single-order lookup has been unreliable in this store; fall back to the
  // recent-orders feed, which is known to work.
  const feedResponse = await client.request(RECENT_ORDERS_NO_CUSTOMER_QUERY);
  if (extractGraphqlErrors(feedResponse).length > 0) {
    diagnostics.add("orders(first:100) [order backfill]", feedResponse);
    return null;
  }

  const feed = (feedResponse.data as { orders?: { nodes?: ShopifyOrderNode[] } } | undefined)?.orders?.nodes ?? [];
  return feed.find((order) => order?.id === orderId) ?? null;
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

async function upsertOrderSnapshot(dispute: ShopifyDisputeNode, merchantId: string) {
  if (!dispute.order) {
    return null;
  }

  const payload = {
    merchantId,
    orderName: dispute.order.name ?? null,
    customerEmail: dispute.order.customer?.email ?? null,
    customerName: buildCustomerName(dispute.order.customer),
    orderTotal: dispute.order.currentTotalPriceSet?.shopMoney?.amount ?? undefined,
    currencyCode: dispute.order.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
    fulfillmentStatus: dispute.order.displayFulfillmentStatus ?? null,
    orderJson: JSON.stringify(dispute.order)
  };

  return db.orderSnapshot.upsert({
    where: { shopifyOrderId: dispute.order.id },
    update: payload,
    create: { ...payload, shopifyOrderId: dispute.order.id }
  });
}

async function replaceSystemEvidence(disputeId: string, dispute: ShopifyDisputeNode) {
  await db.evidenceItem.deleteMany({
    where: { disputeId, sourceType: { in: ["shopify_order", "shopify_fulfillment"] } }
  });

  const items: Array<{
    disputeId: string;
    category: "PRODUCT_PROOF" | "SHIPPING_DOCUMENTATION" | "DELIVERY_CONFIRMATION";
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
    dispute.order?.fulfillments?.flatMap((fulfillment) => fulfillment.trackingInfo ?? []) ?? [];

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
    await db.evidenceItem.createMany({ data: items });
  }
}

async function importDisputeNode(dispute: ShopifyDisputeNode, merchantId: string) {
  const previousDispute = await db.dispute.findUnique({
    where: { shopifyDisputeId: dispute.id },
    select: { id: true, status: true, evidenceSentOn: true }
  });

  const payload = {
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
    initiatedAt: dispute.initiatedAt ? new Date(dispute.initiatedAt) : null,
    finalizedOn: dispute.finalizedOn ? new Date(dispute.finalizedOn) : null,
    sourceSnapshotJson: JSON.stringify(dispute)
  };

  const dbDispute = await db.dispute.upsert({
    where: { shopifyDisputeId: dispute.id },
    update: payload,
    create: { ...payload, shopifyDisputeId: dispute.id }
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
  client: AdminClient,
  merchantId: string,
  diagnostics: SyncDiagnostics
) {
  const disputes = await db.dispute.findMany({
    where: { merchantId },
    select: { id: true, shopifyOrderId: true, amount: true, currencyCode: true, sourceSnapshotJson: true }
  });

  for (const dispute of disputes) {
    if (!dispute.shopifyOrderId) {
      continue;
    }

    const order = await fetchOrderDetailsById(client, dispute.shopifyOrderId, diagnostics);
    if (!order) {
      continue;
    }

    await upsertOrderSnapshot({ id: dispute.id, order }, merchantId);

    const fallbackAmount = order.currentTotalPriceSet?.shopMoney?.amount ?? null;
    const fallbackCurrencyCode = order.currentTotalPriceSet?.shopMoney?.currencyCode ?? null;

    await db.dispute.update({
      where: { id: dispute.id },
      data: {
        amount: shouldReplaceStoredAmount(dispute.amount, fallbackAmount)
          ? fallbackAmount ?? undefined
          : dispute.amount ?? fallbackAmount ?? undefined,
        currencyCode: dispute.currencyCode ?? fallbackCurrencyCode ?? null,
        // Merge into the existing snapshot instead of replacing it - the
        // Shopify dispute payload is the audit trail and must not be lost.
        sourceSnapshotJson: JSON.stringify({
          ...(dispute.sourceSnapshotJson ? safeParse(dispute.sourceSnapshotJson) : {}),
          order
        })
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function syncRecentDisputesForMerchant(shopDomain: string) {
  const merchant = await db.merchant.findUnique({ where: { shopDomain } });

  if (!merchant?.accessTokenEncrypted) {
    throw new Error("Merchant is not installed or access token is missing.");
  }

  const client = createShopifyAdminClient({
    storeDomain: shopDomain,
    accessToken: decryptString(merchant.accessTokenEncrypted)
  });

  const diagnostics = new SyncDiagnostics();
  const disputesById = new Map<string, ShopifyDisputeNode>();
  const sources: Record<string, number> = {};

  const topLevel = await collectTopLevelDisputes(client, diagnostics);
  sources.topLevelDisputes = topLevel.length;
  for (const dispute of topLevel) {
    const key = toDisputeGid(dispute.id);
    disputesById.set(key, mergeDisputeNode(disputesById.get(key), { ...dispute, id: key }));
  }

  const account = await collectAccountDisputes(client, diagnostics);
  sources.shopifyPaymentsAccountDisputes = account.length;
  for (const dispute of account) {
    const key = toDisputeGid(dispute.id);
    disputesById.set(key, mergeDisputeNode(disputesById.get(key), { ...dispute, id: key }));
  }

  const orderDerived = await collectOrderDerivedDisputes(client, diagnostics);
  sources.orderDerivedDisputes = orderDerived.length;
  for (const dispute of orderDerived) {
    const key = toDisputeGid(dispute.id);
    disputesById.set(key, mergeDisputeNode(disputesById.get(key), { ...dispute, id: key }, true));
  }

  const enriched = await enrichCustomers(client, [...disputesById.values()], diagnostics);

  for (const dispute of enriched) {
    await importDisputeNode(dispute, merchant.id);
  }

  await backfillExistingDisputeOrderData(client, merchant.id, diagnostics);

  if (enriched.length === 0) {
    diagnostics.note(
      "No disputes returned by any Shopify source. If the store shows a chargeback in Admin, confirm it is " +
        "on Shopify Payments test mode (not Bogus Gateway) - Bogus Gateway creates no dispute records."
    );
  }

  return {
    synced: enriched.length,
    sources,
    warnings: diagnostics.list()
  };
}
