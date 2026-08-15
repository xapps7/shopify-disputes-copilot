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

const WEBHOOK_SUBSCRIPTIONS_QUERY = `#graphql
  query ShopWebhookSubscriptions($cursor: String) {
    webhookSubscriptions(first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
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

const WEBHOOK_SUBSCRIPTION_DELETE_MUTATION = `#graphql
  mutation DeleteWebhook($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors {
        field
        message
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
//
// Since the move to Shopify-managed installation these three are ALSO declared
// in shopify.app.toml, because managed install never calls the app and so this
// code no longer runs on install. The list is kept because the legacy OAuth
// callback is retained as a rollback path, and because `reconcileShopWebhooks`
// needs to know which shop-scoped subscriptions the app config now supersedes.
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

export type WebhookReconciliationResult = {
  deleted: Array<{ id: string; topic: string; callbackUrl: string }>;
  kept: Array<{ id: string; topic: string; callbackUrl: string }>;
  errors: string[];
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

/**
 * Persists an install.
 *
 * `expires_in` and `refresh_token` are stored, not discarded: since `expiring: 1`
 * was added above, the token Shopify returns here dies after an hour. Recording
 * it as if it were the old non-expiring kind left `accessTokenExpiresAt` null,
 * which made `ensureMerchantAccessToken` believe a dead token was still good and
 * gave it no refresh token to recover with.
 */
export async function persistMerchantInstall(
  shop: string,
  token:
    | string
    | {
        access_token: string;
        expires_in?: number;
        refresh_token?: string;
        refresh_token_expires_in?: number;
      }
): Promise<InstallResult> {
  const payload = typeof token === "string" ? { access_token: token } : token;
  const now = Date.now();

  const shopData = await graphqlRequest<{
    shop: { id: string; myshopifyDomain: string };
  }>(shop, payload.access_token, SHOP_INFO_QUERY);

  const tokenFields = {
    accessTokenEncrypted: encryptString(payload.access_token),
    accessTokenExpiresAt: payload.expires_in ? new Date(now + payload.expires_in * 1000) : null,
    refreshTokenEncrypted: payload.refresh_token ? encryptString(payload.refresh_token) : null,
    refreshTokenExpiresAt: payload.refresh_token_expires_in
      ? new Date(now + payload.refresh_token_expires_in * 1000)
      : null
  };

  const merchant = await db.merchant.upsert({
    where: { shopDomain: shop },
    update: {
      shopifyShopId: shopData.shop.id,
      ...tokenFields,
      uninstalledAt: null
    },
    create: {
      shopDomain: shop,
      shopifyShopId: shopData.shop.id,
      ...tokenFields
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

/**
 * Removes shop-scoped webhook subscriptions that the app configuration now owns.
 *
 * These two mechanisms are independent: subscriptions declared in
 * shopify.app.toml are app-scoped and do not appear in `webhookSubscriptions`,
 * which only returns the ones this app created through the Admin API. A store
 * that was installed under the legacy flow therefore ends up subscribed twice
 * to the same topic and receives every dispute event twice.
 *
 * The handlers upsert, so a duplicate is harmless - but it doubles the traffic
 * and makes the logs lie about how many events Shopify actually sent.
 *
 * Deletes only subscriptions whose callback URL points at this app's own
 * endpoints, so an unrelated subscription a merchant added by hand is untouched.
 */
export async function reconcileShopWebhooks(
  shop: string,
  accessToken: string
): Promise<WebhookReconciliationResult> {
  const result: WebhookReconciliationResult = { deleted: [], kept: [], errors: [] };

  const appUrl = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/+$/, "");
  const ownedUrls = new Set(
    installWebhookDefinitions.map((definition) => `${appUrl}${definition.path}`)
  );

  type SubscriptionNode = {
    id: string;
    topic: string;
    endpoint: { __typename: string; callbackUrl?: string | null };
  };

  const subscriptions: SubscriptionNode[] = [];
  let cursor: string | null = null;

  do {
    const page: {
      webhookSubscriptions: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: SubscriptionNode[];
      };
    } = await graphqlRequest(shop, accessToken, WEBHOOK_SUBSCRIPTIONS_QUERY, { cursor });

    subscriptions.push(...page.webhookSubscriptions.nodes);
    cursor = page.webhookSubscriptions.pageInfo.hasNextPage
      ? page.webhookSubscriptions.pageInfo.endCursor
      : null;
  } while (cursor);

  for (const subscription of subscriptions) {
    const callbackUrl = subscription.endpoint?.callbackUrl ?? "";
    const entry = { id: subscription.id, topic: subscription.topic, callbackUrl };

    if (!ownedUrls.has(callbackUrl)) {
      result.kept.push(entry);
      continue;
    }

    try {
      const data = await graphqlRequest<{
        webhookSubscriptionDelete: {
          userErrors: Array<{ field: string[] | null; message: string }>;
        };
      }>(shop, accessToken, WEBHOOK_SUBSCRIPTION_DELETE_MUTATION, { id: subscription.id });

      const userErrors = data.webhookSubscriptionDelete.userErrors;
      if (userErrors.length > 0) {
        result.errors.push(
          `${subscription.topic}: ${userErrors.map((error) => error.message).join(", ")}`
        );
        result.kept.push(entry);
        continue;
      }

      result.deleted.push(entry);
    } catch (error) {
      result.errors.push(
        `${subscription.topic}: ${error instanceof Error ? error.message : "delete failed"}`
      );
      result.kept.push(entry);
    }
  }

  return result;
}
