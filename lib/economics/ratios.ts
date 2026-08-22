/**
 * Card network and platform monitoring — the scoreboard that decides whether a
 * merchant keeps taking cards at all.
 *
 * THE CORRECTION THIS FILE EXISTS TO MAKE: an earlier version measured VAMP
 * against 1.5% with a count floor of 1,500 disputes a month. Reaching that needs
 * roughly 100,000 Visa transactions monthly. No Shopify merchant in this app's
 * segment will ever trip it, so the app reported "healthy" to everyone, forever.
 *
 * The thresholds that actually bite, in the order they bite:
 *
 *   1. SHOPIFY - 1.00% over a rolling 90 days. Payout reserves and forced
 *      enrolment in dispute resolution programmes. This is where a real merchant
 *      first gets hurt, and it is far below anything the networks enforce.
 *   2. MATCH  - 1% of Mastercard sales AND at least $5,000. A five-year
 *      blacklist, and Shopify generally cannot process for a listed business.
 *      Ten fraudulent orders totalling $5,000 is a bad month, not an empire.
 *   3. VAMP non-compliant - 0.5% with a count floor of just 5.
 *   4. Mastercard ECM - 1.5% and 100+, fines from month two.
 *   5. VAMP excessive - 1.5% and 1,500+. Included for completeness only.
 *
 * The single most important fact in this file, and the reason the whole product
 * is shaped the way it is: EVERY ONE OF THESE COUNTS A DISPUTE WHEN IT IS FILED.
 * Winning changes nothing. Outcomes are irrelevant to all five. So representment
 * recovers money and never improves standing, and for a merchant near a
 * threshold, fighting is not the work - deflection and prevention are.
 *
 * Honest limit, stated everywhere it matters: Shopify exposes disputes but has
 * no TC40 / early-fraud-warning API, so we can only see the dispute half of
 * Visa's numerator. Visa counts a fraudulent order in BOTH its fraud report and
 * its dispute report, so a fraud-heavy store's true VAMP ratio can be close to
 * double what we compute. Every VAMP figure here is a FLOOR and says so.
 *
 * Sources:
 *  https://corporate.visa.com/content/dam/VCOM/corporate/visa-perspectives/security-and-trust/documents/visa-acquirer-monitoring-program-fact-sheet-2025.pdf
 *  https://help.shopify.com/en/manual/payments/chargebacks/chargeback-monitoring
 *  https://help.shopify.com/en/manual/payments/shopify-payments/managing-chargebacks/monitoring-programs
 *  https://docs.stripe.com/disputes/monitoring-programs
 */

export type RatioStatus = "healthy" | "watch" | "breach";

export type ProgramKey = "SHOPIFY" | "MATCH" | "VAMP_NONCOMPLIANT" | "ECM" | "VAMP_EXCESSIVE";

export type RatioAssessment = {
  program: ProgramKey;
  /** What a merchant should call it. */
  label: string;
  ratio: number;
  count: number;
  ratioThreshold: number;
  countThreshold: number;
  status: RatioStatus;
  /** How many more disputes fit under the threshold at this volume. */
  headroom: number;
  /** What actually happens on breach, in the merchant's terms. */
  consequence: string;
  explanation: string;
  projectedRatio: number | null;
  /**
   * Days until the threshold is crossed at the current arrival rate. Null when
   * the trend is flat or improving, which is the common and good case.
   *
   * Nobody in the category ships this. Stripe has the best monitoring dashboard
   * in the industry and it is still backward-looking; Kount ships a manual
   * calculator. "You cross Shopify's 1% on 14 September" is a different product
   * from "your rate is 0.7%".
   */
  daysUntilBreach: number | null;
  /** True when the real figure may be higher because we cannot see TC40. */
  isFloor: boolean;
};

/**
 * Shopify's own limit. Rolling 90 days, and per its 28 January 2026 changelog
 * it now INCLUDES disputes resolved through RDR - so a merchant buying RDR
 * alerts to protect their Shopify standing is, on that axis, buying nothing.
 */
export const SHOPIFY_THRESHOLD = { ratio: 0.01, windowDays: 90, count: 1 };

/** The five-year one. Count floor is low enough for a small store to reach. */
export const MATCH_THRESHOLD = { ratio: 0.01, minAmount: 5000, fraudCount: 10 };

export type VampRegion = "STANDARD" | "CEMEA";

export const VAMP_THRESHOLDS: Record<VampRegion, { noncompliant: { ratio: number; count: number }; excessive: { ratio: number; count: number } }> = {
  STANDARD: {
    noncompliant: { ratio: 0.005, count: 5 },
    excessive: { ratio: 0.015, count: 1500 }
  },
  CEMEA: {
    noncompliant: { ratio: 0.005, count: 5 },
    excessive: { ratio: 0.022, count: 150 }
  }
};

export const ECM_THRESHOLDS = {
  ecm: { ratio: 0.015, count: 100 },
  hecm: { ratio: 0.03, count: 300 }
};

/** Below this share of the threshold we call it healthy rather than watch. */
const WATCH_FRACTION = 0.7;

function classify(ratio: number, count: number, ratioThreshold: number, countThreshold: number): RatioStatus {
  // Both conditions must hold. A three-order store with one chargeback has a
  // 33% ratio and is in no danger from anyone.
  if (ratio >= ratioThreshold && count >= countThreshold) {
    return "breach";
  }
  if (ratio >= ratioThreshold * WATCH_FRACTION && count >= countThreshold) {
    return "watch";
  }
  return "healthy";
}

function headroomFor(count: number, denominator: number, ratioThreshold: number) {
  if (denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(ratioThreshold * denominator) - count);
}

/**
 * When the threshold gets crossed, at the rate things are arriving now.
 *
 * Both sides of the ratio grow: disputes at `disputesPerDay`, the denominator at
 * `transactionsPerDay`. So the question is not "when do disputes reach a number"
 * but whether disputes are outrunning sales.
 *
 *   (count + r·t) / (denominator + s·t) >= threshold
 *   t >= (threshold·denominator - count) / (r - threshold·s)
 *
 * If `r <= threshold·s` the ratio is flat or falling and no breach is coming -
 * which returns null, because a forecast of "never" dressed up as a number is
 * how a warning system starts crying wolf.
 */
export function daysUntilBreach(input: {
  count: number;
  denominator: number;
  ratioThreshold: number;
  countThreshold: number;
  disputesPerDay: number;
  transactionsPerDay: number;
  /** Beyond this, the arithmetic is honest and the answer is still "not soon". */
  horizonDays?: number;
}): number | null {
  const horizon = input.horizonDays ?? 180;

  if (input.disputesPerDay <= 0 || input.denominator <= 0) {
    return null;
  }

  const drift = input.disputesPerDay - input.ratioThreshold * input.transactionsPerDay;
  if (drift <= 0) {
    return null;
  }

  const ratioGap = input.ratioThreshold * input.denominator - input.count;
  const daysToRatio = ratioGap <= 0 ? 0 : ratioGap / drift;

  // The count floor has to be cleared too - a breach needs both.
  const countGap = input.countThreshold - input.count;
  const daysToCount = countGap <= 0 ? 0 : countGap / input.disputesPerDay;

  const days = Math.ceil(Math.max(daysToRatio, daysToCount));
  return days <= horizon ? days : null;
}

/**
 * Shopify's own 1% over a rolling 90 days - the first thing that hurts, and the
 * one this app should lead with.
 */
export function assessShopify(input: {
  disputesLast90Days: number;
  eligibleTransactionsLast90Days: number;
  disputesPerDay?: number;
  transactionsPerDay?: number;
}): RatioAssessment {
  const count = input.disputesLast90Days;
  const denominator = input.eligibleTransactionsLast90Days;
  const ratio = denominator > 0 ? count / denominator : 0;

  return {
    program: "SHOPIFY",
    label: "Shopify chargeback rate",
    ratio,
    count,
    ratioThreshold: SHOPIFY_THRESHOLD.ratio,
    countThreshold: SHOPIFY_THRESHOLD.count,
    status: classify(ratio, count, SHOPIFY_THRESHOLD.ratio, SHOPIFY_THRESHOLD.count),
    headroom: headroomFor(count, denominator, SHOPIFY_THRESHOLD.ratio),
    consequence:
      "Shopify can hold a reserve against your payouts and enrol you in a dispute resolution programme until you are back under 1% for 30 days.",
    explanation:
      "Every dispute opened counts, whether or not you win it, and since January 2026 that includes ones resolved through RDR. Only Shopify Payments transactions are in the denominator.",
    projectedRatio: null,
    daysUntilBreach: daysUntilBreach({
      count,
      denominator,
      ratioThreshold: SHOPIFY_THRESHOLD.ratio,
      countThreshold: SHOPIFY_THRESHOLD.count,
      disputesPerDay: input.disputesPerDay ?? 0,
      transactionsPerDay: input.transactionsPerDay ?? 0
    }),
    isFloor: false
  };
}

/**
 * MATCH: the one that ends the business.
 *
 * Assessed on value as well as count, because both conditions must hold - and
 * the $5,000 floor is what makes this reachable for a small store in a bad
 * month rather than a big-merchant problem.
 */
export function assessMatchRisk(input: {
  chargebackCount: number;
  chargebackAmount: number;
  transactionCount: number;
}): RatioAssessment {
  const ratio = input.transactionCount > 0 ? input.chargebackCount / input.transactionCount : 0;
  const overAmount = input.chargebackAmount >= MATCH_THRESHOLD.minAmount;
  const overRatio = ratio >= MATCH_THRESHOLD.ratio;

  const status: RatioStatus =
    overAmount && overRatio
      ? "breach"
      : (overAmount || overRatio) && input.chargebackCount >= MATCH_THRESHOLD.fraudCount
        ? "watch"
        : "healthy";

  return {
    program: "MATCH",
    label: "MATCH listing risk",
    ratio,
    count: input.chargebackCount,
    ratioThreshold: MATCH_THRESHOLD.ratio,
    countThreshold: MATCH_THRESHOLD.fraudCount,
    status,
    headroom: headroomFor(input.chargebackCount, input.transactionCount, MATCH_THRESHOLD.ratio),
    consequence:
      "A MATCH listing lasts five years and Shopify generally cannot process for a listed business. This is the one that ends a store rather than fining it.",
    explanation:
      `Both conditions must hold: 1% of Mastercard sales and at least $${MATCH_THRESHOLD.minAmount.toLocaleString()} in chargebacks. Ten fraudulent orders totalling that amount is a bad month, not a large business.`,
    projectedRatio: null,
    daysUntilBreach: null,
    isFloor: false
  };
}

export function assessVamp(input: {
  fraudReports: number;
  disputes: number;
  settledTransactionsThisMonth: number;
  region?: VampRegion;
  monthElapsed?: number;
  disputesPerDay?: number;
  transactionsPerDay?: number;
}): RatioAssessment {
  const region = input.region ?? "STANDARD";
  // The non-compliant tier, not excessive. Excessive needs 1,500 events a month
  // and is unreachable for this app's merchants; measuring against it is how the
  // previous version told everyone they were fine.
  const thresholds = VAMP_THRESHOLDS[region].noncompliant;

  const count = input.fraudReports + input.disputes;
  const denominator = input.settledTransactionsThisMonth;
  const ratio = denominator > 0 ? count / denominator : 0;

  const elapsed = input.monthElapsed ?? 0;
  const projectedRatio = elapsed >= 0.25 && denominator > 0 ? ratio / elapsed : null;

  return {
    program: "VAMP_NONCOMPLIANT",
    label: "Visa VAMP",
    ratio,
    count,
    countThreshold: thresholds.count,
    ratioThreshold: thresholds.ratio,
    status: classify(ratio, count, thresholds.ratio, thresholds.count),
    headroom: headroomFor(count, denominator, thresholds.ratio),
    consequence: "Visa may charge your acquirer per dispute, and acquirers pass that on or ask you to leave.",
    explanation:
      "Visa counts fraud reports and disputes together against this month's settled card-not-present transactions. A fraudulent order can appear in BOTH reports and be counted twice, and Shopify does not expose fraud reports - so the real figure is at least this and may be close to double.",
    projectedRatio,
    daysUntilBreach: daysUntilBreach({
      count,
      denominator,
      ratioThreshold: thresholds.ratio,
      countThreshold: thresholds.count,
      disputesPerDay: input.disputesPerDay ?? 0,
      transactionsPerDay: input.transactionsPerDay ?? 0
    }),
    // The honest flag. Every surface that renders a VAMP number must say so.
    isFloor: true
  };
}

export function assessEcm(input: {
  chargebacksThisMonth: number;
  capturedPaymentsPriorMonth: number;
  monthElapsed?: number;
  disputesPerDay?: number;
}): RatioAssessment {
  const denominator = input.capturedPaymentsPriorMonth;
  const count = input.chargebacksThisMonth;
  const ratio = denominator > 0 ? count / denominator : 0;

  const tier =
    count >= ECM_THRESHOLDS.hecm.count || ratio >= ECM_THRESHOLDS.hecm.ratio
      ? ECM_THRESHOLDS.hecm
      : ECM_THRESHOLDS.ecm;

  const elapsed = input.monthElapsed ?? 0;
  const projectedRatio = elapsed >= 0.25 && denominator > 0 ? ratio / elapsed : null;

  return {
    program: "ECM",
    label: "Mastercard ECM",
    ratio,
    count,
    countThreshold: tier.count,
    ratioThreshold: tier.ratio,
    status: classify(ratio, count, tier.ratio, tier.count),
    headroom: headroomFor(count, denominator, tier.ratio),
    consequence: "Fines start in month two and escalate: $1,000, then $5,000, then $25,000 a month while you stay over.",
    explanation:
      "Mastercard divides this month's chargebacks by LAST month's captured payments. Falling sales worsen this ratio next month with no extra chargebacks at all.",
    projectedRatio,
    // The denominator is fixed for the month - last month's sales - so a
    // forecast only depends on how fast disputes arrive.
    daysUntilBreach: daysUntilBreach({
      count,
      denominator,
      ratioThreshold: tier.ratio,
      countThreshold: tier.count,
      disputesPerDay: input.disputesPerDay ?? 0,
      transactionsPerDay: 0
    }),
    isFloor: false
  };
}

/**
 * The Mastercard denominator trap, made visible before it happens.
 *
 * Next month's ratio is this month's chargebacks over THIS month's sales. So a
 * store whose sales just fell knows today what its ratio becomes on the first of
 * the month - and nobody tells them.
 */
export function projectEcmNextMonth(input: {
  chargebacksThisMonth: number;
  capturedPaymentsThisMonth: number;
  capturedPaymentsPriorMonth: number;
}): { nextRatio: number; salesChange: number; warning: string | null } {
  const nextRatio =
    input.capturedPaymentsThisMonth > 0 ? input.chargebacksThisMonth / input.capturedPaymentsThisMonth : 0;

  const salesChange =
    input.capturedPaymentsPriorMonth > 0
      ? (input.capturedPaymentsThisMonth - input.capturedPaymentsPriorMonth) / input.capturedPaymentsPriorMonth
      : 0;

  // Only worth saying when sales fell enough to matter AND the result is near
  // the threshold. A quiet month at a healthy ratio is not news.
  const warning =
    salesChange <= -0.15 && nextRatio >= ECM_THRESHOLDS.ecm.ratio * WATCH_FRACTION
      ? `Your sales fell ${Math.abs(Math.round(salesChange * 100))}% this month. Mastercard divides next month's chargebacks by this month's sales, so your ECM ratio becomes ${(nextRatio * 100).toFixed(2)}% on the 1st even if nothing else changes.`
      : null;

  return { nextRatio, salesChange, warning };
}

/**
 * The warning nobody gives: Shopify Protect reimburses the money but does not
 * remove the chargeback from anyone's count. A merchant fully covered by Protect
 * can feel no financial pain at all and still be driven into a monitoring
 * programme.
 */
export function protectedButStillCounted(protectedChargebacks: number): string | null {
  if (protectedChargebacks <= 0) {
    return null;
  }

  return `${protectedChargebacks} of your chargebacks were reimbursed by Shopify Protect. That money came back, but every one of them still counts toward the ratios that decide whether you keep card processing at all.`;
}

/**
 * Which threshold to lead with.
 *
 * Not the worst ratio - the nearest real consequence. A merchant at 0.6% of
 * Shopify's 1% is in more trouble than one at 0.6% of Visa's unreachable 1.5%,
 * and showing five gauges gives them no way to know that.
 */
export function mostUrgent(assessments: RatioAssessment[]): RatioAssessment | null {
  const ranked = [...assessments].sort((a, b) => {
    const severity = { breach: 0, watch: 1, healthy: 2 } as const;
    if (severity[a.status] !== severity[b.status]) {
      return severity[a.status] - severity[b.status];
    }

    // Then whichever is soonest, treating "no forecast" as far away.
    const aDays = a.daysUntilBreach ?? Number.POSITIVE_INFINITY;
    const bDays = b.daysUntilBreach ?? Number.POSITIVE_INFINITY;
    if (aDays !== bDays) {
      return aDays - bDays;
    }

    return b.ratio / b.ratioThreshold - a.ratio / a.ratioThreshold;
  });

  return ranked[0] ?? null;
}
