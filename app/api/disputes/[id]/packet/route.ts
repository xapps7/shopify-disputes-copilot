import { NextResponse } from "next/server";

import { generatePacketForDispute, updateLatestPacketSummary } from "@/lib/disputes/packets";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const packet = await generatePacketForDispute(id);

    return NextResponse.json({
      message: "Packet generated.",
      packetUrl: packet.pdfUrl
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Packet generation failed." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { summaryText?: string };

    if (!body.summaryText?.trim()) {
      return NextResponse.json({ message: "Summary text is required." }, { status: 400 });
    }

    await updateLatestPacketSummary(id, body.summaryText.trim());

    return NextResponse.json({
      message: "Packet narrative updated."
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Packet update failed." },
      { status: 500 }
    );
  }
}
