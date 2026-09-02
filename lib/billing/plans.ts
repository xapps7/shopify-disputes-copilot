/**
 * What the app charges for, and what it refuses to charge for.
 *
 * The principle, in one line: FREE SHOWS THE MERCHANT WHAT IS HAPPENING, PAID
 * DOES THE WORK FOR THEM.
 *
 * The consequence that matters most is the one that looks like money left on
 * the table: DEADLINE ALERT EMAILS ARE FREE, FOREVER, AND SO IS THE WHOLE
 * DISPUTE QUEUE, AT ANY VOLUME. Shopify sends the merchant no deadline warning
 * and then auto-submits whatever is in the form when the clock runs out, so a
 * merchant who misses a deadline loses automatically. Putting a paywall in
 * front of the one thing that stops an automatic loss would earn exactly the
 * review that kills a distribution-first launch on the Shopify App Store -
 * "it told me I was about to lose and then asked for my card". Volume caps have
 * the same shape: the merchant with a spike of disputes is the one who most
 * needs to see them, and is the one a cap would silence.
 *
 * So the paid line is drawn around LABOUR, not around visibility:
 *   - free: seeing the disputes, the deadlines, the eligibility, the risk, the money
 *   - paid: writing the evidence, storing the documents, producing the exports,
 *     pushing evidence into Shopify's form
 *
 * This module is deliberately pure - no database, no Shopify, no `@/` alias
 * imports - so it runs unchanged under `node --experimental-strip-types` in
 * tests/billing.test.ts. Any change to who gets what should be visible as a
 * failing assertion in that file, not discovered by a merchant.
 */

/* ------------------------------------------------------------------ price --- */

/**
 * THE PRICE. One constant, on purpose.
 *
 * PLACEHOLDER - the owner sets this before launch. It is US dollars per month,
 * charged through Shopify's own billing (Shopify takes its revenue share and
 * bills it on the merchant's Shopify invoice, which is why merchants convert on
 * it far better than on a separate card form).
 *
 * Changing a live app's price does NOT change what existing subscribers pay.
 * Shopify subscriptions are immutable once approved: to move a merchant to a
 * new price you create a new subscription and they must approve it again, which
 * is a churn event.
 *
 * $9 is a deliberate land-grab number, chosen against a category where the
 * incumbent takes 25% of every recovered chargeback. "Nine dollars flat, keep
 * everything you win" is a position, not just a price. It is not chosen because
 * it reflects what the app is worth: one prevented loss on a typical dispute is
 * worth more than five years of it.
 *
 * What that costs, stated so nobody has to rediscover it: everyone who
 * subscribes at $9 stays at $9 for as long as they keep the subscription. The
 * way up is a SECOND, richer plan sold to new merchants - not a price change on
 * this one. So this plan is named for what it does ("Pro"), never for its
 * price, and the capability list below is the thing to grow.
 */
export const PAID_PLAN_PRICE_USD = 9;

/** Currency is fixed to USD: Shopify bills app charges in the app's currency. */
export const PAID_PLAN_CURRENCY = "USD" as const;

/**
 * Free days before the first charge. Shopify enforces this itself - the
 * subscription is ACTIVE during the trial and simply does not bill.
 *
 * 14 days is chosen to cover at least one real dispute cycle: a merchant who
 * never gets a chargeback during the trial has no way to judge the paid half of
 * the product, and cancels for the wrong reason.
 *
 * Worth revisiting once there is real data. A low-volume store may see no
 * chargeback at all in fourteen days, and then judges the paid features on
 * nothing. Thirty days matches a dispute cycle better; it also delays every
 * first payment by two weeks.
 */
export const PAID_PLAN_TRIAL_DAYS = 14;

/* ------------------------------------------------------------ capabilities --- */

/** Things the merchant can see. Never gated. */
export type FreeCapability =
  /** The dispute list, with deadlines. Unlimited disputes on every plan. */
  | "DISPUTE_QUEUE"
  /** Whether a dispute qualifies for Visa Compelling Evidence 3.0. */
  | "CE30_ELIGIBILITY"
  /** Ratios against the card-network and Shopify monitoring thresholds. */
  | "ACCOUNT_HEALTH"
  /** The dispute profit-and-loss, on screen. */
  | "PL_ON_SCREEN"
  /** Deadline warning emails. Free on purpose - see the note at the top. */
  | "DEADLINE_ALERTS";

/** Things the app does FOR the merchant. Gated. */
export type PaidCapability =
  /** The app writes the evidence text - see draftEvidenceFields in lib/disputes/evidence-fields.ts. */
  | "AUTO_DRAFT"
  /** Save a policy document once and reuse it across every dispute. */
  | "DOCUMENT_LIBRARY"
  /** Download the finished evidence pack. */
  | "PACKET_EXPORT"
  /** The monthly dispute statement for the bank or the CFO. */
  | "PL_EXPORT"
  /** Write evidence straight into Shopify's form. Dormant until Shopify grants the scope. */
  | "PUSH_TO_SHOPIFY";

export type Capability = FreeCapability | PaidCapability;

export const FREE_CAPABILITIES: readonly FreeCapability[] = [
  "DISPUTE_QUEUE",
  "CE30_ELIGIBILITY",
  "ACCOUNT_HEALTH",
  "PL_ON_SCREEN",
  "DEADLINE_ALERTS"
] as const;

export const PAID_CAPABILITIES: readonly PaidCapability[] = [
  "AUTO_DRAFT",
  "DOCUMENT_LIBRARY",
  "PACKET_EXPORT",
  "PL_EXPORT",
  "PUSH_TO_SHOPIFY"
] as const;

export const ALL_CAPABILITIES: readonly Capability[] = [...FREE_CAPABILITIES, ...PAID_CAPABILITIES];

/** Merchant-facing name for a capability, used in refusal messages. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  DISPUTE_QUEUE: "the dispute queue",
  CE30_ELIGIBILITY: "Compelling Evidence 3.0 checks",
  ACCOUNT_HEALTH: "account health",
  PL_ON_SCREEN: "the dispute profit and loss",
  DEADLINE_ALERTS: "deadline alert emails",
  AUTO_DRAFT: "drafting the evidence for you",
  DOCUMENT_LIBRARY: "the document library",
  PACKET_EXPORT: "downloading the evidence pack",
  PL_EXPORT: "the monthly statement export",
  PUSH_TO_SHOPIFY: "sending evidence into Shopify's form"
};

/* ------------------------------------------------------------------ plans --- */

/**
 * The plan keys are the values of the EXISTING `MerchantPlan` enum in
 * prisma/schema.prisma (STARTER / GROWTH / PLUS). That enum predates this
 * pricing model, is already a column on Merchant, and until now was read by
 * nothing at all.
 *
 * They are re-declared here as a string union rather than imported from
 * `@prisma/client` for two reasons: this module must stay importable by a test
 * that runs without the generated Prisma client, and the enum cannot be edited
 * (Prisma cannot be regenerated in this environment). The union is structurally
 * identical to the generated one, so `merchant.plan` assigns to it directly -
 * and if the enum ever gains a value, `planAllows` still fails closed on it.
 *
 * The commercial mapping is only two plans wide:
 *   STARTER -> the free plan, and the DEFAULT for every Merchant row
 *   GROWTH  -> the paid plan, the only thing this billing flow ever sells
 *   PLUS    -> not sold. See the note on the PLUS entry below.
 */
export type BillingPlanKey = "STARTER" | "GROWTH" | "PLUS";

export type BillingPlan = {
  key: BillingPlanKey;
  /** What the merchant sees in this app. */
  name: string;
  /** Stable slug for URLs and logs. Never shown on an invoice. */
  handle: string;
  /**
   * The name Shopify prints on the merchant's bill, and the string the
   * reconcile in lib/billing/subscription.ts matches an active subscription
   * against. Changing it orphans every existing subscription from the plan it
   * belongs to, so treat it as permanent.
   */
  shopifyPlanName: string | null;
  priceUsd: number;
  interval: "EVERY_30_DAYS" | "ANNUAL";
  trialDays: number;
  /** Whether starting this plan requires a Shopify subscription at all. */
  billed: boolean;
  capabilities: readonly Capability[];
};

export const BILLING_PLANS: Record<BillingPlanKey, BillingPlan> = {
  STARTER: {
    key: "STARTER",
    name: "Free",
    handle: "free",
    shopifyPlanName: null,
    priceUsd: 0,
    interval: "EVERY_30_DAYS",
    trialDays: 0,
    billed: false,
    capabilities: FREE_CAPABILITIES
  },
  GROWTH: {
    key: "GROWTH",
    name: "Pro",
    handle: "pro",
    shopifyPlanName: "Disputes Co-Pilot Pro",
    priceUsd: PAID_PLAN_PRICE_USD,
    interval: "EVERY_30_DAYS",
    trialDays: PAID_PLAN_TRIAL_DAYS,
    billed: true,
    capabilities: [...FREE_CAPABILITIES, ...PAID_CAPABILITIES]
  },
  /**
   * PLUS is not sold and nothing in this billing flow ever sets it. It exists
   * because the enum has three values and an unhandled third value is a bug
   * waiting to happen.
   *
   * It grants everything the paid plan grants. The only way a row reaches PLUS
   * is a human editing the database on purpose - a beta merchant, a partner, a
   * support gesture - and a human choosing the top tier means "give them
   * everything". Mapping it to free instead would silently take features away
   * from the people the owner most wanted to keep.
   */
  PLUS: {
    key: "PLUS",
    name: "Plus",
    handle: "plus",
    shopifyPlanName: null,
    priceUsd: PAID_PLAN_PRICE_USD,
    interval: "EVERY_30_DAYS",
    trialDays: PAID_PLAN_TRIAL_DAYS,
    billed: false,
    capabilities: [...FREE_CAPABILITIES, ...PAID_CAPABILITIES]
  }
};

/** The plan every Merchant row starts on, and the one every failure falls back to. */
export const FREE_PLAN_KEY: BillingPlanKey = "STARTER";

/** The one plan this app sells. */
export const PAID_PLAN_KEY: BillingPlanKey = "GROWTH";

export const FREE_PLAN = BILLING_PLANS[FREE_PLAN_KEY];
export const PAID_PLAN = BILLING_PLANS[PAID_PLAN_KEY];

/* ---------------------------------------------------------------- the test --- */

/**
 * Is `plan` allowed to use `capability`?
 *
 * Takes a loose `string | null | undefined` rather than `BillingPlanKey` on
 * purpose. The value arrives from a database column that a migration, a manual
 * edit, or a future enum value can put anything into, and the caller should not
 * have to prove it is a known plan before asking the question.
 *
 * AN UNRECOGNISED PLAN GRANTS NOTHING - not even the free capabilities. That is
 * stricter than "fall back to free" and it is deliberate: a null here means the
 * merchant record could not be read, and the honest answer to "may I do this
 * for a merchant I cannot identify?" is no. Callers that want the softer
 * behaviour ask through lib/billing/gate.ts, which resolves an unknown merchant
 * to the free plan explicitly and says so.
 */
export function planAllows(plan: string | null | undefined, capability: Capability): boolean {
  if (!plan) {
    return false;
  }

  const definition = BILLING_PLANS[plan as BillingPlanKey];
  if (!definition) {
    return false;
  }

  return definition.capabilities.includes(capability);
}

/** True when the capability is one the free plan already includes. */
export function isFreeCapability(capability: Capability): boolean {
  return (FREE_CAPABILITIES as readonly Capability[]).includes(capability);
}

/** Resolves an arbitrary stored value to a plan, or null when it is not one. */
export function resolvePlan(plan: string | null | undefined): BillingPlan | null {
  if (!plan) {
    return null;
  }
  return BILLING_PLANS[plan as BillingPlanKey] ?? null;
}

/** The sentence shown when a merchant hits a paid feature on the free plan. */
export function upgradeMessage(capability: Capability): string {
  const label = CAPABILITY_LABELS[capability] ?? "this feature";
  return (
    `${PAID_PLAN.name} covers ${label}. ` +
    `It is $${PAID_PLAN.priceUsd} a month with a ${PAID_PLAN.trialDays}-day free trial, billed through Shopify. ` +
    "Your dispute queue, deadlines and deadline emails stay free either way."
  );
}
