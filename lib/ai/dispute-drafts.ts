import type { DisputeDetailView } from "@/lib/types";

export type DisputeResponseDraft = {
  generatedAt: string;
  headline: string;
  executiveSummary: string;
  merchantReply: string;
  internalGuidance: string[];
  strengths: string[];
  missingEvidence: string[];
  nextActions: string[];
};

function formatReason(reason: string | null) {
  return reason ? reason.replaceAll("_", " ").toLowerCase() : "unknown dispute reason";
}

function formatCategory(category: string) {
  return category.replaceAll("_", " ").toLowerCase();
}

function describeDeadline(evidenceDueBy: string | null) {
  if (!evidenceDueBy) {
    return "The issuer due date is not available yet, so the response should still be assembled immediately.";
  }

  const dueDate = new Date(evidenceDueBy);
  const daysLeft = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const readableDate = dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (daysLeft <= 1) {
    return `The case is urgent because evidence is due by ${readableDate}.`;
  }

  return `Evidence is due by ${readableDate}, so the merchant still has a short window to improve the submission.`;
}

function buildStrengths(dispute: DisputeDetailView) {
  const strengths = dispute.evidenceItems.map(
    (item) => `${item.title} supports ${formatCategory(item.category)}.`
  );

  if (dispute.orderSummary?.fulfillmentStatus === "FULFILLED") {
    strengths.unshift("Shopify order records show the order reached a fulfilled state.");
  }

  if (strengths.length === 0) {
    strengths.push("No supporting evidence has been attached yet, so the merchant needs to assemble baseline proof first.");
  }

  return strengths.slice(0, 4);
}

function buildMerchantReply(dispute: DisputeDetailView, missingEvidence: string[]) {
  const orderName = dispute.orderSummary?.orderName ?? "the referenced order";
  const customerName = dispute.orderSummary?.customerName ?? "the customer";
  const evidenceSummary =
    dispute.evidenceItems.length > 0
      ? dispute.evidenceItems
          .slice(0, 4)
          .map((item) => `${item.title} (${formatCategory(item.category)})`)
          .join("; ")
      : "merchant order records and supporting documentation";

  const gapStatement =
    missingEvidence.length > 0
      ? `The merchant is continuing to gather ${missingEvidence.join(", ").toLowerCase()} to strengthen the case record.`
      : "The merchant believes the attached documentation directly addresses the issuer's claim.";

  return [
    `The merchant is contesting this ${formatReason(dispute.reason)} dispute for ${orderName}.`,
    `${customerName} placed the order through the merchant storefront, and the Shopify order record reflects the transaction history, order details, and fulfillment state connected to this purchase.`,
    `Supporting materials included with this response include ${evidenceSummary}.`,
    dispute.reasonDetails
      ? `The issuer reason details state: "${dispute.reasonDetails}". The attached materials are provided to address that specific claim.`
      : "The attached materials are organized to address the dispute category and order record.",
    gapStatement
  ].join(" ");
}

export function generateDisputeResponseDraft(dispute: DisputeDetailView): DisputeResponseDraft {
  const missingEvidence = dispute.evidenceChecklist
    .filter((item) => item.state === "missing")
    .map((item) => item.label);
  const strengths = buildStrengths(dispute);

  return {
    generatedAt: new Date().toISOString(),
    headline: `Reply draft for dispute ${dispute.shopifyDisputeId.split("/").pop()}`,
    executiveSummary: [
      `This dispute is currently in ${dispute.status.replaceAll("_", " ").toLowerCase()} for ${dispute.currencyCode ?? "USD"} ${dispute.amount} under a ${formatReason(dispute.reason)} claim.`,
      describeDeadline(dispute.evidenceDueBy),
      missingEvidence.length > 0
        ? `The current gaps are ${missingEvidence.join(", ").toLowerCase()}.`
        : "The current evidence shelf covers every expected checklist category."
    ].join(" "),
    merchantReply: buildMerchantReply(dispute, missingEvidence),
    internalGuidance: [
      "Keep the narrative factual and tied to attached documents only.",
      "Match the issuer reason with direct proof instead of broad promises or assumptions.",
      "Use the merchant reply as an editable starting point, not a final legal statement."
    ],
    strengths,
    missingEvidence,
    nextActions: [
      missingEvidence.length > 0
        ? `Collect the remaining evidence: ${missingEvidence.join(", ")}.`
        : "Review the language and remove anything that cannot be backed by an attached file.",
      dispute.latestPacket
        ? "Regenerate the packet after editing the response so the current packet mirrors the draft."
        : "Generate a packet draft once the merchant has reviewed the narrative.",
      "Submit only after the merchant validates every factual claim in Shopify."
    ]
  };
}
