import { NextResponse } from "next/server";

import { runDisputeSyncWithRetry } from "@/lib/disputes/sync-runs";
import { resolveShopDomain } from "@/lib/shopify/auth";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const shopDomain = await resolveShopDomain({ shop: url.searchParams.get("shop") ?? undefined });

    if (!shopDomain) {
      return NextResponse.json({ ok: false, message: "No active shop session found." }, { status: 400 });
    }

    const result = await runDisputeSyncWithRetry(shopDomain);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Dispute sync failed."
      },
      { status: 500 }
    );
  }
}
