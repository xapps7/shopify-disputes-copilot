import { DisputeStatus, PacketStatus } from "@prisma/client";

import { buildPreventionRecommendations } from "@/lib/ai/prevention";
import { db } from "@/lib/db";
import { getDisputeDetail } from "@/lib/disputes/repository";

type AutoSyncInput = {
  disputeId: string;
  merchantId: string;
  currentStatus: DisputeStatus;
  previousStatus: DisputeStatus | null;
  evidenceSentOn: Date | null;
  previousEvidenceSentOn: Date | null;
  source: "shopify_webhook" | "shopify_graphql";
};

function inferRootCause(status: DisputeStatus, reason: string | null) {
  if (reason === "FRAUD") {
    return status === DisputeStatus.WON ? "DOCUMENTATION_GAP" : "FRAUD_SCREENING";
  }

  if (reason === "PRODUCT_NOT_RECEIVED") {
    return "FULFILLMENT_GAP";
  }

  return "DOCUMENTATION_GAP";
}

function isFinalStatus(status: DisputeStatus) {
  return (
    status === DisputeStatus.WON ||
    status === DisputeStatus.LOST ||
    status === DisputeStatus.ACCEPTED
  );
}

export async function syncDerivedDisputeState({
  disputeId,
  merchantId,
  currentStatus,
  previousStatus,
  evidenceSentOn,
  previousEvidenceSentOn,
  source
}: AutoSyncInput) {
  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    include: {
      packets: {
        orderBy: { version: "desc" },
        take: 1
      }
    }
  });

  if (!dispute) {
    return;
  }

  const latestPacket = dispute.packets[0] ?? null;
  const nextEvidenceTimestamp = evidenceSentOn ?? null;
  const shouldRecordSubmission =
    (nextEvidenceTimestamp && !previousEvidenceSentOn) ||
    ((currentStatus === DisputeStatus.UNDER_REVIEW ||
      currentStatus === DisputeStatus.WON ||
      currentStatus === DisputeStatus.LOST ||
      currentStatus === DisputeStatus.ACCEPTED) &&
      latestPacket &&
      latestPacket.status !== PacketStatus.SUBMITTED);

  const submissionDetectedAt = nextEvidenceTimestamp ?? latestPacket?.submittedAt ?? null;

  const writes: Array<ReturnType<typeof db.dispute.update> | ReturnType<typeof db.evidencePacket.update> | ReturnType<typeof db.disputeTimelineEvent.create> | ReturnType<typeof db.preventionRecommendation.deleteMany> | ReturnType<typeof db.preventionRecommendation.createMany>> = [];

  if (latestPacket && shouldRecordSubmission) {
    writes.push(
      db.evidencePacket.update({
        where: { id: latestPacket.id },
        data: {
          status: PacketStatus.SUBMITTED,
          submittedAt: submissionDetectedAt ?? latestPacket.submittedAt
        }
      })
    );
  }

  if (shouldRecordSubmission) {
    writes.push(
      db.disputeTimelineEvent.create({
        data: {
          disputeId,
          eventType: "EVIDENCE_SUBMITTED",
          eventTimestamp: submissionDetectedAt ?? new Date(),
          source,
          payloadSummaryJson: JSON.stringify({
            mode: "auto_sync",
            status: currentStatus,
            evidenceSentOn: submissionDetectedAt?.toISOString() ?? null
          })
        }
      })
    );
  }

  if (previousStatus !== currentStatus) {
    writes.push(
      db.disputeTimelineEvent.create({
        data: {
          disputeId,
          eventType: "STATUS_SYNCED",
          eventTimestamp: new Date(),
          source,
          payloadSummaryJson: JSON.stringify({
            previousStatus,
            currentStatus
          })
        }
      })
    );
  }

  if (isFinalStatus(currentStatus)) {
    writes.push(
      db.dispute.update({
        where: { id: disputeId },
        data: {
          finalizedOn: dispute.finalizedOn ?? new Date()
        }
      })
    );
  }

  if (writes.length > 0) {
    await db.$transaction(writes);
  }

  if (isFinalStatus(currentStatus) && previousStatus !== currentStatus) {
    await db.preventionRecommendation.deleteMany({
      where: { disputeId }
    });

    const detail = await getDisputeDetail(disputeId);
    const recommendations = buildPreventionRecommendations(detail, {
      outcome: currentStatus,
      rootCause: inferRootCause(currentStatus, detail.reason),
      notes: ""
    });

    if (recommendations.length > 0) {
      await db.preventionRecommendation.createMany({
        data: recommendations.map((item) => ({
          merchantId,
          disputeId,
          category: item.category,
          recommendationText: item.recommendationText,
          priority: item.priority,
          state: item.state
        }))
      });
    }
  }
}
