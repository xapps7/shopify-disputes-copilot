import { db } from "@/lib/db";
import {
  ALERT_THRESHOLD_HOURS,
  evaluateDisputeAlerts,
  type AlertKind,
  type PendingAlert
} from "@/lib/disputes/alert-rules";

export { ALERT_THRESHOLD_HOURS, evaluateDisputeAlerts };
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
export async function deliverAlerts(shopDomain: string, alerts: PendingAlert[]) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim();

  if (!webhookUrl || alerts.length === 0) {
    return { delivered: false, reason: webhookUrl ? "No alerts to deliver." : "ALERT_WEBHOOK_URL is not set." };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shopDomain,
        text: alerts.map((alert) => `${alert.title} - ${alert.body}`).join("\n"),
        alerts
      })
    });

    return response.ok
      ? { delivered: true, reason: null }
      : { delivered: false, reason: `Webhook responded ${response.status}.` };
  } catch (error) {
    return { delivered: false, reason: error instanceof Error ? error.message : "Webhook request failed." };
  }
}
