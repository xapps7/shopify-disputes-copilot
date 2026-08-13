import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { runDisputeSyncWithRetry } from "@/lib/disputes/sync-runs";
import { consumeRateLimit } from "@/lib/rate-limit";
import { guardShopRoute, toErrorResponse } from "@/lib/shopify/route-guard";

export async function POST(request: Request) {
  try {
    const { shopDomain } = await guardShopRoute(request);

    // Each sync fans out into a sequence of Shopify Admin API calls and retries
    // up to three times, so an unbounded caller could exhaust the merchant's
    // own Shopify rate limit. Six bursts, refilling one every 20s.
    const limit = consumeRateLimit(`sync:${shopDomain}`, { capacity: 6, refillPerSecond: 1 / 20 });
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, message: "Sync was requested too frequently. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const result = await runDisputeSyncWithRetry(shopDomain);
    revalidatePath("/");
    revalidatePath("/disputes");
    revalidatePath("/evidence");
    revalidatePath("/recommendations");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error, "Dispute sync failed.");
  }
}
