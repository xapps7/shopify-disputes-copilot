import { NextResponse } from "next/server";

import { recordDisputeOutcome } from "@/lib/disputes/outcomes";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";

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
    await guardDisputeRoute(request, id);

    await recordDisputeOutcome(id, {
      outcome: body.outcome ?? "UNDER_REVIEW",
      rootCause: body.rootCause ?? "DOCUMENTATION_GAP",
      notes: body.notes ?? ""
    });

    return NextResponse.json({
      message: "Outcome recorded and recommendations updated."
    });
  } catch (error) {
    return toErrorResponse(error, "Outcome update failed.");
  }
}
