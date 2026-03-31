import { DisputeStatus } from "@prisma/client";

import { buildPreventionRecommendations } from "@/lib/ai/prevention";
import { db } from "@/lib/db";
import { getDisputeDetail } from "@/lib/disputes/repository";

type OutcomeInput = {
  outcome: string;
  rootCause: string;
  notes: string;
};

function toDisputeStatus(status: string): DisputeStatus {
  if (status === "WON") return DisputeStatus.WON;
  if (status === "LOST") return DisputeStatus.LOST;
  if (status === "ACCEPTED") return DisputeStatus.ACCEPTED;
  if (status === "UNDER_REVIEW") return DisputeStatus.UNDER_REVIEW;
  return DisputeStatus.UNKNOWN;
}

export async function recordDisputeOutcome(disputeId: string, input: OutcomeInput) {
  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    include: {
      merchant: true
    }
  });

  if (!dispute) {
    throw new Error("Dispute not found.");
  }

  await db.dispute.update({
    where: { id: disputeId },
    data: {
      status: toDisputeStatus(input.outcome),
      finalizedOn:
        input.outcome === "WON" || input.outcome === "LOST" || input.outcome === "ACCEPTED"
          ? new Date()
          : null
    }
  });

  await db.preventionRecommendation.deleteMany({
    where: { disputeId }
  });

  const detail = await getDisputeDetail(disputeId);
  const recommendations = buildPreventionRecommendations(detail, input);

  if (recommendations.length > 0) {
    await db.preventionRecommendation.createMany({
      data: recommendations.map((item) => ({
        merchantId: dispute.merchantId,
        disputeId,
        category: item.category,
        recommendationText: item.recommendationText,
        priority: item.priority,
        state: item.state
      }))
    });
  }

  await db.disputeTimelineEvent.create({
    data: {
      disputeId,
      eventType: "OUTCOME_RECORDED",
      eventTimestamp: new Date(),
      source: "merchant_review",
      payloadSummaryJson: JSON.stringify(input)
    }
  });
}
