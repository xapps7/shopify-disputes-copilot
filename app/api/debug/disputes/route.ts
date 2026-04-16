import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { decryptString } from "@/lib/crypto";
import { resolveShopDomain } from "@/lib/shopify/auth";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import {
  DISPUTES_LIST_QUERY,
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

    return NextResponse.json({
      ok: true,
      shopDomain,
      merchant: {
        id: merchant.id,
        installedAt: merchant.installedAt,
        updatedAt: merchant.updatedAt
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
