import { NextResponse } from "next/server";

import { upsertDisputeFromWebhook } from "@/lib/disputes/sync";
import { verifyShopifyWebhook } from "@/lib/shopify/webhooks";

export async function POST(request: Request) {
  const { isValid, shopDomain, body } = await verifyShopifyWebhook(request);

  if (!isValid || !shopDomain) {
    return new NextResponse("Invalid webhook", { status: 401 });
  }

  const payload = JSON.parse(body);
  await upsertDisputeFromWebhook(shopDomain, payload);

  return NextResponse.json({ ok: true });
}
