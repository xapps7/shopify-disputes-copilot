import { NextResponse, type NextRequest } from "next/server";

import { BOUNCE_PATH, buildBounceUrl, hasBounced } from "@/lib/shopify/bounce";
import {
  SESSION_COOKIE,
  createSessionCookieValue,
  readSessionCookieValue,
  verifySessionToken
} from "@/lib/shopify/session-token";

/**
 * Turns a verified App Bridge session token into a short-lived first-party
 * session cookie, so server-rendered navigations inside the admin iframe have
 * an authenticated identity without trusting `?shop=`.
 *
 * This middleware only ADDS identity - and, since the switch to Shopify-managed
 * installation, recovers it. Enforcement lives in
 * `lib/shopify/request-context.ts`, which every route and page calls.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)"]
};

/**
 * Shopify requires the embedded app to name the specific shop in
 * `frame-ancestors`: "The frame-ancestors declaration must be different for
 * every shop." A wildcard is explicitly disallowed and is a documented
 * rejection reason, so it is set per request rather than in next.config.
 */
const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

function withFrameAncestors(response: NextResponse, shopDomain: string | null) {
  const ancestors = shopDomain
    ? `https://${shopDomain} https://admin.shopify.com`
    : "https://admin.shopify.com";

  response.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors};`);
  return response;
}

/**
 * Only full page loads can be bounced. An API call has no browser to run App
 * Bridge in, and a health check must not be redirected - App Runner reads a 302
 * on its health check path as a failing target and would cycle the deployment.
 */
function isDocumentRequest(request: NextRequest) {
  if (request.method !== "GET") {
    return false;
  }

  const dest = request.headers.get("sec-fetch-dest");
  if (dest) {
    return dest === "document" || dest === "iframe";
  }

  return (request.headers.get("accept") ?? "").includes("text/html");
}

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Webhooks authenticate by HMAC; the OAuth routes are the legacy bootstrap
  // path, kept as a rollback. Neither is framed, so neither needs a CSP.
  if (pathname.startsWith("/api/webhooks") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // The bounce page is what we redirect TO, so bouncing it would be a loop with
  // no exit. It still renders inside the admin iframe, though, so it needs the
  // per-shop frame-ancestors like every other page - Shopify's automated review
  // checks for it, and without it the page falls back to being framable by
  // anyone. The shop here is read from the query string and used for NOTHING
  // but this header: no identity, no data access, so an attacker forging it
  // only narrows the framing rules in their own browser.
  if (pathname === BOUNCE_PATH) {
    const claimed = searchParams.get("shop");
    const shopForCsp = claimed && SHOP_DOMAIN_PATTERN.test(claimed) ? claimed : null;
    return withFrameAncestors(NextResponse.next(), shopForCsp);
  }

  const cookieShop = await readSessionCookieValue(
    request.cookies.get(SESSION_COOKIE)?.value,
    process.env.SHOPIFY_API_SECRET ?? ""
  );

  const bearer = request.headers.get("authorization");
  const token =
    searchParams.get("id_token") ??
    (bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null);

  if (!token) {
    // No token and no session: under managed install there is no OAuth
    // redirect coming to fix this, so send the browser to App Bridge to get
    // one. `hasBounced` makes this at most a single retry.
    if (
      !cookieShop &&
      isDocumentRequest(request) &&
      !hasBounced(searchParams) &&
      !pathname.startsWith("/api/")
    ) {
      const bounce = new URL(buildBounceUrl(pathname, searchParams), request.nextUrl.origin);
      return withFrameAncestors(NextResponse.redirect(bounce), null);
    }

    return withFrameAncestors(NextResponse.next(), cookieShop);
  }

  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  const apiSecret = process.env.SHOPIFY_API_SECRET ?? "";
  const claims = await verifySessionToken(token, { apiKey, apiSecret });

  if (!claims) {
    return withFrameAncestors(NextResponse.next(), cookieShop);
  }

  const response = withFrameAncestors(NextResponse.next(), claims.shopDomain);
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await createSessionCookieValue(claims.shopDomain, apiSecret),
    httpOnly: true,
    // The admin renders this app cross-site, so the cookie must be
    // SameSite=None. It is signed and only ever minted from a verified token.
    sameSite: "none",
    secure: true,
    path: "/"
  });

  return response;
}
