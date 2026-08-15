import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { decryptString } from "@/lib/crypto";
import { isDiagnosticsAuthorized } from "@/lib/diagnostics-auth";
import { reconcileShopWebhooks } from "@/lib/shopify/install";
import { getAuthenticatedShopDomain } from "@/lib/shopify/request-context";

/**
 * One-shot cleanup for stores installed under the legacy OAuth flow.
 *
 * Those installs had disputes/create, disputes/update and app/uninstalled
 * registered through the Admin API by the OAuth callback. The same three topics
 * are now declared in shopify.app.toml, and app-scoped subscriptions do not
 * replace shop-scoped ones - they stack. Left alone, such a store receives
 * every dispute event twice.
 *
 * Deliberately manual and diagnostics-gated rather than automatic: deleting
 * webhook subscriptions is destructive, so it should be something you run and
 * read the output of, not something that happens during a page render.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  if (!isDiagnosticsAuthorized(request)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const shopDomain =
    (await getAuthenticatedShopDomain(request)) ??
    new URL(request.url).searchParams.get("shop");

  if (!shopDomain) {
    return NextResponse.json({ ok: false, message: "No shop for this request." }, { status: 400 });
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    select: { accessTokenEncrypted: true }
  });

  if (!merchant?.accessTokenEncrypted) {
    return NextResponse.json(
      { ok: false, message: `No stored access token for ${shopDomain}.` },
      { status: 409 }
    );
  }

  try {
    const result = await reconcileShopWebhooks(shopDomain, decryptString(merchant.accessTokenEncrypted));

    return NextResponse.json({
      ok: true,
      shopDomain,
      deletedCount: result.deleted.length,
      ...result
    });
  } catch (error) {
    console.error("[reconcile-webhooks] failed", error);
    return NextResponse.json({ ok: false, message: "Reconciliation failed." }, { status: 500 });
  }
}

/** GET reports without changing anything, so you can look before you delete. */
export async function GET(request: Request) {
  if (!isDiagnosticsAuthorized(request)) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    message: "POST to this URL with the same token to delete duplicate shop-scoped subscriptions."
  });
}
