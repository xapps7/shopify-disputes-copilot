import { NextResponse } from "next/server";

import { generatePacketForDispute } from "@/lib/disputes/packets";

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
