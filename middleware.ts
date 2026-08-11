import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, createSessionCookieValue, verifySessionToken } from "@/lib/shopify/session-token";

/**
 * Turns a verified App Bridge session token into a short-lived first-party
 * session cookie, so server-rendered navigations inside the admin iframe have
 * an authenticated identity without trusting `?shop=`.
 *
 * This middleware only ADDS identity. Enforcement lives in
 * `lib/shopify/request-context.ts`, which every route and page calls.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)"]
};

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Webhooks authenticate by HMAC; the OAuth routes are the bootstrap path.
  if (pathname.startsWith("/api/webhooks") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const bearer = request.headers.get("authorization");
  const token =
    searchParams.get("id_token") ??
    (bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null);

  if (!token) {
    return NextResponse.next();
  }

  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  const apiSecret = process.env.SHOPIFY_API_SECRET ?? "";
  const claims = await verifySessionToken(token, { apiKey, apiSecret });

  if (!claims) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
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
