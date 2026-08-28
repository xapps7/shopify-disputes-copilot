import { NextResponse } from "next/server";

import {
  buildInstallUrl,
  createOauthState,
  normalizeShopDomain,
  setCurrentHost,
  setCurrentShopDomain,
  setOauthState
} from "@/lib/shopify/auth";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shop = searchParams.get("shop");
    const host = searchParams.get("host");

    if (!shop) {
      console.error("Install route failed: missing shop parameter");
      return new NextResponse("Missing shop parameter", { status: 400 });
    }

    const normalizedShop = normalizeShopDomain(shop);
    const state = createOauthState();

    await Promise.all([
      setCurrentShopDomain(normalizedShop),
      setOauthState(state),
      host ? setCurrentHost(host) : Promise.resolve()
    ]);

    return NextResponse.redirect(buildInstallUrl(normalizedShop, state));
  } catch (error) {
    console.error("Install route failed", error);
    // Constant text. This route is public and skipped by middleware, so
    // echoing error.message hands Shopify API errors and internal failure
    // detail to an unauthenticated caller.
    return new NextResponse("Install route failed.", { status: 500 });
  }
}
