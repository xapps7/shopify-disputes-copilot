/**
 * Which emails a dispute earns, and - more importantly - which it does not.
 *
 * The failure this exists to prevent: Shopify sends no notification before a
 * dispute deadline, then auto-submits whatever thin default data it holds. A
 * merchant can lose four figures without ever knowing there was a decision to
 * make, because the thing that would have warned them is the thing doing the
 * auto-submitting.
 *
 * The failure this exists to AVOID CAUSING: becoming noise. A merchant with 15
 * disputes a month getting four emails each is 60 emails, and the measured
 * override rate for high-frequency alerts is around 90%. An alert nobody reads
 * is worse than no alert, because it costs trust in the ones that matter.
 *
 * So the rules are deliberately stingy:
 *   - At most ONE email per dispute per sweep. The nearer deadline supersedes.
 *   - Reminders stop once the response is built. Nagging someone who is already
 *     done is exactly how you train them to ignore you.
 *   - Opening and closing are announced once each, ever.
 *
 * A merchant who acts promptly gets two emails per dispute. One who ignores it
 * gets four. That is self-correcting, which is the property worth having.
 *
 * Pure and alias-free so the decisions are directly testable. Persistence and
 * delivery live in alerts.ts.
 */

export const ALERT_THRESHOLD_HOURS = [72, 24] as const;

export type AlertKind =
  /** A dispute exists and Shopify never said so. The highest-value email here. */
  | "DISPUTE_OPENED"
  | "AUTO_SUBMIT_SOON"
  | "EVIDENCE_MISSING"
  | "AUTO_SUBMITTED"
  /** Won, lost or accepted. Closes the loop the opening email started. */
  | "DISPUTE_DECIDED";

export type PendingAlert = {
  disputeId: string;
  kind: AlertKind;
  thresholdHours: number | null;
  title: string;
  body: string;
  /** Sorts a batch so the subject line reflects the worst news. */
  urgency: number;
};

export type AlertDisputeInput = {
  id: string;
  orderName: string | null;
  amount: string | null;
  currencyCode: string | null;
  evidenceDueBy: Date | null;
  evidenceSentOn: Date | null;
  status: string;
  hasEvidence: boolean;
  /**
   * The response meets the bar - the READY stage in lib/disputes/lifecycle.
   * Suppresses deadline reminders, because there is nothing left to ask for.
   */
  responseReady: boolean;
};

const TERMINAL_STATUSES = new Set(["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED", "CLOSED"]);

/** Higher is more urgent. Drives the subject line of a batched email. */
const URGENCY: Record<AlertKind, number> = {
  AUTO_SUBMITTED: 5,
  EVIDENCE_MISSING: 4,
  AUTO_SUBMIT_SOON: 3,
  DISPUTE_OPENED: 2,
  DISPUTE_DECIDED: 1
};

function hoursUntil(due: Date, now: Date) {
  return (due.getTime() - now.getTime()) / 3_600_000;
}

function alert(
  disputeId: string,
  kind: AlertKind,
  thresholdHours: number | null,
  title: string,
  body: string
): PendingAlert {
  return { disputeId, kind, thresholdHours, title, body, urgency: URGENCY[kind] };
}

/** "Order #1024" or a neutral fallback - never a raw 13-digit id. */
function describeOrder(orderName: string | null) {
  return orderName ? `Order ${orderName}` : "A dispute";
}

function describeMoney(amount: string | null, currencyCode: string | null) {
  return amount && currencyCode ? `${currencyCode} ${amount}` : "the disputed amount";
}

/** "in 3 days", "in 24 hours", or a plain date when it is further out. */
function describeDeadline(due: Date, now: Date): string {
  const hours = hoursUntil(due, now);

  if (hours <= 24) {
    return "within 24 hours";
  }
  if (hours <= 72) {
    return `in ${Math.round(hours / 24)} days`;
  }

  return `on ${due.toISOString().slice(0, 10)}`;
}

/**
 * Decides which alerts a dispute warrants right now.
 *
 * `alreadySent` carries the keys of alerts already recorded, in both the
 * `id:kind` and `id:kind:threshold` shapes, so a kind that fires once ever and a
 * kind that fires once per threshold are both deduped by the same set.
 */
export function evaluateDisputeAlerts(
  dispute: AlertDisputeInput,
  now: Date,
  alreadySent: Set<string>
): PendingAlert[] {
  const label = describeOrder(dispute.orderName);
  const money = describeMoney(dispute.amount, dispute.currencyCode);

  // 1. Closed. Announce the outcome once, then never mention it again.
  if (TERMINAL_STATUSES.has(dispute.status)) {
    if (alreadySent.has(`${dispute.id}:DISPUTE_DECIDED`)) {
      return [];
    }

    const won = dispute.status === "WON";
    return [
      alert(
        dispute.id,
        "DISPUTE_DECIDED",
        null,
        won ? `${label}: you won this dispute` : `${label}: this dispute was decided against you`,
        won
          ? `${money} stays with you. Nothing further is needed.`
          : `${money} has gone back to the cardholder. Shopify does not support arbitration, so the decision is final.`
      )
    ];
  }

  // 2. First contact. Shopify sends nothing when a chargeback opens, so this is
  //    the email that exists because the platform has no equivalent. It carries
  //    the deadline, so a dispute that arrives already urgent still says so in
  //    one message rather than two.
  if (!alreadySent.has(`${dispute.id}:DISPUTE_OPENED`)) {
    const deadline = dispute.evidenceDueBy
      ? `Shopify answers for you ${describeDeadline(dispute.evidenceDueBy, now)} unless you respond first.`
      : "Shopify has not published a deadline for this one yet.";

    return [
      alert(
        dispute.id,
        "DISPUTE_OPENED",
        null,
        `${label}: a chargeback was opened`,
        `${money} is at stake. ${deadline}`
      )
    ];
  }

  // Everything below needs a deadline, and stops once the response has gone.
  if (!dispute.evidenceDueBy || dispute.evidenceSentOn) {
    return [];
  }

  const remaining = hoursUntil(dispute.evidenceDueBy, now);

  // 3. Missed. Worth saying plainly - it is the outcome the app exists to
  //    prevent, and the merchant should learn it from us rather than from a
  //    statement.
  if (remaining <= 0) {
    if (alreadySent.has(`${dispute.id}:AUTO_SUBMITTED`)) {
      return [];
    }

    return [
      alert(
        dispute.id,
        "AUTO_SUBMITTED",
        null,
        `${label}: Shopify has responded automatically`,
        `The deadline passed, so Shopify submitted a response using whatever it held. ${money} was at stake.`
      )
    ];
  }

  // 4. Reminders - and the suppression that keeps this list short. A response
  //    that already meets the bar needs no reminder; there is nothing to add.
  if (dispute.responseReady) {
    return [];
  }

  for (const threshold of ALERT_THRESHOLD_HOURS) {
    if (remaining > threshold) {
      continue;
    }

    if (alreadySent.has(`${dispute.id}:AUTO_SUBMIT_SOON:${threshold}`)) {
      continue;
    }

    const kind: AlertKind = dispute.hasEvidence ? "AUTO_SUBMIT_SOON" : "EVIDENCE_MISSING";

    return [
      alert(
        dispute.id,
        kind,
        threshold,
        `${label}: Shopify responds ${threshold === 24 ? "within 24 hours" : "in 3 days"}`,
        dispute.hasEvidence
          ? `${money} is at stake. Review the response before Shopify sends it.`
          : `${money} is at stake and nothing has been added. Unless you act, Shopify responds with its default data alone.`
      )
    ];
  }

  return [];
}

/**
 * Which settings toggle governs each kind.
 *
 * `DISPUTE_OPENED` and `AUTO_SUBMITTED` are deliberately absent: the first is
 * the only notice a merchant gets that a chargeback exists at all, and the
 * second reports money already lost. Letting either be switched off would mean
 * a merchant could silently opt out of the one thing this app is for.
 */
export function alertToggleKey(kind: AlertKind): "notifyDueSoon" | "notifyMissingEvidence" | "notifyDecided" | null {
  switch (kind) {
    case "AUTO_SUBMIT_SOON":
      return "notifyDueSoon";
    case "EVIDENCE_MISSING":
      return "notifyMissingEvidence";
    case "DISPUTE_DECIDED":
      return "notifyDecided";
    case "DISPUTE_OPENED":
    case "AUTO_SUBMITTED":
    default:
      return null;
  }
}

/** Worst news first, so a batched email's subject reflects the real state. */
export function sortByUrgency(alerts: PendingAlert[]): PendingAlert[] {
  return [...alerts].sort((a, b) => b.urgency - a.urgency);
}
