import { createAdminApiClient } from "@shopify/admin-api-client";

type ShopifyGraphQLClientOptions = {
  storeDomain: string;
  accessToken: string;
};

export function createShopifyAdminClient(options: ShopifyGraphQLClientOptions) {
  return createAdminApiClient({
    storeDomain: options.storeDomain,
    // 2025-10 sunsets on 16 Oct 2026; this matches the webhook api_version
    // declared in shopify.app.toml.
    apiVersion: "2026-01",
    accessToken: options.accessToken
  });
}
