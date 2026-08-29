import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { evaluateLock } from "@/lib/disputes/locking";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  MAX_SINGLE_EVIDENCE_BYTES,
  MAX_TOTAL_EVIDENCE_BYTES
} from "@/lib/disputes/evidence-fields";
import { persistUploadedFile, StorageError } from "@/lib/storage";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  MISSING_CONTENT_LENGTH_MESSAGE,
  checkDeclaredBodySize,
  checkTextLength,
  evidenceCategoryErrorMessage,
  parseEvidenceCategory
} from "@/lib/validation/route-inputs";

/**
 * Shopify accepts .pdf, .png and .jpeg only, 2 MB per file, and 4 MB TOTAL
 * across every evidence slot. Both size rules are enforced here.
 *
 * The per-file cap used to be set to the total, which meant a 3 MB scan passed
 * every check this app makes and was rejected by Shopify at submission - the
 * one moment a merchant cannot afford a surprise.
 */
const MAX_SINGLE_UPLOAD_BYTES = MAX_SINGLE_EVIDENCE_BYTES;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { dispute } = await guardDisputeRoute(request, id);

    const lockSource = await db.dispute.findUniqueOrThrow({
      where: { id: dispute.id },
      select: { status: true, evidenceSentOn: true, evidenceDueBy: true }
    });
    const lock = evaluateLock(lockSource);

    if (lock.locked) {
      return NextResponse.json({ message: lock.reason }, { status: 409 });
    }

    // Reject oversized bodies before buffering them: `file.arrayBuffer()` pulls
    // the whole upload into memory and there was previously no cap at all.
    //
    // The margin matters. `content-length` covers the multipart envelope as well
    // as the file, so a file exactly at the limit arrives a few hundred bytes
    // over it - without the slack, a legal upload is refused here with a
    // vaguer message than the precise check further down would have given.
    //
    // A request that does not declare its size is refused outright. With
    // `Transfer-Encoding: chunked` there is no `content-length`, the old
    // `Number(null ?? "0")` made that a zero, zero passed the check, and
    // `formData()` then buffered the whole body. One authenticated merchant
    // could exhaust the single App Runner instance and take every other
    // merchant offline with them.
    const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
    const bodySize = checkDeclaredBodySize(
      request.headers.get("content-length"),
      MAX_SINGLE_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES
    );

    if (!bodySize.ok) {
      // 411 for a body that never declared its size, 413 for one that declared
      // too much. Two different mistakes deserve two different answers.
      return bodySize.reason === "missing"
        ? NextResponse.json({ message: MISSING_CONTENT_LENGTH_MESSAGE }, { status: 411 })
        : NextResponse.json(
            { message: "Shopify accepts 2 MB per evidence file. This one is over that." },
            { status: 413 }
          );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    const titleCheck = checkTextLength(formData.get("title"), MAX_TITLE_LENGTH);
    if (!titleCheck.ok) {
      return NextResponse.json(
        { message: `A title is limited to ${titleCheck.maxLength} characters.` },
        { status: 400 }
      );
    }
    const title = titleCheck.value;

    const descriptionCheck = checkTextLength(formData.get("description"), MAX_DESCRIPTION_LENGTH);
    if (!descriptionCheck.ok) {
      return NextResponse.json(
        { message: `A description is limited to ${descriptionCheck.maxLength} characters.` },
        { status: 400 }
      );
    }
    const description = descriptionCheck.value;

    // Checked, not cast. The old `as EvidenceCategory` was a compile-time
    // claim, so an unknown value reached Prisma and came back to the merchant
    // as a 500 "Upload failed." - which reads as our fault and gives them
    // nothing to correct.
    const rawCategory = formData.get("category") ?? "OTHER";
    const category = parseEvidenceCategory(rawCategory);

    if (!category) {
      return NextResponse.json({ message: evidenceCategoryErrorMessage(rawCategory) }, { status: 400 });
    }

    const linkUrl = String(formData.get("url") ?? "").trim();

    if (!title) {
      return NextResponse.json({ message: "A title is required." }, { status: 400 });
    }

    // A link is saved as the merchant's own reference, NOT as something that
    // goes to the bank. Shopify's evidence rules exclude "links to external
    // resources", so the UI says so and this route just stores the address.
    if (!(file instanceof File)) {
      if (!linkUrl) {
        return NextResponse.json({ message: "Add a file or a link." }, { status: 400 });
      }

      let parsed: URL;
      try {
        parsed = new URL(linkUrl);
      } catch {
        return NextResponse.json({ message: "That link is not a valid URL." }, { status: 400 });
      }

      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return NextResponse.json({ message: "Links must start with http:// or https://" }, { status: 400 });
      }

      await db.evidenceItem.create({
        data: {
          disputeId: id,
          category,
          sourceType: "merchant_link",
          title,
          description: description || null,
          fileUrl: parsed.toString(),
          createdBy: "merchant"
        }
      });

      await db.disputeTimelineEvent.create({
        data: {
          disputeId: id,
          eventType: "EVIDENCE_LINK_ADDED",
          eventTimestamp: new Date(),
          source: "merchant",
          payloadSummaryJson: JSON.stringify({ title, category, url: parsed.toString() })
        }
      });

      return NextResponse.json({ message: "Link added.", fileUrl: parsed.toString() });
    }

    if (file.size > MAX_SINGLE_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          message: `Shopify accepts 2 MB per evidence file. This one is ${Math.round(
            file.size / 1024
          )} KB. Compress it or split it - the per-file limit applies whatever room is left in the 4 MB total.`
        },
        { status: 413 }
      );
    }

    if (!(ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) {
      return NextResponse.json(
        {
          message: `Shopify only accepts PDF, PNG and JPEG for dispute evidence${
            file.type ? ` - this file is ${file.type}` : ""
          }.`
        },
        { status: 415 }
      );
    }

    // Enforce the 4 MB TOTAL cap across everything already attached, so the
    // merchant finds out now rather than when Shopify rejects the packet.
    const existing = await db.evidenceItem.aggregate({
      where: { disputeId: id, fileSizeBytes: { not: null } },
      _sum: { fileSizeBytes: true }
    });
    const usedBytes = existing._sum.fileSizeBytes ?? 0;

    if (usedBytes + file.size > MAX_TOTAL_EVIDENCE_BYTES) {
      const remaining = Math.max(0, MAX_TOTAL_EVIDENCE_BYTES - usedBytes);
      return NextResponse.json(
        {
          message: `Shopify accepts 4 MB of evidence in total for a dispute. ${Math.round(
            remaining / 1024
          )} KB left - this file is ${Math.round(file.size / 1024)} KB.`
        },
        { status: 413 }
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
        fileSizeBytes: file.size,
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
    // A storage misconfiguration is the merchant's to fix, so it gets named
    // rather than swallowed into a generic failure they cannot act on.
    if (error instanceof StorageError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 503 });
    }

    return toErrorResponse(error, "Upload failed.");
  }
}
