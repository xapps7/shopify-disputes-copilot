import { NextResponse } from "next/server";

import { generateDisputeResponseDraft } from "@/lib/ai/dispute-drafts";
import { generateOpenAIPackageAssessment } from "@/lib/ai/openai-package-assessment";
import { generateOpenAIDisputeDraft, isOpenAIDraftEnabled } from "@/lib/ai/openai-dispute-drafts";
import { generatePackageAssessment } from "@/lib/ai/package-assessment";
import { getDisputeDetail } from "@/lib/disputes/repository";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const dispute = await getDisputeDetail(id);
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
    console.error("Draft generation failed", error);

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Draft generation failed."
      },
      { status: 500 }
    );
  }
}
