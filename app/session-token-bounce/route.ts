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

  // App Bridge is fetched from Shopify's CDN, and that fetch is not guaranteed:
  // a corporate proxy, a script blocker or an offline moment all stop it dead.
  // This page has no UI of its own, so when that happens the merchant is left
  // staring at a blank white iframe with nothing to read and nothing to click -
  // and because this is the ONLY route from "no token" back to signed in, they
  // have no way to work out that the app is not simply broken. A line of text
  // and a five second timeout cost nothing and turn a dead end into an
  // instruction. Plain HTML and inline CSS on purpose: this page must not
  // depend on the app shell, the database, or anything else that can fail.
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connecting to Shopify</title>
    <meta name="shopify-api-key" content="${escapeHtmlAttribute(shopifyConfig.apiKey)}" />
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f6f6f7;
        color: #303030;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 20px;
      }
      .panel {
        max-width: 320px;
        padding: 24px;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div class="panel">
      <p id="dc-bounce-message">Connecting to Shopify&hellip;</p>
      <noscript>
        <p>This app needs JavaScript to connect to Shopify. Turn it on, then reopen the app from your Shopify admin.</p>
      </noscript>
    </div>
    <script>
      // If App Bridge had loaded and worked, it would have navigated away long
      // before this fires. Still being here means the redirect is not coming.
      setTimeout(function () {
        var message = document.getElementById("dc-bounce-message");
        if (message) {
          message.textContent =
            "Could not reach Shopify. Close this and reopen the app from your Shopify admin.";
        }
      }, 5000);
    </script>
  </body>
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
