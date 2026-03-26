import { PacketStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { persistPacketDraft } from "@/lib/storage";
import { defaultMerchantSettings, type MerchantSettings } from "@/lib/settings";

function buildPacketSummary(dispute: {
  shopifyDisputeId: string;
  status: string;
  reason: string | null;
  reasonDetails: string | null;
  amount: { toString(): string } | null;
  currencyCode: string | null;
  evidenceDueBy: Date | null;
  evidenceItems: Array<{
    category: string;
    title: string;
    description: string | null;
    sourceType: string;
    fileUrl: string | null;
  }>;
  merchant: {
    shopDomain: string;
    settingsJson: string | null;
  };
}) {
  let settings: MerchantSettings = defaultMerchantSettings;

  if (dispute.merchant.settingsJson) {
    try {
      settings = {
        ...defaultMerchantSettings,
        ...(JSON.parse(dispute.merchant.settingsJson) as Partial<MerchantSettings>)
      };
    } catch {
      settings = defaultMerchantSettings;
    }
  }

  const sections = [
    `Shop: ${dispute.merchant.shopDomain}`,
    `Dispute: ${dispute.shopifyDisputeId}`,
    `Status: ${dispute.status}`,
    `Reason: ${dispute.reason ?? "Unknown"}`,
    `Reason details: ${dispute.reasonDetails ?? "Not provided"}`,
    `Amount: ${dispute.currencyCode ?? "USD"} ${dispute.amount?.toString() ?? "0.00"}`,
    `Evidence due by: ${dispute.evidenceDueBy ? dispute.evidenceDueBy.toISOString() : "Unknown"}`,
    `Return policy URL: ${settings.returnPolicyUrl || "Not configured"}`,
    `Refund policy URL: ${settings.refundPolicyUrl || "Not configured"}`,
    `Support email: ${settings.supportEmail || "Not configured"}`,
    `Support phone: ${settings.supportPhone || "Not configured"}`,
    `Statement descriptor: ${settings.statementDescriptor || "Not configured"}`,
    "",
    "Evidence items:",
    ...dispute.evidenceItems.map((item, index) =>
      [
        `${index + 1}. ${item.title}`,
        `   Category: ${item.category}`,
        `   Source: ${item.sourceType}`,
        `   Description: ${item.description ?? "None"}`,
        `   File: ${item.fileUrl ?? "None"}`
      ].join("\n")
    ),
    "",
    "Footer note:",
    settings.packetFooter || "None"
  ];

  return sections.join("\n");
}

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
