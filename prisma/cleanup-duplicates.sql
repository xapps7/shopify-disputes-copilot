-- One-off cleanup of rows written before the dispute-GID fix.
--
-- Two bad shapes existed:
--   1. Order.disputes returns OrderDisputeSummary GIDs, which were stored as
--      separate disputes alongside the real ShopifyPaymentsDispute rows. They
--      carry the ORDER total as the amount and no reason or deadline, so they
--      show as "General / No auto-submit date" in the queue.
--   2. Every webhook wrote to a single row ending `/unknown`, because the
--      payload field is `id` and the code read `dispute_id`.
--
-- Inspect first:
--   SELECT "shopifyDisputeId", "reason", "amount", "evidenceDueBy" FROM "Dispute"
--   WHERE "shopifyDisputeId" LIKE '%OrderDisputeSummary%'
--      OR "shopifyDisputeId" LIKE '%/unknown';

BEGIN;

DELETE FROM "Dispute"
WHERE "shopifyDisputeId" LIKE '%OrderDisputeSummary%'
   OR "shopifyDisputeId" LIKE '%/unknown';

COMMIT;

-- Evidence items, packets and timeline events cascade from Dispute, so no
-- orphans are left behind. Re-sync afterwards to repopulate from Shopify.
