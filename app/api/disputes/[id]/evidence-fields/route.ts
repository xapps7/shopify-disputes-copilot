import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { EVIDENCE_FIELDS, type EvidenceFieldKey } from "@/lib/disputes/evidence-fields";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const VALID_KEYS = new Set<string>(EVIDENCE_FIELDS.map((field) => field.key));

/** Shopify truncates very long evidence text; refuse absurd payloads outright. */
const MAX_FIELD_LENGTH = 20_000;

/**
 * Persists one field of the merchant's dispute response.
 *
 * Only merchant edits are stored. Drafts are regenerated on read, so clearing a
 * field returns it to the generated draft rather than leaving it blank - which
 * is what a merchant means by "undo my change" here.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { dispute } = await guardDisputeRoute(request, id);

    const body = (await request.json()) as { key?: string; value?: string };
    const key = body.key?.trim();

    if (!key || !VALID_KEYS.has(key)) {
      return NextResponse.json(
        { ok: false, message: "Unknown evidence field." },
        { status: 400 }
      );
    }

    const value = typeof body.value === "string" ? body.value : "";

    if (value.length > MAX_FIELD_LENGTH) {
      return NextResponse.json(
        { ok: false, message: `That field is limited to ${MAX_FIELD_LENGTH} characters.` },
        { status: 413 }
      );
    }

    const current = await db.dispute.findUniqueOrThrow({
      where: { id: dispute.id },
      select: { evidenceFieldsJson: true }
    });

    let fields: Partial<Record<EvidenceFieldKey, string>> = {};
    if (current.evidenceFieldsJson) {
      try {
        const parsed = JSON.parse(current.evidenceFieldsJson);
        if (parsed && typeof parsed === "object") {
          fields = parsed;
        }
      } catch {
        fields = {};
      }
    }

    if (value.trim()) {
      fields[key as EvidenceFieldKey] = value;
    } else {
      delete fields[key as EvidenceFieldKey];
    }

    await db.dispute.update({
      where: { id: dispute.id },
      data: { evidenceFieldsJson: JSON.stringify(fields) }
    });

    return NextResponse.json({ ok: true, key, saved: Boolean(value.trim()) });
  } catch (error) {
    return toErrorResponse(error, "Could not save that field.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  return PATCH(request, context);
}
