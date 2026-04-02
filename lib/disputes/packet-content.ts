import { defaultMerchantSettings, type MerchantSettings } from "@/lib/settings";

type PacketDispute = {
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
};

export function buildPacketSummary(dispute: PacketDispute) {
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
