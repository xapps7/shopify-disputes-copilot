import { db } from "@/lib/db";

/**
 * Tenant scoping.
 *
 * Every dispute and evidence lookup in this app used to be
 * `findUnique({ where: { id } })` with no merchant filter, so any dispute id
 * reached any merchant's data. These helpers are the only sanctioned way to
 * load a record from a request — always resolve the merchant first.
 */

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export async function requireMerchant(shopDomain: string) {
  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true, uninstalledAt: true }
  });

  if (!merchant || merchant.uninstalledAt) {
    throw new NotFoundError("Merchant is not installed.");
  }

  return merchant;
}

/**
 * Resolves a dispute that belongs to this merchant. A dispute owned by someone
 * else is reported as not-found, never as forbidden, so ids cannot be probed.
 */
export async function requireDispute(merchantId: string, disputeId: string) {
  const dispute = await db.dispute.findFirst({
    where: { id: disputeId, merchantId },
    select: { id: true, merchantId: true, shopifyDisputeId: true, shopifyOrderId: true, status: true }
  });

  if (!dispute) {
    throw new NotFoundError("Dispute not found.");
  }

  return dispute;
}

export async function requireEvidenceItem(merchantId: string, evidenceId: string) {
  const evidence = await db.evidenceItem.findFirst({
    where: { id: evidenceId, dispute: { merchantId } },
    select: { id: true, disputeId: true }
  });

  if (!evidence) {
    throw new NotFoundError("Evidence item not found.");
  }

  return evidence;
}

/** Guards the "move evidence to another dispute" path across tenants. */
export async function assertDisputeBelongsToMerchant(merchantId: string, disputeId: string) {
  const count = await db.dispute.count({ where: { id: disputeId, merchantId } });
  if (count === 0) {
    throw new NotFoundError("Dispute not found.");
  }
}
