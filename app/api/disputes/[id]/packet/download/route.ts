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

    if (!dispute) {
      return NextResponse.json({ message: "Dispute not found." }, { status: 404 });
    }

    const content = buildPacketSummary(dispute);
    const disputeRef = dispute.shopifyDisputeId.split("/").pop() ?? dispute.id;

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
