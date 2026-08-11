import { NextResponse } from "next/server";

import { redactShop } from "@/lib/compliance/redaction";
import { persistComplianceRequest } from "@/lib/compliance/requests";
import { parseJsonPayload, type ShopRedactPayload } from "@/lib/compliance/types";
import { guardWebhookDelivery } from "@/lib/shopify/webhook-replay";
import { verifyShopifyWebhook } from "@/lib/shopify/webhooks";

export async function POST(request: Request) {
  const { isValid, shopDomain, body, webhookId, triggeredAt, apiVersion, topic } =
    await verifyShopifyWebhook(request);

  if (!isValid) {
    return new NextResponse("Invalid webhook", { status: 401 });
  }

  const payload = parseJsonPayload<ShopRedactPayload>(body);
  // The shop-domain HEADER is not covered by the HMAC. The body is. Prefer the
  // signed value and only fall back to the header when the payload omits it.
  const targetShop = payload.shop_domain ?? shopDomain;

  if (!targetShop) {
    return new NextResponse("Missing shop domain", { status: 400 });
  }

  const decision = await guardWebhookDelivery({
    webhookId,
    topic: topic ?? "shop/redact",
    shopDomain: targetShop,
    triggeredAt,
    apiVersion
  });

  if (!decision.process) {
    // 200 on purpose: neither a replay nor a stale capture is fixed by a retry.
    return NextResponse.json({ ok: true, skipped: decision.reason });
  }

  const result = await redactShop(targetShop);

  if (result.filesPendingDeletion.length > 0) {
    // lib/storage.ts has no delete helper (and is out of scope for this change),
    // so the object keys are persisted on the audit row for a follow-up sweep.
    console.warn(
      `[shop/redact] ${result.filesPendingDeletion.length} stored file(s) for ${targetShop} still require deletion from object storage; recorded on the ComplianceRequest row.`
    );
  }

  await persistComplianceRequest({
    shopDomain: targetShop,
    shopifyShopId: payload.shop_id === undefined ? null : String(payload.shop_id),
    topic: "shop/redact",
    webhookId,
    payload,
    assembled: {
      merchantFound: result.found,
      deleted: result.deleted,
      filesPendingDeletion: result.filesPendingDeletion
    },
    status: result.found ? "RESOLVED" : "NO_DATA",
    resolvedAt: new Date()
  });

  return NextResponse.json({ ok: true, redacted: result.found, deleted: result.deleted });
}
