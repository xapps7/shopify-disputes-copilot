import { NextResponse } from "next/server";

import { generateDisputeResponseDraft } from "@/lib/ai/dispute-drafts";
import { getDisputeDetail } from "@/lib/disputes/repository";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const dispute = await getDisputeDetail(id);

    return NextResponse.json({
      draft: generateDisputeResponseDraft(dispute)
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
