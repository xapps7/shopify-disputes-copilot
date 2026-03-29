import { NextResponse } from "next/server";

import {
  consumeOauthState,
  normalizeShopDomain,
  setCurrentShopDomain,
  verifyOAuthCallback
} from "@/lib/shopify/auth";
import {
  exchangeCodeForAccessToken,
  persistMerchantInstall,
  registerWebhooks
} from "@/lib/shopify/install";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const shopParam = url.searchParams.get("shop");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!shopParam || !code || !state) {
      console.error("OAuth callback failed: missing parameters", {
        shopPresent: Boolean(shopParam),
        codePresent: Boolean(code),
        statePresent: Boolean(state)
      });
      return new NextResponse("Missing OAuth callback parameters.", { status: 400 });
    }

    if (!verifyOAuthCallback(url.searchParams)) {
      console.error("OAuth callback failed: invalid callback signature", {
        shop: shopParam
      });
      return new NextResponse("Invalid OAuth callback signature.", { status: 401 });
    }

    const storedState = await consumeOauthState();
    if (!storedState || storedState !== state) {
      console.error("OAuth callback failed: invalid oauth state", {
        shop: shopParam,
        storedStatePresent: Boolean(storedState),
        stateMatches: storedState === state
      });
      return new NextResponse("Invalid OAuth state.", { status: 401 });
    }

    const shop = normalizeShopDomain(shopParam);
    const tokenPayload = await exchangeCodeForAccessToken(shop, code);

    await persistMerchantInstall(shop, tokenPayload.access_token);
    const webhookResult = await registerWebhooks(shop, tokenPayload.access_token);
    await setCurrentShopDomain(shop);

    if (webhookResult.skipped.length > 0) {
      console.warn("OAuth callback completed with skipped webhooks", webhookResult);
    }

    return NextResponse.redirect(`${process.env.SHOPIFY_APP_URL}/dashboard?shop=${shop}`);
  } catch (error) {
    console.error("OAuth callback failed", error);
    return new NextResponse(
      error instanceof Error ? `OAuth callback failed: ${error.message}` : "OAuth callback failed.",
      { status: 500 }
    );
  }
}
