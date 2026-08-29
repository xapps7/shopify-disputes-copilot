import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { assertDisputeBelongsToMerchant, requireEvidenceItem, requireMerchant } from "@/lib/disputes/tenant";
import { requireShopDomain } from "@/lib/shopify/request-context";
import { toErrorResponse } from "@/lib/shopify/route-guard";
import {
  MALFORMED_JSON_MESSAGE,
  MAX_DESCRIPTION_LENGTH,
  checkTextLength,
  evidenceCategoryErrorMessage,
  parseEvidenceCategory,
  readJsonObject
} from "@/lib/validation/route-inputs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;

    // Authenticate BEFORE touching the body. This route used to parse the JSON
    // first, which meant an unauthenticated caller could hand us work to do -
    // and every other route in the app checks identity first, so the odd one
    // out is the one that gets missed in review.
    const shopDomain = await requireShopDomain(request);
    const merchant = await requireMerchant(shopDomain);

    // Malformed JSON is the caller's mistake, so it is a 400. It used to throw
    // into the generic catch and come back as a 500, telling the merchant our
    // server had failed and to try again - advice that could never work.
    const parsedBody = await readJsonObject(request);
    if (!parsedBody.ok) {
      return NextResponse.json({ ok: false, message: MALFORMED_JSON_MESSAGE }, { status: 400 });
    }

    const body = parsedBody.body as {
      category?: unknown;
      description?: unknown;
      disputeId?: unknown;
    };

    // Both the evidence item AND the destination dispute must belong to this
    // merchant. Previously neither was checked, so evidence could be moved
    // between tenants - stripping a file off someone else's case, or planting
    // one into it.
    const evidence = await requireEvidenceItem(merchant.id, id);
    const existing = await db.evidenceItem.findUniqueOrThrow({
      where: { id },
      select: { category: true, disputeId: true }
    });

    // Checked at runtime, not asserted with `as`. An unknown value reached
    // Prisma and returned a 500 the merchant could do nothing about.
    let category = existing.category;
    if (body.category !== undefined && body.category !== null && body.category !== "") {
      const parsedCategory = parseEvidenceCategory(body.category);

      if (!parsedCategory) {
        return NextResponse.json(
          { ok: false, message: evidenceCategoryErrorMessage(body.category) },
          { status: 400 }
        );
      }

      category = parsedCategory;
    }

    const descriptionCheck = checkTextLength(body.description, MAX_DESCRIPTION_LENGTH);
    if (!descriptionCheck.ok) {
      return NextResponse.json(
        { ok: false, message: `A description is limited to ${descriptionCheck.maxLength} characters.` },
        { status: 400 }
      );
    }

    const nextDisputeId =
      (typeof body.disputeId === "string" ? body.disputeId.trim() : "") || evidence.disputeId;
    await assertDisputeBelongsToMerchant(merchant.id, nextDisputeId);

    await db.evidenceItem.update({
      where: { id },
      data: {
        disputeId: nextDisputeId,
        category,
        description: descriptionCheck.value || null
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
          category
        })
      }
    });

    return NextResponse.json({
      message: nextDisputeId === evidence.disputeId ? "Evidence updated." : "Evidence updated and linked to a new dispute."
    });
  } catch (error) {
    return toErrorResponse(error, "Evidence update failed.");
  }
}
