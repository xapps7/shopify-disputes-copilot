import { chargebackFee, FEE_RECOVERY_ON_WIN } from "./fees.ts";
import { estimateWinProbability, type ObservedOutcomes, type WinEstimate, type WinFactors } from "./win-probability.ts";
import type { RatioAssessment } from "./ratios.ts";

/**
 * What to actually do about this dispute.
 *
 * The insight the whole engine turns on: **winning a representment does not
 * improve your dispute ratio.** Visa counts a dispute when the chargeback posts;
 * the only documented exclusions are pre-dispute resolutions and CE3.0-qualified
 * fraud. Mastercard counts first presentments the same way.
 *
 * So there are two separate scoreboards, and they pull against each other:
 *
 *   money recovered  <- representment. Ratio-neutral.
 *   account survival <- dispute ratio. Unmoved by fighting.
 *
 * "Fight everything" is therefore incomplete advice, and for a merchant near a
 * monitoring threshold it is actively harmful: it substitutes activity for the
 * prevention and deflection that would actually save their card processing.
 */

export type DisputeAction =
  | "RESPOND_TO_INQUIRY"
  | "COVERED_BY_PROTECT"
  | "FIGHT"
  | "FIGHT_BUT_PRIORITISE_PREVENTION"
  | "ACCEPT"
  | "TOO_LATE"
  | "ALREADY_DECIDED";

export type StrategyInput = {
  disputeType: "INQUIRY" | "CHARGEBACK";
  status: string;
  amount: number;
  currencyCode: string | null;
  countryCode?: string | null;
  hoursUntilAutoSubmit: number | null;
  factors: WinFactors;
  observed?: ObservedOutcomes;
  /** The merchant's worst-standing ratio, when known. */
  ratio?: RatioAssessment | null;
  /** Rough cost of a person assembling evidence, in the dispute's currency. */
  effortCost?: number;
  reimbursedByShopifyProtect?: boolean;
};

export type StrategyRecommendation = {
  action: DisputeAction;
  headline: string;
  /** Expected value of fighting, net of effort. Accepting is always 0. */
  expectedValue: number;
  amountAtRisk: number;
  fee: { amount: number; currencyCode: string; note: string | null };
  win: WinEstimate;
  reasons: string[];
  warnings: string[];
};

const TERMINAL_STATUSES = new Set(["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED"]);

export function recommendStrategy(input: StrategyInput): StrategyRecommendation {
  const fee = chargebackFee(input.currencyCode, input.countryCode);
  const win = estimateWinProbability(input.factors, input.observed);
  const effortCost = input.effortCost ?? 0;

  const reasons: string[] = [];
  const warnings: string[] = [];

  // The fee is sunk the moment the chargeback posts, and Shopify's own docs
  // disagree about whether winning returns it - so it never inflates the upside.
  const recoverable = input.amount + (FEE_RECOVERY_ON_WIN.assumeRecovered ? fee.amount : 0);
  const amountAtRisk = input.amount + fee.amount;
  const expectedValue = win.probability * recoverable - effortCost;

  if (TERMINAL_STATUSES.has(input.status)) {
    return {
      action: "ALREADY_DECIDED",
      headline: "This dispute is closed. Decisions are final and cannot be appealed.",
      expectedValue: 0,
      amountAtRisk,
      fee,
      win,
      reasons: ["Shopify does not support the arbitration phase, so there is nothing further to submit."],
      warnings
    };
  }

  /**
   * Shopify already paid. This used to be a warning stapled to a FIGHT or ACCEPT
   * recommendation, which was incoherent: you cannot recover money you have
   * already been given, so the expected value of fighting is zero, not
   * `win.probability * amount`. It is its own outcome.
   *
   * Checked after TERMINAL_STATUSES and before everything else, because it
   * removes the money from the decision entirely - and the money is what every
   * branch below is weighing.
   */
  if (input.reimbursedByShopifyProtect) {
    return {
      action: "COVERED_BY_PROTECT",
      headline: "Shopify reimbursed this one. There is nothing to recover by responding.",
      expectedValue: 0,
      amountAtRisk: 0,
      fee,
      win,
      reasons: [
        "Shopify Protect covered the full amount, so responding cannot win back money you already have."
      ],
      warnings: [
        "The card networks still count this chargeback toward the ratios that decide whether you keep card processing. Reimbursement protects the money, not your account standing."
      ]
    };
  }

  // An inquiry is free to answer and never reaches the ratio. Nothing else in
  // the queue has a better return on ten minutes.
  if (input.disputeType === "INQUIRY") {
    return {
      action: "RESPOND_TO_INQUIRY",
      headline: "Answer this now - it costs nothing and stops a chargeback before it starts.",
      expectedValue: recoverable,
      amountAtRisk,
      fee,
      win,
      reasons: [
        "No money has been taken and no fee has been charged yet.",
        "An unanswered inquiry reads as accepting the claim, and the chargeback that follows is usually unwinnable.",
        "Inquiries are not counted in the Visa or Mastercard monitoring ratios."
      ],
      warnings: [
        ...warnings,
        "A partial refund does not resolve an inquiry - it can still escalate. Only a full refund or good evidence closes it."
      ]
    };
  }

  if (input.hoursUntilAutoSubmit !== null && input.hoursUntilAutoSubmit <= 0) {
    return {
      action: "TOO_LATE",
      headline: "Shopify has already sent a response for this dispute.",
      expectedValue: 0,
      amountAtRisk,
      fee,
      win,
      reasons: ["The deadline passed, so Shopify submitted whatever evidence it held."],
      warnings
    };
  }

  reasons.push(
    `${Math.round(win.probability * 100)}% estimated chance of winning, so fighting is worth about ${Math.round(
      expectedValue
    )} ${fee.currencyCode} against ${Math.round(amountAtRisk)} at risk.`
  );

  for (const driver of win.drivers.slice(0, 3)) {
    reasons.push(`${driver.effect === "up" ? "In your favour" : "Against you"}: ${driver.label.toLowerCase()}.`);
  }

  const nearThreshold = input.ratio && (input.ratio.status === "watch" || input.ratio.status === "breach");

  if (nearThreshold && input.ratio) {
    warnings.push(
      `Your ${input.ratio.program} ratio is ${(input.ratio.ratio * 100).toFixed(2)}% against a ${(
        input.ratio.ratioThreshold * 100
      ).toFixed(2)}% threshold. Winning this dispute will not reduce it - only preventing or deflecting disputes does.`
    );
  }

  if (input.factors.autoSubmittedOnly) {
    warnings.push(
      "Nothing has been added, so Shopify will respond with its generic default. That is the weakest version of your case."
    );
  }

  // Below the fee, fighting rarely repays the time even when you win.
  if (expectedValue <= 0 || input.amount < fee.amount) {
    return {
      action: "ACCEPT",
      headline: "Not worth fighting. Spend the time on preventing the next one.",
      expectedValue,
      amountAtRisk,
      fee,
      win,
      reasons: [
        ...reasons,
        input.amount < fee.amount
          ? `The disputed amount is smaller than the ${fee.currencyCode} ${fee.amount} chargeback fee, which you pay either way.`
          : "The expected recovery does not cover the effort of assembling evidence."
      ],
      warnings
    };
  }

  if (nearThreshold) {
    return {
      action: "FIGHT_BUT_PRIORITISE_PREVENTION",
      headline: "Worth fighting for the money - but your ratio is the bigger problem.",
      expectedValue,
      amountAtRisk,
      fee,
      win,
      reasons,
      warnings: [
        ...warnings,
        "Fighting recovers money. It does not protect your account. At this ratio, the account is the thing at risk."
      ]
    };
  }

  return {
    action: "FIGHT",
    headline: "Worth fighting. Get the decisive evidence in before Shopify responds for you.",
    expectedValue,
    amountAtRisk,
    fee,
    win,
    reasons,
    warnings: [
      ...warnings,
      "Do not submit early. Once submitted you cannot edit or add anything, and there is no advantage to going first."
    ]
  };
}

/** Portfolio view: what the open book is worth and what is realistically recoverable. */
export function summarisePortfolio(
  disputes: Array<{ amount: number; currencyCode: string | null; recommendation: StrategyRecommendation }>
) {
  const byCurrency = new Map<string, { atRisk: number; recoverable: number; count: number; worthFighting: number }>();

  for (const dispute of disputes) {
    const currency = dispute.currencyCode ?? dispute.recommendation.fee.currencyCode;
    const entry = byCurrency.get(currency) ?? { atRisk: 0, recoverable: 0, count: 0, worthFighting: 0 };

    entry.count += 1;
    entry.atRisk += dispute.recommendation.amountAtRisk;
    // Only count disputes we would actually advise fighting.
    if (dispute.recommendation.action === "FIGHT" || dispute.recommendation.action === "FIGHT_BUT_PRIORITISE_PREVENTION") {
      entry.recoverable += Math.max(0, dispute.recommendation.expectedValue);
      entry.worthFighting += 1;
    }
    if (dispute.recommendation.action === "RESPOND_TO_INQUIRY") {
      entry.recoverable += Math.max(0, dispute.recommendation.expectedValue);
      entry.worthFighting += 1;
    }

    byCurrency.set(currency, entry);
  }

  return [...byCurrency.entries()]
    .map(([currencyCode, totals]) => ({ currencyCode, ...totals }))
    .sort((a, b) => b.atRisk - a.atRisk);
}
