/**
 * Applying the retention plan.
 *
 * The decisions live in `./retention.ts`, which is pure and tested. This file
 * is the part that touches the database, and it is deliberately thin: it asks
 * that module what is due and then does exactly that, so the rules can be
 * changed and tested without going anywhere near Prisma.
 *
 * WHAT THIS EXISTS FOR: `evidenceRetentionDays` has been a Settings field since
 * the beginning, saved to the database and read by nothing. It promised a
 * behaviour the app did not have - the exact class of lying setting the design
 * review banned - and it blocked an honest answer to Shopify's protected
 * customer data question about retention periods.
 *
 * WHAT IT DOES NOT DO: it does not delete dispute rows. Reason code, amount,
 * currency and outcome are what `lib/economics/win-probability.ts` builds each
 * merchant's win estimate from. Deleting them would silently reset every
 * merchant's model to the generic prior once a year, and nobody would ever
 * connect the two events. Personal data is erased in place; the outcome record
 * survives.
 */

import { db } from "@/lib/db";
import {
  ERASED_TEXT_PLACEHOLDER,
  parseRetentionDays,
  planRetentionSweep,
  scrubbedJsonValue,
  type RetentionSweepPlan
} from "@/lib/compliance/retention";
import { getMerchantSettings } from "@/lib/settings";
import { deleteStoredFile } from "@/lib/storage";

export type RetentionSweepResult = {
  shopDomain: string;
  retentionDays: number;
  /** Disputes whose personal data was erased on this run. */
  scrubbed: number;
  /** Disputes examined and deliberately kept. */
  kept: number;
  /** Stored objects actually removed from the bucket. */
  filesDeleted: number;
  /**
   * Objects we hold a pointer to but could not remove - usually because S3 is
   * not configured on this install. Reported rather than swallowed, because
   * "erased" has to mean erased.
   */
  filesPending: number;
  plan: RetentionSweepPlan;
  error?: string;
};

/**
 * How many disputes to erase in one run.
 *
 * A first sweep on a shop with years of history would otherwise try to rewrite
 * everything inside one cron invocation and time out halfway, leaving a partial
 * erase nobody knows about. Bounded work per run, repeated hourly, gets to the
 * same place with a state you can reason about.
 */
const MAX_PER_RUN = 200;

/**
 * Erases personal data from one merchant's finished disputes.
 *
 * Idempotent by recomputation: there is no `scrubbedAt` column to mark, so a
 * later run re-writes the same rows with the same placeholder values. That is
 * wasteful and harmless, and it is the honest consequence of not being able to
 * add a column here. It is the first thing a future migration should fix.
 */
export async function runRetentionSweep(
  shopDomain: string,
  now: Date = new Date()
): Promise<RetentionSweepResult> {
  const settings = await getMerchantSettings(shopDomain);
  const retentionDays = parseRetentionDays(settings.evidenceRetentionDays);

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    select: { id: true }
  });

  const empty: RetentionSweepPlan = planRetentionSweep([], retentionDays, now);

  if (!merchant) {
    return {
      shopDomain,
      retentionDays,
      scrubbed: 0,
      kept: 0,
      filesDeleted: 0,
      filesPending: 0,
      plan: empty
    };
  }

  const candidates = await db.dispute.findMany({
    where: { merchantId: merchant.id },
    select: {
      id: true,
      status: true,
      finalizedOn: true,
      evidenceSentOn: true,
      updatedAt: true
    }
  });

  const plan = planRetentionSweep(candidates, retentionDays, now);
  const due = plan.due.slice(0, MAX_PER_RUN);

  let filesDeleted = 0;
  let filesPending = 0;

  for (const disputeId of due) {
    const dispute = await db.dispute.findUnique({
      where: { id: disputeId },
      select: {
        shopifyOrderId: true,
        sourceSnapshotJson: true,
        evidenceItems: { select: { id: true, fileUrl: true, structuredValueJson: true } },
        packets: { select: { id: true, pdfUrl: true } },
        timelineEvents: { select: { id: true, payloadSummaryJson: true } }
      }
    });

    if (!dispute) {
      continue;
    }

    // Files first. If the bytes cannot be removed the pointer stays, because a
    // cleared pointer with the object still in the bucket is the worst of both
    // worlds: unreachable by us, undeleted for the customer, and reported as
    // done.
    const fileRefs = [
      ...dispute.evidenceItems.map((item) => item.fileUrl),
      ...dispute.packets.map((packet) => packet.pdfUrl)
    ];

    const removed = new Set<string>();

    for (const ref of fileRefs) {
      if (!ref) {
        continue;
      }

      const outcome = await deleteStoredFile(ref);

      if (outcome.deleted || outcome.reason === "not-remote") {
        // A local dev path is not going to be erased and does not need to be
        // tracked as pending on a production install.
        filesDeleted += outcome.deleted ? 1 : 0;
        removed.add(ref);
      } else {
        filesPending += 1;
      }
    }

    await db.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          // Scrubbed rather than cleared: the drafting context reads structure
          // out of this, and an empty object keeps that code on its existing
          // "no data" path instead of throwing.
          sourceSnapshotJson: scrubbedJsonValue(dispute.sourceSnapshotJson),
          // Free text. Key-based scrubbing cannot help - a merchant narrative
          // names the cardholder in prose - so the whole value goes.
          reasonDetails: ERASED_TEXT_PLACEHOLDER,
          evidenceFieldsJson: null
        }
      });

      for (const item of dispute.evidenceItems) {
        await tx.evidenceItem.update({
          where: { id: item.id },
          data: {
            title: ERASED_TEXT_PLACEHOLDER,
            description: null,
            structuredValueJson: scrubbedJsonValue(item.structuredValueJson),
            // Only cleared when the object is genuinely gone, or was never
            // remote to begin with.
            fileUrl: item.fileUrl && removed.has(item.fileUrl) ? null : item.fileUrl
          }
        });
      }

      for (const packet of dispute.packets) {
        await tx.evidencePacket.update({
          where: { id: packet.id },
          data: {
            summaryText: null,
            pdfUrl: packet.pdfUrl && removed.has(packet.pdfUrl) ? null : packet.pdfUrl
          }
        });
      }

      for (const event of dispute.timelineEvents) {
        if (!event.payloadSummaryJson) {
          continue;
        }
        await tx.disputeTimelineEvent.update({
          where: { id: event.id },
          data: { payloadSummaryJson: scrubbedJsonValue(event.payloadSummaryJson) }
        });
      }

      // The order snapshot is joined by order id, not by relation, and the
      // dispute's order id is nullable - so a dispute with no order id leaves
      // its snapshot unreachable from here. That orphan case is a known gap and
      // is not silently pretended away.
      if (dispute.shopifyOrderId) {
        await tx.orderSnapshot.updateMany({
          where: { merchantId: merchant.id, shopifyOrderId: dispute.shopifyOrderId },
          data: {
            customerEmail: null,
            customerName: null,
            orderJson: scrubbedJsonValue("{}") ?? "{}"
          }
        });
      }
    });
  }

  return {
    shopDomain,
    retentionDays,
    scrubbed: due.length,
    kept: plan.keep.length,
    filesDeleted,
    filesPending,
    plan
  };
}
