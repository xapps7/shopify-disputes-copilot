import type { AIPackageAssessmentView, DisputeDetailView } from "@/lib/types";

function buildPrompt(dispute: DisputeDetailView) {
  return [
    "You are assessing the quality of a Shopify dispute evidence package.",
    "Stay factual. Do not promise outcomes. Do not invent evidence. Output strict JSON only.",
    "",
    JSON.stringify(
      {
        disputeId: dispute.shopifyDisputeId,
        status: dispute.status,
        reason: dispute.reason,
        reasonDetails: dispute.reasonDetails,
        amount: dispute.amount,
        currencyCode: dispute.currencyCode,
        evidenceDueBy: dispute.evidenceDueBy,
        orderSummary: dispute.orderSummary,
        evidenceChecklist: dispute.evidenceChecklist,
        evidenceItems: dispute.evidenceItems,
        latestPacket: dispute.latestPacket
      },
      null,
      2
    ),
    "",
    "Return JSON with keys:",
    "score, verdict, summary, confidenceNote, strengths, risks, improvements",
    "score must be 0-100.",
    "verdict must be one of weak, improving, strong.",
    "strengths, risks, improvements must be arrays of short strings."
  ].join("\n");
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof candidate.output_text === "string" && candidate.output_text.trim()) {
    return candidate.output_text;
  }

  const text = candidate.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text" || item.type === "text")?.text;

  return typeof text === "string" && text.trim() ? text : null;
}

function normalizeAssessment(payload: unknown): AIPackageAssessmentView | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const stringArray = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  if (
    typeof data.score !== "number" ||
    typeof data.summary !== "string" ||
    typeof data.confidenceNote !== "string" ||
    !["weak", "improving", "strong"].includes(String(data.verdict))
  ) {
    return null;
  }

  return {
    generatedAt: new Date().toISOString(),
    score: Math.max(0, Math.min(100, Math.round(data.score))),
    verdict: data.verdict as AIPackageAssessmentView["verdict"],
    summary: data.summary,
    confidenceNote: data.confidenceNote,
    strengths: stringArray(data.strengths),
    risks: stringArray(data.risks),
    improvements: stringArray(data.improvements)
  };
}

export async function generateOpenAIPackageAssessment(
  dispute: DisputeDetailView
): Promise<AIPackageAssessmentView | null> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: buildPrompt(dispute),
      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI package assessment request failed with ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI package assessment response was empty.");
  }

  const parsed = JSON.parse(outputText) as unknown;
  return normalizeAssessment(parsed);
}
