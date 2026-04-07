import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSampleDisputeDetail } from "@/lib/disputes/sample-data";
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

    const sourceDispute = dispute
      ? dispute
      : (() => {
          const sample = getSampleDisputeDetail(id);

          return {
            id: sample.id,
            shopifyDisputeId: sample.shopifyDisputeId,
            status: sample.status,
            reason: sample.reason,
            reasonDetails: sample.reasonDetails,
            amount: { toString: () => sample.amount },
            currencyCode: sample.currencyCode,
            evidenceDueBy: sample.evidenceDueBy ? new Date(sample.evidenceDueBy) : null,
            evidenceItems: sample.evidenceItems,
            merchant: {
              shopDomain: "xappsdev.myshopify.com",
              settingsJson: null
            }
          };
        })();

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
