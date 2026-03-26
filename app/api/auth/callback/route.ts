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
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!shopParam || !code || !state) {
    return new NextResponse("Missing OAuth callback parameters.", { status: 400 });
  }

  if (!verifyOAuthCallback(url.searchParams)) {
    return new NextResponse("Invalid OAuth callback signature.", { status: 401 });
  }

  const storedState = await consumeOauthState();
  if (!storedState || storedState !== state) {
    return new NextResponse("Invalid OAuth state.", { status: 401 });
  }

  const shop = normalizeShopDomain(shopParam);
  const tokenPayload = await exchangeCodeForAccessToken(shop, code);

  await persistMerchantInstall(shop, tokenPayload.access_token);
  await registerWebhooks(shop, tokenPayload.access_token);
  await setCurrentShopDomain(shop);

  return NextResponse.redirect(`${process.env.SHOPIFY_APP_URL}/dashboard?shop=${shop}`);
}
