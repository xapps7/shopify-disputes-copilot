/**
 * Visa Compelling Evidence 3.0: whether this dispute can be taken off the ratio.
 *
 * Every other remedy in this app recovers money and leaves the count alone. A
 * won 10.4 dispute is still a chargeback for VAMP purposes, so a merchant can
 * fight perfectly, win everything, and still be put in a monitoring programme
 * by the same volume of disputes. CE3.0 is the single exception: where the
 * merchant can show a prior relationship with the cardholder, Visa reassigns
 * liability AND removes the transaction from the fraud counts. It is therefore
 * worth far more than its win rate suggests, and it is the one thing merchants
 * almost never know to look for.
 *
 * THE FAILURE THIS PREVENTS is the expensive kind of optimism. The qualification
 * bar is narrow and unforgiving, and a merchant who submits a CE3.0 claim that
 * does not qualify has spent their one pre-arbitration response on an argument
 * the issuer will reject on procedure without reading it. So this module is
 * built to refuse rather than to encourage: it says "eligible" only when every
 * published criterion is satisfiable from data actually in hand, and otherwise
 * says in plain words which criterion failed.
 *
 * WHAT SHOPIFY DOES NOT GIVE US, stated once so nothing downstream pretends
 * otherwise:
 *
 *   - Device ID / fingerprint: the Admin API exposes none. There is no field,
 *     under any scope. It can only arrive from a fraud tool the merchant runs
 *     themselves, so for most shops it is permanently null.
 *   - IP address: only sometimes, via `order.clientDetails.browserIp`, and it
 *     is absent on draft orders, POS orders, and most API-created orders.
 *   - Cardholder identity: the PAN is never exposed, so "same cardholder" is
 *     approximated by the Shopify customer. That is a proxy, and it is the
 *     honest best available.
 *   - Issuer fraud reports (TC40 / SAFE): not in Shopify at all. We can see our
 *     own disputes on a prior order; we cannot see a fraud report filed against
 *     one that never became a chargeback. This is surfaced as a caveat rather
 *     than quietly ignored.
 *
 * Because two of those are optional in practice, every element is modelled as
 * nullable and a missing element is a non-match, never an error. The one place
 * that turns into a hard stop is deliberate: Visa requires IP address or device
 * fingerprint among the matched elements, so a shop with neither cannot qualify
 * at all, and saying so immediately is kinder than a checklist it can never
 * complete.
 *
 * Pure and dependency-free - no Prisma, no network, no `@/` imports - so the
 * caller loads order history however it likes and the rules can be tested
 * directly.
 */

/** Visa's floor: a prior must be at least this old at the dispute date. */
export const CE30_MIN_AGE_DAYS = 120;

/** Visa's ceiling: a prior older than this no longer counts. */
export const CE30_MAX_AGE_DAYS = 365;

/** Visa requires two qualifying prior transactions. Not one, not "about two". */
export const CE30_REQUIRED_PRIORS = 2;

/** Visa requires two matching data elements, one of them IP or device. */
export const CE30_REQUIRED_ELEMENTS = 2;

const MS_PER_DAY = 86_400_000;

/**
 * The four data elements Visa will accept as evidence of a prior relationship.
 *
 * Kept as identifiers rather than prose so callers can branch on them; the
 * merchant-facing wording lives in CE30_ELEMENT_LABELS.
 */
export type Ce30Element = "ipAddress" | "deviceId" | "userId" | "shippingAddress";

export const CE30_ELEMENT_LABELS: Record<Ce30Element, string> = {
  ipAddress: "IP address",
  deviceId: "Device fingerprint",
  userId: "Account user ID",
  shippingAddress: "Shipping address"
};

/**
 * The two elements Visa treats as strong enough to anchor a claim. At least one
 * of the two matched elements must come from this set - two soft matches (user
 * ID plus shipping address) do not qualify however clean they look.
 */
export const CE30_STRONG_ELEMENTS: readonly Ce30Element[] = ["ipAddress", "deviceId"];

/** Stable display order, strongest first. Drives the order of `matchedElements`. */
const ELEMENT_ORDER: readonly Ce30Element[] = ["ipAddress", "deviceId", "userId", "shippingAddress"];

/** The comparable fingerprint of a transaction. Every field is optional in reality. */
export type Ce30Elements = {
  /** Proxy for cardholder identity. Shopify never exposes the PAN. */
  customerEmail: string | null;
  /** `order.clientDetails.browserIp` where Shopify supplied one. */
  ip: string | null;
  /** Only ever from a merchant-run fraud tool. Null for most shops. */
  deviceId: string | null;
  /**
   * Shipping address, hashed or in full. Normalised before comparison either
   * way: callers differ on whether they hash, and normalising a hex digest is
   * harmless, so accepting both beats forcing one and silently mismatching.
   */
  shippingAddressHash: string | null;
  /** Merchant's own account identifier for the buyer, where the shop has logins. */
  userId: string | null;
};

export type Ce30Candidate = Ce30Elements & {
  orderId: string;
  orderName: string;
  /** ISO timestamp. Unparseable values are skipped, not guessed at. */
  processedAt: string;
  /**
   * Any dispute or chargeback the app knows about on this order. A prior that
   * was itself disputed disqualifies itself.
   */
  hadDispute: boolean;
  /**
   * An issuer fraud report on this order, if the merchant has that from a
   * source outside Shopify. Undefined means "none known here", which is not the
   * same as "none exists" - see the caveat this produces.
   */
  hadFraudReport?: boolean | null;
  /**
   * Which shop the order belongs to. Optional because a single-shop install has
   * only one, so this exists to catch history accidentally merged across shops.
   */
  merchantId?: string | null;
};

export type Ce30Dispute = {
  /**
   * Visa condition code, from `dispute.reasonDetails.networkReasonCode`.
   *
   * Note that sync falls back to `dispute.type` when Shopify sends no code, so
   * this field can legitimately hold "CHARGEBACK". We never infer 10.4 from the
   * reason enum: Shopify's `FRAUDULENT` covers Visa 10.4 and Mastercard 4837
   * alike, and CE3.0 is a Visa-only remedy.
   */
  conditionCode: string | null;
  /** ISO timestamp the dispute was raised. Ages are measured back from here. */
  disputeDate: string;
  /** The transaction under dispute. Priors are matched against this. */
  disputedTransaction: Ce30Elements & { orderId?: string | null; merchantId?: string | null };
};

export type Ce30Result = {
  /** True only when every published criterion is met by data in hand. */
  eligible: boolean;
  /** Exactly two priors when eligible, empty otherwise. Never a partial set. */
  qualifyingOrders: Ce30Candidate[];
  /** Elements shared by BOTH priors and the disputed order, strongest first. */
  matchedElements: Ce30Element[];
  /** Why it does not qualify, in words a merchant can act on. Empty when eligible. */
  blockers: string[];
  /** True of the result either way: limits of the data, not reasons to refuse. */
  caveats: string[];
};

/**
 * Collapses the cosmetic differences between two renderings of one address.
 *
 * "221B Baker St." and "221b baker st" are the same doorstep, and a comparison
 * that calls them different throws away a genuine Visa match over punctuation.
 * Everything that is not a letter or a digit becomes a single space, because
 * commas, full stops, hyphens and line breaks all vary by which Shopify surface
 * wrote the address.
 *
 * Deliberately NOT clever: no abbreviation expansion (Street/St, Apartment/Apt),
 * no transliteration. Those need locale knowledge we do not have, and a wrong
 * guess here manufactures a match that Visa will not honour.
 */
export function normaliseAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const collapsed = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return collapsed.length > 0 ? collapsed : null;
}

/**
 * Trim-and-lowercase for the identifier elements.
 *
 * IPv6 is case-insensitive in its hex, and user IDs arrive with stray padding
 * from CSV imports. No subnet or prefix matching for IPs: Visa asks whether the
 * IP matches, and calling two addresses in a /24 a match would be our claim,
 * not theirs.
 */
function normaliseToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Milliseconds since epoch, or null when the value is missing or unparseable. */
function parseTimestamp(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") {
    return null;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Whether this is a Visa 10.4 dispute.
 *
 * Matched as a whole token so "110.4" and "10.44" cannot slip through, and so a
 * decorated value such as "10.4 - Fraud, Card-Absent Environment" still counts.
 */
export function isCondition104(raw: string | null | undefined): boolean {
  return typeof raw === "string" && /\b10\.4\b/.test(raw);
}

/** The normalised, comparable form of one transaction's four elements. */
function comparable(elements: Ce30Elements): Record<Ce30Element, string | null> {
  return {
    ipAddress: normaliseToken(elements.ip),
    deviceId: normaliseToken(elements.deviceId),
    userId: normaliseToken(elements.userId),
    shippingAddress: normaliseAddress(elements.shippingAddressHash)
  };
}

/**
 * Which elements a prior shares with the disputed transaction.
 *
 * A null on either side is a non-match and nothing more. That is the whole
 * degradation strategy: shops without a fraud tool have `deviceId: null` on
 * every order forever, and that must cost them the device element rather than
 * throwing or, worse, matching null to null.
 */
export function matchingElements(
  disputed: Ce30Elements,
  prior: Ce30Elements
): Ce30Element[] {
  const left = comparable(disputed);
  const right = comparable(prior);

  return ELEMENT_ORDER.filter((element) => {
    const a = left[element];
    const b = right[element];
    return a !== null && b !== null && a === b;
  });
}

function hasStrongElement(elements: readonly Ce30Element[]): boolean {
  return elements.some((element) => CE30_STRONG_ELEMENTS.includes(element));
}

function label(elements: readonly Ce30Element[]): string {
  return elements.map((element) => CE30_ELEMENT_LABELS[element]).join(" and ");
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** A prior that failed the window, kept so the blocker can say by how much. */
type WindowMiss = "tooRecent" | "tooOld";

/**
 * Assess a 10.4 dispute against the merchant's own order history.
 *
 * The caller passes history it has already loaded - this function reads nothing.
 * All criteria are evaluated even after one fails, because a merchant who fixes
 * the first blocker only to be shown a second is being drip-fed; one pass should
 * tell them everything that is wrong.
 */
export function assessCe30(dispute: Ce30Dispute, history: Ce30Candidate[]): Ce30Result {
  const blockers: string[] = [];
  const caveats: string[] = [];

  if (!isCondition104(dispute.conditionCode)) {
    blockers.push(
      dispute.conditionCode
        ? `Compelling Evidence 3.0 applies only to Visa condition 10.4 (fraud, card-absent). This dispute is recorded as "${dispute.conditionCode}".`
        : "Compelling Evidence 3.0 applies only to Visa condition 10.4 (fraud, card-absent). No network condition code has been recorded on this dispute, so 10.4 cannot be confirmed."
    );
  }

  const disputeAt = parseTimestamp(dispute.disputeDate);
  if (disputeAt === null) {
    blockers.push(
      "The dispute date is missing or unreadable, so the 120-365 day window cannot be measured against it."
    );
  }

  // The hard stop. Visa requires IP address or device fingerprint among the two
  // matched elements, so when the disputed order carries neither, no amount of
  // prior history can rescue it. Said first and said plainly, because the
  // alternative is a merchant hunting for orders that could never have counted.
  const disputedElements = comparable(dispute.disputedTransaction);
  const strongAvailable = CE30_STRONG_ELEMENTS.filter(
    (element) => disputedElements[element] !== null
  );

  if (strongAvailable.length === 0) {
    blockers.push(
      "Neither an IP address nor a device fingerprint is available for the disputed order, and Visa requires one of the two among the matching elements. This dispute cannot qualify for Compelling Evidence 3.0 however much other history matches. Shopify's Admin API exposes no device fingerprint at all, and only sometimes records the buyer's IP."
    );
  }

  const disputedEmail = normaliseToken(dispute.disputedTransaction.customerEmail);
  if (disputedEmail === null) {
    blockers.push(
      "The disputed order has no customer email, so prior orders cannot be tied to the same cardholder. Visa requires the priors to be the same cardholder, and email is the closest identifier Shopify exposes."
    );
  }

  // Partition the history once, keeping a reason for every exclusion so the
  // blockers can be specific about what was nearly usable.
  const merchantId = dispute.disputedTransaction.merchantId ?? null;
  const disputedPriors: Ce30Candidate[] = [];
  const windowMisses: WindowMiss[] = [];
  const inWindow: Ce30Candidate[] = [];
  let unknownFraudHistory = 0;

  for (const candidate of history) {
    // Never let the disputed order qualify as its own prior.
    if (dispute.disputedTransaction.orderId && candidate.orderId === dispute.disputedTransaction.orderId) {
      continue;
    }

    // Visa wants priors with the same merchant. On a single-shop install this
    // never fires; it exists so cross-shop history cannot leak into a claim.
    if (merchantId && candidate.merchantId && candidate.merchantId !== merchantId) {
      continue;
    }

    const candidateEmail = normaliseToken(candidate.customerEmail);
    if (disputedEmail === null || candidateEmail === null || candidateEmail !== disputedEmail) {
      continue;
    }

    if (candidate.hadDispute || candidate.hadFraudReport === true) {
      disputedPriors.push(candidate);
      continue;
    }
    if (candidate.hadFraudReport === undefined || candidate.hadFraudReport === null) {
      unknownFraudHistory += 1;
    }

    const processedAt = parseTimestamp(candidate.processedAt);
    if (processedAt === null || disputeAt === null) {
      continue;
    }

    const ageDays = (disputeAt - processedAt) / MS_PER_DAY;
    if (ageDays < CE30_MIN_AGE_DAYS) {
      windowMisses.push("tooRecent");
      continue;
    }
    if (ageDays > CE30_MAX_AGE_DAYS) {
      windowMisses.push("tooOld");
      continue;
    }

    inWindow.push(candidate);
  }

  if (disputedPriors.length > 0) {
    caveats.push(
      `${disputedPriors.length} earlier ${plural(disputedPriors.length, "order was", "orders were")} excluded for carrying a dispute or fraud report. Visa requires the two priors to be clean.`
    );
  }

  // Only counted when the count means something. With no dispute date or no
  // cardholder to match on, "0 priors in the window" would be an artefact of
  // the missing input, and reporting it as a shortage of history would send the
  // merchant looking for orders that are very probably there.
  const countIsMeaningful = disputeAt !== null && disputedEmail !== null;

  if (countIsMeaningful && inWindow.length < CE30_REQUIRED_PRIORS) {
    blockers.push(
      `Only ${inWindow.length} prior undisputed ${plural(inWindow.length, "order", "orders")} in the ${CE30_MIN_AGE_DAYS}-${CE30_MAX_AGE_DAYS} day window; Visa requires ${CE30_REQUIRED_PRIORS}.`
    );

    const tooRecent = windowMisses.filter((miss) => miss === "tooRecent").length;
    const tooOld = windowMisses.filter((miss) => miss === "tooOld").length;
    if (tooRecent > 0 || tooOld > 0) {
      const detail: string[] = [];
      if (tooRecent > 0) {
        detail.push(`${tooRecent} newer than ${CE30_MIN_AGE_DAYS} days`);
      }
      if (tooOld > 0) {
        detail.push(`${tooOld} older than ${CE30_MAX_AGE_DAYS} days`);
      }
      // Worth saying: an order that is merely too recent becomes usable later,
      // and the merchant cannot tell that from a bare count.
      blockers.push(
        `${windowMisses.length} other undisputed ${plural(windowMisses.length, "order fell", "orders fell")} outside the window (${detail.join(", ")}).`
      );
    }
  }

  // Sorted oldest first so the chosen pair is stable across runs and reads in
  // the order a merchant would list them.
  const ordered = [...inWindow].sort((a, b) => {
    const left = parseTimestamp(a.processedAt) ?? 0;
    const right = parseTimestamp(b.processedAt) ?? 0;
    return left === right ? a.orderId.localeCompare(b.orderId) : left - right;
  });

  const perOrderMatches = new Map<string, Ce30Element[]>();
  for (const candidate of ordered) {
    perOrderMatches.set(candidate.orderId, matchingElements(dispute.disputedTransaction, candidate));
  }

  // Visa's requirement is read strictly: the SAME elements must match on both
  // priors. One prior matching on IP and another on shipping address is two
  // separate one-element stories, not the two-element pattern Visa asks for.
  // History here is one customer's orders, so the pairwise scan is cheap.
  let bestPair: [Ce30Candidate, Ce30Candidate] | null = null;
  let bestShared: Ce30Element[] = [];
  let bestNearMiss: Ce30Element[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const left = perOrderMatches.get(ordered[i].orderId) ?? [];
      const right = perOrderMatches.get(ordered[j].orderId) ?? [];
      const shared = left.filter((element) => right.includes(element));

      if (shared.length > bestNearMiss.length) {
        bestNearMiss = shared;
      }

      const qualifies = shared.length >= CE30_REQUIRED_ELEMENTS && hasStrongElement(shared);
      if (qualifies && shared.length > bestShared.length) {
        bestPair = [ordered[i], ordered[j]];
        bestShared = shared;
      }
    }
  }

  if (inWindow.length >= CE30_REQUIRED_PRIORS && bestPair === null) {
    const detail =
      bestNearMiss.length === 0
        ? "no two of them share a single data element with the disputed order"
        : bestNearMiss.length < CE30_REQUIRED_ELEMENTS
          ? `the best pair shares only ${bestNearMiss.length} element (${label(bestNearMiss)})`
          : `the best pair shares ${bestNearMiss.length} elements (${label(bestNearMiss)}), but neither is IP address nor device fingerprint`;

    blockers.push(
      `${inWindow.length} prior undisputed orders sit in the window, but ${detail}. Visa needs ${CE30_REQUIRED_ELEMENTS} matching elements on both priors, at least one of them IP address or device fingerprint.`
    );
  }

  const eligible = blockers.length === 0 && bestPair !== null;

  if (eligible && unknownFraudHistory > 0) {
    // Stated on the positive result on purpose. This is the one criterion we
    // cannot verify, and a merchant submitting the claim should know that the
    // issuer can see something we cannot.
    caveats.push(
      "Visa also requires the prior orders to carry no issuer fraud report (TC40/SAFE). Shopify does not expose that data, so this check covers disputes and chargebacks known to this app only."
    );
  }

  if (eligible && !dispute.disputedTransaction.orderId) {
    caveats.push(
      "The disputed order was not identified, so it could not be excluded from its own prior history. Confirm the two priors are genuinely earlier orders."
    );
  }

  return {
    eligible,
    qualifyingOrders: eligible && bestPair ? [bestPair[0], bestPair[1]] : [],
    matchedElements: eligible ? bestShared : [],
    blockers,
    caveats
  };
}
