export const env = {
  shopifyApiKey: process.env.SHOPIFY_API_KEY ?? "",
  shopifyApiSecret: process.env.SHOPIFY_API_SECRET ?? "",
  shopifyAppUrl: process.env.SHOPIFY_APP_URL ?? "",
  shopifyScopes: process.env.SHOPIFY_SCOPES ?? "",
  shopifyWebhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET ?? ""
};

export function assertRequiredEnv() {
  const missing = Object.entries(env)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
