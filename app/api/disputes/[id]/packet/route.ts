import { NextResponse } from "next/server";

import { generatePacketForDispute, updateLatestPacketSummary } from "@/lib/disputes/packets";
import { guardDisputeRoute, toErrorResponse } from "@/lib/shopify/route-guard";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await guardDisputeRoute(request, id);
    const packet = await generatePacketForDispute(id);

    return NextResponse.json({
      message: "Packet generated.",
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
    const body = (await request.json()) as { summaryText?: string };

    if (!body.summaryText?.trim()) {
      return NextResponse.json({ message: "Summary text is required." }, { status: 400 });
    }

    await updateLatestPacketSummary(id, body.summaryText.trim());

    return NextResponse.json({
      message: "Packet narrative updated."
    });
  } catch (error) {
    return toErrorResponse(error, "Packet update failed.");
  }
}
