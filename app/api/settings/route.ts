import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedShopDomain } from "@/lib/shopify/request-context";
import { saveMerchantSettings } from "@/lib/settings";

const settingsSchema = z.object({
  returnPolicyUrl: z.string(),
  refundPolicyUrl: z.string(),
  supportEmail: z.string(),
  supportPhone: z.string(),
  statementDescriptor: z.string(),
  packetFooter: z.string(),
  alertEmail: z.string(),
  evidenceRetentionDays: z.string(),
  notifyDueSoon: z.boolean(),
  notifyMissingEvidence: z.boolean(),
  allowManualSubmissionRecording: z.boolean()
});

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const shopDomain = await getAuthenticatedShopDomain(request);

    if (!shopDomain) {
      return NextResponse.json({ message: "No active shop session found." }, { status: 400 });
    }

    const payload = settingsSchema.parse(await request.json());
    await saveMerchantSettings(shopDomain, payload);

    return NextResponse.json({ message: "Settings saved." });
  } catch (error) {
    console.error("Settings save failed", error);
    return NextResponse.json(
      // Never echo the raw error: the zod issue dump leaks internals to an
      // unauthenticated caller.
      { message: "Failed to save settings." },
      { status: 500 }
    );
  }
}
