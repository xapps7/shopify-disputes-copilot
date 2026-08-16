/**
 * Where a dispute is in the process.
 *
 * The app already implements a pipeline - sync, decide, build, submit, outcome -
 * and showed it nowhere, so a merchant could not tell whether a case still owed
 * them work or was finished and simply waiting. That gap is the most
 * anxiety-producing thing in the product: "Ready to send" and "still building"
 * look identical when all you have is a percentage.
 *
 * Deliberately modelled as STATE, not as a stepper. IBM Carbon's usage rules
 * exclude a progress indicator "when the process may be completed in any order"
 * and "when the number of steps may change based on conditional logic" - both of
 * which are true here. A merchant can accept at any point and skip everything;
 * a dispute can be decided early by the issuer; Ready regresses to Building when
 * a file is removed. So stage is an attribute a dispute HAS, rendered as a badge
 * or a count, never as a track with a moving dot.
 *
 * Named for what the merchant sees, not for the enum. NN/g on status trackers:
 * "Backend codes and internal jargon, such as 'fulfilled' or 'label created',
 * mean nothing to the user."
 *
 * Dependency-free on purpose, so the rules can be tested directly.
 */

export type DisputeStage = "NEW" | "BUILDING" | "READY" | "SUBMITTED" | "DECIDED";

/** Stage order for display. Not a claim that disputes traverse it in order. */
export const STAGE_ORDER: DisputeStage[] = ["NEW", "BUILDING", "READY", "SUBMITTED", "DECIDED"];

export type StageMeta = {
  label: string;
  /** One line, in the merchant's terms, about what this stage means. */
  description: string;
  /** Who the pipeline is waiting on. Drives whether a count reads as a to-do. */
  actor: "merchant" | "shopify" | "nobody";
};

export const STAGE_META: Record<DisputeStage, StageMeta> = {
  NEW: {
    label: "Needs a decision",
    description: "Nothing added yet. Decide whether this is worth fighting.",
    actor: "merchant"
  },
  BUILDING: {
    label: "Building the case",
    description: "Started, but the evidence would not stand on its own yet.",
    actor: "merchant"
  },
  READY: {
    label: "Ready to send",
    description: "The response is built. Nothing more is owed on these.",
    actor: "merchant"
  },
  SUBMITTED: {
    label: "With Shopify",
    description: "Sent. Nothing can be changed and nothing is owed.",
    actor: "shopify"
  },
  DECIDED: {
    label: "Closed",
    description: "Won, lost, or accepted.",
    actor: "nobody"
  }
};

/**
 * Statuses that mean the issuer has ruled, or the merchant gave up the money.
 * Mirrors CLOSED_STATUSES in the queue shells - kept here so stage and queue
 * banding can never disagree about what "closed" means.
 */
export const TERMINAL_STATUSES = new Set(["WON", "LOST", "ACCEPTED", "CLOSED", "CHARGE_REFUNDED"]);

/** Statuses that mean it is already with Shopify and can no longer be edited. */
export const SUBMITTED_STATUSES = new Set(["UNDER_REVIEW", "WARNING_UNDER_REVIEW"]);

/**
 * The bar for "this response would stand on its own".
 *
 * Same threshold the queue uses for its "Ready" badge. One number, one meaning:
 * a dispute the queue calls ready must be in the Ready stage, or the two
 * surfaces are lying to each other.
 */
export const READY_THRESHOLD = 75;

export type StageInput = {
  status: string;
  /** ISO timestamp Shopify recorded a submission, when there is one. */
  evidenceSentOn?: string | null;
  /** Reason-aware evidence coverage, 0-100. */
  completenessScore: number;
  /** Any evidence at all - files or written fields. */
  hasEvidence: boolean;
};

export function resolveStage(input: StageInput): DisputeStage {
  if (TERMINAL_STATUSES.has(input.status)) {
    return "DECIDED";
  }

  // Submission is checked before readiness: once it is sent, how complete it was
  // is history. Showing "Ready to send" next to something already sent would
  // invite a merchant to go looking for a button that cannot exist.
  if (input.evidenceSentOn || SUBMITTED_STATUSES.has(input.status)) {
    return "SUBMITTED";
  }

  if (input.completenessScore >= READY_THRESHOLD) {
    return "READY";
  }

  return input.hasEvidence || input.completenessScore > 0 ? "BUILDING" : "NEW";
}

/** True when the pipeline is waiting on the merchant. Used to total the real to-do. */
export function needsMerchant(stage: DisputeStage): boolean {
  return STAGE_META[stage].actor === "merchant";
}

/**
 * Which case to put in front of the merchant first.
 *
 * Deadline dominates, because it is the only input that expires: a large dispute
 * with three weeks left can wait for a small one auto-submitting tonight. Money
 * breaks ties. Stages nothing is owed on are never surfaced as the next action,
 * however large.
 */
export function rankForAttention(candidate: {
  stage: DisputeStage;
  hoursUntilAutoSubmit: number | null;
  amount: number;
}): number | null {
  if (!needsMerchant(candidate.stage)) {
    return null;
  }

  // A response that is already built is not the next thing to do, even if its
  // deadline is soonest - there is nothing left to add to it.
  if (candidate.stage === "READY") {
    return null;
  }

  const hours = candidate.hoursUntilAutoSubmit;

  // No published deadline yet. Real, and not urgent: rank behind everything
  // with a clock, ordered by money.
  if (hours === null) {
    return 1_000_000 - Math.min(candidate.amount, 999_999);
  }

  // Past the deadline: nothing can be added, so it is no longer actionable.
  if (hours <= 0) {
    return null;
  }

  return hours;
}

export type StageCount = {
  stage: DisputeStage;
  label: string;
  description: string;
  actor: StageMeta["actor"];
  count: number;
};

/** Counts for every stage, in display order, including the empty ones. */
export function countByStage(stages: DisputeStage[]): StageCount[] {
  const counts = new Map<DisputeStage, number>();
  for (const stage of stages) {
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }

  return STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_META[stage].label,
    description: STAGE_META[stage].description,
    actor: STAGE_META[stage].actor,
    count: counts.get(stage) ?? 0
  }));
}
