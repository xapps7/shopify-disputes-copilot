import { NextResponse } from "next/server";

import { recordManualSubmission } from "@/lib/disputes/submissions";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const body = (await request.json()) as {
      method?: string;
      notes?: string;
    };
    const { id } = await params;
    await guardDisputeRoute(request, id);

    await recordManualSubmission(id, {
      method: body.method ?? "SHOPIFY_ADMIN",
      notes: body.notes ?? ""
    });

    return NextResponse.json({
      message:
        "Recorded in Disputes Co-Pilot only. Nothing was sent to Shopify - submit the packet in Shopify Admin."
    });
  } catch (error) {
    return toErrorResponse(error, "Submission update failed.");
  }
}
