import { NextResponse } from "next/server";

import { recordDisputeOutcome } from "@/lib/disputes/outcomes";
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

    // A body that is not JSON is a caller mistake, not a server failure. It
    // used to throw into the generic catch and come back as a 500, which tells
    // the merchant to retry a request that will fail the same way every time.
    const parsedBody = await readJsonObject(request);
    if (!parsedBody.ok) {
      return NextResponse.json({ message: MALFORMED_JSON_MESSAGE }, { status: 400 });
    }

    const body = parsedBody.body as {
      outcome?: unknown;
      rootCause?: unknown;
      notes?: unknown;
    };

    // Notes had no ceiling and are read back on every dispute page, so one
    // request could make that page slow for the merchant permanently.
    const notesCheck = checkTextLength(body.notes, MAX_NOTES_LENGTH);
    if (!notesCheck.ok) {
      return NextResponse.json(
        { message: `Notes are limited to ${notesCheck.maxLength} characters.` },
        { status: 400 }
      );
    }

    const outcomeCheck = checkTextLength(body.outcome, MAX_SHORT_CODE_LENGTH);
    const rootCauseCheck = checkTextLength(body.rootCause, MAX_SHORT_CODE_LENGTH);

    if (!outcomeCheck.ok || !rootCauseCheck.ok) {
      return NextResponse.json({ message: "That outcome or root cause is not valid." }, { status: 400 });
    }

    await recordDisputeOutcome(id, {
      outcome: outcomeCheck.value || "UNDER_REVIEW",
      rootCause: rootCauseCheck.value || "DOCUMENTATION_GAP",
      notes: notesCheck.value
    });

    return NextResponse.json({
      message: "Outcome recorded and recommendations updated."
    });
  } catch (error) {
    return toErrorResponse(error, "Outcome update failed.");
  }
}
