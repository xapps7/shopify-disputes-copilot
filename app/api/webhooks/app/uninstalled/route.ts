import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { parseJsonPayload } from "@/lib/compliance/types";
import { guardWebhookDelivery } from "@/lib/shopify/webhook-replay";
import { verifyShopifyWebhook } from "@/lib/shopify/webhooks";

type AppUninstalledPayload = {
  id?: number | string;
  domain?: string;
  myshopify_domain?: string;
};

export async function POST(request: Request) {
  const { isValid, shopDomain, body, webhookId, triggeredAt, apiVersion, topic } =
    await verifyShopifyWebhook(request);

  if (!isValid) {
    return new NextResponse("Invalid webhook", { status: 401 });
  }

  const payload = parseJsonPayload<AppUninstalledPayload>(body);
  const targetShop = payload.myshopify_domain ?? shopDomain;

  if (!targetShop) {
    return new NextResponse("Missing shop domain", { status: 400 });
  }

  const decision = await guardWebhookDelivery({
    webhookId,
    topic: topic ?? "app/uninstalled",
    shopDomain: targetShop,
    triggeredAt,
    apiVersion
  });

  if (!decision.process) {
    return NextResponse.json({ ok: true, skipped: decision.reason });
  }

  // Both tokens are revoked by Shopify the moment the app is uninstalled, so
  // holding the ciphertext buys nothing and is a standing liability. Clear them.
  //
  // The refresh token matters as much as the access token here: it is the
  // longer-lived of the two (90 days against one hour), so leaving it behind
  // keeps the more valuable secret and discards the cheaper one.
  //
  // updateMany (not update) so an unknown shop is a no-op instead of a P2025 throw,
  // which would make Shopify retry a webhook that can never succeed.
  const { count } = await db.merchant.updateMany({
    where: { shopDomain: targetShop },
    data: {
      uninstalledAt: new Date(),
      accessTokenEncrypted: null,
      accessTokenExpiresAt: null,
      refreshTokenEncrypted: null,
      refreshTokenExpiresAt: null
    }
  });

  return NextResponse.json({ ok: true, updated: count });
}
