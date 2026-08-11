import { EvidenceCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { assertDisputeBelongsToMerchant, requireEvidenceItem, requireMerchant } from "@/lib/disputes/tenant";
import { requireShopDomain } from "@/lib/shopify/request-context";
import { toErrorResponse } from "@/lib/shopify/route-guard";

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

    const shopDomain = await requireShopDomain(request);
    const merchant = await requireMerchant(shopDomain);

    // Both the evidence item AND the destination dispute must belong to this
    // merchant. Previously neither was checked, so evidence could be moved
    // between tenants - stripping a file off someone else's case, or planting
    // one into it.
    const evidence = await requireEvidenceItem(merchant.id, id);
    const existing = await db.evidenceItem.findUniqueOrThrow({
      where: { id },
      select: { category: true, disputeId: true }
    });

    const nextDisputeId = body.disputeId?.trim() || evidence.disputeId;
    await assertDisputeBelongsToMerchant(merchant.id, nextDisputeId);

    await db.evidenceItem.update({
      where: { id },
      data: {
        disputeId: nextDisputeId,
        category: (body.category as EvidenceCategory | undefined) ?? existing.category,
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
          category: body.category ?? existing.category
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
