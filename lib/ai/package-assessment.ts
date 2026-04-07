import type { AIPackageAssessmentView, DisputeDetailView } from "@/lib/types";

function dueDateRisk(dispute: DisputeDetailView) {
  if (!dispute.evidenceDueBy) {
    return { urgent: false, daysLeft: null as number | null };
  }

  const dueDate = new Date(dispute.evidenceDueBy);
  const daysLeft = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return { urgent: daysLeft <= 2, daysLeft };
}

export function generatePackageAssessment(dispute: DisputeDetailView): AIPackageAssessmentView {
  const readyEvidence = dispute.evidenceChecklist.filter((item) => item.state === "ready").length;
  const totalChecklist = Math.max(dispute.evidenceChecklist.length, 1);
  const evidenceCoverageScore = Math.round((readyEvidence / totalChecklist) * 60);
  const packetScore = dispute.latestPacket ? 20 : 0;
  const orderContextScore = dispute.orderSummary?.orderName ? 10 : 0;
  const evidenceDepthScore = Math.min(10, dispute.evidenceItems.length * 4);
  const score = Math.min(100, evidenceCoverageScore + packetScore + orderContextScore + evidenceDepthScore);
  const { urgent, daysLeft } = dueDateRisk(dispute);

  const strengths: string[] = [];
  const risks: string[] = [];
  const improvements: string[] = [];

  if (dispute.orderSummary?.fulfillmentStatus === "FULFILLED") {
    strengths.push("Order records show the order reached a fulfilled state.");
  }

  if (dispute.latestPacket) {
    strengths.push("A packet draft already exists, so the seller can review exactly what will be exported.");
  } else {
    risks.push("No packet draft exists yet, so the seller cannot review the final assembled narrative.");
    improvements.push("Generate the packet after the current evidence shelf is reviewed.");
  }

  const missingChecklist = dispute.evidenceChecklist.filter((item) => item.state === "missing");
  if (missingChecklist.length > 0) {
    risks.push(
      `Missing checklist categories still weaken the package: ${missingChecklist
        .map((item) => item.label.toLowerCase())
        .join(", ")}.`
    );
    improvements.push(
      `Collect the remaining evidence first: ${missingChecklist.map((item) => item.label).join(", ")}.`
    );
  } else {
    strengths.push("All checklist categories currently expected for this dispute are covered.");
  }

  if (dispute.evidenceItems.length >= 3) {
    strengths.push("Multiple evidence items are already attached, which helps the packet feel corroborated.");
  } else {
    risks.push("The evidence shelf is still thin, so the packet may look under-supported.");
    improvements.push("Add at least one more corroborating document or communication record if one exists.");
  }

  if (urgent) {
    risks.push(
      daysLeft !== null && daysLeft >= 0
        ? `The deadline is close, with ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`
        : "The evidence deadline has already passed or is effectively immediate."
    );
    improvements.push("Prioritize the missing evidence that most directly answers the dispute reason before editing copy.");
  }

  const verdict: AIPackageAssessmentView["verdict"] =
    score >= 80 ? "strong" : score >= 55 ? "improving" : "weak";

  const summary =
    verdict === "strong"
      ? "The package is in good shape, but the seller should still confirm every factual claim against the attached files."
      : verdict === "improving"
        ? "The package is usable but still has weak areas that should be tightened before submission."
        : "The package is not strong enough yet. The seller should improve the evidence shelf before relying on the narrative.";

  const confidenceNote =
    "This assessment estimates packet quality from the current dispute record. It does not predict bank decisions or guarantee an outcome.";

  return {
    generatedAt: new Date().toISOString(),
    score,
    verdict,
    summary,
    confidenceNote,
    strengths,
    risks,
    improvements
  };
}
