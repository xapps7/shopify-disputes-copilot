import { NextResponse } from "next/server";

import { generatePacketForDispute, updateLatestPacketSummary } from "@/lib/disputes/packets";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";
import {
  MALFORMED_JSON_MESSAGE,
  MAX_SUMMARY_TEXT_LENGTH,
  checkTextLength,
  readJsonObject
} from "@/lib/validation/route-inputs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await guardDisputeRoute(request, id);
    const packet = await generatePacketForDispute(id);

    return NextResponse.json({
      // Say what the merchant actually gets. The packet is a plain text file -
      // there is no PDF library in this app and none can be added right now -
      // and Shopify accepts PDF, PNG and JPEG only. Calling it a PDF would send
      // a merchant to Shopify's upload box with a file it will reject, at the
      // one moment a deadline is running.
      message:
        "Packet generated as a plain text file for your own records. Shopify accepts PDF, PNG and JPEG only, so this file cannot be attached as evidence - use it to fill in Shopify's evidence form.",
      packetUrl: packet.pdfUrl
    });
  } catch (error) {
    return toErrorResponse(error, "Packet generation failed.");
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await guardDisputeRoute(request, id);

    // Malformed JSON is the caller's mistake. It used to throw into the
    // generic catch and return 500, which blamed the server for a body only
    // the caller can fix.
    const parsedBody = await readJsonObject(request);
    if (!parsedBody.ok) {
      return NextResponse.json({ message: MALFORMED_JSON_MESSAGE }, { status: 400 });
    }

    const body = parsedBody.body as { summaryText?: unknown };

    // The narrative had no ceiling and is loaded on every packet render.
    const summaryCheck = checkTextLength(body.summaryText, MAX_SUMMARY_TEXT_LENGTH);
    if (!summaryCheck.ok) {
      return NextResponse.json(
        { message: `The packet narrative is limited to ${summaryCheck.maxLength} characters.` },
        { status: 400 }
      );
    }

    if (!summaryCheck.value) {
      return NextResponse.json({ message: "Summary text is required." }, { status: 400 });
    }

    await updateLatestPacketSummary(id, summaryCheck.value);

    return NextResponse.json({
      message: "Packet narrative updated."
    });
  } catch (error) {
    return toErrorResponse(error, "Packet update failed.");
  }
}
