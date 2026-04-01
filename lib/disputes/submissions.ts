import { PacketStatus, DisputeStatus } from "@prisma/client";

import { db } from "@/lib/db";

type SubmissionInput = {
  method: string;
  notes: string;
};

export async function recordManualSubmission(disputeId: string, input: SubmissionInput) {
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
    throw new Error("Dispute not found.");
  }

  const packet = dispute.packets[0];

  if (!packet) {
    throw new Error("Generate a packet draft before recording submission.");
  }

  const now = new Date();

  await db.$transaction([
    db.evidencePacket.update({
      where: { id: packet.id },
      data: {
        status: PacketStatus.SUBMITTED,
        submittedAt: now
      }
    }),
    db.dispute.update({
      where: { id: disputeId },
      data: {
        evidenceSentOn: now,
        status:
          dispute.status === DisputeStatus.NEEDS_RESPONSE ||
          dispute.status === DisputeStatus.WARNING_NEEDS_RESPONSE
            ? DisputeStatus.UNDER_REVIEW
            : dispute.status
      }
    }),
    db.disputeTimelineEvent.create({
      data: {
        disputeId,
        eventType: "EVIDENCE_SUBMITTED",
        eventTimestamp: now,
        source: "merchant_manual_submission",
        payloadSummaryJson: JSON.stringify(input)
      }
    })
  ]);
}
