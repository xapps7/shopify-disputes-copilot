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
import { consumeRateLimit } from "@/lib/rate-limit";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";
import { MAX_EVIDENCE_FIELD_LENGTH } from "@/lib/validation/route-inputs";

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
    const { shopDomain, merchant, dispute } = await guardDisputeRoute(request, id);

    // Every call here makes at least three Shopify Admin API requests against
    // the MERCHANT's own token. Unbounded, a loop burns through their Shopify
    // rate limit and breaks the other apps on their store - a failure they
    // would have no reason to trace back to us. Six bursts, refilling one
    // every 20s, matching /api/sync/disputes.
    const limit = consumeRateLimit(`push-evidence:${shopDomain}`, { capacity: 6, refillPerSecond: 1 / 20 });
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, message: "Evidence was sent to Shopify too frequently. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

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
    if (body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)) {
      // The same ceiling the field editor enforces. Without it, this route was
      // the way around it: the editor refuses 20,000 characters and this
      // accepted any size, stored it, and then tried to push it to Shopify -
      // which truncates, so the merchant would have sent evidence they never
      // saw the end of.
      for (const [key, value] of Object.entries(body.fields)) {
        if (typeof value !== "string") {
          return NextResponse.json(
            { ok: false, message: `Field "${key}" must be text.` },
            { status: 400 }
          );
        }

        if (value.length > MAX_EVIDENCE_FIELD_LENGTH) {
          return NextResponse.json(
            { ok: false, message: `Field "${key}" is limited to ${MAX_EVIDENCE_FIELD_LENGTH} characters.` },
            { status: 413 }
          );
        }
      }

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
