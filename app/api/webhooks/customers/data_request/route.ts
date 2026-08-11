import { NextResponse } from "next/server";

import { assembleCustomerData } from "@/lib/compliance/redaction";
import { persistComplianceRequest } from "@/lib/compliance/requests";
import { parseJsonPayload, type CustomersDataRequestPayload } from "@/lib/compliance/types";
import { guardWebhookDelivery } from "@/lib/shopify/webhook-replay";
import { verifyShopifyWebhook } from "@/lib/shopify/webhooks";

export async function POST(request: Request) {
  const { isValid, shopDomain, body, webhookId, triggeredAt, apiVersion, topic } =
    await verifyShopifyWebhook(request);

  if (!isValid) {
    return new NextResponse("Invalid webhook", { status: 401 });
  }

  const payload = parseJsonPayload<CustomersDataRequestPayload>(body);
  const targetShop = payload.shop_domain ?? shopDomain;

  if (!targetShop) {
    return new NextResponse("Missing shop domain", { status: 400 });
  }

  const decision = await guardWebhookDelivery({
    webhookId,
    topic: topic ?? "customers/data_request",
    shopDomain: targetShop,
    triggeredAt,
    apiVersion
  });

  if (!decision.process) {
    return NextResponse.json({ ok: true, skipped: decision.reason });
  }

  const customerId = payload.customer?.id === undefined ? null : String(payload.customer.id);

  const assembled = await assembleCustomerData({
    shopDomain: targetShop,
    customerId,
    ordersRequested: payload.orders_requested,
    customerEmail: payload.customer?.email ?? null
  });

  // There is no job queue in this app, so the assembled bundle is persisted
  // synchronously. The merchant has 30 days to hand it to the customer and can
  // read it straight off the ComplianceRequest row.
  const record = await persistComplianceRequest({
    shopDomain: targetShop,
    shopifyShopId: payload.shop_id === undefined ? null : String(payload.shop_id),
    topic: "customers/data_request",
    webhookId,
    customerId,
    customerEmail: payload.customer?.email ?? null,
    payload,
    assembled,
    status: assembled.matchedOrderIds.length > 0 ? "RESOLVED" : "NO_DATA",
    resolvedAt: new Date()
  });

  // Deliberately does NOT echo the personal data back in the HTTP response -
  // webhook responses are not an authenticated channel to the data subject.
  return NextResponse.json({
    ok: true,
    complianceRequestId: record.id,
    ordersFound: assembled.matchedOrderIds.length,
    disputesFound: assembled.disputes.length
  });
}
