/**
 * Estimating the chance of winning a representment.
 *
 * HONESTY NOTE, and it matters: there is no authoritative published win-rate
 * data. Visa and Mastercard publish none. Stripe publishes none. Every figure in
 * circulation traces back to a single self-reported vendor survey of ~250
 * merchants which quotes two different numbers for the same metric.
 *
 * So this model does two things and is explicit about both:
 *   1. A STRUCTURAL PRIOR from factors that are causally connected to outcomes -
 *      does delivery proof exist, does the shipping address match billing, was
 *      the payment 3DS-authenticated. These are reasoned, conservative, and
 *      labelled as priors, not measurements.
 *   2. EMPIRICAL UPDATING from the merchant's own outcomes, via a Beta-Binomial
 *      posterior. As real results accumulate the prior's influence fades.
 *
 * The estimate is always returned with a credible interval and a stated
 * confidence, and callers are expected to show a band rather than a false-
 * precision percentage.
 */

export type WinnabilityBand = "strong" | "moderate" | "weak";

export type WinFactors = {
  /** From the reason profile - how defensible this dispute type is at all. */
  band: WinnabilityBand;
  /** Carrier proof the order arrived. The single strongest factor. */
  hasDeliveryConfirmation: boolean;
  /** Tracking exists but delivery is not confirmed. */
  hasTracking: boolean;
  /** Shipping and billing addresses agree - central to a fraud claim. */
  addressesMatch: boolean | null;
  /** 3DS shifts fraud liability to the issuer. */
  threeDSecure: boolean | null;
  /** Fraction (0-1) of the decisive evidence fields actually filled in. */
  evidenceCompleteness: number;
  /** Nothing was added, so Shopify auto-submitted its generic default. */
  autoSubmittedOnly: boolean;
  /** Digital goods have no delivery proof to offer. */
  digitalGoods: boolean;
};

export type WinEstimate = {
  probability: number;
  low: number;
  high: number;
  confidence: "observed" | "blended" | "prior";
  sampleSize: number;
  /** Human-readable drivers, strongest first. Never present a bare number. */
  drivers: Array<{ label: string; effect: "up" | "down"; weight: number }>;
};

const BAND_PRIOR: Record<WinnabilityBand, number> = {
  // Deliberately conservative. Representment is adversarial and issuer-decided;
  // a model that promises more than it delivers costs merchants real money.
  strong: 0.45,
  moderate: 0.3,
  weak: 0.12
};

function logit(p: number) {
  const clamped = Math.min(0.999, Math.max(0.001, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Weights are in log-odds. They encode direction and rough magnitude, not
 * measured effect sizes - which is why the output is a band with an interval.
 */
const WEIGHTS = {
  deliveryConfirmation: 1.1,
  trackingOnly: 0.4,
  addressesMatch: 0.5,
  addressesMismatch: -0.9,
  threeDSecure: 1.2,
  autoSubmittedOnly: -1.0,
  digitalGoodsNoDelivery: -0.5,
  /** Completeness contributes up to this much when every decisive field is filled. */
  completenessMax: 0.8
};

export function structuralWinPrior(factors: WinFactors): { probability: number; drivers: WinEstimate["drivers"] } {
  let score = logit(BAND_PRIOR[factors.band]);
  const drivers: WinEstimate["drivers"] = [];

  const push = (label: string, weight: number) => {
    score += weight;
    drivers.push({ label, effect: weight >= 0 ? "up" : "down", weight: Math.abs(weight) });
  };

  if (factors.hasDeliveryConfirmation) {
    push("Delivery is confirmed by the carrier", WEIGHTS.deliveryConfirmation);
  } else if (factors.hasTracking) {
    push("Tracking exists but delivery is not confirmed", WEIGHTS.trackingOnly);
  } else if (!factors.digitalGoods) {
    push("No delivery or tracking evidence", -WEIGHTS.deliveryConfirmation);
  }

  if (factors.digitalGoods && !factors.hasDeliveryConfirmation) {
    push("Digital goods leave no delivery trail", WEIGHTS.digitalGoodsNoDelivery);
  }

  if (factors.addressesMatch === true) {
    push("Shipping and billing addresses match", WEIGHTS.addressesMatch);
  } else if (factors.addressesMatch === false) {
    push("Shipping and billing addresses differ", WEIGHTS.addressesMismatch);
  }

  if (factors.threeDSecure === true) {
    push("Payment was 3DS-authenticated, shifting fraud liability to the issuer", WEIGHTS.threeDSecure);
  }

  if (factors.autoSubmittedOnly) {
    push("Only Shopify's generic auto-response was sent", WEIGHTS.autoSubmittedOnly);
  } else {
    const completeness = Math.min(1, Math.max(0, factors.evidenceCompleteness));
    if (completeness > 0) {
      push(
        `${Math.round(completeness * 100)}% of the decisive evidence is present`,
        WEIGHTS.completenessMax * completeness
      );
    } else {
      push("None of the decisive evidence is present", -WEIGHTS.completenessMax);
    }
  }

  drivers.sort((a, b) => b.weight - a.weight);
  return { probability: sigmoid(score), drivers };
}

/** Minimum observed outcomes before we report anything as measured. */
export const MIN_SAMPLE_FOR_OBSERVED = 12;

/** How many pseudo-observations the structural prior is worth. */
const PRIOR_STRENGTH = 10;

export type ObservedOutcomes = { wins: number; losses: number };

/**
 * Beta-Binomial posterior: the merchant's own results progressively override the
 * prior. With no history the prior stands; with a lot of history it is drowned.
 */
export function estimateWinProbability(
  factors: WinFactors,
  observed: ObservedOutcomes = { wins: 0, losses: 0 }
): WinEstimate {
  const { probability: prior, drivers } = structuralWinPrior(factors);

  const alpha = prior * PRIOR_STRENGTH + observed.wins;
  const beta = (1 - prior) * PRIOR_STRENGTH + observed.losses;
  const total = alpha + beta;
  const mean = alpha / total;

  // Normal approximation to the Beta posterior; adequate at these sample sizes
  // and keeps the interval honest rather than implying false precision.
  const variance = (alpha * beta) / (total * total * (total + 1));
  const spread = 1.96 * Math.sqrt(variance);

  const sampleSize = observed.wins + observed.losses;
  const confidence: WinEstimate["confidence"] =
    sampleSize >= MIN_SAMPLE_FOR_OBSERVED ? "observed" : sampleSize > 0 ? "blended" : "prior";

  return {
    probability: mean,
    low: Math.max(0, mean - spread),
    high: Math.min(1, mean + spread),
    confidence,
    sampleSize,
    drivers
  };
}

export function describeConfidence(estimate: WinEstimate): string {
  switch (estimate.confidence) {
    case "observed":
      return `Based on ${estimate.sampleSize} of your own resolved disputes of this type.`;
    case "blended":
      return `Based on ${estimate.sampleSize} of your own resolved disputes, blended with a structural estimate. Treat it as directional.`;
    default:
      return "No resolved disputes of this type yet, so this is a structural estimate from the evidence, not a measured rate.";
  }
}
