/**
 * What a dispute's primary key looks like. One module, no dependencies.
 *
 * This is deliberately import-free. Everything that decides the shape of a
 * dispute key lives here so it can be imported by the writers AND by the tests,
 * which run under `node --experimental-strip-types` with no path-alias
 * resolution. `toDisputeGid` used to live in `shopify-sync.ts` beside a database
 * import, so the test could not reach it and kept a hand-written copy instead -
 * a second definition of the rule, free to drift from the first, inside the one
 * piece of code whose entire purpose is that the rule has a single home.
 */

/**
 * Shopify returns the SAME dispute under two GID types: the top-level `disputes`
 * connection gives `gid://shopify/ShopifyPaymentsDispute/<n>`, while
 * `Order.disputes` gives `gid://shopify/OrderDisputeSummary/<n>`. Keying on the
 * raw value stored every dispute twice - observed live as 5 real disputes
 * reported as syncedCount 8 - and `dispute(id: <OrderDisputeSummary gid>)` fails
 * with RESOURCE_NOT_FOUND. Normalise both to the ShopifyPaymentsDispute form.
 *
 * Idempotent, so it is safe to apply unconditionally at every write.
 */
export function toDisputeGid(id: string): string {
  const numericId = id.split("/").pop();
  return numericId ? `gid://shopify/ShopifyPaymentsDispute/${numericId}` : id;
}

/**
 * The two key shapes no current code path can produce, left behind by earlier
 * versions.
 *
 * Deliberately narrow: it matches the two known-bad GID types rather than
 * anything that "looks wrong", so a shape Shopify introduces later is left alone
 * instead of being deleted by a rule written before it existed.
 */
export function isLegacyDisputeKey(shopifyDisputeId: string): boolean {
  return shopifyDisputeId.includes("/OrderDisputeSummary/") || shopifyDisputeId.endsWith("/unknown");
}

/** The minimum a caller must know about a row to decide its fate. */
export type DisputeRowLike = {
  id: string;
  shopifyDisputeId: string;
  reason: string | null;
  evidenceDueBy: Date | null;
  /** Uploaded evidence or a generated packet. These cascade on delete. */
  hasMerchantWork: boolean;
  createdAt: Date;
};

export type DuplicatePlan = {
  /** Rows safe to delete: a duplicate identity, carrying no merchant work. */
  deleteIds: string[];
  /** Duplicates left alone because deleting them would destroy merchant work. */
  keptWithWork: string[];
};

/**
 * Decide which rows are redundant copies of the same dispute.
 *
 * Grouped by IDENTITY - `toDisputeGid` of the stored key - rather than by a
 * recognised-bad prefix. An earlier version of this matched on the two GID
 * shapes that were known to be wrong, which only ever removes the duplicates
 * somebody already thought of. Two rows that normalise to the same dispute are
 * duplicates whatever shape either of them happens to have, including shapes
 * Shopify has not invented yet.
 *
 * Which copy survives, in order:
 *   1. the one already stored under the canonical key - nothing to rewrite
 *   2. the one carrying merchant work - never destroy uploads to tidy a queue
 *   3. the richer record: a reason AND a deadline beats "General / no date"
 *   4. the oldest, so the surviving row keeps the longest history
 *
 * A single row is never deleted, however odd its key looks. If it is the only
 * record of a dispute, it is the record of that dispute.
 */
export function planDuplicateCleanup(rows: DisputeRowLike[]): DuplicatePlan {
  const groups = new Map<string, DisputeRowLike[]>();

  for (const row of rows) {
    const key = toDisputeGid(row.shopifyDisputeId);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const deleteIds: string[] = [];
  const keptWithWork: string[] = [];

  for (const [canonicalKey, group] of groups) {
    if (group.length < 2) {
      continue;
    }

    const richness = (row: DisputeRowLike) => (row.reason ? 1 : 0) + (row.evidenceDueBy ? 1 : 0);

    const ranked = [...group].sort((a, b) => {
      const canonical = Number(b.shopifyDisputeId === canonicalKey) - Number(a.shopifyDisputeId === canonicalKey);
      if (canonical !== 0) return canonical;

      const work = Number(b.hasMerchantWork) - Number(a.hasMerchantWork);
      if (work !== 0) return work;

      const rich = richness(b) - richness(a);
      if (rich !== 0) return rich;

      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    for (const row of ranked.slice(1)) {
      if (row.hasMerchantWork) {
        keptWithWork.push(row.shopifyDisputeId);
        continue;
      }
      deleteIds.push(row.id);
    }
  }

  return { deleteIds, keptWithWork };
}
