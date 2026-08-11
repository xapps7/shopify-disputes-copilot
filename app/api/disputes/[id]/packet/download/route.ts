import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { buildPacketSummary } from "@/lib/disputes/packet-content";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const dispute = await db.dispute.findUnique({
      where: { id },
      include: {
        merchant: true,
        evidenceItems: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    // Previously this fell back to sample data for ANY unknown id, handing the
    // merchant a plausible-looking evidence packet full of another store's
    // fabricated facts. Unknown dispute -> 404.
    if (!dispute) {
      return NextResponse.json({ ok: false, message: "Dispute not found." }, { status: 404 });
    }

    const sourceDispute = dispute;

    const content = buildPacketSummary(sourceDispute);
    const disputeRef = sourceDispute.shopifyDisputeId.split("/").pop() ?? id;

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"dispute-${disputeRef}-packet.txt\"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Packet download failed." },
      { status: 500 }
    );
  }
}
