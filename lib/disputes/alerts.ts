import { db } from "@/lib/db";
import {
  ALERT_THRESHOLD_HOURS,
  alertToggleKey,
  evaluateDisputeAlerts,
  sortByUrgency,
  type AlertKind,
  type PendingAlert
} from "@/lib/disputes/alert-rules";
import { buildAlertEmail } from "@/lib/notifications/alert-email";
import { isPlausibleAddress, readEmailConfig, sendEmail } from "@/lib/notifications/email";
import { getMerchantSettings } from "@/lib/settings";

export { ALERT_THRESHOLD_HOURS, alertToggleKey, evaluateDisputeAlerts, sortByUrgency };
export type { AlertKind, PendingAlert };

/**
 * Deadline alerts.
 *
 * The failure this exists to prevent: Shopify sends no notification before a
 * dispute deadline, and then auto-submits whatever thin default data it holds.
 * A merchant can lose four figures without ever knowing there was a decision to
 * make. Nothing in Shopify Admin warns them, because Shopify is the thing doing
 * the auto-submitting.
 */

export async function recordAlerts(merchantId: string, alerts: PendingAlert[]) {
  if (alerts.length === 0) {
    return 0;
  }

  await db.disputeAlert.createMany({
    data: alerts.map((alert) => ({
      merchantId,
      disputeId: alert.disputeId,
      kind: alert.kind,
      thresholdHours: alert.thresholdHours,
      title: alert.title,
      body: alert.body
    })),
    skipDuplicates: true
  });

  return alerts.length;
}

/**
 * Outbound delivery.
 *
 * No email provider is configured in this app. Rather than pretend to send -
 * which is what the dormant `alertEmail` setting did - alerts are always
 * recorded in the app, and additionally POSTed to ALERT_WEBHOOK_URL when one is
 * set (Slack, Zapier, or anything else that accepts JSON).
 */
export type DeliveryResult = {
  delivered: boolean;
  reason: string | null;
  /** Worth another sweep. A configuration or address fault never is. */
  retryable: boolean;
  channels: string[];
};

/**
 * Where the email goes.
 *
 * `alertEmail` first, then `supportEmail`, which most merchants have already
 * filled in for the evidence packet. Nothing is sent to an address the merchant
 * has not given us: mailing a store owner who never asked would be the kind of
 * surprise that earns a one-star review, and Shopify's own guidance is to keep
 * merchant contact explicit.
 *
 * The consequence is real and worth naming: a merchant who never opens Settings
 * gets no email, which for the free tier is the whole product. The fix is to
 * seed this from `shop { email }` at install and let them change it - that needs
 * the value stored at install time, so it is deliberately not faked here.
 */
export function resolveRecipient(settings: { alertEmail: string; supportEmail: string }): string | null {
  for (const candidate of [settings.alertEmail, settings.supportEmail]) {
    if (isPlausibleAddress(candidate)) {
      return candidate.trim();
    }
  }
  return null;
}

/**
 * Filters a batch by the merchant's preferences.
 *
 * Two kinds cannot be switched off: the notice that a chargeback exists at all,
 * and the notice that Shopify has already answered. Both report facts a merchant
 * has no other way to learn, and an app whose core warning is optional is an app
 * that will one day be blamed for silence it was told to keep.
 */
export function applyPreferences(
  alerts: PendingAlert[],
  settings: Record<string, unknown>
): PendingAlert[] {
  return alerts.filter((alert) => {
    const key = alertToggleKey(alert.kind);
    if (!key) {
      return true;
    }
    return settings[key] !== false;
  });
}

/**
 * Sends one email per sweep, and mirrors to ALERT_WEBHOOK_URL when set.
 *
 * Batched on purpose: a store that takes five chargebacks in an hour should get
 * one email listing five, not five emails. The hourly sweep makes that the
 * natural unit.
 */
export async function deliverAlerts(shopDomain: string, alerts: PendingAlert[]): Promise<DeliveryResult> {
  if (alerts.length === 0) {
    return { delivered: false, reason: "No alerts to deliver.", retryable: false, channels: [] };
  }

  const settings = await getMerchantSettings(shopDomain);
  const wanted = sortByUrgency(applyPreferences(alerts, settings as unknown as Record<string, unknown>));

  if (wanted.length === 0) {
    return { delivered: false, reason: "All of these are switched off in Settings.", retryable: false, channels: [] };
  }

  const channels: string[] = [];
  const problems: string[] = [];
  let retryable = false;

  // --- Email ---
  const emailConfig = readEmailConfig();
  const recipient = resolveRecipient(settings);
  const message = buildAlertEmail({
    shopDomain,
    alerts: wanted,
    appUrl: process.env.SHOPIFY_APP_URL ? `${process.env.SHOPIFY_APP_URL}/disputes` : null
  });

  if (!emailConfig) {
    problems.push("Email is not configured on this install.");
  } else if (!recipient) {
    problems.push("No alert email address is set in Settings.");
  } else if (message) {
    const result = await sendEmail({
      to: recipient,
      subject: message.subject,
      text: message.text,
      html: message.html,
      config: emailConfig
    });

    if (result.sent) {
      channels.push("email");
    } else {
      problems.push(result.reason);
      retryable = retryable || result.retryable;
    }
  }

  // --- Webhook mirror, for merchants who would rather have this in Slack ---
  const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopDomain,
          text: wanted.map((alert) => `${alert.title} - ${alert.body}`).join("\n"),
          alerts: wanted
        })
      });

      if (response.ok) {
        channels.push("webhook");
      } else {
        problems.push(`Webhook responded ${response.status}.`);
        retryable = retryable || response.status === 429 || response.status >= 500;
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "Webhook request failed.");
      retryable = true;
    }
  }

  return {
    delivered: channels.length > 0,
    reason: channels.length > 0 ? null : problems.join(" ") || "No delivery channel is configured.",
    retryable,
    channels
  };
}
