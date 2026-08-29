import { NextResponse } from "next/server";
import { z } from "zod";

import { PAID_PLAN } from "@/lib/billing/plans";
import { writeBillingRecord } from "@/lib/billing/record";
import {
  buildBillingReturnUrl,
  fetchActiveSubscriptions,
  findPaidSubscription,
  startAppSubscription
} from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { decryptString } from "@/lib/crypto";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { guardShopRoute, toErrorResponse } from "@/lib/shopify/route-guard";

/**
 * Starts a paid subscription and hands back the URL the merchant must approve.
 *
 * This route CHARGES NOBODY and GRANTS NOTHING. All it can do is create a
 * PENDING subscription in Shopify and return `confirmationUrl`. The plan is
 * only ever raised in /api/billing/callback, after Shopify confirms the
 * merchant actually approved it.
 *
 * The client must open `confirmationUrl` as a TOP-LEVEL navigation - App
 * Bridge's redirect with a remote target, not a fetch and not an iframe load.
 * Shopify's approval screen refuses to render inside the app's iframe, so a
 * plain `window.location` from inside the embedded app produces a blank frame
 * and a merchant who thinks the button is broken.
 */

const bodySchema = z.object({
  /**
   * Shopify's base64 `host` for this admin session, so the callback can put the
   * merchant back inside the admin rather than on a bare page.
   */
  host: z.string().max(512).optional()
});

export async function POST(request: Request) {
  try {
    const { shopDomain } = await guardShopRoute(request);

    // Creating subscriptions is cheap for us and noisy for the merchant: every
    // attempt leaves a PENDING subscription on their account. Bound it.
    const limit = consumeRateLimit(`billing-subscribe:${shopDomain}`, {
      capacity: 5,
      refillPerSecond: 1 / 30
    });

    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many attempts. Wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const body = bodySchema.parse(await request.json().catch(() => ({})));

    const merchant = await db.merchant.findUnique({
      where: { shopDomain },
      select: { id: true, accessTokenEncrypted: true, uninstalledAt: true }
    });

    if (!merchant || merchant.uninstalledAt || !merchant.accessTokenEncrypted) {
      return NextResponse.json(
        { ok: false, message: "This shop is not connected to Shopify. Reopen the app from your admin." },
        { status: 400 }
      );
    }

    const client = createShopifyAdminClient({
      storeDomain: shopDomain,
      accessToken: decryptString(merchant.accessTokenEncrypted)
    });

    // Ask Shopify first. A merchant who already has an active subscription and
    // presses Subscribe again - a stale tab, a double click, a plan page they
    // bookmarked - would otherwise be sent to approve a SECOND subscription.
    // Shopify replaces the old one on approval, which resets their billing
    // period and can bill them twice in one month. One extra read is cheap
    // insurance against a refund conversation.
    const active = await fetchActiveSubscriptions(client);
    if (active.ok) {
      const existing = findPaidSubscription(active.subscriptions);

      if (existing) {
        await writeBillingRecord(
          shopDomain,
          {
            planKey: PAID_PLAN.key,
            subscriptionGid: existing.id,
            status: "ACTIVE",
            currentPeriodEnd: existing.currentPeriodEnd,
            confirmationUrl: null,
            test: existing.test
          },
          { plan: PAID_PLAN.key }
        );

        return NextResponse.json({
          ok: true,
          alreadySubscribed: true,
          confirmationUrl: null,
          message: `You are already on ${PAID_PLAN.name}.`
        });
      }
    }
    // If that read failed we carry on rather than blocking the sale. The worst
    // case is a duplicate PENDING subscription the merchant never approves,
    // which costs nothing; refusing to sell because a read timed out costs a
    // customer.

    const result = await startAppSubscription({
      client,
      returnUrl: buildBillingReturnUrl(shopDomain, body.host ?? null)
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 502 });
    }

    // Recorded as PENDING, deliberately. Nothing about this write changes what
    // the merchant may do - Merchant.plan is untouched - it only remembers the
    // approval link, so a merchant who closes the Shopify screen can be sent
    // back to it instead of starting a second subscription.
    await writeBillingRecord(shopDomain, {
      planKey: PAID_PLAN.key,
      subscriptionGid: result.subscription?.id ?? null,
      status: "PENDING",
      confirmationUrl: result.confirmationUrl,
      currentPeriodEnd: result.subscription?.currentPeriodEnd ?? null,
      test: result.test
    });

    return NextResponse.json({
      ok: true,
      alreadySubscribed: false,
      confirmationUrl: result.confirmationUrl,
      plan: PAID_PLAN.key,
      planName: PAID_PLAN.name,
      priceUsd: PAID_PLAN.priceUsd,
      trialDays: PAID_PLAN.trialDays,
      test: result.test,
      message: "Approve the charge in Shopify to finish."
    });
  } catch (error) {
    return toErrorResponse(error, "Could not start the subscription.");
  }
}
