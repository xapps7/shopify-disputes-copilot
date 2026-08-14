/**
 * Card network monitoring ratios.
 *
 * This is the part merchants do not track and Shopify does not show correctly.
 * Three separate numbers get conflated:
 *
 *   - Shopify's displayed dispute rate: its own metric, and it INCLUDES disputes
 *     resolved through Shopify's network dispute resolution program - which the
 *     card networks EXCLUDE.
 *   - Visa VAMP: (TC40 fraud reports + TC15 disputes) / settled transactions,
 *     same month, card-not-present only. Fraud and non-fraud share one numerator,
 *     so a merchant can breach on fraud alone with clean dispute numbers.
 *   - Mastercard ECM: chargebacks THIS month / captured payments in the
 *     PRECEDING month. The offset denominator means a merchant with falling
 *     sales breaches on a mechanically worsening ratio without a single extra
 *     chargeback. Using same-month volume understates ECM risk for any
 *     shrinking store - a common and expensive modelling error.
 *
 * Sources:
 *  https://corporate.visa.com/content/dam/VCOM/corporate/visa-perspectives/security-and-trust/documents/visa-acquirer-monitoring-program-fact-sheet-2025.pdf
 *  https://help.shopify.com/en/manual/payments/chargebacks/monitoring-programs
 */

export type RatioStatus = "healthy" | "watch" | "breach";

export type RatioAssessment = {
  program: "VAMP" | "ECM";
  ratio: number;
  countThreshold: number;
  ratioThreshold: number;
  count: number;
  status: RatioStatus;
  /** Disputes that could still be added this month before breaching. */
  headroom: number;
  explanation: string;
  /** Null when there is not enough of the month elapsed to project honestly. */
  projectedRatio: number | null;
};

export type VampRegion = "STANDARD" | "CEMEA";

/** Lowered from 2.2% to 1.5% for US/EU/CA/AP on 1 April 2026. */
export const VAMP_THRESHOLDS: Record<VampRegion, { ratio: number; count: number }> = {
  STANDARD: { ratio: 0.015, count: 1500 },
  CEMEA: { ratio: 0.022, count: 150 }
};

export const ECM_THRESHOLDS = {
  ecm: { ratio: 0.015, count: 100 },
  hecm: { ratio: 0.03, count: 300 }
};

/** Below this share of the threshold we call it healthy rather than watch. */
const WATCH_FRACTION = 0.7;

function classify(ratio: number, count: number, ratioThreshold: number, countThreshold: number): RatioStatus {
  // Both conditions must hold for a real breach - a tiny store with three
  // chargebacks has a terrible ratio and is in no danger.
  if (ratio >= ratioThreshold && count >= countThreshold) {
    return "breach";
  }
  if (ratio >= ratioThreshold * WATCH_FRACTION) {
    return "watch";
  }
  return "healthy";
}

/** How many more disputes fit under the ratio threshold at this volume. */
function headroomFor(count: number, denominator: number, ratioThreshold: number) {
  if (denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(ratioThreshold * denominator) - count);
}

export function assessVamp(input: {
  fraudReports: number;
  disputes: number;
  settledTransactionsThisMonth: number;
  region?: VampRegion;
  /** 0-1: how far through the month we are, for projection. */
  monthElapsed?: number;
}): RatioAssessment {
  const region = input.region ?? "STANDARD";
  const thresholds = VAMP_THRESHOLDS[region];
  const count = input.fraudReports + input.disputes;
  const denominator = input.settledTransactionsThisMonth;
  const ratio = denominator > 0 ? count / denominator : 0;

  const elapsed = input.monthElapsed ?? 0;
  const projectedRatio = elapsed >= 0.25 && denominator > 0 ? ratio : null;

  return {
    program: "VAMP",
    ratio,
    count,
    countThreshold: thresholds.count,
    ratioThreshold: thresholds.ratio,
    status: classify(ratio, count, thresholds.ratio, thresholds.count),
    headroom: headroomFor(count, denominator, thresholds.ratio),
    projectedRatio,
    explanation:
      "Visa counts fraud reports and disputes together, against this month's settled card-not-present transactions. Winning a dispute does not remove it from this count."
  };
}

export function assessEcm(input: {
  chargebacksThisMonth: number;
  capturedPaymentsPriorMonth: number;
  monthElapsed?: number;
}): RatioAssessment {
  const denominator = input.capturedPaymentsPriorMonth;
  const count = input.chargebacksThisMonth;
  const ratio = denominator > 0 ? count / denominator : 0;

  const tier = count >= ECM_THRESHOLDS.hecm.count || ratio >= ECM_THRESHOLDS.hecm.ratio
    ? ECM_THRESHOLDS.hecm
    : ECM_THRESHOLDS.ecm;

  const elapsed = input.monthElapsed ?? 0;
  // Straight-line projection to month end, only once enough of the month has
  // passed that the extrapolation is not noise.
  const projectedRatio = elapsed >= 0.25 && denominator > 0 ? ratio / elapsed : null;

  return {
    program: "ECM",
    ratio,
    count,
    countThreshold: tier.count,
    ratioThreshold: tier.ratio,
    status: classify(ratio, count, tier.ratio, tier.count),
    headroom: headroomFor(count, denominator, tier.ratio),
    projectedRatio,
    explanation:
      "Mastercard divides this month's chargebacks by LAST month's captured payments. If your sales are falling, this ratio worsens even with the same number of chargebacks."
  };
}

/**
 * The warning nobody gives: Shopify Protect reimburses the money but does not
 * remove the chargeback from the network's count. A merchant fully covered by
 * Protect can feel no financial pain and still be driven into VAMP or ECM.
 */
export function protectedButStillCounted(protectedChargebacks: number): string | null {
  if (protectedChargebacks <= 0) {
    return null;
  }

  return `${protectedChargebacks} of your chargebacks were reimbursed by Shopify Protect. That money came back, but the card networks still count every one of them toward the ratios that decide whether you keep card processing at all.`;
}
