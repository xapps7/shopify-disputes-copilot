/**
 * When a dispute becomes read-only.
 *
 * Shopify is unambiguous: "After evidence is submitted, you can't make changes
 * or provide additional information", and "You can't appeal a chargeback
 * decision or submit additional evidence after a decision has been made."
 *
 * So once evidence has gone - whether the merchant submitted it or Shopify
 * auto-submitted at the deadline - editing it here would be theatre. The app
 * would be collecting work that can never reach anyone. That is the same class
 * of dishonesty as the old "submission has been detected" banner, and it is
 * worse, because the merchant spends real time on it.
 *
 * The record stays visible and copyable. It is the historical truth of what was
 * argued, and it is the input to learning which evidence actually wins.
 */

const DECIDED_STATUSES = new Set(["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED"]);

export type LockState = {
  locked: boolean;
  reason: string | null;
  /** Distinguishes "Shopify answered for you" from "you answered". */
  cause: "decided" | "submitted" | "auto-submitted" | null;
};

export function evaluateLock(input: {
  status: string;
  evidenceSentOn: Date | string | null;
  evidenceDueBy: Date | string | null;
  now?: Date;
}): LockState {
  const now = input.now ?? new Date();

  if (DECIDED_STATUSES.has(input.status?.toUpperCase?.() ?? "")) {
    return {
      locked: true,
      cause: "decided",
      reason:
        "This dispute has been decided. Card network decisions are final - Shopify does not support appeals or further evidence."
    };
  }

  const sentOn = input.evidenceSentOn ? new Date(input.evidenceSentOn) : null;
  if (sentOn && !Number.isNaN(sentOn.getTime())) {
    return {
      locked: true,
      cause: "submitted",
      reason:
        "The response has been submitted to Shopify. Once submitted it cannot be changed and nothing further can be added."
    };
  }

  const dueBy = input.evidenceDueBy ? new Date(input.evidenceDueBy) : null;
  if (dueBy && !Number.isNaN(dueBy.getTime()) && dueBy.getTime() <= now.getTime()) {
    return {
      locked: true,
      cause: "auto-submitted",
      reason:
        "The deadline has passed, so Shopify has already submitted a response using whatever evidence it held. Nothing can be added now."
    };
  }

  return { locked: false, cause: null, reason: null };
}
