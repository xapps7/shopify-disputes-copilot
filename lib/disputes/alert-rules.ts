/**
 * Pure alert thresholds and decisions, free of `@/` aliases and Prisma so the
 * logic that decides whether a merchant gets warned is directly testable.
 * Persistence and delivery live in alerts.ts.
 */

export const ALERT_THRESHOLD_HOURS = [72, 24] as const;

export type AlertKind = "AUTO_SUBMIT_SOON" | "EVIDENCE_MISSING" | "AUTO_SUBMITTED";

export type PendingAlert = {
  disputeId: string;
  kind: AlertKind;
  thresholdHours: number | null;
  title: string;
  body: string;
};

function hoursUntil(due: Date, now: Date) {
  return (due.getTime() - now.getTime()) / 3_600_000;
}

/**
 * Pure: decides which alerts a dispute warrants right now. Kept free of the
 * database so the thresholds are directly testable.
 */
export function evaluateDisputeAlerts(
  dispute: {
    id: string;
    orderName: string | null;
    amount: string | null;
    currencyCode: string | null;
    evidenceDueBy: Date | null;
    evidenceSentOn: Date | null;
    status: string;
    hasEvidence: boolean;
  },
  now: Date,
  alreadySent: Set<string>
): PendingAlert[] {
  const alerts: PendingAlert[] = [];

  if (!dispute.evidenceDueBy || dispute.evidenceSentOn) {
    return alerts;
  }

  if (["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED"].includes(dispute.status)) {
    return alerts;
  }

  const label = dispute.orderName ? `Order ${dispute.orderName}` : "A dispute";
  const money =
    dispute.amount && dispute.currencyCode ? `${dispute.currencyCode} ${dispute.amount}` : "the disputed amount";
  const remaining = hoursUntil(dispute.evidenceDueBy, now);

  if (remaining <= 0) {
    const key = `${dispute.id}:AUTO_SUBMITTED`;
    if (!alreadySent.has(key)) {
      alerts.push({
        disputeId: dispute.id,
        kind: "AUTO_SUBMITTED",
        thresholdHours: null,
        title: `${label}: Shopify has responded automatically`,
        body: `The deadline passed, so Shopify submitted a response using whatever it had. ${money} was at stake.`
      });
    }
    return alerts;
  }

  for (const threshold of ALERT_THRESHOLD_HOURS) {
    if (remaining > threshold) {
      continue;
    }

    const key = `${dispute.id}:AUTO_SUBMIT_SOON:${threshold}`;
    if (alreadySent.has(key)) {
      continue;
    }

    alerts.push({
      disputeId: dispute.id,
      kind: dispute.hasEvidence ? "AUTO_SUBMIT_SOON" : "EVIDENCE_MISSING",
      thresholdHours: threshold,
      title: `${label}: Shopify responds in ${threshold === 24 ? "24 hours" : "3 days"}`,
      body: dispute.hasEvidence
        ? `${money} is at stake. Review the response before Shopify sends it.`
        : `${money} is at stake and no evidence has been added. Unless you act, Shopify will respond with its default data alone.`
    });

    // One alert per run - the nearer threshold supersedes the further one.
    break;
  }

  return alerts;
}

