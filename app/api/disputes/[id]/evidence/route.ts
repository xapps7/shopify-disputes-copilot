import { NextResponse } from "next/server";
import { EvidenceCategory } from "@prisma/client";

import { db } from "@/lib/db";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";
import { persistUploadedFile } from "@/lib/storage";

/** Evidence is documents and screenshots; nothing here needs to be executable. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await guardDisputeRoute(request, id);

    // Reject oversized bodies before buffering them: `file.arrayBuffer()` pulls
    // the whole upload into memory and there was previously no cap at all.
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ message: "File is larger than the 20 MB limit." }, { status: 413 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const category = String(formData.get("category") ?? "OTHER") as EvidenceCategory;

    if (!(file instanceof File) || !title) {
      return NextResponse.json({ message: "Title and file are required." }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ message: "File is larger than the 20 MB limit." }, { status: 413 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { message: `Unsupported file type${file.type ? `: ${file.type}` : ""}.` },
        { status: 415 }
      );
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
    return toErrorResponse(error, "Upload failed.");
  }
}
