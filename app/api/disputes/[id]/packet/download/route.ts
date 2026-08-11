import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { buildPacketSummary } from "@/lib/disputes/packet-content";
import { requireMerchant } from "@/lib/disputes/tenant";
import { requireShopDomain } from "@/lib/shopify/request-context";
import { toErrorResponse } from "@/lib/shopify/route-guard";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const shopDomain = await requireShopDomain(request);
    const merchant = await requireMerchant(shopDomain);

    // This packet contains customer PII. It was previously readable by anyone
    // holding a dispute id, with no authentication and no tenant check.
    const dispute = await db.dispute.findFirst({
      where: { id, merchantId: merchant.id },
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
    return toErrorResponse(error, "Packet download failed.");
  }
}
