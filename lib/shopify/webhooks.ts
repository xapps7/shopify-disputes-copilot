import crypto from "node:crypto";

import { shopifyConfig } from "@/lib/shopify/config";

export async function verifyShopifyWebhook(request: Request): Promise<{
  isValid: boolean;
  topic: string | null;
  shopDomain: string | null;
  body: string;
}> {
  const body = await request.text();
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic");
  const shopDomain = request.headers.get("x-shopify-shop-domain");

  if (!hmacHeader) {
    return { isValid: false, topic, shopDomain, body };
  }

  const digest = crypto
    .createHmac("sha256", shopifyConfig.webhookSecret)
    .update(body, "utf8")
    .digest("base64");

  const digestBuffer = Buffer.from(digest);
  const headerBuffer = Buffer.from(hmacHeader);
  const isValid =
    digestBuffer.length === headerBuffer.length &&
    crypto.timingSafeEqual(digestBuffer, headerBuffer);

  return { isValid, topic, shopDomain, body };
}
