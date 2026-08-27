/**
 * Collapsing duplicate dispute rows.
 *
 * Shopify returns the same dispute under more than one GID type: the top-level
 * `disputes` connection gives `gid://shopify/ShopifyPaymentsDispute/<n>`, while
 * `Order.disputes` gives `gid://shopify/OrderDisputeSummary/<n>`. Keying rows on
 * the raw GID stored each dispute twice. The order-derived twin carries the
 * ORDER total rather than the disputed amount and no reason or deadline, so the
 * queue shows one dispute number on two lines - once with a real reason and
 * deadline, once as "General / No auto-submit date".
 *
 * The sync no longer writes these. This clears what earlier versions left
 * behind, because code that stops creating bad rows does not remove the ones it
 * already wrote.
 *
 * Duplicates are found by IDENTITY, not by a recognised-bad prefix. The first
 * version of this matched the two GID shapes already known to be wrong, which
 * can only ever clean up the cases somebody had already thought of - and it
 * silently does nothing if the stored keys turn out to have a third shape. Two
 * rows that normalise to the same dispute are duplicates whatever either key
 * looks like.
 *
 * WHAT THIS WILL NOT DO: delete a row carrying merchant work. Evidence items and
 * packets cascade on delete, and a junk row is still a row a merchant could have
 * opened and uploaded a file against. Those are reported back and left alone.
 * The cost of leaving a duplicate on screen is an untidy queue; the cost of the
 * other mistake is destroying evidence before a deadline. It also never deletes
 * a row that is the only record of its dispute, however odd the key looks.
 */

import { db } from "@/lib/db";
import { isLegacyDisputeKey, planDuplicateCleanup } from "@/lib/disputes/dispute-keys";

export { isLegacyDisputeKey };

export type LegacyCleanupResult = {
  removed: number;
  /** Duplicates left in place because a merchant had put work into them. */
  keptWithWork: string[];
};

/**
 * Runs immediately before a sync imports, so a dispute whose surviving row was
 * the junk one is refreshed from Shopify in the same run.
 *
 * Failure is not allowed to take the sync down with it. A tidy-up that blocks
 * dispute ingestion is worse than the untidiness it was trying to fix.
 */
export async function removeLegacyDuplicateDisputes(merchantId: string): Promise<LegacyCleanupResult> {
  const rows = await db.dispute.findMany({
    where: { merchantId },
    select: {
      id: true,
      shopifyDisputeId: true,
      reason: true,
      evidenceDueBy: true,
      createdAt: true,
      _count: { select: { evidenceItems: true, packets: true } }
    }
  });

  const plan = planDuplicateCleanup(
    rows.map((row) => ({
      id: row.id,
      shopifyDisputeId: row.shopifyDisputeId,
      reason: row.reason,
      evidenceDueBy: row.evidenceDueBy,
      hasMerchantWork: row._count.evidenceItems > 0 || row._count.packets > 0,
      createdAt: row.createdAt
    }))
  );

  if (plan.deleteIds.length === 0) {
    return { removed: 0, keptWithWork: plan.keptWithWork };
  }

  const result = await db.dispute.deleteMany({ where: { id: { in: plan.deleteIds } } });

  return { removed: result.count, keptWithWork: plan.keptWithWork };
}

/**
 * Read-only view of what the cleanup would do, for the debug endpoint.
 *
 * "It should have cleaned up" is not an answer anybody can check. This lets the
 * stored keys be looked at directly, which is the only way to tell a duplicate
 * row from a duplicate render.
 */
export async function describeDuplicateDisputes(merchantId: string) {
  const rows = await db.dispute.findMany({
    where: { merchantId },
    select: {
      id: true,
      shopifyDisputeId: true,
      reason: true,
      amount: true,
      currencyCode: true,
      evidenceDueBy: true,
      createdAt: true,
      _count: { select: { evidenceItems: true, packets: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  const byNumber = new Map<string, typeof rows>();
  for (const row of rows) {
    const number = row.shopifyDisputeId.split("/").pop() ?? row.shopifyDisputeId;
    byNumber.set(number, [...(byNumber.get(number) ?? []), row]);
  }

  const collisions = [...byNumber.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([number, group]) => ({
      disputeNumber: number,
      rows: group.map((row) => ({
        storedKey: row.shopifyDisputeId,
        legacyShape: isLegacyDisputeKey(row.shopifyDisputeId),
        reason: row.reason,
        amount: row.amount?.toString() ?? null,
        currencyCode: row.currencyCode,
        evidenceDueBy: row.evidenceDueBy?.toISOString() ?? null,
        evidenceItems: row._count.evidenceItems,
        packets: row._count.packets
      }))
    }));

  return {
    totalRows: rows.length,
    distinctDisputeNumbers: byNumber.size,
    collisions
  };
}
