import { db } from "@/lib/db";
import { encryptString } from "@/lib/crypto";
import { createShopifyAdminClient } from "@/lib/shopify/client";

const WEBHOOK_SUBSCRIPTION_MUTATION = `#graphql
  mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $uri: URL!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $uri, format: JSON }
    ) {
      userErrors {
        field
        message
      }
      webhookSubscription {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
`;

const SHOP_INFO_QUERY = `#graphql
  query ShopInfo {
    shop {
      id
      name
      myshopifyDomain
      currencyCode
      plan {
        displayName
      }
    }
  }
`;

// NOTE: the three mandatory privacy topics (customers/data_request,
// customers/redact, shop/redact) are NOT registrable here - they are not valid
// `WebhookSubscriptionTopic` enum values. They are app-level configuration and
// live in shopify.app.toml under `[[webhooks.subscriptions]]` / `compliance_topics`.
const installWebhookDefinitions = [
  { topic: "DISPUTES_CREATE", path: "/api/webhooks/disputes/create" },
  { topic: "DISPUTES_UPDATE", path: "/api/webhooks/disputes/update" },
  // Required so a retained access token is destroyed the moment the merchant
  // removes the app, instead of lingering until shop/redact arrives 48h later.
  { topic: "APP_UNINSTALLED", path: "/api/webhooks/app/uninstalled" }
] as const;

type InstallResult = {
  merchantId: string;
  shopDomain: string;
};

type WebhookRegistrationResult = {
  registered: string[];
  skipped: Array<{
    topic: string;
    reason: string;
  }>;
};

async function graphqlRequest<T>(
  storeDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const client = createShopifyAdminClient({ storeDomain, accessToken });
  const response = await client.request(query, { variables });

  if (response.errors?.graphQLErrors?.length) {
    throw new Error(response.errors.graphQLErrors.map((error) => error.message).join("; "));
  }

  return response.data as T;
}

export async function exchangeCodeForAccessToken(shop: string, code: string) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
      // Expiring offline tokens are mandatory for new public apps since
      // 1 Apr 2026 and for all public apps from 1 Jan 2027.
      expiring: 1
    })
  });

  if (!response.ok) {
    throw new Error(`Access token exchange failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    scope: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
  };

  return payload;
}

export async function persistMerchantInstall(shop: string, accessToken: string): Promise<InstallResult> {
  const shopData = await graphqlRequest<{
    shop: { id: string; myshopifyDomain: string };
  }>(shop, accessToken, SHOP_INFO_QUERY);

  const merchant = await db.merchant.upsert({
    where: { shopDomain: shop },
    update: {
      shopifyShopId: shopData.shop.id,
      accessTokenEncrypted: encryptString(accessToken),
      uninstalledAt: null
    },
    create: {
      shopDomain: shop,
      shopifyShopId: shopData.shop.id,
      accessTokenEncrypted: encryptString(accessToken)
    }
  });

  return {
    merchantId: merchant.id,
    shopDomain: shopData.shop.myshopifyDomain
  };
}

export async function registerWebhooks(shop: string, accessToken: string) {
  const results: WebhookRegistrationResult = {
    registered: [],
    skipped: []
  };

  for (const definition of installWebhookDefinitions) {
    const data = await graphqlRequest<{
      webhookSubscriptionCreate: {
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>(shop, accessToken, WEBHOOK_SUBSCRIPTION_MUTATION, {
      topic: definition.topic,
      uri: `${process.env.SHOPIFY_APP_URL}${definition.path}`
    });

    if (data.webhookSubscriptionCreate.userErrors.length > 0) {
      const reason = data.webhookSubscriptionCreate.userErrors.map((error) => error.message).join(", ");
      const isProtectedCustomerDataError = reason
        .toLowerCase()
        .includes("protected customer data");

      if (isProtectedCustomerDataError) {
        console.warn(`Skipping webhook ${definition.topic}: ${reason}`);
        results.skipped.push({
          topic: definition.topic,
          reason
        });
        continue;
      }

      throw new Error(`Webhook registration failed for ${definition.topic}: ${reason}`);
    }

    results.registered.push(definition.topic);
  }

  return results;
}
