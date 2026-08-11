import { NextResponse } from "next/server";

import { upsertDisputeFromWebhook } from "@/lib/disputes/sync";
import { guardWebhookDelivery } from "@/lib/shopify/webhook-replay";
import { verifyShopifyWebhook } from "@/lib/shopify/webhooks";

export async function POST(request: Request) {
  const { isValid, shopDomain, body, webhookId, triggeredAt, apiVersion, topic } =
    await verifyShopifyWebhook(request);

  if (!isValid || !shopDomain) {
    return new NextResponse("Invalid webhook", { status: 401 });
  }

  // `shopDomain` comes from an unsigned header and selects the tenant, so a
  // captured body can be replayed against another shop. Bound the window and
  // dedupe on the delivery id.
  const decision = await guardWebhookDelivery({
    webhookId,
    topic: topic ?? "disputes/create",
    shopDomain,
    triggeredAt,
    apiVersion
  });

  if (!decision.process) {
    return NextResponse.json({ ok: true, skipped: decision.reason });
  }

  const payload = JSON.parse(body);
  await upsertDisputeFromWebhook(shopDomain, payload);

  return NextResponse.json({ ok: true });
}
