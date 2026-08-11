import { isValidWebhookHmac } from "@/lib/compliance/hmac";
import { shopifyConfig } from "@/lib/shopify/config";

export type ShopifyWebhookVerification = {
  isValid: boolean;
  topic: string | null;
  shopDomain: string | null;
  body: string;
  /**
   * `X-Shopify-Webhook-Id` - stable across retries of the same delivery, so it
   * is the dedupe key for replay protection.
   */
  webhookId: string | null;
  /** `X-Shopify-Triggered-At` - RFC3339. Bounds how long a captured body is useful. */
  triggeredAt: string | null;
  /** `X-Shopify-API-Version` - the version the payload was serialized with. */
  apiVersion: string | null;
};

export async function verifyShopifyWebhook(request: Request): Promise<ShopifyWebhookVerification> {
  const body = await request.text();
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic");
  const shopDomain = request.headers.get("x-shopify-shop-domain");
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const triggeredAt = request.headers.get("x-shopify-triggered-at");
  const apiVersion = request.headers.get("x-shopify-api-version");

  // NOTE: the HMAC covers the BODY ONLY. Every header above - including
  // `x-shopify-shop-domain`, which callers use to select the tenant - is
  // unauthenticated and replayable. Callers must pair this with the replay guard
  // in `@/lib/shopify/webhook-replay`.
  const isValid = isValidWebhookHmac(body, hmacHeader, shopifyConfig.webhookSecret);

  return { isValid, topic, shopDomain, body, webhookId, triggeredAt, apiVersion };
}
