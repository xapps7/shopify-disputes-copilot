import { NextResponse } from "next/server";

import { capabilityRefusalResponse, requireCapability } from "@/lib/billing/gate";
import { db } from "@/lib/db";
import { buildPacketSummary, resolvePacketText } from "@/lib/disputes/packet-content";
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

    // Producing the file is paid labour. Nothing about the dispute is hidden
    // from a free merchant - the case, the deadline, the evidence and the
    // packet text are all still on screen - it is only the assembled download
    // that belongs to Pro.
    const gate = await requireCapability(merchant.id, "PACKET_EXPORT");
    if (!gate.allowed) {
      return capabilityRefusalResponse(gate);
    }

    // This packet contains customer PII. It was previously readable by anyone
    // holding a dispute id, with no authentication and no tenant check.
    const dispute = await db.dispute.findFirst({
      where: { id, merchantId: merchant.id },
      include: {
        merchant: true,
        evidenceItems: {
          orderBy: { createdAt: "asc" }
        },
        // The merchant's edited narrative. Without this the download regenerated
        // the packet from field values every time and silently discarded
        // whatever they wrote in the editor.
        packets: {
          orderBy: { version: "desc" },
          take: 1
        }
      }
    });

    // Previously this fell back to sample data for ANY unknown id, handing the
    // merchant a plausible-looking evidence packet full of another store's
    // fabricated facts. Unknown dispute -> 404.
    if (!dispute) {
      return NextResponse.json({ ok: false, message: "Dispute not found." }, { status: 404 });
    }

    const { text, source } = resolvePacketText(
      dispute.packets[0]?.summaryText ?? null,
      buildPacketSummary(dispute)
    );

    const disputeRef = dispute.shopifyDisputeId.split("/").pop() ?? id;

    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="dispute-${disputeRef}-packet.txt"`,
        // So a merchant who reports "my edits are missing" can be answered from
        // a response header instead of a guess.
        "X-Packet-Source": source
      }
    });
  } catch (error) {
    return toErrorResponse(error, "Packet download failed.");
  }
}
