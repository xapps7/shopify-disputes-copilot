/**
 * Removing the duplicate dispute rows written before the GID fix.
 *
 * Shopify returns the same dispute under two different GID types: the top-level
 * `disputes` connection gives `gid://shopify/ShopifyPaymentsDispute/<n>`, while
 * `Order.disputes` gives `gid://shopify/OrderDisputeSummary/<n>`. Keying rows on
 * the raw GID stored each dispute twice. A third bad shape ends `/unknown`, from
 * a webhook path that read `dispute_id` when the payload field is `id`.
 *
 * The order-derived twin carries the ORDER total rather than the disputed
 * amount, and no reason or deadline - so in the queue it appears as a second row
 * for the same dispute number reading "General" and "No auto-submit date".
 *
 * The sync no longer produces these. This clears what earlier versions left
 * behind, because code that stops creating bad rows does not remove the ones it
 * already wrote.
 *
 * WHAT THIS WILL NOT DO: delete a row that carries merchant work. A junk row is
 * still a row a merchant could have opened and uploaded a file against, and
 * evidence items and packets cascade on delete. Anything holding uploads or a
 * generated packet is reported back and left alone for a human to look at. The
 * cost of leaving a duplicate on screen is an untidy queue; the cost of the
 * other mistake is destroying evidence before a deadline.
 */

import { db } from "@/lib/db";
import { isLegacyDisputeKey } from "@/lib/disputes/dispute-keys";

export { isLegacyDisputeKey };

export type LegacyCleanupResult = {
  removed: number;
  /** Junk rows left in place because a merchant had put work into them. */
  keptWithWork: string[];
};

/**
 * Runs immediately before a sync imports, so any dispute that had ONLY a junk
 * row is recreated from Shopify in the same run rather than disappearing.
 *
 * Failure is not allowed to take the sync down with it. A tidy-up that blocks
 * dispute ingestion is worse than the untidiness it was trying to fix.
 */
export async function removeLegacyDuplicateDisputes(merchantId: string): Promise<LegacyCleanupResult> {
  const candidates = await db.dispute.findMany({
    where: {
      merchantId,
      OR: [{ shopifyDisputeId: { contains: "/OrderDisputeSummary/" } }, { shopifyDisputeId: { endsWith: "/unknown" } }]
    },
    select: {
      id: true,
      shopifyDisputeId: true,
      _count: { select: { evidenceItems: true, packets: true } }
    }
  });

  const disposable: string[] = [];
  const keptWithWork: string[] = [];

  for (const candidate of candidates) {
    if (candidate._count.evidenceItems > 0 || candidate._count.packets > 0) {
      keptWithWork.push(candidate.shopifyDisputeId);
      continue;
    }
    disposable.push(candidate.id);
  }

  if (disposable.length === 0) {
    return { removed: 0, keptWithWork };
  }

  const result = await db.dispute.deleteMany({ where: { id: { in: disposable } } });

  return { removed: result.count, keptWithWork };
}
