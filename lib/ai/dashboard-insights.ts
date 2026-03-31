import type { DashboardDispute, DashboardInsightView } from "@/lib/types";

function dueInDays(value: string | null) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.ceil((new Date(value).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function generateDashboardInsights(disputes: DashboardDispute[]): DashboardInsightView[] {
  const urgent = disputes.filter((dispute) => dueInDays(dispute.evidenceDueBy) <= 1);
  const lowReadiness = disputes.filter((dispute) => dispute.completenessScore < 70);
  const fraudCases = disputes.filter((dispute) => dispute.reason === "FRAUD");

  const insights: DashboardInsightView[] = [];

  if (urgent.length > 0) {
    const top = [...urgent].sort((a, b) => dueInDays(a.evidenceDueBy) - dueInDays(b.evidenceDueBy))[0];
    insights.push({
      title: "Deadline pressure",
      tone: "warning",
      summary: `${urgent.length} disputes need action inside 48 hours.`,
      detail: `Start with dispute ${top.shopifyDisputeId.split("/").pop()} because it combines the shortest runway with ${top.completenessScore}% readiness.`,
      actions: [
        "Review due-today and due-tomorrow cases first.",
        "Close checklist gaps before refining narrative language.",
        "Regenerate the packet after any new evidence arrives."
      ]
    });
  }

  if (lowReadiness.length > 0) {
    const weakest = [...lowReadiness].sort((a, b) => a.completenessScore - b.completenessScore)[0];
    insights.push({
      title: "Evidence posture",
      tone: "info",
      summary: `${lowReadiness.length} disputes are below the 70% readiness threshold.`,
      detail: `The weakest case is ${weakest.shopifyDisputeId.split("/").pop()} at ${weakest.completenessScore}% readiness, so the operator should focus on evidence collection rather than wording.`,
      actions: [
        "Prioritize delivery, communication, and refund proof gaps.",
        "Use the AI reply draft only after the evidence shelf is materially complete.",
        "Treat low-readiness cases as collection tasks first and writing tasks second."
      ]
    });
  }

  if (fraudCases.length > 0) {
    insights.push({
      title: "Fraud pattern",
      tone: "success",
      summary: `${fraudCases.length} active disputes are fraud-related.`,
      detail:
        "Fraud cases should lean on fulfillment proof, delivery confirmation, and merchant communication rather than broad narrative claims.",
      actions: [
        "Check fulfilled orders for concrete tracking evidence.",
        "Document any pre-dispute customer outreach.",
        "Capture statement descriptor and policy context in the packet."
      ]
    });
  }

  if (insights.length === 0) {
    insights.push({
      title: "Queue posture",
      tone: "success",
      summary: "The queue has no immediate pressure signals.",
      detail: "Use the time to tighten packet quality, merchant settings, and prevention notes before the next sync cycle.",
      actions: [
        "Refresh the queue daily.",
        "Review packet quality for consistency.",
        "Capture learnings from every resolved dispute."
      ]
    });
  }

  return insights.slice(0, 3);
}
