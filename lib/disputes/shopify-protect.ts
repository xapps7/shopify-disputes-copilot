/**
 * Shopify Protect: whether Shopify already paid for this chargeback.
 *
 * Shopify reimburses fraudulent and unrecognised chargebacks on eligible orders
 * at no cost to the merchant. That matters here for two opposite reasons:
 *
 *   1. If Shopify covered it, the money is NOT at risk, and telling the merchant
 *      to build a case is telling them to work for nothing.
 *   2. The card networks count the chargeback toward VAMP and ECM anyway. So a
 *      reimbursed chargeback is free of money risk and still costs account
 *      standing - which is exactly the distinction this app exists to make.
 *
 * Read from `order.shopifyProtect { status eligibility { status } }`, which needs
 * only `read_orders`. No inference from carriers or ship dates: the status is
 * authoritative and a guess would not be.
 *
 * IMPORTANT HONESTY CONSTRAINT: the API returns a status and NOT a reason. There
 * is no field saying "coverage was lost because you shipped on day 9". So this
 * module never claims to know why. It states what Shopify says, and lists the
 * documented criteria as things to check - which is the truth and is still
 * actionable.
 *
 * Dependency-free so the rules can be tested directly.
 */

/** `order.shopifyProtect.status` — ShopifyProtectStatus. */
export type ProtectStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "NOT_PROTECTED"
  | "PENDING"
  | "PROTECTED"
  /** Field absent, null, or a value Shopify added after this was written. */
  | "UNKNOWN";

/** `order.shopifyProtect.eligibility.status` — ShopifyProtectEligibilityStatus. */
export type ProtectEligibility = "ELIGIBLE" | "NOT_ELIGIBLE" | "PENDING" | "UNKNOWN";

const STATUSES = new Set<string>(["ACTIVE", "INACTIVE", "NOT_PROTECTED", "PENDING", "PROTECTED"]);
const ELIGIBILITIES = new Set<string>(["ELIGIBLE", "NOT_ELIGIBLE", "PENDING"]);

export function parseProtectStatus(raw: unknown): ProtectStatus {
  return typeof raw === "string" && STATUSES.has(raw) ? (raw as ProtectStatus) : "UNKNOWN";
}

export function parseProtectEligibility(raw: unknown): ProtectEligibility {
  return typeof raw === "string" && ELIGIBILITIES.has(raw) ? (raw as ProtectEligibility) : "UNKNOWN";
}

/** Reads the shape Shopify returns, wherever it has been stored. */
export function readProtect(value: unknown): { status: ProtectStatus; eligibility: ProtectEligibility } {
  const node = (value ?? {}) as { status?: unknown; eligibility?: { status?: unknown } | null };
  return {
    status: parseProtectStatus(node.status),
    eligibility: parseProtectEligibility(node.eligibility?.status)
  };
}

/**
 * Shopify's published eligibility criteria, as things to CHECK rather than a
 * diagnosis. Order matters: these are roughly the order of how often each one
 * is the cause, most common first.
 *
 * Kept here rather than in a component because it is documentation of Shopify's
 * behaviour, not presentation.
 */
export const COVERAGE_CRITERIA = [
  "Paid through Shop Pay",
  "Fulfilled with valid tracking within 7 days, and in transit within 10",
  "Shipped with one of Shopify's approved carriers",
  "Shipping address unchanged after checkout",
  "Physical items only - no digital goods or in-store pickup",
  "US merchant with a US Shopify Payments account"
] as const;

export type ProtectSignal = {
  /**
   * Whether to render anything at all.
   *
   * Silence is the default and it is deliberate. Shopify Protect is US-only, so
   * for every merchant outside the US every order is INACTIVE forever. A
   * permanent "not protected" badge would be pure noise for them, and worse, it
   * would imply they lost something they were never eligible for.
   */
  show: boolean;
  tone: "success" | "warning" | "info";
  headline: string;
  detail: string;
  /** Shopify already paid, so there is no money left to recover by fighting. */
  moneyAlreadyReturned: boolean;
  /** Show the criteria checklist - only where coverage was genuinely lost. */
  showCriteria: boolean;
};

const SILENT: ProtectSignal = {
  show: false,
  tone: "info",
  headline: "",
  detail: "",
  moneyAlreadyReturned: false,
  showCriteria: false
};

/**
 * What to say about Protect on a dispute, if anything.
 *
 * `PROTECTED` and `NOT_PROTECTED` are the only two statuses that carry
 * information once a chargeback exists: one means Shopify paid, the other means
 * this order had coverage and lost it. Everything else is either the normal
 * resting state or not yet decided, and says nothing worth a merchant's
 * attention.
 */
export function describeProtect(input: {
  status: ProtectStatus;
  eligibility: ProtectEligibility;
}): ProtectSignal {
  switch (input.status) {
    case "PROTECTED":
      return {
        show: true,
        tone: "success",
        headline: "Shopify reimbursed this chargeback",
        detail:
          "The money is not at risk, so there is nothing to recover by responding. It still counts toward the " +
          "dispute ratios that decide whether you keep card processing, which is the part worth watching.",
        moneyAlreadyReturned: true,
        showCriteria: false
      };

    case "NOT_PROTECTED":
      return {
        show: true,
        tone: "warning",
        headline: "This order was not covered by Shopify Protect",
        detail:
          "Shopify did not reimburse this one, so the full amount is yours to lose. Shopify does not publish which " +
          "requirement was missed, so it is worth checking the list against this order - each one is a change you " +
          "can make on the next order.",
        moneyAlreadyReturned: false,
        showCriteria: true
      };

    case "ACTIVE":
      // Coverage stands but no reimbursement has happened. Worth stating plainly
      // so a merchant does not build a case they may not need - while being
      // clear it is not a promise, because Shopify can withdraw it if the order
      // changes.
      return {
        show: true,
        tone: "info",
        headline: "Shopify Protect coverage is active on this order",
        detail:
          "Shopify may reimburse this if the chargeback is ruled fraudulent. Coverage can still be withdrawn if the " +
          "order changes, so it is not a guarantee - but it is worth knowing before you spend an hour on evidence.",
        moneyAlreadyReturned: false,
        showCriteria: false
      };

    case "INACTIVE":
    case "PENDING":
    case "UNKNOWN":
    default:
      return SILENT;
  }
}

/**
 * Whether this dispute should be counted in the "lost coverage" figure on
 * Account health. Deliberately narrow: only orders Shopify says were NOT
 * protected, never the ones that were never eligible.
 */
export function isLostCoverage(status: ProtectStatus): boolean {
  return status === "NOT_PROTECTED";
}

/**
 * Whether this merchant appears to be in Protect's addressable set at all.
 *
 * Used to decide whether Account health mentions Protect. A merchant with no
 * order ever eligible is almost certainly outside the US, and heading a section
 * "Shopify Protect" for them is a permanently useless panel.
 */
export function protectAppliesToShop(
  statuses: ReadonlyArray<{ status: ProtectStatus; eligibility: ProtectEligibility }>
): boolean {
  return statuses.some(
    (entry) =>
      entry.status === "PROTECTED" ||
      entry.status === "NOT_PROTECTED" ||
      entry.status === "ACTIVE" ||
      entry.eligibility === "ELIGIBLE"
  );
}

/**
 * Pulls the Protect status out of a stored order payload.
 *
 * The sync selects `order.shopifyProtect`, so it is already inside orderJson.
 * Reading it from there rather than a dedicated column means no migration to
 * run and no second copy to keep in step - and at a couple of hundred disputes
 * per merchant the parse is not measurable.
 *
 * Returns UNKNOWN for absent, malformed, or pre-upgrade snapshots, which is
 * exactly right: an order synced before the field was requested is not an order
 * that lost coverage, and must not be reported as one.
 */
export function readProtectFromOrderJson(
  orderJson: string | null | undefined
): { status: ProtectStatus; eligibility: ProtectEligibility } {
  if (!orderJson) {
    return { status: "UNKNOWN", eligibility: "UNKNOWN" };
  }

  try {
    const parsed = JSON.parse(orderJson) as { shopifyProtect?: unknown };
    return readProtect(parsed?.shopifyProtect);
  } catch {
    return { status: "UNKNOWN", eligibility: "UNKNOWN" };
  }
}
