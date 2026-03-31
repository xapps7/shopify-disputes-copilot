import { NextResponse } from "next/server";

import { recordDisputeOutcome } from "@/lib/disputes/outcomes";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const body = (await request.json()) as {
      outcome?: string;
      rootCause?: string;
      notes?: string;
    };
    const { id } = await params;

    await recordDisputeOutcome(id, {
      outcome: body.outcome ?? "UNDER_REVIEW",
      rootCause: body.rootCause ?? "DOCUMENTATION_GAP",
      notes: body.notes ?? ""
    });

    return NextResponse.json({
      message: "Outcome recorded and recommendations updated."
    });
  } catch (error) {
    console.error("Outcome update failed", error);

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Outcome update failed."
      },
      { status: 500 }
    );
  }
}
