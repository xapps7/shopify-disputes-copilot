/**
 * Why a dispute happened, which decides what prevention advice is worth giving.
 *
 * This lives in its own module for one reason: it used to live inside
 * `auto-sync.ts`, which imports Prisma, so it could not be tested - and it was
 * wrong for the whole life of the app without anything failing.
 *
 * THE BUG: it compared `reason === "FRAUD"`. Sync stores Shopify's enum
 * verbatim and Shopify's value is `FRAUDULENT`, so the branch never fired once.
 * Every decided fraud dispute - the most common kind - fell through to
 * `DOCUMENTATION_GAP`, and the merchant was told to improve their paperwork
 * when the real problem was fraud screening.
 *
 * The same literal comparison had already been found and fixed in the checklist
 * and the analytics. It survived here because there was no test that could
 * reach it. Hence this file.
 */

import { normalizeReasonCode } from "./reason-codes.ts";

/** The categories `lib/ai/prevention.ts` branches on. */
export const ROOT_CAUSES = [
  "FRAUD_SCREENING",
  "FULFILLMENT_GAP",
  "POLICY_CLARITY",
  "CUSTOMER_SUPPORT_DELAY",
  "DOCUMENTATION_GAP"
] as const;

export type RootCause = (typeof ROOT_CAUSES)[number];

/** The dispute outcomes that mean the merchant kept the money. */
const WON = "WON";

/**
 * `status` is a Prisma `DisputeStatus` at every call site, but this module takes
 * a plain string so it stays free of the generated client and therefore
 * testable. The values are identical.
 */
export function inferRootCause(status: string, reason: string | null): RootCause {
  const code = normalizeReasonCode(reason);

  if (code === "FRAUDULENT" || code === "UNRECOGNIZED") {
    // A fraud dispute the merchant WON was not a screening failure: the charge
    // was good and they proved it, so the lesson is about evidence. One they
    // lost is a screening failure, and that is the advice worth giving.
    return status === WON ? "DOCUMENTATION_GAP" : "FRAUD_SCREENING";
  }

  if (code === "PRODUCT_NOT_RECEIVED") {
    return "FULFILLMENT_GAP";
  }

  return "DOCUMENTATION_GAP";
}

/**
 * True when a reason code is a fraud claim of either kind.
 *
 * Exported because `lib/ai/prevention.ts` carried its own copy of the same
 * broken literal comparison (`dispute.reason === "FRAUD"`), so the fraud
 * recommendations were also unreachable by reason alone. One helper, one place
 * to be right.
 */
export function isFraudReason(reason: string | null): boolean {
  const code = normalizeReasonCode(reason);
  return code === "FRAUDULENT" || code === "UNRECOGNIZED";
}

/** True when the claim is that the goods never arrived. */
export function isNonDeliveryReason(reason: string | null): boolean {
  return normalizeReasonCode(reason) === "PRODUCT_NOT_RECEIVED";
}
