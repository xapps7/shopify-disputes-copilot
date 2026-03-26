import { NextResponse } from "next/server";
import { EvidenceCategory } from "@prisma/client";

import { db } from "@/lib/db";
import { persistUploadedFile } from "@/lib/storage";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const category = String(formData.get("category") ?? "OTHER") as EvidenceCategory;

    if (!(file instanceof File) || !title) {
      return NextResponse.json({ message: "Title and file are required." }, { status: 400 });
    }

    const dispute = await db.dispute.findUnique({
      where: { id }
    });

    if (!dispute) {
      return NextResponse.json({ message: "Dispute not found." }, { status: 404 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileUrl = await persistUploadedFile(id, file.name, bytes);

    await db.evidenceItem.create({
      data: {
        disputeId: id,
        category,
        sourceType: "merchant_upload",
        title,
        description: description || null,
        fileUrl,
        fileMimeType: file.type || null,
        createdBy: "merchant"
      }
    });

    await db.disputeTimelineEvent.create({
      data: {
        disputeId: id,
        eventType: "EVIDENCE_UPLOADED",
        eventTimestamp: new Date(),
        source: "merchant",
        payloadSummaryJson: JSON.stringify({ title, category, fileUrl })
      }
    });

    return NextResponse.json({ message: "Evidence uploaded.", fileUrl });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Upload failed." },
      { status: 500 }
    );
  }
}
