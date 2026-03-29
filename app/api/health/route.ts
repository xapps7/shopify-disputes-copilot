import { NextResponse } from "next/server";

import { APP_COMMIT, APP_RELEASE } from "@/lib/version";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "shopify-disputes-copilot",
    release: APP_RELEASE,
    commit: APP_COMMIT,
    timestamp: new Date().toISOString()
  });
}
