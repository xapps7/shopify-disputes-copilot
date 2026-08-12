import { env } from "@/lib/env";

/**
 * Shopify signs app-owned webhooks with the app's CLIENT SECRET. There is no
 * separate "webhook secret" to configure, so deriving it from SHOPIFY_API_SECRET
 * removes a whole class of silent failure: this app shipped with
 * SHOPIFY_WEBHOOK_SECRET pointing at a different app's secret, which made every
 * webhook - including the three mandatory privacy webhooks Shopify tests during
 * review - return 401 while everything else looked healthy.
 *
 * SHOPIFY_WEBHOOK_SECRET is honoured only when it matches, and warns when it
 * does not, so a stale value is visible in the logs instead of silently wrong.
 */
function resolveWebhookSecret() {
  const configured = env.shopifyWebhookSecret?.trim();
  const apiSecret = env.shopifyApiSecret?.trim();

  if (configured && apiSecret && configured !== apiSecret) {
    console.warn(
      "[shopify] SHOPIFY_WEBHOOK_SECRET differs from SHOPIFY_API_SECRET. Shopify signs webhooks " +
        "with the client secret, so the API secret is being used. Remove SHOPIFY_WEBHOOK_SECRET " +
        "or set it to the same value."
    );
  }

  return apiSecret || configured || "";
}

export const shopifyConfig = {
  apiKey: env.shopifyApiKey,
  apiSecret: env.shopifyApiSecret,
  appUrl: env.shopifyAppUrl,
  scopes: env.shopifyScopes.split(",").map((scope) => scope.trim()),
  webhookSecret: resolveWebhookSecret()
};
