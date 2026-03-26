import { createAdminApiClient } from "@shopify/admin-api-client";

type ShopifyGraphQLClientOptions = {
  storeDomain: string;
  accessToken: string;
};

export function createShopifyAdminClient(options: ShopifyGraphQLClientOptions) {
  return createAdminApiClient({
    storeDomain: options.storeDomain,
    apiVersion: "2025-10",
    accessToken: options.accessToken
  });
}
