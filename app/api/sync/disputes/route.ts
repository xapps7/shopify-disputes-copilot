import { NextResponse } from "next/server";

import { runDisputeSyncWithRetry } from "@/lib/disputes/sync-runs";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

export async function POST() {
  try {
    const shopDomain = await getCurrentShopDomain();

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
