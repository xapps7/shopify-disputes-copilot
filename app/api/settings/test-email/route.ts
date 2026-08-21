import { NextResponse } from "next/server";

import { resolveRecipient } from "@/lib/disputes/alerts";
import { buildAlertEmail } from "@/lib/notifications/alert-email";
import { readEmailConfig, sendEmail } from "@/lib/notifications/email";
import { getMerchantSettings } from "@/lib/settings";
import { guardShopRoute, toErrorResponse } from "@/lib/shopify/route-guard";

/**
 * Sends one email to the configured address, on demand.
 *
 * The alternative is asking a merchant to configure email and then wait for a
 * chargeback to find out whether they got it right - and the whole point of the
 * feature is that chargebacks arrive without warning. A wrong address or an
 * unverified sending domain would sit undetected until the exact moment it
 * mattered.
 *
 * Returns the provider's own failure text rather than a generic error, because
 * every likely fault here is one only the merchant can fix: an address that is
 * not theirs, a domain that is not verified, a key that has been revoked. A
 * message saying "could not send" helps nobody.
 */
export async function POST(request: Request) {
  try {
    const { shopDomain } = await guardShopRoute(request);
    const settings = await getMerchantSettings(shopDomain);

    const config = readEmailConfig();
    if (!config) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Email is not configured on this install. Whoever operates the app needs to set ALERT_EMAIL_FROM and an API key."
        },
        { status: 503 }
      );
    }

    const recipient = resolveRecipient(settings);
    if (!recipient) {
      return NextResponse.json(
        {
          ok: false,
          message: "Add an alert email address above and save, then try again."
        },
        { status: 400 }
      );
    }

    // Built through the same builder the real alerts use, so this proves the
    // actual path rather than a simplified one that could diverge from it.
    const message = buildAlertEmail({
      shopDomain,
      alerts: [
        {
          disputeId: "test",
          kind: "DISPUTE_OPENED",
          title: "Test alert from Disputes Co-Pilot",
          body:
            "This is what a dispute alert will look like. If it reached you, deadline warnings will reach you too - " +
            "including the ones that arrive at 2am, which is the whole reason this exists.",
          urgency: 0
        }
      ],
      appUrl: process.env.SHOPIFY_APP_URL ? `${process.env.SHOPIFY_APP_URL}/disputes` : null
    });

    if (!message) {
      return NextResponse.json({ ok: false, message: "Could not build the test message." }, { status: 500 });
    }

    const result = await sendEmail({
      to: recipient,
      subject: message.subject,
      text: message.text,
      html: message.html,
      config
    });

    if (result.sent) {
      return NextResponse.json({
        ok: true,
        message: `Sent to ${recipient} via ${result.provider}. If it does not arrive within a minute, check spam.`,
        provider: result.provider,
        id: result.id
      });
    }

    return NextResponse.json(
      {
        ok: false,
        // Verbatim: "You can only send testing emails to your own email address"
        // is actionable in a way "delivery failed" is not.
        message: result.reason,
        retryable: result.retryable
      },
      { status: 502 }
    );
  } catch (error) {
    return toErrorResponse(error, "Could not send the test email.");
  }
}
