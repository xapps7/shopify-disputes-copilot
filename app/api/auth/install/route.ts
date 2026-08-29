import { NextResponse } from "next/server";

/**
 * DISABLED. The legacy OAuth install path.
 *
 * This app uses Shopify-managed installation
 * (`use_legacy_install_flow = false` in shopify.app.disputes-co-pilot.toml), so
 * Shopify never calls this route. Nothing legitimate reaches it.
 *
 * What it did while live was start an OAuth grant for whatever `?shop=` a
 * caller supplied. There is no authentication here and `middleware.ts` exempts
 * `/api/auth` from every check, so it was a public endpoint that would set
 * cookies and redirect a browser at any myshopify domain a stranger named. If a
 * grant ever completed, `/api/auth/callback` then registered SHOP-scoped
 * webhooks on top of the app-scoped ones declared in the TOML, and every
 * webhook would be delivered twice - the exact duplication
 * `/api/admin/reconcile-webhooks` exists to clean up.
 *
 * Kept rather than deleted so the path back is obvious. To move to legacy
 * install: set `use_legacy_install_flow = true` in the TOML, remove the `/api/auth`
 * exemption in `middleware.ts` or replace it with a check of its own, restore the
 * body below, and make sure `registerWebhooks` no longer duplicates the
 * app-scoped subscriptions.
 *
 * 410 Gone, not 404: this route existed, it is deliberately retired, and a 410
 * says so to anyone who has an old link.
 */
const GONE_MESSAGE = "Legacy OAuth install is disabled. This app uses Shopify-managed installation.";

export function GET() {
  return new NextResponse(GONE_MESSAGE, { status: 410 });
}

/* The legacy implementation, kept for reference:
 *
 * import {
 *   buildInstallUrl,
 *   createOauthState,
 *   normalizeShopDomain,
 *   setCurrentHost,
 *   setCurrentShopDomain,
 *   setOauthState
 * } from "@/lib/shopify/auth";
 *
 * export async function GET(request: Request) {
 *   try {
 *     const { searchParams } = new URL(request.url);
 *     const shop = searchParams.get("shop");
 *     const host = searchParams.get("host");
 *
 *     if (!shop) {
 *       console.error("Install route failed: missing shop parameter");
 *       return new NextResponse("Missing shop parameter", { status: 400 });
 *     }
 *
 *     const normalizedShop = normalizeShopDomain(shop);
 *     const state = createOauthState();
 *
 *     await Promise.all([
 *       setCurrentShopDomain(normalizedShop),
 *       setOauthState(state),
 *       host ? setCurrentHost(host) : Promise.resolve()
 *     ]);
 *
 *     return NextResponse.redirect(buildInstallUrl(normalizedShop, state));
 *   } catch (error) {
 *     console.error("Install route failed", error);
 *     return new NextResponse("Install route failed.", { status: 500 });
 *   }
 * }
 */
