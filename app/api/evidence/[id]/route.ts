import { EvidenceCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const body = (await request.json()) as {
      category?: string;
      description?: string;
      disputeId?: string;
    };
    const { id } = await params;

    const evidence = await db.evidenceItem.findUnique({
      where: { id },
      include: {
        dispute: true
      }
    });

    if (!evidence) {
      return NextResponse.json({ message: "Evidence item not found." }, { status: 404 });
    }

    const nextDisputeId = body.disputeId?.trim() || evidence.disputeId;
    const targetDispute = await db.dispute.findUnique({
      where: { id: nextDisputeId }
    });

    if (!targetDispute) {
      return NextResponse.json({ message: "Target dispute not found." }, { status: 404 });
    }

    await db.evidenceItem.update({
      where: { id },
      data: {
        disputeId: nextDisputeId,
        category: (body.category as EvidenceCategory | undefined) ?? evidence.category,
        description: body.description?.trim() || null
      }
    });

    await db.disputeTimelineEvent.create({
      data: {
        disputeId: nextDisputeId,
        eventType: "EVIDENCE_METADATA_UPDATED",
        eventTimestamp: new Date(),
        source: "merchant",
        payloadSummaryJson: JSON.stringify({
          evidenceId: id,
          previousDisputeId: evidence.disputeId,
          nextDisputeId,
          category: body.category ?? evidence.category
        })
      }
    });

    return NextResponse.json({
      message: nextDisputeId === evidence.disputeId ? "Evidence updated." : "Evidence updated and linked to a new dispute."
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Evidence update failed." },
      { status: 500 }
    );
  }
}
