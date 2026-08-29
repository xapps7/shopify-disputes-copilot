import { NextResponse } from "next/server";

import { recordManualSubmission } from "@/lib/disputes/submissions";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";
import {
  MALFORMED_JSON_MESSAGE,
  MAX_NOTES_LENGTH,
  MAX_SHORT_CODE_LENGTH,
  checkTextLength,
  readJsonObject
} from "@/lib/validation/route-inputs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    await guardDisputeRoute(request, id);

    // Malformed JSON is a 400. Returning 500 blamed our server for the
    // caller's body and pointed the merchant at nothing they could change.
    const parsedBody = await readJsonObject(request);
    if (!parsedBody.ok) {
      return NextResponse.json({ message: MALFORMED_JSON_MESSAGE }, { status: 400 });
    }

    const body = parsedBody.body as { method?: unknown; notes?: unknown };

    const notesCheck = checkTextLength(body.notes, MAX_NOTES_LENGTH);
    if (!notesCheck.ok) {
      return NextResponse.json(
        { message: `Notes are limited to ${notesCheck.maxLength} characters.` },
        { status: 400 }
      );
    }

    const methodCheck = checkTextLength(body.method, MAX_SHORT_CODE_LENGTH);
    if (!methodCheck.ok) {
      return NextResponse.json({ message: "That submission method is not valid." }, { status: 400 });
    }

    await recordManualSubmission(id, {
      method: methodCheck.value || "SHOPIFY_ADMIN",
      notes: notesCheck.value
    });

    return NextResponse.json({
      message:
        "Recorded in Disputes Co-Pilot only. Nothing was sent to Shopify - submit the packet in Shopify Admin."
    });
  } catch (error) {
    return toErrorResponse(error, "Submission update failed.");
  }
}
