/**
 * The decision layer for the evidence retention sweep.
 *
 * Settings has carried `evidenceRetentionDays` since the first release and
 * nothing has ever read it. That is worse than a missing feature: the field
 * promises a merchant that we throw their customers' data away on a schedule,
 * and we do not. It also blocks the Shopify Protected Customer Data
 * attestation, which asks for a retention period and expects a real answer.
 *
 * The answer this module implements is:
 *
 *   Personal data is kept while a dispute is open, and for a configured window
 *   after it is finalised (never less than 90 days). After that the personal
 *   data is erased and only non-identifying outcome data - reason code, amount,
 *   currency, won/lost - is kept.
 *
 * Everything here is PURE. No Prisma, no network, no `Date.now()`: `now` is
 * always a parameter. That is not stylistic. This layer decides which merchant
 * evidence gets destroyed, so it has to be exhaustively testable without a
 * database, and it has to give the same answer twice for the same inputs.
 *
 * The one runtime dependency is `./scrub.ts`, which is itself import-free and
 * therefore safe under `node --experimental-strip-types`.
 *
 * BIAS: when a value is missing, unparseable, or contradictory, the answer is
 * KEEP. Keeping data too long is a compliance problem we can fix next sweep.
 * Deleting a merchant's evidence one day early is unrecoverable and can lose
 * them a live case.
 */

import { scrubJsonString } from "./scrub.ts";

/* ------------------------------------------------------------------ *
 * Windows
 * ------------------------------------------------------------------ */

/**
 * The window after a decision during which the case can come back.
 *
 * A chargeback decision is not the end of the road. Pre-arbitration and
 * arbitration let an issuer reopen a case the merchant has already won, and
 * those stages run on their own filing clocks that chain one after another.
 * Ninety days covers the realistic worst case with room to spare.
 *
 * Personal data must survive at least this long past finalisation no matter
 * what the merchant typed into Settings. This is the number that stops the
 * sweep from being the thing that loses a dispute.
 */
export const RETENTION_GRACE_DAYS = 90;

/**
 * Floor for the merchant-configurable window.
 *
 * Tied to the grace period on purpose. A merchant typing "1" into a text box
 * must not be able to shred the evidence for a case an issuer can still
 * reopen - they do not know the arbitration timetable, and Settings is not the
 * place to find out. The floor is enforced twice, here at parse time and again
 * in `effectiveRetentionWindowDays`, so a caller that skips the parser still
 * cannot delete inside the window.
 */
export const MIN_RETENTION_DAYS = RETENTION_GRACE_DAYS;

/**
 * Ceiling for the merchant-configurable window: seven years.
 *
 * Two jobs. It absorbs "999999999" without special-casing, and it means the
 * retention answer always has an end date. An unbounded field would make the
 * PCD attestation a lie by omission - "we keep it as long as the merchant
 * says" is not a retention period. Seven years is the outer edge of ordinary
 * financial record-keeping, so no legitimate setting is refused.
 */
export const MAX_RETENTION_DAYS = 2555;

/** Matches `defaultMerchantSettings.evidenceRetentionDays` in lib/settings.ts. */
export const DEFAULT_RETENTION_DAYS = 365;

const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ *
 * What the sweep destroys, and what it keeps
 * ------------------------------------------------------------------ */

/**
 * Columns holding personal data, which the sweep erases.
 *
 * Two erasure shapes, because the data has two shapes:
 *
 *  - Structured JSON blobs go through `scrubJsonString`, which nulls the
 *    customer keys and leaves the document shape intact. Readers such as
 *    `lib/disputes/repository.ts` keep working and simply see "no customer on
 *    file". Reusing the webhook scrubber matters: two scrubbers would drift,
 *    and the one that drifted would leak.
 *
 *  - Free text cannot be scrubbed by key. Merchant-written narrative in
 *    `evidenceFieldsJson` and evidence titles routinely name the cardholder
 *    inside a sentence. There is no safe partial erasure of a paragraph, so
 *    the whole value goes.
 */
export const ERASED_PERSONAL_DATA: readonly string[] = [
  "Dispute.sourceSnapshotJson (scrubbed)",
  "Dispute.reasonDetails (free text, cleared)",
  "Dispute.evidenceFieldsJson (merchant narrative, cleared)",
  "EvidenceItem.structuredValueJson (scrubbed)",
  "EvidenceItem.title / EvidenceItem.description (free text, cleared)",
  "EvidenceItem.fileUrl (pointer cleared)",
  "EvidencePacket.summaryText / EvidencePacket.pdfUrl (the PDF names the customer)",
  "DisputeTimelineEvent.payloadSummaryJson (scrubbed)",
  "OrderSnapshot.customerEmail / OrderSnapshot.customerName (nulled)",
  "OrderSnapshot.orderJson (scrubbed)"
];

/**
 * Non-identifying outcome data, which the sweep KEEPS.
 *
 * Named explicitly because `lib/economics/win-probability.ts` updates its
 * estimate from the merchant's own history. A sweep that deleted dispute rows
 * outright would quietly reset every merchant's win model to the generic prior
 * once a year, and nobody would connect the two events. So evidence rows are
 * scrubbed in place rather than deleted: `EvidenceItem.category` is the signal
 * that says which kinds of evidence actually win.
 */
export const RETAINED_OUTCOME_DATA: readonly string[] = [
  "Dispute.status (won/lost/accepted)",
  "Dispute.reason (reason code)",
  "Dispute.disputeType",
  "Dispute.amount",
  "Dispute.currencyCode",
  "Dispute.initiatedAt / evidenceDueBy / evidenceSentOn / finalizedOn",
  "EvidenceItem.category / readinessState",
  "OrderSnapshot.orderTotal / currencyCode / fulfillmentStatus / riskLevel"
];

/**
 * Identifiers kept after the sweep, which are pseudonymous rather than
 * anonymous, and must be described that way rather than glossed over.
 *
 * They are kept because sync needs them: `shopifyDisputeId` is the unique key
 * that stops the next dispute pull from re-creating the row it just scrubbed,
 * complete with fresh customer data. They are not personal data on their own,
 * but Shopify can still resolve them back to a person, so the honest
 * attestation sentence says "identifiers retained, personal data erased" - not
 * "fully anonymised".
 */
export const RETAINED_LINKABLE_IDS: readonly string[] = [
  "Dispute.shopifyDisputeId",
  "Dispute.shopifyOrderId",
  "OrderSnapshot.shopifyOrderId",
  "OrderSnapshot.orderName"
];

/**
 * Uploaded bytes outlive the sweep and the caller has to say so.
 *
 * `lib/storage.ts` exposes `persistUploadedFile` / `persistPacketDraft` and no
 * delete helper - the same gap `lib/compliance/redaction.ts` already documents
 * for `shop/redact`. Clearing `fileUrl` removes our route to the object, not
 * the object. Reporting that as "deleted" would be the same class of untruth
 * this module exists to remove.
 */
export const FILES_PENDING_DELETION_NOTE =
  "Stored evidence and packet files are listed as pending deletion, not deleted: lib/storage.ts has no delete helper yet, so the sweep can only clear the database pointer.";

/* ------------------------------------------------------------------ *
 * Settings parsing
 * ------------------------------------------------------------------ */

/**
 * Turn the free-text Settings value into a number the sweep can act on.
 *
 * `evidenceRetentionDays` is a string in a JSON text column, typed by hand.
 * Every failure mode resolves towards keeping data:
 *
 *  - blank, absent, or not a plain number  -> the default (365)
 *  - negative                              -> the default; a negative window
 *    is not an intent, it is a typo or a hostile payload, and honouring it as
 *    "zero days" would be catastrophic
 *  - below the floor, including "0"        -> the floor (90). Unlike a
 *    negative, a small number IS an intent - "keep as little as possible" -
 *    so it is honoured as far as it is safe to honour it
 *  - above the ceiling                     -> the ceiling (2555)
 *  - fractional                            -> rounded UP, because rounding
 *    down would delete a day earlier than the merchant asked for
 */
export function parseRetentionDays(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) {
    return DEFAULT_RETENTION_DAYS;
  }

  const trimmed = String(raw).trim();

  if (!trimmed) {
    return DEFAULT_RETENTION_DAYS;
  }

  // Deliberately stricter than Number(): this rejects "1e9", "Infinity",
  // "0x10", "12 days" and " " rather than letting them become a window.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return DEFAULT_RETENTION_DAYS;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_RETENTION_DAYS;
  }

  const days = Math.ceil(parsed);

  if (days < MIN_RETENTION_DAYS) {
    return MIN_RETENTION_DAYS;
  }

  if (days > MAX_RETENTION_DAYS) {
    return MAX_RETENTION_DAYS;
  }

  return days;
}

/**
 * The window actually applied, whatever the caller passed in.
 *
 * Second enforcement of the floor. `parseRetentionDays` already clamps, but a
 * future caller may compute a number some other way, and the grace period is
 * not negotiable by any code path.
 */
export function effectiveRetentionWindowDays(retentionDays: number): number {
  if (!Number.isFinite(retentionDays)) {
    return DEFAULT_RETENTION_DAYS;
  }

  return Math.min(MAX_RETENTION_DAYS, Math.max(RETENTION_GRACE_DAYS, Math.ceil(retentionDays)));
}

/* ------------------------------------------------------------------ *
 * Per-dispute decision
 * ------------------------------------------------------------------ */

/**
 * Minimal structural input, not the Prisma type.
 *
 * The Prisma client cannot be regenerated in this environment, and tests must
 * be able to build a dispute literal in one line. Dates are accepted as `Date`
 * or string because callers read them from Prisma, from JSON, and from tests.
 */
export type RetentionCandidate = {
  id: string;
  status: string | null | undefined;
  finalizedOn?: Date | string | null;
  evidenceSentOn?: Date | string | null;
  updatedAt?: Date | string | null;
};

/**
 * Statuses that mean a decision has been handed down.
 *
 * Same set as `DECIDED_STATUSES` in `lib/disputes/locking.ts`, copied rather
 * than imported because that module does not export it and it is outside this
 * change. If one moves, move both.
 *
 * Note what is NOT here: a submitted dispute. `evaluateLock` treats
 * "evidence sent" as locked, and it is right to - nothing more can be added.
 * But locked is not finished. The issuer has not ruled, the case is live, and
 * its evidence is exactly what we would need if it comes back. Conflating the
 * two would delete evidence for open cases.
 */
const FINISHED_STATUSES = new Set(["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED"]);

/** Statuses we recognise as still live, so the sweep can say so precisely. */
const LIVE_STATUSES = new Set(["NEEDS_RESPONSE", "UNDER_REVIEW", "WARNING_NEEDS_RESPONSE"]);

export type RetentionVerdict = "due" | "keep";

export type RetentionCode =
  /** Still live. Never swept. */
  | "open"
  /** Status is UNKNOWN, empty, or something we do not recognise. */
  | "unrecognised_status"
  /** Finished, but no usable date to measure age from. */
  | "no_anchor"
  /** Finished, dated, but not old enough yet. */
  | "within_window"
  /** Anchor date is in the future. Clock skew or bad sync data. */
  | "future_dated"
  /** Finished, dated by `finalizedOn`, past the window. */
  | "due"
  /** Finished, dated by a fallback timestamp, past the extended window. */
  | "due_by_proxy";

export type RetentionDecision = {
  id: string;
  verdict: RetentionVerdict;
  code: RetentionCode;
  /** One sentence, for logs and for telling a merchant the truth. */
  reason: string;
  /** Which timestamp the age was measured from. */
  anchor: "finalizedOn" | "evidenceSentOn" | "updatedAt" | null;
  anchorAt: string | null;
  /** Whole days between the anchor and `now`. Negative means future-dated. */
  ageDays: number | null;
  /** The window this decision was measured against, including any proxy penalty. */
  windowDays: number;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whole days only, floored.
 *
 * Deleting on a fractional overshoot would make the sweep's behaviour depend
 * on the minute it happened to run. Flooring plus the strict `>` comparison
 * below means a dispute is never destroyed a day early because of clock skew
 * or a timezone offset.
 */
function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function normaliseStatus(status: string | null | undefined): string {
  return (status ?? "").trim().toUpperCase();
}

/**
 * Full decision for one dispute, with the reason attached.
 *
 * `isDueForScrub` is the boolean view of this. Use this one when the answer is
 * going into a log or in front of a merchant, because "no" is not a useful
 * thing to record about data we chose not to delete.
 */
export function assessRetention(
  dispute: RetentionCandidate,
  retentionDays: number,
  now: Date
): RetentionDecision {
  const windowDays = effectiveRetentionWindowDays(retentionDays);
  const status = normaliseStatus(dispute.status);

  const base = {
    id: dispute.id,
    anchor: null,
    anchorAt: null,
    ageDays: null,
    windowDays
  } as const;

  if (!FINISHED_STATUSES.has(status)) {
    // An open dispute is NEVER due. Its evidence is the live case.
    if (LIVE_STATUSES.has(status)) {
      return {
        ...base,
        verdict: "keep",
        code: "open",
        reason: `Dispute ${dispute.id} is still open (${status}), so nothing is erased.`
      };
    }

    // UNKNOWN, blank, or a status a future Shopify API version invented. We
    // cannot tell whether the case is live, so we keep. A growing pile of
    // these is a broken-sync alarm, which is why the plan counts them: a
    // silent skip is how personal data ends up living forever.
    return {
      ...base,
      verdict: "keep",
      code: "unrecognised_status",
      reason: `Dispute ${dispute.id} has status "${status || "(empty)"}", which we cannot confirm is finished, so nothing is erased.`
    };
  }

  const finalized = toDate(dispute.finalizedOn);

  // Missing `finalizedOn` is common, not exotic: it is only written when the
  // outcome is recorded through lib/disputes/outcomes.ts, so a dispute that
  // arrived already decided from a dispute pull can be finished with no
  // finalisation date at all.
  //
  // Refusing to ever sweep those would fail the other way - we would promise
  // erasure and retain personal data indefinitely for the exact cases the
  // promise is about. So we fall back to the LATEST other timestamp we hold
  // (evidence submission, then last write) and charge an extra grace period on
  // top. The proxy can only be EARLIER than the true finalisation date, never
  // later, so the extra 90 days absorbs the error. If there is no usable
  // timestamp at all, we keep, and the plan reports it as unaged.
  const anchorFrom = finalized
    ? { at: finalized, anchor: "finalizedOn" as const, window: windowDays, code: "due" as const }
    : pickProxyAnchor(dispute, windowDays);

  if (!anchorFrom) {
    return {
      ...base,
      verdict: "keep",
      code: "no_anchor",
      reason: `Dispute ${dispute.id} is finished but carries no usable date, so its age cannot be established and nothing is erased.`
    };
  }

  const ageDays = wholeDaysBetween(anchorFrom.at, now);
  const dated = {
    id: dispute.id,
    anchor: anchorFrom.anchor,
    anchorAt: anchorFrom.at.toISOString(),
    ageDays,
    windowDays: anchorFrom.window
  };

  if (ageDays < 0) {
    // A finalisation date after `now` means someone's clock or Shopify's
    // payload is wrong. Treating a future date as "very old" would be the
    // worst possible reading of bad data.
    return {
      ...dated,
      verdict: "keep",
      code: "future_dated",
      reason: `Dispute ${dispute.id} is dated in the future (${anchorFrom.anchor} ${dated.anchorAt}), which we do not trust, so nothing is erased.`
    };
  }

  // Strictly greater than, so a dispute sitting exactly on the limit is kept
  // for one more day. On the boundary the cheap mistake is waiting.
  if (ageDays > anchorFrom.window) {
    return {
      ...dated,
      verdict: "due",
      code: anchorFrom.code,
      reason: `Dispute ${dispute.id} was finished ${ageDays} days ago (${anchorFrom.anchor}), past its ${anchorFrom.window}-day window, so its personal data is due for erasure.`
    };
  }

  return {
    ...dated,
    verdict: "keep",
    code: "within_window",
    reason: `Dispute ${dispute.id} was finished ${ageDays} days ago, inside its ${anchorFrom.window}-day window, so nothing is erased yet.`
  };
}

function pickProxyAnchor(
  dispute: RetentionCandidate,
  windowDays: number
): { at: Date; anchor: "evidenceSentOn" | "updatedAt"; window: number; code: "due_by_proxy" } | null {
  const candidates: Array<{ at: Date; anchor: "evidenceSentOn" | "updatedAt" }> = [];
  const sentOn = toDate(dispute.evidenceSentOn);
  const updatedAt = toDate(dispute.updatedAt);

  if (sentOn) {
    candidates.push({ at: sentOn, anchor: "evidenceSentOn" });
  }

  if (updatedAt) {
    candidates.push({ at: updatedAt, anchor: "updatedAt" });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Latest wins: the most recent timestamp is the closest lower bound on when
  // this dispute actually stopped moving.
  const latest = candidates.reduce((best, entry) => (entry.at.getTime() > best.at.getTime() ? entry : best));

  return {
    at: latest.at,
    anchor: latest.anchor,
    window: windowDays + RETENTION_GRACE_DAYS,
    code: "due_by_proxy"
  };
}

/** Boolean view of `assessRetention`, for call sites that only need the gate. */
export function isDueForScrub(
  dispute: RetentionCandidate,
  retentionDays: number,
  now: Date
): boolean {
  return assessRetention(dispute, retentionDays, now).verdict === "due";
}

/* ------------------------------------------------------------------ *
 * Batch plan
 * ------------------------------------------------------------------ */

export type RetentionSweepPlan = {
  /** Echoed so a stored plan is self-describing without its call site. */
  now: string;
  /** What the caller asked for. */
  requestedRetentionDays: number;
  /** What was applied after the floor and ceiling. */
  windowDays: number;
  graceDays: number;
  /** Ids whose personal data should be erased. Sorted. */
  due: string[];
  /** Ids left alone. Sorted. */
  keep: string[];
  /** Every decision, sorted by id, so the plan can be diffed run to run. */
  decisions: RetentionDecision[];
  /**
   * Finished disputes with no usable date. These can never age out, so they
   * need surfacing rather than silently counting as "kept".
   */
  unaged: string[];
  /** Finished-ness we could not confirm. A rising count means sync is broken. */
  unrecognised: string[];
  summary: string;
};

/**
 * Plan a sweep over a batch. Deterministic: sorted by id, no randomness, no
 * reliance on input order, and no clock of its own.
 */
export function planRetentionSweep(
  disputes: readonly RetentionCandidate[],
  retentionDays: number,
  now: Date
): RetentionSweepPlan {
  const windowDays = effectiveRetentionWindowDays(retentionDays);

  // Deduplicate by id, and let KEEP win any disagreement. A caller that joins
  // the same dispute twice must not be able to turn a keep into a delete.
  const byId = new Map<string, RetentionDecision>();

  for (const dispute of disputes) {
    const decision = assessRetention(dispute, retentionDays, now);
    const existing = byId.get(decision.id);

    if (!existing) {
      byId.set(decision.id, decision);
      continue;
    }

    if (existing.verdict === "due" && decision.verdict === "keep") {
      byId.set(decision.id, decision);
    }
  }

  const decisions = [...byId.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const due = decisions.filter((decision) => decision.verdict === "due").map((decision) => decision.id);
  const keep = decisions.filter((decision) => decision.verdict === "keep").map((decision) => decision.id);
  const unaged = decisions.filter((decision) => decision.code === "no_anchor").map((decision) => decision.id);
  const unrecognised = decisions
    .filter((decision) => decision.code === "unrecognised_status")
    .map((decision) => decision.id);

  const plan: RetentionSweepPlan = {
    now: now.toISOString(),
    requestedRetentionDays: retentionDays,
    windowDays,
    graceDays: RETENTION_GRACE_DAYS,
    due,
    keep,
    decisions,
    unaged,
    unrecognised,
    summary: ""
  };

  return { ...plan, summary: describeSweepPlan(plan) };
}

/* ------------------------------------------------------------------ *
 * Saying what happened, honestly
 * ------------------------------------------------------------------ */

/** One sentence naming what goes and what stays for a single dispute. */
export function describeDisputeRetention(decision: RetentionDecision): string {
  if (decision.verdict === "keep") {
    return decision.reason;
  }

  return `${decision.reason} Erased: customer name and email, the raw order and dispute JSON, free-text evidence and narrative, and the packet PDF. Kept: reason code, amount, currency and the won/lost outcome.`;
}

/** One sentence for the whole batch, for the sweep log and the audit trail. */
export function describeSweepPlan(plan: Pick<RetentionSweepPlan,
  "now" | "requestedRetentionDays" | "windowDays" | "graceDays" | "due" | "keep" | "unaged" | "unrecognised">): string {
  const total = plan.due.length + plan.keep.length;
  const clamped =
    plan.requestedRetentionDays === plan.windowDays
      ? `${plan.windowDays}-day window`
      : `${plan.windowDays}-day window (setting ${plan.requestedRetentionDays} adjusted to respect the ${plan.graceDays}-day reopen grace and the ${MAX_RETENTION_DAYS}-day cap)`;

  const parts = [
    `Retention sweep at ${plan.now}: ${plan.due.length} of ${total} finished disputes are past the ${clamped}.`,
    `Their personal data is erased; reason code, amount, currency and the won/lost outcome are kept so win-rate history survives.`,
    `${plan.keep.length} kept.`
  ];

  if (plan.unaged.length > 0) {
    parts.push(
      `${plan.unaged.length} finished dispute(s) carry no usable date, so they can never age out and need a manual look.`
    );
  }

  if (plan.unrecognised.length > 0) {
    parts.push(
      `${plan.unrecognised.length} dispute(s) have a status we cannot confirm is finished and were skipped.`
    );
  }

  return parts.join(" ");
}

/**
 * The retention sentence for the PCD questionnaire and the merchant-facing
 * Settings help text, generated from the number actually in force so the two
 * can never disagree.
 */
export function describeRetentionPolicy(retentionDays: number): string {
  const windowDays = effectiveRetentionWindowDays(retentionDays);

  return (
    `Personal data is retained while a payment dispute is open, and for ${windowDays} days after it is finalised ` +
    `(never fewer than ${RETENTION_GRACE_DAYS} days, because an issuer can reopen a decided case through arbitration). ` +
    `After that the personal data is erased and only non-identifying outcome data is kept: reason code, amount, currency, and whether the dispute was won or lost.`
  );
}

/* ------------------------------------------------------------------ *
 * Erasure values
 * ------------------------------------------------------------------ */

/**
 * The replacement value for a JSON column being swept.
 *
 * Thin wrapper over the webhook scrubber so the sweep and `customers/redact`
 * cannot diverge - one scrubber, one set of PII keys, one place to fix a leak.
 * `OrderSnapshot.orderJson` is NOT NULL, so a null result has to become `"{}"`;
 * the caller decides which columns need that, exactly as
 * `lib/compliance/redaction.ts` does.
 */
export function scrubbedJsonValue(json: string | null | undefined): string | null {
  return scrubJsonString(json);
}

/**
 * Placeholder for a NOT NULL free-text column such as `EvidenceItem.title`.
 *
 * Blanking it would leave a nameless row the merchant cannot interpret. Saying
 * why the text is gone is more useful and equally erased.
 */
export const ERASED_TEXT_PLACEHOLDER = "[erased by retention policy]";
