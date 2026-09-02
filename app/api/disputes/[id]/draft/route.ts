import { NextResponse } from "next/server";

import { generateDisputeResponseDraft } from "@/lib/ai/dispute-drafts";
import { generateOpenAIPackageAssessment } from "@/lib/ai/openai-package-assessment";
import { generateOpenAIDisputeDraft, isOpenAIDraftEnabled } from "@/lib/ai/openai-dispute-drafts";
import { generatePackageAssessment } from "@/lib/ai/package-assessment";
import { capabilityRefusalResponse, requireCapability } from "@/lib/billing/gate";
import { getDisputeDetail } from "@/lib/disputes/repository";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { merchant } = await guardDisputeRoute(request, id);

    // Writing the evidence is the paid half of the product, so the plan is
    // checked before any drafting starts. Checking later would still refuse the
    // merchant, but only after this handler had called OpenAI - the free
    // merchant pressing the button repeatedly would be running up a bill for
    // words nobody is allowed to keep.
    const gate = await requireCapability(merchant.id, "AUTO_DRAFT");
    if (!gate.allowed) {
      return capabilityRefusalResponse(gate);
    }

    const dispute = await getDisputeDetail(id, merchant.id);
    let draft = generateDisputeResponseDraft(dispute);
    let assessment = generatePackageAssessment(dispute);

    if (isOpenAIDraftEnabled()) {
      try {
        const aiDraft = await generateOpenAIDisputeDraft(dispute);
        if (aiDraft) {
          draft = aiDraft;
        }
      } catch (error) {
        console.error("OpenAI draft fallback triggered", error);
      }

      try {
        const aiAssessment = await generateOpenAIPackageAssessment(dispute);
        if (aiAssessment) {
          assessment = aiAssessment;
        }
      } catch (error) {
        console.error("OpenAI package assessment fallback triggered", error);
      }
    }

    return NextResponse.json({
      draft,
      assessment
    });
  } catch (error) {
    return toErrorResponse(error, "Draft generation failed.");
  }
}
