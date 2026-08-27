import { FEE_RECOVERY_ON_WIN, chargebackFee } from "./fees.ts";

/**
 * What disputes actually cost, in settled cash, over a period.
 *
 * Everything else on the account-health page is forward-looking: money at risk,
 * expected recovery, days until a threshold, the monthly premium of an alert
 * programme. All of it is an estimate about something that has not happened.
 *
 * A finance view is the other half. It asks one question first - what left the
 * bank account last period - and it is answerable from data already stored. No
 * Shopify query, no migration: `Dispute` carries the amount, the currency, the
 * status and the date it finalised.
 *
 * THE ARITHMETIC, stated because a P&L is only as honest as its definitions:
 *
 *   lost      = the amount is debited AND the fee is charged
 *   won       = the amount stays, and the fee is STILL charged
 *   accepted  = same as lost; conceding is not cheaper than losing
 *   net cost  = amounts lost + every fee
 *
 * `recovered` is money the merchant kept by winning. It is deliberately NOT
 * netted against cost, because it is not income - it is a debit that did not
 * happen. Adding it to the other side of the ledger would let a good month of
 * wins hide a bad month of fees.
 *
 * Fees follow `FEE_RECOVERY_ON_WIN`: Shopify's own pages disagree about whether
 * the fee comes back on a win, so this model never assumes it does. The result
 * is the number most merchants have never seen - what winning costs.
 */

/** Statuses where the outcome is final and the money has moved. */
const SETTLED_STATUSES = ["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED"] as const;

export function isSettledStatus(status: string): boolean {
  return (SETTLED_STATUSES as readonly string[]).includes(status);
}

export type DisputePlRecord = {
  status: string;
  /** "INQUIRY" or anything else. Inquiries carry no chargeback fee. */
  disputeType: string | null;
  /** Already converted out of Prisma's Decimal by the caller. */
  amount: number;
  currencyCode: string | null;
  finalizedOn: Date | null;
};

export type DisputePlLine = {
  currencyCode: string;
  settledCount: number;
  wonCount: number;
  lostCount: number;
  /** Gross value of everything that settled, whichever way it went. */
  disputedVolume: number;
  /** Kept by winning. Not income - a debit that did not happen. */
  recovered: number;
  /** Debited: lost, accepted and refunded alike. */
  lost: number;
  /** Every chargeback fee in the period, wins included. */
  feesPaid: number;
  /**
   * Fees paid on disputes that were WON. The number merchants do not expect,
   * and the reason `FEE_RECOVERY_ON_WIN.assumeRecovered` is false.
   */
  feesOnWins: number;
  /** amounts lost + every fee. What the period actually cost. */
  netCost: number;
  /** True when no published fee exists for this currency and USD was used. */
  feeEstimated: boolean;
};

export type DisputeProfitAndLoss = {
  label: string;
  lines: DisputePlLine[];
  /**
   * Disputes that are settled but carry no `finalizedOn`, so they cannot be
   * placed in a period. Surfaced rather than dropped: silently excluding them
   * would understate every figure above, and silently including them would put
   * an old loss in this month.
   */
  undatedSettled: number;
};

type Bucket = {
  settledCount: number;
  wonCount: number;
  lostCount: number;
  disputedVolume: number;
  recovered: number;
  lost: number;
  feesPaid: number;
  feesOnWins: number;
  feeEstimated: boolean;
};

function emptyBucket(): Bucket {
  return {
    settledCount: 0,
    wonCount: 0,
    lostCount: 0,
    disputedVolume: 0,
    recovered: 0,
    lost: 0,
    feesPaid: 0,
    feesOnWins: 0,
    feeEstimated: false
  };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Settled cost for one window, split by currency.
 *
 * Currencies are never summed together. A merchant selling in three currencies
 * has three P&Ls, and inventing a blended total would need an exchange rate the
 * app does not have and cannot honestly guess.
 */
export function buildDisputeProfitAndLoss(
  disputes: DisputePlRecord[],
  window: { start: Date; end: Date },
  label: string
): DisputeProfitAndLoss {
  const byCurrency = new Map<string, Bucket>();
  let undatedSettled = 0;

  for (const dispute of disputes) {
    if (!isSettledStatus(dispute.status)) {
      continue;
    }

    if (!dispute.finalizedOn) {
      undatedSettled += 1;
      continue;
    }

    const at = dispute.finalizedOn.getTime();
    if (at < window.start.getTime() || at >= window.end.getTime()) {
      continue;
    }

    const fee = chargebackFee(dispute.currencyCode);
    // Bill the fee in the dispute's own currency where one is published; only
    // fall back to the fee quote's currency when the dispute carries none.
    const currency = dispute.currencyCode ?? fee.currencyCode;
    const bucket = byCurrency.get(currency) ?? emptyBucket();

    const amount = finiteOrZero(dispute.amount);
    const isInquiry = (dispute.disputeType ?? "").toUpperCase() === "INQUIRY";
    const won = dispute.status === "WON";

    bucket.settledCount += 1;
    bucket.disputedVolume += amount;

    if (won) {
      bucket.wonCount += 1;
      bucket.recovered += amount;
    } else {
      bucket.lostCount += 1;
      bucket.lost += amount;
    }

    // Inquiries are retrieval requests, not chargebacks. No chargeback fee is
    // charged on one, so counting it would invent money that never moved.
    if (!isInquiry) {
      bucket.feesPaid += fee.amount;
      if (won && !FEE_RECOVERY_ON_WIN.assumeRecovered) {
        bucket.feesOnWins += fee.amount;
      }
      if (!fee.exact) {
        bucket.feeEstimated = true;
      }
    }

    byCurrency.set(currency, bucket);
  }

  const lines: DisputePlLine[] = [...byCurrency.entries()]
    .map(([currencyCode, bucket]) => ({
      currencyCode,
      settledCount: bucket.settledCount,
      wonCount: bucket.wonCount,
      lostCount: bucket.lostCount,
      disputedVolume: bucket.disputedVolume,
      recovered: bucket.recovered,
      lost: bucket.lost,
      feesPaid: bucket.feesPaid,
      feesOnWins: bucket.feesOnWins,
      netCost: bucket.lost + bucket.feesPaid,
      feeEstimated: bucket.feeEstimated
    }))
    .sort((a, b) => b.netCost - a.netCost);

  return { label, lines, undatedSettled };
}
