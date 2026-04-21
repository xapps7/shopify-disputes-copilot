import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { decryptString } from "@/lib/crypto";
import { resolveShopDomain } from "@/lib/shopify/auth";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import {
  ACCESS_SCOPES_DEBUG_QUERY,
  BASIC_ORDERS_DEBUG_QUERY,
  DISPUTES_LIST_QUERY,
  ORDERS_WITH_DISPUTES_QUERY,
  SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY
} from "@/lib/shopify/queries";

type ShopifyGraphqlError = {
  message?: string;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const shopDomain = await resolveShopDomain({ shop: url.searchParams.get("shop") ?? undefined });

    if (!shopDomain) {
      return NextResponse.json({ ok: false, message: "No active shop session found." }, { status: 400 });
    }

    const merchant = await db.merchant.findUnique({
      where: { shopDomain },
      select: {
        id: true,
        accessTokenEncrypted: true,
        installedAt: true,
        updatedAt: true
      }
    });

    if (!merchant?.accessTokenEncrypted) {
      return NextResponse.json(
        {
          ok: false,
          shopDomain,
          merchantInstalled: Boolean(merchant),
          message: "Merchant is not installed or access token is missing."
        },
        { status: 400 }
      );
    }

    const client = createShopifyAdminClient({
      storeDomain: shopDomain,
      accessToken: decryptString(merchant.accessTokenEncrypted)
    });

    const scopesResponse = await client.request(ACCESS_SCOPES_DEBUG_QUERY);
    const scopeErrors = (
      "errors" in scopesResponse && Array.isArray(scopesResponse.errors) ? scopesResponse.errors : []
    ) as ShopifyGraphqlError[];
    const scopeData = scopesResponse.data as
      | {
          currentAppInstallation?: {
            accessScopes?: Array<{
              handle?: string | null;
            }>;
          } | null;
          shop?: {
            id?: string | null;
            myshopifyDomain?: string | null;
          } | null;
        }
      | undefined;

    const basicOrdersResponse = await client.request(BASIC_ORDERS_DEBUG_QUERY);
    const basicOrderErrors = (
      "errors" in basicOrdersResponse && Array.isArray(basicOrdersResponse.errors)
        ? basicOrdersResponse.errors
        : []
    ) as ShopifyGraphqlError[];
    const basicOrderData = basicOrdersResponse.data as
      | {
          orders?: {
            nodes?: Array<{
              id?: string | null;
              name?: string | null;
              createdAt?: string | null;
              displayFinancialStatus?: string | null;
              displayFulfillmentStatus?: string | null;
            }>;
          };
        }
      | undefined;

    const rootResponse = await client.request(DISPUTES_LIST_QUERY);
    const rootErrors = (
      "errors" in rootResponse && Array.isArray(rootResponse.errors) ? rootResponse.errors : []
    ) as ShopifyGraphqlError[];
    const rootData = rootResponse.data as
      | {
          disputes?: {
            nodes?: Array<{
              id?: string | null;
              status?: string | null;
              type?: string | null;
              reasonDetails?: {
                reason?: string | null;
              } | null;
            }>;
          };
        }
      | undefined;

    const accountResponse = await client.request(SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY);
    const accountErrors = (
      "errors" in accountResponse && Array.isArray(accountResponse.errors) ? accountResponse.errors : []
    ) as ShopifyGraphqlError[];
    const accountData = accountResponse.data as
      | {
          shopifyPaymentsAccount?: {
            disputes?: {
              nodes?: Array<{
                id?: string | null;
                status?: string | null;
                type?: string | null;
                reasonDetails?: {
                  reason?: string | null;
                } | null;
              }>;
            } | null;
          } | null;
        }
      | undefined;

    const ordersResponse = await client.request(ORDERS_WITH_DISPUTES_QUERY);
    const orderErrors = (
      "errors" in ordersResponse && Array.isArray(ordersResponse.errors) ? ordersResponse.errors : []
    ) as ShopifyGraphqlError[];
    const orderData = ordersResponse.data as
      | {
          orders?: {
            nodes?: Array<{
              id?: string | null;
              name?: string | null;
              disputes?: Array<{
                id?: string | null;
                status?: string | null;
                initiatedAs?: string | null;
              }> | null;
            }>;
          };
        }
      | undefined;
    const ordersWithDisputes = (orderData?.orders?.nodes ?? [])
      .filter((order) => (order.disputes ?? []).length > 0)
      .map((order) => ({
        id: order.id,
        name: order.name,
        disputes: order.disputes
      }));

    return NextResponse.json({
      ok: true,
      shopDomain,
      merchant: {
        id: merchant.id,
        installedAt: merchant.installedAt,
        updatedAt: merchant.updatedAt
      },
      installation: {
        shop: scopeData?.shop ?? null,
        grantedScopes: (scopeData?.currentAppInstallation?.accessScopes ?? [])
          .map((scope) => scope.handle)
          .filter(Boolean),
        errors: scopeErrors.map((error) => error.message).filter(Boolean)
      },
      basicOrders: {
        count: basicOrderData?.orders?.nodes?.length ?? 0,
        errors: basicOrderErrors.map((error) => error.message).filter(Boolean),
        sample: (basicOrderData?.orders?.nodes ?? []).slice(0, 10)
      },
      rootDisputes: {
        count: rootData?.disputes?.nodes?.length ?? 0,
        errors: rootErrors.map((error) => error.message).filter(Boolean),
        sample: (rootData?.disputes?.nodes ?? []).slice(0, 5)
      },
      shopifyPaymentsAccountDisputes: {
        count: accountData?.shopifyPaymentsAccount?.disputes?.nodes?.length ?? 0,
        errors: accountErrors.map((error) => error.message).filter(Boolean),
        sample: (accountData?.shopifyPaymentsAccount?.disputes?.nodes ?? []).slice(0, 5)
      },
      orderDisputeSummaries: {
        scannedOrders: orderData?.orders?.nodes?.length ?? 0,
        count: ordersWithDisputes.reduce((total, order) => total + (order.disputes?.length ?? 0), 0),
        errors: orderErrors.map((error) => error.message).filter(Boolean),
        sample: ordersWithDisputes.slice(0, 5)
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to inspect disputes."
      },
      { status: 500 }
    );
  }
}
