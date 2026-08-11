import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isDiagnosticsAuthorized } from "@/lib/diagnostics-auth";
import { decryptString } from "@/lib/crypto";
import { getAuthenticatedShopDomain } from "@/lib/shopify/request-context";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { extractGraphqlErrors, graphqlErrorMessages } from "@/lib/shopify/errors";
import { APP_COMMIT, APP_RELEASE } from "@/lib/version";
import {
  ACCESS_SCOPES_DEBUG_QUERY,
  BASIC_ORDERS_DEBUG_QUERY,
  DISPUTES_LIST_QUERY,
  DISPUTES_LIST_NO_CUSTOMER_QUERY,
  ORDER_BY_ID_DEBUG_QUERY,
  ORDERS_WITH_DISPUTES_QUERY,
  ORDERS_BY_SEARCH_DEBUG_QUERY,
  PROBE_ORDERS_CUSTOMER_ONLY_QUERY,
  PROBE_ORDERS_CUSTOMER_PII_QUERY,
  PROBE_ORDERS_DISPUTES_ONLY_QUERY,
  PROBE_ORDERS_MONEY_ONLY_QUERY,
  PROBE_ORDER_BY_ID_MINIMAL_QUERY,
  PROBE_ROOT_DISPUTES_MINIMAL_QUERY,
  PROBE_SHOPIFY_PAYMENTS_ACCOUNT_QUERY,
  RECENT_ORDERS_WITH_DETAILS_QUERY,
  SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY
} from "@/lib/shopify/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AdminClient = ReturnType<typeof createShopifyAdminClient>;

type ProbeResult = {
  ok: boolean;
  dataPresent: boolean;
  errors: string[];
  errorCodes: string[];
  data: unknown;
};

async function runProbe(
  client: AdminClient,
  query: string,
  variables?: Record<string, unknown>
): Promise<ProbeResult> {
  try {
    const response = await client.request(query, variables ? { variables } : undefined);
    const errors = extractGraphqlErrors(response);
    const data = (response as { data?: unknown }).data ?? null;

    return {
      ok: errors.length === 0,
      dataPresent: data !== null && data !== undefined,
      errors: graphqlErrorMessages(response),
      errorCodes: errors.map((error) => error.code).filter((code): code is string => Boolean(code)),
      data
    };
  } catch (error) {
    return {
      ok: false,
      dataPresent: false,
      errors: [error instanceof Error ? error.message : "Unknown request failure"],
      errorCodes: ["THROWN"],
      data: null
    };
  }
}

/** Keeps the response readable — probes are for diagnosis, not bulk data. */
function trim(probe: ProbeResult, limit = 5): ProbeResult {
  const data = probe.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object") {
    return probe;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const nodes = (value as { nodes?: unknown[] } | null)?.nodes;
    clone[key] = Array.isArray(nodes)
      ? { count: nodes.length, nodes: nodes.slice(0, limit) }
      : value;
  }

  return { ...probe, data: clone };
}

export async function GET(request: Request) {
  try {
    if (!isDiagnosticsAuthorized(request)) {
      // 404 rather than 401 so the endpoint's existence is not advertised.
      return NextResponse.json({ ok: false, message: "Not found." }, { status: 404 });
    }

    const url = new URL(request.url);
    const shopDomain = await getAuthenticatedShopDomain(request);
    const orderId = url.searchParams.get("orderId");
    const orderName = url.searchParams.get("orderName");

    if (!shopDomain) {
      return NextResponse.json({ ok: false, message: "No active shop session found." }, { status: 400 });
    }

    const merchant = await db.merchant.findUnique({
      where: { shopDomain },
      select: { id: true, accessTokenEncrypted: true, installedAt: true, updatedAt: true }
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

    const orderGid = orderId
      ? orderId.startsWith("gid://shopify/Order/")
        ? orderId
        : `gid://shopify/Order/${orderId}`
      : null;

    const scopes = await runProbe(client, ACCESS_SCOPES_DEBUG_QUERY);
    const scopeData = scopes.data as
      | {
          currentAppInstallation?: { accessScopes?: Array<{ handle?: string | null }> } | null;
          shop?: { id?: string | null; myshopifyDomain?: string | null } | null;
        }
      | null;

    // --- Scope-isolating probes: which single field is nulling the payload? ---
    const probes = {
      ordersBasic: trim(await runProbe(client, BASIC_ORDERS_DEBUG_QUERY)),
      ordersDisputesOnly: trim(await runProbe(client, PROBE_ORDERS_DISPUTES_ONLY_QUERY), 20),
      ordersMoneyOnly: trim(await runProbe(client, PROBE_ORDERS_MONEY_ONLY_QUERY)),
      ordersCustomerIdOnly: trim(await runProbe(client, PROBE_ORDERS_CUSTOMER_ONLY_QUERY)),
      ordersCustomerPii: trim(await runProbe(client, PROBE_ORDERS_CUSTOMER_PII_QUERY)),
      rootDisputesMinimal: trim(await runProbe(client, PROBE_ROOT_DISPUTES_MINIMAL_QUERY), 25),
      shopifyPaymentsAccount: await runProbe(client, PROBE_SHOPIFY_PAYMENTS_ACCOUNT_QUERY),
      orderByIdMinimal: orderGid
        ? await runProbe(client, PROBE_ORDER_BY_ID_MINIMAL_QUERY, { id: orderGid })
        : null
    };

    // --- The real production queries, now with honest error reporting ---
    const live = {
      recentOrdersWithDetails: trim(await runProbe(client, RECENT_ORDERS_WITH_DETAILS_QUERY), 10),
      disputesListNoCustomer: trim(await runProbe(client, DISPUTES_LIST_NO_CUSTOMER_QUERY), 10),
      disputesList: trim(await runProbe(client, DISPUTES_LIST_QUERY), 10),
      shopifyPaymentsAccountDisputes: trim(await runProbe(client, SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY), 10),
      ordersWithDisputes: trim(await runProbe(client, ORDERS_WITH_DISPUTES_QUERY), 10),
      orderById: orderGid ? await runProbe(client, ORDER_BY_ID_DEBUG_QUERY, { id: orderGid }) : null,
      orderByName: orderName
        ? await runProbe(client, ORDERS_BY_SEARCH_DEBUG_QUERY, { query: `name:${orderName}` })
        : null
    };

    // --- Plain-language verdict so nobody has to eyeball the payload ---
    const grantedScopes = (scopeData?.currentAppInstallation?.accessScopes ?? [])
      .map((scope) => scope.handle)
      .filter((handle): handle is string => Boolean(handle));

    const findings: string[] = [];

    // A schema error (undefinedField) is fatal: Shopify rejects the whole query
    // at validation time, so `data` comes back null and the sync sees "0 results".
    const schemaBroken = Object.entries(live)
      .filter(([, probe]) => probe && probe.errorCodes.includes("undefinedField"))
      .map(([name]) => name);

    if (schemaBroken.length > 0) {
      findings.push(
        `BROKEN QUERY SHAPE in: ${schemaBroken.join(", ")}. Shopify rejected these at validation time, ` +
          "so the entire data payload is null. This - not scopes - is what makes dispute ingestion return 0."
      );
    }

    if (!grantedScopes.includes("read_customers")) {
      findings.push(
        "MISSING SCOPE read_customers - customer name/email will be null. NOTE: this denial is field-level " +
          "(data is still returned), so it does NOT block dispute ingestion. Amounts and order data are unaffected."
      );
    }

    const disputeCount = (probes.rootDisputesMinimal.data as { disputes?: { count?: number } } | null)?.disputes
      ?.count;

    if (probes.rootDisputesMinimal.ok && disputeCount === 0) {
      findings.push(
        "Top-level disputes query succeeded but returned 0 rows. If the store shows a chargeback in Admin, " +
          "the store is likely on Bogus Gateway rather than Shopify Payments test mode - Bogus Gateway " +
          "produces no ShopifyPaymentsDispute records at all."
      );
    }

    if (probes.rootDisputesMinimal.ok && (disputeCount ?? 0) > 0) {
      findings.push(
        `Shopify has ${disputeCount} dispute(s) available via the top-level disputes query. ` +
          "If the app shows fewer, the gap is in our ingestion, not in Shopify."
      );
    }

    if (!probes.shopifyPaymentsAccount.ok) {
      findings.push(
        "shopifyPaymentsAccount is not readable (needs read_shopify_payments_accounts). " +
          "Non-blocking: the top-level `disputes` query is used instead and needs only " +
          "read_shopify_payments_disputes."
      );
    }

    if (findings.length === 0) {
      findings.push("No blocking scope or query-shape problem detected in the probes.");
    }

    return NextResponse.json({
      ok: true,
      shopDomain,
      build: { release: APP_RELEASE, commit: APP_COMMIT },
      merchant: { id: merchant.id, installedAt: merchant.installedAt, updatedAt: merchant.updatedAt },
      installation: {
        shop: scopeData?.shop ?? null,
        grantedScopes,
        errors: scopes.errors
      },
      findings,
      probes,
      live,
      targetedOrder: { orderId: orderGid, orderName }
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to inspect disputes." },
      { status: 500 }
    );
  }
}
