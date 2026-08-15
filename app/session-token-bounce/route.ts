import { NextResponse } from "next/server";

import { BOUNCE_PATH, isSafeReloadTarget } from "@/lib/shopify/bounce";
import { shopifyConfig } from "@/lib/shopify/config";

/**
 * The session-token bounce page.
 *
 * Returns bare HTML rather than a React page on purpose: it must not render the
 * app shell, must not touch the database, and must not depend on an identity it
 * does not yet have. Its whole job is to load App Bridge, which reads
 * `shopify-reload` from the query string and navigates there with a fresh
 * session token attached.
 *
 * This is the replacement for the OAuth callback. Under Shopify-managed
 * installation Shopify never calls the app during install, so this page is the
 * only path back from "no token" to "authenticated".
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const reloadTo = url.searchParams.get("shopify-reload");

  // An open redirect here would be handed to App Bridge and followed inside the
  // merchant's admin. Refuse anything that is not a path in this app.
  if (reloadTo !== null && !isSafeReloadTarget(reloadTo)) {
    const safe = new URL(BOUNCE_PATH, url.origin);
    safe.searchParams.set("shopify-reload", "/");
    return NextResponse.redirect(safe);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="shopify-api-key" content="${escapeHtmlAttribute(shopifyConfig.apiKey)}" />
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  </head>
  <body></body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Never let an intermediary keep this: it is a one-shot redirect surface.
      "Cache-Control": "no-store, max-age=0"
    }
  });
}
