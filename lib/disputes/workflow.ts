import type { DisputeDetailView, EvidenceLibraryItemView } from "@/lib/types";

export type EvidenceGapInsight = {
  label: string;
  whyItMatters: string;
  severity: "critical" | "warning";
};

export type PacketQualityReview = {
  score: number;
  status: "blocked" | "needs_review" | "ready";
  summary: string;
  blockers: string[];
  strengths: string[];
  nextActions: string[];
};

function reasonSpecificGuidance(reason: string | null, label: string) {
  if (reason === "FRAUD") {
    if (label === "Delivery confirmation") {
      return "Delivery proof helps show that the order reached the shipping destination tied to the transaction.";
    }
    if (label === "Shipping documentation") {
      return "Carrier scans and shipment records help verify fulfillment history for cardholder misuse claims.";
    }
    if (label === "Customer communication") {
      return "Support messages can show purchase recognition, delivery follow-up, or post-order engagement from the customer.";
    }
  }

  if (reason === "PRODUCT_NOT_RECEIVED") {
    if (label === "Delivery confirmation") {
      return "Delivery confirmation is the main evidence that the shipment completed successfully.";
    }
    if (label === "Shipping documentation") {
      return "Carrier tracking and shipment records establish the delivery timeline and address used for fulfillment.";
    }
  }

  if (label === "Product proof") {
    return "Product proof helps show what was sold and how it matched the seller's listing or policy disclosure.";
  }

  if (label === "Customer communication") {
    return "Customer messages help show expectations, acknowledgements, and merchant support handling.";
  }

  return "This evidence helps fill a checklist gap that weakens the dispute packet.";
}

export function buildEvidenceGapInsights(dispute: DisputeDetailView): EvidenceGapInsight[] {
  return dispute.evidenceChecklist
    .filter((item) => item.state === "missing")
    .map((item) => ({
      label: item.label,
      whyItMatters: reasonSpecificGuidance(dispute.reason, item.label),
      severity: dispute.evidenceDueBy ? "critical" : "warning"
    }));
}

export function assessPacketQuality(dispute: DisputeDetailView): PacketQualityReview {
  const readyEvidence = dispute.evidenceChecklist.filter((item) => item.state === "ready").length;
  const totalChecklist = Math.max(dispute.evidenceChecklist.length, 1);
  const checklistScore = Math.round((readyEvidence / totalChecklist) * 70);
  const packetScore = dispute.latestPacket ? 20 : 0;
  const orderContextScore = dispute.orderSummary?.orderName ? 10 : 0;
  const score = Math.min(100, checklistScore + packetScore + orderContextScore);

  const blockers = dispute.evidenceChecklist
    .filter((item) => item.state === "missing")
    .map((item) => item.label);
  const strengths = [];

  if (dispute.orderSummary?.fulfillmentStatus === "FULFILLED") {
    strengths.push("Order records show a fulfilled order state.");
  }

  if (dispute.latestPacket) {
    strengths.push(`Packet version ${dispute.latestPacket.version} has already been generated for review.`);
  }

  if (dispute.evidenceItems.length >= 2) {
    strengths.push(`${dispute.evidenceItems.length} evidence items are attached to the case.`);
  }

  if (blockers.length > 0) {
    return {
      score,
      status: "blocked",
      summary: "The packet is still blocked by missing evidence.",
      blockers,
      strengths,
      nextActions: [
        `Collect the missing evidence: ${blockers.join(", ")}.`,
        "Refresh the AI draft after the evidence shelf changes.",
        dispute.latestPacket
          ? "Regenerate the packet so the exported file matches the latest evidence."
          : "Generate the first packet once the checklist gaps are closed."
      ]
    };
  }

  if (!dispute.latestPacket) {
    return {
      score,
      status: "needs_review",
      summary: "The case is evidence-complete, but the packet still needs to be generated and reviewed.",
      blockers: [],
      strengths,
      nextActions: [
        "Generate a packet draft.",
        "Review the narrative section by section before recording submission."
      ]
    };
  }

  return {
    score,
    status: "ready",
    summary: "The packet is ready for operator review and manual submission.",
    blockers: [],
    strengths,
    nextActions: [
      "Confirm the merchant reply only uses facts backed by attached files.",
      "Download the packet and submit it in Shopify Admin.",
      "Record the submission so the timeline and recommendations stay accurate."
    ]
  };
}

export function filterEvidenceItems(
  items: EvidenceLibraryItemView[],
  selectedTab: number,
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase();

  return items.filter((item) => {
    const matchesTab =
      selectedTab === 0 ||
      (selectedTab === 1 && item.category === "CUSTOMER_COMMUNICATION") ||
      (selectedTab === 2 && item.category === "REFUND_PROOF") ||
      (selectedTab === 3 &&
        ["DELIVERY_CONFIRMATION", "SHIPPING_DOCUMENTATION"].includes(item.category));

    const matchesQuery =
      normalizedQuery.length === 0 ||
      [item.title, item.category, item.sourceType, item.disputeReference, item.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return matchesTab && matchesQuery;
  });
}
