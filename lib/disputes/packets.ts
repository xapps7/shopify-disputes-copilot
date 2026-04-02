import { PacketStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPacketSummary } from "@/lib/disputes/packet-content";
import { persistPacketDraft } from "@/lib/storage";

export async function generatePacketForDispute(disputeId: string) {
  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    include: {
      merchant: true,
      evidenceItems: {
        orderBy: { createdAt: "asc" }
      },
      packets: {
        orderBy: { version: "desc" },
        take: 1
      }
    }
  });

  if (!dispute) {
    throw new Error("Dispute not found.");
  }

  const summary = buildPacketSummary(dispute);
  const packetPath = await persistPacketDraft(disputeId, summary);
  const nextVersion = (dispute.packets[0]?.version ?? 0) + 1;

  const packet = await db.evidencePacket.create({
    data: {
      disputeId,
      version: nextVersion,
      status: PacketStatus.READY,
      summaryText: summary,
      pdfUrl: packetPath,
      generatedAt: new Date()
    }
  });

  await db.disputeTimelineEvent.create({
    data: {
      disputeId,
      eventType: "EVIDENCE_PACKET_GENERATED",
      eventTimestamp: new Date(),
      source: "system",
      payloadSummaryJson: JSON.stringify({
        packetId: packet.id,
        version: packet.version
      })
    }
  });

  return packet;
}

export async function updateLatestPacketSummary(disputeId: string, summaryText: string) {
  const packet = await db.evidencePacket.findFirst({
    where: { disputeId },
    orderBy: { version: "desc" }
  });

  if (!packet) {
    throw new Error("No packet exists for this dispute yet.");
  }

  const updatedPacket = await db.evidencePacket.update({
    where: { id: packet.id },
    data: {
      summaryText
    }
  });

  await db.disputeTimelineEvent.create({
    data: {
      disputeId,
      eventType: "EVIDENCE_PACKET_EDITED",
      eventTimestamp: new Date(),
      source: "merchant",
      payloadSummaryJson: JSON.stringify({
        packetId: updatedPacket.id,
        version: updatedPacket.version
      })
    }
  });

  return updatedPacket;
}
