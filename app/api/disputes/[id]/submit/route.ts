import { NextResponse } from "next/server";

import { recordManualSubmission } from "@/lib/disputes/submissions";

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

    await recordManualSubmission(id, {
      method: body.method ?? "SHOPIFY_ADMIN",
      notes: body.notes ?? ""
    });

    return NextResponse.json({
      message: "Submission recorded. The dispute is now marked as submitted for review."
    });
  } catch (error) {
    console.error("Submission update failed", error);

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Submission update failed."
      },
      { status: 500 }
    );
  }
}
