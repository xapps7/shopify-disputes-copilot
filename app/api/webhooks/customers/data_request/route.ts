import { NextResponse } from "next/server";

import { verifyShopifyWebhook } from "@/lib/shopify/webhooks";

export async function POST(request: Request) {
  const { isValid } = await verifyShopifyWebhook(request);

  if (!isValid) {
    return new NextResponse("Invalid webhook", { status: 401 });
  }

  return NextResponse.json({ ok: true, action: "queue_customer_data_export" });
}
