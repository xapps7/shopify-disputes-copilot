import { env } from "@/lib/env";

export const shopifyConfig = {
  apiKey: env.shopifyApiKey,
  apiSecret: env.shopifyApiSecret,
  appUrl: env.shopifyAppUrl,
  scopes: env.shopifyScopes.split(",").map((scope) => scope.trim()),
  webhookSecret: env.shopifyWebhookSecret
};
