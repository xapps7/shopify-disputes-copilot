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

  // What this actually writes is a PLAIN TEXT file: `persistPacketDraft` stores
  // it as `text/plain; charset=utf-8` under a `.txt` key, and
  // `/api/disputes/[id]/packet/download` serves it the same way.
  //
  // There is no PDF library in this app and none can be added at the moment, so
  // the honest move is to call it text everywhere the merchant sees it rather
  // than promise a PDF we do not produce. Shopify accepts PDF, PNG and JPEG
  // only - a merchant who trusts a "PDF" label here downloads this, uploads it
  // to Shopify, and is rejected with a deadline running.
  const packetPath = await persistPacketDraft(disputeId, summary);
  const nextVersion = (dispute.packets[0]?.version ?? 0) + 1;

  const packet = await db.evidencePacket.create({
    data: {
      disputeId,
      version: nextVersion,
      status: PacketStatus.READY,
      summaryText: summary,
      // `pdfUrl` is a misnomer kept on purpose: the Prisma schema is frozen, so
      // renaming the column would need a migration this change cannot make.
      // It holds a reference to a plain text file today. Anything reading it -
      // the retention sweep, the redaction job, the dispute page - is reading a
      // .txt reference, not a PDF. Rename it the next time the schema moves.
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
