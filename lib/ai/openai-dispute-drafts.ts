import type { DisputeDetailView, DisputeResponseDraftView } from "@/lib/types";

function buildPrompt(dispute: DisputeDetailView) {
  return [
    "You are generating a merchant-reviewable Shopify dispute response draft.",
    "Stay factual. Do not invent evidence. Do not give legal guarantees. Output strict JSON.",
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
    "headline, executiveSummary, merchantReply, internalGuidance, strengths, missingEvidence, nextActions",
    "Arrays must contain short strings only."
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

function normalizeDraft(payload: unknown): DisputeResponseDraftView | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const stringArray = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  if (
    typeof data.headline !== "string" ||
    typeof data.executiveSummary !== "string" ||
    typeof data.merchantReply !== "string"
  ) {
    return null;
  }

  return {
    generatedAt: new Date().toISOString(),
    headline: data.headline,
    executiveSummary: data.executiveSummary,
    merchantReply: data.merchantReply,
    internalGuidance: stringArray(data.internalGuidance),
    strengths: stringArray(data.strengths),
    missingEvidence: stringArray(data.missingEvidence),
    nextActions: stringArray(data.nextActions)
  };
}

export function isOpenAIDraftEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function generateOpenAIDisputeDraft(
  dispute: DisputeDetailView
): Promise<DisputeResponseDraftView | null> {
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
    throw new Error(`OpenAI draft request failed with ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI draft response was empty.");
  }

  const parsed = JSON.parse(outputText) as unknown;
  return normalizeDraft(parsed);
}
