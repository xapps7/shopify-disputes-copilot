import { NextResponse } from "next/server";

import {
  buildEmbeddedAppUrl,
  consumeOauthState,
  normalizeShopDomain,
  setCurrentHost,
  setCurrentShopDomain,
  verifyOAuthCallback
} from "@/lib/shopify/auth";
import {
  exchangeCodeForAccessToken,
  persistMerchantInstall,
  registerWebhooks
} from "@/lib/shopify/install";

function redirectDocument(targetUrl: string) {
  const escapedUrl = targetUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0;url=${escapedUrl}" />
    <title>Opening app…</title>
  </head>
  <body>
    <script>
      (function() {
        var target = ${JSON.stringify(targetUrl)};
        if (window.top) {
          window.top.location.href = target;
        } else {
          window.location.href = target;
        }
      })();
    </script>
    <p>Opening the app inside Shopify Admin…</p>
    <p><a href="${escapedUrl}">Continue</a></p>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const shopParam = url.searchParams.get("shop");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const host = url.searchParams.get("host");

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
    await Promise.all([
      setCurrentShopDomain(shop),
      host ? setCurrentHost(host) : Promise.resolve()
    ]);

    if (webhookResult.skipped.length > 0) {
      console.warn("OAuth callback completed with skipped webhooks", webhookResult);
    }

    return redirectDocument(buildEmbeddedAppUrl(shop, "/dashboard", host));
  } catch (error) {
    console.error("OAuth callback failed", error);
    return new NextResponse(
      error instanceof Error ? `OAuth callback failed: ${error.message}` : "OAuth callback failed.",
      { status: 500 }
    );
  }
}
