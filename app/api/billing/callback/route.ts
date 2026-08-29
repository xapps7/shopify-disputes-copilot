import { NextResponse } from "next/server";

import { FREE_PLAN, PAID_PLAN } from "@/lib/billing/plans";
import { writeBillingRecord } from "@/lib/billing/record";
import { fetchActiveSubscriptions, findPaidSubscription } from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { decryptString } from "@/lib/crypto";
import { consumeRateLimit } from "@/lib/rate-limit";
import { buildEmbeddedAppUrl, normalizeShopDomain } from "@/lib/shopify/auth";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { getAuthenticatedShopDomain } from "@/lib/shopify/request-context";

/**
 * Where Shopify sends the merchant after the approval screen.
 *
 * NEVER TRUST THE QUERY STRING AS PROOF OF PAYMENT. Shopify appends a
 * `charge_id` here, and it is tempting to read it and mark the merchant paid.
 * It is not a proof of anything:
 *
 *   - it arrives on a plain browser navigation with no HMAC and no signature,
 *     so anyone can type this URL with any charge_id and any shop;
 *   - it is present whether the merchant APPROVED or DECLINED - the return URL
 *     is used for both outcomes, so "we got a charge_id" and "they paid" are
 *     different statements;
 *   - even after a real approval it says nothing about what happens next: the
 *     merchant can cancel a minute later, or the subscription can go FROZEN
 *     because their Shopify bill is unpaid.
 *
 * So this route ignores every parameter except as a HINT about which shop to
 * look up, and then asks Shopify directly what that install is subscribed to.
 * `currentAppInstallation.activeSubscriptions` returns only live, approved
 * subscriptions, and it is read with our own stored access token - a caller who
 * forges the query string cannot influence the answer.
 *
 * The same call is what makes this route safe to hit repeatedly. It is a
 * reconcile, not a grant: whatever anyone puts in the URL, the plan ends up
 * equal to what Shopify says. That is also why it can be pointed at from a
 * "refresh my plan" button later.
 */

/** Both failure exits land the merchant somewhere real rather than on a stack trace. */
function backToApp(shopDomain: string, host: string | null) {
  // No outcome flag in the URL on purpose. The settings page reads the plan
  // from the database, which this route has just reconciled against Shopify -
  // a `?billing=active` parameter would be another unverifiable claim in a
  // query string, and this file exists because of those.
  return NextResponse.redirect(buildEmbeddedAppUrl(shopDomain, "/settings", host));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = url.searchParams.get("host");

  let shopDomain: string | null = null;

  try {
    // Preferred: the signed session cookie middleware mints from a verified App
    // Bridge token. It is SameSite=None, so it survives this top-level
    // navigation back from Shopify.
    shopDomain = await getAuthenticatedShopDomain(request);

    if (!shopDomain) {
      // Fallback: the unverified `shop` parameter Shopify puts on the return
      // URL. Trusting it anywhere else in this app would be a cross-tenant bug,
      // and it is only acceptable HERE because of what this route does with it:
      // it can trigger a reconcile of that shop against Shopify and nothing
      // else. There is no data in the response - the only reply is a redirect -
      // and the outcome is always the truth Shopify reports, so a forged value
      // cannot grant, reveal or change anything. The rate limit below bounds
      // the one real cost, which is Admin API calls made on someone's behalf.
      const claimed = url.searchParams.get("shop");
      shopDomain = claimed ? normalizeShopDomain(claimed) : null;
    }
  } catch {
    // normalizeShopDomain throws on a malformed domain.
    shopDomain = null;
  }

  if (!shopDomain) {
    // Public route, so a constant string - no echoing of what was sent.
    return new NextResponse("Could not identify the shop for this billing callback.", { status: 400 });
  }

  const limit = consumeRateLimit(`billing-callback:${shopDomain}`, {
    capacity: 10,
    refillPerSecond: 1 / 10
  });

  if (!limit.allowed) {
    return new NextResponse("Too many billing callbacks for this shop. Try again shortly.", {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) }
    });
  }

  try {
    const merchant = await db.merchant.findUnique({
      where: { shopDomain },
      select: { accessTokenEncrypted: true, uninstalledAt: true }
    });

    if (!merchant || merchant.uninstalledAt || !merchant.accessTokenEncrypted) {
      // Nothing to verify with. Send them back into the app, where the normal
      // token exchange will run and they can press Subscribe again.
      return backToApp(shopDomain, host);
    }

    const client = createShopifyAdminClient({
      storeDomain: shopDomain,
      accessToken: decryptString(merchant.accessTokenEncrypted)
    });

    const active = await fetchActiveSubscriptions(client);

    if (!active.ok) {
      // Shopify could not be read. Leave the plan EXACTLY as it is.
      //
      // This is the one place the fail-closed rule in lib/billing/gate.ts does
      // not apply, and the asymmetry is deliberate: failing closed means never
      // GRANTING on doubt, not revoking on doubt. Downgrading a paying merchant
      // because a read timed out takes away work they have already paid for,
      // and they would have no idea why. A merchant left on the free plan for
      // one more minute simply presses the button again.
      console.error(`[billing] callback could not verify the subscription for ${shopDomain}: ${active.message}`);
      return backToApp(shopDomain, host);
    }

    const subscription = findPaidSubscription(active.subscriptions);

    if (subscription) {
      await writeBillingRecord(
        shopDomain,
        {
          planKey: PAID_PLAN.key,
          subscriptionGid: subscription.id,
          status: "ACTIVE",
          currentPeriodEnd: subscription.currentPeriodEnd,
          // The approval is spent. Keeping a used confirmation URL around only
          // gives the UI a way to send the merchant somewhere pointless.
          confirmationUrl: null,
          test: subscription.test
        },
        { plan: PAID_PLAN.key }
      );

      if (subscription.test) {
        // Worth a line in the log: this merchant will never be billed. On a
        // development store that is correct; in production it means
        // SHOPIFY_BILLING_TEST is wrong and revenue is silently zero.
        console.warn(`[billing] ${shopDomain} activated a TEST subscription - it will never be charged.`);
      }

      return backToApp(shopDomain, host);
    }

    // Shopify answered, and there is no active paid subscription: the merchant
    // declined, or closed the screen, or cancelled. Record the free plan.
    //
    // Writing the DOWNGRADE here matters as much as writing the upgrade. Without
    // it, a merchant who subscribes, cancels in their admin, and comes back
    // keeps the paid plan forever - Shopify sends no webhook this app listens
    // for, so this reconcile is the only moment the app can learn about it.
    await writeBillingRecord(
      shopDomain,
      {
        planKey: FREE_PLAN.key,
        subscriptionGid: null,
        status: "NONE",
        currentPeriodEnd: null,
        confirmationUrl: null
      },
      { plan: FREE_PLAN.key }
    );

    return backToApp(shopDomain, host);
  } catch (error) {
    console.error("[billing] callback failed", error);
    // A failure here must still land the merchant back in the app. They have
    // just been through a payment screen; a raw error page at that moment reads
    // as "my money went somewhere and the app broke".
    return backToApp(shopDomain, host);
  }
}
