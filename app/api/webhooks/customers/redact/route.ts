import { NextResponse } from "next/server";

import { redactCustomer } from "@/lib/compliance/redaction";
import { persistComplianceRequest } from "@/lib/compliance/requests";
import { parseJsonPayload, type CustomersRedactPayload } from "@/lib/compliance/types";
import { guardWebhookDelivery } from "@/lib/shopify/webhook-replay";
import { verifyShopifyWebhook } from "@/lib/shopify/webhooks";

export async function POST(request: Request) {
  const { isValid, shopDomain, body, webhookId, triggeredAt, apiVersion, topic } =
    await verifyShopifyWebhook(request);

  if (!isValid) {
    return new NextResponse("Invalid webhook", { status: 401 });
  }

  const payload = parseJsonPayload<CustomersRedactPayload>(body);
  const targetShop = payload.shop_domain ?? shopDomain;

  if (!targetShop) {
    return new NextResponse("Missing shop domain", { status: 400 });
  }

  const decision = await guardWebhookDelivery({
    webhookId,
    topic: topic ?? "customers/redact",
    shopDomain: targetShop,
    triggeredAt,
    apiVersion
  });

  if (!decision.process) {
    return NextResponse.json({ ok: true, skipped: decision.reason });
  }

  const result = await redactCustomer({
    shopDomain: targetShop,
    ordersToRedact: payload.orders_to_redact,
    customerEmail: payload.customer?.email ?? null
  });

  await persistComplianceRequest({
    shopDomain: targetShop,
    shopifyShopId: payload.shop_id === undefined ? null : String(payload.shop_id),
    topic: "customers/redact",
    webhookId,
    customerId: payload.customer?.id === undefined ? null : String(payload.customer.id),
    customerEmail: payload.customer?.email ?? null,
    payload,
    assembled: {
      matchedBy: result.matchedBy,
      matchedOrderIds: result.matchedOrderIds,
      orderSnapshotsRedacted: result.orderSnapshotsRedacted,
      disputesScrubbed: result.disputesScrubbed,
      evidenceItemsScrubbed: result.evidenceItemsScrubbed
    },
    status: result.orderSnapshotsRedacted > 0 ? "RESOLVED" : "NO_DATA",
    resolvedAt: new Date()
  });

  return NextResponse.json({
    ok: true,
    ordersRedacted: result.orderSnapshotsRedacted,
    disputesScrubbed: result.disputesScrubbed
  });
}
