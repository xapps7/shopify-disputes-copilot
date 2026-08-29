import { NextResponse } from "next/server";

/**
 * DISABLED. The legacy OAuth callback.
 *
 * Shopify-managed installation is on (`use_legacy_install_flow = false`), so
 * Shopify never redirects here. The only way to reach this route was through
 * `/api/auth/install`, which is disabled for the same reason.
 *
 * Leaving it live was the risk. `middleware.ts` exempts `/api/auth` from every
 * check, and a completed grant here called `registerWebhooks`, which creates
 * SHOP-scoped webhook subscriptions. The TOML already declares those topics
 * app-scoped, so the store ends up subscribed twice and every dispute event
 * arrives twice - duplicate timeline rows, duplicate alerts, and the cleanup
 * job at `/api/admin/reconcile-webhooks` to undo it.
 *
 * Kept rather than deleted so the path back is obvious. To move to legacy
 * install: set `use_legacy_install_flow = true` in the TOML, keep
 * `[auth] redirect_urls` pointing at this path, remove the `/api/auth`
 * exemption in `middleware.ts` or give this route a check of its own, restore
 * the body below, and make `registerWebhooks` skip topics the TOML already
 * declares.
 *
 * 410 Gone, not 404: the route existed and is deliberately retired.
 */
const GONE_MESSAGE = "Legacy OAuth callback is disabled. This app uses Shopify-managed installation.";

export function GET() {
  return new NextResponse(GONE_MESSAGE, { status: 410 });
}

/* The legacy implementation, kept for reference:
 *
 * import {
 *   buildEmbeddedAppUrl,
 *   consumeOauthState,
 *   normalizeShopDomain,
 *   setCurrentHost,
 *   setCurrentShopDomain,
 *   verifyOAuthCallback
 * } from "@/lib/shopify/auth";
 * import {
 *   exchangeCodeForAccessToken,
 *   persistMerchantInstall,
 *   registerWebhooks
 * } from "@/lib/shopify/install";
 *
 * export async function GET(request: Request) {
 *   try {
 *     const url = new URL(request.url);
 *     const shopParam = url.searchParams.get("shop");
 *     const code = url.searchParams.get("code");
 *     const state = url.searchParams.get("state");
 *     const host = url.searchParams.get("host");
 *
 *     if (!shopParam || !code || !state) {
 *       return new NextResponse("Missing OAuth callback parameters.", { status: 400 });
 *     }
 *
 *     if (!verifyOAuthCallback(url.searchParams)) {
 *       return new NextResponse("Invalid OAuth callback signature.", { status: 401 });
 *     }
 *
 *     const storedState = await consumeOauthState();
 *     if (!storedState || storedState !== state) {
 *       return new NextResponse("Invalid OAuth state.", { status: 401 });
 *     }
 *
 *     const shop = normalizeShopDomain(shopParam);
 *     const tokenPayload = await exchangeCodeForAccessToken(shop, code);
 *
 *     await persistMerchantInstall(shop, tokenPayload);
 *     const webhookResult = await registerWebhooks(shop, tokenPayload.access_token);
 *     await Promise.all([
 *       setCurrentShopDomain(shop),
 *       host ? setCurrentHost(host) : Promise.resolve()
 *     ]);
 *
 *     if (webhookResult.skipped.length > 0) {
 *       console.warn("OAuth callback completed with skipped webhooks", webhookResult);
 *     }
 *
 *     return NextResponse.redirect(buildEmbeddedAppUrl(shop, "/", host));
 *   } catch (error) {
 *     console.error("OAuth callback failed", error);
 *     return new NextResponse("OAuth callback failed.", { status: 500 });
 *   }
 * }
 */
