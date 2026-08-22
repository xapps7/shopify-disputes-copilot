import type { RatioStatus } from "./ratios.ts";

/**
 * Which chargeback-protection product is worth buying, and which one is being
 * mis-sold to you.
 *
 * The category sells against the wrong scoreboard. Every vendor in it prices
 * itself as protection, and a merchant reasonably assumes protection means
 * "this stops the thing that could cost me card processing". For most of these
 * products it does not. Only four things ever remove a dispute from the counts
 * in `ratios.ts`, and two of them are free.
 *
 * THREE THINGS MERCHANTS GET WRONG, and the reason this module exists:
 *
 *   1. AUTHORISATION REVERSAL IS FREE AND NOBODY SELLS IT. Issuers must file a
 *      TC40 fraud report on a CAPTURED payment even after you refund it, but not
 *      on an authorisation. Cancelling a suspicious auth before capture keeps
 *      the order out of VAMP entirely, at zero cost. It is the highest-leverage
 *      instrument here and it has no vendor, no salesperson and no dashboard,
 *      which is exactly why no merchant has heard of it.
 *
 *   2. RDR DOES NOT FIX FRAUD. Verifi sells RDR flatly as ratio protection.
 *      That is true for non-fraud disputes and misleading for fraud ones: the
 *      TC40 was already filed and still counts, so a fraud-heavy merchant buying
 *      RDR to fix a fraud problem has bought the wrong product. Worse for this
 *      app's merchants specifically - per the note in `ratios.ts`, Shopify's own
 *      1% has counted RDR-resolved disputes since January 2026, so RDR does not
 *      move the threshold that bites first.
 *
 *   3. 3DS IS MIS-SOLD. It shifts liability, so you keep the money on fraud
 *      codes. The fraud report still fires and still counts. Its only real
 *      connection to a monitoring programme is indirect and worth knowing:
 *      Visa Secure transactions auto-qualify for CE 3.0, and above 10% of
 *      Mastercard volume a merchant sits outside Mastercard's Excessive Fraud
 *      Merchant programme altogether.
 *
 * And the fact that decides whether alerts are worth anything: ALERTS COST YOU
 * THE SALE. RDR, CDRN and Ethoca all resolve by refunding. You avoid the
 * dispute, the fee and the ratio hit, and you lose the revenue and the goods.
 * So an alert is never cheaper than letting the dispute run - the arithmetic in
 * `priceRatioSlot` cannot produce a negative premium - and buying one is always
 * a decision to pay real money for a place in a ratio. Whether that is sane
 * depends entirely on how close the merchant is to a threshold, which is why
 * nothing here is a static "recommended stack".
 *
 * Sources:
 *  https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/visa-rules-public.pdf
 *  https://www.verifi.com/products/order-insight/
 *  https://www.verifi.com/products/rapid-dispute-resolution/
 *  https://www.ethoca.com/solutions/ethoca-alerts
 *  https://www.mastercard.us/content/dam/public/mastercardcom/na/global-site/documents/excessive-fraud-merchant-compliance-program.pdf
 */

export type ProtectionToolKey =
  | "AUTH_REVERSAL"
  | "ORDER_INSIGHT"
  | "ETHOCA_ALERTS"
  | "CDRN"
  | "RDR"
  | "CE30_POST_DISPUTE"
  | "THREE_DS"
  | "REPRESENTMENT";

/**
 * What the instrument does to the numerator - the only question that matters
 * for account survival. A boolean would flatten the three cases that make this
 * whole category confusing, so it does not get to be a boolean.
 */
export type RatioEffect =
  /** Gone. Never enters any count. */
  | "REMOVES"
  /** Gone only if you resolve it before the cardholder files. */
  | "REMOVES_IF_PRE_FILING"
  /** Gone for non-fraud reason codes. Fraud still counts via the TC40. */
  | "REMOVES_NON_FRAUD_ONLY"
  /** Counted, whatever the vendor page says. */
  | "NONE";

/** Whether you still have the money afterwards. "Yes, if won" is not "yes". */
export type MoneyEffect = "KEEPS" | "KEEPS_IF_WON" | "REFUNDS";

export type ProtectionTool = {
  key: ProtectionToolKey;
  name: string;
  /** Per-event price where one exists, 0 for free, null where it is not per-event. */
  costPerEvent: number | null;
  costNote: string;
  removesFromRatio: RatioEffect;
  keepsMoney: MoneyEffect;
  /** The thing the vendor page does not lead with. */
  caveat: string;
};

/**
 * The honest table. Read the two columns together: only the first two rows both
 * remove the dispute and leave you holding the money, and both of those are
 * free. Everything with a price tag either refunds the customer or leaves the
 * dispute in the count.
 */
export const PROTECTION_TOOLS: ProtectionTool[] = [
  {
    key: "AUTH_REVERSAL",
    name: "Reverse the authorisation before capture",
    costPerEvent: 0,
    costNote: "Free. Cancelling an authorisation costs nothing and there is no vendor to pay.",
    removesFromRatio: "REMOVES",
    keepsMoney: "KEEPS",
    caveat:
      "Only available before capture. Issuers must report TC40 fraud on a captured payment even if you refund it, but not on an authorisation - so the order has to be stopped while the auth is still open."
  },
  {
    key: "ORDER_INSIGHT",
    name: "Order Insight / CE 3.0 pre-dispute",
    costPerEvent: 0,
    costNote: "Bundled through your acquirer at no per-event charge.",
    removesFromRatio: "REMOVES",
    keepsMoney: "KEEPS",
    caveat:
      "Depends on your acquirer having it enabled and on the issuer querying before filing. When it works the fraud report is reversed, which is the only paid-for-you outcome in this table that both clears the count and keeps the sale."
  },
  {
    key: "ETHOCA_ALERTS",
    name: "Ethoca alerts",
    costPerEvent: 29,
    costNote: "About 29 per alert, and you pay per alert whether or not it would have become a dispute.",
    removesFromRatio: "REMOVES_IF_PRE_FILING",
    keepsMoney: "REFUNDS",
    caveat:
      "You resolve an alert by refunding, so you lose the revenue and the goods on top of the fee. Overlaps CDRN on roughly 15-20% of Visa disputes, where one order bills you twice."
  },
  {
    key: "CDRN",
    name: "Verifi CDRN",
    costPerEvent: 15,
    costNote: "About 15 per alert, again payable per alert rather than per dispute avoided.",
    removesFromRatio: "REMOVES_IF_PRE_FILING",
    keepsMoney: "REFUNDS",
    caveat:
      "Same refund-to-resolve mechanic as Ethoca at roughly half the price, but reaching Visa issuers rather than Mastercard ones. Running both double-bills the Visa disputes they share."
  },
  {
    key: "RDR",
    name: "Verifi RDR",
    costPerEvent: 15,
    costNote: "About 15 per resolved dispute, refunded automatically under rules you set in advance.",
    removesFromRatio: "REMOVES_NON_FRAUD_ONLY",
    keepsMoney: "REFUNDS",
    caveat:
      "Sold as ratio protection without qualification. True for non-fraud disputes; for fraud the TC40 has already been filed and still counts. It also refunds without you seeing the case, so you give away the ones you would have won."
  },
  {
    key: "CE30_POST_DISPUTE",
    name: "CE 3.0 compelling evidence (post-dispute)",
    costPerEvent: 0,
    costNote: "Included in representment - no separate charge.",
    removesFromRatio: "NONE",
    keepsMoney: "KEEPS_IF_WON",
    caveat:
      "The pre-dispute version reverses the fraud report; this one does not. Once the dispute is filed it is in the count for good, and CE 3.0 only decides who ends up with the money."
  },
  {
    key: "THREE_DS",
    name: "3D Secure",
    costPerEvent: null,
    costNote: "No per-event fee, but authenticated transactions carry a different interchange cost and add checkout friction.",
    removesFromRatio: "NONE",
    keepsMoney: "KEEPS",
    caveat:
      "The liability shift keeps the money on fraud codes; the TC40 fraud report still fires and still counts toward VAMP. Its real ratio value is indirect - Visa Secure transactions auto-qualify for CE 3.0, and above 10% of Mastercard volume you fall outside Mastercard's Excessive Fraud Merchant programme."
  },
  {
    key: "REPRESENTMENT",
    name: "Fighting the dispute (representment)",
    costPerEvent: null,
    costNote: "No fee beyond the time it takes to assemble evidence.",
    removesFromRatio: "NONE",
    keepsMoney: "KEEPS_IF_WON",
    caveat:
      "Recovers money and moves no ratio. The dispute was counted when it was filed and winning does not remove it, so this is never the answer to a threshold problem."
  }
];

const BY_KEY = new Map(PROTECTION_TOOLS.map((tool) => [tool.key, tool]));

function toolFor(key: ProtectionToolKey): ProtectionTool {
  const tool = BY_KEY.get(key);
  if (!tool) {
    throw new Error(`Unknown protection tool: ${key}`);
  }
  return tool;
}

/**
 * Planning assumptions, all of them stated rather than buried, because the
 * recommendation is only as honest as these are.
 */

/** Shopify's USD chargeback fee. The position carries no currency, so figures are USD-shaped. */
const ASSUMED_CHARGEBACK_FEE = 15;

/**
 * Share of a merchant's disputes an alert network can reach at all. Alerts only
 * exist where the issuer participates, so a programme never sees the whole book.
 * Deliberately conservative: it scales cost and benefit together, so it changes
 * the size of the bill without changing whether a slot is worth buying.
 */
const ALERT_REACH = 0.4;

/**
 * Share of alerts that would never have become a dispute. You refund them
 * anyway, because an alert gives you no way to tell which is which. This is the
 * cost of alerts that vendor pricing pages leave out entirely.
 */
const ALERT_OVERBROAD_SHARE = 0.25;

/** Alerts you pay for and refund per dispute actually kept out of the ratio. */
const ALERTS_PER_SLOT = 1 / (1 - ALERT_OVERBROAD_SHARE);

/**
 * Rough odds of winning if you fought instead of refunding. Fraud disputes are
 * hard to win without CE 3.0 qualification; non-fraud ones turn on evidence you
 * usually have. These only set how much revenue an auto-refund throws away, and
 * `win-probability.ts` is the real model once a merchant has outcomes of their own.
 */
const FRAUD_WIN_RATE = 0.12;
const NON_FRAUD_WIN_RATE = 0.4;

/** Above this share of disputes being fraud, RDR is the wrong product. */
const FRAUD_MAJORITY = 0.5;

/** A breach forecast this close is treated as happening rather than approaching. */
const IMMINENT_DAYS = 30;

/**
 * Where a ratio slot stops being cheap. Expressed in units of the dispute
 * itself: a load of 1 means keeping one dispute out of the count costs as much
 * again as the dispute would have cost you unmanaged. Below that, buying is
 * easy to justify the moment the ratio matters at all; above it, only a merchant
 * already in trouble should pay.
 */
const AFFORDABLE_LOAD = 1;

/** Share of Visa disputes that alert on both Ethoca and CDRN, billing twice. */
const ETHOCA_CDRN_OVERLAP = 0.175;

export type MerchantPosition = {
  /** 0-1, share of disputes filed under a fraud reason code. */
  fraudShare: number;
  monthlyDisputes: number;
  averageDisputeAmount: number;
  /** From `daysUntilBreach`. Null means no threshold is being approached. */
  nearestThresholdDays: number | null;
  status: RatioStatus;
};

export type SlotEconomics = {
  /** What one dispute costs if you leave it alone: the loss you expect, plus the fee. */
  disputeCostIfUnmanaged: number;
  /** Money given up, above that, to keep one dispute out of the ratio. */
  premiumPerSlot: number;
  /** The premium in units of the dispute itself. 0.5 is cheap insurance, 2 is not. */
  load: number;
  slotsPerMonth: number;
  /** Cash out of the door in alert fees. */
  monthlyFees: number;
  /** The true monthly cost: fees plus the revenue the refunds give away. */
  monthlyPremium: number;
};

/**
 * What one dispute-shaped hole in the ratio actually costs.
 *
 * Letting a dispute run costs you the amount when you lose it, plus the fee
 * either way. Intercepting it costs you the whole amount as a refund plus the
 * alert fee - and you pay for the over-broad alerts too, on orders that would
 * never have been disputed.
 *
 *   unmanaged  = (1 - winRate) * amount + fee
 *   intercepted = alertsPerSlot * (alertFee + amount)
 *   premium     = intercepted - unmanaged
 *
 * The premium cannot come out negative, and that is the finding rather than a
 * quirk of the constants: the refund alone equals or exceeds the expected loss,
 * so no alert product ever pays for itself in money. It buys a place in a ratio
 * and nothing else, which is why the caller has to decide whether the ratio is
 * worth anything to this merchant before the price means a thing.
 */
export function priceRatioSlot(input: {
  feePerEvent: number;
  averageDisputeAmount: number;
  /** Odds you would have won had you fought rather than refunded. */
  winRateIfFought: number;
  /** Disputes a month this instrument can actually reach. */
  disputesReachedPerMonth: number;
}): SlotEconomics {
  const amount = finiteOrZero(input.averageDisputeAmount);
  const winRate = clamp01(input.winRateIfFought);

  const disputeCostIfUnmanaged = (1 - winRate) * amount + ASSUMED_CHARGEBACK_FEE;
  const interceptCost = ALERTS_PER_SLOT * (input.feePerEvent + amount);
  const premiumPerSlot = interceptCost - disputeCostIfUnmanaged;

  const slotsPerMonth = finiteOrZero(input.disputesReachedPerMonth);

  return {
    disputeCostIfUnmanaged,
    premiumPerSlot,
    load: disputeCostIfUnmanaged > 0 ? premiumPerSlot / disputeCostIfUnmanaged : 0,
    slotsPerMonth,
    monthlyFees: slotsPerMonth * ALERTS_PER_SLOT * input.feePerEvent,
    monthlyPremium: slotsPerMonth * premiumPerSlot
  };
}

export type ProtectionRecommendation = {
  tool: ProtectionTool;
  /** True cost per month: fees plus revenue given away. Zero for the free instruments. */
  monthlyCost: number;
  rationale: string;
};

export type ProtectionWarning = {
  tool: ProtectionTool;
  reason: string;
};

export type ProtectionAdvice = {
  recommended: ProtectionRecommendation[];
  avoid: ProtectionWarning[];
  reasoning: string[];
};

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Callers upstream can genuinely have no figure: `getAccountHealth` returns a
 * null order count whenever the Shopify query fails, and a ratio computed from
 * that arrives here as NaN. Advice reading "about NaN a month" is worse than no
 * advice, so a missing number is treated as nothing rather than propagated.
 */
function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function money(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** Weighted by the merchant's own mix, not an industry average. */
function blendedWinRate(fraudShare: number): number {
  return fraudShare * FRAUD_WIN_RATE + (1 - fraudShare) * NON_FRAUD_WIN_RATE;
}

/**
 * What to buy, given where this merchant actually stands.
 *
 * The shape of the answer changes with the position rather than the position
 * reordering a fixed list. A healthy merchant with a handful of disputes is told
 * to buy nothing, and that is the correct answer rather than a failure to find
 * something to sell: a ratio slot is worth zero to them, and every priced
 * instrument here costs more than zero.
 */
export function recommendProtection(position: MerchantPosition): ProtectionAdvice {
  const fraudShare = clamp01(position.fraudShare);
  const disputes = finiteOrZero(position.monthlyDisputes);
  const amount = finiteOrZero(position.averageDisputeAmount);
  const winRate = blendedWinRate(fraudShare);

  const recommended: ProtectionRecommendation[] = [];
  const avoid: ProtectionWarning[] = [];
  const reasoning: string[] = [];

  const imminent = position.nearestThresholdDays !== null && position.nearestThresholdDays <= IMMINENT_DAYS;
  const approaching = position.nearestThresholdDays !== null;
  // A slot in the ratio is only worth money if the ratio is going somewhere.
  const ratioAtRisk = disputes > 0 && (position.status !== "healthy" || approaching);
  const urgent = position.status === "breach" || imminent;

  // Prices come from the table above rather than being restated here, so there
  // is one place to correct when a vendor moves its pricing.
  const alerts = {
    ethoca: priceRatioSlot({
      feePerEvent: toolFor("ETHOCA_ALERTS").costPerEvent ?? 0,
      averageDisputeAmount: amount,
      winRateIfFought: winRate,
      disputesReachedPerMonth: disputes * ALERT_REACH
    }),
    cdrn: priceRatioSlot({
      feePerEvent: toolFor("CDRN").costPerEvent ?? 0,
      averageDisputeAmount: amount,
      winRateIfFought: winRate,
      disputesReachedPerMonth: disputes * ALERT_REACH
    }),
    // RDR only ever fires on non-fraud disputes, so both its reach and the
    // revenue it throws away are the non-fraud half of the book.
    rdr: priceRatioSlot({
      feePerEvent: toolFor("RDR").costPerEvent ?? 0,
      averageDisputeAmount: amount,
      winRateIfFought: NON_FRAUD_WIN_RATE,
      disputesReachedPerMonth: disputes * (1 - fraudShare) * ALERT_REACH
    })
  };

  const worthPaying = (economics: SlotEconomics) =>
    ratioAtRisk && economics.slotsPerMonth > 0 && (economics.load <= AFFORDABLE_LOAD || urgent);

  /* --------------------------------------------------- the free instruments --- */

  // Unconditional, and first, because zero cost needs no arithmetic to justify:
  // anything it catches is ratio relief you were never going to be billed for.
  recommended.push({
    tool: toolFor("AUTH_REVERSAL"),
    monthlyCost: 0,
    rationale:
      "Cancel the authorisation on any order you would not ship rather than capturing and refunding. A refunded capture still generates the TC40 fraud report that counts against you; a reversed authorisation generates nothing at all."
  });

  recommended.push({
    tool: toolFor("ORDER_INSIGHT"),
    monthlyCost: 0,
    rationale:
      "Ask your acquirer to enable it. With Ethoca and CDRN you buy a clean ratio by refunding the customer; here the issuer resolves the query before filing, the fraud report is reversed, and you keep the sale."
  });

  if (fraudShare > 0) {
    recommended.push({
      tool: toolFor("CE30_POST_DISPUTE"),
      monthlyCost: 0,
      rationale: `It is included and it is the strongest evidence you can file on the ${Math.round(
        fraudShare * 100
      )}% of your disputes that are fraud - but it decides who keeps the money, not whether the dispute counts. That was settled when it was filed.`
    });
  }

  if (disputes > 0 && amount > ASSUMED_CHARGEBACK_FEE) {
    recommended.push({
      tool: toolFor("REPRESENTMENT"),
      monthlyCost: 0,
      rationale: urgent
        ? `Worth about ${money(
            winRate * amount
          )} a dispute in expected recovery, so keep doing it - but it will not move the number that is about to breach. Deflection is what does that.`
        : `Worth about ${money(winRate * amount)} a dispute in expected recovery against a ${money(
            ASSUMED_CHARGEBACK_FEE
          )} fee you pay either way.`
    });
  }

  /* ---------------------------------------------------------- the priced ones --- */

  if (!ratioAtRisk) {
    reasoning.push(
      disputes > 0
        ? "Buy nothing. Your ratio is healthy and no threshold is in forecast, so a place in the ratio is worth nothing to you - and every priced product here costs real money to buy one."
        : "Buy nothing. With no disputes there is nothing for a protection product to protect."
    );

    for (const key of ["CDRN", "ETHOCA_ALERTS", "RDR"] as const) {
      const economics = key === "RDR" ? alerts.rdr : key === "CDRN" ? alerts.cdrn : alerts.ethoca;
      avoid.push({
        tool: toolFor(key),
        reason: `About ${money(economics.monthlyPremium)} a month in fees and refunded orders to keep roughly ${
          Math.round(economics.slotsPerMonth * 10) / 10
        } disputes a month out of a ratio that is not threatening you. Revisit it if a threshold comes into forecast.`
      });
    }
  } else {
    // CDRN before Ethoca: same mechanic, roughly half the price per alert.
    if (worthPaying(alerts.cdrn)) {
      recommended.push({
        tool: toolFor("CDRN"),
        monthlyCost: alerts.cdrn.monthlyPremium,
        rationale: `About ${money(alerts.cdrn.monthlyFees)} a month in alert fees, ${money(
          alerts.cdrn.monthlyPremium
        )} a month once the refunded orders are counted, to keep roughly ${
          Math.round(alerts.cdrn.slotsPerMonth * 10) / 10
        } disputes a month out of the count. That is ${
          Math.round(alerts.cdrn.load * 100) / 100
        }x what each of those disputes would have cost you unmanaged, and you are paying it for the ratio, not the money.`
      });
    } else {
      avoid.push({
        tool: toolFor("CDRN"),
        reason: `Each dispute kept out of the ratio costs ${money(alerts.cdrn.premiumPerSlot)} against the ${money(
          alerts.cdrn.disputeCostIfUnmanaged
        )} that dispute costs you unmanaged - ${
          Math.round(alerts.cdrn.load * 100) / 100
        }x. At your average order value the refunds cost more than the disputes do, so this only makes sense once a threshold is actually about to bite.`
      });
    }

    // Ethoca reaches Mastercard issuers CDRN does not, but it is the dearer
    // network and the two collide on Visa. Only worth stacking when every
    // remaining slot counts.
    if (position.status === "breach" && worthPaying(alerts.ethoca)) {
      recommended.push({
        tool: toolFor("ETHOCA_ALERTS"),
        monthlyCost: alerts.ethoca.monthlyPremium,
        rationale: `You are already over a threshold, so the Mastercard issuers CDRN does not reach are worth ${money(
          alerts.ethoca.monthlyPremium
        )} a month as well. Expect roughly ${Math.round(
          ETHOCA_CDRN_OVERLAP * 100
        )}% of your Visa alerts to arrive on both networks and bill you twice for one order.`
      });
    } else {
      avoid.push({
        tool: toolFor("ETHOCA_ALERTS"),
        reason: `At about ${money(
          toolFor("ETHOCA_ALERTS").costPerEvent ?? 0
        )} an alert it buys the same refund-to-resolve outcome as CDRN at ${money(
          alerts.ethoca.monthlyPremium - alerts.cdrn.monthlyPremium
        )} a month more, and ${Math.round(
          ETHOCA_CDRN_OVERLAP * 100
        )}% of Visa disputes alert on both networks, so running the pair bills you twice for one order. Add it only if you are over a threshold and need the Mastercard reach.`
      });
    }

    // RDR: correct product for a non-fraud book, wrong product for a fraud one.
    if (fraudShare >= FRAUD_MAJORITY) {
      avoid.push({
        tool: toolFor("RDR"),
        reason: `${Math.round(
          fraudShare * 100
        )}% of your disputes are fraud, and RDR does not touch those - the TC40 was filed before the dispute and still counts. It is sold as ratio protection without that qualification, and buying it for a fraud problem buys nothing.`
      });
    } else if (worthPaying(alerts.rdr)) {
      recommended.push({
        tool: toolFor("RDR"),
        monthlyCost: alerts.rdr.monthlyPremium,
        rationale: `${Math.round(
          (1 - fraudShare) * 100
        )}% of your disputes are non-fraud, which is the half RDR actually removes, at about ${money(
          alerts.rdr.monthlyPremium
        )} a month. Two limits: it auto-refunds without you seeing the case, so you give away the ones you would have won, and Shopify has counted RDR-resolved disputes toward its own 1% since January 2026 - this helps the Visa count, not your Shopify standing.`
      });
    } else {
      avoid.push({
        tool: toolFor("RDR"),
        reason: `Only ${Math.round(
          (1 - fraudShare) * 100
        )}% of your disputes are the non-fraud kind RDR removes, and at ${money(
          alerts.rdr.premiumPerSlot
        )} per dispute cleared against ${money(
          alerts.rdr.disputeCostIfUnmanaged
        )} unmanaged, the auto-refunds cost more than the disputes. It also does nothing for Shopify's own 1%, which has counted RDR-resolved disputes since January 2026.`
      });
    }
  }

  /* --------------------------------------------------------------------- 3DS --- */

  if (fraudShare >= FRAUD_MAJORITY && ratioAtRisk) {
    recommended.push({
      tool: toolFor("THREE_DS"),
      monthlyCost: 0,
      rationale:
        "Worth turning on for the liability shift and because Visa Secure transactions auto-qualify for CE 3.0 - not for your ratio, which it does not touch. Above 10% of your Mastercard volume you also fall outside Mastercard's Excessive Fraud Merchant programme."
    });
  } else {
    avoid.push({
      tool: toolFor("THREE_DS"),
      reason:
        "Do not buy it as a ratio fix. The liability shift means you keep the money on fraud codes, but the issuer still files the TC40 and it still counts toward VAMP - and the checkout friction is real."
    });
  }

  /* --------------------------------------------------------------- narrative --- */

  reasoning.push(
    "Reversing a suspicious authorisation before you capture is free and removes the order from every count. Issuers must report TC40 fraud on a captured payment even after you refund it, but not on an authorisation - so a refund is not the same thing as a cancellation, and only one of them protects you."
  );

  if (disputes > 0) {
    reasoning.push(
      `Alerts cost you the sale. Resolving one means refunding, so a dispute kept out of the ratio through CDRN runs to about ${money(
        alerts.cdrn.premiumPerSlot
      )} - the alert fee plus the order you gave back - against ${money(
        alerts.cdrn.disputeCostIfUnmanaged
      )} if you had let it run. No alert product is ever cheaper than the dispute; it is ratio insurance and should be priced as such.`
    );
  }

  reasoning.push(
    "RDR protects your ratio only on non-fraud disputes. Vendors state it without the qualifier; for a fraud dispute the TC40 is already filed and still counts."
  );

  reasoning.push(
    "3D Secure shifts liability, so you keep the money on fraud codes. It does not stop the fraud report, so it does not help the ratio. Its real ratio value is indirect: Visa Secure transactions auto-qualify for CE 3.0."
  );

  reasoning.push(
    "Only Order Insight and pre-dispute CE 3.0 both remove the dispute and leave you with the money. Everything else either refunds the customer or leaves the dispute in the count."
  );

  return {
    // Free first, then cheapest, so the list reads in the order a merchant
    // should act rather than the order a vendor would pitch.
    recommended: [...recommended].sort((a, b) => a.monthlyCost - b.monthlyCost),
    avoid,
    reasoning
  };
}
