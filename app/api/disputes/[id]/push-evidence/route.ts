import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { decryptString } from "@/lib/crypto";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import {
  buildEvidenceInput,
  findDisputeEvidenceTarget,
  getEvidencePushCapability,
  pushEvidenceToShopify
} from "@/lib/shopify/dispute-evidence";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Writes the prepared response into Shopify's evidence form so the merchant
 * only has to open it and press Submit.
 *
 * Never submits on their behalf: submission is irreversible, and Shopify's
 * `submitEvidence` flag is currently a no-op anyway.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { merchant, dispute } = await guardDisputeRoute(request, id);

    const merchantRecord = await db.merchant.findUniqueOrThrow({
      where: { id: merchant.id },
      select: { shopDomain: true, accessTokenEncrypted: true }
    });

    if (!merchantRecord.accessTokenEncrypted) {
      return NextResponse.json({ ok: false, message: "This shop is not connected to Shopify." }, { status: 400 });
    }

    const client = createShopifyAdminClient({
      storeDomain: merchantRecord.shopDomain,
      accessToken: decryptString(merchantRecord.accessTokenEncrypted)
    });

    const capability = await getEvidencePushCapability(client);
    if (!capability.canPush) {
      return NextResponse.json({ ok: false, message: capability.reason }, { status: 403 });
    }

    if (!dispute.shopifyDisputeId) {
      return NextResponse.json({ ok: false, message: "This dispute has no Shopify id." }, { status: 400 });
    }

    const target = await findDisputeEvidenceTarget(client, dispute.shopifyDisputeId);
    if ("error" in target) {
      return NextResponse.json({ ok: false, message: target.error }, { status: 502 });
    }

    if (target.alreadySubmitted) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "This evidence has already been submitted to Shopify. Once submitted it cannot be changed or added to."
        },
        { status: 409 }
      );
    }

    const stored = await db.dispute.findUniqueOrThrow({
      where: { id: dispute.id },
      select: { evidenceFieldsJson: true }
    });

    let fields: Record<string, string> = {};
    if (stored.evidenceFieldsJson) {
      try {
        const parsed = JSON.parse(stored.evidenceFieldsJson);
        if (parsed && typeof parsed === "object") {
          fields = parsed;
        }
      } catch {
        fields = {};
      }
    }

    // The request may carry unsaved edits from the open page.
    const body = (await request.json().catch(() => ({}))) as { fields?: Record<string, string> };
    if (body.fields && typeof body.fields === "object") {
      fields = { ...fields, ...body.fields };
    }

    const input = buildEvidenceInput(fields);
    const result = await pushEvidenceToShopify(client, target.evidenceId, input);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.message, userErrors: result.userErrors ?? [] },
        { status: 422 }
      );
    }

    await db.disputeTimelineEvent.create({
      data: {
        disputeId: dispute.id,
        eventType: "EVIDENCE_PUSHED_TO_SHOPIFY",
        eventTimestamp: new Date(),
        source: "app",
        payloadSummaryJson: JSON.stringify({ fields: Object.keys(input) })
      }
    });

    return NextResponse.json({
      ok: true,
      message: `Sent ${Object.keys(input).length} field(s) to Shopify. Open the order in Shopify Admin and press Submit - this app does not submit for you.`,
      fields: Object.keys(input)
    });
  } catch (error) {
    return toErrorResponse(error, "Could not send the response to Shopify.");
  }
}
