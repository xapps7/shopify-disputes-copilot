import { defaultMerchantSettings, type MerchantSettings } from "@/lib/settings";

/** Kept local so packet text does not pull the S3 client into its import graph. */
const S3_REFERENCE = /^s3:\/\//;

/**
 * Files are stored as `s3://key` references, which are meaningless to a human
 * and cannot be opened. Printing the raw value into a packet a merchant reads
 * (and may forward to their accountant or their bank) was noise at best and a
 * bucket-path disclosure at worst.
 *
 * The packet is a record of WHAT was attached, so the attached/not-attached
 * fact is what it states. A link that a reader can act on lives in the app.
 */
function describeAttachment(fileUrl: string | null, mimeType?: string | null): string {
  if (!fileUrl) {
    return "No file attached";
  }

  if (S3_REFERENCE.test(fileUrl)) {
    return `Attached${mimeType ? ` (${mimeType})` : ""} - download it from the dispute page in Disputes Co-Pilot`;
  }

  return fileUrl;
}

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
    fileMimeType?: string | null;
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
        `   File: ${describeAttachment(item.fileUrl, item.fileMimeType)}`
      ].join("\n")
    ),
    "",
    "Footer note:",
    settings.packetFooter || "None"
  ];

  return sections.join("\n");
}
