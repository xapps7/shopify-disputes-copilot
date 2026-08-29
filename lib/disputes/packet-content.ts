import { getReasonProfile } from "@/lib/disputes/reason-codes";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { defaultMerchantSettings, type MerchantSettings } from "@/lib/settings";

// Re-exported so callers keep one import for packet text.
export { resolvePacketText } from "@/lib/disputes/packet-text";

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

/**
 * The packet is read by a merchant and forwarded to a bank. Neither reader has
 * ever seen our database, so nothing internal belongs in it.
 *
 * `gid://shopify/DisputeGeneral/123` is the whole GID Shopify gives us. The
 * dispute number is the trailing segment, and it is the only part a merchant
 * can match against their Shopify admin. Printing the GID made a bank-facing
 * document look like a debug dump.
 */
function disputeNumber(shopifyDisputeId: string): string {
  const trailing = shopifyDisputeId.split("/").pop()?.trim();
  return trailing ? trailing : shopifyDisputeId;
}

/** `NEEDS_RESPONSE` -> `Needs response`. Used for statuses and evidence enums. */
function humanLabel(value: string | null | undefined, fallback: string): string {
  const words = (value ?? "").replaceAll("_", " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : fallback;
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

  // Dates are printed as UTC calendar days, the same bucketing the deadline
  // badges use. An ISO timestamp is exact and unreadable; a bare local date
  // could land a day off the date the issuer is working to.
  const evidenceDueBy = dispute.evidenceDueBy ? `${formatDate(dispute.evidenceDueBy)} (UTC)` : "Unknown";

  const sections = [
    `Shop: ${dispute.merchant.shopDomain}`,
    `Dispute: ${disputeNumber(dispute.shopifyDisputeId)}`,
    `Status: ${humanLabel(dispute.status, "Unknown")}`,
    // The reason label is the same one the app shows on screen. Reusing it
    // keeps the packet and the dispute page from naming the same reason two
    // different ways, which a bank would read as two different claims.
    `Reason: ${dispute.reason ? getReasonProfile(dispute.reason).label : "Unknown"}`,
    `Reason details: ${dispute.reasonDetails ?? "Not provided"}`,
    // formatMoney renders "$129.50", not "USD 129.5", and refuses to claim USD
    // when the currency is actually unknown. A packet is a money document; the
    // amount in it has to read like money.
    `Amount: ${formatMoney(dispute.amount?.toString() ?? null, dispute.currencyCode)}`,
    `Evidence due by: ${evidenceDueBy}`,
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
        `   Category: ${humanLabel(item.category, "Uncategorised")}`,
        `   Source: ${humanLabel(item.sourceType, "Unknown")}`,
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
